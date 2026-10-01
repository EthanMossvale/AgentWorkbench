import { usableSharedAccount } from '../../../packages/account-selection';
import { useEffect, useRef, useState } from 'react';
import type { AccountCatalog, SshHost } from '../../../packages/contracts';
import type { CodexAuthJob } from '../../../packages/remote-codex-auth';
import { api } from './App';
import { Icon, Modal, errorText } from './ui';
import './CodexLogin.css';
import RemoteAccountCard from './RemoteAccountCard';
import NativeAccountState from './NativeAccountState';

interface Props { host: SshHost; cachedCatalog?: AccountCatalog; notify: (message: string) => void }
const activeStates = new Set<CodexAuthJob['state']>(['preparing', 'awaiting-code', 'verifying']);
const officialVerificationUrl = 'https://auth.openai.com/codex/device';
const labels: Record<CodexAuthJob['state'], string> = {
  preparing: '正在准备远端登录', 'awaiting-code': '等待你在官方网页输入代码', verifying: '正在核实原生登录结果',
  authenticated: '共享账号授权已完成', cancelled: '本次登录等待已取消', expired: '本次授权等待已超时', failed: '本次登录未完成',
};
const cleanupLabels: Record<CodexAuthJob['cleanup'], string> = { pending: '远端登录进程正在清理', confirmed: '远端登录进程清理已确认', unconfirmed: '尚未确认远端登录进程已清理' };
const observationTime = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '未知';

