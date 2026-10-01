import {UiMemoryScope} from './UiMemory';
import { useEffect, useRef } from 'react';
import type { Session } from '../../../packages/contracts';
import type { NativeChildMessage } from '../../../packages/collaboration-core/child-conversation';
import { ChildAgentCard, childStatus, ToolActivity } from './RuntimeTimeline';
import { BilingualMessageActions, TranslationAction } from './TranslationDisplay';
import { Icon } from './ui';
import MessageText, { type LinkActions } from './MessageText';
import { api } from './App';
import { completedReplyIds } from '../../../packages/session-core/turn-replies';
import ChildModelSettings from './ChildModelSettings';
import ActivityGroups from './ActivityGroups';
import { childSettings,mergeChildSettings } from '../../../packages/collaboration-core/child-settings';

interface Props {
  session:Session; childId?:string; sessions:Session[]; enabled:boolean;
  onClose:()=>void; onNavigate:(sessionId:string,childId?:string)=>void;
  copy:(text:string)=>void; actions:LinkActions;
}

/** Read-only public events; translations are requested one message at a time. */
export default function NativeChildConversation({session,childId,sessions,enabled,onClose,onNavigate,copy,actions}:Props){
  const dock=useRef<HTMLElement>(null),body=useRef<HTMLDivElement>(null),following=useRef(true);
  const child=childId?session.nativeChildren?.find(child=>child.nativeChildId===childId):undefined;
  const parent=child?session.nativeChildren?.find(item=>item.nativeChildId===child.nativeParentId):undefined;
  const messages:NativeChildMessage[]=childId?child?.messages??[]:session.messages.map(message=>({...message,text:message.submitted??message.original,at:message.timestamp,updatedAt:message.timestamp,complete:message.role==='user'||session.status!=='running'||!!message.nativeTurnEnd||message!==session.messages.at(-1)}));
  const replies=childId?completedReplyIds({status:child&&['completed','closed','failed'].includes(child.operation)?'idle':'running',messages:messages.map(message=>({id:message.id,role:message.role,original:message.text,timestamp:message.at,demo:false,...(!message.complete?{nativeTurnEnd:false}:{})}))}):completedReplyIds(session);
  const activities=(session.activities??[]).filter(item=>childId?item.nativeChildId===childId:!item.nativeChildId);
  const entries=[...messages.filter((message,index)=>!(index===0&&message.role==='user'&&child?.task===message.text)).map(message=>({kind:'message' as const,message,at:message.at,order:message.order??0,id:message.id})),...activities.map(activity=>({kind:'activity' as const,activity,at:activity.startedAt,order:activity.nativeOrder??0,id:activity.id}))].sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0)||a.order-b.order);
  const children=session.nativeChildren?.filter(item=>childId?item.nativeParentId===childId:!session.nativeChildren?.some(parent=>parent.nativeChildId===item.nativeParentId))??[];
  const delegated=childId?[]:sessions.filter(item=>item.agentParent?.sessionId===session.id);
  const translate=async(messageId?:string)=>{try{await api(childId?'child-message/translate':'message/retranslate',{sessionId:session.id,...(childId?{childId}:{}),...(messageId?{messageId}:{})});}catch(error){actions.report(error);}};
  useEffect(()=>{following.current=true;dock.current?.focus();},[session.id,childId]);
  useEffect(()=>{if(following.current&&body.current)body.current.scrollTop=body.current.scrollHeight;},[messages.at(-1)?.text,messages.length,activities.length,child?.updatedAt]);
  const title=childId?child?.title??'Subagent 会话':session.title.replace(/ · 子任务$/,'');
  const status=child?childStatus(child):session.nativeError?'未完成':{idle:'已完成',running:'运行中',blocked:'等待连接',uncertain:'状态未确认'}[session.status];
  const back=parent?()=>onNavigate(session.id,parent.nativeChildId):childId&&session.agentParent?()=>onNavigate(session.id):session.agentParent&&sessions.find(item=>item.id===session.agentParent?.sessionId)?.agentParent?()=>onNavigate(session.agentParent!.sessionId):onClose;
  return <UiMemoryScope.Provider value={JSON.stringify(['child',session.id,childId??'delegated'])}><aside className="child-conversation-dock" aria-label="Subagent 会话" data-testid="child-reader" tabIndex={-1} ref={dock} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose();}}}>
    <header className="child-reader-header"><small><span data-subagent-label>Subagent</span> · {(child?.runtime??session.binding.runtime)==='claude'?'Claude Code':'Codex'}</small><ChildModelSettings settings={childId?mergeChildSettings(childSettings({model:child?.model},'requested'),child?.settings):childSettings(session.nativeEffectiveModel??session.nativeActiveSettings?.modelSelection??session.modelSelection,session.nativeEffectiveModel?'native':'requested')}/><button className="icon-button" aria-label="关闭子会话面板" title="关闭子会话面板" onClick={onClose}><Icon name="close" size={16}/></button><h2>{title}</h2></header>
    <div className="child-conversation-nav"><button className="text-button" onClick={back}><Icon name="chevron" size={12}/>{parent||session.agentParent?'返回上级会话':'返回主会话'}</button><span className={status==='运行中'?'activity-pulse':''}>{status}</span><button className="icon-button" aria-label="复制原生标识" title="复制原生标识" onClick={()=>copy(childId??session.binding.nativeSessionId??session.id)}><Icon name="copy" size={13}/></button></div>
    <div className="child-conversation-body" data-testid="native-child-conversation" ref={body} onScroll={event=>{const element=event.currentTarget;following.current=element.scrollHeight-element.scrollTop-element.clientHeight<48;}}>
      {child?.usage&&<p className="child-reader-model">{[child.usage.toolUses!==undefined?`${child.usage.toolUses} 次工具调用`:undefined,child.usage.tokens!==undefined?`${child.usage.tokens.toLocaleString()} tokens`:undefined,child.usage.durationMs!==undefined?`${(child.usage.durationMs/1000).toFixed(1)} 秒`:undefined,child.lastTool].filter(Boolean).join(' · ')}</p>}
      {child?.task&&<section className="child-assignment" data-testid="child-assignment"><small>主 Agent 发来的任务</small><MessageText text={child.task} {...actions}/><BilingualMessageActions className="child-message-actions" sourceCopy={<button className="icon-button" data-testid="copy-child-task" aria-label="复制任务原文" title="复制任务原文" onClick={()=>copy(child.task!)}><Icon name="copy" size={14}/></button>} value={child.taskTranslation} actions={actions} onCopy={copy} copyTestId="copy-child-task-translation" iconSize={14}><TranslationAction value={child.taskTranslation??{}} enabled={enabled} onTranslate={()=>void translate()}/></BilingualMessageActions></section>}
      {<ActivityGroups entries={entries} render={entry=>entry.kind==='activity'?<ToolActivity key={'activity:'+entry.id} item={entry.activity} sessionId={session.id}/>:<article className={`child-message ${entry.message.role}`} key={'message:'+entry.id} data-testid="child-message" data-message-id={entry.id}><header>{entry.message.role==='user'?'主 Agent':<span data-subagent-label>Subagent</span>}{!entry.message.complete&&<small>正在回复…</small>}</header><MessageText text={entry.message.text} {...actions}/>{entry.message.truncated&&<small>此条内容较长，已截取显示。</small>}<BilingualMessageActions className="child-message-actions" showCopy={entry.message.role==='user'||replies.has(entry.id)} sourceCopy={<button className="icon-button" data-testid={"copy-child-message-"+entry.id} aria-label="复制消息" title="复制消息原文" onClick={()=>copy(entry.message.text)}><Icon name="copy" size={14}/></button>} value={entry.message} actions={actions} onCopy={copy} copyTestId={"copy-child-translation-"+entry.id} iconSize={14}><TranslationAction value={entry.message} enabled={enabled} complete={entry.message.complete} onTranslate={()=>void translate(entry.id)}/></BilingualMessageActions></article>}/>}
      {children.map(item=><ChildAgentCard key={item.nativeChildId} title={item.title??'Subagent'} source={item.runtime==='claude'?'Claude Code':'Codex'} status={childStatus(item)} preview={item.messages?.at(-1)?.text??item.task} onOpen={()=>onNavigate(session.id,item.nativeChildId)}/>)}
      {delegated.map(item=><ChildAgentCard key={item.id} title={item.title} source={item.binding.runtime==='claude'?'Claude Code':'Codex'} status={item.status==='running'?'运行中':item.nativeError?'未完成':item.status==='idle'?'已完成':'状态未确认'} preview={item.messages.at(-1)?.original} onOpen={()=>onNavigate(item.id)}/>)}
      {!entries.length&&<p className="child-conversation-empty">尚未收到此 Subagent 的公开消息。运行状态会继续更新。</p>}
      {childId&&!child&&<p className="child-conversation-empty">此 Subagent 记录已不可用。</p>}
    </div>
    <footer className="child-conversation-footer"><span>{child?.transcriptTruncated?'仅显示最近收到的记录。':'公开消息与工具记录 · 点击图标单条翻译'}</span></footer>
  </aside></UiMemoryScope.Provider>;
}
