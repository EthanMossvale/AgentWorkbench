import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LocalModelAccount } from '../../../packages/model-management/types';
import type { AccountExportFormat, AccountExportFormatId, AccountExportPreview, AccountExportResult } from '../../../packages/model-management/account-export-types';
import { api } from './App';
import { Icon, Modal, errorText } from './ui';
import './AccountExport.css';

const errors: Record<string, string> = {
  ACCOUNT_EXPORT_CREDENTIALS_MISSING: '此账号没有可导出的原生凭据文件。请先完成登录；系统钥匙串中的凭据不会被读取。',
  ACCOUNT_EXPORT_CREDENTIALS_INVALID: '此账号的原生凭据文件无法识别，请先核实登录状态。',
  ACCOUNT_EXPORT_FORMAT_UNSUPPORTED: '此凭据类型不支持当前格式，请选择官方格式保留原始结构。',
  ACCOUNT_EXPORT_FORMAT_UNAVAILABLE: '所选格式已停用。选择仍保留，可切换官方格式，或在插件重新启用后重试。',
  ACCOUNT_EXPORT_DESTINATION_PROTECTED: '请选择工作台资料目录以外的导出位置。',
  LOCAL_ACCOUNT_CHANGED: '账号已更新，请关闭并重新打开导出窗口。',
  LOCAL_ACCOUNT_NOT_FOUND: '账号已移除，请关闭导出窗口。',
  ACCOUNT_EXPORT_SAVE_FAILED: '文件未保存，请检查目标位置后重试。',
  ACCOUNT_EXPORT_COPY_FAILED: '复制未完成，请重试。',
  ACCOUNT_EXPORT_SAVE_UNAVAILABLE: '当前环境未提供文件保存窗口。',
};
const message = (error: unknown) => { const code = errorText(error); return Object.entries(errors).find(([key]) => code.endsWith(key))?.[1] ?? '导出未完成，请重试或选择官方格式。'; };
function Eye({ hidden }: { hidden: boolean }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{hidden && <path d="m4 3 16 18"/>}</svg>;
}
function ExportDialog({ account, close }: { account: LocalModelAccount; close(): void }) {
  const selectId = useId();
  const [formats, setFormats] = useState<AccountExportFormat[]>([]), [formatId, setFormatId] = useState<AccountExportFormatId>('official');
  const [preview, setPreview] = useState<AccountExportPreview>(), [reveal, setReveal] = useState(false), [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true), [action, setAction] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const live = useRef(false), lock = useRef(false), serial = useRef(0);
  const request = { id: account.id, revision: account.revision, formatId };
  useEffect(() => { live.current = true; return () => { live.current = false; serial.current++; }; }, []);
  useEffect(() => {
    let current = true;
    const refreshFormats = () => { void api<AccountExportFormat[]>('models/accounts/export-formats', { id: account.id, revision: account.revision }).then(value => { if (current) setFormats(old => JSON.stringify(old) === JSON.stringify(value) ? old : value); }, reason => { if (current) { setPreview(undefined); setError(message(reason)); } }); };
    refreshFormats(); const timer = setInterval(refreshFormats, 1500);
    return () => { current = false; clearInterval(timer); };
  }, [account.id, account.revision]);
  useEffect(() => {
    const epoch = ++serial.current; setPreview(undefined); setLoading(true); setError(''); setNotice('');
    void api<AccountExportPreview>('models/accounts/export-preview', { ...request, reveal }).then(value => { if (live.current && serial.current === epoch) setPreview(value); }, reason => { if (live.current && serial.current === epoch) setError(message(reason)); }).finally(() => { if (live.current && serial.current === epoch) setLoading(false); });
    return () => { serial.current++; };
  }, [account.id, account.revision, formatId, reveal, version, formats]);
  const perform = async (kind: 'copy' | 'save') => {
    if (lock.current) return; lock.current = true; setAction(kind); setError(''); setNotice('');
    try { const result = await api<AccountExportResult>('models/accounts/export-' + kind, request); if (live.current) setNotice(result.status === 'copied' ? '已复制完整 JSON' : result.status === 'saved' ? '文件已保存' : '已取消保存'); }
    catch (reason) { if (live.current) setError(message(reason)); }
    finally { lock.current = false; if (live.current) setAction(''); }
  };
  const selected = formats.find(format => format.id === formatId), busy = !!action;
  return <Modal title="导出账号" subtitle={account.name + ' · ' + (account.provider === 'codex' ? 'Codex' : 'Claude')} className="account-export-modal" dismissible={!busy} onClose={close}>
    <div className="account-export" data-workbench-account-export data-account-id={account.id} data-provider={account.provider} data-format-id={formatId}>
      <div className="account-export-format"><label htmlFor={selectId}>导出格式</label><select id={selectId} value={formatId} disabled={busy} onChange={event => { serial.current++; setPreview(undefined); setReveal(false); setNotice(''); setFormatId(event.target.value as AccountExportFormatId); }}>
        {!selected && <option value={formatId}>{formatId === 'official' ? '官方' : formatId + '（已停用）'}</option>}{formats.map(format => <option key={format.id} value={format.id}>{format.label}</option>)}
      </select><span>{preview?.fileName ?? 'JSON'}</span></div>
      <p className="account-export-description">{selected?.description ?? '读取可用格式…'}</p>
      <div className="account-export-preview"><div className="account-export-preview-heading"><span>JSON 预览 <small>{reveal ? '完整内容' : '敏感内容已隐藏'}</small></span><button type="button" className="text-button" disabled={loading || busy || !preview} aria-pressed={reveal} onClick={() => { serial.current++; setPreview(undefined); setReveal(value => !value); }}><Eye hidden={reveal}/>{reveal ? '隐藏' : '显示'}</button></div>
        <pre tabIndex={0} aria-label="账号导出 JSON" aria-busy={loading}>{loading ? '正在读取…' : preview?.content ?? '暂无可预览内容'}</pre>
      </div>
      <p className="account-export-note">复制和下载包含完整登录凭据，请妥善保管。</p>
      {error && <p className="inline-error" role="alert">{error}<button type="button" className="text-button" disabled={busy} onClick={() => setVersion(value => value + 1)}>重试</button></p>}
      <div className="account-export-result" role="status">{notice}</div>
      <footer className="modal-actions"><button className="button secondary" disabled={loading || busy || !preview || !selected} onClick={() => void perform('copy')}><Icon name="copy" size={15}/>{action === 'copy' ? '复制中…' : '复制'}</button><button className="button primary" disabled={loading || busy || !preview || !selected} onClick={() => void perform('save')}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v6h14v-6"/></svg>{action === 'save' ? '保存中…' : '下载 JSON'}</button></footer>
    </div>
  </Modal>;
}
export default function AccountExport({ account }: { account: LocalModelAccount }) {
  const [open, setOpen] = useState(false);
  return <><span className="account-export-trigger" data-workbench-account-export-trigger data-account-id={account.id} data-provider={account.provider}><button type="button" className="icon-button" aria-label={'导出 ' + account.name} title="导出账号" onClick={() => setOpen(true)}><Icon name="export" size={15}/></button></span>{open && createPortal(<ExportDialog account={account} close={() => setOpen(false)}/>, document.body)}</>;
}
