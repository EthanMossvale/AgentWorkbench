import type { Message, Session } from '../contracts';

/** UI turn boundaries only; native forks still require their recorded runtime receipt. */
export function completedReplyIds(session:Pick<Session,'messages'|'status'>):Set<string> {
  const groups:Message[][]=[];let group:Message[]=[],turnId:string|undefined;
  for(const message of session.messages){
    const nextId=message.nativeTurnId;
    const newTurn=group.length&&(message.role==='user'?(!nextId||nextId!==turnId):nextId&&turnId&&nextId!==turnId);
    if(newTurn){groups.push(group);group=[];turnId=undefined;}
    group.push(message);turnId=nextId??turnId;
  }
  if(group.length)groups.push(group);
  const result=new Set<string>();
  for(const [index,messages] of groups.entries()){
    if(index===groups.length-1&&['running','uncertain'].includes(session.status))continue;
    const last=messages.findLast(message=>message.role==='assistant');
    // Explicit process/unfinished metadata wins over the legacy unlabelled fallback.
    if(last&&last.nativeTurnEnd!==false&&(last.nativeTurnEnd===true||last.phase==='final'||!last.phase))result.add(last.id);
  }
  return result;
}
