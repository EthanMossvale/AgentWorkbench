import { sessionPresentation } from '../../../packages/session-core/presentation';
import {nativeEventSemantics} from '../../../packages/native-events/semantics';
import { nativeContextState } from '../../../packages/model-api/context-state';
import { recordAsyncQuestions } from '../../../packages/native-interactions/inbox';
import { codexSkillInputs } from '../../../packages/native-skills/invocation';
import type { AttachmentStore } from './attachments';
import { attachmentPrompt, nativeAttachmentImages } from '../../../packages/attachments/input';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {AppState,DraftPreview,Message,NativeForkSource,Session,SshHost} from '../../../packages/contracts';
import {SessionLeaseRegistry,SubmissionLedger,type WriterLease,type SharedContextOptions} from '../../../packages/session-core';
import type {NativeFrame} from '../../../services/remote-supervisor';
import type {NativeCodexService,NativeCodexHandle,NativeCodexOptions} from '../../../services/codex-bridge';
import type {RpcId} from '../../../packages/runtime-codex';
import { approvalFields, codexApprovalChoices, resolveApprovalChoice, type ApprovalReply, type BasicApprovalDecision } from '../../../packages/native-approvals';
import {parseContextUsage} from '../../../packages/runtime-codex/models';
import {NativeAdmissionRejectedError} from '../../../packages/runtime-codex';
import { sourceLabel, visibleHandoff } from '../../../packages/model-api/targets';
import { memoryCitations } from '../../../packages/session-core/memory-citations';
import { nativeTurnFailure } from '../../../packages/native-events/turn-failure';
import { codexInteraction, expireInteractions, putInteraction, planUpdate, questions, type InteractionReply } from '../../../packages/native-interactions';

interface Hooks {
 beforeConnect?(session:Session,host:SshHost,signal:AbortSignal):Promise<void>;
 attachments?:AttachmentStore;
 quota?:{begin(session:Session,handle:NativeCodexHandle):Promise<void>;observe(sessionId:string,usage:unknown):void;finish(sessionId:string,handle:NativeCodexHandle):Promise<void>};
 snapshot():AppState;update(change:(state:AppState)=>void):Promise<unknown>;
 /** Optional cheap paths; the runner falls back to snapshot/update when absent. */
 updateSession?(id:string,change:(session:Session)=>void,options?:{persist?:'durable'|'deferred'}):Promise<boolean>;read?():Readonly<AppState>;session?(id:string):Session|undefined;
 context(sessionId:string):Promise<SharedContextOptions>;
 peers(sessionId:string):Pick<NativeCodexOptions,'peerContext'|'peerTools'>;
 observe(sessionId:string,handle:NativeCodexHandle):Promise<unknown>;
 translate(sessionId:string,message:Message):void;
}
interface Tracked {detached?:boolean;handle:NativeCodexHandle;queue:Promise<void>;active:boolean;stopping:boolean;items:Map<string,Record<string,any>>;lease?:WriterLease;renew?:ReturnType<typeof setInterval>;textBatch?:((session:Session)=>void)[];drainText?:()=>void;}
const record=(value:unknown):Record<string,any>=>value&&typeof value==='object'?value as Record<string,any>:{};
const admissionReason=(code:string)=>({REMOTE_STORAGE_PRESSURE:'VPS 储存空间不足，已保留系统余量并暂缓新任务；请释放空间后主动重试。',REMOTE_MEMORY_PRESSURE:'VPS 可用内存不足，已暂缓新任务；请等待空闲回收或手动释放其他软件的内存。',ACCOUNT_RATE_LIMITED:'原生账号额度已耗尽。窗口刷新后请核实账号状态，再主动发送。',ACCOUNT_AUTHENTICATION_REQUIRED:'原生账号需要重新核实登录。',ACCOUNT_FORBIDDEN:'此空间的账号授权已变化，请刷新账号目录。',RUNTIME_NOT_ENABLED:'此空间尚未获准使用该运行时。',WORKSPACE_DISABLED:'此工作空间已停用。'} as Record<string,string>)[code]??'账号授权或运行策略未通过，请核实账号状态。';

