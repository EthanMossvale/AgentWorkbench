import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { NativeResources } from '../apps/desktop/host/native-resources';
import { SharedMemoryStore } from '../packages/memory-core';
import { SharedSkillsStore } from '../packages/skills-core';
import { PluginRegistry } from '../packages/plugins-core';
import { encodeZip } from '../packages/native-resources/archive';
import type { ModelTarget } from '../packages/model-api/types';
import type { Session } from '../packages/contracts';

async function fixture(t:test.TestContext) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-runtime-effort-'));
  const store=new StateStore(directory);await store.load();
  const native=new NativeResources(directory,{openZip:async()=>null,saveZip:async()=>null},()=>[],()=>{},directory,{cliOptions:{executables:{codex:process.execPath,claude:process.execPath}}});
  let levels=['low','medium','high','ultra'];
  const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>''}),{
    pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[],
    modelFetcher:async url=>{assert.ok(String(url).endsWith('/models'));return new Response(JSON.stringify({data:[{id:'fixture-model',supported_reasoning_levels:levels,default_reasoning_effort:'medium'}]}),{headers:{'content-type':'application/json'}});},
  },()=>{},{native,memory:new SharedMemoryStore(directory),skills:new SharedSkillsStore(directory)});
  t.after(async()=>{await controller.dispose();await rm(directory,{recursive:true,force:true,maxRetries:3});});
  let connection:any=await controller.call('model-api/save',{connection:{name:'Synthetic',baseUrl:'http://127.0.0.1:12345',protocol:'chat-completions',models:[{id:'map',model:'fixture-model',name:'Fixture',enabled:true}]},key:''});
  const targets=await controller.call('model-targets/list') as ModelTarget[];
  const codex=targets.find(target=>target.runtime==='codex')!,claude=targets.find(target=>target.runtime==='claude')!;
  const create=(effort='ultra')=>controller.call('session/create',{modelTargetId:codex.id,modelSelection:{model:'fixture-model',effort}}) as Promise<Session>;
  const get=(id:string)=>store.snapshot().sessions.find(s=>s.id===id)!;
  return {directory,store,controller,codex,claude,create,get,async restrict(){levels=['medium'];connection=await controller.call('model-api/save',{id:connection.id,revision:connection.revision,connection:{...connection,models:connection.models}});}};
}

test('explicit API model settings survive both runtime directions and persistence, overriding stale lanes',async t=>{
  const f=await fixture(t),session=await f.create();
  const selection={model:'fixture-model',effort:'ultra'};
  await f.controller.call('session/model-target',{sessionId:session.id,targetId:f.claude.id,selection});
  assert.deepEqual(f.get(session.id).modelSelection,selection);
  await f.controller.call('session/model',{sessionId:session.id,selection:{...selection,effort:'high'}});
  for(const target of [f.codex,f.claude,f.codex]){
    await f.controller.call('session/model-target',{sessionId:session.id,targetId:target.id,selection:{...selection,effort:'high'}});
    const saved=f.get(session.id);assert.equal(saved.binding.runtime,target.runtime);assert.equal(saved.modelSelection?.effort,'high');
    assert.equal(saved.id,session.id);assert.equal(saved.messages.length,0);
    const reloaded=await new StateStore(f.directory).load();assert.deepEqual(reloaded.lastModelSelection,saved.modelSelection);assert.equal(reloaded.lastModelTargetId,target.id);
  }
  assert.equal(f.store.snapshot().sessions.length,1);
});

test('explicit API selection is validated before mutation, including reselecting the same target',async t=>{
  const f=await fixture(t),session=await f.create();
  for(const target of [f.codex,f.claude])for(const selection of [null,{model:'other',effort:'high'},{model:'fixture-model',effort:'invented'},{model:'fixture-model',serviceTier:'priority'}]){
    const before=f.store.snapshot();await assert.rejects(f.controller.call('session/model-target',{sessionId:session.id,targetId:target.id,selection}));assert.deepEqual(f.store.snapshot(),before);
  }
  await f.controller.call('session/model-target',{sessionId:session.id,targetId:f.codex.id,selection:{model:'fixture-model',effort:'high'}});
  assert.equal(f.get(session.id).modelSelection?.effort,'high');
  assert.equal(f.store.snapshot().lastModelSelection?.effort,'high');
  await f.restrict();const before=f.store.snapshot();
  await assert.rejects(f.controller.call('session/model-target',{sessionId:session.id,targetId:f.claude.id,selection:{model:'fixture-model',effort:'high'}}));assert.deepEqual(f.store.snapshot(),before);
});

