import type { Session, Message } from '../contracts';
import type { RuntimeActivity, NativeChildSnapshot } from './activity';
import type { PeerMessage } from './types';
import { turnFileChanges, type TurnFileChanges } from './file-changes';

export type TimelineEntry = { type: 'message'; id: string; message: Message; at: string; order?: number }
  | { type: 'activity'; id: string; activity: RuntimeActivity; at: string; order?: number }
  | { type: 'peer'; id: string; peer: PeerMessage; at: string; order?: number; counterpart?:Pick<Session,'id'|'title'|'archived'> }
  | { type: 'child'; id: string; child: NativeChildSnapshot; at: string; order?: number; lifecycle?: 'started' | 'finished' }
  | { type: 'delegated'; id:string; childSession:Session; at:string; order?:number };
/** Start positions stay fixed when output streams or a tool completes. */
export function sessionTimeline(session: Session, peers: PeerMessage[] = []): TimelineEntry[] {
  const entries: TimelineEntry[] = session.messages.map(message => ({ type: 'message', id: message.id, message, at: message.timestamp, order: message.nativeOrder }));
  entries.push(...(session.activities ?? []).filter(activity=>!activity.nativeChildId&&!( ['Agent','Task','spawnAgent'].includes(activity.toolName??'')&&session.nativeChildren?.some(child=>child.toolCallId&&activity.id.endsWith(':'+child.toolCallId)))).map(activity => ({ type: 'activity' as const, id: activity.id, activity, at: activity.startedAt, order: activity.nativeOrder })));
  // Incoming messages arrive as user cards. Pending ones appear once delivered; only
  // unconfirmed or legacy envelope deliveries without a user card keep the peer card.
  const received = new Set(session.messages.flatMap(message => message.peer ? [message.peer.messageId] : []));
  entries.push(...peers.filter(peer => peer.fromSessionId === session.id || peer.toSessionId === session.id && !['queued', 'claimed'].includes(peer.status) && !received.has(peer.id)).map(peer => ({ type: 'peer' as const, id: peer.id, peer, at: peer.createdAt })));
  for(const child of (session.nativeChildren??[]).filter(child=>!session.nativeChildren?.some(parent=>parent.nativeChildId===child.nativeParentId))){
    const terminal=['completed','failed','closed'].includes(child.operation),start=child.startedAt??child.updatedAt;
    entries.push({type:'child',id:child.nativeChildId+':start',child,at:start,...(terminal&&start!==child.updatedAt?{lifecycle:'started' as const}:{})});
    if(terminal&&start!==child.updatedAt)entries.push({type:'child',id:child.nativeChildId+':end',child,at:child.updatedAt,lifecycle:'finished'});
  }
  return chronological(entries);
}
/** Stable chronological order; each timestamp is parsed once rather than in every comparison. */
function chronological<T extends {at:string;order?:number}>(entries:T[]):T[]{
  const keyed=entries.map(entry=>({entry,time:Date.parse(entry.at)||0,order:entry.order??0}));
  keyed.sort((a,b)=>a.time-b.time||a.order-b.order);
  keyed.forEach((item,index)=>{entries[index]=item.entry;});
  return entries;
}

export type ConversationEntry = TimelineEntry | {type:'changes';id:string;changes:TurnFileChanges} | {type:'interaction';id:string;item:import('../native-interactions').NativeInteraction;at:string};
/** Cards finish the corresponding user turn; later turns never inherit earlier file edits. */
export function conversationTimeline(session:Session,peers:PeerMessage[]=[],children:Session[]=[]):ConversationEntry[] {
  const entries:TimelineEntry[]=[...sessionTimeline(session,peers),...children.filter(child=>child.agentParent?.sessionId===session.id).map(child=>({type:'delegated' as const,id:child.id,childSession:child,at:child.createdAt}))];chronological(entries);const groups=turnFileChanges(session);
  const groupUser=new Map(groups.map(group=>[group.id,group.userMessageId??session.messages.findLast(message=>message.role==='user'&&message.nativeTurnId===group.id)?.id]));
  // Legacy unbound records stay visible before bound turns, never on a fresh live turn.
  const result:ConversationEntry[]=groups.filter(group=>!groupUser.get(group.id)).map(changes=>({type:'changes',id:changes.id,changes}));
  for(const entry of entries)if(entry.type==='peer'){const target=children.find(item=>item.id===(entry.peer.fromSessionId===session.id?entry.peer.toSessionId:entry.peer.fromSessionId));if(target)entry.counterpart={id:target.id,title:target.title,archived:target.archived};}
  let currentUser:string|undefined;
  const append=(id:string|undefined)=>{for(const changes of groups.filter(group=>!!id&&groupUser.get(group.id)===id))result.push({type:'changes',id:changes.id,changes});};
  for(const entry of entries){
    if(entry.type==='message'&&entry.message.role==='user'){if(currentUser)append(currentUser);currentUser=entry.message.id;}
    result.push(entry);
  }
  if(currentUser)append(currentUser);
  for(const item of session.nativeInteractions??[]){
    if(item.status==='pending')continue;
    const entry:ConversationEntry={type:'interaction',id:item.receipt??('interaction:'+typeof item.id+':'+item.id+':'+item.receivedAt),item,at:item.receivedAt};
    const anchor=result.findIndex(e=>e.type==='message'&&e.message.role==='user'&&(e.message.nativeTurnId===item.turnId&&!!item.turnId||e.message.id===item.turnId));
    const next=anchor<0?-1:result.findIndex((e,index)=>index>anchor&&e.type==='message'&&e.message.role==='user'&&e.message.nativeTurnId!==item.turnId);
    const start=anchor<0?0:anchor+1,end=next<0?result.length:next;
    let position=end;
    for(let index=start;index<end;index++){const e=result[index]!;if('at' in e&&Date.parse(e.at)>Date.parse(item.receivedAt)){position=index;break;}}
    result.splice(position,0,entry);
  }
  return result;
}
