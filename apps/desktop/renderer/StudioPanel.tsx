import WorkspaceExportDuration from './WorkspaceExportDuration';
import {workspaceExportTtl} from '../../../packages/workspace-control/export-policy';
import {RememberedDetails} from './UiMemory';
import { useEffect, useRef, useState } from 'react';
import type { AccountCatalog, SshHost } from '../../../packages/contracts';
import type { WorkspaceDiscovery } from '../../../services/host-control/discovery-types';
import type { ManagedWorkspace, StudioApplyResult, StudioOperation, StudioPlan, StudioPlanInput, StudioSnapshot, WorkspaceEnvironment } from '../../../packages/workspace-control/types';
import { api } from './App';
import { Field, Icon, Modal, Toggle, errorText } from './ui';
import './StudioPanel.css';
import WorkspaceQuotas from './WorkspaceQuotas';
import StudioAccountQuotas, {readQuotaDraft, type QuotaDraft} from './StudioAccountQuotas';
import {allocationError} from '../../../packages/workspace-control/quotas';
import { changeDraftRoot, renameDraftMember, memberUsernameError } from './studio-directories';

interface Props { focusWorkspaceId?: string; onSnapshot?: (snapshot: StudioSnapshot) => void; onConnected?: (host: SshHost) => void; host: SshHost; active: boolean; discovery?: WorkspaceDiscovery; accountCatalog?: AccountCatalog; notify: (message: string) => void; onDiscover: () => void; discovering: boolean }
interface Editor {
  operation: 'workspace/adopt' | 'workspace/create' | 'workspace/update' | 'invite/create';
  workspaceId?: string; name: string; username: string; uid?: number; root: string;
  environment: WorkspaceEnvironment; accountIds: string; accountQuotas: QuotaDraft; label: string; ttlMinutes: string;
}
const envKeys = ['LANG', 'LC_ALL', 'TZ', 'TERM', 'COLORTERM'] as const;
const operationLabels: Record<StudioOperation, string> = { 'workspace/adopt': '纳入已有工作空间', 'workspace/create': '新建成员工作空间', 'workspace/update': '修改工作空间策略', 'workspace/suspend': '暂停工作空间授权', 'workspace/delete': '删除工作空间', 'device/revoke': '踢出设备', 'invite/create': '导出工作空间', 'invite/revoke': '撤销设备邀请' };
const statusLabels = { active: '启用', suspended: '已暂停', deleted: '已删除' };
const deviceStatuses = { active: '有效', revoked: '已撤销' };
const inviteStatuses = { active: '待导入', redeemed: '已使用', revoked: '已撤销', expired: '已过期' };
const date = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '未知';
const pathIsAbsolute = (value: string) => value.startsWith('/') && !value.includes('\0') && !value.split('/').includes('..');
const parseAccountIds = (text: string) => {
  const ids = [...new Set(text.split(/[\s,，]+/).filter(Boolean))];
  if (ids.length > 128 || ids.some(id => !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id))) throw new Error('账号 ID 格式无效。');
  return ids;
};
const editorFor = (operation: Editor['operation'], workspace?: ManagedWorkspace): Editor => ({
  operation, workspaceId: operation === 'workspace/update' || operation === 'invite/create' ? workspace?.id : undefined, uid: workspace?.uid, name: workspace?.name ?? '', username: workspace?.username ?? '', root: workspace?.root ?? '',
  environment: workspace ? { ...workspace.environment, runtimes: [...workspace.environment.runtimes], env: { ...workspace.environment.env } } : { runtimes: ['codex', 'claude'], defaultDirectory: '', env: {} },
  accountIds: workspace?.allowedAccountIds.join(', ') ?? '', accountQuotas: Object.fromEntries(Object.entries(workspace?.accountQuotas ?? {}).map(([id, quota]) => [id, {weeklyPercent: quota.weeklyPercent == null ? '' : String(quota.weeklyPercent), fiveHourPercent: quota.fiveHourPercent == null ? '' : String(quota.fiveHourPercent), allowOverage: quota.allowOverage ?? true}])), label: '', ttlMinutes: '60',
});

