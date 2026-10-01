import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,copyFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PortableWorkspaceService} from '../packages/workspace-control/portable';
import {publicKeyFingerprint} from '../packages/workspace-control/validation';
import type {SshHost} from '../packages/contracts';
import type {SshRunner} from '../packages/ssh-transport';

const hostKey='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4';
async function fixture(port=22,managed=false,ttlSeconds=3600){
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-portable-'));
 const admin:SshHost={id:'admin',name:'Fixture',hostname:'fixture.invalid',port,username:'root',role:'admin',identityFile:path.join(directory,'admin-unread'),knownHostsFile:path.join(directory,'pins-unread'),ownerId:'local-owner',workspaceGeneration:'g'};
 const member:SshHost={...admin,id:'member',name:'Study',username:'member',role:'workspace',...(managed?{authorityId:'fixture-authority',authorityGeneration:'generation-one',remoteWorkspaceId:'workspace-one',workspaceGeneration:'workspace-generation'}:{})};
 const file=path.join(directory,'space.awworkspace');let used=false,authorized='',failVerification=false,enrollments=0,label='';
 const runner:SshRunner=async(host,command,options)=>{
  const reply=(stdout:string,exitCode=0,stderr='')=>({stdout,exitCode,stderr,signal:null});
  if(command.startsWith('exec /usr/bin/python3')){const request=JSON.parse(options!.stdin!);assert.equal(request.ttlSeconds,ttlSeconds);assert.equal('expires' in request,false);if(managed){assert.equal(request.workspaceId,'workspace-one');assert.equal(request.authorityId,'fixture-authority');assert.equal(request.generation,'generation-one');}return reply(JSON.stringify({username:'member',uid:1001,root:'/home/member',hostPublicKeys:[hostKey],issuedAtEpoch:1700000000,expiresAtEpoch:1700000000+request.ttlSeconds}));}
  if(command==='id -un && id -u'){
   assert.equal(await readFile(host.knownHostsFile,'utf8'),`${port===22?'fixture.invalid':`[fixture.invalid]:${port}`} ${hostKey}\n`);
   const key=(await readFile(host.identityFile+'.pub','utf8')).trim().split(' ').slice(0,2).join(' ');
   return reply(authorized===key&&!failVerification?'member\n1001\n':'',authorized===key&&!failVerification?0:255);
  }
  assert.equal(command,'enroll');enrollments++;
  if(used)return reply('',255,'Permission denied (publickey).');
  used=true;const request=JSON.parse(options!.stdin!);authorized=request.publicKey;label=request.deviceLabel;
  const bundle=JSON.parse(await readFile(file,'utf8'));
  return reply(JSON.stringify({inviteId:bundle.inviteId,username:'member',uid:1001,fingerprint:publicKeyFingerprint(authorized)}));
 };
 const service=new PortableWorkspaceService(directory,runner);await service.export(admin,member,file,ttlSeconds);
 return {directory,file,service,runner,get enrollments(){return enrollments;},get label(){return label;},failVerification:(value:boolean)=>{failVerification=value;},close:async()=>{await service.dispose();await rm(directory,{recursive:true,force:true});}};
}
for(const port of [22,2222])test(`SSH export authorizes once, preserves device name, and writes exact host pins on port ${port}`,async()=>{
 const f=await fixture(port);try{
  const preview=await f.service.preview(f.file);assert.ok(!JSON.stringify(preview).includes('PRIVATE KEY'));
  const host=await f.service.import(preview.previewId,'Veloria desktop');assert.equal(f.label,'Veloria desktop');assert.match(host.deviceId!,/^ssh-/);
  assert.equal(host.authorityId??'',preview.authorityId);assert.equal(host.remoteWorkspaceId,preview.workspaceId);assert.equal(preview.transport,'ssh');
  await assert.rejects(f.service.preview(f.file),/文件已失效，请向管理员重新获取/);
  await assert.rejects(f.service.import(preview.previewId,'Again'),/文件已失效/);assert.equal(f.enrollments,1);
  const otherRoot=path.join(f.directory,'second-device'),other=new PortableWorkspaceService(otherRoot,f.runner);
  try{const second=await other.preview(f.file);await assert.rejects(other.import(second.previewId,'Other'),/文件已失效/);}finally{await other.dispose();}
  const restarted=new PortableWorkspaceService(f.directory,f.runner);try{await assert.rejects(restarted.preview(f.file),/文件已失效/);}finally{await restarted.dispose();}
 }finally{await f.close();}
});

test('managed SSH files preserve the real authority and workspace identity through preview and import',async()=>{
 const f=await fixture(22,true);try{
  const preview=await f.service.preview(f.file),host=await f.service.import(preview.previewId,'Desktop');
  assert.equal(preview.authorityId,'fixture-authority');assert.equal(preview.workspaceId,'workspace-one');
  assert.equal(host.authorityId,preview.authorityId);assert.equal(host.remoteWorkspaceId,preview.workspaceId);
  assert.equal(host.authorityGeneration,'generation-one');assert.equal(host.workspaceGeneration,'workspace-generation');
 }finally{await f.close();}
});
test('unconfirmed SSH import recovers only its original key and then invalidates the file',async()=>{
 const f=await fixture();try{
  f.failVerification(true);const preview=await f.service.preview(f.file);
  await assert.rejects(f.service.import(preview.previewId,'Original'),/新密钥的 SSH 校验/);
  const retry=await f.service.preview(f.file);assert.equal(retry.resumeExistingDevice,true);f.failVerification(false);
  await f.service.import(retry.previewId,'Original');assert.equal(f.enrollments,1);
  await assert.rejects(f.service.preview(f.file),/文件已失效/);
 }finally{await f.close();}
});
test('copies of a consumed file cannot grant another identity',async()=>{
 const f=await fixture();try{
  const copied=path.join(f.directory,'copy.awworkspace');await copyFile(f.file,copied);
  await f.service.import((await f.service.preview(f.file)).previewId,'Original');
  await assert.rejects(f.service.preview(copied),/文件已失效/);
 }finally{await f.close();}
});

for(const ttl of [3600,21600,43200,86400,604800])test(`server controls ${ttl}s expiry despite device clock offset`,async t=>{
 const f=await fixture(22,false,ttl);try{
  const descriptor=JSON.parse(await readFile(f.file,'utf8'));
  assert.equal(Date.parse(descriptor.expiresAt), (1700000000+ttl)*1000);
  t.mock.method(Date,'now',()=>Date.UTC(2099,0,1));
  await f.service.import((await f.service.preview(f.file)).previewId,'Ahead device');
  t.mock.method(Date,'now',()=>0);
  const other=new PortableWorkspaceService(path.join(f.directory,'behind'),f.runner);
  try{await assert.rejects(other.import((await other.preview(f.file)).previewId,'Behind device'),/文件已失效/);}finally{await other.dispose();}
 }finally{t.mock.restoreAll();await f.close();}
});
