import {useEffect, useRef, useState} from 'react';
import type {AccountCatalog, SshHost} from '../../../packages/contracts';
import type {AccountUsage} from '../../../packages/account-usage/types';
import type {AccountQuotaAllocation, ManagedWorkspace} from '../../../packages/workspace-control/types';
import {allocatedPercent, allocationError} from '../../../packages/workspace-control/quotas';
import {api} from './App';
import {Icon} from './ui';
import './WorkspaceQuotas.css';

export type QuotaDraft = Record<string, {weeklyPercent: string; fiveHourPercent: string; allowOverage: boolean}>;
export const readQuotaDraft = (draft: QuotaDraft[string] | undefined): AccountQuotaAllocation => ({weeklyPercent: draft?.weeklyPercent.trim() ? Number(draft.weeklyPercent) : null, fiveHourPercent: null, allowOverage: draft?.allowOverage ?? true});
export default function StudioAccountQuotas({host, catalog, selected, values, workspaces, workspaceId, disabled, onSelect, onChange}: {
  host: SshHost; catalog?: AccountCatalog | null; selected: string[]; values: QuotaDraft; workspaces: ManagedWorkspace[]; workspaceId?: string; disabled: boolean;
  onSelect: (id: string, selected: boolean) => void; onChange: (values: QuotaDraft) => void;
}) {
  const [usage, setUsage] = useState<Record<string, AccountUsage | null>>({});
  const inflight = useRef(new Set<string>()), live = useRef(true);
  useEffect(() => {live.current = true; return () => {live.current = false;};}, []);
  const statuses = {authenticated: '已登录', configured: '已配置', unauthenticated: '未登录', unknown: '状态待核实'};
  const accounts = [...(catalog?.accounts ?? []).map(a => ({id: a.id, name: a.email ?? a.displayName ?? a.id, known: true, detail: `${a.provider === 'claude' ? 'Claude' : 'Codex'} · ${statuses[a.status]}${a.plan ? ' · ' + a.plan : ''}`})), ...selected.filter(id => !catalog?.accounts.some(a => a.id === id)).map(id => ({id, name: '已分配账号', known: false, detail: `${id} · 本次未识别，可保留或取消分配`}))];
  const load = async (id: string) => {
    if (inflight.current.has(id)) return;
    inflight.current.add(id);
    try {const result = await api<AccountUsage>('accounts/usage', {id: host.id, accountId: id}); if (live.current) setUsage(old => ({...old, [id]: result}));}
    catch {if (live.current) setUsage(old => ({...old, [id]: null}));}
    finally {inflight.current.delete(id);}
  };
  useEffect(() => {for (const id of selected) if (!(id in usage) && catalog?.accounts.some(a => a.id === id)) void load(id);}, [selected.join('|'), catalog, host.id]);
  if (!accounts.length) return null;
  return <div className="studio-quota-options" data-testid="studio-account-quotas">
    <div className="studio-quota-caption"><span>可用账号</span><span>本空间配给</span></div>
    {accounts.map(account => {
      const checked = selected.includes(account.id), draft = values[account.id] ?? {weeklyPercent: '', fiveHourPercent: '', allowOverage: true}, allocation = readQuotaDraft(draft);
      const observation = usage[account.id];
      const error = checked ? allocationError(workspaces, account.id, allocation, workspaceId) : undefined;
      return <div className={`studio-quota-account${checked ? ' enabled' : ''}`} key={account.id} data-testid={`quota-row-${account.id}`}>
        <button type="button" className="studio-quota-choice" data-testid={`studio-account-${account.id}`} aria-pressed={checked} title={account.id} disabled={disabled} onClick={() => onSelect(account.id, !checked)}><span className="studio-quota-check">{checked && <Icon name="check" size={10}/>}</span><span>{account.name}<small>{account.detail}</small></span></button>
        {checked && <div className="studio-quota-fields">{(['weeklyPercent'] as const).map(window => {
          const key = window as 'weeklyPercent' | 'fiveHourPercent', label = key === 'weeklyPercent' ? '周额度' : '5 小时', reserved = allocatedPercent(workspaces, account.id, key, workspaceId), available = Math.round((100 - reserved) * 100) / 100;
          const estimate = observation?.ledger?.windows.find(w => w.window === (key === 'weeklyPercent' ? 'weekly' : 'fiveHour'))?.estimatedTotalTokens;
          return <label className="quota-percent-field" key={key}><span>{label}</span><div><input data-testid={`quota-${account.id}-${key}`} aria-label={`${account.name} ${label}配给百分比`} type="number" min={0} max={100} step="0.01" placeholder="未配给" disabled={disabled} value={draft[key]} onChange={e => onChange({...values, [account.id]: {...draft, [key]: e.target.value}})}/><span>%</span></div><small>可分配 {available}%</small>{estimate != null && allocation[key] != null && <small>≈ {Math.round(estimate * allocation[key]! / 100).toLocaleString()} token</small>}</label>;
        })}</div>}
        {checked && <label className="quota-borrow-option"><input type="checkbox" data-testid={`quota-${account.id}-overage`} checked={draft.allowOverage} disabled={disabled} onChange={e => onChange({...values, [account.id]: {...draft, allowOverage: e.target.checked}})}/><span>允许超限使用<small>优先借用剩余最多的空间；下次窗口刷新后，按来源归还。</small></span></label>}
        {error && <p className="inline-error" role="alert">{error}</p>}
      </div>;
    })}
    {!!accounts.length && <p className="account-footnote">只按账号周额度分配，完整周额度为 100%。留空表示未配给，0% 表示零配给。修改配给立即重算剩余；确认周额度重置后恢复新周期份额，并按来源归还借款。暂停空间保留份额。</p>}
  </div>;
}
