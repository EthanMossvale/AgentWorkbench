import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {NativeMemoryService} from '../packages/native-memory';
import {defaultMemoryTarget,rememberMemoryDefault} from '../packages/native-memory/default-target';
import {consolidationDestination,storeConsolidatedReference} from '../packages/native-memory/consolidation';
import {MemoryBackgroundTasks,type MemoryTaskBinding,type MemoryTaskExecution} from '../packages/native-memory/background';
import type {AppState} from '../packages/contracts';
import type {ModelTarget} from '../packages/model-api/types';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import {memoryMaintenanceProcess} from '../apps/desktop/host/memory-background';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {NativeResources} from '../apps/desktop/host/native-resources';
import {SharedMemoryStore} from '../packages/memory-core';
import {SharedSkillsStore} from '../packages/skills-core';

const put=async(file:string,text:string)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);};
const target:MemoryTaskBinding={binding:{runtime:'codex',provider:'fixture',accountRef:'fixture',executionId:'local',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'mapping'},modelSelection:{model:'default-model',effort:'high'},permissionMode:'full-access'};
const recipient=(runtime:'codex'|'claude'):MemoryTaskBinding=>({...target,binding:{...target.binding,runtime}});
const settled=async(service:NativeMemoryService)=>{const end=Date.now()+90000;while(service.background.busy()&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.equal(service.background.busy(),false);};
async function fixture(t:TestContext,codex=2,claude=1){
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-consolidation-')),home=path.join(root,'home'),directory=path.join(root,'data');
  const homes={home,codex:path.join(home,'.codex'),claude:path.join(home,'.claude'),projects:[]};
  const options={home,codexHome:homes.codex,claudeHome:homes.claude,intervalMs:3600000,machineIdentity:'fixture'};
  for(let i=0;i<codex;i++)await put(path.join(homes.codex,'memories',`source-${i}.md`),`Scoped Codex fact ${i}.`);
  for(let i=0;i<claude;i++)await put(path.join(homes.claude,'projects','source-project','memory',`source-${i}.md`),`Scoped Claude fact ${i}.`);
  const service=new NativeMemoryService(directory,options);await service.initialize();await service.configure({enabled:true,initialSources:'both'});
  t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100});});
  return {root,directory,homes,options,service,bg:service.background};
}
async function consolidate(task:MemoryTaskExecution){
  const manifest=await task.read({}) as {recipientRuntime:string;nativeMemories:{runtime:string}[];entries:{archiveId:string;recipientRuntime:string;sourceRuntime:string}[]};assert.ok(task.store);assert.equal(manifest.recipientRuntime,task.target.binding.runtime);assert.ok(manifest.nativeMemories.every(m=>m.runtime===manifest.recipientRuntime));assert.ok(manifest.entries.every(e=>e.recipientRuntime===manifest.recipientRuntime&&e.sourceRuntime!==manifest.recipientRuntime));
  for(let offset=0;offset<manifest.entries.length;offset+=24){
    const entries=[];
    for(const e of manifest.entries.slice(offset,offset+24)){
      const source=await task.read({archiveId:e.archiveId}) as {content:string};
      entries.push({archiveId:e.archiveId,title:'Scoped reference',content:source.content});
    }
    const result=await task.store({entries});assert.ok(result.entries.every(e=>e.state==='verified'),JSON.stringify(result));
  }
  assert.equal((await task.verify()).complete,true);return {state:'completed' as const};
}

test('bounded admission consumes embedded short archives without model read calls and retains the rest',async t=>{
  const f=await fixture(t,1,14);let calls=0;
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async task=>{
    calls++;
    const manifest=JSON.parse(task.prompt.split('<agent-workbench-memory-consolidation>\n')[1]!.split('\n</agent-workbench-memory-consolidation>')[0]!);
    assert.equal(manifest.entries.length,6);assert.equal(manifest.initialArchivePages.length,6);
    assert.ok(manifest.initialArchivePages.every((p:any)=>p.nextOffset===null));
    assert.ok(manifest.initialArchivePages.reduce((n:number,p:any)=>n+p.content.length,0)<=24000);
    const feedback=await task.store!({entries:manifest.initialArchivePages.map((p:any)=>({archiveId:p.archiveId,title:'Scoped reference',content:p.content}))});
    assert.equal(feedback.verified,6);return {state:'completed'};
  }});
  await f.bg.start(target,'bounded',{maxEntries:6});await settled(f.service);
  assert.equal(calls,1);assert.equal(f.bg.list()[0]!.processed,6);
  const status=await f.service.status();assert.equal(status.pendingCodex,8);assert.equal(status.pendingClaude,1);
  await assert.rejects(f.bg.start(target,'invalid',{maxEntries:0}),/ARGUMENT_INVALID/);
});

