import {readFileSync} from 'node:fs';
import path from 'node:path';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {StringDecoder} from 'node:string_decoder';
import type {AccountCatalog,SshHost} from '../contracts';
import {SSH_EXECUTABLE,buildSshArgs,buildSshEnvironment,runSsh,validateSshHost,type SshRunner} from '../ssh-transport';
import {workspaceHostIdentity} from '../workspace-control';
import {connectBrowserViewer,type BrowserViewerConnection,type BrowserViewerConnector} from './browser-viewer';

export interface BrowserSetupPlan {id:string;chromeVersion?:string;installChrome:boolean;archives:{name:string;license:string}[];packageTransaction:string}
export interface BrowserProfile {key:string;label:string;available:boolean}
export interface BrowserControlResult {running:boolean;viewerReady:boolean;profilesPreserved:true;profileKey?:string}
export interface RemoteBrowserState {installed:boolean;missing:string[];profiles:BrowserProfile[]}
export interface BrowserLogin {jobId:string;accountId:string;state:'preparing'|'awaiting-browser'|'authenticated'|'cancelled'|'expired'|'failed';viewerReady:boolean;codeRequested:boolean;cleanup:'pending'|'confirmed'|'unconfirmed';error?:string}
export interface BrowserEnvironment {serviceUser:string;home:string;chrome:string;web:string;websockify:string;xvnc:string;display:string;vncPort:number;webPort:number}
export class BrowserEnvironmentProviders {
 private providers=new Map<string,(host:SshHost)=>Partial<BrowserEnvironment>|undefined>();
 register(id:string,provider:(host:SshHost)=>Partial<BrowserEnvironment>|undefined){if(this.providers.has(id))throw Error('Browser environment provider already registered.');this.providers.set(id,provider);return ()=>{if(this.providers.get(id)===provider)this.providers.delete(id);};}
 resolve(host:SshHost){return Object.assign({},...[...this.providers.values()].map(provider=>provider(host)));}
}
const errors:Record<string,string>={BROWSER_BUSY:'远端浏览器正在使用中。请先结束原浏览器或登录窗口，再重试。',BROWSER_NOT_INSTALLED:'远端浏览器环境尚未安装。',BROWSER_OPERATION_FAILED:'远端浏览器操作未确认，请刷新后核对。',BROWSER_START_FAILED:'远端浏览器未能启动，请检查浏览器环境。',BROWSER_START_TIMEOUT:'远端浏览器启动超时。',BROWSER_CLOSED:'远端浏览器已关闭。',LOGIN_DISCONNECTED:'登录连接已中断，本次进程正在清理。',NATIVE_AUTH_FAILED:'官方 CLI 未完成登录，请重新开始。',NATIVE_AUTH_UNCONFIRMED:'官方 CLI 尚未确认登录成功。',ACCOUNT_ALREADY_AUTHENTICATED:'这个 CLI 账号已登录。若要添加另一账号，请先添加新的 Claude 原生登录。',ACCOUNT_RUNTIME_BUSY:'此账号仍有登录或会话在进行。',INVALID_AUTH_CODE:'请输入网页显示的临时授权码，不是 API Key。',ACCOUNT_RELEASE_UNCONFIRMED:'进程已清理，但账号服务尚未确认释放登录占用，请重新检查。'};
errors.BROWSER_PROFILE_SHARED_BUSY='该用户已被 Chrome 使用或仍与打开的浏览器共享配置，当前不能安全删除；新建且未使用的用户可单独删除。';
errors.NATIVE_AUTH_URL_UNRECOGNIZED='未识别远端 CLI 的授权地址，浏览器未打开；请检查 CLI 登录入口兼容性。';
errors.NATIVE_AUTH_URL_TIMEOUT='等待远端 CLI 授权地址超时，浏览器未打开；请重新开始登录。';
errors.BROWSER_ALREADY_RUNNING='远端已有浏览器运行，请先关闭当前浏览器，再启动其他用户；继续操控现有浏览器请点“恢复连接”。';
Object.assign(errors,{BROWSER_NOT_RUNNING:'远端浏览器没有运行，请先选择用户启动。',BROWSER_DESKTOP_UNAVAILABLE:'原远端桌面不可用，浏览器未被重启或关闭。请核对远端环境。',BROWSER_RECONNECT_FAILED:'操控通道未能恢复，远端浏览器保留；请恢复网络后再点“恢复连接”。',BROWSER_STOP_UNCONFIRMED:'本机操控连接已断开，但远端进程关闭尚未确认；请恢复连接后再次关闭。'});
const key=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const label=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&!/[\x00-\x1f\x7f]/.test(v);
const endpoint=(host:SshHost)=>JSON.stringify([host.hostname.toLowerCase(),host.port]);
const root=()=>typeof __dirname==='string'?__dirname:path.resolve('services');
export function browserPayload(request:unknown,environment?:Partial<BrowserEnvironment>){const bundled=typeof __dirname==='string';const account=bundled?path.join(root(),'account-runtime'):path.join(root(),'vps-account-broker');const browser=bundled?path.join(root(),'remote-browser'):path.join(root(),'vps-browser');const sources=Object.fromEntries(['cli_guard','native_worker','broker','native_install','setup'].map(n=>[n+'.py',readFileSync(path.join(account,n+'.py'),'utf8')]));for(const n of ['browser_environment','remote_browser','configure_browser_root','browser_setup','browser_api'])sources[n+'.py']=readFileSync(path.join(browser,n+'.py'),'utf8');return JSON.stringify({request,sources,...(environment?{environment}:{})})+'\n';}
const bootstrap=`import sys,types,json,os
reader=os.fdopen(os.dup(0),'rb',buffering=0)
p=json.loads(reader.readline())
for name in ('cli_guard','native_worker','broker','native_install','setup','browser_environment','browser_setup','browser_api'):
 m=types.ModuleType(name);sys.modules[name]=m;exec(compile(p['sources'][name+'.py'],name+'.py','exec'),m.__dict__)
 if name=='browser_environment':m.ENV=m.load(p.get('environment'))
m.SOURCES=p['sources']
m.dispatch(p['request'])`;
export const browserCommand=`exec python3 -u -B -c "import base64;exec(base64.b64decode('${Buffer.from(bootstrap).toString('base64')}'))"`;
export function browserTunnelArgs(host:SshHost,port:number,webPort=6091){if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid loopback port.');const args=buildSshArgs(host,'exec sleep 900').map(a=>a==='ClearAllForwardings=yes'?'ClearAllForwardings=no':a);const at=args.indexOf('--');args.splice(at,0,'-o','ExitOnForwardFailure=yes','-L',`127.0.0.1:${port}:127.0.0.1:${webPort}`);return args;}
const port=()=>new Promise<number>((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const value=server.address();server.close(e=>e?reject(e):typeof value==='object'&&value?resolve(value.port):reject(Error('No loopback port.')));});});
interface Job {host:SshHost;value:BrowserLogin;webPort:number;child:ChildProcessWithoutNullStreams;tunnel?:ChildProcessWithoutNullStreams;tunnelStarting?:boolean;url?:string;heartbeat:ReturnType<typeof setInterval>;deadline:ReturnType<typeof setTimeout>;closed:Promise<void>;finish:()=>void}
export class RemoteBrowserService {
 readonly environments=new BrowserEnvironmentProviders();
 private payload(host:SshHost,request:unknown){return browserPayload(request,this.environments.resolve(host));}
 async environment(host:SshHost):Promise<BrowserEnvironment>{this.admin(host);const result=await this.runner(host,browserCommand,{stdin:this.payload(host,{action:'environment'})});const reply=JSON.parse(result.stdout);if(result.exitCode!==0||reply.ok!==true)throw Error(errors.BROWSER_OPERATION_FAILED);return reply.value;}
 private jobs=new Map<string,Job>();
 private setupPlans=new Map<string,{identity:string;remote:string;expires:number}>();
 private configuring=new Set<string>();
 private viewers=new Map<string,BrowserViewerConnection>();
 private viewerRequests=new Set<AbortController>();
 private disposed=false;
 constructor(private open:(url:string)=>Promise<void>,private runner:SshRunner=runSsh,private connectViewer:BrowserViewerConnector=connectBrowserViewer){}
 private admin(host:SshHost){validateSshHost(host);if(host.role!=='admin'||host.username!=='root')throw Error('请从 root 管理员入口管理远端浏览器。');}
 busy(host:SshHost){return this.configuring.has(endpoint(host))||[...this.jobs.values()].some(j=>endpoint(j.host)===endpoint(host)&&(j.value.cleanup!=='confirmed'||['preparing','awaiting-browser'].includes(j.value.state)));}
 async control(host:SshHost,action:'launch'|'reconnect'|'stop',options:{profileKey?:string;confirm?:boolean}={}):Promise<BrowserControlResult>{
  this.admin(host);
  if(this.disposed)throw Error('工作台正在退出，未开始新的浏览器操作。');
  if(!['launch','reconnect','stop'].includes(action)||action==='launch'&&!key(options.profileKey)||action==='stop'&&options.confirm!==true)throw Error('请核对浏览器用户与关闭确认。');
  if(this.busy(host))throw Error(errors.BROWSER_BUSY);
  const target=endpoint(host),abort=new AbortController();this.configuring.add(target);this.viewerRequests.add(abort);
  const closeViewer=async()=>{const previous=this.viewers.get(target);this.viewers.delete(target);await previous?.close();};
  try{
   if(action==='stop')await closeViewer();
   let reply:any;
   try{
    const result=await this.runner(host,browserCommand,{stdin:this.payload(host,{action,...(action==='launch'?{profileKey:options.profileKey}:{}),...(action==='stop'?{confirm:true}:{})}),signal:abort.signal});
    reply=JSON.parse(result.stdout);
    if(result.exitCode!==0||reply?.ok!==true)throw Error(errors[reply?.error]??errors[action==='stop'?'BROWSER_STOP_UNCONFIRMED':'BROWSER_OPERATION_FAILED']);
   }catch(error){if(error instanceof Error&&Object.values(errors).includes(error.message))throw error;throw Error(errors[action==='stop'?'BROWSER_STOP_UNCONFIRMED':'BROWSER_OPERATION_FAILED']);}
   const value=reply.value;
   if(typeof value?.running!=='boolean'||value.running!==(action!=='stop')||value.profilesPreserved!==true||action==='launch'&&value.profileKey!==options.profileKey)throw Error(errors.BROWSER_OPERATION_FAILED);
   if(action==='stop')return {running:false,viewerReady:false,profilesPreserved:true};
   abort.signal.throwIfAborted();
   await closeViewer();
   try{
    const viewer=await this.connectViewer(host,abort.signal,{webPort:reply.webPort??6091});
    if(this.disposed||abort.signal.aborted){await viewer.close();throw Error('Viewer cancelled.');}
    this.viewers.set(target,viewer);await this.open(viewer.url);
   }catch{const viewer=this.viewers.get(target);this.viewers.delete(target);await viewer?.close();throw Error(errors.BROWSER_RECONNECT_FAILED);}
   return {running:true,viewerReady:true,profilesPreserved:true,...(action==='launch'?{profileKey:options.profileKey}:{})};
  }finally{this.configuring.delete(target);this.viewerRequests.delete(abort);}
 }
 async setup(host:SshHost,id?:string):Promise<BrowserSetupPlan|{configured:true}>{
  this.admin(host);const identity=workspaceHostIdentity(host),plan=id?this.setupPlans.get(id):undefined;
  if(id&&(!plan||plan.identity!==identity||plan.expires<Date.now()))throw Error('配置预览已过期，请重新检查。');
  if(this.busy(host))throw Error('远端浏览器有操作正在进行。');this.configuring.add(endpoint(host));if(id)this.setupPlans.delete(id);
  try{const r=await this.runner(host,browserCommand,{stdin:this.payload(host,{action:id?'setup-apply':'setup-plan',...(plan?{planId:plan.remote}:{})})});let response:any;try{response=JSON.parse(r.stdout);}catch{throw Error('配置回执未确认，请刷新检查。');}if(r.exitCode!==0||response?.ok!==true)throw Error(({BROWSER_PLATFORM_UNSUPPORTED:'自动配置目前支持使用 DNF 的 x86_64 Linux；已有浏览器环境仍可复用。',BROWSER_PACKAGE_CHANGES_UNSAFE:'安装依赖需要更改已有系统包，已停止。请由管理员核对系统依赖。',BROWSER_DEPENDENCIES_UNAVAILABLE:'无法解析所需的新增依赖，没有安装系统包。',PLAN_CHANGED:'官方版本或安装依赖已变化，请重新预览。',BROWSER_INSTALL_CONFLICT:'已有安装文件或用户数据，未覆盖；请先核对远端环境。'} as Record<string,string>)[response?.error]??'配置尚未确认，请刷新远端状态；不会自动重试。');const v=response.value;
  if(id){if(v?.configured!==true)throw Error('远端配置未确认。');return {configured:true};}
  if(typeof v?.planId!=='string'||!/^[a-f0-9]{64}$/.test(v.planId)||typeof v.installChrome!=='boolean'||typeof v.packageTransaction!=='string'||!Array.isArray(v.archives)||v.chromeVersion!=null&&(typeof v.chromeVersion!=='string'||!/^\d+\.\d+\.\d+\.\d+$/.test(v.chromeVersion)))throw Error('远端配置计划无效。');const planId=randomUUID();this.setupPlans.set(planId,{identity,remote:v.planId,expires:Date.now()+300000});return {id:planId,installChrome:v.installChrome,chromeVersion:v.chromeVersion??undefined,packageTransaction:v.packageTransaction,archives:v.archives.map((a:any)=>{if(!['noVNC-1.6.0','websockify-0.13.0'].includes(a.name)||typeof a.license!=='string')throw Error('配置组件无效。');return {name:a.name,license:a.license};})};
  }finally{this.configuring.delete(endpoint(host));}
 }
 async profiles(host:SshHost,action:'list'|'create'|'rename'|'delete'='list',options:{key?:string;label?:string;confirm?:boolean}={}):Promise<RemoteBrowserState>{
  this.admin(host);if(!['list','create','rename','delete'].includes(action)||['rename','delete'].includes(action)&&!key(options.key)||['create','rename'].includes(action)&&!label(options.label)||action==='delete'&&options.confirm!==true)throw Error('请核对浏览器用户与操作确认。');
  if(this.busy(host))throw Error(errors.BROWSER_BUSY);
  const r=await this.runner(host,browserCommand,{stdin:this.payload(host,{action,...options})});let v:any;try{v=JSON.parse(r.stdout);}catch{throw Error(errors.BROWSER_OPERATION_FAILED);}if(r.exitCode!==0||v?.ok!==true)throw Error(errors[v?.error]??errors.BROWSER_OPERATION_FAILED);v=v.value;
  if(!v||typeof v.installed!=='boolean'||!Array.isArray(v.profiles)||!Array.isArray(v.missing)||v.missing.some((x:unknown)=>typeof x!=='string'))throw Error('远端浏览器回执无效。');
  return {installed:v.installed,missing:v.missing,profiles:v.profiles.map((p:any)=>{if(!key(p.key)||!label(p.label)||typeof p.available!=='boolean')throw Error('浏览器用户列表无效。');return {key:p.key,label:p.label,available:p.available};})};
 }
 async start(host:SshHost,catalog:AccountCatalog,accountId:string,profileKey:string,draft=false):Promise<BrowserLogin>{
  this.admin(host);if(this.busy(host))throw Error(errors.BROWSER_BUSY);const account=catalog.accounts.find(a=>a.id===accountId&&a.provider==='claude');if(!account||catalog.source!=='native-owner'||catalog.availability!=='ready'||!key(profileKey))throw Error('请先读取 Claude 账号并选择浏览器用户。');
  const jobId=randomUUID(),child=spawn(SSH_EXECUTABLE,buildSshArgs(host,browserCommand),{stdio:'pipe',windowsHide:true,shell:false,env:buildSshEnvironment()});
  let finish!:()=>void;const closed=new Promise<void>(resolve=>{finish=resolve;});
  const job:Job={host:structuredClone(host),webPort:6091,value:{jobId,accountId,state:'preparing',viewerReady:false,codeRequested:false,cleanup:'pending'},child,closed,finish,heartbeat:setInterval(()=>{if(!child.stdin.destroyed)child.stdin.write('{"action":"heartbeat"}\n');},10000),deadline:setTimeout(()=>{void this.cancel(host,jobId);},910000)};
  this.jobs.set(jobId,job);let buffer='';const decoder=new StringDecoder('utf8');
  const fail=(code?:string)=>{job.value={...job.value,state:'failed',viewerReady:false,codeRequested:false,error:errors[code??'']??'登录连接未能确认，请检查远端清理状态。',cleanup:job.value.cleanup==='confirmed'?'confirmed':'unconfirmed'};job.tunnel?.kill();child.stdin.end();};
  child.on('error',()=>fail());child.stderr.resume();child.stdin.on('error',()=>{});
  child.stdout.on('data',(data:Buffer)=>{buffer+=decoder.write(data);while(buffer.includes('\n')){const i=buffer.indexOf('\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const v=JSON.parse(line);if(v.ok===false){if(v.cleanup==='confirmed')job.value.cleanup='confirmed';fail(v.error);continue;}if(!['preparing','awaiting-browser','authenticated','cancelled','expired','failed'].includes(v.state)||!['pending','confirmed','unconfirmed'].includes(v.cleanup)||typeof v.viewerReady!=='boolean'||typeof v.codeRequested!=='boolean')throw Error();job.webPort=v.webPort??6091;job.value={...job.value,state:v.state,codeRequested:v.codeRequested,cleanup:v.cleanup,error:v.error?(errors[v.error]??'远端登录结果尚未确认。'):undefined};if(v.viewerReady&&!job.tunnel&&!job.tunnelStarting){job.tunnelStarting=true;void this.tunnel(job).catch(()=>fail());}if(!v.viewerReady){job.value.viewerReady=false;job.tunnel?.kill();}if(v.cleanup!=='pending'){clearInterval(job.heartbeat);clearTimeout(job.deadline);}}catch{fail();}}});
  child.on('close',()=>{clearInterval(job.heartbeat);clearTimeout(job.deadline);job.tunnel?.kill();job.value.viewerReady=false;if(job.value.cleanup!=='confirmed'){job.value.cleanup='unconfirmed';if(['preparing','awaiting-browser'].includes(job.value.state))job.value.state='failed';}finish();});
  child.stdin.write(this.payload(host,{action:'login',jobId,accountId,accountGeneration:account.generation,profileKey,authorityId:catalog.authorityId,generation:catalog.generation,...(draft?{draft:true}:{})}));
  return structuredClone(job.value);
 }
 private async tunnel(job:Job){const p=await port();if(job.value.cleanup!=='pending')return;const child=spawn(SSH_EXECUTABLE,browserTunnelArgs(job.host,p,job.webPort),{stdio:'pipe',windowsHide:true,shell:false,env:buildSshEnvironment()});job.tunnel=child;child.stdout.resume();child.stderr.resume();child.stdin.end();child.on('error',()=>{job.value.error='浏览器连接未能建立。';job.child.stdin.end();});child.on('close',()=>{job.value.viewerReady=false;if(job.value.cleanup==='pending')job.child.stdin.end();});const url=`http://127.0.0.1:${p}/vnc.html?autoconnect=1&resize=scale`;
  for(let attempt=0;attempt<40;attempt++){if(job.value.cleanup!=='pending')return;try{const r=await fetch(url,{signal:AbortSignal.timeout(1000),redirect:'error'});if(r.ok){job.url=url;job.value.viewerReady=true;return;}}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('Viewer unavailable.');
 }
 private job(host:SshHost,id:string){this.admin(host);const j=this.jobs.get(id);if(!j||workspaceHostIdentity(j.host)!==workspaceHostIdentity(host))throw Error('登录任务与当前连接不一致。');return j;}
 status(host:SshHost,id:string){return structuredClone(this.job(host,id).value);}
 async openViewer(host:SshHost,id:string){const j=this.job(host,id);if(!j.value.viewerReady||!j.url)throw Error('实时浏览器尚未就绪。');await this.open(j.url);}
 code(host:SshHost,id:string,value:string){const j=this.job(host,id);if(!j.value.codeRequested||typeof value!=='string'||value.length>2048||!/^[A-Za-z0-9_.#~+=/-]+$/.test(value)||/^(sk-|Bearer|eyJ)/.test(value))throw Error(errors.INVALID_AUTH_CODE);j.child.stdin.write(JSON.stringify({action:'code',code:value})+'\n');j.value.codeRequested=false;return structuredClone(j.value);}
 async cancel(host:SshHost,id:string){const j=this.job(host,id);if(j.value.cleanup==='confirmed')return structuredClone(j.value);if(!j.child.stdin.destroyed)j.child.stdin.write('{"action":"cancel"}\n');let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([j.closed,new Promise<void>(r=>{timer=setTimeout(r,55000);})]);}finally{clearTimeout(timer);}if(this.status(host,id).cleanup!=='confirmed'){j.value.cleanup='unconfirmed';j.child.stdin.end();}return structuredClone(j.value);}
 async dispose(){this.disposed=true;for(const request of this.viewerRequests)request.abort();const viewers=[...this.viewers.values()];this.viewers.clear();await Promise.allSettled([...viewers.map(viewer=>viewer.close()),...[...this.jobs.values()].filter(j=>j.value.cleanup!=='confirmed').map(j=>this.cancel(j.host,j.value.jobId))]);}
}
