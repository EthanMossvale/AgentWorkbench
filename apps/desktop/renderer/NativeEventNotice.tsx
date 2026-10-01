import {RememberedDetails} from './UiMemory';
import type { NativeEventNotice as Notice } from '../../../packages/native-events';
import { Icon } from './ui';
import {useState} from 'react';
import {api} from './App';
import {nativeEventDiagnostic} from '../../../packages/native-events/diagnostics';

const labels={unknown:'收到尚未适配的原生事件',unsupported:'收到当前不支持的原生事件',malformed:'收到格式异常的原生事件',observed:'原生状态通知',handled:'原生事件',private:'原生内部事件'};
export default function NativeEventNotice({notice}:{notice:Notice}){
  const {receipt:r,presentation}=notice;
  const [copied,setCopied]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const copy=async()=>{setBusy(true);setCopied(false);setError('');try{await api('clipboard/write',{text:nativeEventDiagnostic(r)});setCopied(true);}catch{setError('复制失败，请重试。');}finally{setBusy(false);}};
  return <RememberedDetails memoryId="NativeEventNotice.details.1" scope={r.key} className={`runtime-step ${r.disposition==='observed'?'completed':'uncertain'}`} data-workbench-native-event data-event-key={r.key} data-event-runtime={r.runtime} data-event-disposition={r.disposition} data-testid="native-event-notice">
    <summary><Icon name="alert" size={14}/><span className="activity-caption">{presentation?.title??labels[r.disposition]}<span className="activity-title"> {r.key}</span></span><small className="activity-state">已接收 {r.count} 次</small><Icon name="chevron-down" size={12}/></summary>
    <div className="activity-content">
      {presentation?.detail&&<pre>{presentation.detail}</pre>}
      <p>{['handled','private'].includes(r.disposition)?'当前版本已识别此历史事件。此前未保留正文，因此不会追溯重放或补判任务结果。':r.disposition==='observed'?'已记录此通知。它本身不表示任务完成，也不会改变授权。':r.disposition==='unsupported'?'已识别此事件，但工作台未启用对应能力。它不表示当前任务还在运行；如需使用该能力，可据此记录补充适配。':'已保留兼容性记录。此事件不会被当作任务成功、授权或重试指令；需更新适配后才能完整处理。'}</p>
      {r.adapterFailed&&<p>事件展示插件处理失败，已恢复基础提示。</p>}
      {r.adapterId&&<p>展示适配器：{r.adapterId}；原生处理能力仍以事件状态为准。</p>}
      <div className="activity-meta"><span>{r.runtime==='codex'?'Codex':'Claude Code'}</span><span>{r.nativeChildId?'子会话':'主会话'}</span><span>最近接收：{r.lastAt}</span><span>帧长度：{r.lastBytes} 字节</span></div>
      <p>诊断仅保存事件类型、次数、时序和摘要校验值，不保存未知正文、隐藏推理或认证内容。</p>
      <button className="text-button" disabled={busy} onClick={()=>void copy()}>{busy?'正在复制…':copied?'已复制':'复制适配诊断'}</button>{error&&<p role="alert">{error}</p>}
    </div>
  </RememberedDetails>;
}
