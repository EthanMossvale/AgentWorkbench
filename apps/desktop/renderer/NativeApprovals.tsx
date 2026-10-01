import {RememberedDetails} from './UiMemory';
import { useId, useRef, useState } from 'react';
import type { NativeApproval, Session } from '../../../packages/contracts';
import { approvalOptions, approvalPresentation, type ApprovalReply } from '../../../packages/native-approvals';
import { api } from './App';
import { Icon, errorText } from './ui';
import './NativeApprovals.css';

export function ApprovalCard({ approval, runtime, busy, onReply, onOpenPlan }: { onOpenPlan?:()=>void; approval: NativeApproval; runtime: string; busy: boolean; onReply: (reply: ApprovalReply) => Promise<void> }) {
  const options = approvalOptions(approval), allows = options.filter(o => ['once', 'session', 'saved'].includes(o.scope));
  const [selection, setSelection] = useState('accept'), [error, setError] = useState('');
  const name = useId(), details = approvalPresentation(approval);
  // No saved rule is selected as a fallback if a runtime omits one-time approval.
  const chosen = allows.find(o => o.id === selection);
  const answer = async (optionId: string) => {
    if (busy) return; setError('');
    try { await onReply(approval.receipt ? { optionId, receipt: approval.receipt } : { decision: optionId as ApprovalReply['decision'] }); }
    catch (error) { setError(errorText(error)); }
  };
  const title = { command: details.network ? '访问网络' : '执行命令', file: '修改文件', tool: '使用工具', plan: '确认计划' }[approval.kind];
  return <section className="approval-card" data-testid="native-approval" data-plan-review={approval.kind==='plan'?'':undefined} data-approval-receipt={approval.receipt} aria-label={`${runtime} 请求${title}`} aria-busy={busy}>
    <header><span className="approval-icon"><Icon name={approval.kind === 'command' ? 'terminal' : 'shield'} size={16}/></span><strong>{title}</strong><span className="approval-runtime">{runtime}</span><small>等待你的批准</small></header>
    {details.reason && <p className="approval-reason">{details.reason}</p>}
    {details.plan && (onOpenPlan?<button className="text-button" data-testid="open-plan" onClick={onOpenPlan}>查看完整计划</button>:<pre className="approval-command" data-testid="approval-plan">{details.plan}</pre>)}
    {approval.kind === 'plan' && <p className="approval-reason">批准后按下方选择的权限执行，退出计划模式。</p>}
    {details.command && <pre className="approval-command" data-testid="approval-command"><code>{details.command}</code></pre>}
    {(details.cwd || details.path || details.tool) && <dl className="approval-context">{details.cwd && <><dt>工作目录</dt><dd>{details.cwd}</dd></>}{details.path && <><dt>目标路径</dt><dd>{details.path}</dd></>}{details.tool && <><dt>工具</dt><dd>{details.tool}</dd></>}</dl>}
    {details.network && <pre className="approval-command" aria-label="网络目标">{details.network}</pre>}
    {details.permissions && <div className="approval-extra"><small>请求的额外权限</small><pre className="approval-command">{details.permissions}</pre></div>}
    <RememberedDetails memoryId="NativeApprovals.details.1" className="approval-raw"><summary>请求详情</summary><pre>{approval.details}</pre></RememberedDetails>
    {(allows.length > 1 || !allows.some(o => o.id === 'accept')) && <fieldset className="approval-choices" disabled={busy}><legend>{approval.kind==='plan'?'执行权限':'授权方式'}</legend>{allows.map(option => <label key={option.id} className={selection === option.id ? 'selected' : ''}><input type="radio" name={name} value={option.id} checked={selection === option.id} onChange={() => setSelection(option.id)}/><span>{option.label}</span></label>)}</fieldset>}
    {chosen && chosen.scope !== 'once' && <div className="approval-rule" data-testid="approval-rule"><p>{chosen.description}</p>{chosen.rules?.map((rule, index) => <code key={index}>{rule}</code>)}</div>}
    {error && <p className="approval-error" role="alert">{error}</p>}
    <footer>{options.filter(o => o.scope === 'deny' || o.scope === 'cancel').map(option => <button className="text-button" data-testid={`native-approval-${option.id}`} disabled={busy} title={[option.description, ...(option.rules ?? [])].join('\n')} key={option.id} onClick={() => void answer(option.id)}>{option.label}</button>)}<span/>{allows.length > 0 && <button className="button primary" data-testid={`native-approval-${chosen?.id ?? 'submit'}`} disabled={busy || !chosen} onClick={() => chosen && void answer(chosen.id)}>{busy ? '正在提交…' : approval.kind === 'plan' ? '批准并执行计划' : chosen?.scope === 'saved' ? '允许并保存规则' : chosen?.scope === 'session' ? '允许本会话' : '允许本次'}</button>}</footer>
  </section>;
}
export default function NativeApprovals({ session, onOpenPlan }: { session: Session; onOpenPlan?:(receipt:string)=>void }) {
  const [busy, setBusy] = useState(false), sending = useRef(false);
  const reply = async (requestId: string | number, value: ApprovalReply) => {
    if (sending.current) return; sending.current = true; setBusy(true);
    try { await api('session/approval', { sessionId: session.id, requestId, ...value }); }
    finally { sending.current = false; setBusy(false); }
  };
  const runtime = session.pluginRuntime?.name ?? (session.binding.runtime === 'claude' ? 'Claude Code' : session.binding.runtime === 'api' ? '模型 API' : 'Codex');
  return <div className="native-approvals" data-native-approvals data-session-id={session.id}>{session.nativeApprovals?.map(approval => <ApprovalCard key={approval.receipt ?? `${session.id}:${typeof approval.id}:${approval.id}`} approval={approval} runtime={runtime} busy={busy} onOpenPlan={onOpenPlan&&approval.receipt?()=>onOpenPlan(approval.receipt!):undefined} onReply={value => reply(approval.id, value)}/>)}</div>;
}