test('failed later batch retains verified progress and never dispatches another batch',async t=>{
  const f=await fixture(t,0,14);let calls=0;
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async task=>++calls===1?consolidate(task):{state:'failed'}});
  await f.bg.start(target,'partial');await settled(f.service);
  assert.equal(calls,2);assert.equal(f.bg.list()[0]!.state,'failed');assert.equal(f.bg.list()[0]!.processed,6);assert.equal(f.bg.list()[0]!.total,14);
  assert.equal((await f.service.status()).pendingCodex,8);
  assert.equal((await f.bg.start(target,'no-replay',{maxEntries:6})).reason,'MEMORY_BACKGROUND_UNCHANGED');assert.equal(calls,2);
  await f.service.dispose();const restarted=new NativeMemoryService(f.directory,f.options);await restarted.initialize();t.after(()=>restarted.dispose());
  restarted.background.registerExecutor({mode:'consolidation',supports:()=>true,run:async()=>{calls++;return {state:'failed'};}});
  assert.equal((await restarted.background.start(target,'after-restart',{maxEntries:6})).reason,'MEMORY_BACKGROUND_UNCHANGED');assert.equal(calls,2);
});

test('embedded archive pages retain offsets and require remaining content without truncating evidence',async t=>{
  const f=await fixture(t,0,1),content='Scoped evidence. '.repeat(320);
  await put(path.join(f.homes.claude,'projects','source-project','memory','source-0.md'),content);await f.service.sync();
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async task=>{
    const manifest=JSON.parse(task.prompt.split('<agent-workbench-memory-consolidation>\n')[1]!.split('\n</agent-workbench-memory-consolidation>')[0]!);
    const first=manifest.initialArchivePages[0];assert.equal(first.content.length,4000);assert.equal(first.nextOffset,4000);
    const last=await task.read({archiveId:first.archiveId,offset:first.nextOffset}) as any;
    assert.equal(first.content+last.content,content);assert.equal(last.nextOffset,null);
    await task.store!({entries:[{archiveId:first.archiveId,title:'Scoped reference',content:first.content+last.content}]});return {state:'completed'};
  }});
  await f.bg.start(target,'long-page',{maxEntries:6});await settled(f.service);assert.equal(f.bg.list()[0]!.state,'completed');
});

test('failed initial archive read releases the batch and explicit retry can recover',async t=>{
  const f=await fixture(t,0,1);let calls=0;
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async task=>{calls++;return consolidate(task);}});
  const read=t.mock.method(f.service.exchange,'readActive',async()=>{throw Error('MEMORY_HANDOFF_ARCHIVE_CHANGED');});
  await f.bg.start(target,'broken');await settled(f.service);assert.equal(calls,0);assert.equal(f.bg.list()[0]!.state,'failed');
  read.mock.restore();await f.bg.start(target,'fixed',{retry:true});await settled(f.service);
  assert.equal(calls,1);assert.equal(f.bg.list().at(-1)!.state,'completed');
});

test('bounded receiving-native sessions serially accept frozen backlogs without overwriting generated indexes',async t=>{
  const f=await fixture(t,125,11);let calls=0,active=0,maxActive=0;const sessions=new Set<string>();
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async task=>{calls++;active++;maxActive=Math.max(maxActive,active);sessions.add(task.sessionId);const manifest=await task.read({}) as any;assert.ok(manifest.entries.length<=6);assert.match(task.prompt,/initialArchivePages/);assert.doesNotMatch(task.prompt,/Read the complete manifest with/);try{return await consolidate(task);}finally{active--;}}});
  await f.bg.startReceivers([recipient('codex'),recipient('claude')],'one');await settled(f.service);
  assert.equal(calls,23);assert.equal(sessions.size,23);assert.equal(maxActive,1);assert.deepEqual(f.bg.list().map(t=>[t.runtime,t.recipientRuntime,t.state,t.processed,t.total]),[['codex','codex','completed',11,11],['claude','claude','completed',125,125]]);
  const status=await f.service.status();assert.equal(status.pendingCodex,0);assert.equal(status.pendingClaude,0);
  await f.service.sync();assert.equal((await f.service.status()).pendingCodex,0);assert.equal((await f.service.status()).pendingClaude,0);
  assert.equal(await readFile(path.join(f.homes.codex,'memories','source-0.md'),'utf8'),'Scoped Codex fact 0.');
  await assert.rejects(readFile(path.join(f.homes.codex,'memories','memory_summary.md')));
  const claudeIndex=await readFile(path.join(f.homes.claude,'CLAUDE.md'),'utf8'),codexIndex=await readFile(path.join(f.homes.codex,'AGENTS.md'),'utf8');
  assert.equal((claudeIndex.match(/Imported memory references/g)??[]).length,1);assert.equal((codexIndex.match(/Imported memory references/g)??[]).length,1);
  assert.ok(claudeIndex.length<2000);assert.doesNotMatch(claudeIndex,/Scoped Codex fact/);
  assert.match(await readFile(path.join(f.homes.codex,'memories','received','INDEX.md'),'utf8'),/Claude project: source-project/);assert.match(claudeIndex,/original scope/);
  await f.service.dispose();const restarted=new NativeMemoryService(f.directory,f.options);await restarted.initialize();t.after(()=>restarted.dispose());
  assert.equal((await restarted.status()).pendingClaude,0);assert.equal((await restarted.status()).pendingCodex,0);
});

