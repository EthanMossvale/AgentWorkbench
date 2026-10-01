import { useEffect, useRef, useState } from 'react';
import { api } from './App';
import { Toggle, errorText } from './ui';
import type { NativeMemoryStatus } from '../../../packages/native-memory';
import './NativeResources.css';
import NativeMemoryManager from './NativeMemoryManager';
import type { NativeMemoryControl } from '../../../packages/native-memory/controls';
import { runtimeName } from './RuntimeCliSettings';
import type { MemoryBackgroundTask } from '../../../packages/native-memory/background';
import { memoryReceiptError, memoryReceiptExplanation } from './memory-receipt-messages';

const taskLabels:Record<MemoryBackgroundTask['state'],string>={queued:'等待处理',running:'后台处理中',completed:'已核验完成',blocked:'等待处理条件',failed:'处理失败',uncertain:'结果待核对',cancelled:'已取消'};
const taskReasons:Record<string,string>={
  MEMORY_BACKGROUND_INTERACTION_REQUIRED:'需要交互或审批，已停止；未自动代答。',
  MEMORY_BACKGROUND_BINDING_UNSUPPORTED:'此执行位置尚未接入本机记忆后台任务。',
  MEMORY_BACKGROUND_BINDING_CHANGED:'SSH 连接或账号身份已变化，本次记忆处理已停止。',
  MEMORY_BACKGROUND_READ_ONLY:'当前权限为只读，未启动写入。',
  MEMORY_BACKGROUND_RECEIPT_UNVERIFIED:'文件或索引回执未通过核验，档案仍待接收。',
  MEMORY_BACKGROUND_INTERRUPTED:'上次处理结果未确认；未自动重发。',
  MEMORY_BACKGROUND_NATIVE_UNCERTAIN:'上次处理结果未确认；未自动重发。',
  MEMORY_BACKGROUND_CLEANUP_UNCONFIRMED:'后台连接的清理回执未确认；未自动重发。',
  MEMORY_BACKGROUND_TIMEOUT:'处理超时，已停止；未自动重试。',
  MEMORY_CONSOLIDATION_INDEX_BUDGET:'原生入口或主题文件达到大小上限；未覆盖已有内容，请在记忆管理中检查。',
  MEMORY_CONSOLIDATION_NATIVE_CHANGED:'原生记忆在写入期间被修改；已保留并发变更，本次未盖章。',
  MEMORY_CONSOLIDATION_STORAGE_FAILED:'原生引用未能保存，可能涉及文件权限或链接路径；档案仍待接收。',
  MEMORY_BACKGROUND_NATIVE_FAILED:'原生后台任务失败；未自动重发模型请求。',
};
const taskReason=(reason?:string)=>reason?(taskReasons[reason]??'档案已保留；修复条件后可点击「立即整理待收记忆」明确重试。'):'';

const explainError = (message: string) => /receipt|evidence|index|knowledge/i.test(message) ? memoryReceiptError(message) : /conflict|marker|provenance/i.test(message) ? '来源标记或旧同步副本有变更，已保留原文；请在记忆管理中检查。' : /settings/i.test(message) ? '原生配置暂时无法读取，修复后会继续检查。' : /Linked/i.test(message) ? '记忆使用了链接路径，已暂停处理以保护原文件。' : /budget|limits/i.test(message) ? '记忆内容超过处理上限，原文件已保留。' : '暂时无法完成记忆交接，档案已保留。';

