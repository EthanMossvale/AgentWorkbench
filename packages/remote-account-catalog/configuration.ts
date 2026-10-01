import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {SshHost} from '../contracts';
import {runSsh,validateSshHost,type SshRunner} from '../ssh-transport';
import {workspaceHostIdentity} from '../workspace-control';
import {accountSetupScript} from './setup';

export type RemoteConfigurationOperation='install'|'update'|'uninstall';
export interface RemoteConfigurationPolicy {
 schemaVersion:1;revision:number;autoUpdate:boolean;lastAttemptTarget?:string;lastAttemptAt?:number;lastAttemptError?:string;
}
export interface RemoteConfigurationStatus {
 installed:boolean; running:boolean; currentVersion?:string; bundledVersion:string;
 canInstall:boolean; canUpdate:boolean; canUninstall:boolean; error?:string;
 installedRevision?:number;bundledRevision?:number;policy?:RemoteConfigurationPolicy;
}
export interface RemoteConfigurationPreview {
 token:string; operation:RemoteConfigurationOperation; currentVersion?:string; version?:string;
 targets:string[]; preserves:string[];
}
export interface RemoteConfigurationAdapter {
 status(host:SshHost):Promise<RemoteConfigurationStatus>;
 plan(host:SshHost,operation:RemoteConfigurationOperation):Promise<RemoteConfigurationPreview>;
 apply(host:SshHost,plan:RemoteConfigurationPreview):Promise<RemoteConfigurationStatus>;
 configure?(host:SshHost,revision:number,autoUpdate:boolean):Promise<RemoteConfigurationStatus>;
 autoUpdate?(host:SshHost):Promise<RemoteConfigurationStatus|undefined>;
}
export interface RemoteConfigurationDefinition {id:string;label:string;adapter:RemoteConfigurationAdapter}
export interface RemoteConfigurationRow extends RemoteConfigurationStatus {id:string;label:string}
export interface RemoteConfigurationPlan extends Omit<RemoteConfigurationPreview,'token'> {id:string;configurationId:string;label:string}
export interface RemoteConfigurationHandle {id:string;dispose():void}
export interface RemoteConfigurationService {
 register(owner:string,definition:RemoteConfigurationDefinition):RemoteConfigurationHandle;
 replace(id:string,adapter:RemoteConfigurationAdapter):RemoteConfigurationHandle;
 subscribe(listener:()=>void):()=>void;
 list(host:SshHost):Promise<RemoteConfigurationRow[]>;
 plan(host:SshHost,id:string,operation:RemoteConfigurationOperation):Promise<RemoteConfigurationPlan>;
 apply(host:SshHost,id:string,planId:string):Promise<RemoteConfigurationRow>;
 configure(host:SshHost,id:string,revision:number,autoUpdate:boolean):Promise<RemoteConfigurationRow>;
 autoUpdate(host:SshHost,id:string):Promise<RemoteConfigurationRow|undefined>;
}
type Entry={label:string;layers:RemoteConfigurationAdapter[];revision:number};
const line=(v:unknown,max=512):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const operation=(v:unknown):v is RemoteConfigurationOperation=>v==='install'||v==='update'||v==='uninstall';
function status(value:RemoteConfigurationStatus){
 if(!value||!['installed','running','canInstall','canUpdate','canUninstall'].every(k=>typeof (value as any)[k]==='boolean')||!line(value.bundledVersion,80)||value.currentVersion!==undefined&&!line(value.currentVersion,80)||value.error!==undefined&&!line(value.error))throw Error('远端配置状态回执无效。');
 for(const n of [value.installedRevision,value.bundledRevision])if(n!==undefined&&(!Number.isSafeInteger(n)||n<0))throw Error('远端配置版本回执无效。');
 const p=value.policy;
 if(p&&(p.schemaVersion!==1||!Number.isSafeInteger(p.revision)||p.revision<0||typeof p.autoUpdate!=='boolean'||p.lastAttemptTarget!==undefined&&!line(p.lastAttemptTarget,80)||p.lastAttemptAt!==undefined&&(!Number.isSafeInteger(p.lastAttemptAt)||p.lastAttemptAt<0)||p.lastAttemptError!==undefined&&!line(p.lastAttemptError,512)))throw Error('远端配置自动更新策略无效。');
 return {installed:value.installed,running:value.running,bundledVersion:value.bundledVersion,canInstall:value.canInstall,canUpdate:value.canUpdate,canUninstall:value.canUninstall,...(value.currentVersion?{currentVersion:value.currentVersion}:{}),...(value.error?{error:value.error}:{}),...(value.installedRevision!==undefined?{installedRevision:value.installedRevision}:{}),...(value.bundledRevision!==undefined?{bundledRevision:value.bundledRevision}:{}),...(p?{policy:{schemaVersion:1 as const,revision:p.revision,autoUpdate:p.autoUpdate,...(p.lastAttemptTarget?{lastAttemptTarget:p.lastAttemptTarget}:{}),...(p.lastAttemptAt!==undefined?{lastAttemptAt:p.lastAttemptAt}:{}),...(p.lastAttemptError?{lastAttemptError:p.lastAttemptError}:{})}}:{})};
}
export function configurationAutoUpdateEligible(row:RemoteConfigurationStatus){return !!(row.installed&&row.running&&row.canUpdate&&!row.error&&row.policy?.autoUpdate&&row.currentVersion!==row.bundledVersion&&row.bundledRevision!==undefined&&row.installedRevision!==undefined&&row.bundledRevision>row.installedRevision&&row.policy.lastAttemptTarget!==row.bundledVersion);}
/** The production directory owns UI rows, dispatch and one-use preview leases. */
export class RemoteConfigurationRegistry implements RemoteConfigurationService {
 private entries=new Map<string,Entry>();private listeners=new Set<()=>void>();
 private plans=new Map<string,{identity:string;id:string;adapter:RemoteConfigurationAdapter;revision:number;preview:RemoteConfigurationPreview;expires:number}>();
 private busy=new Set<string>();
 private automaticAttempts=new Set<string>();
 constructor(core:RemoteConfigurationAdapter=new WorkbenchConfigurationAdapter(),private now=Date.now){this.entries.set('workbench',{label:'工作台远端配置',layers:[core],revision:0});}
 subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 private changed(id:string){const entry=this.entries.get(id);if(entry)entry.revision++;for(const [key,p]of this.plans)if(p.id===id)this.plans.delete(key);for(const l of this.listeners)l();}
 private valid(adapter:RemoteConfigurationAdapter){if(!adapter||!['status','plan','apply'].every(k=>typeof (adapter as any)[k]==='function')||(adapter.configure!==undefined||adapter.autoUpdate!==undefined)&&!(typeof adapter.configure==='function'&&typeof adapter.autoUpdate==='function'))throw Error('REMOTE_CONFIGURATION_ADAPTER_INVALID');}
 register(owner:string,definition:RemoteConfigurationDefinition):RemoteConfigurationHandle{
  if(!/^[a-z][a-z0-9.-]{1,79}$/.test(owner)||owner==='core'||!definition||!/^[a-z][a-z0-9-]{0,63}$/.test(definition.id)||!line(definition.label,100))throw Error('REMOTE_CONFIGURATION_REGISTRATION_INVALID');
  this.valid(definition.adapter);const id=owner+':'+definition.id;if(this.entries.has(id))throw Error('REMOTE_CONFIGURATION_DUPLICATE');
  const entry={label:definition.label,layers:[definition.adapter],revision:0};this.entries.set(id,entry);this.changed(id);
  return {id,dispose:()=>{if(this.entries.get(id)===entry){this.entries.delete(id);this.changed(id);}}};
 }
 replace(id:string,adapter:RemoteConfigurationAdapter):RemoteConfigurationHandle{
  this.valid(adapter);const entry=this.entries.get(id);if(!entry)throw Error('REMOTE_CONFIGURATION_UNAVAILABLE');entry.layers.push(adapter);this.changed(id);let live=true;
  return {id,dispose:()=>{if(live){live=false;entry.layers.splice(entry.layers.indexOf(adapter),1);this.changed(id);}}};
 }
 private resolve(id:string){const entry=this.entries.get(id);if(!entry)throw Error('远端配置扩展已停用，请刷新。');return {entry,adapter:entry.layers.at(-1)!};}
 private current(id:string,adapter:RemoteConfigurationAdapter,revision:number){const current=this.resolve(id);if(current.adapter!==adapter||current.entry.revision!==revision)throw Error('远端配置实现已变化，请重新检查。');}
 private admin(host:SshHost){validateSshHost(host);if(host.role!=='admin'||host.username!=='root')throw Error('请从 root 管理员入口管理远端配置。');}
 async list(host:SshHost){this.admin(host);return (await Promise.all([...this.entries].map(async([id,e])=>{const revision=e.revision,adapter=e.layers.at(-1)!;let result:RemoteConfigurationStatus;try{result=status(await adapter.status(host));}catch(error){result={installed:false,running:false,bundledVersion:'待核实',canInstall:false,canUpdate:false,canUninstall:false,error:error instanceof Error?error.message.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,512):'远端配置状态未确认。'};}if(this.entries.get(id)!==e||e.revision!==revision||e.layers.at(-1)!==adapter)return undefined;return {...result,id,label:e.label};}))).filter((r):r is RemoteConfigurationRow=>!!r);}
 async plan(host:SshHost,id:string,op:RemoteConfigurationOperation){
  this.admin(host);if(!operation(op))throw Error('无效的配置维护操作。');const {entry,adapter}=this.resolve(id),revision=entry.revision,preview=await adapter.plan(host,op);this.current(id,adapter,revision);
  if(!preview||preview.operation!==op||!line(preview.token,256)||!Array.isArray(preview.targets)||!preview.targets.length||preview.targets.length>64||!preview.targets.every(p=>line(p,4096)&&p.startsWith('/')&&!p.split('/').includes('..'))||!Array.isArray(preview.preserves)||preview.preserves.length>20||!preview.preserves.every(p=>line(p,120))||preview.currentVersion!==undefined&&!line(preview.currentVersion,80)||preview.version!==undefined&&!line(preview.version,80))throw Error('远端配置维护计划无效。');
  const identity=workspaceHostIdentity(host);for(const [key,p]of this.plans)if(p.expires<this.now()||p.identity===identity&&p.id===id)this.plans.delete(key);
  const planId=randomUUID();this.plans.set(planId,{identity,id,adapter,revision,preview:structuredClone(preview),expires:this.now()+300000});const {token,...publicPlan}=preview;return {...publicPlan,id:planId,configurationId:id,label:entry.label};
 }
 async apply(host:SshHost,id:string,planId:string){
  this.admin(host);const identity=workspaceHostIdentity(host),p=this.plans.get(planId);
  if(!p||p.id!==id||p.identity!==identity||p.expires<this.now())throw Error('配置维护预览已过期或连接已变化，请重新检查。');this.current(id,p.adapter,p.revision);
  if(this.busy.has(identity))throw Error('远端配置正在维护，请等待回执。');this.plans.delete(planId);this.busy.add(identity);
  try{const result=status(await p.adapter.apply(host,p.preview));this.current(id,p.adapter,p.revision);return {...result,id,label:this.resolve(id).entry.label};}finally{this.busy.delete(identity);}
 }
 async configure(host:SshHost,id:string,revision:number,autoUpdate:boolean){
  this.admin(host);if(!Number.isSafeInteger(revision)||revision<0||typeof autoUpdate!=='boolean')throw Error('REMOTE_CONFIGURATION_POLICY_INVALID');
  const {entry,adapter}=this.resolve(id),generation=entry.revision,identity=workspaceHostIdentity(host);
  if(!adapter.configure)throw Error('REMOTE_CONFIGURATION_AUTO_UPDATE_UNSUPPORTED');
  if(this.busy.has(identity))throw Error('远端配置正在维护，请等待回执。');this.busy.add(identity);
  try{const result=status(await adapter.configure(host,revision,autoUpdate));this.current(id,adapter,generation);if(!result.policy||result.policy.autoUpdate!==autoUpdate||result.policy.revision<=revision)throw Error('远端配置策略保存结果未确认，请刷新核对。');this.changed(id);return {...result,id,label:entry.label};}finally{this.busy.delete(identity);}
 }
 async autoUpdate(host:SshHost,id:string){
  this.admin(host);const {entry,adapter}=this.resolve(id),generation=entry.revision,identity=workspaceHostIdentity(host);
  if(!adapter.autoUpdate||this.busy.has(identity))return undefined;
  this.busy.add(identity);
  let attempted=false;
  try{
   const before=status(await adapter.status(host));this.current(id,adapter,generation);if(!configurationAutoUpdateEligible(before))return undefined;
   const attempt=identity+'|'+id+'|'+before.bundledVersion;if(this.automaticAttempts.has(attempt))return undefined;this.automaticAttempts.add(attempt);attempted=true;
   const value=await adapter.autoUpdate(host);this.current(id,adapter,generation);
   if(value===undefined){this.automaticAttempts.delete(attempt);return undefined;}
   const result=status(value);this.changed(id);return {...result,id,label:entry.label};
  }catch(error){if(attempted)this.changed(id);throw error;}finally{this.busy.delete(identity);}
 }
}
const errors:Record<string,string>={
 CONFIG_CHANGED:'远端配置已变化，请重新预览。',CONFIG_FOREIGN:'远端存在非本工具版本的程序或服务覆盖，未覆盖或删除。',CONFIG_BUSY:'远端仍有运行时、登录或维护进程，请结束后再操作。',
 CONFIG_PENDING:'维护记录无法核实，已保留原文件；请核对远端服务。',CONFIG_REVIEW_REQUIRED:'上次维护结果未确认。请重新检查并预览当前文件，再决定恢复安装、更新或卸载；不会自动重试。',CONFIG_ROLLED_BACK:'更新未通过验证，已恢复原程序及服务状态；请刷新后检查。',CONFIG_ROLLBACK_FAILED:'维护与回退未确认，恢复记录已保留，请核对远端服务。',
 CONFIG_UNCONFIRMED:'远端维护结果未确认，请刷新核对；不会自动重试。',ADMIN_REQUIRED:'请从 root 管理员入口管理远端配置。',CONFIG_SYSTEMD:'远端需要 systemd 服务管理。',CONFIG_IDENTITY:'远端服务身份与已有配置不一致，未更改账号。',
 CONFIG_POLICY_INVALID:'远端自动更新策略损坏或版本不受支持，原文件已保留。',CONFIG_POLICY_CHANGED:'自动更新设置已被另一处修改，请刷新后再操作。',CONFIG_NEWER_INSTALLED:'远端配置比本机携带的版本更新，请先升级工作台。',CONFIG_RELEASE_INVALID:'本机远端配置包的版本清单无效，未执行更新。',
};
export function remoteConfigurationScript(request:unknown){
 const root=typeof __dirname==='string'?path.join(__dirname,'account-runtime'):path.resolve('services/vps-account-broker');
 const extra=Buffer.from(JSON.stringify({request,source:readFileSync(path.join(root,'configuration.py'),'utf8'),known:JSON.parse(readFileSync(path.join(root,'configuration-known.json'),'utf8')),release:JSON.parse(readFileSync(path.join(root,'configuration-release.json'),'utf8'))})).toString('base64');
 const base=accountSetupScript({method:'plan'});return base.slice(0,base.lastIndexOf('print(json.dumps('))+`q=json.loads(base64.b64decode('${extra}'))\nm=types.ModuleType('configuration');exec(compile(q['source'],'configuration.py','exec'),m.__dict__)\nprint(json.dumps(m.dispatch(q['request'],sources,q['known'],q['release']),separators=(',',':')))\n`;
}
export class WorkbenchConfigurationAdapter implements RemoteConfigurationAdapter {
 constructor(private runner:SshRunner=runSsh){}
 private async request(host:SshHost,request:unknown){const result=await this.runner(host,'exec python3 -B -',{stdin:remoteConfigurationScript(request),timeoutMs:180000,maxOutputBytes:65536});let response:any;try{response=JSON.parse(result.stdout);}catch{throw Error(errors.CONFIG_UNCONFIRMED);}if(result.exitCode!==0||response?.ok!==true)throw Error(errors[response?.error]??errors.CONFIG_UNCONFIRMED);return response.value;}
 private row(value:any):RemoteConfigurationStatus {if(value?.error)value={...value,error:errors[value.error]??errors.CONFIG_UNCONFIRMED};if(value?.policy?.lastAttemptError)value={...value,policy:{...value.policy,lastAttemptError:errors[value.policy.lastAttemptError]??errors.CONFIG_UNCONFIRMED}};return status(value);}
 async status(host:SshHost){return this.row(await this.request(host,{method:'status'}));}
 async plan(host:SshHost,op:RemoteConfigurationOperation){return await this.request(host,{method:'plan',operation:op}) as RemoteConfigurationPreview;}
 async apply(host:SshHost,plan:RemoteConfigurationPreview){return this.row(await this.request(host,{method:'apply',operation:plan.operation,token:plan.token}));}
 async configure(host:SshHost,revision:number,autoUpdate:boolean){return this.row(await this.request(host,{method:'configure',revision,autoUpdate}));}
 async autoUpdate(host:SshHost){const value=await this.request(host,{method:'auto-update'});return value==null?undefined:this.row(value);}
}
