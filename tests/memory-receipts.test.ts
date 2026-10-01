import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {NativeMemoryService} from '../packages/native-memory';
import type {MemoryTaskBinding} from '../packages/native-memory/background';
import {digest} from '../packages/native-resources/files';

const put=async(file:string,text:string)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);};
const proof=async(file:string)=>({path:file,sha256:digest(await readFile(file,'utf8'))});
const manifest=(prompt:string)=>JSON.parse(prompt.slice(prompt.lastIndexOf('\n{')+1,prompt.lastIndexOf('\n</agent-workbench-memory-handoff>')));
const target:MemoryTaskBinding={binding:{runtime:'claude',provider:'fixture',accountRef:'fixture',executionId:'local',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'mapping'},modelSelection:{model:'fixture-model'},permissionMode:'full-access'};
async function fixture(t:TestContext,count=3){
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-receipts-')),home=path.join(root,'home'),data=path.join(root,'data');
  const options={home,codexHome:path.join(home,'.codex'),claudeHome:path.join(home,'.claude'),intervalMs:60000,machineIdentity:'fixture'};
  const service=new NativeMemoryService(data,options);await service.initialize();
  t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true});});
  for(let i=0;i<count;i++)await put(path.join(options.codexHome,'memories',`source-${i}.md`),`Original source reference ${i}.`);
  await service.configure({enabled:true,initialSources:'codex'});
  const index=path.join(options.claudeHome,'projects','fixture','memory','MEMORY.md');
  return {service,options,data,index};
}
async function writeReceipt(m:any,entries:any[]){await put(m.receiptFile,JSON.stringify({deliveryId:m.deliveryId,token:m.token,recipientRuntime:m.recipientRuntime,entries}));}
async function store(index:string,m:any,broken=true){
  const rows=[];let links='# Native memory\n';
  for(const [i,e] of m.entries.entries()){
    const file=path.join(path.dirname(index),`topic-${i}.md`);
    const marked=(text:string)=>`${e.startMarker}\n${text}\n${e.endMarker}`;
    await put(file,marked(`${e.scope}\nEnglish synthesis of source ${i}.`));
    const link=`[Source ${i}](${path.basename(file)})`;
    links+=(broken&&i===1?link:marked(link))+'\n';
    rows.push({archiveId:e.archiveId,revision:e.revision,scope:e.scope,disposition:broken&&i===2?'already_present':'stored',files:[await proof(file)]});
  }
  await put(index,links);
  return Promise.all(rows.map(async row=>({...row,index:await proof(index)})));
}
const settled=async(service:NativeMemoryService)=>{for(let i=0;i<500&&service.background.busy();i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(service.background.busy(),false);};

test('receipt feedback reproduces index provenance and semantic duplicate failures without discarding valid siblings',async t=>{
  const f=await fixture(t),session=f.service.session('claude','bound'),m=manifest(await session.prepare('Maintain memory','first'));
  await writeReceipt(m,await store(f.index,m));
  const report=await f.service.verifyHandoff('claude','bound');
  assert.equal(report.complete,false);assert.equal(report.verified,1);assert.equal(report.total,3);
  assert.deepEqual(report.entries.map(e=>e.code),[undefined,'MEMORY_RECEIPT_INDEX_PROVENANCE','MEMORY_RECEIPT_ALREADY_PRESENT_MISMATCH']);
  assert.equal((await f.service.status()).pendingClaude,2);
  assert.doesNotMatch(JSON.stringify(report),/Original source reference|fixture-model|token|receiptFile/);
  await session.finish();
  const next=await f.service.session('claude','next').prepare('Next explicit task','second');
  assert.match(next,/previousReceiptError/);assert.match(next,/workbench_verify_memory_handoff/);
  assert.equal(manifest(next).entries.length,2);
});

test('a single background execution repairs evidence with feedback and completes without a new model turn',async t=>{
  const f=await fixture(t);let runs=0;
  f.service.background.registerExecutor({supports:()=>true,run:async task=>{
    runs++;const m=manifest(task.prompt);await task.read({});await writeReceipt(m,await store(f.index,m));
    assert.equal((await task.verify()).verified,1);
    await writeReceipt(m,await store(f.index,m,false));
    const fixed=await task.verify();assert.equal(fixed.complete,true);assert.equal(fixed.verified,3);
    await assert.rejects(task.verify(),/MEMORY_HANDOFF_VERIFY_LIMIT/);
    return {state:'completed'};
  }});
  await f.service.background.start(target,'explicit');await settled(f.service);
  assert.equal(runs,1);assert.equal(f.service.background.list()[0]!.state,'completed');
  assert.equal(f.service.background.list()[0]!.processed,3);assert.deepEqual(f.service.background.list()[0]!.receiptIssues,[]);
  assert.equal((await f.service.status()).pendingClaude,0);
});

test('unrepaired partial receipts retain valid progress and typed issues across restart without automatic execution',async t=>{
  const f=await fixture(t,13);let runs=0;
  f.service.background.registerExecutor({supports:()=>true,run:async task=>{runs++;const m=manifest(task.prompt);await writeReceipt(m,await store(f.index,m));return {state:'completed'};}});
  await f.service.background.start(target,'once');await settled(f.service);
  const task=f.service.background.list()[0]!;
  assert.equal(task.state,'blocked');assert.equal(task.processed,10);assert.equal(task.total,13);assert.equal(runs,1);
  assert.deepEqual(task.receiptIssues,['MEMORY_RECEIPT_INDEX_PROVENANCE','MEMORY_RECEIPT_ALREADY_PRESENT_MISMATCH']);
  await f.service.sync();assert.equal(runs,1);assert.equal((await f.service.status()).pendingClaude,3);
  await f.service.dispose();const restarted=new NativeMemoryService(f.data,f.options);await restarted.initialize();t.after(()=>restarted.dispose());
  assert.equal(restarted.background.list()[0]!.processed,10);assert.deepEqual(restarted.background.list()[0]!.receiptIssues,task.receiptIssues);
  assert.equal(restarted.background.busy(),false);
});

test('verification is runtime/session bound, closes on finish and disable, and identifies missing receipts',async t=>{
  const f=await fixture(t,1),session=f.service.session('claude','bound');await session.prepare('Task','one');
  await assert.rejects(f.service.verifyHandoff('codex','bound'),/INACTIVE/);await assert.rejects(f.service.verifyHandoff('claude','other'),/INACTIVE/);
  assert.equal((await f.service.verifyHandoff('claude','bound')).entries[0]!.code,'MEMORY_RECEIPT_MISSING');
  await session.finish();await assert.rejects(f.service.verifyHandoff('claude','bound'),/INACTIVE/);
  await session.prepare('Task','two');await f.service.configure({enabled:false});await assert.rejects(f.service.verifyHandoff('claude','bound'),/INACTIVE/);
  assert.equal((await f.service.status()).acknowledgedCount,0);
});

test('wrong tokens, malformed JSON, duplicate and unissued identities invalidate the entire receipt envelope',async t=>{
  const f=await fixture(t),session=f.service.session('claude','bound'),m=manifest(await session.prepare('Task','one')),rows=await store(f.index,m,false);
  const base={deliveryId:m.deliveryId,token:m.token,recipientRuntime:m.recipientRuntime,entries:rows};
  for(const bad of ['{bad',JSON.stringify({...base,token:'wrong'}),JSON.stringify({...base,recipientRuntime:'codex'}),JSON.stringify({...base,entries:[rows[0],rows[0]]}),JSON.stringify({...base,entries:[rows[0],{...rows[1],archiveId:'0'.repeat(64)}]})]){
    await put(m.receiptFile,bad);const result=await f.service.verifyHandoff('claude','bound');assert.equal(result.verified,0);assert.equal(result.complete,false);
    assert.ok(result.entries.every(e=>['MEMORY_RECEIPT_INVALID','MEMORY_RECEIPT_ENTRY_INVALID'].includes(e.code!)));
  }
});

test('wrong hash, wrong scope and missing rows remain pending without blocking independent valid evidence',async t=>{
  const f=await fixture(t,4),session=f.service.session('claude','bound'),m=manifest(await session.prepare('Task','one')),rows=await store(f.index,m,false);
  rows[1]!.files[0]!.sha256='0'.repeat(64);rows[2]!.scope='wrong';
  await writeReceipt(m,rows.slice(0,3));const result=await f.service.verifyHandoff('claude','bound');
  assert.equal(result.verified,1);assert.deepEqual(result.entries.map(e=>e.code),[undefined,'MEMORY_RECEIPT_HASH_MISMATCH','MEMORY_RECEIPT_ENTRY_INVALID','MEMORY_RECEIPT_ENTRY_MISSING']);
});

test('source revisions are not acknowledged by stale receipts during active verification',async t=>{
  const f=await fixture(t,1),session=f.service.session('claude','bound'),m=manifest(await session.prepare('Task','one')),rows=await store(f.index,m,false);
  await put(path.join(f.options.codexHome,'memories','source-0.md'),'New source revision.');
  await writeReceipt(m,rows);const result=await f.service.verifyHandoff('claude','bound');
  assert.equal(result.complete,false);assert.equal(result.verified,0);assert.equal(result.entries[0]!.state,'superseded');assert.equal(result.entries[0]!.code,'MEMORY_RECEIPT_SOURCE_CHANGED');
});

test('bound verification does not acknowledge a different runtime active batch',async t=>{
  const f=await fixture(t,1);
  await put(path.join(path.dirname(f.index),'claude-origin.md'),'Independent Claude source.');await f.service.sync();
  const claude=f.service.session('claude','claude-bound'),codex=f.service.session('codex','codex-bound');
  const a=manifest(await claude.prepare('Task','claude')),b=manifest(await codex.prepare('Task','codex'));
  await writeReceipt(a,await store(f.index,a,false));
  await writeReceipt(b,await store(path.join(f.options.codexHome,'memories','MEMORY.md'),b,false));
  assert.equal((await f.service.verifyHandoff('claude','claude-bound')).complete,true);
  assert.equal(f.service.exchange.verifiedCount(b.deliveryId),0);
  assert.equal((await f.service.verifyHandoff('codex','codex-bound')).complete,true);
});
