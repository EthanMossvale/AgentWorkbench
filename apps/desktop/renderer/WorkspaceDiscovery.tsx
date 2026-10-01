import {RememberedDetails} from './UiMemory';
import type { SshHost } from '../../../packages/contracts';
import type { DiscoveredWorkspace, RuntimeAccountStatus, RuntimeDiscovery, WorkspaceDiscovery } from '../../../services/host-control/discovery-types';
import { Icon } from './ui';
import './WorkspaceDiscovery.css';

interface WorkspaceDiscoveryProps {
  discovery: WorkspaceDiscovery;
  host: SshHost;
  hosts: SshHost[];
  copy: (text: string) => Promise<void>;
}

const observedTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const installLabels = { yes: '已发现 CLI', no: '未发现 CLI', unknown: 'CLI 状态未知' };
const accountLabels = { authenticated: '已登录 · 原生状态返回', unauthenticated: '未登录 · 原生状态返回', configured: '已配置 · 有效性未验证', unknown: '登录状态未知' };
const configLabels = { known: '已读取允许字段', absent: '未发现配置文件', unknown: '配置状态未知' };
const detailLabels: Record<string, string> = { email: '邮箱', name: '名称', plan: '订阅', authMethod: '认证方式', organization: '组织' };
const warningLabels: Record<string, string> = {
  'Legacy account catalog socket is missing; account binding is unknown.': '既有账号目录服务的连接端点不存在，本次无法读取账号绑定；不代表已有账号丢失。',
  'Workspace identity cannot access the legacy account catalog; account binding is unknown.': '当前工作空间身份无权读取既有账号目录，账号绑定状态未知。',
  'Legacy account catalog request timed out; account binding is unknown.': '读取既有账号目录超时，账号绑定状态未知。',
  'Legacy account catalog is unavailable.': '既有账号目录当前不可用，无法判断账号绑定状态。',
};
const warningText = (warning: string) => warningLabels[warning] ?? warning;

function AccountDetails({ title, account, broker = false, note }: { title: string; account: RuntimeAccountStatus; broker?: boolean; note?: string }) {
  const catalog = account.catalog ?? [];
  return <div className="workspace-runtime-section" data-testid={broker ? 'broker-account' : 'native-account'}><strong>{title}</strong><span className="workspace-status">{broker && account.status === 'unknown' ? '账号目录状态未知' : accountLabels[account.status]}</span>
    {account.source && <p className="workspace-source mono">来源：{account.source}</p>}
    {broker && <p className="inline-note">目录只反映已有账号配置；不代表原生 CLI 已登录，也未验证账号当前有效性。</p>}
    {note && <p className="inline-note">{note}</p>}
    {account.details && Object.keys(account.details).length > 0 && <dl className="workspace-facts">{Object.entries(account.details).map(([key, value]) => <div key={key}><dt>{detailLabels[key] ?? key}</dt><dd>{value}</dd></div>)}</dl>}
    {account.selectedId && <p className="inline-note">当前目录选择：<span className="mono">{account.selectedId}</span></p>}
    {catalog.length > 0 && <ul className="workspace-account-catalog">{catalog.map(item => <li key={item.id}><div><strong>{item.name ?? item.email ?? item.id}</strong>{item.selected && <span className="outline-label">目录当前选择</span>}</div><small className="mono">{item.id}</small>{item.email && <span>{item.email}</span>}{item.plan && <span>订阅：{item.plan}</span>}</li>)}</ul>}
    {account.status === 'unknown' && <p className="inline-note">{broker ? '未取得可确认的账号目录信息。' : '未取得可确认的原生登录状态；未知不表示未登录。'}</p>}
  </div>;
}

