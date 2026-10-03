import {RememberedDetails} from './UiMemory';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Session } from '../../../packages/contracts';
import { sessionMetrics, uncachedInput, type MetricsSnapshot, type TokenCounts, type TokenField } from '../../../packages/session-metrics';
import './SessionMetrics.css';

export function compactTokens(value: number | null): string {
  if (value === null) return '—';
  for (const [unit, size] of [['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) if (value >= size) return (value / size).toFixed(1).replace(/\.0$/, '') + unit;
  return String(value);
}
const runtimeName = (runtime: string) => runtime === 'codex' ? 'Codex' : runtime === 'claude' ? 'Claude Code' : runtime === 'api' ? 'API 直连' : runtime === 'demo' ? '离线示例' : runtime.replace(/^plugin:/, '');
const percent = (value: number | null) => value === null ? '—' : (value * 100).toFixed(1).replace(/\.0$/, '') + '%';
const exactTokens = (value: number | null, partial = false) => value === null ? '—' : (partial ? '≥ ' : '') + value.toLocaleString('zh-CN');
const labels: [TokenField, string][] = [['inputTokens', '输入（不含缓存）'], ['outputTokens', '输出'], ['cacheReadTokens', '缓存读取'], ['cacheWriteTokens', '缓存写入']];
function Counts({ value }: { value: TokenCounts & { incomplete: TokenField[] } }) {
  const input=uncachedInput(value);
  return <dl className="session-metrics-counts">{labels.map(([field, label]) => <div key={field}><dt>{label}</dt><dd aria-label={value[field] === null ? '未上报' : undefined}>{field==='inputTokens'?(input.upperBound?'≤ ':'')+exactTokens(input.value):exactTokens(value[field], value.incomplete.includes(field))}</dd></div>)}</dl>;
}
function Source({ runtime, model }: { runtime: string; model: string }) {
  return <span className="session-metrics-identity" title={`${runtimeName(runtime)} · ${model || '模型未上报'}`}><span>{runtimeName(runtime)}</span><strong>{model || '模型未上报'}</strong></span>;
}
/** Shared footer for every runtime/transport. No model request or polling is needed. */
export default function SessionMetrics({ session, snapshot }: { session?: Session; snapshot?: MetricsSnapshot }) {
  const value = snapshot ?? sessionMetrics(session), [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined), closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pinned = useRef(false), keyboardOpen = useRef(false);
  const id = useId(), [position, setPosition] = useState({ left: 0, top: 0 });
  const cancelTimers = () => { clearTimeout(openTimer.current); clearTimeout(closeTimer.current); };
  const dismiss = () => { cancelTimers(); pinned.current = false; keyboardOpen.current = false; setOpen(false); };
  const preview = () => {
    cancelTimers();
    if (!open) openTimer.current = setTimeout(() => {
      if (anchor.current?.getClientRects().length) setOpen(true);
    }, 1000);
  };
  const hide = () => { cancelTimers(); if (!pinned.current) closeTimer.current = setTimeout(() => setOpen(false), 160); };
  const pin = () => { cancelTimers(); pinned.current = true; setOpen(true); };
  useEffect(() => {
    dismiss();
    const outside = (event: Event) => { const target = event.target; if (target instanceof Node && !anchor.current?.contains(target) && !panel.current?.contains(target)) dismiss(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const restore = panel.current?.contains(document.activeElement);
      dismiss(); if (restore) anchor.current?.focus();
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    window.addEventListener('keydown', escape); window.addEventListener('blur', dismiss);
    return () => { cancelTimers(); document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); window.removeEventListener('keydown', escape); window.removeEventListener('blur', dismiss); };
  }, [session?.id]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect(), p = panel.current?.getBoundingClientRect();
      if (!a || !p) return;
      if (!a.width || !a.height) { dismiss(); return; }
      const top = a.top - p.height - 8;
      setPosition({ left: Math.max(12, Math.min(window.innerWidth - p.width - 12, a.right - p.width)), top: Math.max(12, Math.min(window.innerHeight - p.height - 12, top >= 12 ? top : a.bottom + 8)) });
    };
    place(); const observer = new ResizeObserver(place); if (panel.current) observer.observe(panel.current); if (anchor.current) observer.observe(anchor.current);
    if (keyboardOpen.current) { panel.current?.focus(); keyboardOpen.current = false; }
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  const partial = value.partialHistory || value.incomplete.includes('totalTokens');
  const total = (partial && value.totalTokens !== null ? '≥ ' : '') + compactTokens(value.totalTokens);
  const speed = value.tokensPerSecond === null ? '—' : value.tokensPerSecond.toFixed(1).replace(/\.0$/, '');
  const selected = (group: MetricsSnapshot['groups'][number]) => !!value.selection?.model && group.runtime === value.selection.runtime && group.model === value.selection.model;
  const pendingSelection = value.selection?.model && !value.groups.some(selected) ? value.selection : undefined;
  const breakdown = value.groups.length > 1 || !!pendingSelection;
  return <div className="session-metrics" data-session-metrics data-session-id={session?.id ?? ''} data-testid="session-metrics">
    <button type="button" ref={anchor} className="session-metrics-trigger" aria-label="会话用量明细" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onPointerEnter={event => { if (event.pointerType !== 'touch') preview(); }} onPointerLeave={hide} onClick={event => { if (pinned.current) dismiss(); else { keyboardOpen.current = event.detail === 0; pin(); if (open && keyboardOpen.current) { panel.current?.focus(); keyboardOpen.current = false; } } }}>
      <span className="session-metrics-cluster"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12a6 6 0 1 1 10 0M4 12h8M8 8l3-3"/></svg><span>{value.rounds} 轮 {value.partialHistory && value.steps !== null ? '≥ ' : ''}{value.steps ?? '—'} 步</span><span className="session-metrics-separator">·</span><span title="最近已上报的输出均速，并非当前实时速度">上次 {speed} tok/s</span></span>
      <span className="session-metrics-cluster"><svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="3.5" rx="5" ry="2"/><path d="M3 3.5v8c0 2.7 10 2.7 10 0v-8M3 7.5c0 2.7 10 2.7 10 0"/></svg><span>{total} tok</span><span className="session-metrics-separator">·</span><span>缓存命中 {percent(value.cacheHitRate)}</span></span>
    </button>
    {open && createPortal(<div id={id} ref={panel} tabIndex={-1} style={position} role="dialog" aria-label="本会话用量" className="session-metrics-tooltip" data-testid="session-metrics-details" onPointerEnter={cancelTimers} onPointerLeave={hide} onPointerDown={pin} onFocusCapture={pin}>
      <header><strong>本会话用量</strong><button type="button" className="session-metrics-close" aria-label="关闭用量明细" onClick={() => { dismiss(); anchor.current?.focus(); }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg></button></header>
      <div className="session-metrics-overview"><div className="session-metrics-total" aria-label={value.totalTokens === null ? '总量未上报' : '会话累计'}>{exactTokens(value.totalTokens, partial)}<small> tokens</small></div><span className="session-metrics-rounds">{value.rounds} 轮 · {value.partialHistory && value.steps !== null ? '≥ ' : ''}{value.steps ?? '—'} 步</span></div>
      <Counts value={value}/>
      <dl className="session-metrics-rates"><div title={value.rateBasis === 'turn' ? '最近回合输出均速，包含工具与等待时间' : '最近一次请求的输出速度，不代表已选模型的速度'}><dt>{value.rateBasis === 'turn' ? '回合均速' : '请求速度'}</dt><dd>{speed}{value.tokensPerSecond !== null && <small> tok/s</small>}</dd></div><div className="session-metrics-cache"><dt>缓存命中</dt><dd title={value.cacheHitRate === null ? '尚无可计算的输入与缓存读取记录' : '缓存读取 ÷ 全部输入（含缓存），按已上报两项计数的记录统计'}>{percent(value.cacheHitRate)}</dd></div></dl>
      {(value.groups.length > 0 || pendingSelection) && <div className="session-metrics-sources">
        {pendingSelection && <div className="session-metrics-pending" data-testid="session-metrics-selection"><span className="session-metrics-selected-label">已选</span><Source {...pendingSelection}/><span title="该运行时与模型尚无同名用量回执；别名不自动合并">暂无记录</span></div>}
        {!breakdown && value.groups[0] && <div className="session-metrics-source"><Source {...value.groups[0]}/></div>}
        {breakdown && value.groups.length > 0 && <div className="session-metrics-groups" aria-label="按运行时和模型累计">{value.groups.map(group => <RememberedDetails memoryId="SessionMetrics.details.1" scope={JSON.stringify([group.runtime,group.model])} key={JSON.stringify([group.runtime, group.model])} className="session-metrics-group" data-testid="session-metrics-group" data-selected={selected(group)}>
          <summary><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg><span className="session-metrics-group-identity" title={`${runtimeName(group.runtime)} · ${group.model || '模型未上报'}`}><strong>{group.model || '模型未上报'}</strong><small>{runtimeName(group.runtime)}{selected(group) ? ' · 已选' : ''}</small></span><span className="session-metrics-group-total" title={`${exactTokens(group.totalTokens, group.incomplete.includes('totalTokens'))} tokens`}>{group.incomplete.includes('totalTokens') && group.totalTokens !== null ? '≥ ' : ''}{compactTokens(group.totalTokens)}</span></summary>
          <div className="session-metrics-group-body"><div className="session-metrics-group-name">{runtimeName(group.runtime)} · {group.model || '模型未上报'}</div><div className="session-metrics-group-meta"><span>{group.steps} 步 · 命中 {percent(group.cacheHitRate)}</span><span>{exactTokens(group.totalTokens, group.incomplete.includes('totalTokens'))} tok</span></div><Counts value={group}/></div>
        </RememberedDetails>)}</div>}
      </div>}
      <div className="session-metrics-note">输入不含缓存读取与写入；总量含缓存及输出。≤ 表示缓存分类未完整上报时的输入上限；— 表示未知。</div>
      {(partial || value.totalTokens === null) && <div className="session-metrics-note">{value.totalTokens === null ? '尚未收到用量回执' : '部分记录，仅统计已收到的用量'}</div>}
    </div>, document.body)}
  </div>;
}
