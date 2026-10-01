import {useUiPreference} from './ui-preferences';
import { useEffect, useRef, useState } from 'react';
import { api } from './App';
import { Icon, Modal, Toggle, errorText } from './ui';
import { runtimeName } from './RuntimeCliSettings';
import type { NativePlugin, NativePluginScan } from '../../../packages/native-plugins';

export default function NativePluginSettings({ notify }: { notify: (message: string) => void }) {
  const [scan, setScan] = useState<NativePluginScan | null>(null), [tab, setTab] = useUiPreference<'installed' | 'available'>('settings.native-plugins-tab'), [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState<{ plugin: NativePlugin; action: 'install' | 'enable' | 'disable' } | null>(null);
  const active = useRef(true), generation = useRef(0), pending = useRef(false);
  const reload = async (refresh = false) => { const request = ++generation.current, value = await api<NativePluginScan>('native-plugins/list', { refresh }); if (active.current && request === generation.current) setScan(value); };
  useEffect(() => { active.current = true; const update = () => { if (!pending.current) void reload().catch(() => setError('原生插件暂时无法读取。')); }; update(); window.addEventListener('focus', update); window.addEventListener('native-plugins-changed', update); window.addEventListener('local-cli-changed', update); return () => { active.current = false; generation.current++; window.removeEventListener('focus', update); window.removeEventListener('native-plugins-changed', update); window.removeEventListener('local-cli-changed', update); }; }, []);
  const change = async () => {
    if (!confirm || pending.current) return;
    const { plugin, action } = confirm; setConfirm(null); pending.current = true; generation.current++; setBusy(true); setError('');
    try { await api('native-plugins/change', { runtime: plugin.runtime, id: plugin.id, revision: plugin.revision, action }); notify(action === 'install' ? '插件已安装，新会话生效' : '已保存，新会话生效'); if (action === 'install') setTab('installed'); window.dispatchEvent(new Event('native-plugins-changed')); }
    catch (failure) { const message = errorText(failure); setError(/CONFLICT/.test(message) ? '插件或配置已发生变化，请刷新后重新确认。' : /CLI_TASKS_ACTIVE|CLI_RUNTIME_BUSY/.test(message) ? '运行时正在使用或维护中，请结束后重试。' : /VERIFY/.test(message) ? '原生命令已执行，但尚未核验成功；请在原生客户端检查后刷新。' : '原生插件操作未完成。请检查网络、原生市场权限及 CLI 提示；需要额外命令授权的插件请在原生客户端安装。'); }
    finally { await reload().catch(() => {}); pending.current = false; if (active.current) setBusy(false); }
  };
  const items = scan?.plugins.filter(plugin => plugin.installed === (tab === 'installed') && `${plugin.name} ${plugin.description} ${plugin.nativeId} ${runtimeName(plugin.runtime)}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <section className="native-plugin-settings" data-testid="native-plugin-settings">
    <div className="section-heading"><h3>运行时插件</h3><button className="icon-button" aria-label="刷新原生插件" disabled={busy} onClick={() => { setBusy(true); void reload(true).catch(() => setError('插件目录刷新失败。')).finally(() => setBusy(false)); }}><Icon name="refresh" size={16}/></button></div>
    <div className="skill-list-toolbar"><div className="skill-tabs" role="tablist" aria-label="原生插件状态">{(['installed', 'available'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{value === 'installed' ? '已安装' : '可安装'} <span>{scan?.plugins.filter(plugin => plugin.installed === (value === 'installed')).length ?? 0}</span></button>)}</div><label className="skill-search"><Icon name="search" size={15}/><input type="search" aria-label="搜索原生插件" placeholder="搜索插件或运行时" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
    {!scan ? <p role="status">正在读取原生插件…</p> : !items.length ? <p className="inline-note">{tab === 'installed' ? '尚未发现已安装的原生插件。' : '当前原生目录没有匹配的可安装插件。'}</p> : items.map(plugin => <article className="plugin-row" key={plugin.id} data-testid={'native-plugin-' + plugin.id}><header><div className="native-plugin-copy"><h2>{plugin.name}</h2><p title={plugin.description}>{plugin.description || plugin.nativeId}</p><small>{runtimeName(plugin.runtime)} · {plugin.marketplace}{plugin.version ? ` · ${plugin.version}` : ''}{plugin.scope !== 'user' ? ' · 项目/托管范围' : ''}</small></div>{plugin.installed ? <fieldset disabled={busy || !plugin.canToggle} className="resource-fieldset" title={plugin.detail}><Toggle label={`启用原生插件 ${plugin.name}`} checked={plugin.enabled} onChange={enabled => setConfirm({ plugin, action: enabled ? 'enable' : 'disable' })}/></fieldset> : <button className="button secondary" disabled={busy || !plugin.canInstall} onClick={() => setConfirm({ plugin, action: 'install' })}>安装</button>}</header>{plugin.installed && !plugin.canToggle && <p className="inline-note">{plugin.detail}</p>}</article>)}
    {busy && <p role="status">正在处理原生插件…</p>}{error && <p role="alert" className="inline-error">{error}</p>}
    {scan?.errors.map(item => <p className="inline-note" key={item.runtime}>{runtimeName(item.runtime)}：{item.message}</p>)}
    <p className="inline-note">使用各运行时的原生目录和用户配置。插件开关影响整组组件；新会话生效。工作台 ZIP 扩展单独管理。</p>
    {confirm && <Modal title={`${confirm.action === 'install' ? '安装' : confirm.action === 'enable' ? '启用' : '停用'} ${confirm.plugin.name}？`} onClose={() => setConfirm(null)}><p>{runtimeName(confirm.plugin.runtime)} · {confirm.plugin.nativeId}</p><p>{confirm.plugin.detail}</p>{confirm.action === 'install' && <p>插件可能包含工具、技能、MCP 服务或钩子；安装使用原生用户范围及原生权限规则。</p>}<div className="modal-actions"><button className="button secondary" onClick={() => setConfirm(null)}>取消</button><button className="button primary" onClick={() => void change()}>确认{confirm.action === 'install' ? '安装' : confirm.action === 'enable' ? '启用' : '停用'}</button></div></Modal>}
  </section>;
}
