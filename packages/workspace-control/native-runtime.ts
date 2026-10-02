import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, writeFile, unlink} from 'node:fs/promises';
import path from 'node:path';
import type {AccountCatalog, NativeModelOption, SharedAccount, SshHost} from '../contracts';
import {runSsh, type SshRunner} from '../ssh-transport';
import {workspaceHostIdentity} from './index';
import {NATIVE_OWNER_CLIENT} from '../remote-account-catalog/native-client';
import {sshFailure} from '../ssh-transport/diagnostics';
import {readOnlySsh} from '../ssh-transport/read-only';

export interface NativeRuntimeStatus {
  accountId: string; provider: 'codex' | 'claude'; installed: boolean; authenticated: boolean;
  versionMatched: boolean; version?: string; execution: 'unavailable' | 'local-executor-required' | 'local-tools-unverified' | 'local-mcp-required';
  block: null | {reason: 'rate_limited' | 'authentication_required' | 'billing_review'; observedAt: number; resetsAt?: number};
}
export interface NativeModelCatalog { accountId:string; accountGeneration:string; provider:'claude'; models:NativeModelOption[] }
const wire = NATIVE_OWNER_CLIENT + String.raw`
import sys
try:
    raw=sys.stdin.buffer.readline(16385)
    if len(raw)>16384:raise ValueError()
    print(json.dumps(native_owner_request(json.loads(raw)),separators=(',',':')))
except Exception:print('{"ok":false,"error":"NATIVE_RUNTIME_UNAVAILABLE"}')
`;
const command = `exec python3 -c "import base64;exec(base64.b64decode('${Buffer.from(wire).toString('base64')}'))"`;
const labels: Record<string,string> = {NATIVE_MODELS_UNAVAILABLE:'远端 Claude CLI 未返回可用模型目录；没有提交模型任务。',INVALID_REQUEST:'远端服务不支持此请求，请核对账号服务版本。',RUNTIME_CLOSING:'远端运行服务正在关闭。',ACCOUNT_AUTHENTICATION_REQUIRED:'此远端账号需要重新登录。',ACCOUNT_LOGOUT_UNCONFIRMED:'官方 CLI 尚未确认退出，账号记录保留，请先刷新核实。',STALE_SELECTION:'账号目录已变化，请刷新后重新确认。',RUNTIME_NOT_INSTALLED:'统一服务尚未配置此账号对应的 CLI，请先完善运行时配置。',MIGRATION_ACCOUNT_CHANGED:'原账号身份与此前接入记录不同，请重新核对；没有新建账号。',MIGRATION_ACCOUNT_COLLISION:'该标识已有其他账号记录，未覆盖，请核对原账号。',RUNTIME_NOT_ENABLED:'此工作空间尚未启用该运行时。',ACCOUNT_FORBIDDEN:'账号授权已变化，请重新读取。',ACCOUNT_RUNTIME_BUSY:'此账号还有运行中的会话，结束后再核实认证。',ACCOUNT_REVIEW_REQUIRED:'原生状态尚未确认恢复，账号仍保持阻止新回合。',NATIVE_RUNTIME_UNAVAILABLE:'统一账号运行服务尚未就绪。',CLAUDE_LOCAL_EXECUTOR_UNVERIFIED:'Claude 本机工具执行链尚未验收。'};

/** A broker rejection, never inferred from a transport error or display text. */
class NativeRuntimeRejection extends Error {
  constructor(readonly code:string){super(labels[code]);}
}

