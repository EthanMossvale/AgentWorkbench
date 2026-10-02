import {RememberedDetails} from './UiMemory';
import { useEffect, useRef, useState } from 'react';
import { api } from './App';
import { Icon, Modal, Toggle, errorText } from './ui';
import type { InstallMethod, LocalCli, LocalRuntime } from '../../../packages/native-runtime/cli';
import './NativeResources.css';

export const runtimeName = (runtime: LocalRuntime) => runtime === 'codex' ? 'Codex' : 'Claude Code';
const errors: Record<string, string> = {
  CLI_TASKS_ACTIVE: '有运行中或结果未确认的会话，请结束后再管理 CLI。', CLI_RUNTIME_BUSY: '此运行时正在处理，请稍后重试。', CLI_INSTALL_STATE_CHANGED: '安装状态已变化，请刷新后重试。',
  CLI_UNINSTALL_UNSUPPORTED: '请通过原安装渠道卸载此 CLI，工作台不会删除来源不明的程序。',
  CLI_UNINSTALL_NOT_APPLIED: '卸载未完成，CLI 仍在原位置。请检查原安装渠道。',
  CLI_OTHER_INSTALLATION_REMAINS: '已卸载选中的安装，但还发现另一份 CLI，当前显示的是剩余安装。',
  CLI_INSTALL_PREREQUISITE: '当前安装方式暂不可用。npm 方式需要 Node.js 和 npm；可以选择原生安装。',
  CLI_INSTALL_METHOD_INVALID: '请选择原生或 npm 安装方式。',
  CLI_UPDATE_CHECK_FAILED: '暂时无法获取官方版本，请稍后重试。', CLI_VERSION_UNVERIFIED: '已找到程序，但无法确认版本。',
  CLI_COMMAND_FAILED: '官方命令未成功完成，原因尚未确认。请通过安装详情中的官方命令核查。', CLI_INSTALL_DOWNLOAD_FAILED: '官方安装器获取版本、清单或程序失败；请稍后检查官方服务连接。',
  CLI_INSTALL_CHECKSUM_FAILED: '官方安装包校验失败，未继续安装。', CLI_INSTALL_PLATFORM_UNSUPPORTED: '官方安装器不支持当前系统或架构。', CLI_INSTALL_PERMISSION_DENIED: '官方安装器被系统权限阻止。', CLI_COMMAND_TIMED_OUT: '安装超时，已停止本次安装进程；请刷新安装状态。',
  CLI_OUTPUT_TOO_LARGE: '安装程序输出异常，已停止。', CLI_INSTALL_NOT_DISCOVERED: '安装结束，但尚未找到 CLI；请刷新或检查官方安装结果。',
  CLI_PROCESS_STATE_UNKNOWN: '无法确认安装进程已退出。请检查本机进程后重启工作台，再进行更新。',
  CLI_UPDATE_NOT_APPLIED: '官方命令已结束，但版本尚未达到检查到的更新版本；请刷新后检查原安装渠道。',
  CLI_INSTALL_DIRECTORY_INVALID: '请选择有效的 Windows 磁盘目录。',
};
export const cliError = (message: string) => Object.entries(errors).find(([code]) => message.includes(code))?.[1] ?? '暂时无法完成操作，请刷新后重试。';

