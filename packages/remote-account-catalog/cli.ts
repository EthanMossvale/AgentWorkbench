import {randomUUID} from 'node:crypto';
import type {SshHost} from '../contracts';
import {runSsh,validateSshHost,type SshRunner} from '../ssh-transport';
import {workspaceHostIdentity} from '../workspace-control';
import {accountSetupScript} from './setup';
import {retentionPolicy,RETENTION_MIN_HOURS,RETENTION_MAX_HOURS} from './retention-types';

export type RemoteCliProvider='codex'|'claude';
export type RemoteCliOperation='install'|'update'|'uninstall';
export interface RemoteCliPolicy {revision:number;autoUpdate:boolean;reclaimIdle:boolean;idleHours:number;lastUpdateAttempt?:number;lastUpdateError?:string}
export interface RemoteCli {policy?:RemoteCliPolicy}
export interface RemoteCliReleaseIssue {stage:'release'|'manifest'|'asset'|'installer';source:string;httpStatus?:number}
export interface RemoteCli {errorCode?:string;releaseIssue?:RemoteCliReleaseIssue}
export interface RemoteCli {provider:RemoteCliProvider;installed:boolean;executable:string;version?:string;latest?:string;managed:boolean;canUninstall:boolean;busy:boolean;revision:string;error?:string;installations:{path:string;version:string}[];detected:{path:string;status:string;version?:string}[]}
export interface RemoteCliPlan {id:string;provider:RemoteCliProvider;operation:RemoteCliOperation;currentVersion?:string;version?:string;targets:string[];size?:number}
const labels:Record<string,string>={CLI_POLICY_CHANGED:'策略已被其他窗口修改，请刷新后重新保存。',CLI_POLICY_INVALID:'清理策略无效；闲置时限须为 正整数小时。',CLI_POLICY_UNCONFIRMED:'策略写入后的回读未确认，请刷新核对；不会自动重试。',CLI_BUSY:'此运行时仍有登录或会话进程，请结束后再维护。',CLI_NOT_MANAGED:'这份程序不是工作台管理的安装；请沿用原安装渠道处理。',CLI_RELEASE_UNAVAILABLE:'官方最新版暂未核实，请刷新重试。',CLI_RELEASE_HTTP:'官方发布服务拒绝了请求，请稍后重试。',CLI_RELEASE_TIMEOUT:'读取官方发布信息超时，请稍后重试。',CLI_RELEASE_TLS:'官方源的 TLS 连接未通过校验，请检查远端证书与系统时间。',CLI_RELEASE_NETWORK:'远端未能连接官方发布服务，请检查该来源的 DNS 与连接。',CLI_RELEASE_INVALID:'官方发布信息格式或校验字段不完整，暂不可安装。',CLI_PLATFORM_UNSUPPORTED:'当前远端系统或架构不受此安装方式支持。',CLI_RUNTIME_RELOAD_FAILED:'程序已准备，但统一账号服务尚未确认切换。请重新检查实际状态。',CLI_OPERATION_UNCONFIRMED:'远端操作结果尚未确认，请刷新检查；不会自动重试。',CLI_INSTALL_CONFLICT:'程序目录与安装记录不一致，未覆盖或删除。',CLI_CHECKSUM_MISMATCH:'官方发布包校验失败，未执行。',PLAN_CHANGED:'远端安装或官方版本已变化，请重新预览。',CLI_DOWNLOAD_FAILED:'发布包下载未完成，请重新检查。'};
const releaseStages={release:'官方版本信息',manifest:'官方发布清单',asset:'官方发布包信息',installer:'官方安装脚本'};
function releaseIssue(value:any):RemoteCliReleaseIssue|undefined {
 if(!value||!Object.hasOwn(releaseStages,value.stage)||!['releases.openai.com','chatgpt.com','downloads.claude.ai','claude.ai'].includes(value.source)||value.httpStatus!==undefined&&(!Number.isInteger(value.httpStatus)||value.httpStatus<400||value.httpStatus>599))return undefined;
 return {stage:value.stage,source:value.source,...(value.httpStatus===undefined?{}:{httpStatus:value.httpStatus})};
}
function failure(code:string,issue?:RemoteCliReleaseIssue):string {
 if(code==='CLI_RELEASE_HTTP'&&issue?.httpStatus)return `${releaseStages[issue.stage]}返回 HTTP ${issue.httpStatus}，${issue.httpStatus===403?'请求被拒绝。':issue.httpStatus===404?'发布资源不存在。':issue.httpStatus===429?'请求受限，请稍后重试。':'请稍后重试。'}`;
 const label=Object.hasOwn(labels,code)?labels[code]!:labels.CLI_OPERATION_UNCONFIRMED!;
 return issue?`${releaseStages[issue.stage]}：${label}`:label;
}
const provider=(value:unknown):value is RemoteCliProvider=>value==='codex'||value==='claude';
const version=(value:unknown)=>value==null||typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value);
const file=(value:unknown):value is string=>typeof value==='string'&&value.length<=4096&&value.startsWith('/')&&!/[\x00-\x1f]/.test(value)&&!value.split('/').includes('..');

