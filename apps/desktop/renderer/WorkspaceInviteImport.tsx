import { useEffect, useRef, useState } from 'react';
import type { SshHost } from '../../../packages/contracts';
import type { WorkspaceImportPreview } from '../../../packages/workspace-control/types';
import type { PreparedWorkspaceHost } from '../host/workspace-management';
import { api } from './App';
import { Field, Icon, Modal, errorText } from './ui';
import './WorkspaceInviteImport.css';
import {ConnectionAddress,useConnectionAddressHidden} from './ConnectionAddress';

interface Props { onImported: (host: SshHost) => void; notify: (message: string) => void }
type Pending = 'preview' | 'import' | null;

// Keep only the public preview fields; invitations and device keys stay in the host.
function publicPreview(value: WorkspaceImportPreview): WorkspaceImportPreview {
  const keys = ['previewId', 'workspaceName', 'username', 'hostname', 'expiresAt', 'workspaceId', 'enrollmentUrl'] as const;
  if (!value || keys.some(key => typeof value[key] !== 'string' || !value[key].trim()) || typeof value.authorityId !== 'string' || (!value.authorityId && value.transport !== 'ssh') || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || !Number.isFinite(Date.parse(value.expiresAt))) {
    throw new Error('工作空间预览返回了无效信息，请重新选择文件。');
  }
  return { previewId: value.previewId, workspaceName: value.workspaceName, username: value.username, hostname: value.hostname, port: value.port, expiresAt: value.expiresAt, authorityId: value.authorityId, workspaceId: value.workspaceId, enrollmentUrl: value.enrollmentUrl, resumeExistingDevice: value.resumeExistingDevice === true, ...(value.transport === 'ssh' ? {transport:'ssh'} : {}) };
}

