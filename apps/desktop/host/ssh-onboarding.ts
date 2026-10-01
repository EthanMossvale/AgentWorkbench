import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {lstat,open,readFile,writeFile,copyFile,chmod,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import type {SshHost} from '../../../packages/contracts';
import {runSsh,buildSshEnvironment,validateSshHost,type SshRunner} from '../../../packages/ssh-transport';
import {privateDirectory} from '../../../packages/workspace-control/enrollment';
import {publicKey,publicKeyFingerprint} from '../../../packages/workspace-control/validation';

export interface SshConfigEntry {name:string;hostname:string;port:number;username:string;identityFile:string;knownHostsFile:string;keySelectionId?:string}
export interface HostKeyPreview {id:string;hostname:string;port:number;fingerprints:string[];expiresAt:string}
export interface SshFileSelection {path?:string;keySelectionId?:string;entries?:SshConfigEntry[]}
const execute=promisify(execFile);
function endpoint(hostname:unknown,port:unknown){if(typeof hostname!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}$/.test(hostname)||!Number.isInteger(port)||Number(port)<1||Number(port)>65535)throw Error('请填写有效的服务器地址与 1–65535 端口。');return {hostname,port:Number(port)};}

/** Read only a small literal subset. Never execute configuration directives. */
export function parseConnectionConfig(text:string,home=homedir()):SshConfigEntry[]{
 if(text.length>65536||text.includes('\0')||/PRIVATE KEY|PuTTY-User-Key-File/.test(text))throw Error('这是密钥或不支持的文件，请使用“选择密钥文件”。');
 const entries:SshConfigEntry[]=[];let current:Record<string,string>|null=null;const globals:Record<string,string>={};
 const allowed=new Set(['hostname','port','user','identityfile','userknownhostsfile']);
 const finish=()=>{if(!current)return;const values={...current};const port=Number(values.port??22),hostname=values.hostname??values.name!;endpoint(hostname,port);const resolve=(value='')=>{if(!value)return '';if(value.startsWith('~/')||value.startsWith('~\\'))return path.join(home,value.slice(2));if(!path.isAbsolute(value))throw Error('配置中的密钥与身份记录路径须为绝对路径；也可在下一步选择文件。');return value;};entries.push({name:values.name!,hostname,port,username:values.user??'root',identityFile:resolve(values.identityfile),knownHostsFile:resolve(values.userknownhostsfile)});};
 for(const line of text.split(/\r?\n/)){
  const trimmed=line.trim();if(!trimmed||trimmed.startsWith('#'))continue;
  const match=/^([A-Za-z]+)(?:\s*=\s*|\s+)(.*)$/.exec(trimmed);if(!match)throw Error('连接配置格式无法识别。');
  const field=match[1]!.toLowerCase();let value=match[2]!.trim();
  if(value.startsWith('"')){const quoted=/^"([^"\r\n]+)"(?:\s*#.*)?$/.exec(value);if(!quoted)throw Error('连接配置的引号格式无效。');value=quoted[1]!;}else value=value.replace(/\s+#.*$/,'').trim();
  if(field==='host'){finish();if(!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value))throw Error('暂不支持通配符或多别名配置，请选择单一服务器配置或手动填写。');current={...globals,name:value};}
  else if(allowed.has(field)){const target=current??globals;if(target[field]===undefined)target[field]=value;}
  else throw Error('此配置包含未支持的 SSH 选项；未执行其中任何命令。请改用手动填写。');
 }
 finish();if(!entries.length)throw Error('未找到 Host 连接配置。若这是私钥，请使用“选择密钥文件”。');return entries;
}

