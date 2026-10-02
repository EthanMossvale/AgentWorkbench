import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp,symlink} from 'node:fs/promises';
import {NativeMemoryService} from '../packages/native-memory';
import {prepareAppData} from '../packages/app-data';
import {relocateAppData,completeRelocation} from '../packages/app-data/relocation';
import {digest} from '../packages/native-resources/files';

const put=async(file:string,text:string)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);};
const load=async(file:string)=>JSON.parse(await readFile(file,'utf8'));
const manifest=(task:string)=>JSON.parse(task.slice(task.lastIndexOf('\n{')+1,task.lastIndexOf('\n</agent-workbench-memory-handoff>')));
async function fixture(t:TestContext){
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-memory-migration-')),home=path.join(root,'home'),legacy=path.join(root,'old-profile');
  const options={home,codexHome:path.join(home,'.codex'),claudeHome:path.join(home,'.claude'),machineIdentity:'fixture-device',intervalMs:60000};
  const services:NativeMemoryService[]=[];
  t.after(async()=>{for(const service of services)await service.dispose();await rm(root,{recursive:true,force:true});});
  const open=async(directory:string)=>{const service=new NativeMemoryService(directory,options);services.push(service);await service.initialize();return service;};
  const service=await open(legacy),source=path.join(options.codexHome,'memories','MEMORY.md');
  await put(source,'# Migration fixture\nPreserve this scoped knowledge.');await service.configure({enabled:true,initialSources:'codex'});
  const session=service.session('claude','fixture-session'),batch=manifest(await session.prepare('Explicit fixture task','fixture-submission'));
  return {root,home,legacy,options,service,session,batch,open,ledger:path.join(legacy,'memory-exchange','ledger.json')};
}
async function nativeReceipt(f:Awaited<ReturnType<typeof fixture>>){
  const e=f.batch.entries[0],directory=path.join(f.options.claudeHome,'projects','fixture','memory'),topic=path.join(directory,'topic.md'),index=path.join(directory,'MEMORY.md');
  const marked=(text:string)=>`${e.startMarker}\n${text}\n${e.endMarker}`;
  await put(topic,marked(`[${e.scope}] Preserve this scoped knowledge.`));await put(index,marked(`[${e.scope}](topic.md)`));
  const proof=async(file:string)=>({path:file,sha256:digest(await readFile(file,'utf8'))});
  await put(f.batch.receiptFile,JSON.stringify({deliveryId:f.batch.deliveryId,token:f.batch.token,recipientRuntime:'claude',entries:[{archiveId:e.archiveId,revision:e.revision,scope:e.scope,disposition:'stored',files:[await proof(topic)],index:await proof(index)}]}));
}

for(const state of ['pending','unverified','acknowledged','disabled'] as const){
  test(`profile migration preserves ${state} memory deliveries and survives restart`,async t=>{
    const f=await fixture(t);
    if(state==='unverified'||state==='acknowledged')await nativeReceipt(f);
    if(state==='acknowledged')await f.session.finish();
    if(state==='disabled')await f.service.configure({enabled:false});
    await f.service.dispose();const before=await load(f.ledger);
    const location=prepareAppData(f.home,f.legacy),ledger=path.join(location.directory,'memory-exchange','ledger.json');
    assert.equal(location.migrated,true);const restarted=await f.open(location.directory),after=await load(ledger);
    assert.equal(after.deviceId,before.deviceId);assert.equal(after.deliveries.length,before.deliveries.length);
    assert.deepEqual(after.deliveries,before.deliveries.map((d:any)=>({...d,receipt:path.join(location.directory,'memory-exchange','receipts',`${d.id}.json`)})));
    const status=await restarted.status();assert.equal(status.enabled,state!=='disabled');assert.equal(status.pendingClaude,state==='pending'||state==='disabled'?1:0);
    assert.equal(status.acknowledgedCount,state==='unverified'||state==='acknowledged'?1:0);assert.equal(status.activeClaude,0);assert.equal(status.handoffError,undefined);
    assert.equal((await restarted.readArchive(f.batch.entries[0].archiveId)).content,'# Migration fixture\nPreserve this scoped knowledge.');
    if(state==='pending'||state==='disabled')assert.deepEqual(after.events,before.events);
    if(state==='acknowledged')assert.equal(after.events[0].acknowledgedAt,before.events[0].acknowledgedAt);
    await restarted.dispose();const again=await f.open(location.directory);assert.deepEqual(await load(ledger),after);assert.equal((await again.status()).pendingClaude,status.pendingClaude);
    if(state==='pending'){
      const next=manifest(await again.session('claude','next-session').prepare('Next explicit task','next-submission'));
      assert.equal(next.entries[0].archiveId,f.batch.entries[0].archiveId);assert.ok(next.receiptFile.startsWith(location.directory+path.sep));
    }
  });
}

