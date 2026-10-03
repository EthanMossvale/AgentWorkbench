import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {NativeMemoryService} from '../packages/native-memory';
import {BEGIN,END} from '../packages/native-memory/sources';
import {digest} from '../packages/native-resources/files';
import {splitImports,handoffStart,handoffEnd} from '../packages/native-memory/protocol';
import {NativeResources} from '../apps/desktop/host/native-resources';
const put=async(file:string,text:string)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);};
async function fixture(t:TestContext){
  const root=await mkdtemp(path.join(os.tmpdir(),'aw-memory-handoff-')),home=path.join(root,'home'),data=path.join(root,'data'),codexHome=path.join(home,'.codex'),claudeHome=path.join(home,'.claude');
  const options={home,codexHome,claudeHome,intervalMs:60000,machineIdentity:'fixture-device'};
  const service=new NativeMemoryService(data,options);await service.initialize();t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true});});
  return {root,home,data,codexHome,claudeHome,options,service,codex:path.join(codexHome,'memories','MEMORY.md'),claude:path.join(claudeHome,'projects','project-a','memory','MEMORY.md')};
}
function manifest(text:string):any {const start=text.lastIndexOf('\n{'),end=text.lastIndexOf('\n</agent-workbench-memory-handoff>');assert.ok(start>=0&&end>start);return JSON.parse(text.slice(start+1,end));}
async function receipt(m:any,entries:any[]){await put(m.receiptFile,JSON.stringify({deliveryId:m.deliveryId,token:m.token,recipientRuntime:m.recipientRuntime,entries}));}
async function proof(file:string){return {path:file,sha256:digest(await readFile(file,'utf8'))};}
async function store(f:Awaited<ReturnType<typeof fixture>>,m:any,entry=m.entries[0],text='Scoped imported knowledge in English.'){
  const index=m.recipientRuntime==='claude'?f.claude:f.codex,topic=path.join(path.dirname(index),'topic-'+entry.archiveId.slice(0,8)+'.md');
  const marked=(body:string)=>entry.startMarker+'\n'+body+'\n'+entry.endMarker;
  await put(topic,'---\nname: imported-topic\ndescription: Imported knowledge\ntype: reference\n---\n'+marked(text));
  const previous=await readFile(index,'utf8').catch(()=> '');
  await put(index,previous+'\n'+marked('['+entry.scope+']('+path.basename(topic)+')'));
  return {archiveId:entry.archiveId,revision:entry.revision,scope:entry.scope,disposition:'stored',files:[await proof(topic)],index:await proof(index)};
}
test('first import is explicit, one selected source baselines the other, no native projection writes',async t=>{
  const f=await fixture(t);await put(f.codex,'Existing Codex memory');await put(f.claude,'Existing Claude memory');
  await f.service.configure({enabled:true});assert.equal((await f.service.status()).needsInitialImport,true);assert.equal((await f.service.status()).pendingClaude,0);
  await f.service.configure({enabled:true,initialSources:'codex'});let s=await f.service.status();assert.equal(s.pendingClaude,1);assert.equal(s.pendingCodex,0);assert.equal(s.lastSync,undefined);assert.ok(s.lastCapture);
  await f.service.sync();assert.equal((await f.service.status()).pendingCodex,0);
  await put(f.claude,'New Claude addition');await f.service.sync();assert.equal((await f.service.status()).pendingCodex,1);
  assert.equal(await readFile(f.codex,'utf8'),'Existing Codex memory');await assert.rejects(readFile(path.join(f.claudeHome,'CLAUDE.md')));
  await assert.rejects(f.service.configure({enabled:true,initialSources:'both'}),/already/);
});