export class NativeCodexRunner {
 private warming=new Map<string,Promise<{ready:boolean}>>();
 private warmKeys=new Map<string,string>();private warmExpiry=new Map<string,ReturnType<typeof setTimeout>>();
 private connectionKey(session:Session){const {nativeSessionId,...binding}=session.binding;return JSON.stringify([binding,session.projectPath,session.modelSelection,session.permissionMode,this.host(session)]);}
 async prepare(id:string):Promise<{ready:boolean}>{
  const pending=this.warming.get(id);if(pending)return pending;
  const session=this.session(id);this.assertAllowed(session);
  if(this.closing||session.archived||this.busy(id)||!['idle','blocked'].includes(session.status))return {ready:false};
  const scope={detached:false};this.attempts.set(id,scope);
  const work=this.attempt.run(scope,async()=>{
   for(const other of this.warmKeys.keys())if(other!==id&&!this.busy(other))await this.close(other);
   if(!session.projectPath){session.projectPath=this.service.defaultDirectory(id);await this.updateSession(id,s=>{s.projectPath=session.projectPath;});}
   const key=this.connectionKey(session);
   await this.connect(session,this.host(session));
   if(scope.detached)return {ready:false};
   if(this.closing||key!==this.connectionKey(this.session(id))){await this.service.close(id);return {ready:false};}
   this.warmKeys.set(id,key);clearTimeout(this.warmExpiry.get(id));
   const timer=setTimeout(()=>{if(!this.busy(id))void this.close(id).catch(()=>{});},120000);timer.unref();this.warmExpiry.set(id,timer);
   return {ready:true};
  }).catch(async error=>{if(!scope.detached)await this.service.close(id).catch(()=>{});throw error;}).finally(()=>{if(this.warming.get(id)===work)this.warming.delete(id);if(this.attempts.get(id)===scope)this.attempts.delete(id);});this.warming.set(id,work);return work;
 }
 private tracked=new Map<string,Tracked>();private submissions=new Set<string>();private preparing=new Set<string>();private cancelled=new Set<string>();
 private attempt=new AsyncLocalStorage<{detached?:boolean}>();
 private attempts=new Map<string,{detached:boolean}>();
 private restorations=new Map<string,AbortController>();
 private leases=new SessionLeaseRegistry();private ledger=new SubmissionLedger(this.leases);private closing=false;
 constructor(readonly service:NativeCodexService,private hooks:Hooks){}
 private session(id:string){const session=this.hooks.session?this.hooks.session(id):this.hooks.snapshot().sessions.find(item=>item.id===id);if(!session)throw Error('会话不存在。');return session;}
 private read():Readonly<AppState>{return this.hooks.read?.()??this.hooks.snapshot();}
 private host(session:Session){const host=this.read().hosts.find(item=>item.id===session.binding.hostId);if(!host)throw Error('绑定的 SSH 工作空间不存在。');return host;}
 supports(session:Session){try{return this.service.supports(this.host(session),session);}catch{return false;}}
 assertAllowed(session:Session){if(!this.supports(session))throw Error('H 原生桥尚未完成该连接的工具/文件视图验收，提交已阻止。');}
 busy(id:string){return this.preparing.has(id)||!!this.tracked.get(id)?.active;}
 private updateSession(id:string,change:(session:Session)=>void,persist?:'deferred'){const attempt=this.attempt.getStore();if(this.hooks.updateSession)return this.hooks.updateSession(id,session=>{if(!attempt?.detached)change(session);},{persist});return this.hooks.update(state=>{const session=state.sessions.find(item=>item.id===id);if(session&&!attempt?.detached)change(session);});}
 private enqueue(id:string,tracked:Tracked,operation:()=>Promise<unknown>){tracked.drainText?.();tracked.textBatch=undefined;tracked.queue=tracked.queue.then(()=>tracked.detached?undefined:this.attempt.run(tracked,operation)).then(()=>{}).catch(async()=>{tracked.active=false;this.release(tracked);if(tracked.detached)return;await this.updateSession(id,s=>{s.status='uncertain';s.nativeError='保存原生事件失败；不会自动重发。';}).catch(()=>{});void this.service.close(id);});}
 private appendText(id:string,tracked:Tracked,change:(session:Session)=>void){
  if(tracked.textBatch){tracked.textBatch.push(change);return;}
  const batch=[change],windowMs=nativeEventSemantics.batchWindowMs();
  let drain:()=>void=()=>{};
  const ready=new Promise<void>(resolve=>{if(!Number.isFinite(windowMs)||windowMs<=0){resolve();return;}drain=()=>{clearTimeout(timer);if(tracked.drainText===drain)tracked.drainText=undefined;resolve();};const timer=setTimeout(drain,Math.min(windowMs,100));});
  this.enqueue(id,tracked,async()=>{await ready;if(tracked.textBatch===batch)tracked.textBatch=undefined;await this.updateSession(id,session=>{for(const apply of batch)apply(session);},'deferred');});
  tracked.textBatch=batch;tracked.drainText=drain;
 }
 private release(tracked:Tracked){clearInterval(tracked.renew);if(tracked.lease){this.leases.revoke(tracked.lease.sessionId);tracked.lease=undefined;}}
 private async connect(session:Session,host:SshHost){
  const warm=this.warmKeys.get(session.id),cached=this.tracked.get(session.id);
  if(warm&&cached&&warm===this.connectionKey(session)&&cached.handle.threadId===session.binding.nativeSessionId)return cached;
  if(warm){this.warmKeys.delete(session.id);await this.service.close(session.id);}
  const restoration=new AbortController();this.restorations.set(session.id,restoration);
  try{if(this.closing||this.preparing.has(session.id)&&this.cancelled.has(session.id))throw Error('连接准备已取消；没有提交模型请求。');await this.hooks.beforeConnect?.(session,host,restoration.signal);restoration.signal.throwIfAborted();}
  finally{if(this.restorations.get(session.id)===restoration)this.restorations.delete(session.id);}
  const context=await this.hooks.context(session.id);
  if(this.attempt.getStore()?.detached)throw Error('Native connection attempt was retired.');
  const handle=await this.service.connect(host,session,{context:session.binding.nativeSessionId||session.branch?.native?{memoryHandoff:context.memoryHandoff}:context,...this.hooks.peers(session.id)});
  if(this.attempt.getStore()?.detached)throw Error('Native connection attempt was retired.');
  const existing=this.tracked.get(session.id);if(existing?.handle===handle)return existing;
  if(handle.effectiveModel)await this.updateSession(session.id,s=>{s.nativeEffectiveModel=handle.effectiveModel;});
  await this.updateSession(session.id,s=>{if(s.binding.nativeSessionId&&s.binding.nativeSessionId!==handle.threadId)throw Error('Native identity changed.');s.binding.nativeSessionId=handle.threadId;sessionPresentation.nativeTitle(s,handle.threadName);s.nativeEnvironmentReceipt={threadId:handle.threadId,environmentId:s.binding.executionId,cwd:s.projectPath!,runtimeVersion:handle.adapter.version,accountRef:s.binding.accountRef};s.nativeApprovals=[];});
  if(handle.ownerReceipt?.interrupted&&handle.ownerReceipt.cleanupConfirmed)await this.updateSession(session.id,s=>{if(s.status==='uncertain'){s.status='idle';s.nativeError='此前的远端任务已中断并回收，可以发送新任务；未自动重发。';expireInteractions(s);}});
  if(handle.ownerReceipt?.uncertain)await this.updateSession(session.id,s=>{s.nativeTurnId=handle.ownerReceipt!.turnId;s.status='uncertain';});
  const tracked:Tracked={handle,queue:Promise.resolve(),active:false,stopping:false,items:new Map()};this.tracked.set(session.id,tracked);
  const rpc=handle.connection.rpc;
  const raw=(frame:NativeFrame)=>this.observe(session.id,tracked,frame);
  rpc.on('raw',raw);
  const request=(frame:NativeFrame)=>this.serverRequest(session.id,tracked,frame);
  rpc.on('serverRequest',request);
  rpc.once('disconnect',()=>{rpc.off('raw',raw);this.enqueue(session.id,tracked,async()=>{
   const uncertain=tracked.active&&!tracked.stopping;tracked.active=false;this.release(tracked);
   rpc.off('serverRequest',request);
   await this.updateSession(session.id,s=>{s.nativeApprovals=[];expireInteractions(s,'uncertain');if(uncertain){s.status='uncertain';s.nativeError='原生连接中断，回合结果待确认；没有自动重发。';}});
   await this.hooks.quota?.finish(session.id,tracked.handle).catch(()=>{});
  });if(this.tracked.get(session.id)===tracked)this.tracked.delete(session.id);});
  await this.hooks.observe(session.id,handle);return tracked;
 }
 private serverRequest(id:string,t:Tracked,frame:NativeFrame){
  const p=record(frame.value.params),requestId=frame.value.id as RpcId,method=String(frame.value.method),rpc=t.handle.connection.rpc;
  if(method==='item/tool/call')return; // The adapter owns dynamic peer calls.
  const write=(operation:Promise<void>)=>{void operation.catch(()=>this.enqueue(id,t,()=>this.updateSession(id,s=>{s.status='uncertain';s.nativeError='原生交互回应未确认；不会自动重发。';expireInteractions(s,'uncertain');})));};
  if(!t.active||!rpc.isBoundThread(p.threadId)){write(rpc.rejectServerRequest(requestId,-32602,'Native request is outside the active bound session.'));return;}
  if(method==='currentTime/read'){write(rpc.replyCurrentTime(requestId));return;}
  if(method==='item/commandExecution/requestApproval'||method==='item/fileChange/requestApproval'){
   const kind=method==='item/fileChange/requestApproval'?'file':'command';
   this.enqueue(id,t,()=>this.updateSession(id,s=>{s.nativeApprovals??=[];s.nativeApprovals.push({id:requestId,threadId:p.threadId,turnId:String(p.turnId),kind,...approvalFields('codex',{...p,changes:t.items.get(p.itemId)?.changes},kind,randomUUID())});}));return;
  }
  const item=codexInteraction(method,p,requestId,frame.receivedAt);
  if(item){this.enqueue(id,t,()=>this.updateSession(id,s=>putInteraction(s,item)));return;}
  this.enqueue(id,t,()=>this.updateSession(id,s=>putInteraction(s,{id:requestId,method,threadId:p.threadId,turnId:p.turnId,kind:'unsupported',status:'unsupported',blocking:false,receivedAt:frame.receivedAt,title:method})));
  write(rpc.rejectServerRequest(requestId));
 }
 private observe(id:string,t:Tracked,frame:Pick<NativeFrame,'value'|'receivedAt'|'sequence'>){
  const v=frame.value,p=record(v.params),item=record(p.item);
  if(v.method==='thread/name/updated'){
   if(p.threadId===t.handle.threadId)this.enqueue(id,t,()=>this.updateSession(id,s=>{if(this.tracked.get(id)===t)sessionPresentation.codex(s,t.handle.threadId,v);}));return;
  }
  if(v.method==='serverRequest/resolved'){
   this.enqueue(id,t,()=>this.updateSession(id,s=>{s.nativeApprovals=s.nativeApprovals?.filter(a=>a.id!==p.requestId);const item=s.nativeInteractions?.find(i=>i.id===p.requestId&&i.status==='pending');if(item)item.status='expired';}));return;
  }
  if(p.threadId&&p.threadId!==t.handle.threadId){
   if(v.method==='turn/completed'&&t.handle.connection.rpc.isBoundThread(p.threadId))this.enqueue(id,t,()=>this.updateSession(id,s=>{expireInteractions(s,'expired',p.threadId,p.turn?.id);s.nativeApprovals=s.nativeApprovals?.filter(a=>a.threadId!==p.threadId||a.turnId!==p.turn?.id);}));
   return;
  }
  if(item.id&&['fileChange','commandExecution'].includes(item.type)){t.items.set(item.id,item);if(t.items.size>100)t.items.delete(t.items.keys().next().value!);}
  if(v.method==='item/agentMessage/delta'||v.method==='item/plan/delta'||v.method==='item/completed'&&['agentMessage','plan'].includes(item.type)){
   const itemId=String(p.itemId??item.id??'');if(!itemId)return;
   const complete=v.method==='item/completed';const value=complete?item.text:p.delta;if(typeof value!=='string')return;
   let result:Message|undefined;const change=(s:Session)=>{
    let message=s.messages.find(m=>m.nativeItemId===itemId);if(!message){message={id:randomUUID(),nativeItemId:itemId,nativeOrder:frame.sequence,role:'assistant',original:'',demo:false,timestamp:frame.receivedAt,translationStatus:'off',modelSource:s.messages.filter(m=>m.role==='user').at(-1)?.modelSource??sourceLabel(s,this.read() as AppState)};s.messages.push(message);}
    if(complete&&item.type==='plan')message.planReview={receipt:randomUUID(),status:'pending'};message.original=complete?value:message.original+value;message.nativeTurnId=typeof p.turnId==='string'?p.turnId:s.nativeTurnId;message.nativeTurnEnd=false;if(complete){message.phase=item.type==='plan'||item.phase==='final_answer'?'final':item.phase==='commentary'?'commentary':undefined;message.memoryReferences=memoryCitations(value,item.type==='agentMessage'?item.memoryCitation:undefined);if(item.questions?.length){try{recordAsyncQuestions(s,message,questions(item.questions,'async'));}catch{s.nativeError='原生异步问题格式尚不支持，请在输入框直接回复。';}}}result=structuredClone(message);
   };if(complete)this.enqueue(id,t,async()=>{await this.updateSession(id,change);if(result)this.hooks.translate(id,{...result,phase:result.phase??'commentary'});});else this.appendText(id,t,change);
  }else if(v.method==='thread/tokenUsage/updated'&&p.threadId===t.handle.threadId){
   const usage=parseContextUsage(p.tokenUsage,frame.receivedAt,typeof p.turnId==='string'?p.turnId:undefined);
   if(usage&&t.active)this.hooks.quota?.observe(id,p.tokenUsage);
   if(usage)this.enqueue(id,t,()=>this.updateSession(id,s=>{nativeContextState.observe(s,usage);}));
  }else if(v.method==='turn/started'){
   this.enqueue(id,t,()=>this.updateSession(id,s=>{s.nativeTurnId=p.turn.id;s.nativeTurnStatus='inProgress';const user=s.messages.filter(m=>m.role==='user').at(-1);if(user&&!user.nativeTurnId)user.nativeTurnId=p.turn.id;}));
  }else if(v.method==='turn/completed'){
   this.enqueue(id,t,async()=>{t.active=false;this.release(t);let final:Message|undefined;await this.updateSession(id,s=>{s.nativeTurnId=p.turn.id;s.nativeTurnStatus=p.turn.status;s.nativeApprovals=[];expireInteractions(s);const last=s.messages.filter(m=>m.role==='assistant'&&m.nativeTurnId===p.turn.id).at(-1);if(last){last.nativeTurnEnd=true;if(!last.phase&&p.turn.status==='completed'){last.phase='final';if(last.translationStatus!=='complete')final=structuredClone(last);}}if(!t.stopping)s.status='idle';s.nativeError=p.turn.status==='failed'?nativeTurnFailure('codex',p.turn.error):undefined;});if(final)this.hooks.translate(id,final);await this.hooks.quota?.finish(id,t.handle).catch(()=>this.updateSession(id,s=>{s.nativeError='回合已结束，但额度记账待同步；下次提交前会重试同一数值记录。';}));});
  }else if(v.method==='error'){
   this.enqueue(id,t,()=>this.updateSession(id,s=>{s.nativeError=(p.willRetry?'原生运行时正在重试：':'原生运行时报告错误，等待结束回执：')+nativeTurnFailure('codex',p.error);}));
  }else if(v.method==='turn/plan/updated'){
   const plan=planUpdate(p);if(plan)this.enqueue(id,t,()=>this.updateSession(id,s=>{s.nativePlan=plan;}));
  }
 }
 async submit(id:string,preview:DraftPreview){
  const scope={detached:false};
  return this.attempt.run(scope,()=>this.submitAttempt(id,preview,scope));
 }
 private async submitAttempt(id:string,preview:DraftPreview,scope:{detached:boolean}){
  const session=this.session(id);this.assertAllowed(session);
  const files=preview.attachments?.length?await this.hooks.attachments?.payloads(preview.attachments.map(a=>a.id),{channel:'native'}):[];if(!files)throw Error('附件存储不可用。');
  if(this.closing||this.preparing.has(id)||this.tracked.get(id)?.active||!['idle','blocked'].includes(session.status)||this.submissions.has(preview.id))throw Error('该原生回合正在处理或已经提交，不能重复发送。');
  this.submissions.add(preview.id);this.preparing.add(id);this.cancelled.delete(id);
  this.attempts.set(id,scope);
  let sent=false,t:Tracked|undefined;
  try{
   if(!session.projectPath){session.projectPath=this.service.defaultDirectory(id);await this.updateSession(id,s=>{s.projectPath=session.projectPath;});}
   await this.updateSession(id,s=>{s.status='running';s.nativeError=undefined;s.nativeTurnId=undefined;s.nativeTurnStatus=undefined;s.nativeActiveSettings={permissionMode:session.permissionMode??'default',modelSelection:session.modelSelection};});
   await this.warming.get(id)?.catch(()=>{});
   t=await this.connect(this.session(id),this.host(session));
   if(t.handle.ownerReceipt?.uncertain)throw Error('原生账号入口保留了尚未核对的回合，请先读取原生结果；本次没有发送。');
   if(scope.detached)throw Error('Native submission attempt was retired.');
   if(this.closing||this.cancelled.has(id)){await this.service.close(id);throw Error('连接准备已取消；没有提交模型请求。');}
   await this.hooks.quota?.begin(session,t.handle);
   if(scope.detached||this.closing||this.cancelled.has(id))throw Error('连接准备已取消；没有提交模型请求。');
   const lease=this.leases.acquire(id,'desktop-native');t.lease=lease;t.active=true;t.stopping=false;
   const tracked=t;t.renew=setInterval(()=>{try{if(tracked.lease)tracked.lease=this.leases.renew(tracked.lease);}catch{void this.service.close(id);}},10000);t.renew.unref();
   const handoff=session.handoffFromMessage===undefined?'':visibleHandoff(session,session.handoffFromMessage);
   await this.updateSession(id,s=>{s.messages.push({id:preview.id,role:'user',original:preview.original,submitted:preview.translated,annotations:preview.annotations,attachments:preview.attachments,skills:preview.skills,draftRevisions:preview.revisions,demo:false,timestamp:new Date().toISOString(),modelSource:sourceLabel(s,this.hooks.snapshot())});delete s.forkDraft;delete s.forkAttachments;delete s.forkSkills;if(s.messages.length===1&&!s.branch&&!s.agentCreated)sessionPresentation.fallback(s,(preview.original||preview.attachments?.[0]?.name||'附件').slice(0,28));});
   sent=true;
   const result=await t.handle.adapter.startTurn(attachmentPrompt(preview.translated,files)+handoff,preview.id,lease,this.ledger,session.modelSelection,[...nativeAttachmentImages(files),...codexSkillInputs(preview.skills)],session.collaborationMode) as {turn:{id:string}};
   await this.updateSession(id,s=>{s.nativeTurnId=result.turn.id;delete s.handoffFromMessage;const user=s.messages.find(m=>m.id===preview.id);if(user)user.nativeTurnId=result.turn.id;});
  }catch(error){
   const rejected=error instanceof NativeAdmissionRejectedError;
   if(t){t.active=false;this.release(t);if(!scope.detached)await this.hooks.quota?.finish(id,t.handle).catch(()=>{});}
   await this.updateSession(id,s=>{
    if(rejected)s.messages=s.messages.filter(message=>message.id!==preview.id);
    s.status=sent&&!rejected||t?.handle.ownerReceipt?.uncertain?'uncertain':'idle';
    s.nativeError=rejected?admissionReason(error.message)+' 本次没有提交给模型。':sent?'提交回执不确定，禁止自动重发。':error instanceof Error&&error.message.length<350?error.message:'连接准备失败，未发送模型请求。';
   });
   throw rejected?Error(admissionReason(error.message)+' 本次没有提交给模型。'):error;
  }
  finally{if(this.attempts.get(id)===scope){this.attempts.delete(id);this.preparing.delete(id);}}
 }
 async permissions(id:string,mode:import('../../../packages/contracts').PermissionMode){
  const t=this.tracked.get(id);if(this.preparing.has(id))throw Error('连接正在准备，请稍后切换权限。');
  if(!t&&this.session(id).status==='running')throw Error('当前 Codex 原生连接不可用，权限未更改。');
  if(t){await t.handle.adapter.updatePermissions(mode);return {scope:'native-settings' as const};}
  return {scope:'saved' as const};
 }
 async steer(id:string,preview:DraftPreview,expectedTurnId:string){
  const t=this.tracked.get(id);if(!t?.active||!t.lease||t.stopping||this.session(id).nativeTurnId!==expectedTurnId)throw Error('原生回合已结束或变化；草稿未作为新任务发送。');
  const files=preview.attachments?.length?await this.hooks.attachments?.payloads(preview.attachments.map(a=>a.id),{channel:'native'}):[];if(!files)throw Error('附件存储不可用。');
  await this.updateSession(id,s=>{s.messages.push({id:preview.id,role:'user',original:preview.original,submitted:preview.translated,annotations:preview.annotations,attachments:preview.attachments,skills:preview.skills,draftRevisions:preview.revisions,demo:false,timestamp:new Date().toISOString(),nativeTurnId:expectedTurnId,delivery:'pending',modelSource:sourceLabel(s,this.hooks.snapshot())});});
  try{await t.handle.adapter.steer(attachmentPrompt(preview.translated,files),preview.id,expectedTurnId,t.lease,this.ledger,[...nativeAttachmentImages(files),...codexSkillInputs(preview.skills)]);await this.updateSession(id,s=>{const m=s.messages.find(m=>m.id===preview.id);if(m)m.delivery='accepted';});}
  catch(error){await this.updateSession(id,s=>{const m=s.messages.find(m=>m.id===preview.id);if(m)m.delivery='uncertain';s.nativeError='插入消息回执未确认；没有自动重发。';});throw error;}
 }
 async approval(id:string,requestId:RpcId,reply:BasicApprovalDecision|ApprovalReply){
  const session=this.session(id),t=this.tracked.get(id),approval=session.nativeApprovals?.find(a=>a.id===requestId);
  const frame=t?.handle.connection.rpc.pendingApprovals().find(frame=>frame.value.id===requestId);
  if(!t?.active||t.stopping||!t.lease||!approval||!frame)throw Error('APPROVAL_EXPIRED');
  const decision=resolveApprovalChoice(approval,reply,codexApprovalChoices(record(frame.value.params),approval.kind==='file'?'file':'command'));
  try{await t.handle.adapter.replyApproval(requestId,decision,t.lease,this.leases);}
  catch(error){await this.updateSession(id,s=>{s.nativeError='审批回应未确认；不会自动重发。';});throw error;}
  finally{await this.updateSession(id,s=>{s.nativeApprovals=s.nativeApprovals?.filter(a=>a.receipt!==approval.receipt);});}
 }
 async stop(id:string){
  if(this.preparing.has(id)&&!this.tracked.get(id)?.active){this.cancelled.add(id);this.restorations.get(id)?.abort(new Error('连接准备已取消；没有提交模型请求。'));return {stopped:false,reason:'已取消连接准备；会在连接清理后结束，不会发送模型请求。'};}
  const t=this.tracked.get(id),session=this.session(id);if(!t?.active)return {stopped:false,reason:'当前没有可确认的运行中回合。'};
  if(!session.nativeTurnId)throw Error('原生回合编号尚未返回，请稍后停止。');
  const turnId=session.nativeTurnId;
  t.stopping=true;
  return this.attempt.run(t,async()=>{
  try{await t.handle.connection.interrupt(t.handle.threadId,turnId);await t.queue;await this.updateSession(id,s=>{s.status='idle';s.nativeApprovals=[];s.nativeTurnStatus='interrupted';s.nativeError=undefined;});return {stopped:true,scope:'native-and-owned-local-executor'};}
  catch(error){await this.updateSession(id,s=>{s.status='uncertain';s.nativeError='执行器已请求清理，但远端中断回执未确认。';});throw error;}
  finally{t.active=false;this.release(t);if(!t.detached)await this.hooks.quota?.finish(id,t.handle).catch(()=>{});if(!t.detached)await this.service.close(id);}
  });
 }
 async reconcile(id:string){
  const session=this.session(id);this.assertAllowed(session);
  if(session.status!=='uncertain'||session.binding.accountRuntime!=='native-owner'&&(!session.binding.nativeSessionId||!session.nativeTurnId))throw Error('当前没有可按原生回合编号核对的记录；不会猜测或重发。');
  const t=await this.connect(session,this.host(session));
  const turnId=this.session(id).nativeTurnId;if(!turnId)throw Error('原生入口尚无可核对的回合编号，请保留记录；没有重发。');
  const result=await t.handle.connection.rpc.request<any>('thread/turns/list',{threadId:t.handle.threadId,limit:50,sortDirection:'desc',itemsView:'full'});
  const turn=result.data?.find((item:any)=>item.id===turnId);
  if(!turn||!['completed','interrupted','failed'].includes(turn.status))throw Error('原生回合尚未确认结束，保留待确认状态。');
  for(const item of turn.items??[])if(item.type==='agentMessage')this.observe(id,t,{value:{method:'item/completed',params:{threadId:t.handle.threadId,turnId:turn.id,item}},receivedAt:new Date().toISOString()});
  await t.queue;await this.updateSession(id,s=>{s.status='idle';s.nativeTurnStatus=turn.status;s.nativeError=turn.status==='failed'?nativeTurnFailure('codex',turn.error):undefined;s.nativeApprovals=[];const last=s.messages.filter(m=>m.role==='assistant'&&m.nativeTurnId===turn.id).at(-1);if(last)last.nativeTurnEnd=true;});
  if(t.handle.ownerReceipt)t.handle.ownerReceipt.uncertain=false;
  return {confirmed:true,status:turn.status};
 }
 async close(id:string){const tracked=this.tracked.get(id);if(tracked?.active||this.preparing.has(id))throw Error('当前原生回合尚未结束。');clearTimeout(this.warmExpiry.get(id));this.warmExpiry.delete(id);this.warmKeys.delete(id);await this.warming.get(id)?.catch(()=>{});await this.service.close(id);if(tracked)await tracked.queue;this.tracked.delete(id);}
 async closeForRecovery(id:string){
  const scope=this.attempts.get(id);if(scope)scope.detached=true;this.attempts.delete(id);this.warming.delete(id);this.preparing.delete(id);this.cancelled.add(id);this.restorations.get(id)?.abort();
  const tracked=this.tracked.get(id);
  if(tracked){tracked.detached=true;tracked.active=false;tracked.stopping=true;tracked.drainText?.();this.release(tracked);this.tracked.delete(id);}
  clearTimeout(this.warmExpiry.get(id));this.warmExpiry.delete(id);this.warmKeys.delete(id);
  void this.service.close(id).catch(()=>{});
 }
 async forkSource(id:string,messageId?:string):Promise<NativeForkSource|undefined>{
  let session=this.session(id);if(!session.messages.length)return session.branch?.native?structuredClone(session.branch.native):undefined;
  const target=messageId?session.messages.find(m=>m.id===messageId):session.messages.at(-1);
  if(!target)throw Error('分支起点不存在。');
  const targetIndex=session.messages.indexOf(target),following=session.messages.slice(targetIndex+1);
  const nextUser=following.findIndex(m=>m.role==='user');
  const anchor=target.role==='user'?following.slice(0,nextUser<0?undefined:nextUser).find(m=>m.nativeItemId)??target:target;
  let sourceSessionId=session.binding.nativeSessionId?session.id:session.branch?.native?.sourceSessionId;
  let threadId=session.binding.nativeSessionId??session.branch?.native?.threadId;
  if(target.nativeTurnId&&(target.role==='user'||target.nativeTurnEnd===true)&&sourceSessionId&&threadId)
   return {sourceSessionId,threadId,...(messageId&&target.role==='user'?{beforeTurnId:target.nativeTurnId}:{lastTurnId:target.nativeTurnId})};
  if(session.status==='running')throw Error('运行中只可从已记录原生回执的完整回复创建分支。');
  if(!threadId)throw Error('原生会话身份缺失，无法创建保留历史的分支。');
  this.assertAllowed(session);
  const tracked=await this.connect(session,this.host(session));await tracked.queue;
  session=this.session(id);sourceSessionId=session.id;threadId=tracked.handle.threadId;
  const rpc=tracked.handle.connection.rpc;let cursor:string|undefined;const seen=new Set<string>();
  do{
   const page=await rpc.request<any>('thread/turns/list',{threadId,limit:100,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})});
   if(!Array.isArray(page.data))throw Error('原生历史回执无效，未创建分支。');
   for(const turn of page.data){
    const items=Array.isArray(turn.items)?turn.items:[],match=target.nativeTurnId===turn.id||anchor.nativeItemId&&items.some((item:any)=>item.id===anchor.nativeItemId);
    if(!match)continue;
    if(!['completed','interrupted','failed'].includes(turn.status))throw Error('此原生回合尚未结束。');
    if(target.role==='assistant'&&items.filter((item:any)=>item.type==='agentMessage').at(-1)?.id!==target.nativeItemId)throw Error('原生分支按完整回合保留历史，请选择此回合的最后一条回复。');
    return {sourceSessionId,threadId,...(messageId&&target.role==='user'?{beforeTurnId:turn.id}:{lastTurnId:turn.id})};
   }
   cursor=page.nextCursor??undefined;if(cursor&&(seen.has(cursor)||seen.size>=1000))throw Error('原生历史分页异常，未创建分支。');if(cursor)seen.add(cursor);
  }while(cursor);
  throw Error('无法核对该消息的原生回合，未创建分支。');
 }
 async interaction(id:string,requestId:RpcId,reply:InteractionReply){
  const t=this.tracked.get(id),item=this.session(id).nativeInteractions?.find(i=>i.id===requestId&&i.status==='pending');
  if(!t?.active||!t.lease||t.stopping||!item)throw Error('此问题已结束或失去连接，答案未发送。');
  this.leases.assert(t.lease);
  try{await t.handle.connection.rpc.replyInteraction(requestId,reply);}
  catch(error){if(!t.handle.connection.rpc.pendingApprovals().some(f=>f.value.id===requestId))await this.updateSession(id,s=>{const i=s.nativeInteractions?.find(i=>i.receipt===item.receipt);if(i?.status==='pending')i.status='uncertain';});throw error;}
  await t.queue;await this.updateSession(id,s=>{const i=s.nativeInteractions?.find(i=>i.receipt===item.receipt);if(i)i.status=reply.action==='submit'?'answered':reply.action==='decline'?'declined':'cancelled';});
 }
 async dispose(){this.closing=true;for(const timer of this.warmExpiry.values())clearTimeout(timer);for(const controller of this.restorations.values())controller.abort();const tracked=[...this.tracked.values()];await this.service.dispose();await Promise.allSettled(this.warming.values());await Promise.all(tracked.map(t=>t.queue));}
}