for(const mutation of ['other-root','wrong-name','wrong-token','duplicate-id','unknown-entry','redirected-alias'] as const){
  test(`migration refuses ${mutation} without resetting or rewriting the ledger`,async t=>{
    const f=await fixture(t);await f.service.dispose();const location=prepareAppData(f.home,f.legacy),ledger=path.join(location.directory,'memory-exchange','ledger.json');
    const state=await load(ledger),d=state.deliveries[0];
    if(mutation==='other-root'){
      const other=path.join(f.root,'other-exchange');await cp(path.join(location.directory,'memory-exchange'),other,{recursive:true});d.receipt=path.join(other,'receipts',d.id+'.json');
    }else if(mutation==='wrong-name')d.receipt=path.join(f.legacy,'memory-exchange','receipts','wrong.json');
    else if(mutation==='wrong-token')d.token='invalid';
    else if(mutation==='duplicate-id')state.deliveries.push({...d});
    else if(mutation==='unknown-entry')d.entries=[digest('missing archive')];
    else {
      const unrelated=path.join(f.root,'unrelated');await mkdir(path.join(unrelated,'memory-exchange'),{recursive:true});
      await rm(f.legacy);await symlink(unrelated,f.legacy,process.platform==='win32'?'junction':'dir');
    }
    await put(ledger,JSON.stringify(state));const before=await readFile(ledger);
    await assert.rejects(f.open(location.directory),/invalid delivery/);assert.deepEqual(await readFile(ledger),before);
  });
}

for(const acknowledged of [false,true])test(`consecutive installed profile moves preserve ${acknowledged?'acknowledged':'pending'} receipt ownership`,async t=>{
  const f=await fixture(t);if(acknowledged){await nativeReceipt(f);await f.session.finish();}await f.service.dispose();
  const before=await load(f.ledger),archive=path.join('memory-exchange','archives',f.batch.entries[0].archiveId+'.md'),archiveBefore=await readFile(path.join(f.legacy,archive));
  let source=f.legacy;
  for(const name of ['installed-profile','short-profile']){
    const target=path.join(f.root,name);relocateAppData(source,target);completeRelocation(target);
    const service=await f.open(target),after=await load(path.join(target,'memory-exchange','ledger.json'));
    assert.deepEqual(after.events,before.events);assert.equal(after.deliveries[0].receipt,path.join(target,'memory-exchange','receipts',f.batch.deliveryId+'.json'));
    assert.deepEqual(await readFile(path.join(target,archive)),archiveBefore);assert.equal((await service.status()).acknowledgedCount,acknowledged?1:0);
    await service.dispose();source=target;
  }
});

test('unmapped historical receipts stop a move before the source is retired',async t=>{
  const f=await fixture(t);await f.service.dispose();const state=await load(f.ledger);
  state.deliveries[0].receipt=path.join(f.root,'already-removed-profile','memory-exchange','receipts',f.batch.deliveryId+'.json');
  await put(f.ledger,JSON.stringify(state));const before=await readFile(f.ledger),target=path.join(f.root,'next-profile');
  assert.throws(()=>relocateAppData(f.legacy,target),error=>error instanceof Error&&error.message==='APP_DATA_MIGRATION_FAILED'&&(error.cause as Error)?.message==='APP_DATA_MEMORY_RECEIPT_UNMAPPED');
  assert.deepEqual(await readFile(f.ledger),before);await assert.rejects(readFile(path.join(target,'memory-exchange','ledger.json')),/ENOENT/);
});