test('catalog preserves verified history and provenance after native body, marker and file changes across restart',async t=>{
  const f=await fixture(t);await put(f.codex,'# Original source\nKeep this evidence.');await f.service.configure({enabled:true,initialSources:'codex'});
  let catalog=await f.service.catalog();assert.equal(catalog.archives[0]!.status,'pending');assert.equal(catalog.archives[0]!.name,'Original source');
  const session=f.service.session('claude','catalog'),m=manifest(await session.prepare('Task','one')),row=await store(f,m),id=m.entries[0].archiveId;
  assert.equal((await f.service.catalog()).archives[0]!.status,'receiving');
  assert.equal((await f.service.catalog()).native.find(e=>e.provider==='claude')!.provenance.length,0);
  await receipt(m,[row]);await session.finish();
  catalog=await f.service.catalog();const original=catalog.archives.find(e=>e.id===id)!;
  assert.equal(original.status,'received');assert.equal(original.currentState,'unchanged');assert.equal(original.destinationMemoryIds.length,2);
  assert.ok(catalog.native.filter(e=>e.provider==='claude').every(e=>e.provenance[0]?.origin==='codex'));
  const topic=row.files[0]!.path,marked=await readFile(topic,'utf8');await put(topic,marked.replace('Scoped imported knowledge','Later edited knowledge'));await f.service.sync();
  assert.equal((await f.service.catalog()).archives.find(e=>e.id===id)!.currentState,'changed');
  await put(topic,'Agent rewrote the file and removed every source marker.');await f.service.sync();
  catalog=await f.service.catalog();assert.equal(catalog.archives.find(e=>e.id===id)!.status,'received');
  assert.equal(catalog.native.find(e=>e.relative.endsWith(path.basename(topic)))!.provenance[0]!.archiveId,id);
  await rm(topic);await rm(f.claude);await f.service.sync();await f.service.dispose();
  const restarted=new NativeMemoryService(f.data,f.options);await restarted.initialize();t.after(()=>restarted.dispose());
  const historical=(await restarted.catalog()).archives.find(e=>e.id===id)!;
  assert.equal(historical.status,'received');assert.equal(historical.acknowledgedAt,original.acknowledgedAt);assert.equal(historical.currentState,'unavailable');
  assert.equal((await restarted.readArchive(id)).content,'# Original source\nKeep this evidence.');assert.equal((await restarted.status()).pendingClaude,0);
});

test('catalog retains superseded revisions and withdrawal evidence without exposing archive mutation',async t=>{
  const f=await fixture(t);await put(f.codex,'Revision one');await f.service.configure({enabled:true,initialSources:'codex'});
  const first=(await f.service.catalog()).archives[0]!;await put(f.codex,'Revision two');await f.service.sync();await rm(f.codex);await f.service.sync();
  const catalog=await f.service.catalog();assert.deepEqual(catalog.archives.map(e=>[e.revision,e.operation,e.status]),[[3,'withdraw','pending'],[2,'upsert','superseded'],[1,'upsert','superseded']]);
  const withdrawal=await f.service.readArchive(catalog.archives[0]!.id);assert.equal(withdrawal.content,'Revision two');assert.equal(withdrawal.contentRevision,2);
  assert.equal((await f.service.readArchive(first.id)).content,'Revision one');
  await assert.rejects(f.service.change(first.id,'x','Overwrite archive'),/no longer exists/);await assert.rejects(f.service.readArchive('../ledger.json'),/no longer exists/);
  await put(path.join(f.data,'memory-exchange','archives',first.id+'.md'),'Tampered source');await assert.rejects(f.service.readArchive(first.id),/evidence changed/);
  assert.equal((await f.service.catalog()).archives.length,3);
});

test('already-present receipts retain file provenance after native edits without marker dependence',async t=>{
  const f=await fixture(t);await put(f.codex,'Existing English fact');await put(f.claude,'Existing English fact');await f.service.configure({enabled:true,initialSources:'codex'});
  const session=f.service.session('claude','dedup'),m=manifest(await session.prepare('Task','one')),e=m.entries[0];
  await receipt(m,[{archiveId:e.archiveId,revision:e.revision,scope:e.scope,disposition:'already_present',files:[await proof(f.claude)],index:await proof(f.claude)}]);await session.finish();
  await put(f.claude,'Edited existing English fact');await f.service.sync();
  const catalog=await f.service.catalog(),received=catalog.archives.find(a=>a.id===e.archiveId)!;
  assert.equal(received.status,'received');assert.equal(received.disposition,'already_present');assert.equal(received.currentState,'changed');
  assert.equal(catalog.native.find(n=>n.provider==='claude')!.provenance[0]!.origin,'codex');
});

