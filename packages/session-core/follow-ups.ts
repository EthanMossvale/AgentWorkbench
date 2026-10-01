import type { DraftPreview, Session } from '../contracts';

export type FollowUpAction = 'queue' | 'steer';
export interface FollowUpMode { id: string; label: string; description: string; action: FollowUpAction }
export interface FollowUpIntent { modeId: string; action: FollowUpAction; expectedTurnId: string }
export interface FollowUpEntry { id: string; preview: DraftPreview; binding: string; afterTurnId: string; createdAt: string; status: 'queued' | 'paused' | 'sending' | 'uncertain'; error?: string }
export interface FollowUpModeHandle { id: string; dispose(): void }
export interface FollowUpsApi {
  enqueue(sessionId:string, preview:DraftPreview, expectedTurnId:string):Promise<{queued:boolean;id:string}>;
  send(sessionId:string, id:string, manual?:boolean):Promise<void>;
  cancel(sessionId:string, id:string):Promise<void>;
  pause(sessionId:string, reason?:string):Promise<void>;
  status(sessionId:string):{error?:string};
  subscribe(listener:()=>void):()=>void;
}
export interface FollowUpModesApi {
  list(): FollowUpMode[];
  resolve(id: string, canSteer: boolean, invert?: boolean): FollowUpAction;
  register(mode: FollowUpMode): FollowUpModeHandle;
  replace(id: string, mode: Omit<FollowUpMode, 'id'>): FollowUpModeHandle;
  subscribe(listener: () => void): () => void;
}
export const coreFollowUpModes: readonly FollowUpMode[] = [
  {id:'queue',label:'排队',description:'等待当前回合完成，再依次发送。',action:'queue'},
  {id:'steer',label:'引导',description:'在原生运行时支持的下一个接收节点加入消息。',action:'steer'},
];
export function followUpAction(modes: readonly FollowUpMode[], id: string, canSteer: boolean, invert = false): FollowUpAction {
  const selected=(modes.find(mode=>mode.id===id)??modes.find(mode=>mode.id==='steer')??coreFollowUpModes[1]!).action;
  const action=invert?(selected==='queue'?'steer':'queue'):selected;
  return action==='steer'&&!canSteer?'queue':action;
}
/** The selector and dispatcher consume this same live, owned catalog. */
export class FollowUpModeRegistry implements FollowUpModesApi {
  private modes=new Map(coreFollowUpModes.map(mode=>[mode.id,{...mode}]));
  private layers=new Map<string,FollowUpMode[]>();
  private listeners=new Set<()=>void>();
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private changed(){for(const listener of this.listeners)try{listener();}catch{/* A subscriber cannot leak a registration. */}}
  list(){return [...this.modes].map(([id,mode])=>({...this.layers.get(id)?.at(-1)??mode}));}
  resolve(id:string,canSteer:boolean,invert=false){return followUpAction(this.list(),id,canSteer,invert);}
  private validate(mode:FollowUpMode){if(!mode||!['queue','steer'].includes(mode.action)||typeof mode.label!=='string'||!mode.label.trim()||mode.label.length>80||typeof mode.description!=='string'||mode.description.length>500)throw Error('FOLLOW_UP_MODE_INVALID');}
  register(mode:FollowUpMode){this.validate(mode);if(!/^plugin:[a-z][a-z0-9.-]{1,79}\/[a-z][a-z0-9.-]{0,79}$/.test(mode.id)||this.modes.has(mode.id))throw Error('FOLLOW_UP_MODE_CONFLICT');const saved={...mode};this.modes.set(mode.id,saved);this.changed();return {id:mode.id,dispose:()=>{if(this.modes.get(mode.id)===saved){this.modes.delete(mode.id);this.layers.delete(mode.id);this.changed();}}};}
  replace(id:string,mode:Omit<FollowUpMode,'id'>){const value={...mode,id};this.validate(value);if(!this.modes.has(id))throw Error('FOLLOW_UP_MODE_MISSING');const layers=this.layers.get(id)??[];this.layers.set(id,layers);layers.push(value);this.changed();return {id,dispose:()=>{const i=layers.indexOf(value);if(i>=0){layers.splice(i,1);this.changed();}}};}
}
export function followUpBinding(session:Session){return JSON.stringify([session.binding,session.modelTargetId,session.modelSelection,session.permissionMode,session.projectPath]);}
export function recoverFollowUps(session:Session){
  if(session.followUps===undefined)return;
  if(!Array.isArray(session.followUps)||session.followUps.length>100)throw Error('FOLLOW_UP_STORAGE_INVALID');
  const ids=new Set<string>();
  for(const item of session.followUps){
    if(!item||typeof item.id!=='string'||ids.has(item.id)||item.preview?.id!==item.id||typeof item.preview.original!=='string'||typeof item.preview.translated!=='string'||typeof item.preview.sourceHash!=='string'||typeof item.binding!=='string'||typeof item.afterTurnId!=='string'||!['queued','paused','sending','uncertain'].includes(item.status))throw Error('FOLLOW_UP_STORAGE_INVALID');
    ids.add(item.id);
    if(item.status==='sending'){item.status='uncertain';item.error='发送回执因应用退出未确认；没有自动重发。';}
    else if(item.status==='queued'){item.status='paused';item.error='应用已重新启动；请检查后继续发送。';}
  }
}
