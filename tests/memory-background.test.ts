import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {NativeMemoryService} from '../packages/native-memory';
import {MemoryBackgroundTasks,type MemoryTaskBinding,type MemoryTaskExecution} from '../packages/native-memory/background';
import {digest} from '../packages/native-resources/files';
import {HostServiceRegistry} from '../packages/plugins-core/services';

const target:MemoryTaskBinding={binding:{runtime:'claude',provider:'fixture',accountRef:'fixture',executionId:'local',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'mapping',nativeSessionId:'foreground-native'},modelSelection:{model:'chosen-model',effort:'high'},permissionMode:'full-access'};
const put=async(file:string,text:string)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);};
const wait=async(predicate:()=>boolean)=>{for(let i=0;i<300&&!predicate();i++)await new Promise(r=>setTimeout(r,10));assert.ok(predicate(),'Background task did not settle');};
async function fixture(t:TestContext,count=1){
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-background-')),home=path.join(root,'home'),directory=path.join(root,'data');
  const options={home,codexHome:path.join(home,'.codex'),claudeHome:path.join(home,'.claude'),intervalMs:60000,machineIdentity:'fixture'};
  const service=new NativeMemoryService(directory,options);await service.initialize();
  t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true});});
  for(let i=0;i<count;i++)await put(path.join(home,'.codex','memories',i===0?'MEMORY.md':`entry-${i}.md`),`Source memory ${i}.`);
  await service.configure({enabled:true,initialSources:'codex'});
  return {root,home,directory,options,service,bg:service.background};
}
async function verify(task:MemoryTaskExecution){
  const start=task.prompt.lastIndexOf('\n{'),end=task.prompt.lastIndexOf('\n</agent-workbench-memory-handoff>');
  const manifest=JSON.parse(task.prompt.slice(start+1,end));
  const index=path.join(manifest.nativeHome,'projects','background-fixture','memory','MEMORY.md');
  const rows=[];let text=await readFile(index,'utf8').catch(()=>'');
  for(const entry of manifest.entries){
    const file=path.join(path.dirname(index),entry.archiveId+'.md'),content=entry.startMarker+'\n'+entry.scope+'\nImported knowledge in English.\n'+entry.endMarker;
    await put(file,content);text+='\n'+entry.startMarker+'\n['+entry.scope+']('+path.basename(file)+')\n'+entry.endMarker;
    rows.push({archiveId:entry.archiveId,revision:entry.revision,scope:entry.scope,disposition:'stored',files:[{path:file,sha256:digest(content)}]});
  }
  await put(index,text);
  await put(manifest.receiptFile,JSON.stringify({deliveryId:manifest.deliveryId,token:manifest.token,recipientRuntime:manifest.recipientRuntime,entries:rows.map(row=>({...row,index:{path:index,sha256:digest(text)}}))}));
  return {state:'completed' as const};
}
test('explicit use drains a frozen backlog in verified batches using separate sessions and exact binding',async t=>{
  const f=await fixture(t,13),calls:MemoryTaskExecution[]=[];
  f.bg.registerExecutor({supports:()=>true,run:async task=>{calls.push(task);assert.notEqual(task.sessionId,'foreground-native');assert.deepEqual(task.target,target);assert.doesNotMatch(task.prompt,/Then continue the user's task/);await task.read({});return verify(task);}});
  await f.service.sync();assert.equal(calls.length,0,'Capture never starts a model');
  const result=await f.bg.start(target,'explicit-task');assert.equal(result.started,true);await wait(()=>!f.bg.busy());
  assert.equal(calls.length,2);assert.notEqual(calls[0]!.sessionId,calls[1]!.sessionId);
  assert.equal(f.bg.list()[0]!.state,'completed');assert.equal(f.bg.list()[0]!.processed,13);assert.equal((await f.service.status()).pendingClaude,0);
  assert.equal((await f.bg.start(target,'explicit-task')).reason,'MEMORY_BACKGROUND_DUPLICATE');
  const journal=await readFile(path.join(f.directory,'memory-background.json'),'utf8');assert.doesNotMatch(journal,/foreground-native|Source memory|receiptFile|prompt|accountRef/);
});
test('claimed success without native receipt blocks further batches and does not auto retry',async t=>{
  const f=await fixture(t,13);let calls=0;
  f.bg.registerExecutor({supports:()=>true,run:async()=>{calls++;return {state:'completed'};}});
  await f.bg.start(target,'once');await wait(()=>!f.bg.busy());assert.equal(calls,1);
  assert.equal(f.bg.list()[0]!.state,'blocked');assert.equal(f.bg.list()[0]!.processed,0);
  await f.service.sync();assert.equal(calls,1);assert.equal((await f.service.status()).pendingClaude,13);
});
test('runtime admission deduplicates concurrent triggers; disabling cancels and preserves pending archives',async t=>{
  const f=await fixture(t);let entered=false;
  f.bg.registerExecutor({supports:()=>true,run:task=>new Promise(resolve=>{entered=true;task.signal.addEventListener('abort',()=>resolve({state:'uncertain'}),{once:true});})});
  await f.bg.start(target,'first');await wait(()=>entered);
  assert.equal((await f.bg.start(target,'second')).reason,'MEMORY_BACKGROUND_BUSY');
  await f.service.configure({enabled:false});assert.equal(f.bg.busy(),false);assert.equal(f.bg.list()[0]!.state,'cancelled');assert.equal((await f.service.status()).pendingClaude,1);
  assert.equal((await f.bg.start(target,'third')).reason,'MEMORY_BACKGROUND_DISABLED');
});
test('read-only and unsupported locations never start an executor',async t=>{
  const f=await fixture(t);let calls=0;f.bg.registerExecutor({supports:t=>!t.binding.hostId,run:async()=>{calls++;return {state:'completed'};}});
  assert.equal((await f.bg.start({...target,permissionMode:'read-only'},'read')).reason,'MEMORY_BACKGROUND_READ_ONLY');
  assert.equal((await f.bg.start({...target,binding:{...target.binding,hostId:'remote'}},'remote')).reason,'MEMORY_BACKGROUND_BINDING_UNSUPPORTED');assert.equal(calls,0);
});
test('task cancellation and executor unregister stop owned work without approving interactions',async t=>{
  const f=await fixture(t);let entered=false;
  const release=f.bg.registerExecutor({supports:()=>true,run:task=>new Promise(resolve=>{entered=true;task.signal.addEventListener('abort',()=>resolve({state:'blocked',reason:'MEMORY_BACKGROUND_INTERACTION_REQUIRED'}),{once:true});})});
  const first=await f.bg.start(target,'cancel');await wait(()=>entered);assert.equal((await f.bg.cancel(first.taskId!)).cancelled,true);
  entered=false;await f.bg.start(target,'remove');await wait(()=>entered);release();await wait(()=>!f.bg.busy());assert.equal(f.bg.list()[1]!.reason,'MEMORY_BACKGROUND_EXECUTOR_REMOVED');
});

test('unsupported work is deduplicated across restart and new executor support can recover on explicit use',async t=>{
  const f=await fixture(t),ssh={...target,binding:{...target.binding,hostId:'synthetic-ssh'}};
  const first=await f.bg.start(ssh,'first');assert.equal(first.reason,'MEMORY_BACKGROUND_BINDING_UNSUPPORTED');
  assert.equal((await f.bg.start(ssh,'second')).reason,'MEMORY_BACKGROUND_UNCHANGED');assert.equal(f.bg.list().length,1);
  const restarted=new MemoryBackgroundTasks(f.directory,{allowed:async()=>true,pending:async()=>f.service.exchange.pendingIds('claude'),prepare:async()=>({prompt:'Synthetic',deliveryId:'delivery',count:1}),finish:async()=>1,read:async()=>null});
  await restarted.initialize();t.after(()=>restarted.dispose());
  assert.equal((await restarted.start(ssh,'third')).reason,'MEMORY_BACKGROUND_UNCHANGED');
  let calls=0;restarted.registerExecutor({supports:()=>true,run:async()=>{calls++;return {state:'completed'};}});
  assert.equal((await restarted.start(ssh,'fourth')).started,true);await wait(()=>!restarted.busy());assert.equal(calls,1);assert.equal(restarted.list().at(-1)!.state,'completed');
});
test('restart marks interrupted jobs uncertain without recreating any conversation',async t=>{
  const f=await fixture(t);
  await put(path.join(f.directory,'memory-background.json'),JSON.stringify({version:1,tasks:[{id:'fixture',runtime:'claude',model:'chosen-model',permissionMode:'default',submissionKey:'a'.repeat(64),state:'running',createdAt:new Date().toISOString(),processed:0,total:1}]}));
  let calls=0;const restarted=new MemoryBackgroundTasks(f.directory,{allowed:async()=>true,pending:async()=>[],prepare:async()=>{calls++;return undefined;},finish:async()=>0,read:async()=>null});
  await restarted.initialize();assert.equal(restarted.list()[0]!.state,'uncertain');assert.equal(calls,0);await restarted.dispose();
});
test('registered developer executor replacement is live and unregister restores the core executor',async t=>{
  const f=await fixture(t);let core=0,replacement=0;
  f.bg.registerExecutor({supports:()=>true,run:async()=>{core++;return {state:'completed'};}});
  const registry=new HostServiceRegistry();registry.register('native.memory-background',f.bg);
  const release=registry.get<MemoryBackgroundTasks>('native.memory-background').registerExecutor({supports:()=>true,run:async()=>{replacement++;return {state:'completed'};}});
  await f.bg.start(target,'replacement');await wait(()=>!f.bg.busy());release();await f.bg.start(target,'core');await wait(()=>!f.bg.busy());assert.equal(replacement,1);assert.equal(core,1);
});