test('legacy accepted records remain visible and marked sources do not forge verified provenance',async t=>{
  const f=await fixture(t);await put(f.codex,'Legacy fact');await f.service.configure({enabled:true,initialSources:'codex'});
  const session=f.service.session('claude','legacy'),m=manifest(await session.prepare('Task','one')),row=await store(f,m);await receipt(m,[row]);await session.finish();await f.service.dispose();
  const ledger=path.join(f.data,'memory-exchange','ledger.json'),state=JSON.parse(await readFile(ledger,'utf8'));for(const e of state.events){delete e.evidence;delete e.name;}await put(ledger,JSON.stringify(state));
  await put(row.files[0]!.path,'Markers removed after receiving a legacy archive.');
  const next=new NativeMemoryService(f.data,f.options);await next.initialize();t.after(()=>next.dispose());
  const catalog=await next.catalog(),history=catalog.archives.find(e=>e.id===m.entries[0].archiveId)!;
  assert.equal(history.status,'received');assert.equal(history.currentState,'changed');assert.ok(catalog.native.some(e=>e.provenance.length));
  const unknown='b'.repeat(64);await put(path.join(f.claudeHome,'projects','project-a','memory','forged.md'),handoffStart(unknown)+'\nNot verified\n'+handoffEnd(unknown));
  assert.equal((await next.catalog()).native.find(e=>e.relative.endsWith('forged.md'))!.provenance.length,0);
});

