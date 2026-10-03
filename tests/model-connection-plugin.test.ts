import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { PluginRegistry } from '../packages/plugins-core';
import { encodeZip } from '../packages/native-resources/archive';
import { NativeResources } from '../apps/desktop/host/native-resources';
import { SharedMemoryStore } from '../packages/memory-core';
import { SharedSkillsStore } from '../packages/skills-core';
import type { ModelConnection, ModelTarget } from '../packages/model-api/types';

test('approved connection plugin calls and replaces actual save consumers with retained settings and disable recovery', async () => {
  const home=await mkdtemp(path.join(os.tmpdir(),'awb-connection-plugin-'));
  const store=new StateStore(home);await store.load();
  const native=new NativeResources(home,{openZip:async()=>null,saveZip:async()=>null},()=>[],()=>{},home,{cliOptions:{executables:{codex:process.execPath,claude:process.execPath}}});
  const requests: string[]=[];
  const controller=new WorkbenchController(store,new SecretStore(path.join(home,'secrets'),{encrypt:s=>Buffer.from(s).reverse(),decrypt:b=>Buffer.from(b).reverse().toString()}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],modelFetcher:async(url,init)=>{
    requests.push(String(url));assert.equal(init?.method,'GET');return Response.json({data:[{id:'fixture-model'}]});
  }},()=>{},{memory:new SharedMemoryStore(home),skills:new SharedSkillsStore(home),native});
  const plugins=new PluginRegistry(path.join(home,'plugins'));await plugins.initialize();
  for(const [id,service] of Object.entries(controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
  const manifest={schemaVersion:1,apiVersion:1,id:'qa.connection-edit',name:'Connection edit fixture',version:'1.0.0',description:'Synthetic connection edit contract',capabilities:['host'],main:'main.mjs'};
  const source=`export function activate(api){
    const connections=api.services.get('model.connections');
    api.onDispose(api.services.get('models.reasoning-options').register({id:'plugin:'+api.id+'/depths',levels:()=>['vendor-depth']}));
    api.registerCommand('save',payload=>connections.call('model-api/save',payload));
    api.services.intercept('model.connections','call',(next,method,payload)=>next(method,method==='model-api/save'?{...payload,connection:{...payload.connection,name:'Plugin source'}}:payload));
  }`;
  const payload={connection:{name:'Core source',baseUrl:'https://fixture.invalid',protocol:'chat-completions',models:[{id:'mapped',model:'fixture-model',name:'Manual model',enabled:true,contextWindow:1048576,contextWindowSource:'manual',manualEfforts:['medium','vendor-depth'],defaultEffort:'vendor-depth'}]},key:'synthetic-plugin-key'};
  try{
    const file=path.join(home,'plugin.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));
    await plugins.importZip(file);const plugin=(await plugins.list())[0]!;
    await assert.rejects(plugins.setEnabled(manifest.id,plugin.hash,true),/Explicit approval/);
    await plugins.setEnabled(manifest.id,plugin.hash,true,true);
    let saved=await plugins.command(manifest.id,'save',payload) as ModelConnection;
    assert.equal(saved.name,'Plugin source');assert.equal(saved.baseUrl,'https://fixture.invalid');
    for(const enabled of [false,true,false]){
      await plugins.setEnabled(manifest.id,plugin.hash,enabled);
      saved=await controller.call('model-api/save',{id:saved.id,revision:saved.revision,connection:{...saved,name:'Core source',protocol:enabled?'responses':'anthropic-messages',baseUrl:'https://fixture.invalid/custom'}}) as ModelConnection;
      assert.equal((await controller.call('model-api/reasoning/options',{model:{...saved.models[0],manualEfforts:undefined,efforts:undefined}}) as string[]).includes('vendor-depth'),enabled);
      assert.equal(saved.name,enabled?'Plugin source':'Core source');assert.equal(saved.hasKey,true);
      assert.deepEqual(saved.models[0]!.manualEfforts,['medium','vendor-depth']);assert.equal(saved.models[0]!.defaultEffort,'vendor-depth');assert.equal(saved.models[0]!.contextWindow,1048576);
      const targets=await controller.call('model-targets/list') as ModelTarget[];
      assert.deepEqual(targets.map(t=>t.runtime),['codex','claude']);assert.ok(targets.every(t=>t.selection?.effort==='vendor-depth'&&t.contextWindow===1048576));
    }
    assert.ok(requests.includes('https://fixture.invalid/models'));assert.ok(requests.includes('https://fixture.invalid/custom/models'));
    const restarted=new StateStore(home);await restarted.load();assert.equal(restarted.snapshot().modelConnections![0]!.models[0]!.defaultEffort,'vendor-depth');
    assert.doesNotMatch(JSON.stringify(await controller.call('state/get')),/synthetic-plugin-key/);
  }finally{await plugins.dispose();await controller.dispose();await rm(home,{recursive:true,force:true});}
});
