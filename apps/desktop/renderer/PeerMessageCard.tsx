import {useUiPreference} from './ui-preferences';
import { useState } from 'react';
import type { PeerMessage } from '../../../packages/collaboration-core/types';
import { Icon } from './ui';

export interface PeerCounterpart { id:string; title:string; archived:boolean }
const runtimeName = (value: string) => value === 'claude' ? 'Claude Code' : value === 'codex' ? 'Codex' : value === 'api' ? 'API 模型' : '离线示例';
/** Provenance is stamped by the host; message text is never interpreted as a user role. */
export default function PeerMessageCard({peer,sessionId,counterpart,onOpen}:{peer:PeerMessage;sessionId:string;counterpart?:PeerCounterpart;onOpen?:(id:string)=>void}) {
  const [expanded,setExpanded]=useUiPreference<boolean>('disclosure.open',JSON.stringify(['peer',sessionId,peer.id])),outgoing=peer.fromSessionId===sessionId;
  const title=(outgoing?peer.toTitle:peer.fromTitle)??counterpart?.title??'另一会话';
  const runtime=runtimeName(outgoing?peer.toRuntime:peer.fromRuntime);
  const status={queued:'等待接收',claimed:'等待原生回执',delivered:'原生已接收',uncertain:'回执未确认'}[peer.status];
  const long=peer.text.length>320||peer.text.split('\n').length>4;
  return <article className={`peer-message ${outgoing?'outgoing':'incoming'}`} data-testid="peer-message" data-peer-id={peer.id}>
    <header className="peer-message-source"><Icon name="chat" size={12}/><span>{outgoing?'发往':'由 '+runtime+' 从'}</span><button className="text-button" disabled={!counterpart||!onOpen} title={counterpart?`打开${counterpart.archived?'已归档':''}会话：${counterpart.title}`:'来源会话已不可用；保留发送时的标题'} onClick={()=>counterpart&&onOpen?.(counterpart.id)}>{title}</button><span>{outgoing?'· '+runtime:'发送'}</span>{!counterpart&&<small>会话已不可用</small>}</header>
    <div className="peer-message-bubble"><div className={`peer-message-text ${long&&!expanded?'is-collapsed':''}`} data-testid="peer-message-text">{peer.text}</div>{long&&<button className="text-button peer-message-expand" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'收起':'显示更多'}<Icon name="chevron-down" size={11}/></button>}</div>
    <footer title="原生已接收仅表示输入回执，不代表模型已经阅读或完成任务。">{status}{peer.fromModel&&<span title="发送时记录的模型"> · {peer.fromModel}</span>}</footer>
  </article>;
}