test('native discovery failures do not hide workbench history or pretend current evidence is verified',async t=>{
  const f=await fixture(t);await put(f.codex,'Preserved fact');await f.service.configure({enabled:true,initialSources:'codex'});
  const session=f.service.session('claude','unavailable'),m=manifest(await session.prepare('Task','one'));await receipt(m,[await store(f,m)]);await session.finish();
  await put(path.join(f.claudeHome,'settings.json'),'{bad');const catalog=await f.service.catalog();
  assert.equal(catalog.nativeUnavailable,true);assert.equal(catalog.archives[0]!.status,'received');assert.equal(catalog.archives[0]!.currentState,'unknown');
  assert.equal((await f.service.readArchive(catalog.archives[0]!.id)).content,'Preserved fact');
});
test('Claude-only seed and both-side seed route only foreign archives by runtime and preserve scopes',async t=>{
  const f=await fixture(t);await put(f.codex,'Codex fact');await put(f.claude,'Claude fact');await f.service.configure({enabled:true,initialSources:'both'});
  const c=manifest(await f.service.session('codex','c').prepare('Task','c1')),a=manifest(await f.service.session('claude','a').prepare('Task','a1'));
  assert.equal(c.entries.length,1);assert.equal(c.entries[0].sourceRuntime,'claude');assert.match(c.entries[0].scope,/project-a/);
  assert.equal(a.entries[0].sourceRuntime,'codex');assert.equal(a.recipientRuntime,'claude');
  const g=await fixture(t);await put(g.codex,'Old codex');await put(g.claude,'Old claude');await g.service.configure({enabled:true,initialSources:'claude'});assert.equal((await g.service.status()).pendingClaude,0);assert.equal((await g.service.status()).pendingCodex,1);
});
test('pending handoff carries English format and dedup guidance; a verified receipt removes reminders',async t=>{
  const f=await fixture(t);await put(f.codex,'Original memory');await f.service.configure({enabled:true,initialSources:'codex'});
  const session=f.service.session('claude','s'),input=await session.prepare('User task','one'),m=manifest(input);
  assert.match(input,/short MEMORY.md index/);assert.match(input,/200 lines/);assert.match(input,/Write all new memory prose.*English/);assert.match(input,/Always deduplicate/);assert.match(input,/model name, vendor, API URL/);
  const row=await store(f,m);await f.service.sync();assert.equal((await f.service.status()).pendingCodex,0);assert.equal((await f.service.status()).acknowledgedCount,0);
  await receipt(m,[row]);await session.finish();const s=await f.service.status();assert.equal(s.pendingClaude,0);assert.equal(s.pendingCodex,0);assert.equal(s.acknowledgedCount,1);assert.ok(s.lastSync);
  assert.equal(await session.prepare('Next task','two'),'Next task');assert.match(await readFile(row.files[0]!.path,'utf8'),/Scoped imported knowledge/);
  assert.equal((await f.service.createSnapshot({sessionId:'s'})).items.length,0);
});
test('both initial uploads deduplicate unchanged native knowledge with verifiable evidence',async t=>{
  const f=await fixture(t);await put(f.codex,'Shared English fact');await put(f.claude,'Shared English fact');await f.service.configure({enabled:true,initialSources:'both'});
  for(const target of ['codex','claude'] as const){
    const session=f.service.session(target,target),m=manifest(await session.prepare('Task','seed')),e=m.entries[0],file=target==='codex'?f.codex:f.claude;
    await receipt(m,[{archiveId:e.archiveId,revision:e.revision,scope:e.scope,disposition:'already_present',files:[await proof(file)],index:await proof(file)}]);await session.finish();
  }
  const s=await f.service.status();assert.equal(s.acknowledgedCount,2);assert.equal(s.pendingCodex+s.pendingClaude,0);
  assert.equal(await readFile(f.codex,'utf8'),'Shared English fact');assert.equal(await readFile(f.claude,'utf8'),'Shared English fact');
});
test('Codex plain-path native registry references are accepted without imposing Claude link syntax',async t=>{
  const f=await fixture(t);await put(f.claude,'English source fact');await f.service.configure({enabled:true,initialSources:'claude'});
  const session=f.service.session('codex','c'),input=await session.prepare('Task','one'),m=manifest(input),e=m.entries[0],topic=path.join(f.codexHome,'memories','rollout_summaries','native.md');
  assert.match(input,/Never blindly overwrite|never blindly overwrite/);await put(topic,e.startMarker+'\nScoped English fact\n'+e.endMarker);
  await put(f.codex,e.startMarker+'\n### rollout_summary_files\n- rollout_summaries/native.md (source scope retained)\n'+e.endMarker);
  await receipt(m,[{archiveId:e.archiveId,revision:e.revision,scope:e.scope,disposition:'stored',files:[await proof(topic)],index:await proof(f.codex)}]);await session.finish();assert.equal((await f.service.status()).pendingCodex,0);
});
test('semantic duplicates need a stored native reference, false claims and index overflow are rejected',async t=>{
  const f=await fixture(t);await put(f.codex,'Source fact');await put(f.claude,'Other wording');await f.service.configure({enabled:true,initialSources:'codex'});
  const session=f.service.session('claude','s'),m=manifest(await session.prepare('Task','one')),e=m.entries[0];
  await receipt(m,[{archiveId:e.archiveId,revision:e.revision,scope:e.scope,disposition:'already_present',files:[await proof(f.claude)],index:await proof(f.claude)}]);await f.service.sync();assert.equal((await f.service.status()).acknowledgedCount,0);assert.match((await f.service.status()).handoffError!,/semantic/);
  const row=await store(f,m,e,'This archive repeats the existing scoped knowledge in the native index.');await put(f.claude,'\n'.repeat(201)+await readFile(f.claude,'utf8'));row.index=await proof(f.claude);await receipt(m,[row]);await f.service.sync();assert.equal((await f.service.status()).acknowledgedCount,0);
  await put(f.claude,(await readFile(f.claude,'utf8')).trim());row.index=await proof(f.claude);await receipt(m,[row]);await session.finish();assert.equal((await f.service.status()).acknowledgedCount,1);
});
test('hash mismatch, wrong runtime, forged paths and scope cannot stamp an import',async t=>{
  const f=await fixture(t);await put(f.codex,'Fact');await f.service.configure({enabled:true,initialSources:'codex'});const m=manifest(await f.service.session('claude','s').prepare('Task','1')),row=await store(f,m);
  const variants=[{...row,scope:'forged'},{...row,files:[{...row.files[0],sha256:'0'.repeat(64)}]},{...row,files:[{path:f.codex,sha256:digest('Fact')}]}];
  for(const value of variants){await receipt(m,[value]);await f.service.sync();assert.equal((await f.service.status()).acknowledgedCount,0);}
  await put(m.receiptFile,JSON.stringify({deliveryId:m.deliveryId,token:m.token,recipientRuntime:'codex',entries:[row]}));await f.service.sync();assert.equal((await f.service.status()).acknowledgedCount,0);
  await receipt(m,[row]);await f.service.sync();assert.equal((await f.service.status()).acknowledgedCount,1);
});
test('source revisions, partial receipts, restart and stale receipts remain retryable without extra model tasks',async t=>{
  const f=await fixture(t);await put(f.codex,'Revision one');await put(path.join(f.codexHome,'memories','other.md'),'Other fact');await f.service.configure({enabled:true,initialSources:'codex'});
  let session=f.service.session('claude','s'),m=manifest(await session.prepare('Task','one'));assert.equal(m.entries.length,2);
  const e=m.entries.find((e:any)=>e.originalPath===f.codex),row=await store(f,m,e);await receipt(m,[row]);await session.finish();assert.equal((await f.service.status()).pendingClaude,1);
  await put(f.codex,'Revision two');await f.service.sync();assert.equal((await f.service.status()).pendingClaude,2);
  await f.service.dispose();const restart=new NativeMemoryService(f.data,f.options);await restart.initialize();t.after(()=>restart.dispose());
  session=restart.session('claude','new');m=manifest(await session.prepare('New explicit task','two'));assert.equal(m.entries.find((e:any)=>e.originalPath===f.codex).revision,2);
  await session.finish();assert.equal((await restart.status()).pendingClaude,2);
});
test('one active claim per runtime, read-only and disabled execution do not import',async t=>{
  const f=await fixture(t);await put(f.codex,'Fact');await f.service.configure({enabled:true,initialSources:'both'});
  const first=f.service.session('claude','first'),other=f.service.session('claude','other');
  assert.equal(await first.prepare('Read task','r','read-only'),'Read task');
  assert.match(await first.prepare('Task','1'),/handoff/);assert.equal(await other.prepare('Other task','2'),'Other task');
  await first.finish();assert.match(await other.prepare('Retry explicitly','3'),/handoff/);await f.service.configure({enabled:false});await other.finish();
  assert.equal(await first.prepare('Off','4'),'Off');await f.service.configure({enabled:true});assert.match(await first.prepare('Enabled again','5'),/handoff/);
});
test('imported spans do not echo but later native corrections and independent additions do',async t=>{
  const f=await fixture(t);await put(f.codex,'Original');await f.service.configure({enabled:true,initialSources:'codex'});
  const session=f.service.session('claude','s'),m=manifest(await session.prepare('Task','one')),row=await store(f,m);await receipt(m,[row]);await session.finish();
  const topic=row.files[0]!.path;await put(topic,(await readFile(topic,'utf8')).replace('Scoped imported knowledge','Corrected native knowledge'));await f.service.sync();assert.equal((await f.service.status()).pendingCodex,1);
  await put(topic,(await readFile(topic,'utf8'))+'\nIndependent new learning.');await f.service.sync();const next=manifest(await f.service.session('codex','c').prepare('Task','two'));const content=await readFile(next.entries[0].archiveFile,'utf8');assert.match(content,/Corrected native knowledge/);assert.match(content,/Independent new learning/);
  await put(topic,'Markers removed by native rewrite.');await f.service.sync();assert.match((await f.service.status()).handoffError!,/markers/);assert.equal(await readFile(topic,'utf8'),'Markers removed by native rewrite.');
});
test('source deletion sends a scoped withdrawal without deleting recipient originals',async t=>{
  const f=await fixture(t);await put(f.codex,'Fact');await put(f.claude,'Independent recipient memory');await f.service.configure({enabled:true,initialSources:'codex'});
  await rm(f.codex);await f.service.sync();const m=manifest(await f.service.session('claude','s').prepare('Task','one'));
  assert.equal(m.entries[0].operation,'withdraw');assert.equal(m.entries[0].archiveFile,undefined);assert.equal(await readFile(f.claude,'utf8'),'Independent recipient memory');
});
test('device binding rejects copied journals, malformed state and archive tampering fail closed',async t=>{
  const f=await fixture(t);await put(f.codex,'Fact');await f.service.configure({enabled:true,initialSources:'codex'});await f.service.dispose();
  await assert.rejects(new NativeMemoryService(f.data,{...f.options,machineIdentity:'another-device'}).initialize(),/another device/);
  const ledger=JSON.parse(await readFile(path.join(f.data,'memory-exchange','ledger.json'),'utf8'));await put(path.join(f.data,'memory-exchange','archives',ledger.events[0].id+'.md'),'Tampered');
  const next=new NativeMemoryService(f.data,f.options);await next.initialize();t.after(()=>next.dispose());assert.equal(await next.session('claude','s').prepare('Task','one'),'Task');assert.match((await next.status()).lastError!,/archive changed/);
});
test('migration removes only hash-owned old projection links and preserves edited copies',async t=>{
  const f=await fixture(t);await f.service.dispose();
  const block=BEGIN+'\nOld link\n'+END,global=path.join(f.claudeHome,'CLAUDE.md'),copy=path.join(f.claudeHome,'workbench-sync','topic.md');
  await put(global,block+'\nUser text');await put(copy,'Old owned copy');
  await put(path.join(f.data,'native-memory.json'),JSON.stringify({version:2,enabled:true,files:{[global+'#block']:digest(block),[copy]:digest('Old owned copy')},pending:{}}));
  const next=new NativeMemoryService(f.data,f.options);await next.initialize();t.after(()=>next.dispose());
  assert.equal(await readFile(global,'utf8'),'User text');await assert.rejects(readFile(copy));assert.equal((await next.status()).needsInitialImport,true);
  const g=await fixture(t);await g.service.dispose();const edited=path.join(g.claudeHome,'workbench-sync','topic.md');await put(edited,'Edited original');
  await put(path.join(g.data,'native-memory.json'),JSON.stringify({version:2,enabled:true,files:{[edited]:digest('Old owned copy')},pending:{}}));
  const other=new NativeMemoryService(g.data,g.options);await other.initialize();t.after(()=>other.dispose());assert.match((await other.status()).lastError!,/conflict/);assert.equal(await readFile(edited,'utf8'),'Edited original');
});
test('original manager keeps CAS protection, effective instructions and captures writes after re-enabling',async t=>{
  const f=await fixture(t),file=path.join(f.codexHome,'AGENTS.override.md');await put(file,'Effective instructions');await put(path.join(f.codexHome,'AGENTS.md'),'Dormant');
  await f.service.configure({enabled:true,initialSources:'both'});const entry=(await f.service.list())[0]!;
  await put(file,'Concurrent edit');await assert.rejects(f.service.change(entry.id,entry.revision,'Stale'),/changed/);
  await f.service.configure({enabled:false});const current=await f.service.read(entry.id);await f.service.change(entry.id,current.revision,'English memory');await f.service.configure({enabled:true});
  assert.equal((await f.service.status()).pendingClaude,1);const saved=await f.service.read(entry.id);await assert.rejects(f.service.change(entry.id,saved.revision,BEGIN+'\nx\n'+END),/markers/);await f.service.change(entry.id,saved.revision,null);
  assert.equal(await readFile(file,'utf8'),'');assert.equal(await readFile(path.join(f.codexHome,'AGENTS.md'),'utf8'),'Dormant');
});
test('custom memory discovery and settings errors preserve existing native stores',async t=>{
  const f=await fixture(t),custom=path.join(f.home,'custom');await put(path.join(custom,'MEMORY.md'),'Custom native memory');await put(path.join(f.claudeHome,'settings.json'),JSON.stringify({autoMemoryDirectory:custom}));
  await put(path.join(f.home,'.local/bin/codex.exe'),'discovery-only fixture');await put(path.join(f.home,'.local/bin/claude.exe'),'discovery-only fixture');
  const host=new NativeResources(f.data+'-host',{openZip:async()=>null,saveZip:async()=>null},()=>[],()=>{},f.home,{cliOptions:{executables:{codex:path.join(f.home,'.local/bin/codex.exe'),claude:path.join(f.home,'.local/bin/claude.exe')}}});await host.initialize();t.after(()=>host.dispose());
  await assert.rejects(host.call('native-memory/configure',{enabled:true,codexRoot:'x'}),/automatic/);await host.call('native-memory/configure',{enabled:true,initialSources:'claude'});assert.equal((await host.memory.status()).pendingCodex,1);
  await put(path.join(f.claudeHome,'settings.json'),'{bad');await assert.rejects(host.memory.sync(),/settings/);assert.equal(await readFile(path.join(custom,'MEMORY.md'),'utf8'),'Custom native memory');
});
test('linked native memory roots remain usable while malformed provenance is rejected',async t=>{
  const f=await fixture(t);const outside=path.join(f.root,'outside');await mkdir(outside);await mkdir(f.home,{recursive:true});await symlink(outside,f.claudeHome,'junction');
  await f.service.configure({enabled:true,initialSources:'both'});
  const id='a'.repeat(64);assert.throws(()=>splitImports(handoffStart(id)+'missing end'),/Invalid/);assert.throws(()=>splitImports(handoffStart(id)+handoffStart(id)+handoffEnd(id)+handoffEnd(id)),/Nested/);
});