export default function CodexLogin({ host, cachedCatalog, notify }: Props) {
  const [job, setJob] = useState<CodexAuthJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState<AccountCatalog | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [readingCatalog, setReadingCatalog] = useState(false);
  const [selectingAccount, setSelectingAccount] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [loginOpen, setLoginOpen] = useState(false);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const actionEpoch = useRef(0);
  const catalogEpoch = useRef(0);
  const catalogRef = useRef<AccountCatalog | null>(null);
  const jobRef = useRef<CodexAuthJob | null>(null);
  const startingRef = useRef(false);
  const cancellingRef = useRef(false);
  const readingCatalogRef = useRef(false);
  const selectingAccountRef = useRef(false);
  const restoringRef = useRef(false);
  const restoreFailedRef = useRef(false);
  const requestedCancellations = useRef(new Set<string>());
  const refreshedJobs = useRef(new Set<string>());
  const running = !!job && activeStates.has(job.state);
  const needsStatus = running || job?.cleanup === 'pending';
  const apply = (value: CodexAuthJob) => { jobRef.current = value; setJob(value); setNow(Date.now()); };
  const applyCatalog = (value: AccountCatalog) => {
    if (!value || !['ready', 'unavailable'].includes(value.availability) || !Array.isArray(value.accounts)) throw new Error('共享账号目录返回了无效状态。');
    const codex={...value,accounts:value.accounts.filter(account=>account.provider==='codex')};
    catalogRef.current = codex; setCatalog(codex); setSelectedAccountId(value.selectedAccountId ?? '');
  };
  const catalogBusy = () => restoringRef.current || restoreFailedRef.current || startingRef.current || cancellingRef.current || readingCatalogRef.current || selectingAccountRef.current || !!jobRef.current && (activeStates.has(jobRef.current.state) || jobRef.current.cleanup !== 'confirmed');
  const cachedCatalogKey = JSON.stringify(cachedCatalog);
  useEffect(() => { if (cachedCatalog && !readingCatalogRef.current && !selectingAccountRef.current) applyCatalog(cachedCatalog); }, [cachedCatalogKey]);
  const bound = (value: CodexAuthJob, expectedJobId?: string) => {
    if (value.hostId !== host.id || (expectedJobId && value.jobId !== expectedJobId)) throw new Error('登录结果与当前连接不匹配，已停止显示该结果。');
    if (!value.jobId || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error('登录任务返回了无效状态，请重新发起。');
    return value;
  };
  const abandon = (value: CodexAuthJob) => {
    if (!activeStates.has(value.state) || requestedCancellations.current.has(value.jobId)) return;
    requestedCancellations.current.add(value.jobId);
    void api('codex-auth/cancel', { id: host.id, jobId: value.jobId }).catch(() => { /* No stale UI updates after leaving this connection. */ });
  };
  const recover = async () => {
    if (restoringRef.current) return;
    const currentEpoch = ++epoch.current;
    const current = () => mounted.current && currentEpoch === epoch.current;
    restoringRef.current = true; restoreFailedRef.current = false; setRestoring(true); setRestoreFailed(false); setError('');
    try {
      const result = await api<CodexAuthJob | null>('codex-auth/current', { id: host.id });
      if (!current()) { if (result) abandon(bound(result)); return; }
      if (result) {apply(bound(result));if(activeStates.has(result.state)||result.cleanup!=='confirmed')setLoginOpen(true);} else { jobRef.current = null; setJob(null); }
    } catch (e) { if (current()) { restoreFailedRef.current = true; setRestoreFailed(true); setError(`上次授权状态尚未恢复：${errorText(e)}`); } }
    finally { if (current()) { restoringRef.current = false; setRestoring(false); } }
  };
  useEffect(() => {
    mounted.current = true; void recover();
    return () => { mounted.current = false; restoringRef.current = false; epoch.current++; actionEpoch.current++; catalogEpoch.current++; if (jobRef.current) abandon(jobRef.current); };
  }, []);

  const start = async () => {
    if (host.role !== 'admin' || catalogRef.current?.availability !== 'ready' || catalogBusy()) return;
    setLoginOpen(true);
    const currentEpoch = ++epoch.current;
    const current = () => mounted.current && currentEpoch === epoch.current;
    startingRef.current = true; setStarting(true); setError('');
    try {
      const result = bound(await api<CodexAuthJob>('codex-auth/start', { id: host.id }));
      if (!current()) { abandon(result); return; }
      apply(result);
    } catch (e) { if (current()) setError(errorText(e)); }
    finally { startingRef.current = false; if (current()) setStarting(false); }
  };

  const readCatalog = async () => {
    if (catalogBusy()) return;
    const currentEpoch = ++catalogEpoch.current;
    const current = () => mounted.current && currentEpoch === catalogEpoch.current;
    readingCatalogRef.current = true; setReadingCatalog(true); setError('');
    try {
      const result = await api<AccountCatalog>('accounts/list', { id: host.id });
      if (!current()) return;
      applyCatalog(result);
    } catch (e) { if (current()) { catalogRef.current = null; setCatalog(null); setSelectedAccountId(''); setError(`共享账号目录读取未完成：${errorText(e)}`); } }
    finally { readingCatalogRef.current = false; if (current()) setReadingCatalog(false); }
  };

  const selectAccount = async () => {
    const source = catalogRef.current;
    if (host.role !== 'workspace' || !source || source.availability !== 'ready' || catalogBusy() || !source.accounts.some(account => account.id === selectedAccountId && usableSharedAccount(account)) || selectedAccountId === source.selectedAccountId) return;
    const accountId = selectedAccountId;
    const currentEpoch = ++catalogEpoch.current;
    const current = () => mounted.current && currentEpoch === catalogEpoch.current;
    selectingAccountRef.current = true; setSelectingAccount(true); setError('');
    try {
      const result = await api<AccountCatalog>('accounts/select', { id: host.id, accountId, expectedRevision: source.selectionRevision });
      if (!current()) return;
      if (result.authorityId !== source.authorityId || result.generation !== source.generation || result.workspaceId !== source.workspaceId || result.selectedAccountId !== accountId) throw new Error('账号选择结果与当前工作空间不匹配，请刷新目录。');
      applyCatalog(result); notify('已保存此工作空间的默认 Codex 账号。');
    } catch (e) { if (current()) { catalogRef.current = null; setCatalog(null); setSelectedAccountId(''); setError(`账号选择未确认：${errorText(e)}。请刷新目录后重试。`); } }
    finally { selectingAccountRef.current = false; if (current()) setSelectingAccount(false); }
  };

  const cancel = async (expired = false) => {
    const target = jobRef.current;
    if (!target || cancellingRef.current) return;
    const currentEpoch = ++epoch.current;
    actionEpoch.current++;
    const current = () => mounted.current && currentEpoch === epoch.current && jobRef.current?.jobId === target.jobId;
    cancellingRef.current = true; setCancelling(true); setAction(''); setError('');
    requestedCancellations.current.add(target.jobId);
    if (expired) apply({ ...target, state: 'expired', userCode: undefined, verificationUrl: undefined, cleanup: 'pending' });
    try {
      const result = bound(await api<CodexAuthJob>('codex-auth/cancel', { id: host.id, jobId: target.jobId }), target.jobId);
      if (!current()) return;
      apply(expired && result.state === 'cancelled' ? { ...result, state: 'expired' } : result);
    } catch (e) {
      requestedCancellations.current.delete(target.jobId);
      if (current()) { apply({ ...jobRef.current!, cleanup: 'unconfirmed' }); setError(`取消结果未确认：${errorText(e)}`); }
    } finally { cancellingRef.current = false; if (current()) setCancelling(false); }
  };

  useEffect(() => {
    if (!job?.jobId || !needsStatus || cancelling) return;
    const jobId = job.jobId;
    const currentEpoch = epoch.current;
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const current = () => !stopped && mounted.current && currentEpoch === epoch.current && jobRef.current?.jobId === jobId;
    const poll = async () => {
      try {
        const result = bound(await api<CodexAuthJob>('codex-auth/status', { id: host.id, jobId }), jobId);
        if (!current()) return;
        apply(result); setError('');
        if (activeStates.has(result.state) || result.cleanup === 'pending') timeout = setTimeout(poll, 1500);
      } catch (e) {
        if (!current()) return;
        setError(`暂时无法读取登录状态：${errorText(e)}`);
        timeout = setTimeout(poll, 3000);
      }
    };
    timeout = setTimeout(poll, 750);
    return () => { stopped = true; if (timeout) clearTimeout(timeout); };
  }, [job?.jobId, needsStatus, cancelling]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (job && running && !cancelling && Date.parse(job.expiresAt) <= now) void cancel(true);
  }, [job?.expiresAt, running, cancelling, now]);
  useEffect(() => {
    if (job?.state !== 'authenticated' || job.cleanup !== 'confirmed' || refreshedJobs.current.has(job.jobId)) return;
    refreshedJobs.current.add(job.jobId); void readCatalog();
  }, [job?.jobId, job?.state, job?.cleanup]);

  const codeReady = job?.state === 'awaiting-code' && !!job.userCode && job.verificationUrl === officialVerificationUrl && Date.parse(job.expiresAt) > now && !cancelling;
  const codeAction = async (kind: 'copy-code' | 'copy-url' | 'open') => {
    const target = jobRef.current;
    if (!target || target.state !== 'awaiting-code' || target.verificationUrl !== officialVerificationUrl || !target.userCode || Date.parse(target.expiresAt) <= Date.now() || cancellingRef.current || action) return;
    const currentEpoch = epoch.current;
    const requestEpoch = ++actionEpoch.current;
    const current = () => mounted.current && epoch.current === currentEpoch && actionEpoch.current === requestEpoch && jobRef.current?.jobId === target.jobId;
    setAction(kind); setError('');
    try {
      if (kind === 'open') await api('codex-auth/open', { id: host.id, jobId: target.jobId });
      else await api('clipboard/write', { text: kind === 'copy-code' ? target.userCode : target.verificationUrl });
      if (current()) notify(kind === 'open' ? '已请求在系统浏览器打开官方授权页。' : kind === 'copy-code' ? '本次设备代码已复制。' : '官方授权地址已复制。');
    } catch (e) { if (current()) setError(errorText(e)); }
    finally { if (current()) setAction(''); }
  };
  const remaining = job ? Math.max(0, Math.ceil((Date.parse(job.expiresAt) - now) / 1000)) : 0;
  const busy = restoring || restoreFailed || starting || cancelling || readingCatalog || selectingAccount || running || !!job && job.cleanup !== 'confirmed';
  const catalogReady = catalog?.availability === 'ready';
  const selectedAccount = catalog?.accounts.find(account => account.id === selectedAccountId);

  return <section className="codex-login" data-testid="codex-login">
    <div className="section-heading"><div><h3>Codex 账号</h3></div><Icon name="shield" size={19} /></div>

    <div className="codex-catalog-actions"><button type="button" data-testid="accounts-refresh" className="button secondary compact-button" disabled={busy} onClick={readCatalog}>{readingCatalog ? '读取中…' : catalog ? '刷新账号' : '读取账号'}</button></div>

    {catalog && <div className="codex-account-catalog" data-testid="accounts-catalog" data-availability={catalog.availability}>
      {catalog.availability === 'unavailable' ? <div className="callout warning"><strong>共享账号服务不可用</strong><p>当前不能添加或选择账号。请先在此 VPS 配置共享账号服务，再刷新目录。</p>{catalog.reason && <p className="inline-note">{catalog.reason}</p>}</div> : <>
        <div className="codex-catalog-heading"><h4>{host.role === 'workspace' ? '默认账号' : '账号'}</h4><span>{catalog.accounts.length} 个账号</span></div>
        {!catalog.accounts.length ? <p className="inline-note">{host.role === 'admin' ? '暂无账号，可在下方添加。' : '暂无可用账号，请联系管理员分配。'}</p> : <div className="model-account-list" role={host.role==='workspace'?'radiogroup':'list'} aria-label={host.role==='workspace'?'工作空间默认 Codex 账号':'VPS 共享 Codex 账号'}>{catalog.accounts.filter(a=>a.status==='authenticated'||a.status==='configured').map(account=><RemoteAccountCard key={account.id+':'+account.generation} host={host} catalog={catalog} account={account} notify={notify} controls={host.role==='workspace'?<input type="radio" id={'workspace-account-'+host.id+'-'+account.id} name={'workspace-account-'+host.id} data-testid={'account-option-'+account.id} aria-label={account.displayName??account.email??account.id} value={account.id} checked={selectedAccountId===account.id} disabled={catalog.source!=='native-owner'||busy||!usableSharedAccount(account)} onChange={()=>setSelectedAccountId(account.id)}/>:undefined}/>)}</div>}
        {catalog.accounts.some(a=>!['authenticated','configured'].includes(a.status))&&<div className="account-pending-list"><h4>待完成登录</h4>{catalog.accounts.filter(a=>!['authenticated','configured'].includes(a.status)).map(account=><div key={account.id}><span>{account.displayName??'Codex 待登录账号'}</span>{catalog.source==='native-owner'&&<NativeAccountState host={host} account={account} notify={notify}/>}</div>)}</div>}
        {host.role === 'workspace' && catalog.source==='native-owner' && <div className="codex-catalog-selection"><button type="button" data-testid="accounts-select" className="button primary compact-button" disabled={busy || !usableSharedAccount(selectedAccount) || selectedAccountId === catalog.selectedAccountId} onClick={selectAccount}>{selectingAccount ? '正在保存选择…' : '保存此工作空间的默认账号'}</button>{!catalog.selectedAccountId && <span className="inline-note">此工作空间尚未选择默认账号。</span>}</div>}
      </>}
    </div>}

    {catalog?.source==='existing-codex'&&<p className="inline-note">此旧目录仅供迁移核对。请在原生账号服务中完成接入，并在工作空间管理页统一分配使用权。</p>}
    {job?.state === 'authenticated' && job.cleanup === 'confirmed' && <p className="inline-note">登录已完成，刷新后的官方账号会直接显示在上方账号卡片中。</p>}
    {restoreFailed && !loginOpen && <button className="text-button" onClick={()=>{setLoginOpen(true);void recover();}}>重试恢复登录状态</button>}
    {error && !loginOpen && <p className="inline-error" data-testid="codex-auth-error" role="alert">{error}</p>}
    <div className="codex-login-actions">{host.role === 'admin' && !running && <button type="button" data-testid="codex-auth-start" className="button secondary" disabled={!catalogReady || catalog?.source === 'existing-codex' || busy} onClick={() => void start()}>{starting ? '正在发起…' : job && job.state !== 'authenticated' ? '重新登录 Codex' : '登录 Codex'}</button>}{running && <button type="button" data-testid="codex-auth-cancel" className="button secondary" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? '正在取消…' : '取消本次登录'}</button>}{job && !running && job.cleanup === 'unconfirmed' && <button type="button" data-testid="codex-auth-retry-cleanup" className="button secondary" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? '正在确认清理…' : '重试取消清理'}</button>}</div>
    {loginOpen && <Modal className="model-account-login" title="远端 Codex 登录" subtitle="登录成功后才会刷新账号卡片；取消或失败不会新增账号槽。" dismissible={!starting && !cancelling} onClose={() => {if(running||job?.cleanup!=='confirmed'&&job)void cancel();else setLoginOpen(false);}}><div className="account-setup-content">
      {restoring && <p className="inline-note" data-testid="codex-auth-restoring" role="status">正在恢复上次授权状态…</p>}
      {job && <div className={`codex-login-state ${job.state}`} data-testid="codex-auth-state" data-state={job.state} role="status"><strong>{labels[job.state]}</strong>{running && <span>剩余约 {Math.floor(remaining / 60)} 分 {remaining % 60} 秒</span>}</div>}
      {codeReady && <div className="codex-device-code" data-testid="codex-device-code"><div className="codex-code-value"><span>设备代码</span><strong data-testid="codex-user-code">{job.userCode}</strong><button type="button" data-testid="codex-copy-code" className="button secondary compact-button" disabled={!!action} onClick={() => void codeAction('copy-code')}><Icon name="copy" size={13} />复制代码</button></div><p className="mono" data-testid="codex-verification-url">{job.verificationUrl}</p><div className="codex-code-actions"><button type="button" data-testid="codex-open-auth" className="button primary" disabled={!!action} onClick={() => void codeAction('open')}><Icon name="globe" size={14} />打开官方授权页</button><button type="button" data-testid="codex-copy-url" className="button secondary" disabled={!!action} onClick={() => void codeAction('copy-url')}>复制地址</button></div><p className="inline-note">仅在你主动打开的官方网页中输入此代码；不要将代码发给他人。</p></div>}
      {job?.state === 'verifying' && <p className="inline-note">网页授权已结束，正在核实远端原生账号状态。</p>}
      {job?.error && <p className="inline-error" role="alert">{job.error}</p>}
      {error && <p className="inline-error" data-testid="codex-auth-error" role="alert">{error}</p>}
      {restoreFailed && <button type="button" data-testid="codex-auth-recover" className="button secondary compact-button" onClick={() => void recover()}>重试恢复上次授权状态</button>}
      {job && !running && <p className={`codex-cleanup ${job.cleanup}`} data-testid="codex-auth-cleanup">{cleanupLabels[job.cleanup]}</p>}
      <div className="modal-actions">{running && <button type="button" data-testid="codex-auth-cancel-modal" className="button secondary" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? '正在取消…' : '取消本次登录'}</button>}{job && !running && job.cleanup === 'unconfirmed' && <button type="button" data-testid="codex-auth-retry-cleanup-modal" className="button secondary" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? '正在确认清理…' : '重试取消清理'}</button>}{!running && job?.cleanup === 'confirmed' && <button type="button" className="button primary" onClick={() => setLoginOpen(false)}>关闭</button>}</div>
    </div></Modal>}
  </section>;
}
