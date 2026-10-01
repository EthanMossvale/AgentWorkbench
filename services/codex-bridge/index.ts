import { visualizationPresentation } from '../../packages/visualizations/instructions';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Session,SshHost,EnvironmentProfile} from '../../packages/contracts';
import {CodexNativeAdapter} from '../../packages/runtime-codex';
import {assertBridgeReady,type BridgeEvidence,type SharedContextOptions} from '../../packages/session-core';
import type {NativePeerContextSession} from '../../packages/collaboration-core/native-inbox';
import type {createPeerTools} from '../../packages/collaboration-core/tools';
import {CodexBridgeConnection,type NativeOwnerReceipt} from './connection';
import {parseModels,applyNativeModelDefaults,parseEffectiveModel} from '../../packages/runtime-codex/models';
import type {NativeModelOption} from '../../packages/contracts';

export interface CodexAcceptance {version:1;observedAt:string;executableSha256:string;hostBinding:string;evidence:BridgeEvidence;reports:string[];accountRuntime?:'existing-codex'|'native-owner';}
export const codexHostBinding=(host:SshHost)=>createHash('sha256').update(JSON.stringify([host.id,host.hostname,host.port,host.username,host.identityFile,host.knownHostsFile,host.ownerId,host.workspaceGeneration,host.role])).digest('hex');
export interface NativeCodexHandle {connection:CodexBridgeConnection;adapter:CodexNativeAdapter;threadId:string;threadName?:string;effectiveModel?:import('../../packages/contracts').NativeModelSelection;ownerReceipt?:NativeOwnerReceipt;}
export interface NativeCodexOptions {context?:SharedContextOptions;peerContext?:NativePeerContextSession;peerTools?:ReturnType<typeof createPeerTools>;profile?:EnvironmentProfile;}
export interface NativeCodexService {
 supports(host:SshHost,session:Session):boolean;
 defaultDirectory(sessionId:string):string;
 models?(host:SshHost,session:Session):Promise<NativeModelOption[]>;
 connect(host:SshHost,session:Session,options:NativeCodexOptions):Promise<NativeCodexHandle>;
 close(sessionId:string):Promise<void>;
 dispose():Promise<void>;
}

