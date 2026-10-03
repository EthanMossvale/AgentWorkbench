import {RememberedDetails} from './UiMemory';
import {useUiPreference} from './ui-preferences';
import {useEffect,useRef,useState} from 'react';
import type {SshHost} from '../../../packages/contracts';
import type {RemoteCliPolicy,RemoteCliProvider} from '../../../packages/remote-account-catalog/cli';
import {retentionCountdown,type RetentionInspection,type RetentionLogPage,type RetentionLogEntry} from '../../../packages/remote-account-catalog/retention-types';
import {api} from './App';
import {Icon,Toggle,errorText} from './ui';
import './RemoteSessionRetention.css';

const names={codex:'Codex',claude:'Claude Code'};
const kinds:Record<RetentionLogEntry['kind'],string>={checked:'检查',archiving:'归档',reclaimed:'已清理',deferred:'待续传',error:'未完成',cancelled:'已取消',restoring:'恢复中',restored:'已恢复',policy:'设置'};
const stamp=(seconds:number)=>new Date(seconds*1000).toLocaleString('zh-CN',{hour12:false});
const size=(bytes:number)=>bytes>=1073741824?(bytes/1073741824).toFixed(2)+' GB':bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.ceil(bytes/1024)+' KB';
const elapsed=(seconds:number|null)=>seconds===null?'待核实':seconds>=3600?`${Math.floor(seconds/3600)}时 ${Math.floor(seconds%3600/60)}分`:`${Math.floor(seconds/60)}分`;

