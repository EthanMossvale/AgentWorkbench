import {useUiPreference,uiPreferences} from './ui-preferences';
import RemoteResourcePanel from './RemoteResourcePanel';
import AppearanceSettings from './AppearanceSettings';
import RemoteFileBrowser from './RemoteFileBrowser';
import ConnectionLayout from './ConnectionLayout';
import { useEffect, useRef, useState } from 'react';
import type { AppState, Capability, SshHost } from '../../../packages/contracts';
import { api } from './App';
import { Field, Icon, Modal } from './ui';
import TranslationSettings from './TranslationSettings';
import { SharedMemory, SharedSkills } from './NativeSettings';
import PluginSettings from './PluginSettings';
import type { WorkspaceDiscovery } from '../../../services/host-control/discovery-types';
import ProviderAccounts from './ProviderAccounts';
import ConnectionTree from './ConnectionTree';
import StudioPanel from './StudioPanel';
import WorkspaceInviteImport from './WorkspaceInviteImport';
import WorkspaceExport from './WorkspaceExport';
import './Connections.css';
import RemoteBrowserManager from './RemoteBrowserManager';
import RemoteCliManager from './RemoteCliManager';
import RemoteSessionRetention from './RemoteSessionRetention';
import HostConnectionDialog from './HostConnectionDialog';
import type { ManagedWorkspace } from '../../../packages/workspace-control/types';
import { ConnectionAddress, ConnectionName } from './ConnectionAddress';
export interface PageProps { state: AppState; refresh: () => Promise<AppState>; report: (e: unknown) => void; notify: (text: string) => void }

export function Preferences({ state, refresh, report, notify, tab, onManageRuntimes }: PageProps & {tab:string; onManageRuntimes?:()=>void}) {
  return <div className="settings-preferences" hidden={!['plugins','translation','memory','skills','appearance','privacy'].includes(tab)}>
    {tab === 'memory' && <SharedMemory report={report} notify={notify} onManageRuntimes={onManageRuntimes} />}
    {tab === 'skills' && <SharedSkills report={report} notify={notify} />}
    {(tab === 'plugins' || tab === 'translation') && <PluginSettings state={state} refresh={refresh} report={report} notify={notify} />}
    {tab === 'appearance' && <AppearanceSettings state={state} refresh={refresh} report={report} notify={notify}/>}
    {tab === 'privacy' && <><section className="settings-section"><div className="section-heading"><div><h2>数据分层存放</h2><p>只处理新应用中由你主动配置的数据。</p></div></div><div className="privacy-list"><div><Icon name="shield" /><span><strong>翻译凭据</strong><small>由桌面可信服务交给系统加密存储，不返回 renderer，不读取现有 CLI token。</small></span></div><div><Icon name="chat" /><span><strong>会话与译文</strong><small>新工作台保存原文、实际提交文本与独立译文。此版本没有凭据导出入口。</small></span></div><div><Icon name="link" /><span><strong>SSH 连接</strong><small>仅保存明确填写的连接描述与密钥路径。私钥内容不属于扫描、导出或翻译范围。</small></span></div><div><Icon name="globe" /><span><strong>外发边界</strong><small>翻译服务是独立数据处理方；本地清除或关闭翻译不能撤回已经发送的文本。</small></span></div></div></section><div className="callout">本轮不迁移既有账号、不修改代理或 VPS、不自动购买额度或消费重置卡。真实服务调用须由你配置与确认。</div></>}
  </div>;
}