export class RemoteCliService {
 private plans=new Map<string,{identity:string;expires:number;remoteId:string;provider:RemoteCliProvider;operation:RemoteCliOperation}>();
 private busy=new Set<string>();
 constructor(private runner:SshRunner=runSsh,private now=Date.now){}
 private admin(host:SshHost){validateSshHost(host);if(host.role!=='admin'||host.username!=='root')throw Error('请从 SSH 管理员入口管理远端 CLI。');}
 private async request(host:SshHost,request:unknown){this.admin(host);const result=await this.runner(host,'exec python3 -B -',{stdin:accountSetupScript(request),timeoutMs:900000,maxOutputBytes:65536});let response:any;try{response=JSON.parse(result.stdout);}catch{throw Error(labels.CLI_OPERATION_UNCONFIRMED);}if(result.exitCode!==0||response?.ok!==true)throw Error(failure(response?.error,releaseIssue(response?.releaseIssue)));return response.value;}
 private row(value:any):RemoteCli{
  if(!value||!provider(value.provider)||!version(value.version)||!version(value.latest)||!['installed','managed','canUninstall','busy'].every(k=>typeof value[k]==='boolean')||typeof value.revision!=='string'||!/^[a-f0-9]{64}$/.test(value.revision)||value.executable!==''&&!file(value.executable)||!Array.isArray(value.installations)||value.installations.length>64||!Array.isArray(value.detected)||value.detected.length>64)throw Error('远端 CLI 状态回执无效。');
  const installations=value.installations.map((r:any)=>{if(!file(r.path)||!r.path.startsWith('/opt/agent-workbench/native/')||!r.version||!version(r.version))throw Error('远端安装记录无效。');return {path:r.path,version:r.version};});
  const detected=value.detected.map((r:any)=>{if(!file(r.path)||!version(r.version)||!['ready','private','version-mismatch','untrusted','unverified'].includes(r.status))throw Error('远端检测记录无效。');return {path:r.path,status:r.status,...(r.version?{version:r.version}:{})};});
  const issue=releaseIssue(value.releaseIssue);
  return {provider:value.provider,installed:value.installed,executable:value.executable,version:value.version??undefined,latest:value.latest??undefined,managed:value.managed,canUninstall:value.canUninstall,busy:value.busy,revision:value.revision,installations,detected,...(value.policy?{policy:this.policy(value.policy)}:{}),...(value.error?{error:failure(value.error,issue),...(Object.hasOwn(labels,value.error)?{errorCode:value.error}:{}),...(issue?{releaseIssue:issue}:{})}:{})};
 }
 private policy(value:any):RemoteCliPolicy {return retentionPolicy(value);}
 async configure(host:SshHost,p:RemoteCliProvider,revision:number,changes:Partial<Pick<RemoteCliPolicy,'autoUpdate'|'reclaimIdle'|'idleHours'>>){if(!provider(p)||!Number.isSafeInteger(revision)||revision<0||!changes||!Object.keys(changes).length||Object.entries(changes).some(([k,v])=>!['autoUpdate','reclaimIdle','idleHours'].includes(k)||(k==='idleHours'?!Number.isInteger(v)||Number(v)<RETENTION_MIN_HOURS||Number(v)>RETENTION_MAX_HOURS:typeof v!=='boolean')))throw Error('无效的远端 CLI 策略；闲置时限须为 正整数小时。');return this.policy(await this.request(host,{method:'cli/configure',provider:p,revision,changes}));}
 async autoUpdate(host:SshHost,p:RemoteCliProvider){if(!provider(p))throw Error('运行时无效。');return this.request(host,{method:'cli/auto-update',provider:p});}
 async list(host:SshHost){const value=await this.request(host,{method:'cli/list'});if(!Array.isArray(value)||value.length!==2||value[0]?.provider!=='codex'||value[1]?.provider!=='claude')throw Error('远端 CLI 列表无效。');return value.map(v=>this.row(v));}
 async plan(host:SshHost,p:RemoteCliProvider,operation:RemoteCliOperation):Promise<RemoteCliPlan>{
  if(!provider(p)||!['install','update','uninstall'].includes(operation))throw Error('不支持的远端 CLI 操作。');
  const value=await this.request(host,{method:'cli/plan',provider:p,operation});
  if(!value||value.provider!==p||value.operation!==operation||typeof value.planId!=='string'||!/^[a-f0-9]{64}$/.test(value.planId)||!version(value.version)||!version(value.currentVersion)||!Array.isArray(value.targets)||!value.targets.length||value.targets.length>64||value.targets.some((t:unknown)=>!file(t)||!t.startsWith('/opt/agent-workbench/native/')))throw Error('远端 CLI 计划回执无效。');
  const id=randomUUID(),identity=workspaceHostIdentity(host);for(const [key,plan] of this.plans)if(plan.expires<this.now()||plan.identity===identity&&plan.provider===p)this.plans.delete(key);
  this.plans.set(id,{identity,expires:this.now()+300000,remoteId:value.planId,provider:p,operation});
  return {id,provider:p,operation,currentVersion:value.currentVersion??undefined,version:value.version??undefined,targets:value.targets,...(Number.isSafeInteger(value.download?.size)&&value.download.size>0&&value.download.size<=500000000?{size:value.download.size}:{})};
 }
 async apply(host:SshHost,id:string,expectedProvider?:RemoteCliProvider){this.admin(host);const plan=this.plans.get(id),identity=workspaceHostIdentity(host);if(!plan||plan.identity!==identity||plan.expires<this.now()||expectedProvider&&plan.provider!==expectedProvider)throw Error('操作预览已过期或连接已变化，请重新检查。');const key=identity+plan.provider;if(this.busy.has(key))throw Error('此远端运行时正在维护。');this.busy.add(key);this.plans.delete(id);try{return this.row(await this.request(host,{method:'cli/apply',provider:plan.provider,operation:plan.operation,planId:plan.remoteId}));}finally{this.busy.delete(key);}}
}