export default function RemoteSessionRetention({host,notify}:{host:SshHost;notify:(text:string)=>void}){
 const [provider,setProvider]=useUiPreference<RemoteCliProvider>('settings.retention-provider',host.id);
 return <section className="remote-retention" role="tabpanel" id="connection-panel-retention" aria-labelledby="connection-tab-retention">
  <div className="retention-provider" role="tablist" aria-label="会话清理运行时">{(['codex','claude'] as const).map(p=><button type="button" role="tab" aria-selected={p===provider} aria-controls="retention-provider-panel" id={`retention-provider-${p}`} key={p} onClick={()=>setProvider(p)}>{names[p]}</button>)}</div>
  <ProviderRetention key={provider} host={host} provider={provider} notify={notify}/>
 </section>;
}
function ProviderRetention({host,provider,notify}:{host:SshHost;provider:RemoteCliProvider;notify:(text:string)=>void}){
 const [snapshot,setSnapshot]=useState<RetentionInspection>(),[logs,setLogs]=useState<RetentionLogPage>();
 const [error,setError]=useState(''),[logError,setLogError]=useState(''),[saveError,setSaveError]=useState('');
 const [loading,setLoading]=useState(true),[logsLoading,setLogsLoading]=useState(true),[busy,setBusy]=useState(false),[hours,setHours]=useState('24');
 const [pages,setPages]=useState<string[]>(['']),[logPages,setLogPages]=useState<(string|undefined)[]>([undefined]);
 const [refresh,setRefresh]=useState(0),[logRefresh,setLogRefresh]=useState(0),[now,setNow]=useState(Date.now()/1000);
 const alive=useRef(true),saving=useRef(false),dirty=useRef(false),generation=useRef(0);
 const after=pages.at(-1)!,before=logPages.at(-1);
 useEffect(()=>{alive.current=true;const timer=setInterval(()=>setNow(Date.now()/1000),1000);return()=>{alive.current=false;generation.current++;clearInterval(timer);};},[]);
 useEffect(()=>{
  let active=true,reading=false;
  const read=async()=>{if(reading||saving.current)return;reading=true;setLoading(true);const epoch=generation.current;
   try{const value=await api<RetentionInspection>('remote-storage/inspect',{id:host.id,provider,after,limit:50});if(active&&epoch===generation.current){setSnapshot(value);setError('');if(!dirty.current)setHours(String(value.policy.idleHours));}}
   catch(e){if(active&&epoch===generation.current)setError(errorText(e));}finally{reading=false;if(active)setLoading(false);}
  };void read();const timer=setInterval(()=>void read(),15000);return()=>{active=false;clearInterval(timer);};
 },[after,refresh]);
 useEffect(()=>{
  let active=true,reading=false;
  const read=async()=>{if(reading)return;reading=true;setLogsLoading(true);try{const value=await api<RetentionLogPage>('remote-storage/logs',{id:host.id,provider,limit:50,...(before?{before}:{})});if(active){setLogs(value);setLogError('');}}catch(e){if(active)setLogError(errorText(e));}finally{reading=false;if(active)setLogsLoading(false);}};
  void read();const timer=setInterval(()=>void read(),15000);return()=>{active=false;clearInterval(timer);};
 },[before,logRefresh]);
 async function configure(changes:Partial<Pick<RemoteCliPolicy,'reclaimIdle'|'idleHours'>>){
  if(!snapshot||saving.current)return;
  const value=changes.idleHours;if(value!==undefined&&(!Number.isInteger(value)||value<1)){setSaveError('闲置时限请输入 正整数小时。');return;}
  saving.current=true;generation.current++;setBusy(true);setSaveError('');
  try{const policy=await api<RemoteCliPolicy>('remote-cli/configure',{id:host.id,provider,revision:snapshot.policy.revision,changes});if(alive.current){setSnapshot(v=>v?{...v,policy}:v);if(value!==undefined){dirty.current=false;setHours(String(policy.idleHours));}notify('会话清理设置已保存。');setLogRefresh(v=>v+1);}}
  catch(e){if(alive.current)setSaveError(errorText(e));}
  finally{saving.current=false;if(alive.current){setBusy(false);setRefresh(v=>v+1);}}
 }
 const serverNow=snapshot?snapshot.observedAt+Math.max(0,now-snapshot.receivedAt):now;
 const stale=!!error||!snapshot?.available;
 return <div id="retention-provider-panel" role="tabpanel" aria-labelledby={`retention-provider-${provider}`}>
  <div className="retention-settings">
   {snapshot?<><fieldset disabled={busy}><Toggle label="自动清理" checked={snapshot.policy.reclaimIdle} onChange={v=>void configure({reclaimIdle:v})}/></fieldset>
    <form noValidate onSubmit={event=>{event.preventDefault();void configure({idleHours:Number(hours)});}}><label htmlFor={`retention-hours-${provider}`}>闲置</label><input id={`retention-hours-${provider}`} aria-label={`${names[provider]} 闲置小时数`} type="number" min="1" step="1" required value={hours} disabled={busy} onChange={e=>{dirty.current=true;setHours(e.target.value);}}/><span>小时后清理</span><button className="text-button" type="submit" disabled={busy||hours===String(snapshot.policy.idleHours)}>{busy?'保存中…':'保存'}</button></form></>:<span className="inline-note">{loading?'正在读取清理策略…':'策略尚未读取'}</span>}
   <button type="button" className="icon-button" aria-label="刷新会话清理" disabled={loading||busy} onClick={()=>setRefresh(v=>v+1)}><Icon name="refresh" size={15}/></button>
  </div>
  {saveError&&<p className="inline-error" role="alert">{saveError}</p>}
  <p className="retention-note">先存入本机并校验，再清理远端副本。工作台在线时检查；中断会话同样按模型最后活动计时。</p>
  {error&&<p className="inline-error" role="alert">{error}{snapshot&&' 当前保留上次列表，倒计时暂停显示。'}</p>}
  {snapshot?.issue&&<p className="inline-error" role="alert">{snapshot.issue}</p>}
  <div className="retention-section-heading"><h3>现有会话 <span>{snapshot?.available?snapshot.total:'—'}</span></h3><span>{snapshot?.running?'正在执行清理':snapshot?.lastCheck?`最近检查 ${new Date(snapshot.lastCheck.checkedAt).toLocaleTimeString('zh-CN',{hour12:false})}`:snapshot?.available?'每分钟检查到期会话':''}</span></div>
  {snapshot?.loginBusy&&<p className="retention-note">此运行时正在登录，文件清理暂缓；活动计时继续。</p>}
  {snapshot?.lastCheck?.error&&<p className="inline-error">上次检查：{snapshot.lastCheck.error}</p>}
  <div className="retention-columns" aria-hidden="true"><span>会话</span><span>已闲置</span><span>清理倒计时</span></div>
  <div className="retention-sessions" role="list" aria-label={`${names[provider]} 远端会话`}>
   {snapshot?.sessions.map(row=>{const countdown=retentionCountdown(row,snapshot.policy,serverNow),idle=row.lastModelActivity===null||row.clockReason==='clock_ahead'?row.idleSeconds:Math.max(0,serverNow-row.lastModelActivity);
    return <RememberedDetails memoryId="RemoteSessionRetention.details.1" scope={JSON.stringify([host.id,provider,row.sessionId])} className="retention-session" role="listitem" key={row.sessionId} data-testid={`retention-session-${row.sessionId}`}><summary>
     <span className="retention-session-name"><strong>{row.title||`会话 ${row.sessionId.slice(0,8)}`}</strong><small>{row.uncertain?'状态待确认':row.active?'运行中':row.interrupted?'已中断':'空闲'} · {row.accountId}</small></span>
     <span className="retention-number">{stale?'—':elapsed(idle)}</span><span className="retention-countdown" title={countdown.reason}>{stale?'待刷新':countdown.label}</span>
    </summary><div className="retention-session-detail"><p>{countdown.reason}</p><dl><div><dt>最后模型活动</dt><dd>{row.lastModelActivity===null?'未知':stamp(row.lastModelActivity)}</dd></div><div><dt>预计到期</dt><dd>{row.dueAt===null?'待核实':stamp(row.dueAt)}</dd></div><div><dt>本机归档</dt><dd>{row.localArchive?`${{partial:'分块已保存',verified:'已校验',reclaimed:'已保留',restored:'已恢复'}[row.localArchive]} · ${size(row.localBytes??0)}`:'尚无本机归档'}</dd></div><div><dt>会话编号</dt><dd>{row.sessionId}</dd></div></dl></div></RememberedDetails>;
   })}
   {snapshot?.available&&!snapshot.sessions.length&&<p className="retention-empty">此页暂无工作台管理的原生会话。</p>}
   {!snapshot&&<p className="retention-empty">{loading?'正在读取远端会话…':'列表尚未读取；下方本机日志仍可查看。'}</p>}
  </div>
  <div className="retention-pagination"><span>{snapshot?.available?`${stamp(snapshot.observedAt)} 观测 · 第 ${pages.length} 页`:'只列工作台登记的原生会话'}</span><button className="text-button" disabled={loading||pages.length===1} onClick={()=>setPages(v=>v.slice(0,-1))}>上一页</button><button className="text-button" disabled={loading||!snapshot?.nextCursor} onClick={()=>setPages(v=>[...v,snapshot!.nextCursor!])}>下一页</button></div>
  <div className="retention-section-heading retention-log-heading"><h3>清理日志 <span>仅本机</span></h3><button className="icon-button" aria-label="刷新本机清理日志" disabled={logsLoading} onClick={()=>{setLogPages([undefined]);setLogRefresh(v=>v+1);}}><Icon name="refresh" size={15}/></button></div>
  {logError&&<p className="inline-error" role="alert">{logError}</p>}{logs?.issue&&<p className="inline-error" role="alert">{logs.issue}</p>}
  <ol className="retention-logs" aria-label={`${names[provider]} 本机清理日志`}>{logs?.entries.map(entry=><li key={entry.id} className={entry.kind==='error'?'has-error':''}>
   <div className="retention-log-meta"><time title={new Date(entry.lastAt).toLocaleString('zh-CN')} dateTime={new Date(entry.lastAt).toISOString()}>{new Date(entry.lastAt).toLocaleTimeString('zh-CN',{hour12:false})}</time><span>{kinds[entry.kind]}</span>{entry.repeat>1&&<small>×{entry.repeat}</small>}</div>
   <p>{entry.message}{entry.bytes!==undefined&&<span className="retention-bytes"> · {size(entry.bytes)}</span>}</p>
   {(entry.code||entry.sessionIds.length>0)&&<RememberedDetails memoryId="RemoteSessionRetention.details.2" scope={JSON.stringify([host.id,provider,entry.id])} className="retention-log-details"><summary>详情{entry.code?` · ${entry.code}`:''}</summary>{entry.sessionIds.length>0&&<p>会话：{entry.sessionIds.join('、')}</p>}{entry.archiveId&&<p>归档：{entry.archiveId}</p>}</RememberedDetails>}
  </li>)}</ol>
  {!logs?.entries.length&&<p className="retention-empty">{logsLoading?'正在读取本机日志…':'本机尚无该运行时的清理记录。'}</p>}
  <div className="retention-pagination"><span>{logs?`保留 ${logs.retentionDays} 天，每台 VPS 最多 ${logs.maxEntries.toLocaleString()} 条`:'日志不上传到 VPS'}</span><button className="text-button" disabled={logsLoading||logPages.length===1} onClick={()=>setLogPages(v=>v.slice(0,-1))}>较新</button><button className="text-button" disabled={logsLoading||!logs?.nextBefore} onClick={()=>setLogPages(v=>[...v,logs!.nextBefore!])}>更早</button></div>
  {logs&&<RememberedDetails memoryId="RemoteSessionRetention.details.3" scope={host.id} className="retention-log-location"><summary>本机日志位置</summary><p>{logs.location}</p></RememberedDetails>}
 </div>;
}
