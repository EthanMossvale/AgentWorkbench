import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { PluginRegistry } from '../packages/plugins-core';
import { RuntimeExtensionRegistry, type RuntimeContext, type RuntimeDefinition } from '../packages/runtime-extensions';
import { collectDirectory, encodeZip } from '../packages/native-resources/archive';
import { StateStore, SecretStore } from '../apps/desktop/host/store';

import { WorkbenchController } from '../apps/desktop/host/controller';
import type { DraftPreview, Session } from '../packages/contracts';

const definition:RuntimeDefinition={apiVersion:1,id:'plugin:test',name:'Test runtime',description:'Synthetic runtime',permissions:[{value:'default',label:'Default',description:'Synthetic'}]};
async function until(check:()=>boolean) { for(let i=0;i<100;i++){if(check())return;await delay(10);}assert.ok(check(),'condition did not settle'); }
async function fixture(t:test.TestContext) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'awb-runtime-'));
  const store=new StateStore(dir);await store.load();await store.update(s=>{s.plugins={translation:{enabled:false}};});
  const plugins=new PluginRegistry(dir);await plugins.initialize();
  const controller=new WorkbenchController(store,new SecretStore(dir,{encrypt:()=>{throw Error('No credentials in tests');},decrypt:()=>''}),{runtimeExtensions:plugins.runtimes,pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
  plugins.connectHost(({method,payload})=>controller.call(method,payload));
  t.after(async()=>{await controller.dispose();await plugins.dispose();await rm(dir,{recursive:true,force:true,maxRetries:5});});
  const zip=path.join(dir,'runtime.zip');await writeFile(zip,encodeZip(await collectDirectory(path.resolve('examples/plugins/runtime-studio'))));await plugins.importZip(zip);
  const record=(await plugins.list())[0]!;
  const enable=()=>plugins.setEnabled(record.manifest.id,record.hash,true,true);
  const disable=()=>plugins.setEnabled(record.manifest.id,record.hash,false);
  const get=(id:string)=>store.snapshot().sessions.find(s=>s.id===id)!;
  const prepare=(id:string,text:string)=>controller.call('draft/prepare',{sessionId:id,text}) as Promise<DraftPreview>;
  const submit=async(id:string,text:string)=>{const p=await prepare(id,text);await controller.call('draft/submit',{sessionId:id,id:p.id,sourceHash:p.sourceHash});return p;};
  return {dir,store,plugins,controller,record,enable,disable,get,prepare,submit};
}

test('an approved ZIP registers a third runtime and uses the normal composer, models, permissions and forks',async t=>{
  const f=await fixture(t);assert.deepEqual(f.plugins.runtimes.list(),[]);await f.enable();
  const catalog=await f.controller.call('runtime/catalog') as any[];assert.equal(catalog[0].id,'plugin:example.echo');assert.equal(catalog[0].capabilities.fork,true);
  await f.controller.call('runtime/select',{runtime:catalog[0].id});
  const s=await f.controller.call('session/create',{runtime:catalog[0].id}) as Session;
  assert.equal(s.binding.hostId,undefined);assert.equal(s.modelSelection?.model,'echo');assert.equal(s.pluginRuntime?.owner,f.record.manifest.id);
  const preview=await f.submit(s.id,'hello');await until(()=>f.get(s.id).status==='idle');
  assert.equal(f.get(s.id).messages.at(-1)?.original,'Echo 1: hello');
  await assert.rejects(f.controller.call('draft/submit',{sessionId:s.id,id:preview.id,sourceHash:preview.sourceHash}));assert.equal(f.get(s.id).messages.length,2);
  await f.controller.call('session/permissions',{sessionId:s.id,permissionMode:'plugin:review'});
  await f.controller.call('session/model',{sessionId:s.id,selection:{model:'compact'}});await f.submit(s.id,'short');await until(()=>f.get(s.id).status==='idle');assert.equal(f.get(s.id).messages.at(-1)?.original,'short');
  const fork=await f.controller.call('session/fork',{sessionId:s.id}) as Session;
  assert.notEqual(fork.id,s.id);assert.equal((fork.pluginRuntime?.state as any).turns,0);assert.equal(fork.messages.length,4);assert.equal((f.get(s.id).pluginRuntime?.state as any).turns,2);
  const targets=await f.controller.call('model-targets/list') as any[];assert.equal(targets.filter(t=>t.runtime==='plugin:example.echo').length,2);
  const target=await f.controller.call('session/create',{modelTargetId:targets.find(t=>t.runtime==='plugin:example.echo').id}) as Session;assert.equal(target.binding.runtime,'plugin:example.echo');
  await assert.rejects(f.controller.call('session/permissions',{sessionId:s.id,permissionMode:'plugin:missing'}),/UNSUPPORTED/);
  await assert.rejects(f.controller.call('session/model',{sessionId:s.id,selection:{model:'not-installed'}}),/UNSUPPORTED/);
});

test('receipts are checked and consumed once; disable fences the runtime and preserves history',async t=>{
  const f=await fixture(t);await f.enable();const s=await f.controller.call('session/create',{runtime:'plugin:example.echo'}) as Session;
  await f.submit(s.id,'[approval] hello');await until(()=>!!f.get(s.id).nativeApprovals?.length);
  const approval=f.get(s.id).nativeApprovals![0]!;
  await assert.rejects(f.controller.call('session/approval',{sessionId:s.id,requestId:approval.id,optionId:'allow',receipt:'stale'}),/EXPIRED/);
  await f.controller.call('session/approval',{sessionId:s.id,requestId:approval.id,optionId:'allow',receipt:approval.receipt});await until(()=>f.get(s.id).status==='idle');
  await assert.rejects(f.controller.call('session/approval',{sessionId:s.id,requestId:approval.id,optionId:'allow',receipt:approval.receipt}));
  await f.submit(s.id,'[approval] pending');await until(()=>!!f.get(s.id).nativeApprovals?.length);
  await f.disable();assert.equal(f.get(s.id).status,'uncertain');assert.equal(f.get(s.id).nativeApprovals?.length,0);assert.equal(f.get(s.id).messages.length,3);
  await assert.rejects(f.prepare(s.id,'must not silently use another runtime'),/UNAVAILABLE/);
  await f.enable();await f.controller.call('runtime/catalog');await f.controller.call('session/reconcile',{sessionId:s.id});await until(()=>f.get(s.id).status==='idle');
  assert.match(f.get(s.id).messages.at(-1)!.original,/No input was replayed/);assert.equal(f.get(s.id).messages.filter(m=>m.role==='user').length,2);
});

test('restart with a missing plugin preserves its selection, custom permissions and checkpoints',async t=>{
  const f=await fixture(t);await f.enable();await f.controller.call('runtime/select',{runtime:'plugin:example.echo'});
  const s=await f.controller.call('session/create',{runtime:'plugin:example.echo',permissionMode:'plugin:review'}) as Session;
  await f.submit(s.id,'saved');await until(()=>f.get(s.id).status==='idle');await f.disable();
  const loaded=new StateStore(f.dir);await loaded.load();const saved=loaded.snapshot();
  assert.equal(saved.lastSelectedRuntime,'plugin:example.echo');assert.equal(saved.sessions[0]?.permissionMode,'plugin:review');assert.equal(saved.runtimeExtensions,undefined);assert.equal((saved.sessions[0]?.pluginRuntime?.state as any).turns,1);
  await f.enable();await f.submit(s.id,'after enable');await until(()=>f.get(s.id).status==='idle');assert.match(f.get(s.id).messages.at(-1)!.original,/Echo 2/);
});

test('runtime registration validates collisions, owner identity and late asynchronous emissions',async t=>{
  const f=await fixture(t);let ctx:RuntimeContext|undefined,finish!:()=>void;
  const release=f.plugins.runtimes.register('test.owner',definition,{async run(context){ctx=context;await new Promise<void>(r=>finish=r);},async stop(){finish?.();}});
  assert.throws(()=>f.plugins.runtimes.register('another.owner',definition,{async run(){},async stop(){}}),/ALREADY_REGISTERED/);
  const s=await f.controller.call('session/create',{runtime:definition.id}) as Session;await f.submit(s.id,'pending');await until(()=>!!ctx);
  await release();await assert.rejects(ctx!.emit({type:'message',id:'late',text:'discard'}),/EXPIRED/);finish();
  f.plugins.runtimes.register('another.owner',definition,{async run(){},async stop(){}});
  await assert.rejects(f.prepare(s.id,'wrong owner'),/OWNER_MISMATCH/);assert.equal(f.get(s.id).messages.length,1);
});

test('stop reaches the adapter without replay; failed execution remains uncertain',async t=>{
  const f=await fixture(t);await f.enable();const s=await f.controller.call('session/create',{runtime:'plugin:example.echo'}) as Session;
  await f.submit(s.id,'[approval] stop');await until(()=>!!f.get(s.id).nativeApprovals?.length);
  assert.deepEqual(await f.controller.call('session/stop',{sessionId:s.id}),{stopped:true});assert.equal(f.get(s.id).status,'idle');assert.equal(f.get(s.id).messages.length,1);
  f.plugins.runtimes.register('test',definition,{async run(){throw Error('Synthetic failure');},async stop(){}});
  const failure=await f.controller.call('session/create',{runtime:definition.id}) as Session;await f.submit(failure.id,'only once');await until(()=>f.get(failure.id).status==='uncertain');assert.equal(f.get(failure.id).messages.length,1);
});

test('skin assets are package-bound and revoke on disable or content change',async t=>{
  const f=await fixture(t);await f.enable();assert.match(await f.plugins.asset(f.record.manifest.id,f.record.hash,'assets/grid.svg'),/^data:image\/svg\+xml;base64,/);
  await assert.rejects(f.plugins.asset(f.record.manifest.id,f.record.hash,'../state.json'));
  await assert.rejects(f.plugins.asset(f.record.manifest.id,f.record.hash,'main.mjs'),/INVALID/);
  await f.disable();await assert.rejects(f.plugins.asset(f.record.manifest.id,f.record.hash,'assets/grid.svg'),/UNAVAILABLE/);
  await f.enable();await writeFile(path.join(f.record.directory,'assets/grid.svg'),'<svg/>');await assert.rejects(f.plugins.asset(f.record.manifest.id,f.record.hash,'assets/grid.svg'),/UNAVAILABLE|REVISION/);assert.equal(f.plugins.runtimes.list().length,0);
});

test('failed activation rolls back a registered runtime',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'awb-runtime-fail-')),plugins=new PluginRegistry(dir);t.after(async()=>{await plugins.dispose();await rm(dir,{recursive:true,force:true});});await plugins.initialize();
  const zip=path.join(dir,'failed.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id:'test.failed',name:'Fail',version:'1.0.0',description:'Synthetic',capabilities:['host'],main:'main.mjs'}))},{name:'main.mjs',data:Buffer.from(`export function activate(api){api.runtimes.register(${JSON.stringify(definition)},{async run(){},async stop(){}});throw Error('Synthetic activation failure');}`)}]));await plugins.importZip(zip);const r=(await plugins.list())[0]!;await plugins.setEnabled(r.manifest.id,r.hash,true,true);assert.equal(plugins.runtimes.list().length,0);assert.equal((await plugins.list())[0]!.enabled,false);
});

