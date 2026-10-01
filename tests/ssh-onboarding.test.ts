import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SshOnboardingService,parseConnectionConfig} from '../apps/desktop/host/ssh-onboarding';
import type {SshHost} from '../packages/contracts';

const key='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4';
const syntheticPrivateKey='-----BEGIN OPENSSH PRIVATE KEY-----\nSYNTHETIC KEY FIXTURE\n-----END OPENSSH PRIVATE KEY-----\n';
test('literal SSH config import fills endpoint user and paths without evaluating executable directives',()=>{
 const home=path.resolve('synthetic-home');
 const entries=parseConnectionConfig('Host japan\n HostName 192.0.2.12\n Port 53222\n User root\n IdentityFile "~/.ssh/selected key"\nHost writing\n HostName writing.invalid\n User writer\n',home);
 assert.equal(entries.length,2);assert.deepEqual(entries[0],{name:'japan',hostname:'192.0.2.12',port:53222,username:'root',identityFile:path.join(home,'.ssh/selected key'),knownHostsFile:''});assert.equal(entries[1]?.port,22);
 for(const extra of ['ProxyCommand echo secret','Match exec command','Include ~/.ssh/private','LocalCommand run','IdentityAgent agent','Host *'])assert.throws(()=>parseConnectionConfig('Host test\n HostName fixture.invalid\n'+extra));
 assert.throws(()=>parseConnectionConfig('-----BEGIN OPENSSH PRIVATE KEY-----\nSYNTHETIC\n'),/选择密钥文件/);
});

test('file selection is read-only and confirmed key copying uses private .ssh storage without replacing existing keys',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-ssh-onboarding-'));
 try{
  const source=path.join(directory,'selected-file'),home=path.join(directory,'home');await writeFile(source,syntheticPrivateKey);await mkdir(path.join(home,'.ssh'),{recursive:true});await writeFile(path.join(home,'.ssh','existing'),'PRESERVE');
  const service=new SshOnboardingService({directory,home,pickFile:async()=>source});
  const selected=await service.pick('key');assert.ok(selected&&'keySelectionId' in selected);assert.deepEqual(await readdir(path.join(home,'.ssh')),['existing']);assert.ok(!JSON.stringify(selected).includes('SYNTHETIC KEY'));
  const saved=await service.installKey(selected.keySelectionId!);assert.ok(saved.path.startsWith(path.join(home,'.ssh','agent-workbench')+path.sep));assert.equal(await readFile(saved.path,'utf8'),syntheticPrivateKey);assert.equal(await readFile(source,'utf8'),syntheticPrivateKey);assert.equal(await readFile(path.join(home,'.ssh','existing'),'utf8'),'PRESERVE');assert.deepEqual(await service.installKey(selected.keySelectionId!),saved);
  await assert.rejects(service.installKey('renderer-invented-path'),/重新选择/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('click and dropped files share format detection without copying or revealing key contents',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-ssh-drop-'));
 try{
  const home=path.join(directory,'home'),source=path.join(directory,'vps-key'),config=path.join(directory,'connection-any-name');await writeFile(source,syntheticPrivateKey);await writeFile(config,'# safe literal config\nHost server\n HostName fixture.invalid\n Port 53222\n User root\n IdentityFile "'+source.replaceAll('\\','/')+'"\nHost second\n HostName second.invalid\n');
  const service=new SshOnboardingService({directory,home,pickFile:async()=>config});
  const picked=await service.pick('key'),dropped=await service.importFile(config),selected=await service.importFile(source);
  for(const result of [picked,dropped]){assert.equal(result?.entries?.length,2);assert.equal(result.entries[0]?.hostname,'fixture.invalid');assert.equal(result.entries[0]?.port,53222);assert.ok(result.entries[0]?.keySelectionId);assert.equal(result.entries[1]?.keySelectionId,undefined);}
  assert.ok(selected.keySelectionId);assert.equal(selected.path,source);assert.equal(JSON.stringify(selected).includes('SYNTHETIC KEY'),false);await assert.rejects(readdir(home),{code:'ENOENT'});
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('unified import rejects public identity records, executable config and unsupported files',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-ssh-invalid-'));
 try{
  const service=new SshOnboardingService({directory,pickFile:async()=>null});
  const fixtures:[string,string,RegExp][]=[['known_hosts',`fixture.invalid ${key}\n`,/不能代替登录密钥/],['renamed-host-record',`[fixture.invalid]:53222 ${key}\n`,/known_hosts/],['key.pub',key,/公钥/],['vps.ppk','PuTTY-User-Key-File-3: ssh-ed25519',/PuTTYgen/],['config','Host fixture\n ProxyCommand echo example\n',/未执行/],['empty','',/64 KB/],['large','x'.repeat(65537),/64 KB/],['arbitrary.txt','not a connection',/未支持/]];
  for(const [name,contents,message] of fixtures){const file=path.join(directory,name);await writeFile(file,contents);await assert.rejects(service.importFile(file),message);}
  const known=path.join(directory,'known_hosts');assert.deepEqual(await service.importFile(known,'known-hosts'),{path:known});await assert.rejects(service.importFile(directory),/64 KB/);await assert.rejects(service.importFile('relative-key'),/本机/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

for(const port of [22,53222])test(`host trust requires explicit confirmation bound to endpoint on port ${port}`,async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-ssh-trust-'));
 try{
  const service=new SshOnboardingService({directory,pickFile:async()=>null,scan:async()=>`fixture.invalid ${key}\n`});
  const preview=await service.scan('fixture.invalid',port);assert.equal(preview.fingerprints.length,1);assert.ok(!('keys' in preview));assert.deepEqual(await readdir(directory),[]);
  await assert.rejects(service.trust(preview.id,false,'fixture.invalid',port),/核对/);
  await assert.rejects(service.trust(preview.id,true,'other.invalid',port),/核对/);
  const saved=await service.trust(preview.id,true,'fixture.invalid',port);assert.equal(await readFile(saved.path,'utf8'),`${port===22?'fixture.invalid':`[fixture.invalid]:${port}`} ${key}\n`);
  await assert.rejects(service.trust(preview.id,true,'fixture.invalid',port),/核对/);
  await assert.rejects(service.scan('-bad',port),/有效/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('verification checks actual remote UID and reports bounded actionable errors',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-ssh-identity-'));
 try{
  const identityFile=path.join(directory,'synthetic-key');await writeFile(identityFile,'SYNTHETIC');
  const host:SshHost={id:'candidate',name:'Server',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile,knownHostsFile:path.join(directory,'pins'),ownerId:'local-owner',workspaceGeneration:'g'};
  let stdout='root\n0\n',stderr='',exitCode=0;
  const service=new SshOnboardingService({directory,pickFile:async()=>null,runner:async(_host,command)=>{assert.equal(command,'id -un && id -u');return {stdout,stderr,exitCode,signal:null};}});
  assert.deepEqual(await service.verify(host),{verified:true});stdout='root\n1000\n';await assert.rejects(service.verify(host),/没有管理员权限/);stdout='root\n0\n';await assert.rejects(service.verify({...host,role:'workspace'}),/root 是管理员/);exitCode=255;stderr='WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! private data';await assert.rejects(service.verify(host),error=>error instanceof Error&&/服务器身份/.test(error.message)&&!error.message.includes('private data'));
 }finally{await rm(directory,{recursive:true,force:true});}
});