export default function RuntimeCliSettings({ notify }: { notify: (message: string) => void }) {
  const [items, setItems] = useState<LocalCli[] | null>(null), [busy, setBusy] = useState<string[]>([]), [error, setError] = useState('');
  const [failures, setFailures] = useState<Partial<Record<LocalRuntime, string>>>({}), [removing, setRemoving] = useState<LocalCli | null>(null);
  const [standalone, setStandalone] = useState<LocalCli | null>(null);
  const [methods, setMethods] = useState<Record<LocalRuntime, InstallMethod>>({ codex: 'native', claude: 'native' });
  const active = useRef(true), pending = useRef(new Set<string>()), generation = useRef(0);
  const refresh = async () => { const current = ++generation.current, value = await api<LocalCli[]>('local-cli/list'); if (active.current && current === generation.current) setItems(value); };
  useEffect(() => {
    active.current = true; const update = () => { void refresh().catch(() => { if (active.current) setError('无法读取本机 CLI 状态。'); }); };
    update(); const timer = setInterval(update, 10000); window.addEventListener('focus', update);
    return () => { active.current = false; generation.current++; clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);
  const act = async (runtime: LocalRuntime, action: 'check' | 'install' | 'configure' | 'uninstall', extra: Record<string, unknown> = {}) => {
    const key = action === 'configure' ? runtime + '-configure' : runtime;
    if (pending.current.has(key)) return; pending.current.add(key); generation.current++; setBusy([...pending.current]); setError(''); setFailures(value => ({ ...value, [runtime]: '' }));
    if (action === 'configure') setItems(values => values?.map(item => item.runtime === runtime ? { ...item, autoUpdate: extra.enabled === true } : item) ?? null);
    try {
      await api<LocalCli[]>('local-cli/' + action, { runtime, ...extra });
      window.dispatchEvent(new Event('local-cli-changed'));
      if (action === 'install') notify(`${runtimeName(runtime)} ${extra.update ? '更新' : '安装'}完成`);
      if (action === 'uninstall') notify(`${runtimeName(runtime)} 已卸载，配置和记忆已保留`);
    } catch (failure) { if (active.current) setFailures(value => ({ ...value, [runtime]: cliError(errorText(failure)) })); }
    finally { pending.current.delete(key); if (active.current) { setBusy([...pending.current]); await refresh().catch(() => {}); } }
  };
  const chooseCodexDirectory=async()=>{
    try{const directory=await api<string|null>('desktop/data-directory/choose',{kind:'codex'});if(!directory)return;await api('local-cli/install-directory',{directory});await refresh();}
    catch(failure){setFailures(value=>({...value,codex:cliError(errorText(failure))}));}
  };
  return <section className="settings-section native-resources runtime-cli-settings" data-testid="runtime-cli-settings">
    <p className="inline-note runtime-cli-intro">管理本机 Codex 与 Claude Code，沿用各自的原生配置。</p>
    {!items && <p role="status">正在检查本机安装…</p>}
    {items?.map(item => { const method = methods[item.runtime], install = item.installMethods?.find(option => option.method === method), shownCommand = item.installed || !install ? item.command : install.command, showCatalog = item.installed ? !item.checkedMethod || item.checkedMethod === item.source : !item.checkedMethod || item.checkedMethod === method; return <article className="runtime-cli-row" key={item.runtime} data-testid={'cli-' + item.runtime}>
      <div className="runtime-cli-header"><span className="runtime-cli-title"><strong>{runtimeName(item.runtime)}</strong><small>{item.installed ? `已安装 · ${item.version ?? '版本未确认'}` : '未安装'}</small></span><div className="runtime-cli-actions">
        <button disabled={busy.includes(item.runtime) || item.busy} onClick={() => void act(item.runtime, 'check', item.installed ? {} : { installMethod: method })}>检查更新</button>
        {!item.installed ? <button disabled={busy.includes(item.runtime) || item.busy || !(install?.available ?? item.canInstall)} onClick={() => void act(item.runtime, 'install', { installMethod: method })}>安装</button> : <><button disabled={busy.includes(item.runtime) || item.busy || !item.canUpdate || !item.updateAvailable} onClick={() => void act(item.runtime, 'install', { update: true })}>更新</button><button className="icon-button" aria-label={`卸载 ${runtimeName(item.runtime)}`} title={item.canUninstall ? '卸载 CLI' : '请通过原安装渠道卸载'} disabled={busy.includes(item.runtime) || item.busy || !item.canUninstall} onClick={() => setRemoving(item)}><Icon name="trash" size={17}/></button></>}
      </div></div>
      {!item.installed && <div className="runtime-install-method"><span>安装方式</span><div className="runtime-install-choices" role="radiogroup" aria-label={`${runtimeName(item.runtime)} 安装方式`}>{(item.installMethods ?? [{ method: 'native', available: item.canInstall }]).map(option => <label key={option.method} title={option.method === 'npm' && !option.available ? '需要 Node.js 和 npm' : undefined}><input type="radio" name={`install-method-${item.runtime}`} value={option.method} checked={method === option.method} disabled={busy.includes(item.runtime) || item.busy || !option.available} onChange={() => setMethods(value => ({ ...value, [item.runtime]: option.method }))}/><span>{option.method === 'native' ? '原生安装' : 'npm'}{option.method === 'native' && <small>默认</small>}</span></label>)}</div></div>}
      {item.runtime==='codex'&&!item.installed&&method==='native'&&<div className="settings-action-row" data-workbench-codex-install-directory><span><strong>Codex 程序位置</strong><small>{item.installDirectory??'官方默认位置'}</small></span><button title="选择 Codex 原生安装目录" aria-label="选择 Codex 原生安装目录" onClick={()=>void chooseCodexDirectory()} disabled={busy.includes(item.runtime)||item.busy}><Icon name="folder" size={16}/></button></div>}
      <RememberedDetails memoryId="RuntimeCliSettings.details.1" scope={item.runtime} className="runtime-cli-details"><summary>安装详情</summary><div>
        {item.installed && <p>安装方式：{item.source === 'native' ? '原生安装' : item.source === 'npm' ? 'npm' : '其他渠道'}</p>}
        {item.executable && <p title={item.executable}>{item.executable}</p>}
        {shownCommand && <code>{shownCommand}</code>}
        {showCatalog && item.checkedAt && <small>上次检查：{new Date(item.checkedAt).toLocaleString('zh-CN', { hour12: false })}</small>}
      </div></RememberedDetails>
      {showCatalog && item.latest && <p className="runtime-cli-status">官方{item.channel === 'stable' ? '稳定' : '最新'}版本 {item.latest}{item.installed && !item.updateAvailable && item.version ? ' · 无可用更新' : ''}</p>}
      {(busy.includes(item.runtime) || item.busy) && <p className="runtime-cli-status" role="status">正在处理…</p>}
      {(failures[item.runtime] || item.error) && <p className="inline-error" role="alert">{failures[item.runtime] || cliError(item.error!)}</p>}
      {item.installed && !item.canUpdate && !item.error && <p className="inline-note">{item.source === 'path' ? '检测到其他渠道的 CLI，无法确认其更新方式。可查看安装详情，或安装可由工作台更新的独立 CLI。' : item.source === 'npm' ? '此 CLI 由 npm 安装；请先恢复可用的 Node.js 和 npm，再更新。' : '请通过原安装渠道更新此 CLI。'}</p>}
      {item.installed && item.source === 'path' && item.canInstall && <button className="button secondary" disabled={busy.includes(item.runtime) || item.busy} onClick={() => setStandalone(item)}>安装独立 {runtimeName(item.runtime)} CLI</button>}
      {item.installed && <fieldset className="resource-fieldset" disabled={busy.includes(item.runtime + '-configure') || !item.canUpdate}><Toggle label={`自动更新 ${runtimeName(item.runtime)}`} description="每天在工作台空闲时检查并更新。" checked={item.autoUpdate} onChange={enabled => void act(item.runtime, 'configure', { enabled })}/></fieldset>}
    </article>; })}
    <p className="inline-note runtime-cli-footnote">首次安装使用所选渠道的最新版，已有安装沿用原渠道。自动更新不会补装缺少的 CLI；Codex 可为新安装选择程序所在盘，登录、记忆与配置继续沿用原位置；Claude Code 使用官方默认位置。已有 CLI 不在此搬迁。</p>
    {standalone && <Modal title={`安装独立 ${runtimeName(standalone.runtime)} CLI？`} onClose={() => setStandalone(null)}><p>将运行官方原生安装器，并优先使用新安装的 CLI。登录、配置和记忆继续沿用原生位置。</p><p>当前检测到的程序会保留；官方安装器可能将独立 CLI 加入系统 PATH，影响终端默认使用的版本。</p><p className="resource-native-path mono">{standalone.executable}</p><div className="modal-actions"><button className="button secondary" onClick={() => setStandalone(null)}>取消</button><button onClick={() => { const target = standalone; setStandalone(null); void act(target.runtime, 'install', { installMethod: 'native' }); }}>安装独立 CLI</button></div></Modal>}
    {removing && <Modal title={`卸载 ${runtimeName(removing.runtime)}？`} onClose={() => setRemoving(null)}><p>将卸载本机 {runtimeName(removing.runtime)} {removing.version}。</p><p className="resource-native-path mono">{removing.executable}</p><p>原生配置、登录数据、记忆、技能、交接档案和工作台偏好均保留。卸载后不能新建此运行时的任务，重新安装后可继续使用。</p><div className="modal-actions"><button className="button secondary" onClick={() => setRemoving(null)}>取消</button><button className="button danger" onClick={() => { const target = removing; setRemoving(null); void act(target.runtime, 'uninstall', { revision: target.revision }); }}>确认卸载</button></div></Modal>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