/** Only a locally accepted host/account/version combination can enter this runtime. */
export class CodexBridgeService implements NativeCodexService {
 private catalogConnections=new Set<CodexBridgeConnection>();
 private handles=new Map<string,NativeCodexHandle>();private pending=new Map<string,Promise<NativeCodexHandle>>();private closing=false;
 private constructor(readonly executable:string,readonly directory:string,private acceptances:CodexAcceptance[]=[]){}
 static async load(executable:string,directory:string,receiptPath:string){
  let receipts:CodexAcceptance[]=[];
  try{const saved=JSON.parse(await readFile(receiptPath,'utf8'));
   const candidates=saved.version===2&&Array.isArray(saved.acceptances)?saved.acceptances.slice(0,128):[saved];
   const hash=createHash('sha256').update(await readFile(executable)).digest('hex');
   receipts=candidates.filter((candidate:CodexAcceptance)=>candidate?.version===1&&candidate.evidence?.runtimeVersion==='0.155.1'&&candidate.executableSha256===hash&&[undefined,'existing-codex','native-owner'].includes(candidate.accountRuntime));
  }catch{/* Missing acceptance disables execution; it does not initiate tests or login. */}
  return new CodexBridgeService(executable,directory,receipts);
 }
 private acceptance(host:SshHost,session:Session){
  if(this.closing||host.role!=='workspace'||host.username==='root'||session.binding.accountRuntime!=='native-owner')return;
  return this.acceptances.find(receipt=>{if(codexHostBinding(host)!==receipt.hostBinding||(session.binding.accountRuntime??'existing-codex')!==(receipt.accountRuntime??'existing-codex'))return false;try{assertBridgeReady(session.binding,'0.155.1',receipt.evidence);return true;}catch{return false;}});
 }
 supports(host:SshHost,session:Session){return !!this.acceptance(host,session);}
 defaultDirectory(sessionId:string){if(!/^[a-f0-9-]{36}$/.test(sessionId))throw Error('Invalid session identity.');return path.join(this.directory,'workspaces',sessionId);}
 async models(host:SshHost,session:Session){
  if(!this.supports(host,session))throw Error('该账号的原生连接尚未验收，无法读取模型目录。');
  const existing=this.handles.get(session.id);
  if(createHash('sha256').update(await readFile(this.executable)).digest('hex')!==this.acceptance(host,session)!.executableSha256)throw Error('本机执行器版本已变化。');
  const querySession={...session,id:randomUUID(),binding:{...session.binding,nativeSessionId:undefined}};
  const connection=existing?.connection??(await CodexBridgeConnection.open({host,session:querySession,executable:this.executable,directory:path.join(this.directory,'connections'),cwd:this.directory,registerEnvironment:false})).connection;
  if(!existing)this.catalogConnections.add(connection);
  try{const result:NativeModelOption[]=[];let cursor:string|undefined;const seen=new Set<string>();
   if(this.closing)throw Error('Workbench is closing.');
   do{const page=await connection.rpc.request<{data:unknown[];nextCursor?:string|null}>('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});result.push(...parseModels(page));cursor=page.nextCursor??undefined;if(cursor&&(seen.has(cursor)||seen.size>=20))throw Error('原生模型目录分页异常。');if(cursor)seen.add(cursor);}while(cursor);
   const config=await connection.rpc.request('config/read',{includeLayers:false});
   return applyNativeModelDefaults([...new Map(result.map(model=>[model.model,model])).values()],config);
  }finally{if(!existing){this.catalogConnections.delete(connection);await connection.dispose();}}
 }
 connect(host:SshHost,session:Session,options:NativeCodexOptions){
  if(!this.supports(host,session))return Promise.reject(Error('该工作空间、账号或运行时版本尚未通过原生执行验收。'));
  const existing=this.handles.get(session.id);if(existing){existing.adapter.setPermissionMode(session.permissionMode??'default');return Promise.resolve(existing);}
  const pending=this.pending.get(session.id);if(pending)return pending;
  const operation=this.open(host,session,options).finally(()=>this.pending.delete(session.id));this.pending.set(session.id,operation);return operation;
 }
 private async open(host:SshHost,session:Session,options:NativeCodexOptions){
  const acceptance=this.acceptance(host,session);if(!acceptance)throw Error('该账号运行入口尚未完成原生执行验收。');
  if(createHash('sha256').update(await readFile(this.executable)).digest('hex')!==acceptance.executableSha256)throw Error('本机执行器文件已变化，请重新验收该版本。');
  if(!session.projectPath)throw Error('Native session requires a frozen local directory.');
  if(session.projectPath===this.defaultDirectory(session.id))await mkdir(session.projectPath,{recursive:true});
  const instructions='The official Codex runtime, authentication and model networking run on the selected VPS. Native command and file tools execute on the bound local Windows device. Use the actual local shell and paths returned by the executor. Preserve real tool results. Do not simulate the remote host or inventory local hardware unless explicitly requested by the user.';
  const {connection}=await CodexBridgeConnection.open({host,session,executable:this.executable,directory:path.join(this.directory,'connections'),cwd:session.projectPath,registerEnvironment:false});
  try{
   const ownerReceipt=connection.ownerReceipt,threadId=session.binding.nativeSessionId??ownerReceipt?.threadId;
   if(ownerReceipt&&threadId!==ownerReceipt.threadId)throw Error('原生账号入口的历史会话回执不一致。');
   const savedEnvironment=session.nativeEnvironmentReceipt??(ownerReceipt?{threadId:ownerReceipt.threadId,environmentId:ownerReceipt.environmentId,cwd:ownerReceipt.cwd,runtimeVersion:'0.155.1',accountRef:session.binding.accountRef}:undefined);
   const fork=session.branch?.native;
   const adapter=new CodexNativeAdapter(connection.rpc,session.binding,{environmentId:session.binding.executionId,cwd:session.projectPath},acceptance.evidence,'0.155.1',threadId||fork?{memoryHandoff:options.context?.memoryHandoff}:options.context,session.permissionMode??'default',options.peerContext,options.peerTools,instructions+'\n'+visualizationPresentation.instructions('codex'));
   const info=await adapter.registerEnvironment(connection.endpoint) as {cwd?:string;shell?:{name?:string}};
   if(!info.cwd||path.resolve(fileURLToPath(info.cwd)).toLowerCase()!==path.resolve(session.projectPath).toLowerCase()||info.shell?.name!=='powershell')throw Error('本机执行器返回的目录或 Shell 与绑定不一致。');
   const result=await (threadId?adapter.resumeThread(threadId,savedEnvironment):fork?adapter.forkThread(fork):adapter.startThread(session.modelSelection?.model)) as {thread:{id:string;name?:string|null;environments?:{environmentId:string;cwd:string}[]}};
   const environments=result.thread.environments;
   // 0.155.1 resume returns defaults and has no environments parameter. No tools run
   // here: the prior receipt and freshly inspected executor are required, and both
   // adapter and VPS enforce the explicit environment on EVERY subsequent turn.
   if(threadId){if(result.thread.id!==threadId)throw Error('原生会话身份不一致。');}
   else if(!fork&&(environments?.length!==1||environments[0]?.environmentId!==session.binding.executionId||environments[0]?.cwd!==session.projectPath))throw Error('原生会话未确认指定的本机执行环境。');
   if(this.closing)throw Error('Workbench is closing.');
   if(ownerReceipt&&!session.binding.nativeSessionId&&!fork&&options.context?.snapshot?.enabled)await adapter.attachContextToEmptyThread(options.context);
   const handle={connection,adapter,threadId:result.thread.id,threadName:typeof result.thread.name==='string'?result.thread.name:undefined,effectiveModel:parseEffectiveModel(result),ownerReceipt};this.handles.set(session.id,handle);
   connection.rpc.once('disconnect',()=>{if(this.handles.get(session.id)===handle)this.handles.delete(session.id);});
   return handle;
  }catch(error){await connection.dispose();throw error;}
 }
 async close(sessionId:string){const handle=this.handles.get(sessionId)??await this.pending.get(sessionId)?.catch(()=>undefined);this.handles.delete(sessionId);await handle?.connection.dispose();}
 async dispose(){this.closing=true;await Promise.allSettled([...this.catalogConnections].map(connection=>connection.dispose()).concat([...new Set([...this.handles.keys(),...this.pending.keys()])].map(id=>this.close(id))));}
}