test('runtime model lanes restore opaque state without losing history or starting a turn on selection',async t=>{
  const f=await fixture(t);await f.enable();const targets=(await f.controller.call('model-targets/list') as any[]).filter(t=>t.runtime==='plugin:example.echo');
  const s=await f.controller.call('session/create',{modelTargetId:targets[0].id}) as Session;await f.submit(s.id,'first');await until(()=>f.get(s.id).status==='idle');
  await f.controller.call('session/model-target',{sessionId:s.id,targetId:targets[1].id});assert.equal(f.get(s.id).messages.length,2);assert.equal(f.get(s.id).pluginRuntime?.owner,f.record.manifest.id);
  await f.controller.call('session/model-target',{sessionId:s.id,targetId:targets[0].id});assert.equal((f.get(s.id).pluginRuntime?.state as any).turns,1);assert.equal(f.get(s.id).messages.length,2);
  await f.submit(s.id,'restored');await until(()=>f.get(s.id).status==='idle');assert.equal(f.get(s.id).messages.at(-1)?.original,'Echo 2: restored');
});

test('plugin questions use existing answer validation and the translated-answer submission gate',async t=>{
  const f=await fixture(t);let finish!:()=>void,answer:unknown;
  f.plugins.runtimes.register('test',definition,{async run(ctx){const wait=new Promise<void>(r=>finish=r);await ctx.emit({type:'interaction',item:{id:'question',method:'plugin/question',kind:'questions',blocking:true,title:'Confirm',questions:[{id:'q',header:'Choice',question:'Choose',options:[{label:'A',description:''}],multiple:false,other:false,secret:false}]}});await wait;},async stop(){finish?.();},async interaction(_ctx,_id,reply){answer=reply;finish();}});
  const s=await f.controller.call('session/create',{runtime:definition.id}) as Session;await f.submit(s.id,'ask');await until(()=>!!f.get(s.id).nativeInteractions?.length);const receipt=f.get(s.id).nativeInteractions![0]!.receipt;
  const preview=await f.controller.call('interaction/prepare',{sessionId:s.id,requestId:'question',receipt,answers:{q:['A']},clientRequest:'answer-1'}) as {id:string;sourceHash:string};
  await f.controller.call('interaction/submit',{sessionId:s.id,id:preview.id,sourceHash:preview.sourceHash});await until(()=>f.get(s.id).status==='idle');assert.deepEqual(answer,{action:'submit',answers:{q:['A']}});
  await assert.rejects(f.controller.call('interaction/submit',{sessionId:s.id,id:preview.id,sourceHash:preview.sourceHash}));
});

