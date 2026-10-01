import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {WorkbenchController,type HostActions} from '../apps/desktop/host/controller';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import type {SshHost} from '../packages/contracts';

test('an approved ZIP reaches recent host features and disable restores live services without reverting preferences',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-recent-plugins-')),store=new StateStore(directory);await store.load();
  const host:SshHost={id:'admin',name:'Synthetic',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:path.join(directory,'unused-key'),knownHostsFile:path.join(directory,'unused-hosts'),ownerId:'fixture',workspaceGeneration:'generation'};
  await store.update(state=>{state.hosts=[host];});
  const plugins=new PluginRegistry(path.join(directory,'plugins'));await plugins.initialize();
  const actions:HostActions={pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],remoteCli:{list:async()=>[],plan:async()=>{throw Error('Unused');},apply:async()=>{throw Error('Unused');}},sessionStorage:{inspect:async()=>({sessions:[],marker:'core'}),logs:async()=>({entries:[],marker:'core'}),dispose:()=>{}} as any};
  const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No secrets');},decrypt:()=>{throw Error('No secrets');}}),actions,state=>plugins.publish({type:'state',payload:state}));
  for(const [id,service] of Object.entries(controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
  const core=(request:{method:string;payload:unknown})=>controller.call(request.method,request.payload);plugins.connectHost(core);
  const manifest={schemaVersion:1,apiVersion:1,id:'test.recent-features',name:'Recent feature fixture',version:'1.0.0',description:'Isolated plugin lifecycle check',capabilities:['host'],main:'main.mjs'};
  const source=`export function activate(api){
    const hits=[];for(const [id,method] of [['models.accounts','call'],['sidebar.order','observe'],['actions.remote-cli','list'],['actions.session-storage','inspect'],['actions.session-storage','logs']])api.services.intercept(id,method,(next,...args)=>{hits.push(id+'.'+method);return next(...args);});
    api.registerCommand('hits',()=>hits);api.registerCommand('toggle',()=>api.call('translation/quick-toggle',{show:false}));
    api.services.override('actions.session-storage',{logs:async()=>({entries:[],marker:'plugin'})});
  }`;
  try{
    const zip=path.join(directory,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(zip);const record=(await plugins.list())[0]!;
    await assert.rejects(plugins.setEnabled(manifest.id,record.hash,true),/Explicit approval/);await plugins.setEnabled(manifest.id,record.hash,true,true);
    await plugins.command(manifest.id,'toggle',{});assert.equal(store.snapshot().translationQuickToggle?.show,false);
    await controller.call('models/accounts/list');await controller.call('remote-cli/list',{id:host.id});await controller.call('remote-storage/inspect',{id:host.id,provider:'codex'});
    assert.equal((await controller.call('remote-storage/logs',{id:host.id,provider:'codex'}) as any).marker,'plugin');
    const hits=await plugins.command(manifest.id,'hits',{}) as string[];for(const member of ['models.accounts.call','sidebar.order.observe','actions.remote-cli.list','actions.session-storage.inspect'])assert.ok(hits.includes(member),member);
    await plugins.setEnabled(manifest.id,record.hash,false);assert.equal((await controller.call('remote-storage/logs',{id:host.id,provider:'codex'}) as any).marker,'core');assert.equal(store.snapshot().translationQuickToggle?.show,false);
    await plugins.setEnabled(manifest.id,record.hash,true);assert.equal((await controller.call('remote-storage/logs',{id:host.id,provider:'claude'}) as any).marker,'plugin');
    await plugins.setEnabled(manifest.id,record.hash,false);assert.equal((await controller.call('remote-storage/logs',{id:host.id,provider:'claude'}) as any).marker,'core');
  }finally{await plugins.dispose();await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
