import { sessionPresentation } from '../../../packages/session-core/presentation';
import { randomUUID } from 'node:crypto';
import { metricsSource, recordSessionUsage } from '../../../packages/session-metrics';
import type { AppState, DraftPreview, Message, NativeModelSelection, PermissionMode, Session } from '../../../packages/contracts';
import { RuntimeExtensionRegistry, jsonState, type RuntimeContext, type RuntimeEvent, type RuntimeRegistration } from '../../../packages/runtime-extensions';
import { approvalOptions, type ApprovalReply } from '../../../packages/native-approvals';
import { expireInteractions, isRequestId, putInteraction, validateAnswers, validateForm, type InteractionReply, type RequestId } from '../../../packages/native-interactions';

interface Host { snapshot(): AppState; update(change: (state: AppState) => void): Promise<unknown>; translate(id: string, message: Message): void }
interface Run { entry: RuntimeRegistration; abort: AbortController; context: RuntimeContext; turn: string; closed: boolean; stopping: boolean; failure?: unknown; queue: Promise<void> }
/** Executes registered adapters through the same persisted sessions and composer. */
export class PluginRuntimeHost {
  private active = new Map<string, Run>();
  constructor(readonly registry: RuntimeExtensionRegistry, private host: Host) {
    registry.onRemove(entry=>this.removed(entry));
  }
  session(id: string) { const session=this.host.snapshot().sessions.find(s=>s.id===id); if(!session)throw Error('SESSION_NOT_FOUND'); return session; }
  entry(session: Session) {
    const entry=this.registry.get(session.binding.runtime);
    if(session.pluginRuntime?.version!==1)throw Error('RUNTIME_STATE_VERSION_UNSUPPORTED');
    if(session.pluginRuntime?.owner!==entry.owner)throw Error('RUNTIME_OWNER_MISMATCH');
    if(!entry.catalog.ready)throw Error('RUNTIME_UNAVAILABLE');
    return entry;
  }
  busy(id: string) { return this.active.has(id); }
  mode(runtime: string, value: unknown): PermissionMode {
    const entry=this.registry.get(runtime),mode=value??'default';
    if(!entry.definition.permissions.some(p=>p.value===mode))throw Error('RUNTIME_PERMISSION_UNSUPPORTED');
    return mode as PermissionMode;
  }
  selection(runtime: string, value: unknown): NativeModelSelection | undefined {
    const models=this.registry.get(runtime).catalog.models??[];
    if(value===undefined){const model=models.find(m=>m.isDefault)??models[0];return model?{model:model.model,...(model.defaultEffort?{effort:model.defaultEffort}:{}),...(model.defaultServiceTier?{serviceTier:model.defaultServiceTier}:{})}:undefined;}
    const s=value as NativeModelSelection,model=models.find(m=>m.model===s?.model);
    if(!model||s.effort!==undefined&&!model.efforts.includes(s.effort)||s.serviceTier!==undefined&&!model.serviceTiers.some(t=>t.id===s.serviceTier))throw Error('RUNTIME_MODEL_UNSUPPORTED');
    return {model:s.model,...(s.effort?{effort:s.effort}:{}),...(s.serviceTier?{serviceTier:s.serviceTier}:{})};
  }
  async initialize(session: Session) {
    await this.registry.discover(session.binding.runtime); const entry=this.registry.get(session.binding.runtime);
    if(!entry.catalog.ready)throw Error('RUNTIME_UNAVAILABLE');
    session.pluginRuntime={owner:entry.owner,version:1,name:entry.definition.name,permissions:structuredClone(entry.definition.permissions),capabilities:structuredClone(entry.catalog.capabilities),state:null};
    session.permissionMode=this.mode(session.binding.runtime,session.permissionMode);
    session.modelSelection=this.selection(session.binding.runtime,session.modelSelection);
    if(entry.adapter.create)session.pluginRuntime.state=jsonState(await entry.adapter.create(structuredClone(session),entry.signal.signal));
    if(!this.registry.current(entry))throw Error('RUNTIME_PLUGIN_UNAVAILABLE');
  }
  private runContext(id: string, entry: RuntimeRegistration): Run {
    const abort=new AbortController(),turn=randomUUID();
    const run:Run={entry,abort,turn,closed:false,stopping:false,queue:Promise.resolve(),context:undefined!};
    run.context=Object.freeze({signal:abort.signal,session:()=>structuredClone(this.session(id)),emit:(event:RuntimeEvent)=>{
      const copy=structuredClone(event);
      const operation=run.queue.then(async()=>{if(run.closed||abort.signal.aborted||!this.registry.current(entry)||this.active.get(id)!==run)throw Error('RUNTIME_EVENT_EXPIRED');await this.event(id,run,copy);});
      run.queue=operation.catch(error=>{run.failure=error;}); return operation;
    }});
    return run;
  }
  async submit(id: string, input: DraftPreview) {
    const session=this.session(id),entry=this.entry(session);
    if(this.busy(id)||session.status!=='idle')throw Error('RUNTIME_SESSION_BUSY');
    this.mode(session.binding.runtime,session.permissionMode);this.selection(session.binding.runtime,session.modelSelection);
    const run=this.runContext(id,entry);this.active.set(id,run);
    try { await this.host.update(state=>{const current=state.sessions.find(s=>s.id===id)!;current.status='running';current.nativeError=undefined;current.nativeTurnId=run.turn;
      current.messages.push({id:randomUUID(),role:'user',original:input.original,submitted:input.translated,demo:false,timestamp:new Date().toISOString(),annotations:input.annotations,attachments:input.attachments,skills:input.skills,nativeTurnId:run.turn});
      if(current.messages.filter(m=>m.role==='user').length===1)sessionPresentation.fallback(current,input.original.slice(0,40)||entry.definition.name);
    }); } catch(error){this.active.delete(id);run.closed=true;throw error;}
    void this.execute(id,run,()=>entry.adapter.run(run.context,structuredClone(input))).catch(()=>{});
    return {started:true,runtime:entry.definition.id};
  }
  private async execute(id: string, run: Run, operation: () => Promise<void>) {
    let error:unknown;
    try { if(!this.registry.current(run.entry)||run.closed)throw Error('RUNTIME_PLUGIN_UNAVAILABLE');await operation();await run.queue;if(run.failure)throw run.failure; } catch(e){error=e;}
    if(run.closed||this.active.get(id)!==run)return;
    run.closed=true;run.abort.abort();
    this.active.delete(id);
    try { await this.host.update(state=>{const s=state.sessions.find(s=>s.id===id);if(!s)return;
      s.status=error?'uncertain':'idle';s.nativeTurnStatus=error?'failed':'completed';s.nativeError=error?'RUNTIME_TURN_FAILED: Inspect the runtime before retrying.':undefined;s.nativeTurnId=run.turn;s.nativeApprovals=[];expireInteractions(s,error?'uncertain':'expired');
      for(const m of s.messages)if(m.nativeTurnId===run.turn)m.nativeTurnEnd=true;
    }); } finally { if(this.active.get(id)===run)this.active.delete(id); }
  }
  private async event(id: string, run: Run, event: RuntimeEvent) {
    if(!event||JSON.stringify(event).length>1_000_000)throw Error('RUNTIME_EVENT_INVALID');
    let translated:Message|undefined;
    await this.host.update(state=>{
      if(run.closed||!this.registry.current(run.entry))throw Error('RUNTIME_EVENT_EXPIRED');
      const s=state.sessions.find(s=>s.id===id);if(!s||s.pluginRuntime?.owner!==run.entry.owner)throw Error('RUNTIME_OWNER_MISMATCH');
      switch(event.type){
        case 'title':if(typeof event.title!=='string'||!event.title.trim()||event.title.length>500||/[\u0000-\u001f\u007f]/.test(event.title))throw Error('RUNTIME_TITLE_INVALID');sessionPresentation.nativeTitle(s,event.title);break;
        case 'usage':recordSessionUsage(s,event.usage,{source:metricsSource(s),turnId:run.turn,at:new Date().toISOString()});break;
        case 'checkpoint':s.pluginRuntime.state=jsonState(event.state);break;
        case 'message':{
          if(typeof event.id!=='string'||!event.id||event.id.length>256||typeof event.text!=='string'||event.text.length>100000||event.phase!==undefined&&!['final','commentary'].includes(event.phase))throw Error('RUNTIME_MESSAGE_INVALID');
          const key=run.turn+':'+event.id;let m=s.messages.find(m=>m.role==='assistant'&&m.nativeItemId===key);
          if(!m){m={id:randomUUID(),nativeItemId:key,nativeTurnId:run.turn,role:'assistant',original:'',demo:false,timestamp:new Date().toISOString()};s.messages.push(m);}
          m.original=event.text;m.phase=event.phase??'final';m.translation=undefined;m.translationStatus='off';if(event.phase==='final')translated=structuredClone(m);break;
        }
        case 'context':if(!event.usage||![event.usage.used,event.usage.total].every(n=>Number.isFinite(n)&&n>=0)||event.usage.capacity!==null&&(!Number.isFinite(event.usage.capacity)||event.usage.capacity<=0))throw Error('RUNTIME_CONTEXT_INVALID');s.nativeContextUsage=structuredClone(event.usage);break;
        case 'approval':{
          if(!run.entry.adapter.approval||!isRequestId(event.id)||!['command','file','tool','plan'].includes(event.kind)||typeof event.details!=='string'||!Array.isArray(event.options)||!event.options.length||event.options.some(o=>!o.id||!o.label||!['once','session','saved','deny','cancel'].includes(o.scope))||new Set(event.options.map(o=>o.id)).size!==event.options.length)throw Error('RUNTIME_APPROVAL_INVALID');
          s.nativeApprovals??=[];if(s.nativeApprovals.some(a=>a.id===event.id))throw Error('RUNTIME_APPROVAL_DUPLICATE');
          s.nativeApprovals.push({...structuredClone(event),turnId:run.turn,receipt:randomUUID(),decisions:[]});break;
        }
        case 'interaction':{
          if(!run.entry.adapter.interaction||!event.item||!isRequestId(event.item.id)||!['questions','form','url','permissions','unsupported'].includes(event.item.kind))throw Error('RUNTIME_INTERACTION_INVALID');
          putInteraction(s,{...structuredClone(event.item),threadId:id,turnId:run.turn,receipt:randomUUID(),receivedAt:new Date().toISOString(),status:'pending'});break;
        }
        default:throw Error('RUNTIME_EVENT_UNSUPPORTED');
      }
    });
    if(translated)this.host.translate(id,translated);
  }
  private live(id: string) {const run=this.active.get(id);if(!run||run.closed||!this.registry.current(run.entry))throw Error('RUNTIME_TURN_UNAVAILABLE');return run;}
  async stop(id: string) {
    const run=this.active.get(id);if(!run)return {stopped:false};if(run.stopping)throw Error('RUNTIME_STOP_PENDING');
    run.stopping=true;run.closed=true;run.abort.abort();await run.queue;
    let confirmed=false;
    try {await run.entry.adapter.stop(run.context);confirmed=true;return {stopped:true};}
    finally{await this.host.update(state=>{const s=state.sessions.find(s=>s.id===id);if(s){s.status=confirmed?'idle':'uncertain';s.nativeError=confirmed?undefined:'RUNTIME_STOP_UNCONFIRMED';s.nativeTurnId=undefined;s.nativeApprovals=[];expireInteractions(s,confirmed?'expired':'uncertain');}});if(this.active.get(id)===run)this.active.delete(id);}
  }
  async resume(id: string) {
    const session=this.session(id),entry=this.entry(session);if(this.busy(id)||session.status==='running'||!entry.adapter.resume)throw Error('RUNTIME_RESUME_UNAVAILABLE');
    const run=this.runContext(id,entry);this.active.set(id,run);
    try{await this.host.update(s=>{const current=s.sessions.find(s=>s.id===id)!;current.status='running';current.nativeTurnId=run.turn;});}catch(error){run.closed=true;this.active.delete(id);throw error;}
    void this.execute(id,run,()=>entry.adapter.resume!(run.context)).catch(()=>{});return {started:true,resumed:true};
  }
  async steer(id: string, input: DraftPreview) {
    const run=this.live(id);if(!run.entry.adapter.steer)throw Error('RUNTIME_STEER_UNSUPPORTED');
    await this.host.update(s=>{s.sessions.find(s=>s.id===id)!.messages.push({id:input.id,role:'user',original:input.original,submitted:input.translated,annotations:input.annotations,attachments:input.attachments,skills:input.skills,draftRevisions:input.revisions,demo:false,timestamp:new Date().toISOString(),nativeTurnId:run.turn,delivery:'pending'});});
    try{if(this.live(id)!==run)throw Error('RUNTIME_TURN_UNAVAILABLE');await run.entry.adapter.steer(run.context,structuredClone(input));await this.host.update(s=>{const message=s.sessions.find(s=>s.id===id)?.messages.find(m=>m.id===input.id);if(message)message.delivery='accepted';});}
    catch(error){await this.host.update(s=>{const message=s.sessions.find(s=>s.id===id)?.messages.find(m=>m.id===input.id);if(message)message.delivery='uncertain';});throw error;}
    return {started:true,steered:true};
  }
  async approval(id: string, requestId: RequestId, reply: ApprovalReply) {
    const run=this.live(id),approval=this.session(id).nativeApprovals?.find(a=>a.id===requestId);
    if(!run.entry.adapter.approval||!approval||!reply.receipt||reply.receipt!==approval.receipt)throw Error('APPROVAL_RECEIPT_EXPIRED');
    if(!reply.optionId||!approvalOptions(approval).some(o=>o.id===reply.optionId))throw Error('APPROVAL_OPTION_NOT_OFFERED');
    await this.host.update(s=>{const current=s.sessions.find(s=>s.id===id)!;if(!current.nativeApprovals?.some(a=>a.receipt===reply.receipt))throw Error('APPROVAL_RECEIPT_EXPIRED');current.nativeApprovals=current.nativeApprovals.filter(a=>a.receipt!==reply.receipt);});
    try{await run.entry.adapter.approval(run.context,requestId,structuredClone(reply));}catch(error){await this.replyFailed(id,run);throw error;}
  }
  async interaction(id: string, requestId: RequestId, reply: InteractionReply) {
    const run=this.live(id),item=this.session(id).nativeInteractions?.find(i=>i.id===requestId&&i.status==='pending');
    if(!run.entry.adapter.interaction||!item||!['submit','decline','cancel'].includes(reply.action))throw Error('RUNTIME_INTERACTION_EXPIRED');
    if(reply.action==='submit'){if(item.kind==='questions')validateAnswers(item.questions??[],reply.answers);if(item.kind==='form')validateForm(item.fields??[],reply.content);}
    await this.host.update(s=>{const current=s.sessions.find(s=>s.id===id)!.nativeInteractions?.find(i=>i.receipt===item.receipt);if(!current||current.status!=='pending')throw Error('RUNTIME_INTERACTION_EXPIRED');current.status=reply.action==='submit'?'answered':reply.action==='decline'?'declined':'cancelled';});
    try{await run.entry.adapter.interaction(run.context,requestId,structuredClone(reply));}catch(error){await this.replyFailed(id,run);throw error;}
  }
  private async replyFailed(id:string,run:Run){
    run.closed=true;run.abort.abort();
    try{await this.host.update(state=>{const session=state.sessions.find(s=>s.id===id);if(session){session.status='uncertain';session.nativeError='RUNTIME_REPLY_UNCONFIRMED';session.nativeApprovals=[];expireInteractions(session,'uncertain');}});}finally{if(this.active.get(id)===run)this.active.delete(id);}
  }
  async permissions(id: string, mode: PermissionMode) {const session=this.session(id),entry=this.entry(session);this.mode(session.binding.runtime,mode);if(this.busy(id)){if(!entry.adapter.permissions)throw Error('RUNTIME_LIVE_PERMISSIONS_UNSUPPORTED');await entry.adapter.permissions(this.live(id).context,mode);}}
  async fork(source: Session, destination: Session) {
    const entry=this.entry(source);if(!entry.adapter.fork)throw Error('RUNTIME_FORK_UNSUPPORTED');
    const checkpoint=jsonState(await entry.adapter.fork(structuredClone(source),structuredClone(destination),entry.signal.signal));
    if(!this.registry.current(entry))throw Error('RUNTIME_PLUGIN_UNAVAILABLE');
    destination.pluginRuntime={...structuredClone(source.pluginRuntime!),state:checkpoint};
  }
  private async removed(entry: RuntimeRegistration) {
    const ids=[...this.active].filter(([,run])=>run.entry===entry).map(([id,run])=>{run.closed=true;run.abort.abort();this.active.delete(id);return id;});
    if(ids.length)await this.host.update(s=>{for(const session of s.sessions)if(ids.includes(session.id)){session.status='uncertain';session.nativeError='RUNTIME_PLUGIN_UNAVAILABLE';session.nativeTurnId=undefined;session.nativeApprovals=[];expireInteractions(session,'uncertain');}});
  }
  async dispose(){await Promise.allSettled([...this.active.keys()].map(id=>this.stop(id)));}
}
