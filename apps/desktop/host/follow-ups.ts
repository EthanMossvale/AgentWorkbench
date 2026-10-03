import type { AppState, DraftPreview, Session } from '../../../packages/contracts';
import { followUpBinding, FollowUpModeRegistry, type FollowUpAction, type FollowUpsApi } from '../../../packages/session-core/follow-ups';

interface Hooks {
  snapshot(): AppState;
  /** Optional shared read of the committed state for scans that copy nothing. */
  read?(): Readonly<AppState>;
  update(change:(state:AppState)=>void):Promise<unknown>;
  blocked(id:string):boolean;
  canSteer(session:Session):boolean;
  dispatch(id:string,preview:DraftPreview,action:FollowUpAction|undefined,turnId:string|undefined,beforeDispatch:()=>void):Promise<unknown>;
}
/** Durable explicit user queue. Failures, stop and restart never replay a submission. */
export class FollowUpService implements FollowUpsApi {
  readonly modes=new FollowUpModeRegistry();
  private sending=new Set<string>();
  private scheduled=false;
  private closed=false;
  private stopEpoch=new Map<string,number>();
  private errors=new Map<string,string>();
  private listeners=new Set<()=>void>();
  constructor(private hooks:Hooks){}
  status(id:string){return {error:this.errors.get(id)};}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private storageFailure(id:string){this.errors.set(id,'队列状态未能保存，自动发送已暂停；请检查本机存储后再手动操作。');for(const listener of this.listeners)try{listener();}catch{/* Subscribers cannot restart a failed queue. */}}
  private clearError(id:string){if(this.errors.delete(id))for(const listener of this.listeners)try{listener();}catch{/* Isolate subscriber failures. */}}
  private session(id:string){const s=this.hooks.snapshot().sessions.find(s=>s.id===id);if(!s)throw Error('FOLLOW_UP_SESSION_MISSING');return s;}
  async enqueue(id:string,preview:DraftPreview,turnId:string){
    await this.hooks.update(state=>{const session=state.sessions.find(s=>s.id===id)!;if(this.closed||session.nativeTurnId!==turnId||!['running','idle'].includes(session.status))throw Error('FOLLOW_UP_TURN_CHANGED');session.followUps??=[];if(session.followUps.some(item=>item.id===preview.id))throw Error('FOLLOW_UP_QUEUE_FULL_OR_DUPLICATE');session.followUps.push({id:preview.id,preview:structuredClone(preview),binding:followUpBinding(session),afterTurnId:turnId,createdAt:new Date().toISOString(),status:'queued'});});
    this.observe();return {queued:true,id:preview.id};
  }
  observe(){if(this.closed||this.scheduled)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;for(const s of (this.hooks.read?.()??this.hooks.snapshot()).sessions)if(!this.errors.has(s.id)&&s.followUps?.some(q=>q.status==='queued'))void this.pump(s.id).catch(()=>this.storageFailure(s.id));});}
  private async pump(id:string){
    const session=this.session(id);if(this.closed||this.sending.has(id)||this.hooks.blocked(id)||session.status==='running')return;
    if(session.status!=='idle'||session.nativeTurnStatus!=='completed'||session.archived){await this.pause(id,'当前回合已停止、失败或结果未确认；排队消息保留。');return;}
    const entry=session.followUps?.find(q=>q.status==='queued');if(entry)await this.send(id,entry.id,false);
  }
  async pause(id:string,reason='你已停止当前回合；排队消息保留，可手动继续。'){
    this.stopEpoch.set(id,(this.stopEpoch.get(id)??0)+1);
    if(!this.session(id).followUps?.some(q=>q.status==='queued'))return;
    try{await this.hooks.update(state=>{for(const q of state.sessions.find(s=>s.id===id)!.followUps??[])if(q.status==='queued'){q.status='paused';q.error=reason;}});}catch(error){this.storageFailure(id);throw error;}
  }
  async cancel(id:string,messageId:string){
    await this.hooks.update(state=>{const s=state.sessions.find(s=>s.id===id);const q=s?.followUps?.find(q=>q.id===messageId);if(!s||!q||!['queued','paused'].includes(q.status))throw Error('FOLLOW_UP_ALREADY_DISPATCHED');s.followUps=s.followUps!.filter(item=>item.id!==messageId);});
  }
  async send(id:string,messageId:string,manual=true){
    if(this.closed||this.sending.has(id)||this.hooks.blocked(id))throw Error('FOLLOW_UP_BUSY');
    this.sending.add(id);let dispatched=false,selected=false;const epoch=this.stopEpoch.get(id)??0;
    try{
      const s=this.session(id),q=s.followUps?.find(q=>q.id===messageId);
      if(!q||!['queued','paused'].includes(q.status)||s.archived||!['running','idle','blocked'].includes(s.status))throw Error('FOLLOW_UP_UNAVAILABLE');
      if(!manual&&q.status!=='queued')return;
      selected=true;
      if(q.binding!==followUpBinding(s))throw Error('FOLLOW_UP_BINDING_CHANGED');
      if(s.status==='running'&&(!manual||!s.nativeTurnId||!this.hooks.canSteer(s)))throw Error('FOLLOW_UP_STEER_UNAVAILABLE');
      await this.hooks.update(state=>{const current=state.sessions.find(s=>s.id===id)!.followUps!.find(item=>item.id===messageId);if(!current||!['queued','paused'].includes(current.status))throw Error('FOLLOW_UP_ALREADY_DISPATCHED');current.status='sending';delete current.error;});
      const beforeDispatch=()=>{
        if(this.closed||(this.stopEpoch.get(id)??0)!==epoch)throw Error('FOLLOW_UP_STOPPED');
        const current=this.session(id);
        if(followUpBinding(current)!==q.binding||current.status!==s.status||current.nativeTurnId!==s.nativeTurnId||current.archived)throw Error('FOLLOW_UP_TURN_CHANGED');
        dispatched=true;
      };
      await this.hooks.dispatch(id,q.preview,s.status==='running'?'steer':undefined,s.nativeTurnId,beforeDispatch);
      await this.hooks.update(state=>{const current=state.sessions.find(s=>s.id===id)!;current.followUps=current.followUps?.filter(item=>item.id!==messageId);});
      this.clearError(id);
    }catch(error){
      if(!selected)throw error;
      try{await this.hooks.update(state=>{const q=state.sessions.find(s=>s.id===id)?.followUps?.find(item=>item.id===messageId);if(q){q.status=dispatched?'uncertain':'paused';q.error=dispatched?'发送回执未确认；没有自动重发。':error instanceof Error?error.message:'FOLLOW_UP_FAILED';}});
      await this.pause(id,'队列已暂停，请先检查前一条消息的状态。');}catch(storageError){this.storageFailure(id);throw storageError;}
      if(manual)throw error;
    }finally{this.sending.delete(id);this.observe();}
  }
  dispose(){this.closed=true;this.listeners.clear();}
}
