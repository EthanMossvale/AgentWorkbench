import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import {RemoteAccountCatalogService} from '../packages/remote-account-catalog';
import {discoverWorkspaces} from '../services/host-control';
import type {SshHost} from '../packages/contracts';
test('approved plugin observes real SSH failures, replaces account reads and restores core after disable and reenable',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-ssh-read-')),store=new StateStore(directory);await store.load();
 const host:SshHost={id:'fixture',name:'Fixture',hostname:'fixture.invalid',port:22,username:'member',role:'workspace',identityFile:path.join(directory,'key'),knownHostsFile:path.join(directory,'known-hosts'),ownerId:'fixture',workspaceGeneration:'1'};await store.update(s=>{s.hosts=[host];});
 const runner=async()=>({exitCode:255,stdout:'',stderr:'Permission denied PRIVATE_SENTINEL',signal:null});
 const accountCatalog=new RemoteAccountCatalogService({runner});
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No secrets');},decrypt:()=>{throw Error('No secrets');}}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],accountCatalog,discoverWorkspaces:h=>discoverWorkspaces(h,{runner})},()=>{});
 const plugins=new PluginRegistry(path.join(directory,'plugins'));for(const [id,service]of Object.entries(controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});plugins.connectHost(r=>controller.call(r.method,r.payload));await plugins.initialize();
 const source=`export function activate(api){let hits=0;api.services.intercept('accounts.catalog','list',async(next,...args)=>{hits++;const value=await next(...args);if(!value.reason.includes('SSH_AUTH_REJECTED'))throw Error('Missing diagnostic');return {...value,reason:'Plugin account read'};});api.registerCommand('read',()=>api.call('accounts/list',{id:'fixture'}));api.registerCommand('discover',()=>api.call('host/discover',{id:'fixture'}));api.registerCommand('hits',()=>hits);}`;
 try{const file=path.join(directory,'fixture.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id:'test.ssh-read',name:'SSH read fixture',version:'1.0.0',description:'Synthetic lifecycle verification',capabilities:['host'],main:'main.mjs'}))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(file);const entry=(await plugins.list())[0]!;
 await assert.rejects(plugins.setEnabled(entry.manifest.id,entry.hash,true),/Explicit approval/);
 for(let i=0;i<2;i++){await plugins.setEnabled(entry.manifest.id,entry.hash,true,true);assert.equal((await plugins.command(entry.manifest.id,'read',{}) as any).reason,'Plugin account read');await assert.rejects(plugins.command(entry.manifest.id,'discover',{}),/SSH_AUTH_REJECTED/);assert.equal(await plugins.command(entry.manifest.id,'hits',{}),1);await plugins.setEnabled(entry.manifest.id,entry.hash,false);const result=await controller.call('accounts/list',{id:host.id}) as any;assert.match(result.reason,/SSH_AUTH_REJECTED/);assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));}
 }finally{await plugins.dispose();await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
