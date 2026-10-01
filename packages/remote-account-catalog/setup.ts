import {readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {SshHost} from '../contracts';
import {runSsh,validateSshHost,type SshRunner} from '../ssh-transport';
import {workspaceHostIdentity} from '../workspace-control';

export interface AccountSetupPlan {
  id:string; status:'ready'|'installable'|'blocked'; blockers:string[]; warnings:string[];
  paths:string[]; owner:string; binaries:Partial<Record<'codex'|'claude',string>>;
  authorityId?:string; generation?:string; createOwner?:boolean; policyPath?:string;
  downloads?:{provider:'codex'|'claude';version:string;url:string;sha256:string;size:number;target:string}[];
  detected?:{provider:'codex'|'claude';path:string;status:'ready'|'private'|'version-mismatch'|'untrusted'|'unverified';version?:string}[];
}
const files=['broker.py','native_worker.py','runtime.py','claude_session.py','runtime_maintenance.py','resources.py','remote_files.py','session_storage.py','session_manifest.py','session_idle.py','usage.py','migration.py','migrate_legacy.py','native_install.py','cli_guard.py','cli_management.py','cli_policies.py', 'account_admin.py','agent-workbench-accounts.service'];
export function accountSetupScript(request:unknown){
  const root=typeof __dirname==='string'?path.join(__dirname,'account-runtime'):path.resolve('services/vps-account-broker');
  const sources=Object.fromEntries([...files,'setup.py'].map(name=>[name,readFileSync(path.join(root,name),'utf8')]));
  const payload=Buffer.from(JSON.stringify({request,sources})).toString('base64');
  return `import sys,types,json,base64\np=json.loads(base64.b64decode('${payload}'))\nfor name in ('cli_guard','native_worker','broker','native_install','setup','cli_policies','cli_management','resources','remote_files','session_storage','session_manifest','session_idle'):\n m=types.ModuleType(name);sys.modules[name]=m;exec(compile(p['sources'][name+'.py'],name+'.py','exec'),m.__dict__)\nsources={k:v for k,v in p['sources'].items() if k!='setup.py'}\nprint(json.dumps(sys.modules['session_storage'].dispatch(p['request']) if str(p['request'].get('method','')).startswith('retention/') else sys.modules['remote_files'].dispatch(p['request']) if str(p['request'].get('method','')).startswith('remote-files/') else sys.modules['resources'].dispatch(p['request']) if str(p['request'].get('method','')).startswith('resources/') else sys.modules['cli_management'].dispatch(p['request']) if str(p['request'].get('method','')).startswith('cli/') else sys.modules['setup'].dispatch(p['request'],sources),separators=(',',':')))\n`;
}
const labels:Record<string,string>={CLI_RELEASE_UNAVAILABLE:'无法从官方源核实最新 CLI 版本，未回退安装旧版本；请检查网络后重试。',CLI_DOWNLOAD_FAILED:'下载官方 CLI 失败，请检查 VPS 出网后重新预览；已有安装未修改。',CLI_CHECKSUM_MISMATCH:'官方 CLI 下载校验未通过，未安装或执行。请重新检查。',CLI_INSTALL_CONFLICT:'共享安装位置存在不同文件，未覆盖；请核对该目录。',CLI_ARCHIVE_INVALID:'官方 CLI 安装包格式不符合预期，未执行。',CLI_PLATFORM_UNSUPPORTED:'暂不支持此服务器的系统或架构，未尝试安装。',ADMIN_REQUIRED:'请从 root 管理入口准备统一账号服务。',PLAN_CHANGED:'远端状态已变化，请重新检查并预览。',EXISTING_DEPLOYMENT_CHANGED:'已有服务文件与此版本不同，未覆盖；请先核对部署版本。',SETUP_UNCONFIRMED:'服务准备未确认完成；已创建的文件保留，可重新检查后继续。',START_UNCONFIRMED:'服务启动尚未确认，请重新检查状态；不会重复登录或删除账号。'};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
const safe=(v:unknown):v is string=>typeof v==='string'&&v.length<=4096&&!/[\x00-\x1f\x7f]/.test(v);
/** Only a reviewed plan can write. List/discovery never invokes setup. */
export class AccountServiceSetup {
  private plans=new Map<string,{hostIdentity:string;remoteId:string;expiresAt:number;authorityId:string;generation:string}>();
  private busy=new Set<string>();
  constructor(private runner:SshRunner=runSsh,private now=Date.now){}
  private host(host:SshHost){validateSshHost(host);if(host.role!=='admin'||host.username!=='root')throw Error(labels.ADMIN_REQUIRED);}
  private async request(host:SshHost,request:unknown){
    const result=await this.runner(host,'exec python3 -B -',{stdin:accountSetupScript(request),timeoutMs:15*60_000,maxOutputBytes:65536});
    let response:any;try{if(Buffer.byteLength(result.stdout)>65536)throw Error();response=JSON.parse(result.stdout);}catch{throw Error(labels.SETUP_UNCONFIRMED);}
    if(result.exitCode!==0||response?.ok!==true)throw Error(labels[response?.error]??labels.SETUP_UNCONFIRMED);
    return response.value;
  }
  async plan(host:SshHost):Promise<AccountSetupPlan>{
    this.host(host);const value=await this.request(host,{method:'plan'});
    if(!value||!['ready','installable','blocked'].includes(value.status)||!Array.isArray(value.blockers)||!Array.isArray(value.warnings)||!Array.isArray(value.paths)||value.blockers.length>32||value.warnings.length>32||value.paths.length>16||![...value.blockers,...value.warnings,...value.paths].every(safe)||!id(value.owner)||!value.binaries||typeof value.binaries!=='object')throw Error('统一账号服务检查回执无效。');
    const result:AccountSetupPlan={id:randomUUID(),status:value.status,blockers:value.blockers,warnings:value.warnings,paths:value.paths,owner:value.owner,binaries:{}};
    const downloads=value.downloads??[],detected=value.detected??[];
    if(!Array.isArray(downloads)||downloads.length>2||!Array.isArray(detected)||detected.length>48)throw Error('CLI 配置回执无效。');
    result.downloads=downloads.map((item:any)=>{
      if(!item||!['codex','claude'].includes(item.provider)||!safe(item.version)||!/^\d+\.\d+\.\d+$/.test(item.version)||!safe(item.url)||!/^https:\/\/(releases\.openai\.com\/codex\/releases\/|github\.com\/openai\/codex\/releases\/download\/|downloads\.claude\.ai\/claude-code-releases\/)/.test(item.url)||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isSafeInteger(item.size)||item.size<=0||item.size>500000000||!safe(item.target)||!item.target.startsWith('/opt/agent-workbench/native/')||item.target.split('/').includes('..'))throw Error('CLI 配置回执无效。');
      return {provider:item.provider,version:item.version,url:item.url,sha256:item.sha256,size:item.size,target:item.target};
    });
    result.detected=detected.map((item:any)=>{
      if(!item||!['codex','claude'].includes(item.provider)||!safe(item.path)||!item.path.startsWith('/')||!['ready','private','version-mismatch','untrusted','unverified'].includes(item.status)||(item.version!=null&&(!safe(item.version)||!/^\d+\.\d+\.\d+$/.test(item.version))))throw Error('CLI 检测回执无效。');
      return {provider:item.provider,path:item.path,status:item.status,...(item.version?{version:item.version}:{})};
    });
    for(const provider of ['codex','claude'] as const)if(safe(value.binaries[provider])&&value.binaries[provider].startsWith('/'))result.binaries[provider]=value.binaries[provider];
    if(value.status==='ready'||value.status==='installable'){
      if(!id(value.authorityId)||!id(value.generation))throw Error('账号服务身份尚未核实。');
      result.authorityId=value.authorityId;result.generation=value.generation;
    }
    if(value.status==='installable'){
      if(typeof value.planId!=='string'||!/^[a-f0-9]{64}$/.test(value.planId)||typeof value.createOwner!=='boolean'||!safe(value.policyPath)||!value.policyPath.startsWith('/'))throw Error('统一账号服务计划无效。');
      result.createOwner=value.createOwner;result.policyPath=value.policyPath;
      const identity=workspaceHostIdentity(host);
      for(const [key,plan] of this.plans)if(plan.hostIdentity===identity||plan.expiresAt<this.now())this.plans.delete(key);
      this.plans.set(result.id,{hostIdentity:identity,remoteId:value.planId,expiresAt:this.now()+5*60_000,authorityId:value.authorityId,generation:value.generation});
    }
    return result;
  }
  async apply(host:SshHost,planId:string){
    this.host(host);const identity=workspaceHostIdentity(host),plan=this.plans.get(planId);
    if(!plan||plan.hostIdentity!==identity||plan.expiresAt<this.now())throw Error('接入计划已过期或连接已变化，请重新检查。');
    if(this.busy.has(identity))throw Error('此 VPS 的统一账号服务正在准备，请等待回执。');
    this.plans.delete(planId);this.busy.add(identity);
    try{const value=await this.request(host,{method:'apply',planId:plan.remoteId});
      if(value?.status!=='ready'||value.authorityId!==plan.authorityId||value.generation!==plan.generation)throw Error(labels.START_UNCONFIRMED);
      return {status:'ready' as const,authorityId:value.authorityId,generation:value.generation};
    }finally{this.busy.delete(identity);}
  }
}