export default function NativeMemorySettings({ report, notify, onManageRuntimes }: { report:(error:unknown)=>void; notify:(message:string)=>void; onManageRuntimes?:()=>void }) {
  const [status, setStatus] = useState<NativeMemoryStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [controls, setControls] = useState<NativeMemoryControl[] | null>(null), [nativeError, setNativeError] = useState(''), [savedMemories, setSavedMemories] = useState(false);
  const active = useRef(true), generation = useRef(0), changing = useRef(false);
  const reading = useRef(0);
  const [managing, setManaging] = useState(false);
  const [initialSources, setInitialSources] = useState<'codex'|'claude'|'both'>('both');
  const refresh = async (force = false) => {
    if (reading.current && !force) return; reading.current++; const request = ++generation.current;
    try { const [result, settings] = await Promise.all([api<NativeMemoryStatus>('native-memory/get'), api<NativeMemoryControl[]>('native-memory/settings/get')]);
      if (active.current && request === generation.current) { setStatus(result); setControls(settings); }
      if (!settings.some(s => s.installed)) { const entries = await api<unknown[]>('native-memory/list'); if (active.current && request === generation.current) setSavedMemories(entries.length > 0); }
    } finally { reading.current--; }
  };
  useEffect(() => { active.current = true; const update = () => { if (!changing.current) void refresh().catch(report); }; update(); const interval = setInterval(update, 12000); window.addEventListener('focus', update); window.addEventListener('local-cli-changed', update); return () => { active.current = false; generation.current++; clearInterval(interval); window.removeEventListener('focus', update); window.removeEventListener('local-cli-changed', update); }; }, []);
  const changeNative = async (control: NativeMemoryControl, setting: 'enabled'|'allowToolChats', enabled: boolean) => {
    if (changing.current) return; changing.current = true; generation.current++; setBusy(true); setNativeError('');
    setControls(items => items?.map(item => item.runtime === control.runtime ? { ...item, [setting]: enabled } : item) ?? null);
    try { const value = await api<NativeMemoryControl[]>('native-memory/settings/write', { runtime: control.runtime, revision: control.revision, setting, enabled }); if (active.current) setControls(value); notify('已保存，新会话生效'); }
    catch (failure) { const code = errorText(failure); if (active.current) setNativeError(/CONFLICT/.test(code) ? '原生配置已在外部更新，已保留新配置；请重新操作。' : /OVERRIDDEN/.test(code) ? '此设置受其他原生配置控制，未强制覆盖。' : '未能确认原生设置已保存，请刷新后检查。'); }
    finally { await refresh(true).catch(() => {}); changing.current = false; if (active.current) setBusy(false); }
  };
  const change = async (enabled: boolean, seed?: 'codex'|'claude'|'both') => {
    if (changing.current) return; changing.current = true; generation.current++; setBusy(true); setError(''); setStatus(value => value ? { ...value, enabled } : value);
    try { await api('native-memory/configure', { enabled, ...(seed ? { initialSources: seed } : {}) }); } catch (failure) { if (active.current) setError(errorText(failure)); }
    finally { await refresh(true).catch(() => {}); changing.current = false; if (active.current) setBusy(false); }
  };
  const cancelTask=async(id:string)=>{try{await api('native-memory/tasks/cancel',{id});await refresh(true);}catch(error){report(error);}};
  const processMemory=async()=>{if(changing.current)return;changing.current=true;setBusy(true);try{const result=await api<{started:boolean;reason?:string}>('native-memory/process');if(!result.started)notify(result.reason==='MEMORY_BACKGROUND_EMPTY'?'没有待整理的记忆':result.reason==='MEMORY_BACKGROUND_BUSY'?'已有记忆整理任务正在运行':result.reason==='MEMORY_BACKGROUND_DEFAULT_UNAVAILABLE'?'请先在新任务中选择可用的默认模型':'当前条件不允许启动记忆整理，请检查模型、权限及记忆开关');await refresh(true);}catch(error){report(error);}finally{changing.current=false;setBusy(false);}};
  const installed = controls?.filter(item => item.installed) ?? [], both = installed.length === 2;
  const history = !!status && (status.enabled || !status.needsInitialImport || status.sourceCount > 0);
  return <div className="native-resources native-memory-simple" data-testid="native-memory-settings">
    {!controls && <p role="status">正在读取本机记忆设置…</p>}
    {busy && <p className="inline-note" role="status">正在保存设置…</p>}
    {controls && !installed.length && <div className="memory-empty-state" data-testid="memory-empty"><p>安装 Codex 或 Claude Code 后，可在这里管理其原生记忆设置。</p>{onManageRuntimes && <button onClick={onManageRuntimes}>管理运行时 CLI</button>}</div>}
    {installed.map(control => <section key={control.runtime} className="native-memory-control" data-testid={'memory-control-' + control.runtime}>
      <fieldset className="resource-fieldset" disabled={busy || !control.canToggle}><Toggle label={`${runtimeName(control.runtime)} 原生记忆`} checked={control.enabled === true} description={control.enabled === null ? '当前状态无法确认' : '使用本机原生配置；外部修改会在这里更新。'} onChange={enabled => void changeNative(control, 'enabled', enabled)}/></fieldset>
      {control.runtime === 'codex' && <fieldset className="resource-fieldset memory-tool-setting" disabled={busy || !control.canToggleTools}><Toggle label="允许从使用工具的聊天中形成记忆" description={!control.canToggleTools ? '当前运行时尚未确认支持此选项，或被更高优先级配置覆盖。' : '独立保存来源偏好：包含 MCP、网页搜索和工具搜索；不单独开启记忆。'} checked={control.allowToolChats === true} onChange={enabled => void changeNative(control, 'allowToolChats', enabled)}/></fieldset>}
      {control.runtime === 'claude' && <p className="inline-note">控制 Claude Code 自动记忆；官方未提供单独的工具聊天来源开关。CLAUDE.md 指令不受此开关影响。</p>}
      {(control.warning || control.error) && <p className="inline-note" role="status">{control.error ? '原生配置暂时无法读取，未将未知状态视为关闭。' : control.warning === 'NATIVE_MEMORY_PARTIAL' ? '原生读取与生成设置不同，主开关会同时调整两项。' : control.warning === 'NATIVE_MEMORY_PROJECT_SETTINGS' ? '部分项目有单独的原生记忆设置；任务按项目实际配置判断。' : '受环境或托管配置控制，请在对应配置中调整。'}</p>}
    </section>)}
    {!!installed.length && <p className="inline-note">设置针对本机，新会话生效。项目、托管设置或启动参数可能覆盖。</p>}
    {nativeError && <p className="inline-error" role="alert">{nativeError}</p>}
    {both && <fieldset className="resource-fieldset memory-sync-control" disabled={!status || busy}><Toggle label="Codex与Claude Code自动同步" checked={status?.enabled ?? false} onChange={enabled => void change(enabled)}/></fieldset>}
    {controls && !both && history && <p className="inline-note" data-testid="memory-sync-paused">同步已暂停：需同时安装两家 CLI。已有记忆、交接档案与同步设置均保留。</p>}
    {both && status?.enabled && installed.some(c => c.enabled !== true) && <p className="inline-note">原生记忆未开启或状态未确认的一方暂不接收交接档案。</p>}
    {both && status?.enabled && status.needsInitialImport && <fieldset className="memory-initial-import resource-fieldset" disabled={busy} data-testid="memory-initial-import"><legend>首次上传现有记忆</legend><div className="memory-initial-choices">{(['codex','claude','both'] as const).map(value => <label key={value}><input type="radio" name="initial-memory-source" value={value} checked={initialSources === value} onChange={() => setInitialSources(value)}/>{value === 'codex' ? 'Codex' : value === 'claude' ? 'Claude Code' : '两边都上传'}</label>)}<button onClick={() => void change(true, initialSources)}>上传现有记忆</button></div><p>仅在本设备保存交接档案。发送任务后，各接收方使用自己的默认模型与原生会话，按原有范围整理英文引用。</p></fieldset>}
    <div className="memory-sync-summary">{both && <p data-testid="native-memory-sync-status" role="status">{!status ? '正在读取交接状态…' : <>{status.running ? '正在检查… · ' : !status.enabled ? '自动同步已关闭 · ' : ''}{status.lastSync ? <>最近完成交接：<time dateTime={status.lastSync}>{new Date(status.lastSync).toLocaleString('zh-CN', { hour12: false })}</time></> : '尚无已核验交接'}{!status.needsInitialImport && <> · 待 Codex 接收 {status.pendingCodex} 份 · 待 Claude Code 接收 {status.pendingClaude} 份</>}</>}</p>}{(installed.length > 0 || savedMemories || history) && <button className="memory-manage-link" disabled={!status || busy} onClick={() => setManaging(true)}>查看与管理记忆</button>}{installed.length === 1 && onManageRuntimes && <button className="memory-manage-link" onClick={onManageRuntimes}>管理运行时 CLI</button>}</div>
    {both&&status?.enabled&&!status.needsInitialImport&&<><p className="inline-note" data-testid="memory-handoff-explanation">发送任务后，Codex 与 Claude Code 各自使用在新任务中选过的默认模型，只接收对方档案；两个原生后台会话串行执行。原生引用写入并回读核验后计为完成；不代表官方自动归纳已运行。相同条件下失败的档案不会随聊天重复重试。</p><button className="memory-manage-link" disabled={busy||status.backgroundRunning||status.backgroundTasks?.some(t=>t.state==='running'||t.state==='queued')} onClick={()=>void processMemory()} data-testid="memory-process">立即整理待收记忆</button>{status.backgroundAdmission?.reason==='MEMORY_BACKGROUND_UNCHANGED'&&<p className="inline-note" role="status">待收内容与模型未变化，已避免重复请求；可点击「立即整理待收记忆」明确重试。</p>}{status.backgroundAdmission?.reason==='MEMORY_BACKGROUND_DEFAULT_UNAVAILABLE'&&<p className="inline-note" role="status">默认模型当前不可用，请先在新任务中选择模型。</p>}</>}
    {both&&status?.enabled&&(['codex','claude'] as const).map(runtime=>status.backgroundAdmissions?.[runtime]?.reason==='MEMORY_BACKGROUND_DEFAULT_UNAVAILABLE'&&(runtime==='codex'?status.pendingCodex:status.pendingClaude)>0?<p key={runtime} className="inline-note" role="status" data-testid={'memory-default-'+runtime}>{runtimeName(runtime)} 接收模型不可用：请在新任务中切换到该运行时，选择一次默认模型。此方向保持待收，不由另一方代写。</p>:null)}
    {!!status?.backgroundTasks?.length&&<section className="native-memory-control" data-testid="memory-background-tasks" aria-label="记忆后台任务">
      <h3>记忆后台任务</h3>
      {[...status.backgroundTasks].reverse().slice(0,6).map(task=><div key={task.id} className="memory-background-task">
        <p>{runtimeName(task.runtime)} · {task.model} · <span role="status">{taskLabels[task.state]}</span> · 已核验 {task.processed}/{task.total}{['queued','running'].includes(task.state)&&<button onClick={()=>void cancelTask(task.id)}>取消</button>}</p>
        {task.reason&&<p className="inline-note">{taskReason(task.reason)}</p>}
        {!!task.receiptIssues?.length&&<p className="inline-note" data-testid="memory-receipt-issues">{task.receiptIssues.map(memoryReceiptExplanation).join(' ')}</p>}
      </div>)}
    </section>}
    {(error || (status?.enabled && (status.lastError || status.handoffError))) && <p className="inline-error" role="alert" title={error || status?.lastError || status?.handoffError}>{explainError(error || status?.lastError || status?.handoffError || '')}</p>}
    {managing && <NativeMemoryManager onClose={() => setManaging(false)} notify={notify} onChanged={() => void refresh().catch(report)}/>}
  </div>;
}
