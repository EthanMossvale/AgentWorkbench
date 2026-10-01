import {useUiPreference} from './ui-preferences';
import { useState } from 'react';
import type { NativeSkill } from '../../../packages/native-skills';
import type { SkillConnection, SkillLinkAction, SkillLinkPlan, SkillRuntime } from '../../../packages/native-skills/links';
import { Modal } from './ui';
import './SkillConnections.css';

const runtimes = ['codex', 'claude'] as const;
export const runtimeName = (runtime: SkillRuntime) => runtime === 'codex' ? 'Codex' : 'Claude Code';
const reasons: Record<string, string> = { scope: '仅支持独立的个人技能', unreadable: '无法核实目录，请刷新后重试', conflict: '同名条目已存在，不会覆盖', broken: '目标存在断链，请先在原管理器修复', overlap: '目录重叠，不能建立循环链接', external: '由外部管理，工作台不会移除', missing: '没有可撤销的工作台链接', 'shared-entry': '两家共用同一目录入口，请在原管理器处理' };
export function RuntimeMark({ runtime }: { runtime: SkillRuntime }) { return <span className={`skill-runtime-mark ${runtime}`} aria-hidden="true"/>; }
function label(runtime: SkillRuntime, connection?: SkillConnection, enabled?: boolean) {
  const name = runtimeName(runtime);
  if (!connection) return `${name}：尚未核实目录`;
  if (connection.status === 'connected' && connection.reason === 'scope') return `${name}：已在原生作用域发现，不提升项目或插件技能到个人目录`;
  if (connection.reason === 'shared-entry') return `${name}：已接入 · ${reasons['shared-entry']}`;
  if (connection.status === 'connected') return `${name}：已接入${enabled === false ? '，原生可用性受限' : ''} · ${connection.canDisconnect ? '点击撤销工作台链接' + (connection.externalCount ? '，保留外部条目' : '') : '外部管理，保留现有目录'}`;
  return `${name}：${connection.canConnect ? '点击接入原生目录' : reasons[connection.reason ?? 'unreadable']}`;
}
export function SkillConnections({ skill, busy, onChange }: { skill: NativeSkill; busy: boolean; onChange: (runtime: SkillRuntime, action: SkillLinkAction, skills: NativeSkill[], batch: boolean) => void }) {
  return <div className="skill-connections" aria-label={`${skill.displayName} 的运行时接入`} data-testid="skill-connections">{runtimes.map(runtime => {
    const connection = skill.connections?.[runtime], connected = connection?.status === 'connected', canChange = connection?.canConnect || connection?.canDisconnect;
    const title = label(runtime, connection, skill.runtimeAvailability?.[runtime]);
    return <button type="button" key={runtime} className={`skill-runtime-button ${runtime} ${connected ? 'connected' : ''} ${connection?.status === 'conflict' || connection?.status === 'broken' ? 'warning' : ''}`} aria-label={title} title={title} aria-pressed={connected} aria-disabled={busy || !canChange} disabled={busy} data-runtime={runtime} data-state={connection?.status ?? 'unavailable'} onClick={() => { if (canChange) onChange(runtime, connected ? 'disconnect' : 'connect', [skill], false); }}><RuntimeMark runtime={runtime}/></button>;
  })}</div>;
}
export function SkillConnectionsToolbar({ skills, busy, onChange }: { skills: NativeSkill[]; busy: boolean; onChange: (runtime: SkillRuntime, action: SkillLinkAction, skills: NativeSkill[], batch: boolean) => void }) {
  return <div className="skill-connections-toolbar" aria-label="批量接入当前列表" data-testid="skill-connections-toolbar"><span className="skill-connections-caption">接入</span>{runtimes.map(runtime => {
    const count = skills.filter(s => s.connections?.[runtime].status === 'connected').length, mixed = count > 0 && count < skills.length;
    const action = skills.some(s => s.connections?.[runtime].canConnect) ? 'connect' : skills.some(s => s.connections?.[runtime].canDisconnect) ? 'disconnect' : 'connect';
    return <button key={runtime} className={`skill-runtime-batch ${runtime} ${count ? 'connected' : ''}`} data-state={mixed ? 'partial' : count ? 'all' : 'none'} disabled={busy || !skills.length} aria-label={`批量管理 ${runtimeName(runtime)} 接入`} title={`${runtimeName(runtime)} · 当前列表 ${count}/${skills.length} 已接入`} onClick={() => onChange(runtime, action, skills, true)}><RuntimeMark runtime={runtime}/><span>{count}<span className="skill-connection-total">/{skills.length}</span></span>{mixed && <i aria-hidden="true"/>}</button>;
  })}</div>;
}
export function SkillLinkDialog({ plan, batch, busy, error, onMode, onApply, onClose }: { plan: SkillLinkPlan; batch: boolean; busy: boolean; error: string; onMode: (action: SkillLinkAction) => void; onApply: () => void; onClose: () => void }) {
  const [details, setDetails] = useUiPreference<boolean>('disclosure.open','skill-link-details'), edits = plan.counts.create + plan.counts.remove, removing = plan.action === 'disconnect';
  return <Modal title={`${removing ? '撤销' : '接入'} ${runtimeName(plan.runtime)}`} className="skill-link-dialog" dismissible={!busy} onClose={onClose}>
    {batch && <div className="skill-link-modes" role="group" aria-label="接入操作"><button aria-pressed={!removing} disabled={busy} onClick={() => onMode('connect')}>接入缺少项</button><button aria-pressed={removing} disabled={busy} onClick={() => onMode('disconnect')}>撤销工作台链接</button></div>}
    <div className="skill-link-summary"><span className={`skill-link-summary-mark ${plan.runtime}`}><RuntimeMark runtime={plan.runtime}/></span><div><strong>{batch ? `当前列表 · ${plan.items.length} 项技能` : plan.items[0]?.name}</strong><p>{removing ? `撤销 ${plan.counts.remove} 个工作台链接` : `新接入 ${plan.counts.create} 项${plan.counts.reuse ? ` · 已接入 ${plan.counts.reuse} 项` : ''}`}{plan.counts.skip ? ` · 跳过 ${plan.counts.skip} 项` : ''}</p></div></div>
    <p className="skill-link-note">{removing ? '只移除工作台创建且身份吻合的目录链接。原始文件和外部管理的条目保留。' : '链接直接指向技能源目录，由原生运行时发现。新会话生效，技能开关与运行时专属能力仍各自独立。'}</p>
    {!!plan.counts.skip && <div className="skill-link-exceptions"><button className="skill-link-details" aria-expanded={details} onClick={() => setDetails(!details)}>{details ? '收起' : '查看'}跳过的项目 · {plan.counts.skip}</button>{details && <ul>{plan.items.filter(i => i.operation === 'skip').map(item => <li key={item.id}><strong>{item.name}</strong><span>{reasons[item.reason ?? 'unreadable']}</span></li>)}</ul>}</div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={onClose}>{edits ? '取消' : '完成'}</button>{edits > 0 && <button className="button primary" disabled={busy || !!error} onClick={onApply}>{busy ? '正在处理…' : `${removing ? '撤销' : '确认接入'} ${edits} 项`}</button>}</div>
  </Modal>;
}
