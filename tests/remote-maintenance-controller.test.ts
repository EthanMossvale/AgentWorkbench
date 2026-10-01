import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {WorkbenchController,type HostActions} from '../apps/desktop/host/controller';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import type {Session,SshHost} from '../packages/contracts';
import {HostServiceRegistry} from '../packages/plugins-core/services';

async function fixture(overrides:Partial<HostActions>={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-resource-controller-')),store=new StateStore(directory);await store.load();
 const host:SshHost={id:'admin',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:path.join(directory,'key'),knownHostsFile:path.join(directory,'hosts'),ownerId:'fixture',workspaceGeneration:'g'};
 const session:Session={id:'session',projectId:null,title:'Fixture',pinned:false,archived:false,group:'',createdAt:new Date().toISOString(),status:'uncertain',binding:{runtime:'codex',provider:'openai',accountRef:'vps-account:fixture/g/codex/account/a',executionId:'local-device',egress:'vps',hostId:'admin',accountRuntime:'native-owner',nativeSessionId:'thread'},nativeTurnId:'turn',messages:[{id:'old-input',role:'user',original:'fixture',timestamp:new Date().toISOString()}]} as Session;
 await store.update(s=>{s.hosts=[host];s.sessions=[session];});
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>{throw Error('No credentials');}}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],...overrides},()=>{});
 return {host,store,controller,close:async()=>{await controller.dispose();await rm(directory,{recursive:true,force:true});}};
}
test('confirmed remote interruption releases only the same unchanged native turn',async()=>{
 let release!:(v:any)=>void;const pending=new Promise<any>(r=>release=r);
 const f=await fixture({remoteResources:{read:()=>pending} as any});
 try{
  const read=f.controller.call('remote-resources/read',{id:f.host.id});
  await f.store.update(s=>{s.sessions[0]!.messages.push({id:'new-input',role:'user',original:'new',demo:false,timestamp:new Date().toISOString()});});
  release({runtime:{interrupted:[{sessionId:'session',threadId:'thread',turnId:'turn'}]}});await read;
  assert.equal(f.store.snapshot().sessions[0]!.status,'uncertain');
  await f.controller.call('remote-resources/read',{id:f.host.id});
  assert.equal(f.store.snapshot().sessions[0]!.status,'idle');assert.equal(f.store.snapshot().sessions[0]!.nativeTurnStatus,'interrupted');
  assert.equal(f.store.snapshot().sessions[0]!.messages.length,2);
 }finally{await f.close();}
});
test('a receipt from another native turn cannot clear local uncertainty',async()=>{
 const f=await fixture({remoteResources:{read:async()=>({runtime:{interrupted:[{sessionId:'session',threadId:'thread',turnId:'older-turn'}]}})} as any});
 try{await f.controller.call('remote-resources/read',{id:f.host.id});assert.equal(f.store.snapshot().sessions[0]!.status,'uncertain');}finally{await f.close();}
});
test('shutdown during retention cancels the cycle without starting either automatic updater',async()=>{
 let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);let updates=0;
 const f=await fixture({sessionStorage:{reclaim:async()=>{started();await waiting;throw Error('Cancelled');},dispose:()=>release()} as any,remoteCliPolicies:{autoUpdate:async()=>{updates++;},configure:async()=>{throw Error('Not used');}}});
 try{const cycle=f.controller.maintainRemote();await entered;await f.controller.dispose();await cycle;assert.equal(updates,0);}finally{await f.close();}
});
test('retention freezes its connection identity without taking the whole CLI admission lock',async()=>{
 let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);
 const f=await fixture({sessionStorage:{reclaim:async()=>{started();await waiting;},dispose:()=>release()} as any});
 try{const cycle=f.controller.maintainRemote();await entered;
  await assert.rejects(f.controller.call('host/remove',{id:f.host.id,confirm:true}),/回执/);
  // Admission proceeds to the normal bridge capability check, rather than
  // being blocked by an unrelated session's archive transfer.
  await assert.rejects(f.controller.call('draft/prepare',{sessionId:'session',text:'fixture'}),/H 原生桥/);
  release();await cycle;
 }finally{await f.close();}
});
test('resource development service replacement reaches real IPC and disposal restores it',async()=>{
 const core={runtime:{interrupted:[]},marker:'core'},replacement={runtime:{interrupted:[]},marker:'extension'};
 const f=await fixture({remoteResources:{read:async()=>core} as any});
 try{const registry=new HostServiceRegistry();registry.register('actions.remote-resources',f.controller.developmentServices()['actions.remote-resources']!);
  const release=registry.override('actions.remote-resources',{read:async()=>replacement});
  assert.equal((await f.controller.call('remote-resources/read',{id:f.host.id}) as any).marker,'extension');release();
  assert.equal((await f.controller.call('remote-resources/read',{id:f.host.id}) as any).marker,'core');
 }finally{await f.close();}
});
