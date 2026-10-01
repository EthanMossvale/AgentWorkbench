import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {unknownProfile,projectEnvironment,PROFILE_FIELDS} from '../services/environment-profile';
import type {SshHost,Session} from '../packages/contracts';
async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-selection-'));const store=new StateStore(directory);await store.load();
 const host=(id:string,role:SshHost['role']='workspace'):SshHost=>({id,name:id,hostname:'fixture.invalid',port:22,username:role==='admin'?'root':id,role,identityFile:path.join(directory,'key'),knownHostsFile:path.join(directory,'known'),ownerId:'owner',workspaceGeneration:id});
 const a=host('alpha'),b=host('beta'),admin=host('root','admin');await store.update(s=>{s.hosts=[a,b,admin];});
 let probes=0,reads=0,verifications=0;const profile=(h:SshHost)=>({...unknownProfile(h),validUntil:new Date(Date.now()+60000).toISOString()});
 const actions={verifyWorkspaceMember:async(h:SshHost)=>{verifications++;return {username:h.username,uid:1000};},pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],probeEnvironment:async(h:SshHost)=>{probes++;return profile(h);},accountCatalog:{list:async()=>{reads++;return {availability:'unavailable' as const,authorityId:'',generation:'',revision:0,selectionRevision:0,workspaceId:'',accounts:[]};},select:async()=>{throw Error('No selection');},start:async()=>{throw Error('No login');},status:async()=>{throw Error('No status');},cancel:async()=>{throw Error('No cancel');},dispose:async()=>{}}};
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No secrets');},decrypt:()=>''}),actions,()=>{});
 return {directory,store,a,b,admin,actions,controller,profile,counts:()=>({probes,reads,verifications}),close:async()=>{await controller.dispose();await rm(directory,{recursive:true,force:true});}};
}
test('SSH selection verifies member identity and reads public accounts without environment projection',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.controller.call('workspace/select',{id:f.admin.id}),/管理员/);
  await f.controller.call('workspace/select',{id:f.a.id});await f.controller.call('workspace/select',{id:f.a.id});assert.deepEqual(f.counts(),{probes:0,reads:2,verifications:2});
  const session=await f.controller.call('session/create',{runtime:'claude'}) as Session;assert.equal(session.binding.hostId,f.a.id);
  await f.controller.call('workspace/select',{id:f.b.id});assert.equal(f.store.snapshot().sessions[0]?.binding.hostId,f.a.id);
  const reloaded=new StateStore(f.directory);await reloaded.load();assert.equal(reloaded.snapshot().activeWorkspaceId,f.b.id);
 }finally{await f.close();}
});
test('late member verification cannot overwrite a newer SSH selection',async()=>{
 const f=await fixture();try{
  let resolve!:(value:{username:string;uid:number})=>void;
  f.actions.verifyWorkspaceMember=async h=>h.id===f.a.id?new Promise(done=>{resolve=done;}):{username:h.username,uid:1000};
  const old=f.controller.call('workspace/select',{id:f.a.id});await f.controller.call('workspace/select',{id:f.b.id});resolve({username:f.a.username,uid:1000});await assert.rejects(old,/选择已变化/);assert.equal(f.store.snapshot().activeWorkspaceId,f.b.id);
 }finally{await f.close();}
});
test('model environment projection drops unsupported stored inventory and never substitutes local values',async()=>{
 const f=await fixture();try{const profile=f.profile(f.a);profile.fields.localSerial={status:'known',source:'ssh-allowlist',value:'must-not-leak'};const result=projectEnvironment(profile,{hostId:f.a.id,ownerId:f.a.ownerId});assert.deepEqual(Object.keys(result.fields),[...PROFILE_FIELDS]);assert.ok(!JSON.stringify(result).includes('must-not-leak'));assert.equal(result.fields.os?.value,null);}finally{await f.close();}
});
