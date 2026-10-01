import type { NativeFrame } from '../../services/remote-supervisor';
import type { Session } from '../contracts';
import { record } from './catalog';

export type NativeTaskKind = 'agent' | 'command' | 'other';
export interface NativeBackgroundTask { id:string; type:string; description:string; ambient:boolean }
export interface NativeBackgroundState { tasks:NativeBackgroundTask[]; updatedAt:string; observing:boolean }
export interface NativeCommandState { id:string; state:'queued'|'started'|'completed'|'cancelled'|'discarded'|'refused' }
export interface NativeProtocolState {
  sessionState?:'idle'|'running'|'requires_action';
  commands?:{name:string;description:string;argumentHint:string}[];
  conversationId?:string;
  resetAt?:string;
  perTurnEffortActive?:boolean;
}
export interface NativeEventSemantics {
  /** Admission for state mutations; auditing and activity routing remain independent. */
  accepts(frame:NativeFrame):boolean;
  batchWindowMs():number;
  auditWindowMs():number;
  taskKind(type:string):NativeTaskKind;
  background(value:Readonly<Record<string,unknown>>):NativeBackgroundTask[]|undefined;
  command(value:Readonly<Record<string,unknown>>):NativeCommandState|undefined;
  apply(session:Session,frame:NativeFrame):void;
}
const text=(v:unknown,max=512)=>typeof v==='string'&&v.length>0&&v.length<=max?v:undefined;
export const nativeEventSemantics:NativeEventSemantics={
  batchWindowMs:()=>32,
  auditWindowMs:()=>1000,
  accepts(frame){
    // Legacy semantic extensions may consume any frame. Preserve their admission
    // unless they explicitly replace this predicate with their own narrower one.
    return this.apply!==coreApply||this.background!==coreBackground||this.command!==coreCommand||frame.value.type!=='stream_event'&&!(frame.value.type==='system'&&frame.value.subtype==='thinking_tokens');
  },
  taskKind:type=>['local_agent','remote_agent'].includes(type)?'agent':['local_bash','local_shell'].includes(type)?'command':'other',
  background(value){
    if(value.type!=='system'||value.subtype!=='background_tasks_changed'||!Array.isArray(value.tasks)||value.tasks.length>2048)return;
    const tasks:NativeBackgroundTask[]=[],seen=new Set<string>();
    for(const raw of value.tasks){const task=record(raw),id=text(task.task_id),type=text(task.task_type,100);if(!id||!type||seen.has(id)||task.ambient!==undefined&&typeof task.ambient!=='boolean')return;seen.add(id);tasks.push({id,type,description:typeof task.description==='string'?task.description.slice(0,1024):'',ambient:task.ambient===true});}
    return tasks;
  },
  command(value){
    const id=text(value.command_uuid);if(value.type==='command_lifecycle'&&id&&['queued','started','completed','cancelled','discarded','refused'].includes(String(value.state)))return {id,state:value.state as NativeCommandState['state']};
  },
  apply(session,frame){
    const v=frame.value;
    nativeBackgroundFrame(session,frame);
    const command=this.command(v);
    if(command){const message=session.messages.find(m=>m.role==='user'&&m.id===command.id);if(message)message.nativeCommandState=command.state;}
    if(v.type==='system'){
      if(v.subtype==='session_state_changed'&&['idle','running','requires_action'].includes(String(v.state)))(session.nativeProtocol??={}).sessionState=v.state as NativeProtocolState['sessionState'];
      if(v.subtype==='commands_changed'&&Array.isArray(v.commands)&&v.commands.length<=2048&&v.commands.every(raw=>text(record(raw).name)))
        (session.nativeProtocol??={}).commands=v.commands.map(raw=>{const c=record(raw);return {name:String(c.name),description:typeof c.description==='string'?c.description.slice(0,2048):'',argumentHint:typeof c.argumentHint==='string'?c.argumentHint.slice(0,512):''};});
      if(['init','per_turn_effort_changed'].includes(String(v.subtype))&&typeof v.per_turn_effort_active==='boolean')(session.nativeProtocol??={}).perTurnEffortActive=v.per_turn_effort_active;
    }
    if(v.type==='conversation_reset'&&text(v.new_conversation_id)){
      Object.assign(session.nativeProtocol??={}, {conversationId:v.new_conversation_id,resetAt:frame.receivedAt});
      delete session.nativeContextUsage;delete session.nativePlan;
    }
  },
};
const coreApply=nativeEventSemantics.apply,coreBackground=nativeEventSemantics.background,coreCommand=nativeEventSemantics.command;
/** A level snapshot is independent of edge completion/result, and resets per process. */
export function nativeBackgroundFrame(session:Session,frame:NativeFrame){
  const tasks=nativeEventSemantics.background(frame.value);
  if(tasks){
    session.nativeBackground={tasks,updatedAt:frame.receivedAt,observing:true};
    for(const child of session.nativeChildren??[])if(child.background===true||tasks.some(task=>task.id===child.nativeChildId))child.backgroundActive=tasks.some(task=>task.id===child.nativeChildId&&!task.ambient);
  }
}
export function hasNativeBackground(session:Pick<Session,'nativeBackground'|'nativeChildren'|'nativeObservation'>){
  if(session.nativeObservation==='disconnected')return false;
  if(session.nativeBackground)return session.nativeBackground.observing&&session.nativeBackground.tasks.some(task=>!task.ambient);
  return !!session.nativeChildren?.some(child=>['spawn','progress'].includes(child.operation)&&!['uncertain','message-unclassified'].includes(child.status));
}
