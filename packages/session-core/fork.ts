import { isPluginRuntime } from '../runtime-extensions/types';
import type { Message, NativeForkSource, Session } from '../contracts';
import { claudeForkTransport } from './native-fork';
import { completedReplyIds } from './turn-replies';

export function nextForkTitle(source: Session, sessions: readonly Session[]) {
  const base=source.branch?.titleBase??(source.branch?source.title.replace(/ · 分支$| \(\d+\)$/,''):source.title);
  let number=0;
  for(const session of sessions){
    if(session.branch?.titleBase===base)number=Math.max(number,session.branch.number??0);
    if(session.title.startsWith(base+' (')){const suffix=session.title.slice(base.length);if(/^ \(\d+\)$/.test(suffix))number=Math.max(number,Number(suffix.slice(2,-1)));}
  }
  do{number++;}while(sessions.some(session=>session.title===`${base.slice(0,140)} (${number})`));
  return {title:`${base.slice(0,140)} (${number})`,titleBase:base,number};
}

/** Display eligibility is also checked by the host; it never grants runtime access. */
export function forkUnavailable(session:Session,messageId?:string):string|undefined {
  if(isPluginRuntime(session.binding.runtime)&&!session.pluginRuntime?.capabilities.fork)return '运行时插件未提供会话分支接口。';
  if(session.status==='running'&&(!messageId||!completedReplyIds(session).has(messageId)))return '当前回合尚未结束，请从上方已完成的回复创建分支。';
  if(session.status==='uncertain')return '请先核对原生回合结果，再创建分支。';
  if(session.binding.runtime==='claude'&&session.messages.length){
    if(!claudeForkTransport(session))return '此 Claude 连接不支持原生分支。';
    const target=messageId?session.messages.find(message=>message.id===messageId):session.messages.at(-1);
    if(!target||target.role!=='assistant'||target.nativeTurnEnd!==true||!target.nativeItemId||!session.binding.nativeSessionId&&!session.branch?.native?.threadId)return '请选择具有原生消息回执的完整 Claude 回复创建分支。';
    if(target.modelSource&&target.modelSource.runtime!=='claude')return '请切换到这条回复所属的运行时后创建分支。';
    if(session.modelTargetId&&target.modelSource?.targetId&&target.modelSource.targetId!==session.modelTargetId)return '请切换到这条回复所属的模型连接后创建分支。';
  }
  if(messageId){
    const index=session.messages.findIndex(message=>message.id===messageId),message=session.messages[index];
    if(!message)return '分支起点已不存在。';
    if(message.role==='assistant'&&!completedReplyIds(session).has(messageId))return '请选择此回合结束后的回复创建分支。';
    if(session.status==='running'&&session.binding.runtime==='codex'&&(!message.nativeTurnId||message.nativeTurnEnd!==true||!session.binding.nativeSessionId&&!session.branch?.native?.threadId))return '运行中只可从已记录原生回执的完整回复创建分支。';
  }
}

/** Ignore later turns and display-only retranslation, but freeze the selected native history and identity. */
export function forkSourceKey(source:Session,messageId?:string):string {
  const end=messageId?source.messages.findIndex(message=>message.id===messageId)+1:source.messages.length;
  return JSON.stringify({binding:source.binding,projectId:source.projectId,projectPath:source.projectPath,worktree:source.worktree,
    modelTargetId:source.modelTargetId,modelSelection:source.modelSelection??source.nativeEffectiveModel,permissionMode:source.permissionMode,
    nativeAgentPolicy:source.nativeAgentPolicy,pluginRuntime:source.pluginRuntime,branch:source.branch,
    messages:source.messages.slice(0,end).map(({translation,translationStatus,translationError,translationSource,progressTranslation,...message})=>message)});
}

export function forkMessages(source:Session,messageId?:string):Message[] {
  const index=messageId?source.messages.findIndex(message=>message.id===messageId):source.messages.length-1;
  if(messageId&&index<0)throw Error('分支起点已不存在。');
  const before=messageId&&source.messages[index]?.role==='user';
  return structuredClone(source.messages.slice(0,index+(before?0:1)));
}

/** Fork data is selected explicitly: live approvals, peers and children are not inherited. */
export function createSessionFork(source:Session,id:string,createdAt:string,messageId?:string,native?:NativeForkSource):Session {
  const reason=forkUnavailable(source,messageId);if(reason)throw Error(reason);
  const messages=forkMessages(source,messageId),included=new Set(messages.map(message=>message.id));
  const turns=new Set(messages.flatMap(message=>message.nativeTurnId?[message.nativeTurnId]:[]));
  const last=messages.at(-1),at=last?.timestamp??'';
  // Older desktop history has no turn IDs on messages. This timestamp fallback
  // is for already-displayed activity only; native context always uses exact IDs.
  const legacy=messages.some(message=>!message.nativeTurnId);
  const retained=(turnId:string|undefined,time:string)=>turnId&&turns.has(turnId)||(!turnId||legacy)&&!!at&&time<=at;
  for(const message of messages)if(message.translationStatus==='pending'){message.translationStatus='failed';message.translationError='此条译文未完成，可在分支中重试。';}
  const draft=messageId?source.messages.find(message=>message.id===messageId):undefined;
  const {nativeSessionId:_nativeSessionId,executionSessionId:_executionSessionId,...binding}=structuredClone(source.binding);
  return {
    id,projectId:source.projectId,projectPath:source.projectPath,title:nextForkTitle(source,[source]).title,
    ...(source.worktree?{worktree:structuredClone(source.worktree)}:{}),
    pinned:false,archived:false,unread:false,group:source.group,createdAt,
    binding,...(source.modelTargetId?{modelTargetId:source.modelTargetId}:{}),
    pluginRuntime: source.pluginRuntime ? structuredClone(source.pluginRuntime) : undefined,
    status:source.binding.runtime==='demo'?'idle':source.status==='blocked'?'blocked':'idle',messages,
    permissionMode:source.permissionMode,modelSelection:structuredClone(source.modelSelection??source.nativeEffectiveModel),
    nativeAgentPolicy:structuredClone(source.nativeAgentPolicy),
    branch:{sourceSessionId:source.id,sourceTitle:source.title,sourceMessageId:messageId??source.messages.at(-1)?.id,createdAt,location:'workspace',inheritedMessageCount:messages.length,...(native?{native}:{})},
    ...(draft?.role==='user'?{...(draft.annotations?.length?{annotationDraft:{version:1 as const,revision:1,items:structuredClone(draft.annotations).map(({id,text,source})=>({id,text,source}))}}:{}),forkDraft:draft.original,forkSkills:structuredClone(draft.skills),forkAttachments:structuredClone(draft.attachments)}:{}),
    activities:structuredClone((source.activities??[]).filter(item=>!item.nativeChildId&&item.status!=='running'&&retained(item.turnId,item.updatedAt))),
    fileChangeRecords:structuredClone((source.fileChangeRecords??[]).filter(item=>item.userMessageId?included.has(item.userMessageId):retained(item.turnId,item.at))),
  };
}