export default function WorkspaceInviteImport({ onImported, notify }: Props) {
  const hideAddress=useConnectionAddressHidden();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<WorkspaceImportPreview | null>(null);
  const [deviceLabel, setDeviceLabel] = useState('本机设备');
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState('');
  const [imported, setImported] = useState<PreparedWorkspaceHost | null>(null);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const pendingRef = useRef<Pending>(null);
  const previewRef = useRef<WorkspaceImportPreview | null>(null);
  const labelRef = useRef('本机设备');
  const labelInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open && preview && !pending) labelInput.current?.focus(); }, [open, preview?.previewId, pending]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; epoch.current++; previewRef.current = null; pendingRef.current = null; };
  }, []);

  const close = () => {
    epoch.current++; previewRef.current = null; pendingRef.current = null; labelRef.current = '本机设备';
    setOpen(false); setPreview(null); setPending(null); setDeviceLabel('本机设备'); setError(''); setImported(null);
  };
  const choose = async () => {
    if (pendingRef.current) return;
    const request = ++epoch.current;
    const current = () => mounted.current && epoch.current === request;
    previewRef.current = null; pendingRef.current = 'preview'; labelRef.current = '本机设备';
    setOpen(true); setPreview(null); setPending('preview'); setDeviceLabel('本机设备'); setError(''); setImported(null);
    try {
      const result = await api<WorkspaceImportPreview | null>('studio/import-preview', {});
      if (!current()) return;
      if (result === null) { close(); return; }
      const value = publicPreview(result);
      previewRef.current = value; setPreview(value);
    } catch (cause) { if (current()) setError(errorText(cause)); }
    finally { if (current()) { pendingRef.current = null; setPending(null); } }
  };
  const confirm = async () => {
    const source = previewRef.current;
    const label = labelRef.current.trim();
    if (!source || pendingRef.current || !label || label.length > 100) return;
    const request = ++epoch.current;
    const current = () => mounted.current && epoch.current === request && previewRef.current?.previewId === source.previewId;
    pendingRef.current = 'import'; setPending('import'); setError('');
    try {
      const host = imported
        ? await api<PreparedWorkspaceHost>('studio/prepare', { id: imported.id, confirm: true })
        : await api<PreparedWorkspaceHost>('studio/import', { previewId: source.previewId, confirm: true, deviceLabel: label });
      if (!current()) return;
      if (!host || host.role !== 'workspace' || typeof host.id !== 'string' || !host.id || typeof host.hostname !== 'string' || host.hostname.trim().toLowerCase() !== source.hostname.trim().toLowerCase() || host.port !== source.port || host.username !== source.username || (host.authorityId ?? '') !== source.authorityId || host.remoteWorkspaceId !== source.workspaceId) throw new Error('导入结果与预览的成员连接不一致，请重新核实。');
      if (!imported) onImported(host);
      if (host.preparation?.ready === false) {
        setImported(host);
        const reasons = {catalog:'请管理员检查远端配置及工作空间授权。',account:'请管理员为此工作空间分配并选择可用的 Claude 账号。',runtime:'本机官方工具准备未完成；请检查安装条件，空闲后重试。',bridge:'请管理员核实远端 Claude 运行时、模型目录和工作台配置版本。',changed:'连接已变化，请关闭并重新选择已保存的工作空间。'};
        setError('成员连接已保存，无需重新导入。'+(reasons[host.preparation.reason ?? 'catalog'] ?? reasons.catalog));
        return;
      }
      close(); notify(host.preparation?.ready ? `工作空间「${source.workspaceName}」已就绪，可选择模型开始工作。` : `已导入成员工作空间「${source.workspaceName}」。请在模型目录查看可用状态。`);
    } catch (cause) { if (current()) setError(errorText(cause)); }
    finally { if (current()) { pendingRef.current = null; setPending(null); } }
  };

  return <>
    <button type="button" className="button secondary compact-button studio-import-open" data-testid="studio-import-open" disabled={!!pending} onClick={() => void choose()}><Icon name="link" size={15} />导入工作空间</button>
    {open && <Modal title="导入成员工作空间" subtitle="导入管理员提供的工作空间文件，完成授权后该文件立即失效。" className="workspace-invite-modal" onClose={close}>
      <div className="workspace-invite-content" data-testid="studio-import-dialog" data-workbench-workspace-import aria-busy={!!pending}>
        {pending === 'preview' && <p className="inline-note" role="status" data-testid="studio-import-loading">正在读取工作空间文件…</p>}
        {preview && <>
          <dl className="workspace-invite-preview" data-testid="studio-import-preview">
            <div><dt>成员工作空间</dt><dd data-testid="studio-import-workspace">{preview.workspaceName}<small data-testid="studio-import-workspace-id">{preview.workspaceId}</small></dd></div>
            <div><dt>SSH 主机</dt><dd className="mono" data-testid="studio-import-target"><ConnectionAddress hostname={preview.hostname} port={preview.port}/></dd></div>
            <div><dt>SSH 用户</dt><dd className="mono" data-testid="studio-import-user">{preview.username}</dd></div>
            <div><dt>有效期至（本地时区）</dt><dd><time data-testid="studio-import-expiry" dateTime={preview.expiresAt}>{new Date(preview.expiresAt).toLocaleString('zh-CN')}</time></dd></div>
            <div><dt>连接身份</dt><dd className="mono" data-testid="studio-import-authority">{preview.authorityId || 'SSH 主机公钥已固定'}</dd></div>
            <div><dt>设备登记地址</dt><dd className="mono" data-testid="studio-import-enrollment">{hideAddress?'********':preview.enrollmentUrl}</dd></div>
          </dl>
          <Field label="本机设备名称" hint="用于管理员识别和撤销此设备，最多 100 个字符。"><input ref={labelInput} data-testid="studio-import-device-label" maxLength={100} value={deviceLabel} disabled={!!pending || !!imported} onChange={event => { if (pendingRef.current) return; labelRef.current = event.target.value; setDeviceLabel(event.target.value); }} /></Field>
          <p className="inline-note">{preview.resumeExistingDevice ? '本机已有对应的设备登记记录。确认后将复用原密钥，核实并恢复连接。' : '确认后将在本机生成独立设备密钥，并向上方地址登记公钥。私钥保留在本机。'}</p>
          <p className="inline-note">确认后自动读取管理员配置，并在缺少本机 Claude 工具时调用官方安装器。无需在本机登录 Claude 或填写 MCP 配置。</p>
        </>}
        {pending === 'import' && <p className="inline-note" role="status" data-testid="studio-import-pending">正在准备设备、官方工具和模型目录；关闭窗口不会取消已确认的操作。</p>}
        {preview && <p className="inline-note">是否过期由服务器校验，不使用本机时钟判断。</p>}
        {error && <p className="inline-error" role="alert" data-testid="studio-import-error">{error}</p>}
        <div className="modal-actions workspace-invite-actions">
          <button type="button" className="button secondary" data-testid="studio-import-cancel" onClick={close}>关闭</button>
          <button type="button" className="button secondary" data-testid="studio-import-repick" disabled={!!pending} onClick={() => void choose()}>重新选择文件</button>
          <button type="button" className="button primary" data-testid="studio-import-confirm" disabled={!!pending || !preview || !deviceLabel.trim() || deviceLabel.trim().length > 100} onClick={() => void confirm()}>{pending === 'import' ? '正在准备…' : imported ? '重新准备' : preview?.resumeExistingDevice ? '恢复此设备连接' : '确认导入'}</button>
        </div>
      </div>
    </Modal>}
  </>;
}