export default function StudioPanel({ host, active, discovery, accountCatalog, notify, onDiscover, discovering, focusWorkspaceId, onSnapshot, onConnected }: Props) {
  const [exporting,setExporting]=useState(false),[exportTtl,setExportTtl]=useState(3600);
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [connecting,setConnecting]=useState<ManagedWorkspace|null>(null);
  const [plan, setPlan] = useState<StudioPlan | null>(null);
  const [actionTitle, setActionTitle] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [result, setResult] = useState<StudioApplyResult | null>(null);
  const [pendingOperation, setPendingOperation] = useState('');
  const [pendingExport, setPendingExport] = useState('');
  const [exportedPath, setExportedPath] = useState('');
  const [loadedAccounts, setLoadedAccounts] = useState<AccountCatalog | null>(null);
  const [accountsBusy, setAccountsBusy] = useState(false);
  const [accountsError, setAccountsError] = useState('');
  const [accountsRead, setAccountsRead] = useState(false);
  const [deleteConfirmation,setDeleteConfirmation]=useState('');
  const [deleteTarget, setDeleteTarget] = useState<{name:string;username:string;root:string}|null>(null);
  const [now, setNow] = useState(Date.now());
  const live = useRef(true), epoch = useRef(0), accountEpoch = useRef(0), busyRef = useRef(false), accountBusyRef = useRef(false);
  const planRef = useRef<StudioPlan | null>(null), snapshotRef = useRef<StudioSnapshot | null>(null);
  const selected = snapshot?.workspaces.find(workspace => workspace.id === selectedId && workspace.status!=='deleted');
  const ready = snapshot?.availability === 'ready' && !stale;
  const accounts = loadedAccounts ?? accountCatalog;
  const editorAccounts = accountsRead && !accountsBusy && !accountsError && loadedAccounts?.availability === 'ready' ? loadedAccounts : undefined;
  const deletedWorkspaces = [...new Map((snapshot?.workspaces ?? []).filter(workspace => workspace.status === 'deleted' && !snapshot?.workspaces.some(active => active.status !== 'deleted' && (active.username === workspace.username || active.uid === workspace.uid))).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).map(workspace => [workspace.username, workspace])).values()];
  const candidates = discovery?.hostId === host.id ? discovery.workspaces.filter(workspace => workspace.confidence === 'high' && workspace.uid > 0 && workspace.username !== 'root' && !snapshot?.workspaces.some(managed => managed.username === workspace.username && managed.status !== 'deleted') && !deletedWorkspaces.some(deleted => deleted.username === workspace.username)) : [];
  const planWorkspace = snapshot?.workspaces.find(workspace => workspace.id === plan?.workspaceId) ?? deleteTarget;
  const usernameError = editor?.operation === 'workspace/create' ? memberUsernameError(editor.username) : '';
  useEffect(() => { live.current = true; return () => { live.current = false; epoch.current++; accountEpoch.current++; busyRef.current=false; }; }, []);
  useEffect(() => { if (!plan) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [plan]);
  const invalidatePlan = () => { planRef.current = null; setPlan(null); setDeleteConfirmation(''); };
  const acceptSnapshot = (value: StudioSnapshot) => {
    snapshotRef.current = value; setSnapshot(value); setStale(false); onSnapshot?.(value);
    setSelectedId(previous => value.workspaces.some(workspace => workspace.id === previous && workspace.status!=='deleted') ? previous : '');
  };
  useEffect(() => { if(focusWorkspaceId && snapshotRef.current?.workspaces.some(workspace => workspace.id === focusWorkspaceId)) setSelectedId(focusWorkspaceId); }, [focusWorkspaceId, snapshot?.availability]);
  const load = async () => {
    if (busyRef.current) return;
    const request = ++epoch.current, current = () => live.current && request === epoch.current;
    busyRef.current = true; setBusy('list'); setError(''); invalidatePlan(); setEditor(null);
    try { const value = await api<StudioSnapshot>('studio/list', { id: host.id }); if (current()) {acceptSnapshot(value);onDiscover();} }
    catch (e) { if (current()) { setStale(true); setError(errorText(e)); } }
    finally { if (current()) { busyRef.current = false; setBusy(''); } }
  };
  const loadAccounts = async () => {
    if (accountBusyRef.current || busyRef.current) return;
    const request = ++accountEpoch.current, current = () => live.current && request === accountEpoch.current;
    accountBusyRef.current = true; setAccountsBusy(true); setAccountsRead(false); setAccountsError(''); invalidatePlan();
    try { const value = await api<AccountCatalog>('accounts/list', { id: host.id }); if (current()) setLoadedAccounts(value); }
    catch (e) { if (current()) setAccountsError(errorText(e)); }
    finally { if (current()) { accountBusyRef.current = false; setAccountsBusy(false); setAccountsRead(true); } }
  };
  useEffect(() => { if(active&&!snapshotRef.current)void load(); }, [active]);
  const accountEditorKey = editor && editor.operation !== 'invite/create' ? `${editor.operation}:${editor.workspaceId ?? ''}` : '';
  useEffect(() => {
    if (!accountEditorKey) return;
    void loadAccounts();
    return () => { accountEpoch.current++; accountBusyRef.current = false; setAccountsBusy(false); setAccountsRead(false); };
  }, [accountEditorKey]);
  const requestPlan = async (input: StudioPlanInput, title = operationLabels[input.operation]) => {
    if (!ready || busyRef.current) return;
    const request = ++epoch.current, current = () => live.current && request === epoch.current;
    busyRef.current = true; setBusy('plan'); setError(''); setActionTitle(title); invalidatePlan();
    try {
      const value = await api<StudioPlan>('studio/plan', { id: host.id, ...input });
      if (!current()) return;
      const creating=input.operation==='workspace/create'||input.operation==='workspace/adopt'||input.operation==='workspace/delete'&&!input.workspaceId;
      if (value.operation !== input.operation || (creating ? !value.workspaceId || snapshotRef.current?.workspaces.some(workspace=>workspace.id===value.workspaceId) : value.workspaceId !== input.workspaceId) || value.expectedRevision !== input.expectedRevision || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error('变更预览与当前请求不匹配，请刷新。');
      planRef.current = value; setPlan(value);
    } catch (e) { if (current()) { setError(errorText(e)); setStale(true); setEditor(null); } }
    finally { if (current()) { busyRef.current = false; setBusy(''); } }
  };
  const saveInvitation = async (inviteExportId: string) => {
    if (busyRef.current) return;
    const request = ++epoch.current, current = () => live.current && request === epoch.current;
    busyRef.current = true; setBusy('export'); setError('');
    try {
      const value = await api<{ saved: boolean; path?: string }>('studio/invite-export', { id: host.id, inviteExportId });
      if (current() && value.saved) { setPendingExport(''); setExportedPath(value.path ?? '已保存'); notify('工作空间已导出，每个文件仅可成功导入一次。'); }
    } catch (e) { if (current()) setError(errorText(e)); }
    finally { if (current()) { busyRef.current = false; setBusy(''); } }
  };
  const apply = async () => {
    const target = planRef.current;
    if (!target || busyRef.current || Date.parse(target.expiresAt) <= Date.now() || target.operation==='workspace/delete'&&(!target.deletion||deleteConfirmation!==target.deletion.username)) return;
    const request = ++epoch.current, current = () => live.current && request === epoch.current;
    busyRef.current = true; setBusy('apply'); setError(''); invalidatePlan(); setEditor(null); setStale(true); setPendingOperation(target.planId); setResult(null);
    let exportId = '';
    try {
      const value = await api<StudioApplyResult>('studio/apply', { id: host.id, planId: target.planId, planHash: target.planHash, confirm: true });
      if (!current()) return;
      if (value.operationId !== target.planId) throw new Error('操作回执与已提交计划不一致。');
      setResult(value.state === 'applied' && target.operation === 'workspace/delete' ? null : value);
      if (value.state !== 'uncertain') setPendingOperation('');
      if (value.state === 'applied') {
        exportId = value.inviteExportId ?? ''; if (exportId) { setPendingExport(exportId); setExportedPath(''); }
        const next = await api<StudioSnapshot>('studio/list', { id: host.id });
        if (current()) {
          acceptSnapshot(next);
          if (['workspace/create', 'workspace/adopt'].includes(target.operation) && next.workspaces.some(workspace => workspace.id === target.workspaceId && workspace.status === 'active')) setSelectedId(target.workspaceId!);
          if (target.operation === 'workspace/delete') setResult(null);
          onDiscover(); notify(target.operation === 'workspace/delete' ? '工作空间、用户目录及 SSH 身份已永久删除。' : '管理变更已应用。');
        }
      }
    } catch (e) { if (current()) setError(`操作回执未确认：${errorText(e)}。请刷新并查询，不要重复提交。`); }
    finally { if (current()) { busyRef.current = false; setBusy(''); if (exportId) void saveInvitation(exportId); } }
  };
  const checkOperation = async () => {
    if (!pendingOperation || busyRef.current) return;
    const operationId = pendingOperation, request = ++epoch.current, current = () => live.current && request === epoch.current;
    busyRef.current = true; setBusy('operation'); setError('');
    try {
      const next = await api<StudioSnapshot>('studio/list', { id: host.id }); if (!current()) return; acceptSnapshot(next);
      if (next.availability !== 'ready') throw new Error('管理服务不可用，暂时无法确认此操作。');
      const value = await api<StudioApplyResult>('studio/operation', { id: host.id, operationId }); if (!current()) return;
      if (value.operationId !== operationId) throw new Error('操作状态与待查询请求不匹配。');
      const deleted = value.state === 'applied' && value.workspace?.status === 'deleted';
      setResult(deleted ? null : value); if (value.state !== 'uncertain') setPendingOperation('');
      if (deleted) { onDiscover(); notify('工作空间已删除。'); }
      if (value.state === 'uncertain') setStale(true);
    } catch (e) { if (current()) { setStale(true); setError(errorText(e)); } }
    finally { if (current()) { busyRef.current = false; setBusy(''); } }
  };
  const begin = (operation: Editor['operation'], workspace?: ManagedWorkspace) => {
    if(workspace?.controlState==='recovery-required'){setError('此工作空间有未确认的管理副作用，须先由管理员核实恢复。');return;}
    if (!ready || busyRef.current) return; invalidatePlan(); setError(''); setDeleteTarget(null);
    setEditor(editorFor(operation, workspace));
    setActionTitle(operationLabels[operation]);
  };
  const change = (patch: Partial<Editor>) => { if (busyRef.current) return; invalidatePlan(); setEditor(value => value ? { ...value, ...patch } : value); };
  const prepareEditor = () => {
    if (!editor || !snapshotRef.current || (editor.operation !== 'invite/create' && (accountBusyRef.current || !accountsRead))) return;
    try {
      let values: Record<string, unknown>;
      if (editor.operation === 'invite/create') {
        const minutes = workspaceExportTtl(Number(editor.ttlMinutes)*60)/60; if (!editor.label.trim()) throw new Error('请填写导出说明。');
        values = { label: editor.label.trim(), ttlSeconds: minutes * 60 };
      } else {
        if(usernameError)throw new Error(usernameError);
        if (!editor.name.trim() || !pathIsAbsolute(editor.environment.defaultDirectory)) throw new Error('填写名称与有效的远端绝对工作目录。');
        const accountIds = parseAccountIds(editor.accountIds);
        const accountQuotas = Object.fromEntries(accountIds.map(id => {
          const allocation = readQuotaDraft(editor.accountQuotas[id]);
          const invalid = allocationError(snapshotRef.current!.workspaces, id, allocation, editor.workspaceId);
          if (invalid) throw Error((accounts?.accounts.find(a => a.id === id)?.email ?? id) + '：' + invalid);
          return [id, allocation];
        }));
        values = { name: editor.name.trim(), environment: { ...editor.environment, env: Object.fromEntries(Object.entries(editor.environment.env).filter(([, value]) => !!value)) }, allowedAccountIds: accountIds, accountQuotas };
        if (editor.operation !== 'workspace/update') {
          if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(editor.username) || editor.username === 'root' || !pathIsAbsolute(editor.root)) throw new Error('填写普通成员用户名与有效的绝对空间目录。');
          Object.assign(values, { username: editor.username, root: editor.root });
          if (editor.operation === 'workspace/adopt') { if (!Number.isSafeInteger(editor.uid) || !editor.uid) throw new Error('请从本次只读发现中选择已有成员。'); values.uid = editor.uid; }
        }
      }
      void requestPlan({ expectedRevision: snapshotRef.current.revision, operation: editor.operation, workspaceId: editor.workspaceId, values }, operationLabels[editor.operation]);
    } catch (e) { setError(errorText(e)); }
  };
  const immediate = (operation: StudioOperation, values: Record<string, unknown> = {}, title?: string) => {
    if(selected?.controlState==='recovery-required'){setError('此工作空间有未确认的管理副作用，须先由管理员核实恢复。');return;}
    if (!selected || !snapshotRef.current) return;
    setEditor(null); void requestPlan({ expectedRevision: snapshotRef.current.revision, operation, workspaceId: selected.id, values }, title);
  };
  const deleteWorkspace = (source:{id?:string;name:string;username:string;uid:number;root:string}, managed:boolean) => {
    if(!ready||!snapshotRef.current||busyRef.current)return;
    setEditor(null);setDeleteTarget(source);
    void requestPlan({expectedRevision:snapshotRef.current.revision,operation:'workspace/delete',...(managed?{workspaceId:source.id}:{values:{name:source.name,username:source.username,uid:source.uid,root:source.root}})});
  };
  const exportSelected=async()=>{if(!selected||busyRef.current)return;busyRef.current=true;setBusy('export');setError('');try{const result=await api<{saved:boolean;path?:string}>('studio/export-managed',{id:host.id,workspaceId:selected.id,ttlSeconds:exportTtl});if(live.current&&result.saved){setExporting(false);setExportedPath(result.path??'已保存');notify('工作空间已导出，每个文件仅可成功导入一次。');}}catch(e){if(live.current)setError(errorText(e));}finally{busyRef.current=false;if(live.current)setBusy('');}};
  const connect=async()=>{if(!connecting||busyRef.current)return;busyRef.current=true;setBusy('connect');setError('');try{const member=await api<SshHost>('studio/connect',{id:host.id,workspaceId:connecting.id,confirm:true});if(live.current){setConnecting(null);onConnected?.(member);notify('本机已连接，可选择此空间开始工作。');}}catch(e){if(live.current)setError(errorText(e));}finally{busyRef.current=false;if(live.current)setBusy('');}};
  const closeModal = () => { if (busyRef.current) return; invalidatePlan(); setEditor(null); setError(''); };
  const workspaceDetail = selected && <div className="studio-workspace-detail" data-testid="studio-workspace-detail">
          <div className="studio-workspace-heading"><h4>{selected.name}</h4><span>{statusLabels[selected.status]}</span></div>
          {selected.controlState==='recovery-required'&&<p className="inline-error" role="alert" data-testid="studio-recovery-required">此空间的管理操作尚未确认。账号访问和设备登记已暂停，需管理员核实恢复。</p>}
          <dl className="studio-metadata"><div><dt>可用账号</dt><dd>{selected.allowedAccountIds.map(id=>accounts?.accounts.find(a=>a.id===id)?.displayName??accounts?.accounts.find(a=>a.id===id)?.email??id).join('、') || '尚未分配'}</dd></div></dl>
          <RememberedDetails memoryId="StudioPanel.details.1" scope={selected.id} className="studio-environment-summary"><summary>空间详情</summary><dl className="studio-metadata"><div><dt>成员身份</dt><dd>{selected.username} · UID {selected.uid}</dd></div><div><dt>空间目录</dt><dd className="mono">{selected.root}</dd></div><div><dt>默认目录</dt><dd className="mono">{selected.environment.defaultDirectory}</dd></div><div><dt>允许运行时</dt><dd>{selected.environment.runtimes.join(' / ') || '未选择'} · 复用远端共享安装</dd></div></dl></RememberedDetails>
          <div className="studio-toolbar"><button className="button secondary compact-button" data-testid="studio-connect" disabled={!ready||!!busy||selected.status!=='active'} onClick={()=>{setError('');setConnecting(selected);}}>连接到本机</button><button className="button secondary compact-button" data-testid="studio-edit" disabled={!ready || !!busy || selected.status === 'deleted'} onClick={() => begin('workspace/update', selected)}>配置空间</button><button className="button secondary compact-button" data-testid="studio-invite-create" disabled={!ready || !!busy || selected.status !== 'active'} onClick={() => snapshot?.enrollmentUrl?begin('invite/create', selected):(setExportTtl(3600),setExporting(true))}>导出工作空间</button></div>

          <RememberedDetails memoryId="StudioPanel.details.2" scope={selected.id} className="studio-devices-section" data-testid="studio-devices-section" open><summary>已授权设备 <span>{selected.devices.filter(device => device.status === 'active').length} 台设备</span></summary><div className="studio-device-list" data-testid="studio-devices">{selected.devices.map(device => <article key={device.id} data-testid={`studio-device-${device.id}`}><div><strong>{device.label}</strong><small>{deviceStatuses[device.status]} · {date(device.createdAt)}</small><p className="mono">{device.fingerprint}</p></div><button className="button secondary compact-button" data-testid={`studio-revoke-device-${device.id}`} disabled={!ready || !!busy || device.status !== 'active' || selected.status !== 'active'} onClick={() => immediate('device/revoke', { deviceId: device.id })}>踢出设备</button></article>)}{!selected.devices.length && <p className="inline-note">暂无设备。</p>}</div>
          <h4 className="studio-list-heading">导出文件</h4><div className="studio-device-list" data-testid="studio-invites">{selected.invites.map(invite => <article key={invite.id}><div><strong>{invite.label}</strong><small>{inviteStatuses[invite.status]} · {date(invite.expiresAt)} 到期</small></div><button className="button secondary compact-button" data-testid={`studio-revoke-invite-${invite.id}`} disabled={!ready || !!busy || invite.status !== 'active'} onClick={() => immediate('invite/revoke', { inviteId: invite.id })}>撤销邀请…</button></article>)}{!selected.invites.length && <p className="inline-note">没有待使用的导出记录。</p>}</div></RememberedDetails>
        </div>;
  if (host.role !== 'admin') return null;
  return <section className="studio-panel" data-testid="studio-panel">
    <div className="section-heading"><div><h3>成员工作空间</h3></div><button type="button" className="text-button" data-testid="studio-refresh" disabled={!!busy||discovering} onClick={load}>{busy === 'list'||discovering ? '读取中…' : snapshot ? '刷新列表' : '读取工作空间'}</button></div>
    {!snapshot && <div className="studio-intro" role="status"><p>{busy==='list'?'正在读取此管理员下的工作空间…':'暂未读取到工作空间，请重试。'}</p></div>}
    {snapshot && <div data-testid="studio-snapshot" data-availability={snapshot.availability}>
      {snapshot.availability !== 'ready' ? <div className="callout warning"><strong>暂时无法读取工作空间</strong><p>{snapshot.reason ?? '请检查管理员 SSH 连接后重试。'}</p></div> : <>
        <div className="studio-list-toolbar"><span>{snapshot.workspaces.filter(w=>w.status!=='deleted').length} 个受管空间{candidates.length?' · '+candidates.length+' 个可纳入空间':''}</span><button className="button secondary compact-button" data-testid="studio-create" disabled={!ready || !!busy} onClick={() => begin('workspace/create')}><Icon name="plus" size={13} />新建空间</button></div>
        <div className="studio-workspace-list" aria-label="成员工作空间">{snapshot.workspaces.filter(workspace=>workspace.status!=='deleted').map((workspace,index) => <article className={`studio-space ${selectedId === workspace.id ? 'expanded' : ''}`} key={workspace.id}><div className="studio-workspace-row"><button type="button" data-testid={`studio-workspace-${workspace.id}`} className={selectedId === workspace.id ? 'selected' : ''} aria-expanded={selectedId === workspace.id} aria-controls={`space-content-${workspace.id}`} disabled={!!busy} onClick={() => { invalidatePlan(); setEditor(null); setSelectedId(value => value === workspace.id ? '' : workspace.id); }}><span className="studio-space-number">{String(index+1).padStart(2,'0')}</span><div><strong>{workspace.name}</strong><small>{workspace.username} · {workspace.devices.filter(device=>device.status==='active').length} 台授权设备</small></div><Icon name="chevron-down" size={14}/></button><div className="studio-space-controls"><span>{statusLabels[workspace.status]}</span><fieldset className="resource-fieldset studio-enable" disabled={!ready||!!busy||workspace.controlState==='recovery-required'}><Toggle label={`启用工作空间 ${workspace.name}`} checked={workspace.status==='active'} onChange={enabled=>{setEditor(null);void requestPlan({expectedRevision:snapshot.revision,operation:'workspace/suspend',workspaceId:workspace.id,values:{suspended:!enabled}},enabled?'启用工作空间':'停用工作空间');}}/></fieldset><button type="button" className="studio-trash icon-button" data-testid={`studio-delete-row-${workspace.id}`} aria-label={`删除工作空间 ${workspace.name}`} title="删除工作空间" disabled={!ready||!!busy||workspace.controlState==='recovery-required'} onClick={()=>deleteWorkspace(workspace,true)}><Icon name="trash" size={16}/></button></div></div><div id={`space-content-${workspace.id}`}>{selectedId===workspace.id&&workspaceDetail}</div></article>)}</div>
        {!!candidates.length&&<div className="studio-discovered" data-testid="studio-discovered"><h4>已有空间</h4>{candidates.map(source=><div key={source.id}><span><strong>{source.name}</strong><small>{source.username} · {source.root}</small></span><button className="text-button" data-testid={`studio-adopt-${source.username}`} disabled={!ready||!!busy} onClick={()=>{invalidatePlan();setError('');setActionTitle(operationLabels['workspace/adopt']);setEditor({...editorFor('workspace/adopt'),name:source.name,username:source.username,uid:source.uid,root:source.root,environment:{runtimes:['codex','claude'],defaultDirectory:source.root,env:{}}});}}>纳入管理</button><button type="button" className="studio-trash icon-button" data-testid={`studio-delete-discovered-${source.username}`} aria-label={`删除工作空间 ${source.name}`} title="删除工作空间" disabled={!ready||!!busy} onClick={()=>deleteWorkspace(source,false)}><Icon name="trash" size={16}/></button></div>)}</div>}
        {!snapshot.workspaces.some(w=>w.status!=='deleted')&&!candidates.length&&<p className="inline-note">{discovering?'正在核实已有空间…':'暂无工作空间。'}</p>}

        <WorkspaceQuotas workspaces={snapshot.workspaces} catalog={accounts} disabled={!ready||!!busy} onEdit={workspace => {setSelectedId(workspace.id);begin('workspace/update', workspace);}}/>
      </>}
    </div>}
    {stale && <p className="inline-note" data-testid="studio-stale">当前管理观测需要刷新；旧计划不能再次提交。</p>}
    {result && <div className="studio-result" data-testid="studio-result" data-state={result.state} role="status"><strong>{result.state === 'applied' ? '变更已应用' : result.state === 'failed' ? '变更未应用' : '结果尚未确认'}</strong>{result.effects.map((effect, index) => <p key={index}>{effect}</p>)}</div>}
    {pendingOperation && <button type="button" className="button secondary compact-button" data-testid="studio-operation-check" disabled={!!busy} onClick={checkOperation}>{busy === 'operation' ? '正在查询…' : '刷新并查询该操作'}</button>}
    {pendingExport && <button type="button" className="button secondary compact-button" data-testid="studio-invite-export" disabled={!!busy} onClick={() => saveInvitation(pendingExport)}>{busy === 'export' ? '正在保存…' : '保存工作空间文件'}</button>}
    {exportedPath && <p className="inline-note" data-testid="studio-invite-saved">工作空间文件已保存：{exportedPath}</p>}
    {error && !editor && !plan && <p className="inline-error" data-testid="studio-error" role="alert">{error}</p>}
    {exporting&&<Modal title="导出工作空间" dismissible={!busy} onClose={()=>setExporting(false)}><WorkspaceExportDuration value={exportTtl} onChange={setExportTtl} disabled={!!busy}/>{error&&<p className="inline-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button secondary" disabled={!!busy} onClick={()=>setExporting(false)}>取消</button><button className="button primary" disabled={!!busy||!selected} onClick={()=>void exportSelected()}>导出文件</button></div></Modal>}
    {connecting&&<Modal title="连接工作空间到本机" onClose={()=>{if(!busy)setConnecting(null);}}><p>{connecting.name} · {connecting.username}</p><p className="inline-note">为本机生成独立 SSH 密钥，并向该空间登记公钥。已有密钥和文件保留。</p>{error&&<p className="inline-error">{error}</p>}<div className="modal-actions"><button className="button secondary" disabled={!!busy} onClick={()=>setConnecting(null)}>取消</button><button className="button primary" data-testid="studio-connect-confirm" disabled={!!busy} onClick={()=>void connect()}>{busy?'正在登记…':'确认连接'}</button></div></Modal>}
    {(editor || plan || busy === 'plan') && <Modal title={plan ? `确认：${actionTitle}` : actionTitle} onClose={closeModal}>
      {busy === 'plan' ? <p role="status">正在读取不可修改的服务端变更预览…</p> : plan ? <div data-testid="studio-plan"><p className="inline-note">服务端预览 · {date(plan.expiresAt)} 前有效</p>{plan.operation === 'workspace/delete' && planWorkspace && <dl className="studio-metadata" data-testid="studio-delete-target"><div><dt>工作空间</dt><dd>{planWorkspace.name}</dd></div><div><dt>成员</dt><dd>{planWorkspace.username}</dd></div><div><dt>永久删除目录</dt><dd className="mono">{plan.deletion?.home ?? planWorkspace.root}</dd></div></dl>}<ul>{plan.effects.map((effect, index) => <li key={index}>{effect}</li>)}</ul>{plan.operation === 'workspace/delete' ? <div className="callout warning" data-testid="studio-delete-warning"><p>此操作不可恢复：停止此用户的进程，永久删除整个用户目录（含文件、缓存和 SSH 授权）及系统用户，撤销设备与邀请。集中账号和共享 CLI 不受影响。用户目录之外的文件不在删除范围内。</p><Field label="输入成员用户名，确认永久删除"><input data-testid="studio-delete-confirmation" autoComplete="off" value={deleteConfirmation} onChange={event=>setDeleteConfirmation(event.target.value)} placeholder={plan.deletion?.username}/></Field></div> : ['workspace/suspend', 'device/revoke'].includes(plan.operation) && <p className="inline-note">{plan.operation==='workspace/suspend'?'停用期间暂停空间访问，保留原设备授权；重新启用后原设备无需再次导入。已有 SSH 会话不会被强行终止。':'踢出后此设备不能再用原密钥登录；已有 SSH 会话不会被强行终止。'}</p>}{Date.parse(plan.expiresAt) <= now && <p className="inline-error">预览已过期，请返回重新读取。</p>}<div className="modal-actions"><button type="button" className="button secondary" data-testid="studio-plan-back" onClick={() => { invalidatePlan(); if (!editor) closeModal(); }}>返回修改</button><button type="button" className="button primary" data-testid="studio-apply" disabled={!!busy || Date.parse(plan.expiresAt) <= now || plan.operation==='workspace/delete'&&(!plan.deletion||deleteConfirmation!==plan.deletion.username)} onClick={apply}>{plan.operation==='workspace/delete'?'永久删除此空间':'确认应用此计划'}</button></div></div> : editor && <form data-testid="studio-editor" onSubmit={event => { event.preventDefault(); prepareEditor(); }}>
        {editor.operation === 'invite/create' ? <><Field label="导出说明"><input data-testid="studio-invite-label" required maxLength={128} value={editor.label} onChange={event => change({ label: event.target.value })} /></Field><WorkspaceExportDuration value={Number(editor.ttlMinutes)*60} onChange={seconds=>change({ttlMinutes:String(seconds/60)})} disabled={!!busy}/></> : <>
          {editor.operation === 'workspace/adopt' && <Field label="本次只读发现的空间"><select data-testid="studio-adopt-candidate" value={editor.username} onChange={event => { const source = candidates.find(item => item.username === event.target.value); if (source) change({ name: source.name, username: source.username, uid: source.uid, root: source.root, environment: { ...editor.environment, defaultDirectory: source.root } }); }}><option value="">选择已有成员空间</option>{candidates.map(source => <option key={source.id} value={source.username}>{source.name} · {source.username} · UID {source.uid}</option>)}</select></Field>}
          <Field label="工作空间名称"><input data-testid="studio-name" required maxLength={256} value={editor.name} onChange={event => change({ name: event.target.value })} /></Field>
          <div className="form-grid"><Field label="普通成员用户名"><input data-testid="studio-username" aria-invalid={!!usernameError} aria-describedby={usernameError?'studio-username-error':undefined} required readOnly={editor.operation !== 'workspace/create'} pattern="[a-z_][a-z0-9_-]{0,31}" value={editor.username} onChange={event => { const next = renameDraftMember({ username: editor.username, root: editor.root, defaultDirectory: editor.environment.defaultDirectory }, event.target.value); change({ username: next.username, root: next.root, environment: { ...editor.environment, defaultDirectory: next.defaultDirectory } }); }} /></Field><Field label="空间目录"><input data-testid="studio-root" required readOnly={editor.operation === 'workspace/update'} placeholder="随用户名自动填写" value={editor.root} onChange={event => { const next = changeDraftRoot({ username: editor.username, root: editor.root, defaultDirectory: editor.environment.defaultDirectory }, event.target.value); change({ root: next.root, environment: { ...editor.environment, defaultDirectory: next.defaultDirectory } }); }} /></Field></div>
          {usernameError&&<p className="inline-error studio-username-error" id="studio-username-error" data-testid="studio-username-error" role="status">{usernameError}</p>}
          {editor.operation === 'workspace/update' && <p className="inline-note studio-identity-note">成员身份与空间目录已固定。修改显示名称或默认工作目录不会重命名成员或移动文件。</p>}
          <Field label="默认工作目录"><input data-testid="studio-default-directory" required value={editor.environment.defaultDirectory} onChange={event => change({ environment: { ...editor.environment, defaultDirectory: event.target.value } })} /></Field>
          <fieldset className="studio-runtime-options"><legend>允许此空间使用 · 复用共享 CLI</legend>{(['codex', 'claude'] as const).map(runtime => <label key={runtime}><input type="checkbox" data-testid={`studio-runtime-${runtime}`} checked={editor.environment.runtimes.includes(runtime)} onChange={event => change({ environment: { ...editor.environment, runtimes: event.target.checked ? [...editor.environment.runtimes, runtime] : editor.environment.runtimes.filter(item => item !== runtime) } })} />{runtime === 'codex' ? 'Codex' : 'Claude'}</label>)}</fieldset>
          <RememberedDetails memoryId="StudioPanel.details.3" className="studio-environment-fields"><summary>环境变量策略</summary><div className="form-grid">{envKeys.map(key => <Field key={key} label={key}><input data-testid={`studio-env-${key}`} maxLength={128} value={editor.environment.env[key] ?? ''} onChange={event => change({ environment: { ...editor.environment, env: { ...editor.environment.env, [key]: event.target.value } } })} /></Field>)}</div></RememberedDetails>
          <div className="studio-account-heading"><span>账号识别</span><button type="button" className="text-button" data-testid="studio-accounts-refresh" disabled={accountsBusy || !!busy} onClick={loadAccounts}>{accountsBusy ? '读取中…' : '重新读取'}</button></div>
          <p className={accountsError || (accountsRead && loadedAccounts?.availability === 'unavailable') ? 'inline-error' : 'inline-note'} data-testid="studio-accounts-status" role="status">{accountsBusy || !accountsRead ? '正在自动识别此服务器的账号…' : accountsError ? `账号读取失败：${accountsError}。可重新读取；已有选择仍保留。` : loadedAccounts?.availability === 'unavailable' ? `账号服务暂不可用：${loadedAccounts.reason ?? '请在账号页核实服务状态。'} 已有选择仍保留。` : editorAccounts?.accounts.length ? `已识别 ${editorAccounts.accounts.length} 个账号，请选择要分配给此空间的账号。` : '尚未识别到账号。请先在账号页完成原生账号接入，再重新读取。'}</p>
          <StudioAccountQuotas key={JSON.stringify([editor.workspaceId ?? editor.username, editorAccounts?.authorityId, editorAccounts?.generation, editorAccounts?.accounts.map(account => [account.id, account.generation])])} host={host} catalog={editorAccounts} selected={editor.accountIds.split(/[\s,，]+/).filter(Boolean)} values={editor.accountQuotas} workspaces={snapshot?.workspaces ?? []} workspaceId={editor.workspaceId} disabled={!!busy || accountsBusy || !accountsRead} onSelect={(id, checked) => {const ids = parseAccountIds(editor.accountIds);change({accountIds: (checked ? [...new Set([...ids,id])] : ids.filter(value => value !== id)).join(', ')});}} onChange={accountQuotas => change({accountQuotas})}/>

        </>}
        {error && <p className="inline-error" data-testid="studio-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={closeModal}>取消</button><button className="button primary" data-testid="studio-plan-request" disabled={!!busy || !!usernameError || (editor.operation !== 'invite/create' && (accountsBusy || !accountsRead)) || !ready}>预览变更</button></div>
      </form>}
    </Modal>}
  </section>;
}