test('default selection uses the production target identity and effort, never infers a runtime from the model name',()=>{
  const chosen:ModelTarget={id:'api/fixture/mapping/claude',name:'Default',description:'Fixture',runtime:'claude',ready:true,binding:{...target.binding,runtime:'claude'},selection:{model:'default-model',effort:'low'}};
  const state={lastSelectedRuntime:'claude',lastModelTargetId:chosen.id,lastModelSelection:{model:'default-model',effort:'high'},permissionPreferences:{projectless:{claude:'full-access'}}} as unknown as AppState;
  const actual=defaultMemoryTarget(state,[chosen]);assert.equal(actual.binding.runtime,'claude');assert.equal(actual.modelSelection?.effort,'high');assert.equal(actual.permissionMode,'full-access');
  assert.equal(defaultMemoryTarget(state,[chosen],{projectId:null,permissionMode:'read-only'}).permissionMode,'read-only');
  assert.throws(()=>defaultMemoryTarget({...state,lastModelTargetId:'missing'},[chosen]),/DEFAULT_UNAVAILABLE/);
  assert.throws(()=>defaultMemoryTarget(state,[{...chosen,ready:false}]),/DEFAULT_UNAVAILABLE/);
  assert.throws(()=>defaultMemoryTarget({...state,lastModelSelection:{model:'other'}},[chosen]),/DEFAULT_UNAVAILABLE/);
  assert.equal(defaultMemoryTarget({...state,lastSelectedRuntime:'plugin:fixture',lastModelTargetId:'runtime/plugin:fixture'},[{...chosen,id:'runtime/plugin:fixture',runtime:'plugin:fixture',binding:{...chosen.binding,runtime:'plugin:fixture'}}]).binding.runtime,'plugin:fixture');
});

test('each receiving runtime retains its own explicit default without fabricating a counterpart',()=>{
  const codex:ModelTarget={id:'account/codex',name:'Codex',description:'Fixture',runtime:'codex',ready:true,binding:{...target.binding,localAccountId:'codex-account'},selection:{model:'codex-model'}};
  const claude:ModelTarget={id:'account/claude',name:'Claude',description:'Fixture',runtime:'claude',ready:true,binding:{...target.binding,runtime:'claude',localAccountId:'claude-account'},selection:{model:'claude-model'}};
  const state={lastSelectedRuntime:'codex',lastModelTargetId:codex.id,lastModelSelection:{model:'codex-model',effort:'high'}} as unknown as AppState;
  assert.throws(()=>defaultMemoryTarget(state,[codex,claude],undefined,'claude'),/DEFAULT_UNAVAILABLE/);
  rememberMemoryDefault(state);state.lastSelectedRuntime='claude';state.lastModelTargetId=claude.id;state.lastModelSelection={model:'claude-model',effort:'low'};rememberMemoryDefault(state);
  assert.equal(defaultMemoryTarget(state,[codex,claude],undefined,'codex').modelSelection?.effort,'high');
  assert.equal(defaultMemoryTarget(state,[codex,claude],undefined,'claude').modelSelection?.effort,'low');
  assert.throws(()=>defaultMemoryTarget(state,[{...codex,ready:false},claude],undefined,'codex'),/DEFAULT_UNAVAILABLE/);
  assert.equal(defaultMemoryTarget(state,[codex,claude],undefined,'codex').modelSelection?.effort,'high','An unavailable target must not erase its saved choice');
  state.nativeMemoryDefaults!.codex={targetId:claude.id,selection:{model:'claude-model'}};
  assert.throws(()=>defaultMemoryTarget(state,[codex,claude],undefined,'codex'),/DEFAULT_UNAVAILABLE/);
});