function RuntimeDetails({ name, runtime }: { name: string; runtime: RuntimeDiscovery }) {
  const hasBrokerCatalog = !!runtime.nativeAccount || (runtime.account.source?.startsWith('codex-device-broker:') ?? false);
  const brokerWarning = runtime.warnings.find(warning => /(?:Legacy account catalog|legacy account catalog)/.test(warning));
  return <section className="workspace-runtime" data-testid={`runtime-${name.toLowerCase()}`}>
    <div className="workspace-runtime-heading"><h4>{name}</h4><span className="outline-label">{installLabels[runtime.installed]}</span></div>
    <dl className="workspace-facts"><div><dt>可执行文件</dt><dd className="mono">{runtime.path ?? '未知'}</dd></div><div><dt>版本</dt><dd className="mono">{runtime.version ?? '未知'}</dd></div></dl>
    <div className="workspace-runtime-section"><strong>原生 CLI 配置</strong><span className="workspace-status">{configLabels[runtime.config.status]}</span>
      {runtime.config.source && <p className="workspace-source mono">来源：{runtime.config.source}</p>}
      {Object.keys(runtime.config.values).length > 0 ? <dl className="workspace-config">{Object.entries(runtime.config.values).map(([key, value]) => <div key={key}><dt className="mono">{key}</dt><dd className="mono">{String(value)}</dd></div>)}</dl> : <p className="inline-note">{runtime.config.status === 'known' ? '配置文件中没有返回可展示的允许字段。' : '未返回配置详情。'}</p>}
    </div>
    <AccountDetails title="CLI 原生登录状态" account={hasBrokerCatalog ? runtime.nativeAccount ?? { status: 'unknown' } : runtime.account} note={hasBrokerCatalog ? '此结果只反映原生 CLI 本次状态；既有工作空间账号目录的状态在下方单独显示。' : undefined} />
    {hasBrokerCatalog && <AccountDetails title="既有工作空间账号目录（Broker）" account={runtime.account} broker note={brokerWarning ? warningText(brokerWarning) : undefined} />}
    {runtime.warnings.length > 0 && <RememberedDetails memoryId="WorkspaceDiscovery.details.1" scope={name} className="workspace-evidence"><summary>运行时观测说明（{runtime.warnings.length}）</summary><ul>{runtime.warnings.map((warning, index) => <li key={index}>{warningText(warning)}</li>)}</ul></RememberedDetails>}
  </section>;
}

