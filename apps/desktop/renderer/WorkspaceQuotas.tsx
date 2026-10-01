import {RememberedDetails} from './UiMemory';
import type {AccountCatalog} from '../../../packages/contracts';
import type {ManagedWorkspace} from '../../../packages/workspace-control/types';
import {allocatedPercent} from '../../../packages/workspace-control/quotas';
import './WorkspaceQuotas.css';

export default function WorkspaceQuotas({workspaces, catalog, disabled, onEdit}: {workspaces: ManagedWorkspace[]; catalog?: AccountCatalog | null; disabled: boolean; onEdit: (workspace: ManagedWorkspace) => void}) {
  const active = workspaces.filter(w => w.status !== 'deleted'), ids = [...new Set(active.flatMap(w => w.allowedAccountIds))];
  if (!ids.length) return null;
  return <section className="workspace-quotas" data-testid="workspace-quotas"><div className="account-section-heading"><div><h4 title="各账号独立配给，只计算周额度。">账号额度配给</h4></div></div>{ids.map(id => {
    const account = catalog?.accounts.find(a => a.id === id), rows = active.filter(w => w.allowedAccountIds.includes(id));
    const weekly = allocatedPercent(active, id, 'weeklyPercent');
    return <article className="quota-allocation-group" key={id} data-testid={`quota-summary-${id}`}><header><strong>{account?.email ?? account?.displayName ?? id}</strong><span>周额度 {weekly}% 已配给 · {Math.round((100 - weekly) * 100) / 100}% 剩余</span></header>{rows.map(w => <div className="quota-allocation-row" key={w.id}><span>{w.name}<small>{w.status === 'suspended' ? '已暂停 · 保留配给' : w.accountQuotas?.[id]?.allowOverage === false ? '不允许超限' : '允许超限 · 自动借还'}</small></span><span>周 {w.accountQuotas?.[id]?.weeklyPercent == null ? '未配给' : w.accountQuotas[id].weeklyPercent + '%'}</span><button className="text-button" disabled={disabled} data-testid={`quota-edit-${w.id}-${id}`} onClick={() => onEdit(w)}>配置</button></div>)}</article>;
  })}<RememberedDetails memoryId="WorkspaceQuotas.details.1" className="account-help"><summary>额度规则</summary><p>同一账号每个窗口的分配总和不超过 100%。用量按工作台观测估算；借还明细见账号页。禁止超限时在新回合前核对余额，运行中的请求仍可能超出估算。</p></RememberedDetails></section>;
}