test('recipient tools reject opposite native stores and unissued opposite-direction archives before any write',async t=>{
  const f=await fixture(t,1,1),foreign=f.service.exchange.pendingIds('claude')[0]!;let checked=false;
  await assert.rejects(f.service.exchange.prepareConsolidation('fixture','fixture',[],['codex','claude']),/RECIPIENT_REQUIRED/);
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async task=>{
    const m=await task.read({}) as {receiverGuide:string;entries:{archiveId:string}[]};
    assert.match(m.receiverGuide,/Receiving runtime: Codex/);assert.doesNotMatch(task.prompt,/Compare BOTH|Both recipient runtimes/);
    await assert.rejects(task.read({archiveId:foreign}),/NOT_ISSUED/);
    await assert.rejects(task.read({nativePath:path.join(f.homes.claude,'projects','source-project','memory','source-0.md')}),/NATIVE_NOT_FOUND/);
    await assert.rejects(task.store!({entries:[{archiveId:m.entries[0]!.archiveId,title:'Own',content:'Own receiver.'},{archiveId:foreign,title:'Other',content:'Must not write.'}]}),/NOT_ISSUED/);
    await assert.rejects(readFile(path.join(f.homes.codex,'AGENTS.md')));checked=true;return consolidate(task);
  }});
  await f.bg.start(target,'scoped');await settled(f.service);assert.ok(checked);assert.equal(f.bg.list()[0]!.state,'completed');
  const status=await f.service.status();assert.equal(status.pendingCodex,0);assert.equal(status.pendingClaude,1);await assert.rejects(readFile(path.join(f.homes.claude,'CLAUDE.md')));
});

test('serial dispatch freezes both backlogs and a failed first native turn never starts the second',async t=>{
  const f=await fixture(t,1,1);let calls=0;
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async()=>{calls++;return {state:'failed'};}});
  await f.bg.startReceivers([recipient('codex'),recipient('claude')],'fail');await settled(f.service);assert.equal(calls,1);assert.equal(f.bg.list().length,1);
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async task=>{
    calls++;if(task.target.binding.runtime==='codex')await put(path.join(f.homes.codex,'memories','arrived-later.md'),'A later source revision outside this dispatch.');return consolidate(task);
  }});
  await f.bg.startReceivers([recipient('codex'),recipient('claude')],'frozen',{retry:true});await settled(f.service);
  assert.equal(calls,3);assert.equal(f.bg.list().at(-1)!.processed,1);assert.equal((await f.service.status()).pendingClaude,1);
});

test('cancelling a serial receiver dispatch prevents its queued second session and late writes',async t=>{
  const f=await fixture(t);let running:MemoryTaskExecution|undefined,calls=0;
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:task=>{calls++;running=task;return new Promise(resolve=>task.signal.addEventListener('abort',()=>resolve({state:'uncertain'}),{once:true}));}});
  await f.bg.startReceivers([recipient('codex'),recipient('claude')],'cancel');while(!running)await new Promise(r=>setTimeout(r,5));
  assert.equal((await f.bg.start(recipient('claude'),'outside')).reason,'MEMORY_BACKGROUND_BUSY');
  const taskId=f.bg.list().at(-1)!.id;await f.bg.cancel(taskId);await settled(f.service);assert.equal(calls,1);assert.equal(f.bg.list().length,1);
  await assert.rejects(running.read({}));assert.equal((await f.service.status()).acknowledgedCount,0);
});

test('cancelAll during backlog capture cancels the reserved dispatch before any executor starts',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-receiver-cancel-'));let release!:()=>void,entered!:()=>void,calls=0;
  const enteredCapture=new Promise<void>(r=>{entered=r;}),continueCapture=new Promise<void>(r=>{release=r;});
  const bg=new MemoryBackgroundTasks(root,{allowed:async()=>true,pending:async()=>{entered();await continueCapture;return ['a'.repeat(64)];},prepare:async()=>undefined,finish:async()=>0,read:async()=>null});
  await bg.initialize();t.after(async()=>{await bg.dispose();await rm(root,{recursive:true,force:true});});
  bg.registerExecutor({supports:()=>true,run:async()=>{calls++;return {state:'completed'};}});
  const start=bg.startReceivers([recipient('codex'),recipient('claude')],'capture');await enteredCapture;
  const cancel=bg.cancelAll();release();await start;await cancel;assert.equal(calls,0);assert.equal(bg.busy(),false);assert.equal(bg.list().length,0);
});

test('removing a reserved executor during permission inspection cannot start the retired implementation',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-receiver-permission-'));let release!:()=>void,entered!:()=>void,calls=0;
  const enteredCheck=new Promise<void>(r=>{entered=r;}),continueCheck=new Promise<void>(r=>{release=r;});
  const bg=new MemoryBackgroundTasks(root,{allowed:async()=>{entered();await continueCheck;return true;},pending:async()=>['a'.repeat(64)],prepare:async()=>({prompt:'Fixture',deliveryId:'fixture',count:1}),finish:async()=>1,read:async()=>null});
  await bg.initialize();t.after(async()=>{await bg.dispose();await rm(root,{recursive:true,force:true});});
  const unregister=bg.registerExecutor({supports:()=>true,run:async()=>{calls++;return {state:'completed'};}});
  await bg.startReceivers([recipient('codex'),recipient('claude')],'permissions');await enteredCheck;
  unregister();release();while(bg.busy())await new Promise(r=>setTimeout(r,5));assert.equal(calls,0);assert.equal(bg.list().length,0);
});

