import {RememberedDetails} from './UiMemory';
import type { TimelineEntry } from '../../../packages/collaboration-core/timeline';
import type { RuntimeActivity } from '../../../packages/collaboration-core/activity';
import { Icon } from './ui';
import './RuntimeTimeline.css';
import type { NativeChildSnapshot } from '../../../packages/collaboration-core/activity';
import PeerMessageCard from './PeerMessageCard';
import GeneratedImageResult from './GeneratedImageResult';
import RuntimeImageLog from './RuntimeImageLog';
import NativeEventNotice from './NativeEventNotice';
import {useState,useSyncExternalStore} from 'react';
import {activityGrouping,type ActivityChat} from '../../../packages/collaboration-core/activity-groups';
import {api} from './App';
import RuntimeUsage from './RuntimeUsage';

const labels = { command: '运行命令', 'file-edit': '编辑文件', tool: '调用工具', message: 'Agent 协作' };
const states = { running: '进行中', completed: '已完成', failed: '失败', cancelled: '已取消', uncertain: '结果未确认' };
const icons = { command: 'terminal', 'file-edit': 'compose', tool: 'settings', message: 'chat' };
const categoryLabels={search:['正在搜索','已搜索网页'],read:['正在读取','已读取文件'],image:['正在查看图像','已查看图像'],'image-generation':['正在生成图像','已生成图像'],compaction:['正在压缩上下文','上下文已压缩'],retry:['正在重新连接','已恢复连接'],hook:['正在执行 Hook','Hook 已结束'],notice:['运行时提示','运行时提示'],reasoning:['正在思考','思考已结束'],wait:['正在等待','等待已结束'],review:['正在审阅','审阅状态'],usage:['运行统计','运行统计']} as const;
const categoryIcons={search:'search',read:'document',image:'image','image-generation':'image',compaction:'layers',retry:'globe',hook:'settings',notice:'alert',reasoning:'sparkle',wait:'clock',review:'compose',usage:'layers'};
export function activityLabel(item:RuntimeActivity){const failed=['failed','cancelled','uncertain'].includes(item.status),name=failed&&item.category?({compaction:'上下文压缩',retry:'原生重连',reasoning:'思考',search:'网页搜索',image:'查看图像','image-generation':'图像生成',read:'读取文件',hook:'Hook',review:'审阅',wait:'等待',notice:'运行时提示',usage:'运行统计'}[item.category]):item.category?categoryLabels[item.category][item.status==='running'?0:1]:labels[item.kind];return name+(item.category==='retry'&&item.attempt?` ${item.attempt}${item.maxAttempts?'/'+item.maxAttempts:''}`:'');}
function ChatActivity({item,chat}:{item:RuntimeActivity;chat:ActivityChat}){
  const [error,setError]=useState('');
  const open=async()=>{if(!chat.targetSessionId)return;setError('');try{await api('navigation/open',{sessionId:chat.targetSessionId});}catch{setError('目标聊天已删除或暂时无法打开。');}};
  return <div className={`runtime-chat-event ${item.status}`} data-workbench-chat-event data-activity-id={item.id} data-target-session-id={chat.targetSessionId} data-testid="runtime-activity"><button type="button" className="runtime-chat-link" disabled={!chat.targetSessionId} onClick={()=>void open()}><Icon name="chat" size={14}/><span>{chat.label}</span>{chat.targetSessionId&&<Icon name="chevron" size={12}/>}<small>{states[item.status]}</small></button>{error&&<small role="alert">{error}</small>}</div>;
}
export function ToolActivity({ item,sessionId }: { item: RuntimeActivity;sessionId?:string }) {
  useSyncExternalStore(activityGrouping.subscribe,activityGrouping.getRevision,activityGrouping.getRevision);
  if(item.protocol)return <NativeEventNotice notice={item.protocol}/>;
  if(item.category==='image')return <RuntimeImageLog item={item} sessionId={sessionId}/>;
  if(item.imageDelivery)return <div className="generated-image-activity"><ToolActivity item={{...item,imageDelivery:undefined}}/><GeneratedImageResult delivery={item.imageDelivery}/></div>;
  const hasDetails = item.input !== undefined || item.output !== undefined || item.cwd !== undefined || item.exitCode !== undefined;
  const chat=activityGrouping.chat(item);
  if(chat)return <ChatActivity item={item} chat={chat}/>;
  const label=activityLabel(item),icon=item.category?categoryIcons[item.category]:icons[item.kind];
  if(!hasDetails)return <div className={`runtime-notice ${item.status}`} data-testid="runtime-activity" data-activity-id={item.id}><span className={item.status==='running'?'activity-pulse':''}><Icon name={icon} size={13}/></span><span>{label}</span>{item.title&&<small className="activity-caption">{item.title}</small>}{['failed','uncertain','cancelled'].includes(item.status)&&<small>{states[item.status]}</small>}</div>;
  return <RememberedDetails memoryId="RuntimeTimeline.details.1" scope={item.id} className={`runtime-step ${item.status}`} data-testid="runtime-activity" data-activity-id={item.id}>
    <summary aria-label={`${label} ${item.title ?? item.toolName ?? ''} ${states[item.status]}`}>
      <span className={item.status === 'running' ? 'activity-pulse' : ''}><Icon name={icon} size={14}/></span>
      <span className="activity-caption">{label}{(item.title || item.toolName) ? <span className="activity-title"> {item.title ?? item.toolName}</span> : null}{item.nativeChildId && <small> · Subagent</small>}</span>
      <small className="activity-state">{states[item.status]}</small><Icon name="chevron-down" size={12}/>
    </summary>
    <div className="activity-content">
      {(item.cwd || item.exitCode !== undefined || item.durationMs !== undefined) && <div className="activity-meta">{item.cwd && <span>目录：{item.cwd}</span>}{item.exitCode !== undefined && <span>退出码 {item.exitCode}</span>}{item.durationMs !== undefined && <span>{(item.durationMs / 1000).toFixed(1)} 秒</span>}</div>}
      {item.input !== undefined && <div><strong>{item.kind === 'command' ? '命令' : item.kind === 'file-edit' ? '文件修改' : '输入'}</strong><pre>{item.input}</pre>{item.inputTruncated && <small>输入较长，仅保留前 64 KiB。</small>}</div>}
      {item.category==='usage' ? <RuntimeUsage item={item} sessionId={sessionId}/> : item.output !== undefined && <div><strong>输出</strong><pre data-testid="activity-output">{item.output || '（无文本输出）'}</pre>{item.outputTruncated && <small>输出较长，仅保留前 64 KiB。</small>}</div>}
      {!hasDetails && <p>{item.status === 'running' ? '等待原生工具返回内容…' : '此记录未提供工具内容。'}</p>}
    </div>
  </RememberedDetails>;
}
export const childStatus=(child:NativeChildSnapshot)=>['spawn','progress'].includes(child.operation)&&child.backgroundActive===false?'已退出后台 · 结果待确认':child.status==='uncertain'?'状态未确认':child.status==='paused'?'已暂停':{spawn:'运行中',progress:'运行中',completed:'已完成',failed:'失败',closed:'已结束'}[child.operation];
export function ChildAgentCard({title,source,status,onOpen}:{title:string;source:string;status:string;preview?:string;onOpen:()=>void}){
  const label=status==='运行中'?'已开始工作':status;
  return <div className="child-agent-event"><button className="child-agent-pill" data-testid="child-agent-card" onClick={onOpen} aria-label={`查看子会话：${title}`} title={`${source} · ${label} · 查看会话`}><Icon name="user" size={12}/><span className="child-agent-name">{title}</span><span className={status==='运行中'?'activity-pulse':''}>{label}</span><Icon name="chevron" size={11}/></button></div>;
}
export default function RuntimeTimelineEntry({ entry, sessionId, activities=[], onOpenNative, onOpenSession, onOpenPeer }: { entry: Exclude<TimelineEntry, { type: 'message' }>; sessionId: string; activities?:RuntimeActivity[]; onOpenNative?:(id:string)=>void; onOpenSession?:(id:string)=>void; onOpenPeer?:(id:string)=>void }) {
  if (entry.type === 'activity') return <ToolActivity item={entry.activity} sessionId={sessionId}/>;
  if (entry.type === 'peer') {
    return <PeerMessageCard peer={entry.peer} sessionId={sessionId} counterpart={entry.counterpart} onOpen={onOpenPeer}/>;
  }
  if(entry.type==='delegated'){const child=entry.childSession,last=child.messages.filter(message=>message.role==='assistant').at(-1);return <ChildAgentCard title={child.title.replace(/ · 子任务$/,'')} source={[child.binding.runtime==='claude'?'Claude Code':'Codex',last?.modelSource?.name??child.modelSelection?.model].filter(Boolean).join(' · ')} status={child.nativeError?'未完成':{idle:'已完成',running:'运行中',blocked:'等待连接',uncertain:'状态未确认'}[child.status]} preview={last?.original??child.messages.find(message=>message.role==='user')?.original} onOpen={()=>onOpenSession?.(child.id)}/>;}
  const child = entry.child,last=activities.filter(item=>item.nativeChildId===child.nativeChildId).at(-1);
  return <ChildAgentCard title={child.title??child.task?.split('\n')[0]?.slice(0,100)??'Subagent'} source={[child.runtime==='claude'?'Claude Code':'Codex',child.model?`请求模型 ${child.model}`:undefined].filter(Boolean).join(' · ')} status={entry.lifecycle==='started'?'已开始工作':childStatus(child)} preview={child.messages?.at(-1)?.text??last?.title??last?.toolName??child.task} onOpen={()=>onOpenNative?.(child.nativeChildId)}/>;
}