const emptyHost = (): SshHost => ({ id: '', name: '', hostname: '', port: 22, username: 'root', role: 'admin', identityFile: '', knownHostsFile: '', ownerId: 'local-owner', workspaceGeneration: '' });
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
export function Connections({ state, refresh, report, notify }: PageProps) {
  const [remoteFiles,setRemoteFiles]=useUiPreference<boolean>('connections.files');
  const [removing, setRemoving] = useState<SshHost | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);
  const [managed, setManaged] = useState<Record<string, ManagedWorkspace[]>>({});
  const [focusWorkspace, setFocusWorkspace] = useState('');
  const [editing, setEditing] = useState<SshHost | null>(null);
  const [saving, setSaving] = useState(false);
  const [activating,setActivating]=useState('');
  const [selected, setSelectedValue] = useState(state.activeWorkspaceId ?? state.hosts[0]?.id ?? '');
  const [discovery, setDiscovery] = useState<WorkspaceDiscovery | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [preferredTab, setConnectionTab] = useUiPreference<'workspaces' | 'accounts' | 'cli' | 'retention' | 'browser' | 'details'>('connections.tab',selected);
  const connectionTab=uiPreferences.get('connections.tab',selected).saved?preferredTab:state.hosts.find(host=>host.id===selected)?.role==='admin'?'workspaces':'accounts';
  const selectedRef = useRef(selected);
  const selectionEpoch = useRef(0);
  const discoveryEpoch = useRef(0);
  const editEpoch = useRef(0);
  const copyEpoch = useRef(0);
  const mounted = useRef(true);
  const selectHost = (id: string) => {
    setFocusWorkspace('');
    selectionEpoch.current++;
    discoveryEpoch.current++; copyEpoch.current++;
    selectedRef.current = id; setSelectedValue(id); setDiscovery(null); setDiscovering(false);

  };
  const openEditor = (value: SshHost) => { selectionEpoch.current++; editEpoch.current++; setSaving(false); setEditing(value); };
  const closeEditor = () => { editEpoch.current++; setSaving(false); setEditing(null); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; selectionEpoch.current++; discoveryEpoch.current++; editEpoch.current++; copyEpoch.current++; }; }, []);
  useEffect(() => {
    if (saving) return;
    if (state.hosts.some(item => item.id === selectedRef.current)) return;
    selectHost(state.hosts[0]?.id ?? '');
  }, [state.hosts, saving]);
  const host = state.hosts.find(h => h.id === selected);
  const activate=async(target:SshHost)=>{if(activating)return;setActivating(target.id);try{await api('workspace/select',{id:target.id});await refresh();notify('已选定工作空间，并读取可用账号。');}catch(e){report(e);}finally{if(mounted.current)setActivating('');}};
  const patch = (changes: Partial<SshHost>) => setEditing(h => h ? { ...h, ...changes } : h);
  const discover = async (target: SshHost) => {
    const epoch = ++discoveryEpoch.current;
    const current = () => mounted.current && epoch === discoveryEpoch.current && selectedRef.current === target.id;
    setDiscovering(true); setDiscovery(null);
    try {
      const result = await api<WorkspaceDiscovery>('host/discover', { id: target.id });
      if (!current()) return;
      if (result.hostId !== target.id) throw new Error('工作空间观测与当前连接不一致，请重新识别。');
      setDiscovery(result);
    } catch (e) { if (current()) report(e); }
    finally { if (current()) setDiscovering(false); }
  };
  const save = async (override?:SshHost) => {
    if (!editing || saving) return;
    const epoch = ++editEpoch.current;
    const selectedAtStart = selectedRef.current;
    const request = { ...(override??editing) };
    const current = () => mounted.current && epoch === editEpoch.current && selectedRef.current === selectedAtStart;
    setSaving(true);
    try {
      const saved = await api<SshHost>('host/save', { host: request });
      await refresh();
      if (!current()) return;
      selectHost(saved.id); setEditing(null); setSaving(false);
      if (saved.role === 'admin') {
        notify('管理员连接已保存；正在只读识别工作空间。');
      } else notify('工作空间连接已保存；尚未发起 SSH。');
    } catch (e) { if (current()) report(e); }
    finally { if (mounted.current && epoch === editEpoch.current) setSaving(false); }
  };
  const importedHost = (imported: SshHost) => {
    const epoch = ++selectionEpoch.current;
    const current = () => mounted.current && selectionEpoch.current === epoch;
    void refresh().then(() => { if (current()) selectHost(imported.id); }).catch(error => { if (current()) report(error); });
  };
  const filesOpen = host?.role==='admin' && connectionTab==='details' && remoteFiles;
  return <div className={'page connections-page'+(filesOpen?' has-files':'')}>
    <div className="page-heading"><div><h1>连接与环境</h1></div><div className="connection-page-actions"><WorkspaceInviteImport notify={notify} onImported={importedHost} /><WorkspaceExport hosts={state.hosts} selectedId={selected} notify={notify}/><button className="button primary" data-testid="new-host" onClick={() => openEditor(emptyHost())}><Icon name="plus" size={16} />添加连接</button></div></div>
    {!state.hosts.length ? <section className="connection-empty"><div className="large-icon"><Icon name="link" size={28} /></div><h2>还没有配置连接</h2><p>选择 VPS 提供的登录密钥，再填写服务器地址。<br />工作台会核对服务器身份、验证连接并读取工作空间。</p><button className="button secondary" onClick={() => openEditor(emptyHost())}>配置第一个 SSH 连接</button><div className="connection-steps"><span><b>01</b>选择登录密钥</span><span><b>02</b>识别工作空间</span><span><b>03</b>开始使用空间</span></div></section> :
      <ConnectionLayout filesOpen={filesOpen} navigation={<ConnectionTree hosts={state.hosts} profiles={state.profiles} selectedId={selected} onSelect={selectHost} workspaces={managed} onWorkspace={(hostId, workspaceId) => { selectHost(hostId); setFocusWorkspace(workspaceId); setConnectionTab('workspaces'); }} />}
        files={host?.role==='admin'?<RemoteFileBrowser key={JSON.stringify(host)} host={host} active={filesOpen} onClose={()=>setRemoteFiles(false)} report={report} notify={notify}/>:undefined}>
        {host && <section className="host-detail">
          <div className="section-heading"><div><h2><ConnectionName name={host.name} hostname={host.hostname}/></h2><ConnectionAddress hostname={host.hostname} port={host.port} username={host.username}/></div><span className="outline-label">{host.role === 'admin' ? '管理员' : '成员工作空间'}</span></div>
          {host.role !== 'admin' && <div className="host-actions">{state.activeWorkspaceId===host.id?<span className="workspace-default-note" data-testid="workspace-active"><Icon name="check" size={15}/>当前默认空间</span>:<button className="button primary" data-testid="workspace-activate" disabled={!!activating} onClick={()=>void activate(host)}>{activating===host.id?'正在核实连接…':'用于新任务'}</button>}</div>}
          <div className="connection-tabs" role="tablist" aria-label="连接内容">
            {(host.role === 'admin' ? [['workspaces', '工作空间'], ['accounts', '共享账号'], ['cli', '配置管理'], ['retention', '会话清理'], ['browser', '浏览器用户'], ['details', '连接详情']] : [['accounts', '可用账号'], ['details', '连接详情']]).map(([id, label]) => <button type="button" role="tab" key={id} data-testid={`connection-tab-${id}`} aria-selected={connectionTab === id} aria-controls={`connection-panel-${id}`} id={`connection-tab-${id}`} onClick={() => setConnectionTab(id as typeof connectionTab)}>{label}</button>)}
          </div>
          {host.role === 'admin' && <div hidden={connectionTab !== 'workspaces'} role="tabpanel" id="connection-panel-workspaces" aria-labelledby="connection-tab-workspaces"><StudioPanel active={connectionTab==='workspaces'} key={JSON.stringify(['studio', host.id, host.hostname, host.port, host.username, host.identityFile, host.knownHostsFile, host.ownerId, host.workspaceGeneration, host.role])} host={host} focusWorkspaceId={focusWorkspace} onSnapshot={value => setManaged(previous => ({ ...previous, [host.id]: value.workspaces }))} onConnected={importedHost} discovery={discovery?.hostId === host.id ? discovery : undefined} accountCatalog={state.accountCatalogs?.[host.id]} notify={notify} onDiscover={() => void discover(host)} discovering={discovering} /></div>}
          <div hidden={connectionTab !== 'accounts'} role="tabpanel" id="connection-panel-accounts" aria-labelledby="connection-tab-accounts"><ProviderAccounts key={JSON.stringify(['codex-login', host.id, host.hostname, host.port, host.username, host.identityFile, host.knownHostsFile, host.ownerId, host.workspaceGeneration, host.role])} host={host} active={connectionTab==='accounts'} cachedCatalog={state.accountCatalogs?.[host.id]} notify={notify} /></div>
          {host.role==='admin'&&connectionTab==='browser'&&<div role="tabpanel" id="connection-panel-browser" aria-labelledby="connection-tab-browser"><RemoteBrowserManager key={JSON.stringify(host)} host={host} notify={notify}/></div>}
          {host.role==='admin'&&connectionTab==='cli'&&<RemoteCliManager key={JSON.stringify(host)} host={host} notify={notify}/>}
          {host.role==='admin'&&connectionTab==='retention'&&<RemoteSessionRetention key={JSON.stringify(host)} host={host} notify={notify}/>}
          <div hidden={connectionTab !== 'details'} role="tabpanel" id="connection-panel-details" aria-labelledby="connection-tab-details">
          {host.role==='admin'&&connectionTab==='details'&&<RemoteResourcePanel key={JSON.stringify(host)} host={host} filesOpen={filesOpen} onFiles={()=>setRemoteFiles(value=>!value)} notify={notify}/>}
          <div className="connection-details-heading"><h3>SSH 连接</h3><button className="text-button" onClick={() => openEditor({ ...host })}>编辑连接</button></div>
          <dl className="detail-list"><div><dt>连接角色</dt><dd>{host.role === 'admin' ? '管理员' : '工作空间用户'}</dd></div><div><dt>本机私钥</dt><dd className="mono">{host.identityFile}</dd></div><div><dt>主机校验</dt><dd className="mono">{host.knownHostsFile}</dd></div><div><dt>主机身份策略</dt><dd>严格校验</dd></div></dl>
          <div className="connection-remove-row"><span>移除此设备保存的连接</span><button type="button" className="icon-button" data-testid="host-remove" aria-label="移除连接" title="移除连接" onClick={() => setRemoving(host)}><Icon name="trash" size={17}/></button></div>
          </div>
        </section>}
      </ConnectionLayout>}
    {removing && <Modal title="移除本机连接" dismissible={!removingBusy} onClose={() => setRemoving(null)}><p>移除「{removing.name}」？</p><p className="inline-note">仅移除此设备上的连接记录。远端空间、设备授权、本机密钥与历史会话保留。已有会话不能通过已移除的连接继续运行。</p><div className="modal-actions"><button className="button secondary" disabled={removingBusy} onClick={() => setRemoving(null)}>取消</button><button className="button primary" data-testid="host-remove-confirm" disabled={removingBusy} onClick={async () => { setRemovingBusy(true); try { await api('host/remove', { id: removing.id, confirm: true }); await refresh(); setManaged(previous => { const next = {...previous}; delete next[removing.id]; return next; }); setRemoving(null); notify('本机连接已移除。'); } catch (error) { report(error); } finally { setRemovingBusy(false); } }}>{removingBusy ? '正在移除…' : '确认移除'}</button></div></Modal>}
    {editing && <HostConnectionDialog key={editing.id||'new-connection'} host={editing} onChange={setEditing} onSave={save} onClose={closeEditor}/>}
  </div>;
}