test('removing a reserved executor cancels the remaining recipient instead of silently falling back',async t=>{
  const f=await fixture(t,1,1);let coreCalls=0,pluginCalls=0,release!:()=>void;
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async task=>{coreCalls++;return consolidate(task);}});
  release=f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async task=>{pluginCalls++;const result=await consolidate(task);release();return result;}});
  await f.bg.startReceivers([recipient('codex'),recipient('claude')],'removed');await settled(f.service);
  assert.equal(pluginCalls,1);assert.equal(coreCalls,0);assert.equal(f.bg.list().length,1);assert.equal((await f.service.status()).pendingClaude,1);
  await f.bg.startReceivers([recipient('claude')],'next-explicit');await settled(f.service);assert.equal(coreCalls,1);
});

test('unchanged failed work is not resubmitted by chats or restart; explicit retry and changed model remain possible',async t=>{
  const f=await fixture(t);let calls=0;
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async()=>{calls++;return {state:'failed'};}});
  await f.bg.start(target,'first');await settled(f.service);
  assert.equal((await f.bg.start(target,'another-chat')).reason,'MEMORY_BACKGROUND_UNCHANGED');assert.equal(calls,1);
  await f.service.dispose();const restarted=new NativeMemoryService(f.directory,f.options);await restarted.initialize();t.after(()=>restarted.dispose());
  restarted.background.registerExecutor({mode:'consolidation',supports:()=>true,run:async()=>{calls++;return {state:'failed'};}});
  assert.equal((await restarted.background.start(target,'after-restart')).reason,'MEMORY_BACKGROUND_UNCHANGED');
  assert.equal((await restarted.background.start(target,'manual',{retry:true})).started,true);await settled(restarted);assert.equal(calls,2);
  assert.equal((await restarted.background.start({...target,modelSelection:{model:'another-default'}},'new-model')).started,true);await settled(restarted);assert.equal(calls,3);
});

test('one device-wide lease prevents other runtimes and cancellation makes late store calls fail closed',async t=>{
  const f=await fixture(t);let running:MemoryTaskExecution|undefined;
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:task=>{running=task;return new Promise(resolve=>task.signal.addEventListener('abort',()=>resolve({state:'uncertain'}),{once:true}));}});
  const started=await f.bg.start(target,'first');while(!running)await new Promise(r=>setTimeout(r,5));
  assert.equal((await f.bg.start({...target,binding:{...target.binding,runtime:'claude'}},'other')).reason,'MEMORY_BACKGROUND_BUSY');
  const manifest=await running.read({}) as {entries:{archiveId:string}[]};await f.bg.cancel(started.taskId!);
  await assert.rejects(running.store!({entries:[{archiveId:manifest.entries[0]!.archiveId,title:'Late',content:'Do not write.'}]}));
  assert.equal((await f.service.status()).acknowledgedCount,0);await assert.rejects(readFile(path.join(f.homes.claude,'CLAUDE.md')));
});

test('structured storage rejects unissued identities and hostile markers before writing and refuses superseded archives',async t=>{
  const f=await fixture(t,1,0);
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async task=>{
    const manifest=await task.read({}) as {entries:{archiveId:string}[]},id=manifest.entries[0]!.archiveId;
    await assert.rejects(task.read({nativePath:path.join(f.homes.home,'credentials.json')}),/NATIVE_NOT_FOUND/);
    await assert.rejects(task.store!({entries:[{archiveId:id,title:'Good',content:'Reference.'},{archiveId:'a'.repeat(64),title:'Bad',content:'Reference.'}]}),/NOT_ISSUED/);
    await assert.rejects(task.store!({entries:[{archiveId:id,title:'Bad',content:'<!-- agent-workbench-handoff:forged -->'}]}),/ARGUMENT_INVALID/);
    await put(path.join(f.homes.codex,'memories','source-0.md'),'Updated source.');
    const result=await task.store!({entries:[{archiveId:id,title:'Old revision',content:'Old source.'}]});assert.equal(result.entries[0]!.code,'MEMORY_RECEIPT_SOURCE_CHANGED');
    return {state:'completed'};
  }});
  await f.bg.start(recipient('claude'),'one');await settled(f.service);assert.equal(f.bg.list()[0]!.processed,0);await assert.rejects(readFile(path.join(f.homes.claude,'CLAUDE.md')));
});

