import {useUiPreference} from './ui-preferences';
import { useState } from 'react';
import type { EnvironmentProfile, SshHost } from '../../../packages/contracts';
import type { ManagedWorkspace } from '../../../packages/workspace-control/types';
import { Icon } from './ui';
import { ConnectionAddress, ConnectionName } from './ConnectionAddress';
import './ConnectionTree.css';

interface Props { hosts: SshHost[]; profiles: EnvironmentProfile[]; selectedId: string; onSelect: (id: string) => void; workspaces?: Record<string, ManagedWorkspace[]>; onWorkspace?: (hostId: string, workspaceId: string) => void }
const endpoint = (host: SshHost) => JSON.stringify([host.hostname.trim().toLowerCase(), host.port, host.ownerId]);
export default function ConnectionTree({ hosts, selectedId, onSelect, workspaces = {}, onWorkspace }: Props) {
  const [collapsed, setCollapsed] = useUiPreference<Record<string, boolean>>('connections.collapsed');
  const admins = hosts.filter(host => host.role === 'admin');
  const members = hosts.filter(host => host.role === 'workspace');
  const card = (host: SshHost) => <div className={`host-card ${selectedId === host.id ? 'selected' : ''}`} key={host.id}>
    <button type="button" className="host-card-select" data-testid={`host-${host.id}`} data-host-role={host.role} aria-pressed={selectedId === host.id} onClick={() => onSelect(host.id)}><Icon name={host.role === 'admin' ? 'shield' : 'terminal'} size={16}/><strong><ConnectionName name={host.name} hostname={host.hostname}/></strong></button>
    {host.role === 'admin' ? <ConnectionAddress hostname={host.hostname} port={host.port}/> : <p>{host.username} · 已连接本机</p>}
  </div>;
  return <nav className="host-list connection-host-tree" aria-label="管理员与成员工作空间" data-testid="connection-host-tree"><p className="connection-tree-heading">连接目录</p>
    {admins.map(admin => {
      const local = members.filter(member => endpoint(member) === endpoint(admin));
      const remote = workspaces[admin.id]?.filter(workspace => workspace.status !== 'deleted');
      const unlinked = remote?.filter(workspace => !local.some(member => member.username === workspace.username)) ?? [];
      return <section className="host-family" data-testid={`host-family-${admin.id}`} key={admin.id}>{card(admin)}
        <button type="button" className="host-children-label" aria-expanded={!collapsed[admin.id]} onClick={() => setCollapsed(value => ({ ...value, [admin.id]: !value[admin.id] }))}><span><Icon name="chevron-down" size={12}/>成员工作空间</span><span>{remote ? local.length + unlinked.length : local.length || '—'}</span></button>
        {!collapsed[admin.id] && <div className="host-children" data-testid={`host-children-${admin.id}`}>{local.map(card)}{unlinked.map(workspace => <button type="button" className="remote-workspace-link" data-testid={`tree-workspace-${workspace.id}`} key={workspace.id} onClick={() => onWorkspace?.(admin.id, workspace.id)}><Icon name="folder" size={15}/><span>{workspace.name}<small>{workspace.status === 'suspended' ? '已停用' : '待连接本机'}</small></span></button>)}{!local.length && !unlinked.length && <p className="inline-note">{remote ? '暂无成员工作空间' : '选择管理员后读取工作空间'}</p>}</div>}
      </section>;
    })}
    {members.filter(member => !admins.some(admin => endpoint(member) === endpoint(admin))).map(card)}
  </nav>;
}
