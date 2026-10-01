import type { Session } from '../contracts';
import type { ConversationEntry } from './timeline';
import { completedReplyIds } from '../session-core/turn-replies';
import type { TurnTiming } from '../session-core/turn-timing';

export interface ReadingTurn {lastNativeEventAt?:string;lastVisibleEventAt?:string;ordered?:ConversationEntry[];id:string;users:ConversationEntry[];process:ConversationEntry[];answers:ConversationEntry[];completed:boolean;attention:boolean;replyId?:string;timing?:TurnTiming;active:boolean}
/** Collapse presentation only. The stored messages and native chronology never change. */
export function readingTurns(entries:ConversationEntry[],session:Session):ReadingTurn[]{
  const replies=completedReplyIds(session);
  const groups:ConversationEntry[][]=[];let current:ConversationEntry[]=[];let turnId:string|undefined;
  for(const entry of entries){
    if(entry.type==='peer'&&entry.peer.toSessionId===session.id){if(current.length){groups.push(current);current=[];}turnId=undefined;}
    if(entry.type==='message'&&entry.message.role==='user'){
      const nativeId=entry.message.nativeTurnId;
      if(current.length&&(!nativeId||nativeId!==turnId)){groups.push(current);current=[];}
      turnId=nativeId;
    }
    if(entry.type==='message'&&entry.message.role==='assistant'&&entry.message.nativeTurnId){
      if(current.length&&turnId&&turnId!==entry.message.nativeTurnId){groups.push(current);current=[];}
      turnId=entry.message.nativeTurnId;
    }
    current.push(entry);
  }
  if(current.length)groups.push(current);
  const latestTiming = session.turnTimings?.at(-1);
  const pendingTiming = latestTiming && !latestTiming.userMessageId ? latestTiming : undefined;
  if (pendingTiming && !entries.some(entry => entry.type === 'message' && pendingTiming.nativeTurnId && entry.message.nativeTurnId === pendingTiming.nativeTurnId)) groups.push([]);
  return groups.map((group,index)=>{
    const users=group.filter(e=>e.type==='message'&&e.message.role==='user'||e.type==='peer'&&e.peer.toSessionId===session.id);
    const assistant=group.filter(e=>e.type==='message'&&e.message.role==='assistant');
    const reply=assistant.findLast(e=>e.type==='message'&&replies.has(e.message.id));
    const userIds = new Set(users.filter(e => e.type === 'message').map(e => e.id));
    const nativeIds = new Set(group.flatMap(e => e.type === 'message' && e.message.nativeTurnId ? [e.message.nativeTurnId] : []));
    const active = index === groups.length - 1 && session.status === 'running';
    const timing = !group.length ? pendingTiming : session.turnTimings?.findLast(item => item.userMessageId ? userIds.has(item.userMessageId) : item.nativeTurnId ? nativeIds.has(item.nativeTurnId) : active && item.status === 'running');
    const interrupted = timing ? ['stopped','failed','uncertain'].includes(timing.status)
      : index === groups.length - 1 && ['interrupted','cancelled','canceled','stopped','failed'].includes(session.nativeTurnStatus ?? '');
    const completed=!!reply&&!interrupted&&(index<groups.length-1||session.status!=='running');
    const answers=group.filter(e=>e.type==='changes'||e.type==='message'&&e.message.role==='assistant'&&(e.message.nativeTurnEnd||e.message.phase==='final'));
    // Legacy replies without phase metadata stay readable instead of being silently hidden.
    if(completed&&!answers.some(e=>e.type==='message')&&assistant.at(-1))answers.push(assistant.at(-1)!);
    const process=group.filter(e=>!users.includes(e)&&!answers.includes(e));
    // A recovered failed attempt is history, not an outstanding action after a successful turn.
    const attention=process.some(e=>e.type==='activity'&&(['running','uncertain'].includes(e.activity.status)||!completed&&e.activity.status==='failed')||e.type==='child'&&(!['completed','closed','failed'].includes(e.child.operation)||e.child.status==='uncertain'||!completed&&e.child.operation==='failed')||e.type==='delegated'&&(e.childSession.status==='running'||e.childSession.status==='uncertain'||!completed&&e.childSession.status==='blocked'));
    const lastNativeEventAt=active?session.nativeEventAudit?.receipts.filter(r=>!r.nativeChildId&&(!timing||r.lastAt>=timing.startedAt)).map(r=>r.lastAt).sort().at(-1):undefined;
    const lastVisibleEventAt=active?group.flatMap(e=>e.type==='message'?[e.message.timestamp]:e.type==='activity'&&!['reasoning','wait','notice'].includes(e.activity.category??'')?[e.activity.updatedAt]:[]).sort().at(-1):undefined;
    return {lastNativeEventAt,lastVisibleEventAt,ordered:group,id:users[0]?.id??group[0]?.id??timing?.id??'pending-turn',users,process,answers,completed,attention,replyId:completed?reply?.id:undefined,timing,active};
  });
}