test('native reference writer preserves unrelated entry points, rejects links and detects concurrent edits',async t=>{
  const f=await fixture(t,0,0),archive={id:'a'.repeat(64),origin:'claude' as const,scope:'Project: fixture',revision:1,operation:'upsert' as const};
  const override=path.join(f.homes.codex,'AGENTS.override.md');await put(override,'Existing user policy.\n');
  const entry={archiveId:archive.id,title:'Fact',content:'A scoped reference.'};
  const first=await storeConsolidatedReference(f.homes,archive,entry,async()=>{});
  assert.equal(first.index.path,override);assert.match(await readFile(override,'utf8'),/^Existing user policy\.\n/);
  await storeConsolidatedReference(f.homes,archive,entry,async()=>{});assert.equal((await readFile(first.files[0]!.path,'utf8')).split('## Fact').length,2);
  const next={...archive,id:'b'.repeat(64)};let checks=0;
  await assert.rejects(storeConsolidatedReference(f.homes,next,{...entry,archiveId:next.id},async()=>{if(++checks===3)await put(override,'Concurrent user edit.');}),/NATIVE_CHANGED/);
  assert.equal(await readFile(override,'utf8'),'Concurrent user edit.');
  const destination=await consolidationDestination(f.homes,'claude','Linked project');await mkdir(path.dirname(destination.file),{recursive:true});
  const outside=path.join(f.root,'outside');await mkdir(outside);await rm(path.dirname(destination.file),{recursive:true});await symlink(outside,path.dirname(destination.file),process.platform==='win32'?'junction':'dir');
  await assert.rejects(storeConsolidatedReference(f.homes,{...archive,origin:'codex',scope:'Linked project'},entry,async()=>{}),/Linked/);
});

test('topic directory may exceed 200 lines while generated memory and startup index stay small',async t=>{
  const f=await fixture(t,0,0),generated=path.join(f.homes.claude,'projects','source-project','memory','MEMORY.md');
  const native='Native-generated summary.\n'.repeat(205);await put(generated,native);
  let proof;
  for(let n=0;n<72;n++)proof=await storeConsolidatedReference(f.homes,{id:n.toString(16).padStart(64,'0'),origin:'codex',scope:`Project scope ${n}`,revision:1,operation:'upsert'},{archiveId:n.toString(16).padStart(64,'0'),title:'Scoped detail',content:'This topic retains its original project scope.',topic:'slot'},async()=>{});
  assert.equal(await readFile(generated,'utf8'),native);
  assert.ok((await readFile(proof!.files[1]!.path,'utf8')).split('\n').length>200);
  assert.ok((await readFile(proof!.index.path,'utf8')).split('\n').length<10);
  const archive={id:'f'.repeat(64),origin:'codex' as const,scope:'Literal strings',revision:1,operation:'upsert' as const};
  const entry={archiveId:archive.id,title:'Literal replacement syntax',content:"Keep $' and $& exactly."};
  const literal=await storeConsolidatedReference(f.homes,archive,entry,async()=>{});
  await storeConsolidatedReference(f.homes,archive,entry,async()=>{});
  assert.ok((await readFile(literal.files[0]!.path,'utf8')).includes(entry.content));
});

test('receipt refuses writer evidence when its topic is not reachable through the native pointer',async t=>{
  const f=await fixture(t,1,0),core=f.service.referenceWriter.store;
  let code:string|undefined;
  f.service.referenceWriter.store=async(...args)=>{
    const row=await core(...args),directory=row.files[1]!;
    const content=(await readFile(directory.path,'utf8')).replace(/\]\([a-f0-9]{32}\.md\)/,'](missing.md)');
    await put(directory.path,content);return row;
  };
  f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async task=>{
    const m=await task.read({}) as {entries:{archiveId:string}[]};
    const result=await task.store!({entries:[{archiveId:m.entries[0]!.archiveId,title:'Fact',content:'Scoped evidence.'}]});
    code=result.entries[0]!.code;return {state:'completed'};
  }});
  await f.bg.start(recipient('claude'),'tamper');await settled(f.service);assert.equal(code,'MEMORY_RECEIPT_INDEX_UNREACHABLE');assert.equal(f.bg.list()[0]!.processed,0);
});

test('maintenance options preserve launch provider overrides and do not mutate foreground settings',()=>{
  const spec={executable:'fixture',args:['-c','model_provider="workbench"','-c','model_providers.workbench.name="Fixture"','app-server','--listen','stdio://'],env:{EXISTING:'yes'}};
  const before=structuredClone(spec),codex=memoryMaintenanceProcess('codex',spec),claude=memoryMaintenanceProcess('claude',spec);
  assert.deepEqual(codex.args,['-c','memories.generate_memories=false',...spec.args]);
  assert.equal(claude.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY,'1');assert.deepEqual(spec,before);
});