function WorkspaceCard({ workspace, host, hosts, copy }: { workspace: DiscoveredWorkspace; host: SshHost; hosts: SshHost[]; copy: WorkspaceDiscoveryProps['copy'] }) {
  const linked = hosts.find(item => item.role === 'workspace' && item.hostname.toLowerCase() === host.hostname.toLowerCase() && item.port === host.port && item.username === workspace.username && !!item.identityFile);
  const copyConnection = () => copy([
    `工作空间：${workspace.name}`,
    `主机：${host.hostname}`,
    `端口：${host.port}`,
    `SSH 用户：${workspace.username}`,
    `工作目录：${workspace.root}`,
    `连接命令：ssh -p ${host.port} ${workspace.username}@${host.hostname}`,
    ...workspace.ssh.authorizedKeys.map(key => `授权公钥指纹：${key.fingerprint}`),
    '此信息不包含私钥；连接时需使用此工作空间对应的私钥并校验主机指纹。',
  ].join('\n'));
  return <article className="workspace-discovery-card" data-testid={`workspace-${workspace.id}`}>
    <div className="workspace-card-heading"><div><h3>{workspace.name}</h3><p className="mono">{workspace.username} · UID {workspace.uid}</p></div><span className={`outline-label ${workspace.confidence === 'conflict' ? 'warning' : ''}`}>{workspace.confidence === 'conflict' ? '来源存在冲突' : '已识别工作空间'}</span></div>
    <dl className="workspace-facts"><div><dt>工作目录</dt><dd className="mono">{workspace.root}</dd></div><div><dt>用户主目录</dt><dd className="mono">{workspace.home}</dd></div><div><dt>识别来源</dt><dd>{workspace.sources.map(source => <span className="workspace-source mono" key={source}>{source}</span>)}</dd></div></dl>
    <section className="workspace-ssh"><div className="workspace-runtime-heading"><h4>工作空间 SSH</h4><button type="button" className="button secondary compact-button" data-testid={`copy-workspace-${workspace.id}`} onClick={copyConnection}><Icon name="copy" size={13} />复制连接信息</button></div>
      <p className="mono">{workspace.username}@{host.hostname}:{host.port}</p>
      <p className="workspace-key-status" data-testid={`workspace-key-${workspace.id}`}>{linked ? `本机已关联工作空间私钥路径 · ${linked.name}。此处仅确认已保存关联，SSH 登录状态未在本次识别中验证。` : '尚未关联此工作空间的本机私钥。管理员私钥不会自动用于工作空间登录。'}</p>
      {workspace.ssh.authorizedKeys.length > 0 ? <ul className="workspace-public-keys">{workspace.ssh.authorizedKeys.map((key, index) => <li key={`${key.fingerprint}-${index}`}><strong className="mono">{key.fingerprint}</strong><span>{key.algorithm}{key.comment ? ` · ${key.comment}` : ''}</span><small className="mono">来源：{key.source}</small></li>)}</ul> : <p className="inline-note">{workspace.ssh.authorizationStatus === 'absent' ? '未发现已授权公钥。' : workspace.ssh.authorizationStatus === 'present' ? '已发现授权文件，但未返回可解析的公钥指纹。' : '公钥授权状态未知。'}</p>}
      <p className="inline-note">服务器上的授权公钥不能还原为可分发私钥；此处只展示公钥指纹和连接信息。</p>
    </section>
    <div className="workspace-runtimes"><RuntimeDetails name="Codex" runtime={workspace.runtimes.codex} /><RuntimeDetails name="Claude" runtime={workspace.runtimes.claude} /></div>
    {workspace.warnings.length > 0 && <RememberedDetails memoryId="WorkspaceDiscovery.details.2" scope={JSON.stringify([host.id,workspace.username])} className="workspace-evidence"><summary>工作空间观测说明（{workspace.warnings.length}）</summary><ul>{workspace.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></RememberedDetails>}
  </article>;
}

export function WorkspaceDiscoveryView({ discovery, host, hosts, copy }: WorkspaceDiscoveryProps) {
  const workspaces = discovery.workspaces;
  const unmapped = discovery.accounts.filter(account => !workspaces.some(workspace => workspace.username === account.username));
  return <section className="discovery workspace-discovery" data-testid="workspace-discovery"><div className="section-heading"><div><h3>已识别 {workspaces.length} 个工作空间</h3><p>观测 {observedTime(discovery.observedAt)} · 有效 UID {discovery.effectiveUid} · {discovery.privilege === 'root' ? '已验证管理员身份' : '当前用户范围'}</p></div><span className="outline-label">只读观测</span></div>
    {workspaces.length > 0 ? <div className="workspace-discovery-list">{workspaces.map(workspace => <WorkspaceCard key={workspace.id} workspace={workspace} host={host} hosts={hosts} copy={copy} />)}</div> : <div className="profile-empty">这次观测没有取得可识别的工作空间记录。已有 Linux 用户或不可访问的登记表不等于没有工作空间。</div>}
    {unmapped.length > 0 && <RememberedDetails memoryId="WorkspaceDiscovery.details.3" scope={host.id} className="workspace-evidence"><summary>其他 Linux 账号（{unmapped.length}）</summary><p className="inline-note">以下账号未与工作空间记录对应，不自动接管或创建工作空间。</p>{unmapped.map(account => <div className="discovered-account" key={account.username}><strong>{account.username}</strong><span className="mono">{account.home}</span><small>UID {account.uid} · 工作空间归属未映射</small></div>)}</RememberedDetails>}
    <RememberedDetails memoryId="WorkspaceDiscovery.details.4" scope={host.id} className="workspace-evidence"><summary>连接身份与识别证据</summary><p>登记表：{discovery.registry === 'recognized' ? '已识别已有记录' : discovery.registry === 'present-unread' ? '存在但未读取' : '不存在或不可访问'}。</p>{discovery.publicKeyFingerprints.length > 0 && <><p>当前连接身份的授权公钥指纹：</p>{discovery.publicKeyFingerprints.map(fingerprint => <p className="mono" key={fingerprint}>{fingerprint}</p>)}</>}<ul>{discovery.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></RememberedDetails>
  </section>;
}