test('omitting selection preserves old default and lane restoration behavior',async t=>{
  const f=await fixture(t),session=await f.create();
  await f.controller.call('session/model-target',{sessionId:session.id,targetId:f.claude.id});assert.equal(f.get(session.id).modelSelection?.effort,'medium');
  await f.controller.call('session/model-target',{sessionId:session.id,targetId:f.codex.id});assert.equal(f.get(session.id).modelSelection?.effort,'ultra');
  await f.controller.call('session/model-target',{sessionId:session.id,targetId:f.claude.id,selection:{model:'fixture-model'}});
  assert.deepEqual(f.get(session.id).modelSelection,{model:'fixture-model'},'An explicit model-only selection does not invent an effort');
});

test('approved plugins call and replace the production selection route; disable and reenable restore it',async t=>{
  const f=await fixture(t),plugins=new PluginRegistry(path.join(f.directory,'plugins'));await plugins.initialize();
  plugins.connectHost(request=>f.controller.call(request.method,request.payload));t.after(()=>plugins.dispose());
  const install=async(id:string,main:string)=>{
    const file=path.join(f.directory,id+'.zip');await writeFile(file,encodeZip([
      {name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Synthetic preference fixture',capabilities:['host'],main:'main.mjs'}))},
      {name:'main.mjs',data:Buffer.from(main)},
    ]));await plugins.importZip(file);return (await plugins.list()).find(record=>record.manifest.id===id)!;
  };
  const caller=await install('test.effort-caller',`export function activate(api){api.useHost(async(request,next)=>request.method==='test/effort-switch'?api.invoke('session/model-target',request.payload):next());}`);
  const policy=await install('test.effort-policy',`export function activate(api){api.useHost((request,next)=>request.method==='session/model-target'?next({...request,payload:{...request.payload,selection:{model:'fixture-model',effort:'high'}}}):next());}`);
  const dispatch=(method:string,payload:unknown)=>plugins.dispatch({method,payload},request=>f.controller.call(request.method,request.payload));
  await plugins.setEnabled(caller.manifest.id,caller.hash,true,true);await plugins.setEnabled(policy.manifest.id,policy.hash,true,true);
  const first=await f.create();await dispatch('test/effort-switch',{sessionId:first.id,targetId:f.claude.id,selection:{model:'fixture-model',effort:'ultra'}});assert.equal(f.get(first.id).modelSelection?.effort,'high');
  await plugins.setEnabled(policy.manifest.id,policy.hash,false);
  await dispatch('test/effort-switch',{sessionId:first.id,targetId:f.codex.id,selection:{model:'fixture-model',effort:'ultra'}});assert.equal(f.get(first.id).modelSelection?.effort,'ultra');
  await plugins.setEnabled(policy.manifest.id,policy.hash,true);
  const later=await f.create();await dispatch('test/effort-switch',{sessionId:later.id,targetId:f.claude.id,selection:{model:'fixture-model',effort:'ultra'}});assert.equal(f.get(later.id).modelSelection?.effort,'high');
  await plugins.disableAll();await dispatch('session/model-target',{sessionId:first.id,targetId:f.claude.id,selection:{model:'fixture-model',effort:'ultra'}});assert.equal(f.get(first.id).modelSelection?.effort,'ultra');
  await assert.rejects(dispatch('test/effort-switch',{sessionId:first.id,targetId:f.codex.id}));
  const failed=await install('test.effort-failed',`export function activate(api){api.useHost(()=>{throw Error('Leaked failed registration');});throw Error('Synthetic activation failure');}`);
  await plugins.setEnabled(failed.manifest.id,failed.hash,true,true);
  assert.equal((await plugins.list()).find(record=>record.manifest.id===failed.manifest.id)?.enabled,false);
  await dispatch('session/model-target',{sessionId:later.id,targetId:f.codex.id,selection:{model:'fixture-model',effort:'ultra'}});assert.equal(f.get(later.id).modelSelection?.effort,'ultra');
});