export class SshOnboardingService {
 private previews=new Map<string,{preview:HostKeyPreview;keys:string[]}>();
 private selectedKeys=new Map<string,{file:string;installed?:string}>();
 constructor(private options:{directory:string;home?:string;pickFile(kind:'key'|'config'|'known-hosts'):Promise<string|null>;runner?:SshRunner;scan?:(hostname:string,port:number)=>Promise<string>}){}
 private keySelection(file:string){if(this.selectedKeys.size>=32)this.selectedKeys.clear();const id=randomUUID();this.selectedKeys.set(id,{file});return id;}
 async pick(kind:'key'|'config'|'known-hosts'):Promise<SshFileSelection|null>{
  if(!['key','config','known-hosts'].includes(kind))throw Error('不支持的文件类型。');
  const file=await this.options.pickFile(kind);if(!file)return null;
  return this.importFile(file,kind);
 }
 async importFile(file:string,kind:'key'|'config'|'known-hosts'='key'):Promise<SshFileSelection>{
  if(!path.isAbsolute(file)||file.includes('\0'))throw Error('请从本机选择或拖入 SSH 文件。');
  const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size===0||info.size>65536)throw Error('请选择有效的小型 SSH 文件（最大 64 KB）。');
  if(kind==='known-hosts')return {path:file};
  if(kind==='key'){
   // Inspect only a bounded format header in the host; never send key bytes to the renderer.
   const handle=await open(file,'r');let header:string;
   try{const buffer=Buffer.alloc(2048),{bytesRead}=await handle.read(buffer,0,buffer.length,0);header=buffer.toString('utf8',0,bytesRead);}finally{await handle.close();}
   if(/\.ppk$/i.test(file)||header.startsWith('PuTTY-User-Key-File'))throw Error('这是 PuTTY 密钥，请先在 PuTTYgen 中导出 OpenSSH 格式。');
   if(/^-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/.test(header))return {path:file,keySelectionId:this.keySelection(file)};
   if(/^known_hosts(?:\.|$)/i.test(path.basename(file))||/^\s*(?:@\S+\s+)?\S+\s+(?:ssh-|ecdsa-|sk-)/m.test(header))throw Error('这是服务器身份记录 known_hosts，不能代替登录密钥。通常无需导入；已有可信记录可在高级设置中选择。');
   if(/^\s*(?:ssh-|ecdsa-|sk-)/.test(header))throw Error('这是公钥，请选择配套的私钥文件（通常不带 .pub 后缀）。');
  }
  return {entries:parseConnectionConfig(await readFile(file,'utf8'),this.options.home).map(entry=>({...entry,...(entry.identityFile?{keySelectionId:this.keySelection(entry.identityFile)}:{})}))};
 }
 async installKey(id:string){
  const selected=this.selectedKeys.get(id);if(!selected)throw Error('请重新选择要用于连接的 SSH 密钥文件。');if(selected.installed)return {path:selected.installed};
  const before=await lstat(selected.file);if(!before.isFile()||before.isSymbolicLink()||before.size>65536||before.size===0)throw Error('所选密钥文件不可用。');
  const directory=path.join(this.options.home??homedir(),'.ssh','agent-workbench',id);await privateDirectory(directory);const file=path.join(directory,'identity');
  await copyFile(selected.file,file,constants.COPYFILE_EXCL);
  try{const after=await lstat(selected.file);if(!after.isFile()||after.isSymbolicLink()||after.ino!==before.ino||after.dev!==before.dev||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('密钥文件在复制期间已变化，请重新选择。');await chmod(file,0o600);}catch(error){await unlink(file).catch(()=>{});throw error;}
  selected.installed=file;return {path:file};
 }
 async scan(hostname:unknown,port:unknown):Promise<HostKeyPreview>{
  const target=endpoint(hostname,port);
  let output:string;
  try{output=this.options.scan?await this.options.scan(target.hostname,target.port):(await execute(process.platform==='win32'?path.join(process.env.SystemRoot??'C:\\Windows','System32/OpenSSH/ssh-keyscan.exe'):'/usr/bin/ssh-keyscan',['-T','8','-p',String(target.port),'-t','ed25519',target.hostname],{windowsHide:true,timeout:12000,maxBuffer:65536,env:buildSshEnvironment()})).stdout;}catch{throw Error('未能读取服务器身份。请核对 IP、SSH 端口及网络连接。');}
  const keys=[...new Set(output.split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{const parts=line.trim().split(/\s+/);if(parts.length!==3)throw Error('服务器身份返回格式无效。');return publicKey(parts.slice(1).join(' '),true);}))];
  if(keys.length!==1)throw Error('未取得唯一服务器身份，请向管理员核对。');
  const preview={id:randomUUID(),...target,fingerprints:keys.map(publicKeyFingerprint),expiresAt:new Date(Date.now()+300000).toISOString()};
  if(this.previews.size>=16)this.previews.clear();this.previews.set(preview.id,{preview,keys});return preview;
 }
 async trust(id:string,confirm:boolean,hostname:unknown,port:unknown){
  const target=endpoint(hostname,port),saved=this.previews.get(id);
  if(!confirm||!saved||Date.parse(saved.preview.expiresAt)<=Date.now()||saved.preview.hostname!==target.hostname||saved.preview.port!==target.port)throw Error('请重新读取并核对当前服务器的身份指纹。');
  this.previews.delete(id);const directory=path.join(this.options.directory,'ssh-host-pins');await privateDirectory(directory);
  const file=path.join(directory,id+'.known_hosts'),name=target.port===22?target.hostname:`[${target.hostname}]:${target.port}`;
  await writeFile(file,saved.keys.map(key=>`${name} ${key}\n`).join(''),{flag:'wx',mode:0o600});return {path:file};
 }
 async verify(host:SshHost){
  validateSshHost(host);
  const info=await lstat(host.identityFile);if(!info.isFile()||info.isSymbolicLink())throw Error('密钥文件不可用，请重新选择。');
  let result;try{result=await (this.options.runner??runSsh)(host,'id -un && id -u',{timeoutMs:15000,maxOutputBytes:4096});}catch{throw Error('SSH 连接未完成，请检查地址、端口和网络后重试。');}
  if(result.exitCode!==0){if(/host key|HOST IDENTIFICATION|known_hosts/i.test(result.stderr))throw Error('服务器身份与已保存记录不符。请先向管理员核对，不要直接忽略。');throw Error('SSH 登录失败。请核对服务器用户名与密钥是否配套。当前暂不支持密码登录或需要口令的密钥。');}
  const lines=result.stdout.trim().split(/\r?\n/);if(lines.length!==2||lines[0]!==host.username||!/^\d+$/.test(lines[1]??''))throw Error('服务器未返回可核实的登录身份。');
  if(host.role==='admin'&&lines[1]!=='0')throw Error('已登录，但此账号没有管理员权限。请选择成员角色，或使用服务器管理员账号。');
  if(host.role==='workspace'&&lines[1]==='0')throw Error('root 是管理员账号，请选择管理员角色。');return {verified:true};
 }
}