test('public process command consumes live default and writer services through approved plugin lifecycle',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-memory-controller-')),store=new StateStore(root);await store.load();
  const native=new NativeResources(root,{openZip:async()=>null,saveZip:async()=>null},()=>[],()=>{},root,{cliOptions:{executables:{codex:process.execPath,claude:process.execPath}}});await native.initialize();
  // This fixture tests controller/plugin routing; native configuration RPC has separate protocol coverage.
  t.mock.method(native.memoryControls,'canReceive',async()=>true);
  const controller=new WorkbenchController(store,new SecretStore(root,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>''}),{pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[],modelFetcher:async()=>new Response(JSON.stringify({data:[{id:'default-model',supported_reasoning_levels:['low','high']}]}))},()=>{},{native,memory:new SharedMemoryStore(root),skills:new SharedSkillsStore(root)});
  const registry=native.plugins;for(const [id,service] of Object.entries(controller.developmentServices()))if(service)registry.services.register(id,service,{version:1});registry.connectHost(r=>controller.call(r.method,r.payload));
  t.after(async()=>{await controller.dispose();await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100});});
  await put(path.join(root,'.codex','memories','source.md'),'Scoped default-model evidence.');await put(path.join(root,'.claude','projects','fixture','memory','source.md'),'Scoped Claude evidence.');
  await native.memory.configure({enabled:true,initialSources:'both'});
  await controller.call('model-api/save',{connection:{name:'Fixture',baseUrl:'http://127.0.0.1:12345',protocol:'chat-completions',models:[{id:'mapping',model:'default-model',name:'Fixture',enabled:true}]},key:''});
  const targets=await controller.call('model-targets/list') as ModelTarget[],codex=targets.find(t=>t.runtime==='codex')!,chosen=targets.find(t=>t.runtime==='claude')!;await controller.call('runtime/select',{runtime:'codex',targetId:codex.id,selection:{model:'default-model',effort:'low'}});
  await controller.call('runtime/select',{runtime:'claude',targetId:chosen.id,selection:{model:'default-model',effort:'high'}});
  await store.update(s=>{s.permissionPreferences={projectless:{claude:'full-access',codex:'full-access'}};});
  const zip=path.join(root,'fixture.zip');
  const code=`export function activate(api){let runs=0,writes=0,defaults=0,last,receivers=[];api.onDispose(api.services.intercept('native.memory-default','resolve',async(next,...args)=>{defaults++;return next(...args);}));api.onDispose(api.services.intercept('native.memory-reference-writer','store',async(next,...args)=>{writes++;return next(...args);}));api.onDispose(api.services.get('native.memory-background').registerExecutor({mode:'consolidation',supports:()=>true,run:async task=>{runs++;last=task.target;receivers.push({runtime:task.target.binding.runtime,effort:task.target.modelSelection.effort});const m=await task.read({});await task.store({entries:m.entries.map(e=>({archiveId:e.archiveId,title:'Scoped plugin fact',content:'Scoped default-model evidence.'}))});return {state:'completed'};}}));api.registerCommand('process',()=>api.call('native-memory/process'));api.registerCommand('inspect',()=>({runs,writes,defaults,last,receivers}));}`;
  await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id:'test.memory-route',name:'Memory route',description:'Synthetic lifecycle',version:'1.0.0',capabilities:['host'],main:'main.mjs'}))},{name:'main.mjs',data:Buffer.from(code)}]));
  await registry.importZip(zip);const plugin=(await registry.list())[0]!;await registry.setEnabled(plugin.manifest.id,plugin.hash,true,true);
  assert.equal((await registry.command(plugin.manifest.id,'process',{}) as any).started,true);await settled(native.memory);
  const observed=await registry.command(plugin.manifest.id,'inspect',{}) as any;
  assert.equal(observed.runs,2,JSON.stringify({observed,tasks:native.memory.background.list(),admissions:native.memory.background.admissions()}));assert.equal(observed.writes,2);assert.equal(observed.defaults,2);assert.equal(observed.last.binding.runtime,'claude');assert.equal(observed.last.modelSelection.effort,'high');assert.equal(store.snapshot().sessions.length,0);
  assert.ok(native.memory.background.list().every(t=>t.state==='completed'));assert.deepEqual(observed.receivers,[{runtime:'codex',effort:'low'},{runtime:'claude',effort:'high'}]);assert.equal((await new StateStore(root).load()).nativeMemoryDefaults?.codex?.targetId,codex.id);
  await registry.setEnabled(plugin.manifest.id,plugin.hash,false);await registry.setEnabled(plugin.manifest.id,plugin.hash,true);
  assert.equal((await registry.command(plugin.manifest.id,'process',{}) as any).reason,'MEMORY_BACKGROUND_EMPTY');
  for(let i=0;i<9;i++)await put(path.join(root,'.claude','projects','fixture','memory',`fresh-${i}.md`),'Fresh scoped Claude evidence '+i);
  await native.memory.sync();
  const chat=await controller.call('session/create',{modelTargetId:codex.id,permissionMode:'full-access'}) as any;
  t.mock.method((controller as any).nativeProvider,'submit',async()=>null);
  await (controller as any).dispatchDraft(chat,{id:'bounded-foreground',original:'hi',translated:'hi',sourceHash:'fixture',revision:1,bypass:true,demo:false});
  const admissionDeadline=Date.now()+5000;while((native.memory.background.list().length<3||['queued','running'].includes(native.memory.background.list().at(-1)!.state))&&Date.now()<admissionDeadline)await new Promise(r=>setTimeout(r,10));
  await settled(native.memory);
  const bounded=await registry.command(plugin.manifest.id,'inspect',{}) as any;
  assert.equal(bounded.runs,1,JSON.stringify({tasks:native.memory.background.list(),admission:native.memory.background.admission(),chat}));assert.equal(bounded.last.binding.runtime,'codex');assert.equal(bounded.last.modelSelection.effort,'low');
  assert.equal(native.memory.background.list().at(-1)!.total,6);assert.equal((await native.memory.status()).pendingCodex,3);
  assert.equal(bounded.defaults,2,'Only the earlier explicit empty process call resolves both defaults');
  await assert.rejects(controller.call('native-memory/process',{runtime:'other'}),/ARGUMENT_INVALID/);
  await assert.rejects(controller.call('native-memory/process',{runtime:['codex']}),/ARGUMENT_INVALID/);
  await store.update(s=>{s.lastModelTargetId='missing';});
  assert.equal((await controller.call('native-memory/process',{runtime:'claude'}) as any).reason,'MEMORY_BACKGROUND_DEFAULT_UNAVAILABLE');
});

