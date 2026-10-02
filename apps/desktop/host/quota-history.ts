import {createHash} from 'node:crypto';
import type {AppState, Session, SshHost} from '../../../packages/contracts';
import {captureModelUsage} from '../../../packages/model-management/usage';

export function quotaScope(session: Session, threadId: string): string {
  return createHash('sha256').update((session.accountMigration?'':'native-owner\0')+(session.accountMigration?.previousAccountRef??session.binding.accountRef)+'\0'+session.id+'\0'+threadId).digest('hex');
}

/** Recover only numeric receipts with a verified original account and host.
 * Missing/deleted session bindings remain unassigned, never guessed from cwd. */
export function quotaHistory(state: AppState, host: SshHost, accountRef: string, window?:{resetsAt:number;baselineAt?:number}): {scope:string;tokens:number;baselineTokens:number;resetsAt:number}[] {
  const captured={...state,sessions:state.sessions??[]};captureModelUsage(captured,captured);
  const sessions=new Map(captured.sessions.map(s=>[s.id,s]));
  const groups=new Map<string,{tokens:number;baselineTokens:number}>();
  for(const row of captured.modelUsage??[]){
    if(row.scope.kind!=='account'||row.scope.id!==accountRef||!Number.isSafeInteger(row.totalTokens)||row.totalTokens===null||row.totalTokens<0)continue;
    try{
      const [sessionId]=JSON.parse(row.key),session=sessions.get(sessionId);
      if(!session||session.binding.hostId!==host.id||session.binding.accountRef!==accountRef||session.binding.accountRuntime!=='native-owner'||session.branch||session.modelLanes?.length)continue;
      const [runtime,,thread]=JSON.parse(row.source);
      if(runtime!==session.binding.runtime||!['codex','claude'].includes(runtime))continue;
      const scopeId=runtime==='claude'?row.turnId:thread;
      if(typeof scopeId!=='string'||!scopeId)continue;
      const scope=quotaScope(session,scopeId);
      const value=groups.get(scope)??{tokens:0,baselineTokens:0};value.tokens+=row.totalTokens;
      const at=Date.parse(row.recordedAt)/1000;
      if(window&&window.baselineAt&&at>=window.resetsAt-604800&&at<window.baselineAt)value.baselineTokens+=row.totalTokens;
      groups.set(scope,value);
    }catch{/* Malformed or unbound historical evidence is not charged. */}
  }
  return [...groups].filter(([,value])=>Number.isSafeInteger(value.tokens)&&value.tokens<=1e14).map(([scope,value])=>({scope,...value,resetsAt:window?.resetsAt??0}));
}