test('discovery failure disables admission and a failed approval callback is not offered for replay',async t=>{
  const f=await fixture(t);let finish!:()=>void;
  const release=f.plugins.runtimes.register('test',definition,{async discover(){throw Error('Offline');},async run(){},async stop(){}});
  assert.equal((await f.controller.call('runtime/catalog') as any[]).find(r=>r.id===definition.id).ready,false);await assert.rejects(f.controller.call('session/create',{runtime:definition.id}),/UNAVAILABLE/);await release();
  f.plugins.runtimes.register('test',definition,{async run(ctx){const wait=new Promise<void>(r=>finish=r);await ctx.emit({type:'approval',id:'a',kind:'tool',details:'Synthetic',options:[{id:'yes',label:'Yes',description:'Synthetic',scope:'once'}]});await wait;},async stop(){finish?.();},async approval(){throw Error('Lost receipt');}});
  const s=await f.controller.call('session/create',{runtime:definition.id}) as Session;await f.submit(s.id,'ask');await until(()=>!!f.get(s.id).nativeApprovals?.length);const a=f.get(s.id).nativeApprovals![0]!;
  await assert.rejects(f.controller.call('session/approval',{sessionId:s.id,requestId:a.id,optionId:'yes',receipt:a.receipt}),/Lost receipt/);assert.equal(f.get(s.id).status,'uncertain');assert.equal(f.get(s.id).nativeApprovals?.length,0);finish();
});

test('an older discovery cannot overwrite newer availability and optional methods must be callable',async()=>{
  const registry=new RuntimeExtensionRegistry();let first!:(value:{ready:boolean})=>void,calls=0;
  assert.throws(()=>registry.register('test',definition,{async run(){},async stop(){},resume:'invalid' as any}),/REGISTRATION_INVALID/);
  const release=registry.register('test',definition,{async run(){},async stop(){},async discover(){if(++calls===1)return new Promise(r=>first=r);return {ready:true};}});
  const pending=registry.discover();await registry.discover();first({ready:false});await pending;assert.equal(registry.list()[0]?.ready,true);await release();
});
