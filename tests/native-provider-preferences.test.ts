import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { NativeResources } from '../apps/desktop/host/native-resources';
import { SharedMemoryStore } from '../packages/memory-core';
import { SharedSkillsStore } from '../packages/skills-core';
import type { ModelConnection, ModelTarget } from '../packages/model-api/types';
import type { Session } from '../packages/contracts';

test('native provider preferences persist exact model and effort, retain unavailable choices, and do not start a task',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-native-pref-')),store=new StateStore(directory);await store.load();
  const native=new NativeResources(directory,{openZip:async()=>null,saveZip:async()=>null},()=>[],()=>{},directory,{cliOptions:{executables:{codex:process.execPath,claude:process.execPath}}});
  let levels=['low','high','ultra'];let requests=0;
  const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No secrets in this test');},decrypt:()=>''}),{pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[],modelFetcher:async url=>{assert.ok(String(url).endsWith('/models'));requests++;return new Response(JSON.stringify({data:[{id:'upstream',supported_reasoning_levels:levels,default_reasoning_effort:levels[0]}]}),{headers:{'content-type':'application/json'}});}},()=>{},{memory:new SharedMemoryStore(directory),skills:new SharedSkillsStore(directory),native});
  try{
    let connection=await controller.call('model-api/save',{connection:{name:'Synthetic',baseUrl:'http://127.0.0.1:12345',protocol:'chat-completions',models:[{id:'map',model:'upstream',name:'Writer',enabled:true}]},key:''}) as ModelConnection;
    const targets=await controller.call('model-targets/list') as ModelTarget[];assert.deepEqual(targets.map(target=>target.runtime),['codex','claude']);assert.ok(targets.every(target=>target.binding.egress==='direct-api'&&!target.binding.hostId));
    const target=targets[0]!,selection={model:'upstream',effort:'ultra'};
    await controller.call('runtime/select',{runtime:'codex',targetId:target.id,selection});
    let loaded=await new StateStore(directory).load();assert.equal(loaded.lastSelectedRuntime,'codex');assert.equal(loaded.lastModelTargetId,target.id);assert.deepEqual(loaded.lastModelSelection,selection);assert.equal(loaded.sessions.length,0);
    const session=await controller.call('session/create',{modelTargetId:target.id,modelSelection:selection}) as Session;assert.deepEqual(session.modelSelection,selection);
    await assert.rejects(controller.call('runtime/select',{runtime:'claude',targetId:target.id,selection}));await assert.rejects(controller.call('runtime/select',{runtime:'codex',targetId:target.id,selection:{...selection,effort:'invented'}}));
    levels=['low'];connection=await controller.call('model-api/save',{id:connection.id,revision:connection.revision,connection:{...connection,models:connection.models}}) as ModelConnection;
    await controller.call('session/model-target',{sessionId:session.id,targetId:target.id});assert.equal(store.snapshot().sessions[0]!.modelSelection?.effort,'low','Explicit selection repairs a mapping with removed metadata');
    await controller.call('model-api/set-enabled',{id:connection.id,enabled:false,revision:connection.revision});
    assert.equal((await controller.call('model-targets/list') as ModelTarget[]).length,0);await assert.rejects(controller.call('session/create',{modelTargetId:target.id,modelSelection:selection}));
    loaded=await new StateStore(directory).load();assert.deepEqual(loaded.lastModelSelection,selection,'Unavailable source is not silently replaced');assert.ok(requests>0);
  }finally{await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
