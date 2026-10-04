import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,lstat,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import type {SshHost} from '../contracts';
import {runSsh,buildSshEnvironment,type SshRunner,type SshResult} from '../ssh-transport';
import {privateDirectory} from './enrollment';
import {publicKey,publicKeyFingerprint,safeText} from './validation';
import {PORTABLE_ENROLL,portablePrepareScript} from './portable-script';
import type {WorkspaceImportPreview} from './types';
import {workspaceExportTtl} from './export-policy';
import {restrictPrivatePath} from '../ssh-transport/private-files';
import {sshFailure} from '../ssh-transport/diagnostics';

const execute=promisify(execFile);
const keygen=process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32/OpenSSH/ssh-keygen.exe'):'/usr/bin/ssh-keygen';
const python=(source:string)=>`exec /usr/bin/python3 -c "import base64;exec(base64.b64decode('${Buffer.from(source).toString('base64')}'))"`;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const INVALID_WORKSPACE_FILE='文件已失效，请向管理员重新获取。';
// Runs as root over the administrator connection: append the device key to the member's
// authorized_keys once (idempotent by key blob) and return the server's pinned host key.
const DIRECT_AUTHORIZE=String.raw`
import os,sys,json,pwd
request=json.loads(sys.stdin.readline())
user=pwd.getpwnam(request['username'])
folder=os.path.join(user.pw_dir,'.ssh')
os.makedirs(folder,mode=0o700,exist_ok=True)
os.chown(folder,user.pw_uid,user.pw_gid)
path=os.path.join(folder,'authorized_keys')
try:content=open(path,'rb').read()
except FileNotFoundError:content=b''
if request['publicKey'].split()[1].encode() not in content:
    with open(path,'ab') as output:output.write((b'' if not content or content.endswith(b'\n') else b'\n')+request['line'].encode()+b'\n')
os.chown(path,user.pw_uid,user.pw_gid)
os.chmod(path,0o600)
with open('/etc/ssh/ssh_host_ed25519_key.pub') as source:hostkey=' '.join(source.read().split()[:2])
print(json.dumps({'hostPublicKey':hostkey}))
`;
type ImportStage='PROBE'|'ENROLL'|'VERIFY';
/** Classify locally; remote output, addresses and key material never become UI diagnostics. */
function importFailure(stage:ImportStage,result?:SshResult,error?:unknown){
 const failure=sshFailure(result,error);
 let code=failure?.code??'REPLY_UNCONFIRMED',reason=failure?.message??'未收到符合预期的服务器回执，请管理员检查 SSH 登记命令。';
 if(code==='AUTH_REJECTED'&&stage==='ENROLL')reason=INVALID_WORKSPACE_FILE;
 else if(result?.stdout.includes('ENROLLMENT_FAILED')){code='ENROLLMENT_REJECTED';reason=INVALID_WORKSPACE_FILE;}
 else if(result?.exitCode===0){code='REPLY_INVALID';reason='服务器返回的登记或身份回执不匹配，请管理员检查成员身份和登录脚本。';}
 const title=stage==='VERIFY'?'设备登记已返回，但新密钥的 SSH 校验尚未通过。':'设备登记尚未确认。';
 return new Error(`${title}${reason} 本机密钥已保留；请在同一台电脑重新选择原文件恢复。诊断码：WORKSPACE_IMPORT_${stage}_${code}`);
}
type Bundle={schema:'agent-workbench-ssh-invite';version:1;inviteId:string;expiresAt:string;workspaceName:string;username:string;uid:number;root:string;hostname:string;port:number;hostPublicKeys:string[];bootstrapKey:string;bootstrapPublicKey:string;authorityId?:string;authorityGeneration?:string;workspaceId?:string;workspaceGeneration?:string};
async function small(file:string){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>65536)throw new Error('工作空间文件类型或大小不正确。');return readFile(file,'utf8');}
async function atomic(file:string,value:string){const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,value,{flag:'wx',mode:0o600});try{await rename(temp,file);}catch(e){await unlink(temp).catch(()=>{});throw e;}}
async function generate(file:string){await execute(keygen,['-t','ed25519','-N','','-C','','-f',file],{windowsHide:true,env:buildSshEnvironment(),timeout:10000});restrictPrivatePath(file,'file');}
function bundle(value:unknown):Bundle{
 const b=value as Bundle;
 if(!b||b.schema!=='agent-workbench-ssh-invite'||b.version!==1||!/^[-a-f0-9]{36}$/.test(b.inviteId)||!Number.isFinite(Date.parse(b.expiresAt))||!safeText(b.workspaceName,256)||!b.workspaceName||!safeText(b.hostname,253)||!/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(b.hostname)||!Number.isInteger(b.port)||b.port<1||b.port>65535||!Number.isInteger(b.uid)||b.uid<1000||!/^\/[a-zA-Z0-9_./-]+$/.test(b.root)||b.root.split('/').includes('..')||!/^[-a-z_][-a-z_0-9]{0,31}$/.test(b.username)||b.username==='root'||!Array.isArray(b.hostPublicKeys)||b.hostPublicKeys.length!==1||typeof b.bootstrapKey!=='string'||!/^-----BEGIN OPENSSH PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END OPENSSH PRIVATE KEY-----\r?\n?$/.test(b.bootstrapKey)||b.bootstrapKey.length>4096)throw new Error('工作空间邀请格式无效。');
 const binding=[b.authorityId,b.authorityGeneration,b.workspaceId,b.workspaceGeneration];
 if(binding.some(value=>value!==undefined)&&!binding.every(value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)))throw new Error('工作空间身份绑定无效。');
 publicKey(b.bootstrapPublicKey,true);b.hostPublicKeys.forEach(key=>publicKey(key));return b;
}
export class PortableWorkspaceService{
 private previews=new Map<string,Bundle>();private pending=new Set<Promise<unknown>>();private busy=new Set<string>();private stopped=false;
 constructor(private directory:string,private runner:SshRunner=runSsh){}
 private assertOpen(){if(this.stopped)throw new Error('工作台正在退出。');}
 has(id:string){return this.previews.has(id);}
 async dispose(){this.stopped=true;await Promise.allSettled([...this.pending]);this.previews.clear();}
 private track<T>(operation:Promise<T>){this.pending.add(operation);void operation.finally(()=>this.pending.delete(operation)).catch(()=>{});return operation;}
 export(admin:SshHost,member:SshHost,file:string,ttlSeconds=3600){this.assertOpen();return this.track(this.exportOnce(admin,member,file,workspaceExportTtl(ttlSeconds)));}
 private async exportOnce(admin:SshHost,member:SshHost,file:string,ttlSeconds:number){
  if(admin.role!=='admin'||member.role!=='workspace'||member.username==='root'||admin.hostname!==member.hostname||admin.port!==member.port||admin.ownerId!==member.ownerId)throw new Error('导出必须由同一 VPS 的管理员为成员工作空间授权。');
  const id=randomUUID(),directory=path.join(this.directory,'workspace-exports',id);await privateDirectory(directory);
  const keyfile=path.join(directory,'bootstrap-key');await generate(keyfile);this.assertOpen();
  const publickey=publicKey((await small(keyfile+'.pub')).trim(),true);
  // The selected filename and fresh key remain locally recoverable if SSH acknowledgement is lost.
  await atomic(path.join(directory,'export.json'),JSON.stringify({id,file,username:member.username,ttlSeconds}));
  const response=await this.runner(admin,python(portablePrepareScript(PORTABLE_ENROLL)),{stdin:JSON.stringify({username:member.username,inviteId:id,publicKey:publickey,ttlSeconds,...(member.authorityId?{authorityId:member.authorityId,generation:member.authorityGeneration,workspaceId:member.remoteWorkspaceId}:{})})+'\n',timeoutMs:20000,maxOutputBytes:16384});
  let remote;try{remote=JSON.parse(response.stdout);}catch{throw new Error('导出授权回执未确认；本机恢复记录已保留，请勿重复导出。');}
  if(response.exitCode!==0||remote.error||remote.username!==member.username)throw new Error('远端未能完成工作空间导出。请核实成员目录所有者、SSH 文件权限与空间启用状态。');
  if(!Number.isSafeInteger(remote.issuedAtEpoch)||!Number.isSafeInteger(remote.expiresAtEpoch)||remote.expiresAtEpoch-remote.issuedAtEpoch!==ttlSeconds)throw new Error('远端授权有效期回执无效；请核实后重新导出。');
  const descriptor=bundle({schema:'agent-workbench-ssh-invite',version:1,inviteId:id,expiresAt:new Date(remote.expiresAtEpoch*1000).toISOString(),workspaceName:member.name,username:member.username,uid:remote.uid,root:remote.root,hostname:member.hostname,port:member.port,hostPublicKeys:remote.hostPublicKeys,bootstrapKey:await small(keyfile),bootstrapPublicKey:publickey,...(member.authorityId?{authorityId:member.authorityId,authorityGeneration:member.authorityGeneration,workspaceId:member.remoteWorkspaceId,workspaceGeneration:member.workspaceGeneration}:{})});
  await atomic(file,JSON.stringify(descriptor,null,2));return {saved:true,path:file,expiresAt:descriptor.expiresAt};
 }
 /** The administrator's root SSH writes this device's key directly; no invitation or expiry is involved. */
 connectDirect(admin:SshHost,member:SshHost,label:string){this.assertOpen();return this.track(this.connectDirectOnce(admin,member,label));}
 private async connectDirectOnce(admin:SshHost,member:SshHost,label:string):Promise<SshHost>{
  const directory=path.join(this.directory,'workspace-devices','admin-'+digest(`${admin.hostname}:${admin.port}:${member.username}`).slice(0,32));await privateDirectory(directory);
  const identityFile=path.join(directory,'device-key'),knownHostsFile=path.join(directory,'known_hosts');
  try{await lstat(identityFile);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;await generate(identityFile);}
  restrictPrivatePath(identityFile,'file');
  const key=publicKey((await small(identityFile+'.pub')).trim(),true),hex=digest(key),deviceId=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
  const line=`${key} aw-device:${deviceId}:${Buffer.from(label).toString('base64url')}:${Math.floor(Date.now()/1000)}`;
  const response=await this.runner(admin,python(DIRECT_AUTHORIZE),{stdin:JSON.stringify({username:member.username,publicKey:key,line})+'\n',timeoutMs:20000,maxOutputBytes:4096});
  let remote;try{remote=JSON.parse(response.stdout);}catch{}
  if(response.exitCode!==0||!remote?.hostPublicKey)throw new Error(`管理员 SSH 未能为成员登记本机密钥。${sshFailure(response)?.message??''}`);
  const knownName=member.port===22?member.hostname:`[${member.hostname}]:${member.port}`;
  await atomic(knownHostsFile,`${knownName} ${remote.hostPublicKey}\n`);
  const host:SshHost={...member,id:randomUUID(),identityFile,knownHostsFile,deviceId:'ssh-'+deviceId};
  const observed=await this.runner(host,'id -un',{timeoutMs:15000,maxOutputBytes:1024}).catch(error=>{throw new Error(`本机密钥已登记，但成员 SSH 登录失败：${sshFailure(undefined,error)?.message??String(error)}`);});
  if(observed.exitCode!==0||observed.stdout.trim()!==member.username)throw new Error(`本机密钥已登记，但成员 SSH 登录失败：${sshFailure(observed)?.message??'返回的用户不匹配。'}`);
  return host;
 }
 async preview(file:string):Promise<WorkspaceImportPreview>{
  this.assertOpen();const b=bundle(JSON.parse(await small(file)));const directory=path.join(this.directory,'workspace-devices','ssh-'+b.inviteId);
  let resume=false;try{resume=(JSON.parse(await small(path.join(directory,'binding.json'))).digest===digest(JSON.stringify(b)));}catch{}
  try{await lstat(path.join(directory,'completed.json'));throw new Error(INVALID_WORKSPACE_FILE);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const id=randomUUID();if(this.previews.size>=16)this.previews.clear();this.previews.set(id,b);
  return {previewId:id,workspaceName:b.workspaceName,username:b.username,hostname:b.hostname,port:b.port,expiresAt:b.expiresAt,authorityId:b.authorityId??'',workspaceId:b.workspaceId??b.username,enrollmentUrl:`SSH ${b.hostname}:${b.port}`,resumeExistingDevice:resume,transport:'ssh'};
 }
 import(id:string,label:string){this.assertOpen();const b=this.previews.get(id);if(!b||!safeText(label,100)||!label.trim())throw new Error('请重新选择文件并填写设备名称。');if(this.busy.has(b.inviteId))throw new Error('此文件正在导入。');this.busy.add(b.inviteId);return this.track(this.enroll(b,label).finally(()=>this.busy.delete(b.inviteId)));}
 private async enroll(b:Bundle,label:string):Promise<SshHost>{
  const directory=path.join(this.directory,'workspace-devices','ssh-'+b.inviteId);await privateDirectory(directory);
  try{await lstat(path.join(directory,'completed.json'));throw new Error(INVALID_WORKSPACE_FILE);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const bindingFile=path.join(directory,'binding.json'),identityFile=path.join(directory,'device-key'),bootstrapFile=path.join(directory,'bootstrap-key'),knownHostsFile=path.join(directory,'known_hosts');
  const binding=digest(JSON.stringify(b));let saved:{digest:string;hostId:string};
  try{saved=JSON.parse(await small(bindingFile));if(saved.digest!==binding||!/^[-a-f0-9]{36}$/.test(saved.hostId))throw new Error('邀请绑定不匹配。');}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;for(const file of [identityFile,identityFile+'.pub']){try{await lstat(file);throw new Error('此目录已有未绑定的设备密钥，不能覆盖。');}catch(cause){if((cause as NodeJS.ErrnoException).code!=='ENOENT')throw cause;}}saved={digest:binding,hostId:randomUUID()};await atomic(bindingFile,JSON.stringify(saved));}
  try{const info=await lstat(identityFile);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw new Error('设备密钥文件无效。');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;await generate(identityFile);}
  const devicePublic=publicKey((await small(identityFile+'.pub')).trim(),true);
  restrictPrivatePath(identityFile,'file');
  const host:SshHost={id:saved.hostId,name:b.workspaceName+' · '+label,hostname:b.hostname,port:b.port,username:b.username,role:'workspace',identityFile,knownHostsFile,ownerId:'local-owner',workspaceGeneration:b.workspaceGeneration??b.inviteId,remoteWorkspaceId:b.workspaceId??b.username,deviceId:'ssh-'+b.inviteId,...(b.authorityId?{authorityId:b.authorityId,authorityGeneration:b.authorityGeneration}:{})};
  const knownName=b.port===22?b.hostname:`[${b.hostname}]:${b.port}`;
  await atomic(knownHostsFile,b.hostPublicKeys.map(key=>`${knownName} ${key}\n`).join(''));
  const complete=async()=>{await atomic(path.join(directory,'completed.json'),JSON.stringify({hostId:host.id,completedAt:new Date().toISOString()}));await unlink(bootstrapFile).catch(()=>{});return host;};
  const verify=async():Promise<{verified:boolean;result?:SshResult;error?:unknown}>=>{try{const r=await this.runner(host,'id -un && id -u',{timeoutMs:15000,maxOutputBytes:1024});return {verified:r.exitCode===0&&r.stdout.trim()===`${b.username}\n${b.uid}`,result:r};}catch(error){return {verified:false,error};}};
  // A newly generated key cannot authenticate before enrollment. A previous success can
  // recover a lost reply using that exact device key, even after the invitation expires.
  const previous=await verify();if(previous.verified)return complete();
  const probeFailure=sshFailure(previous.result,previous.error);
  if(previous.error||previous.result?.exitCode===0||probeFailure&&!['AUTH_REJECTED','PROCESS_FAILED'].includes(probeFailure.code))throw importFailure('PROBE',previous.result,previous.error);
  this.assertOpen(); // Only the issuing SSH server decides expiry; client clocks are untrusted.
  await atomic(bootstrapFile,b.bootstrapKey);
  restrictPrivatePath(bootstrapFile,'file');
  const derived=await execute(keygen,['-y','-f',bootstrapFile],{windowsHide:true,env:buildSshEnvironment(),timeout:10000});
  if(publicKey(derived.stdout.trim(),true)!==b.bootstrapPublicKey)throw new Error('邀请密钥与公钥不匹配。');
  let result:SshResult|undefined,failure:unknown;
  try{result=await this.runner({...host,identityFile:bootstrapFile},'enroll',{stdin:JSON.stringify({publicKey:devicePublic,deviceLabel:label})+'\n',timeoutMs:20000,maxOutputBytes:4096});}catch(error){failure=error;}
  let receipt;try{receipt=JSON.parse(result?.stdout??'');}catch{}
  // A lost enrollment reply can still be confirmed with this device's saved key.
  // This is a read-only identity probe, never a second enrollment request.
  const current=await verify();
  if(!current.verified){
   const valid=result?.exitCode===0&&receipt?.inviteId===b.inviteId&&receipt?.username===b.username&&receipt?.uid===b.uid&&receipt?.fingerprint===publicKeyFingerprint(devicePublic);
   throw valid?importFailure('VERIFY',current.result,current.error):importFailure('ENROLL',result,failure);
  }
  return complete();
 }
}