/** Public status and explicit native login/review only; no token RPC exists. */
export class NativeRuntimeControl {
  private creating=new Set<string>();
  private drafts=new Map<string,SharedAccount>();
  private draftKey(host:SshHost,catalog:AccountCatalog,id:string){return JSON.stringify([workspaceHostIdentity(host),catalog.authorityId,catalog.generation,id]);}
  draft(host:SshHost,catalog:AccountCatalog,id:string){return this.drafts.get(this.draftKey(host,catalog,id));}
  async prepareClaude(host:SshHost,catalog:AccountCatalog):Promise<SharedAccount>{
    if(host.role!=='admin'||host.username!=='root')throw Error('请从 root 管理员入口登录。');
    const requestId=randomUUID(),value=await this.request(host,catalog,'runtime/claude-prepare',{requestId});
    if(value?.id!=='draft-'+requestId||value.provider!=='claude'||value.pendingLogin!==true||typeof value.generation!=='string'||!Number.isFinite(Date.parse(value.observedAt)))throw Error('临时登录回执无效。');
    const account:SharedAccount={id:value.id,generation:value.generation,provider:'claude',status:'unauthenticated',observedAt:value.observedAt};
    this.drafts.set(this.draftKey(host,catalog,account.id),account);return account;
  }
  async discardClaude(host:SshHost,catalog:AccountCatalog,id:string){
    const key=this.draftKey(host,catalog,id),account=this.drafts.get(key);
    if(!account)throw Error('临时登录身份已失效。');
    const result=await this.request(host,catalog,'runtime/claude-discard',{accountId:id,accountGeneration:account.generation});
    if(result?.discarded!==true)throw Error('临时登录清理未确认。');
    this.drafts.delete(key);return {discarded:true};
  }
  constructor(private directory: string, private runner: SshRunner = runSsh) {}
  private async request(host:SshHost,catalog:AccountCatalog,method:string,params:Record<string,unknown>) {
    if(catalog.availability!=='ready'||catalog.source!=='native-owner') throw Error('请先准备统一运行服务并读取原生账号目录。');
    const options={stdin:JSON.stringify({protocol:1,method,params:{authorityId:catalog.authorityId,generation:catalog.generation,...params}})+'\n',timeoutMs:95000,maxOutputBytes:1024*1024};
    const result=await (method==='runtime/models'?readOnlySsh(host,command,options,this.runner):this.runner(host,command,options)).catch(error=>{const failure=sshFailure(undefined,error);if(failure)throw Error(failure.message+' 诊断码：SSH_'+failure.code);throw error;});
    if(result.exitCode!==0){const failure=sshFailure(result)!;throw Error(failure.message+' 诊断码：SSH_'+failure.code);}
    let value:any;try{value=JSON.parse(result.stdout);}catch{throw Error('原生运行服务返回无效回执。');}
    if(result.exitCode===0&&value?.ok===false&&typeof value.error==='string'&&Object.hasOwn(labels,value.error))throw new NativeRuntimeRejection(value.error);
    if(result.exitCode!==0||value?.ok!==true)throw Error(labels[value?.error]??'原生账号操作未确认，请刷新状态。');
    return value.value;
  }
  async status(host:SshHost,catalog:AccountCatalog,accountId:string,review=false):Promise<NativeRuntimeStatus> {
    const account=catalog.accounts.find(a=>a.id===accountId);
    if(!account||review&&host.role!=='admin')throw Error('请使用管理员入口复核已授权账号。');
    const value=await this.request(host,catalog,review?'runtime/review':'runtime/status',{accountId});
    if(!value||value.accountId!==accountId||value.provider!==account.provider||!['installed','authenticated','versionMatched'].every(k=>typeof value[k]==='boolean')||!['unavailable','local-executor-required','local-tools-unverified','local-mcp-required'].includes(value.execution))throw Error('原生运行状态无效。');
    if(value.block&&(!['rate_limited','authentication_required','billing_review'].includes(value.block.reason)||!Number.isFinite(value.block.observedAt)))throw Error('账号限制状态无效。');
    return {accountId,provider:value.provider,installed:value.installed,authenticated:value.authenticated,versionMatched:value.versionMatched,execution:value.execution,...(typeof value.version==='string'&&value.version.length<100?{version:value.version}:{}),block:value.block?{reason:value.block.reason,observedAt:value.block.observedAt,...(Number.isFinite(value.block.resetsAt)?{resetsAt:value.block.resetsAt}:{})}:null};
  }
  async models(host:SshHost,catalog:AccountCatalog,accountId:string):Promise<NativeModelOption[]> {
    const account=catalog.accounts.find(a=>a.id===accountId&&a.provider==='claude'&&a.status==='authenticated');
    if(!account||host.role!=='workspace'||host.username==='root')throw Error('请选择已授权的 Claude 工作空间账号。');
    const value:NativeModelCatalog=await this.request(host,catalog,'runtime/models',{accountId,accountGeneration:account.generation});
    const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=256&&!/[\x00-\x1f\x7f]|-----BEGIN|Bearer\s|(?:access_token|refresh_token|api_key)\s*[:=]|sk-[A-Za-z0-9_-]{12,}/i.test(v);
    if(!value||value.accountId!==accountId||value.accountGeneration!==account.generation||value.provider!=='claude'||!Array.isArray(value.models)||!value.models.length||value.models.length>100)throw Error('远端 Claude 模型目录回执无效。');
    const seen=new Set<string>();
    return value.models.map(row=>{
      if(!row||!text(row.model)||row.id!==row.model||!text(row.name)||typeof row.isDefault!=='boolean'||seen.has(row.model)||!Array.isArray(row.efforts)||row.efforts.length>32||!row.efforts.every(text)||!Array.isArray(row.serviceTiers)||row.serviceTiers.length>1||!row.serviceTiers.every(t=>t?.id==='priority'&&text(t.name)&&(t.description===undefined||text(t.description)))||row.contextWindow!==undefined&&(!Number.isSafeInteger(row.contextWindow)||row.contextWindow<=0||row.contextWindow>100000000)||row.defaultEffort!==undefined&&(!text(row.defaultEffort)||!row.efforts.includes(row.defaultEffort)))throw Error('远端 Claude 模型目录回执无效。');
      seen.add(row.model);return {id:row.model,model:row.model,name:row.name,isDefault:row.isDefault,efforts:[...row.efforts],serviceTiers:row.serviceTiers.map(t=>({id:t.id,name:t.name,description:t.description??''})),...(row.contextWindow?{contextWindow:row.contextWindow}:{}),...(row.defaultEffort?{defaultEffort:row.defaultEffort}:{})};
    });
  }
  async createClaude(host:SshHost,catalog:AccountCatalog) {
    if(host.role!=='admin')throw Error('请从管理员入口添加原生登录配置。');
    const folder=path.join(this.directory,'native-account-requests'),target=path.join(folder,createHash('sha256').update(workspaceHostIdentity(host)+catalog.authorityId+catalog.generation).digest('hex')+'.json');
    if(this.creating.has(target))throw Error('此连接正在创建原生登录配置，请等待回执。');
    this.creating.add(target);
    try {
    await mkdir(folder,{recursive:true});
    let request:{requestId:string;expectedRevision:number}|undefined;
    let savedText:string|undefined;
    try{savedText=await readFile(target,'utf8');const saved=JSON.parse(savedText);if(!saved||!/^[-a-f0-9]{36}$/.test(saved.requestId)||!Number.isSafeInteger(saved.expectedRevision)||saved.expectedRevision<0)throw Error('原生账号恢复记录无效，请核对本机记录。');request=saved;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const retire=async()=>{
      if(await readFile(target,'utf8')!==savedText)throw Error('原生账号恢复记录已变化，请重新核对。');
      await unlink(target);request=undefined;savedText=undefined;
    };
    if(request&&catalog.accounts.some(a=>a.provider==='claude'&&a.id==='claude-'+request!.requestId))await retire();
    for(let attempt=0;;attempt++){
      if(!request){request={requestId:randomUUID(),expectedRevision:catalog.revision};savedText=JSON.stringify(request);await writeFile(target+'.tmp',savedText,{mode:0o600});await rename(target+'.tmp',target);}
      const pending=request;
      try{
        const result=await this.request(host,catalog,'runtime/claude-create',pending);
        if(!result||result.id!=='claude-'+pending.requestId||result.provider!=='claude')throw Error('原生账号创建回执不一致。');
        // Keep the recovery identity until the catalog confirms it, including
        // when the remote write succeeded but its response was lost.
        return {accountId:result.id as string};
      }catch(error){
        if(!(error instanceof NativeRuntimeRejection)||error.code!=='STALE_SELECTION')throw error;
        // The broker checks for an existing request before revision validation.
        // This rejection proves no account exists and no write occurred. Never
        // reuse its ID: deletion retains the old profile on the remote host.
        await retire();
        if(attempt!==0||pending.expectedRevision>=catalog.revision)throw error;
      }
    }
    } finally {this.creating.delete(target);}
  }
  async remove(host:SshHost,catalog:AccountCatalog,accountId:string){
    const account=catalog.accounts.find(a=>a.id===accountId);if(host.role!=='admin'||host.username!=='root'||!account)throw Error('请从 root 管理员入口移除账号。');
    const value=await this.request(host,catalog,'runtime/remove',{accountId,accountGeneration:account.generation,expectedRevision:catalog.revision,confirm:true});
    if(value?.removed!==accountId||value.accountGeneration!==account.generation)throw Error('账号移除回执未确认，请刷新核实。');return {removed:accountId};
  }
  async loginCommand(host:SshHost,catalog:AccountCatalog,accountId:string) {
    const account=catalog.accounts.find(a=>a.id===accountId);
    if(host.role!=='admin'||!account)throw Error('请使用管理员入口管理原生登录。');
    const value=await this.request(host,catalog,'runtime/login-command',{accountId});
    if(typeof value?.command!=='string'||value.command.length>4096||/[\x00\r\n]/.test(value.command)||!value.command.endsWith(account.provider==='claude'?' auth login':' login'))throw Error('原生登录命令无效。');
    return {command:value.command as string};
  }
  async enrollLegacy(host:SshHost,catalog:AccountCatalog,legacy:AccountCatalog,accountId:string){
    const account=legacy.accounts.find(a=>a.id===accountId&&a.provider==='codex');
    if(host.role!=='admin'||host.username!=='root'||legacy.source!=='existing-codex'||legacy.availability!=='ready'||!account?.email)throw Error('原账号公开身份尚未核实，不能接入。');
    const reference=(authorityId:string,generation:string)=>'vps-account:'+ [authorityId,generation,'codex',account.id,account.generation].map(encodeURIComponent).join('/');
    const result=await this.request(host,catalog,'runtime/legacy-enroll',{accountRef:reference(legacy.authorityId,legacy.generation),email:account.email,sameAccountConfirmed:true});
    if(result?.accountId!==account.id||result.accountGeneration!==account.generation||result.accountRef!==reference(catalog.authorityId,catalog.generation))throw Error('账号接入回执与原账号不一致。');
    return {accountId:account.id};
  }
}