test('approved plugin consolidation executor reaches the real store and disable restores legacy executor behavior',async t=>{
  const f=await fixture(t);let coreCalls=0;
  f.bg.registerExecutor({supports:()=>true,run:async()=>{coreCalls++;return {state:'completed'};}});
  const registry=new PluginRegistry(path.join(f.root,'plugins'));await registry.initialize();t.after(()=>registry.dispose());
  registry.services.register('native.memory-background',f.bg);
  const file=path.join(f.root,'fixture.zip'),manifest={schemaVersion:1,apiVersion:1,id:'test.memory',name:'Memory fixture',version:'1.0.0',description:'Isolated consolidation lifecycle.',capabilities:['host'],main:'main.mjs'};
  const code=`export function activate(api){api.onDispose(api.services.get('native.memory-background').registerExecutor({mode:'consolidation',supports:()=>true,run:async task=>{const m=await task.read({});for(const e of m.entries){const r=await task.read({archiveId:e.archiveId});await task.store({entries:[{archiveId:e.archiveId,title:'Plugin scoped reference',content:r.content}]});}return {state:'completed'};}}));}`;
  await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(code)}]));
  await registry.importZip(file);const record=(await registry.list())[0]!;
  await assert.rejects(registry.setEnabled(record.manifest.id,record.hash,true),/approval/i);
  await registry.setEnabled(record.manifest.id,record.hash,true,true);
  await f.bg.start(target,'plugin');await settled(f.service);assert.equal(f.bg.list()[0]!.state,'completed');assert.equal(coreCalls,0);
  await registry.setEnabled(record.manifest.id,record.hash,false);
  await put(path.join(f.homes.claude,'projects','source-project','memory','later.md'),'Later scoped fact.');await f.service.sync();
  await f.bg.start(target,'core');await settled(f.service);assert.equal(coreCalls,1);
  await registry.setEnabled(record.manifest.id,record.hash,true,true);await f.bg.start(target,'enabled-again');await settled(f.service);assert.equal(f.bg.list().at(-1)!.state,'completed');
  const badManifest={...manifest,id:'test.memory-failed'},badFile=path.join(f.root,'failed.zip');
  await writeFile(badFile,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(badManifest))},{name:'main.mjs',data:Buffer.from("export function activate(api){api.onDispose(api.services.get('native.memory-background').registerExecutor({mode:'consolidation',supports:()=>true,run:async()=>{throw Error('Leaked failed plugin');}}));throw Error('Synthetic activation failure');}")} ]));
  await registry.importZip(badFile);const bad=(await registry.list()).find(p=>p.manifest.id===badManifest.id)!;await registry.setEnabled(bad.manifest.id,bad.hash,true,true);assert.equal((await registry.list()).find(p=>p.manifest.id===badManifest.id)!.enabled,false);
  await put(path.join(f.homes.claude,'projects','source-project','memory','after-failure.md'),'Scoped fact after failed plugin activation.');await f.service.sync();
  await f.bg.start(target,'after-failure');await settled(f.service);assert.equal(f.bg.list().at(-1)!.state,'completed');assert.equal(coreCalls,1);
});

test('consolidation read-only, plan and disabled states do not invoke the model',async t=>{
  const f=await fixture(t);let calls=0;f.bg.registerExecutor({mode:'consolidation',supports:()=>true,run:async()=>{calls++;return {state:'completed'};}});
  for(const permissionMode of ['read-only','plan'] as const)assert.equal((await f.bg.start({...target,permissionMode},permissionMode)).reason,'MEMORY_BACKGROUND_READ_ONLY');
  await f.service.configure({enabled:false});assert.equal((await f.bg.start(target,'disabled')).reason,'MEMORY_BACKGROUND_DISABLED');assert.equal(calls,0);
});
