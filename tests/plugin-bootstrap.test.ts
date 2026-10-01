import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { HostServiceRegistry } from '../packages/plugins-core/services';
import { PeerMcpSession } from '../packages/collaboration-core/mcp';
import type { Session } from '../packages/contracts';

test('service extension reaches the real controller state and both native tool bootstrap shapes',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'awb-plugin-bootstrap-')),store=new StateStore(dir);await store.load();
  let changes=0;
  const controller=new WorkbenchController(store,new SecretStore(dir,{encrypt:()=>{throw Error('No secrets');},decrypt:()=>''}),{pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{changes++;});
  const registry=new HostServiceRegistry(),cleanup:(()=>void)[]=[];
  try {
    for(const [id,service] of Object.entries(controller.developmentServices()))if(service)registry.register(id,service);
    const state=registry.get<{get():unknown;update(change:(state:any)=>void):Promise<unknown>}>('workbench.state');
    await state.update(s=>{s.theme='dark';});assert.equal(store.snapshot().theme,'dark');assert.equal(changes,1);
    const source=await controller.call('session/create',{projectId:null,runtime:'demo'}) as Session;
    const services=registry.scope(()=>{},release=>{cleanup.push(release);return release;});
    services.intercept('workbench.controller','nativePeerTools',(next,...args)=>{
      const base=next(...args) as ReturnType<WorkbenchController['nativePeerTools']>;
      return {...base,definitions:[...base.definitions,{name:'plugin_test_ping',description:'Return a synthetic local result.',inputSchema:{type:'object',properties:{}}}],call:async(name:string,input:unknown,signal?:AbortSignal)=>name==='plugin_test_ping'?{ready:true}:base.call(name,input,signal)};
    });
    const tools=controller.nativePeerTools(source.id);assert.equal(tools.sourceSessionId,source.id);
    assert.ok(tools.definitions.some(tool=>tool.name==='plugin_test_ping'));assert.ok(tools.definitions.some(tool=>tool.name==='workbench_list_sessions'));
    assert.deepEqual(await tools.call('plugin_test_ping',{}),{ready:true});
    const mcp=controller.nativePeerMcpSession(source.id);assert.ok(mcp instanceof PeerMcpSession);
    await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize'});await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
    assert.match(JSON.stringify(await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list'})),/plugin_test_ping/);
    const reply=await mcp.handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'plugin_test_ping',arguments:{}}}) as any;
    assert.equal(reply.result.isError,false);assert.deepEqual(JSON.parse(reply.result.content[0].text),{ready:true});mcp.dispose();
    for(const release of cleanup.splice(0).reverse())release();
    assert.ok(!controller.nativePeerTools(source.id).definitions.some(tool=>tool.name==='plugin_test_ping'));
    assert.throws(()=>controller.nativePeerTools('absent'));
  }finally{for(const release of cleanup.reverse())release();await controller.dispose();await rm(dir,{recursive:true,force:true});}
});
