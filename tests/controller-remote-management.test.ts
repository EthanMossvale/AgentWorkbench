import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WorkbenchController,type HostActions} from '../apps/desktop/host/controller';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import type {SshHost} from '../packages/contracts';
import {HostServiceRegistry} from '../packages/plugins-core/services';

async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-remote-maintenance-'));
 const store=new StateStore(directory);await store.load();let browserBusy=false,applies=0;const controls:any[]=[];
 let release!:()=>void;const pending=new Promise<void>(r=>{release=r;});
 const actions:HostActions={pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],
  remoteCli:{list:async()=>[],plan:async()=>{throw Error('Fixture does not inspect real CLI');},apply:async()=>{applies++;await pending;return {provider:'codex'} as any;}},
  remoteBrowser:{control:async(_host,action,options)=>{controls.push({action,...options});return {running:action!=='stop',viewerReady:action!=='stop',profilesPreserved:true};},busy:()=>browserBusy,dispose:async()=>{},profiles:async()=>({installed:true,missing:[],profiles:[]}),setup:async()=>({configured:true}),start:async()=>{throw Error('Real authorization forbidden');},status:()=>{throw Error('No login');},openViewer:async()=>{throw Error('Real browser forbidden');},code:()=>{throw Error('No login');},cancel:async()=>{throw Error('No login');}},
 };
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>{throw Error('No credentials');}}),actions,()=>{});
 const host=await controller.call('host/save',{host:{id:'admin',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:path.join(directory,'unused-key'),knownHostsFile:path.join(directory,'unused-hosts')}}) as SshHost;
 return {controller,host,store,release,controls,setBusy:(v:boolean)=>{browserBusy=v;},applies:()=>applies,close:async()=>{release();await controller.dispose();await rm(directory,{recursive:true,force:true});}};
}

test('pending browser cleanup freezes SSH identity and removal but permits a display name change',async()=>{
 const f=await fixture();try{
  f.setBusy(true);
  await assert.rejects(f.controller.call('host/save',{host:{...f.host,hostname:'other.invalid'}}),/远端登录或维护/);
  await assert.rejects(f.controller.call('host/remove',{id:f.host.id,confirm:true}),/回执/);
  await f.controller.call('host/save',{host:{...f.host,name:'Renamed fixture'}});
  f.setBusy(false);await f.controller.call('host/remove',{id:f.host.id,confirm:true});
  assert.equal(f.store.snapshot().hosts.length,0);
 }finally{await f.close();}
});

test('remote maintenance requires confirmation and freezes its host until the reply',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.controller.call('remote-cli/apply',{id:f.host.id,provider:'codex',planId:'fixture'}),/确认/);
  assert.equal(f.applies(),0);
  const applied=f.controller.call('remote-cli/apply',{id:f.host.id,provider:'codex',planId:'fixture',confirm:true});
  assert.equal(f.applies(),1);
  await assert.rejects(f.controller.call('remote-cli/apply',{id:f.host.id,provider:'codex',planId:'fixture',confirm:true}),/维护/);
  await assert.rejects(f.controller.call('host/save',{host:{...f.host,port:2222}}),/维护/);
  await assert.rejects(f.controller.call('host/remove',{id:f.host.id,confirm:true}),/回执/);
  f.release();await applied;
  await f.controller.call('host/save',{host:{...f.host,port:2222}});
 }finally{await f.close();}
});

test('member records cannot enter root browser or CLI management',async()=>{
 const f=await fixture();try{
  const host=await f.controller.call('host/save',{host:{...f.host,id:'member',username:'member',role:'workspace'}}) as SshHost;
  for(const method of ['remote-cli/list','remote-browser/profiles','remote-browser/setup-plan','remote-browser/start','remote-browser/launch','remote-browser/reconnect','remote-browser/stop'])await assert.rejects(f.controller.call(method,{id:host.id}),/管理员/);
  assert.equal(f.applies(),0);
 }finally{await f.close();}
});

test('browser control routes preserve selected identity, enforce stop confirmation and support service replacement',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.controller.call('remote-browser/stop',{id:f.host.id}),/确认关闭/);assert.equal(f.controls.length,0);
  await f.controller.call('remote-browser/launch',{id:f.host.id,profileKey:'a'.repeat(32)});
  await f.controller.call('remote-browser/reconnect',{id:f.host.id});
  await f.controller.call('remote-browser/stop',{id:f.host.id,confirm:true});
  assert.deepEqual(f.controls,[{action:'launch',profileKey:'a'.repeat(32)},{action:'reconnect',confirm:false},{action:'stop',confirm:true}]);
  const registry=new HostServiceRegistry();registry.register('actions.remote-browser',f.controller.developmentServices()['actions.remote-browser']!);
  const release=registry.override('actions.remote-browser',{control:async()=>({source:'extension'})});
  assert.deepEqual(await f.controller.call('remote-browser/reconnect',{id:f.host.id}),{source:'extension'});release();
  await f.controller.call('remote-browser/reconnect',{id:f.host.id});assert.equal(f.controls.length,4);
 }finally{await f.close();}
});