const capabilityStatus = { implemented: '已实现 · 待实测', 'contract-tested': '协议 / 合同已测', unverified: '尚未验证', unsupported: '此阶段不支持' };
export function Capabilities({ report }: { report: (e: unknown) => void }) {
  const [items, setItems] = useState<Capability[] | null>(null); const [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); try { setItems(await api<Capability[]>('capabilities/get')); } catch (e) { report(e); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  return <div className="page capabilities-page"><div className="page-heading"><div><span className="eyebrow">EVIDENCE, NOT ASSUMPTIONS</span><h1>每项能力，都有自己的边界。</h1><p>本地协议测试、真实模型任务、远端出网与桌面验收不能互相替代。</p></div><button className="button secondary" disabled={loading} onClick={load}>{loading ? '读取中…' : '刷新状态'}</button></div><div className="acceptance-hero"><div className="large-icon"><Icon name="shield" size={29} /></div><div><span className="outline-label warning">H 原生执行链 · 尚未真实联验</span><h2>运行时在 VPS，工具在本机。<br />这条链路，必须真实证明。</h2><p>当前原生会话的提交入口保持阻断。离线示例只验证交互，不是 Claude 或 Codex 的真实执行。</p></div></div><div className="evidence-legend"><span><i className="legend-dot implemented" />代码已实现</span><span><i className="legend-dot contract-tested" />合同已测</span><span><i className="legend-dot unverified" />真实证据待补齐</span></div><div className="capability-list" data-testid="capability-list">{items?.map((item, index) => <article className="capability-row" key={item.id}><span className="capability-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{item.label}</h3><p>{item.detail}</p></div><span className={`capability-status ${item.status}`}>{capabilityStatus[item.status]}</span></article>)}{!loading && items?.length === 0 && <p className="inline-note">服务未返回能力清单；不推测支持状态。</p>}{!items && <p className="inline-note">{loading ? '正在读取可信服务的能力记录…' : '能力记录不可用，未生成示例通过状态。'}</p>}</div><footer className="acceptance-footer"><Icon name="terminal" size={18} /><p>原生运行时 ≠ 模型 provider ≠ 执行位置 ≠ 网络出口。<br /><span>任何一层为未知，都不会由另一层的绿色状态代替。</span></p></footer></div>;
}
