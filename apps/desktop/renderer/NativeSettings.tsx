import {RememberedDetails} from './UiMemory';
import {useUiPreference} from './ui-preferences';
import { useEffect, useRef, useState } from 'react';
import { api } from './App';
import { Icon, Modal, Toggle, errorText } from './ui';
import type { NativeSkill, SkillScan } from '../../../packages/native-skills';
import './NativeResources.css';
import SkillImportDialog from './SkillImportDialog';
import {isArchivePasswordRequest,type ArchivePasswordRequest,type ArchiveUnlock} from '../../../packages/native-resources/archive-types';
import { SkillConnections, SkillConnectionsToolbar, SkillLinkDialog, runtimeName } from './SkillConnections';
import type { SkillLinkAction, SkillLinkPlan, SkillLinkResult, SkillRuntime } from '../../../packages/native-skills/links';

interface SharedProps { report: (error: unknown) => void; notify: (message: string) => void }
export { default as SharedMemory } from './NativeMemorySettings';
const official = (skill: NativeSkill) => skill.origins.some(origin => origin.kind === 'official');
const providers = (skill: NativeSkill) => [...new Set(skill.origins.map(origin => origin.provider === 'codex' ? 'Codex' : 'Claude Code'))].join(' / ');

export function SharedSkills({ report, notify }: SharedProps) {
  const [scan, setScan] = useState<SkillScan | null>(null), [busy, setBusy] = useState(false), [query, setQuery] = useState(''), [tab, setTab] = useUiPreference<'personal' | 'official'>('settings.skills-tab');
  const [selected, setSelected] = useState<NativeSkill | null>(null), [markdown, setMarkdown] = useState(''), [readError, setReadError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [pluginChange, setPluginChange] = useState<{ skill: NativeSkill; enabled: boolean } | null>(null);
  const [linkDialog, setLinkDialog] = useState<{ plan: SkillLinkPlan; skills: NativeSkill[] } | null>(null), [linkError, setLinkError] = useState('');
  const linkTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => { if (!linkDialog && !busy && linkTrigger.current) { linkTrigger.current.focus(); linkTrigger.current = null; } }, [linkDialog, busy]);
  const generation = useRef(0), active = useRef(true), changing = useRef(false), request = useRef(0);
  const reload = async () => { const current = ++request.current, result = await api<SkillScan>('native-skills/list'); if (active.current && current === request.current) setScan(result); };
  useEffect(() => { active.current = true; const update = () => { if (!changing.current) void reload().catch(report); }; update(); window.addEventListener('focus', update); window.addEventListener('local-cli-changed', update); return () => { active.current = false; generation.current++; request.current++; window.removeEventListener('focus', update); window.removeEventListener('local-cli-changed', update); }; }, []);
  const action = async (fn: () => Promise<unknown>) => {
    if (changing.current) return; changing.current = true; setBusy(true); request.current++;
    try { await fn(); await reload(); } catch (error) { report(error); await reload().catch(() => {}); }
    finally { changing.current = false; if (active.current) setBusy(false); }
  };
  const open = async (skill: NativeSkill) => { const current = ++generation.current; setSelected(skill); setMarkdown(''); setReadError(''); if (skill.builtin) return; try { const result = await api<NativeSkill & { markdown: string }>('native-skills/read', { id: skill.id, hash: skill.hash }); if (active.current && current === generation.current) setMarkdown(result.markdown); } catch (error) { if (active.current && current === generation.current) setReadError(errorText(error)); } };
  const toggle = (skill: NativeSkill, enabled: boolean, confirmParent = false) => {
    setScan(value => value ? { ...value, skills: value.skills.map(item => item.id === skill.id ? { ...item, enabled } : item) } : value);
    void action(async () => { await api('native-skills/toggle', { id: skill.id, enabled, confirmParent }); notify('已保存，新会话生效'); });
  };
  const close = () => { generation.current++; setSelected(null); };
  const applyLinks = async (plan: SkillLinkPlan) => {
    const result = await api<SkillLinkResult>('native-skills/links/apply', { planId: plan.id });
    const failed = result.items.filter(item => item.status === 'failed'), changed = result.items.reduce((sum, item) => sum + (item.status === 'created' || item.status === 'removed' ? item.count : 0), 0);
    if (failed.length) { setLinkError(`操作未全部完成，已停止后续处理。已核验的 ${changed} 项已保留，请关闭后刷新查看实际目录。`); if (!linkDialog) notify('接入操作未全部完成，请刷新查看实际目录'); }
    else { setLinkDialog(null); notify(`${runtimeName(plan.runtime)} · ${plan.action === 'connect' ? '已接入' : '已撤销'} ${changed} 项，新会话生效`); }
  };
  const changeLinks = (runtime: SkillRuntime, operation: SkillLinkAction, selectedSkills: NativeSkill[], batch: boolean) => {
    if (!linkDialog) linkTrigger.current = document.activeElement as HTMLElement | null;
    void action(async () => {
      setLinkError('');
      const plan = await api<SkillLinkPlan>('native-skills/links/plan', { runtime, action: operation, skills: selectedSkills.map(({ id, hash }) => ({ id, hash })) });
      if (batch || !plan.counts.create && !plan.counts.remove) setLinkDialog({ plan, skills: selectedSkills }); else await applyLinks(plan);
    });
  };
  const importSkill = async (provider: 'codex' | 'claude', file?: File, unlock?:ArchiveUnlock) => {
    if (changing.current) return false;
    changing.current = true; setBusy(true); request.current++;
    try {
      const result = file ? await window.workbench.importSkillFile(file, provider) as SkillScan|ArchivePasswordRequest : await api<SkillScan | ArchivePasswordRequest | null>('native-skills/import', { provider,...unlock });
      if(isArchivePasswordRequest(result))return result;
      if (!result) return false;
      if (active.current) { setScan(result); setTab('personal'); setQuery(''); notify(`Skill 已安装到 ${provider === 'codex' ? 'Codex' : 'Claude Code'} · 个人`); }
      return true;
    } finally { changing.current = false; if (active.current) setBusy(false); }
  };
  const skills = scan?.skills.filter(skill => official(skill) === (tab === 'official') && `${skill.displayName} ${skill.name} ${skill.shortDescription} ${skill.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  const count = (kind: 'official' | 'personal') => scan?.skills.filter(skill => official(skill) === (kind === 'official')).length ?? 0;
  return <div className="native-resources native-skills-literary" data-testid="native-skills-settings">
    <div className="skill-list-toolbar">
      <div className="skill-tabs" role="tablist" aria-label="技能分类">{(['official', 'personal'] as const).map(kind => <button key={kind} role="tab" aria-selected={tab === kind} aria-controls="native-skills-panel" id={`skill-tab-${kind}`} onClick={() => setTab(kind)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const next = kind === 'official' ? 'personal' : 'official'; setTab(next); document.getElementById(`skill-tab-${next}`)?.focus(); } }} tabIndex={tab === kind ? 0 : -1}>{kind === 'official' ? '官方' : '个人'} <span>{count(kind)}</span></button>)}</div>
      {tab === 'personal' && <SkillConnectionsToolbar skills={skills} busy={busy} onChange={changeLinks}/>}
      <label className="skill-search"><Icon name="search" size={15}/><input type="search" aria-label="搜索技能" placeholder="搜索技能" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <button className="icon-button" title="刷新技能" aria-label="刷新技能" data-testid="skills-refresh" disabled={busy} onClick={() => void action(reload)}><Icon name="refresh" size={16}/></button>
      {tab === 'personal' && <button className="button secondary skill-import-button" data-testid="skills-import" disabled={busy} aria-haspopup="dialog" onClick={() => setImportOpen(true)}><Icon name="plus" size={14}/>导入 ZIP</button>}
    </div>
    {importOpen && <SkillImportDialog onClose={() => setImportOpen(false)} onImport={importSkill}/>}
    {linkDialog && <SkillLinkDialog plan={linkDialog.plan} batch busy={busy} error={linkError} onClose={() => setLinkDialog(null)} onMode={operation => changeLinks(linkDialog.plan.runtime, operation, linkDialog.skills, true)} onApply={() => void action(async () => { try { await applyLinks(linkDialog.plan); } catch { setLinkError('目录或技能已变化，或确认已过期。请关闭并刷新后重试。'); } })}/>}
    {pluginChange && <Modal title={pluginChange.enabled ? '启用所属插件' : '停用所属插件'} onClose={() => setPluginChange(null)}><p>{pluginChange.skill.control?.detail}</p><div className="modal-actions"><button className="button secondary" onClick={() => setPluginChange(null)}>取消</button><button className="button primary" onClick={() => { toggle(pluginChange.skill, pluginChange.enabled, true); setPluginChange(null); }}>确认{pluginChange.enabled ? '启用' : '停用'}</button></div></Modal>}
    <div className="native-skill-list" id="native-skills-panel" role="tabpanel" aria-labelledby={`skill-tab-${tab}`} data-testid="skills-list">
      {!scan ? <p className="shared-empty">正在读取技能…</p> : !skills.length ? <p className="shared-empty">没有匹配的技能</p> : skills.map(skill => <article key={skill.id} data-testid={`native-skill-${skill.id}`}>
        <button className="shared-item-main" onClick={() => void open(skill)} title={skill.displayName}>
          <span className="native-skill-icon" aria-hidden="true">{skill.icon ? <img src={skill.icon} alt=""/> : <Icon name="package" size={19}/>}</span>
          <span className="native-skill-copy"><strong>{skill.displayName}</strong><span className="native-skill-description" title={skill.shortDescription}>{skill.shortDescription}</span></span>
        </button>
        <span className="native-skill-origin" title={[...new Set(skill.origins.map(origin => `${origin.provider === 'codex' ? 'Codex' : 'Claude Code'}${origin.kind === 'project' ? ' · 项目' : ''}`))].join(' / ')}>{providers(skill)} · {official(skill) ? '官方' : '个人'}</span>
        {skill.conflicts.length > 0 && <span className={`skill-conflict ${skill.available || !skill.enabled ? 'resolved' : ''}`} title={skill.available ? '同名冲突已消解' : skill.enabled ? '同名技能同时开启，关闭多余项后生效' : '此同名技能已停用'}><Icon name="alert" size={15}/><span className="sr-only">{skill.available ? '同名冲突 · 已消解' : '同名冲突'}</span></span>}
        <div className="skill-row-actions" title={skill.control?.detail}>{tab === 'personal' && <SkillConnections skill={skill} busy={busy} onChange={changeLinks}/>}<fieldset disabled={busy || !skill.control?.canToggle} className="resource-fieldset"><Toggle label={`启用 ${skill.displayName}`} checked={skill.enabled} onChange={enabled => skill.control?.kind === 'plugin' || (enabled && skill.control?.enableParent) ? setPluginChange({ skill, enabled }) : toggle(skill, enabled)}/></fieldset>{!skill.control?.canToggle && <button className="icon-button" aria-label={`查看 ${skill.displayName} 的开关限制`} onClick={() => void open(skill)}><Icon name="alert" size={15}/></button>}{!skill.builtin && skill.path && <button className="icon-button skill-export" data-workbench-skill-export data-skill-id={skill.id} disabled={busy} title="导出 ZIP" aria-label={`导出 ${skill.displayName}`} onClick={() => void action(async () => { if (await api('native-skills/export', { id: skill.id, hash: skill.hash })) notify('Skill ZIP 已导出'); })}><Icon name="export" size={17}/></button>}</div>
      </article>)}
    </div>
    <p className="inline-note" data-testid="native-skills-scope">{tab === 'personal' && '运行时图标表示原生目录接入；外部管理的条目保留，顶部批量操作仅作用于当前列表。'}开关保存到本机原生设置，新会话生效，无需重启工作台。已有会话不主动重载；独立远端与会话启动参数不受此开关控制。</p>
    {!!scan?.errors.length && <RememberedDetails memoryId="NativeSettings.details.1" className="resource-errors"><summary>有 {scan.errors.length} 个技能无法读取</summary>{scan.errors.map((error, index) => <p key={index}><code>{error.path}</code><br/>{error.message}</p>)}</RememberedDetails>}
    {selected && <Modal title={selected.displayName} onClose={close} className="native-skill-modal">{selected.path && <p className="resource-native-path mono">{selected.path}</p>}{selected.warning && <p className="inline-note">{selected.warning}</p>}{selected.control && <p className="inline-note">{selected.control.detail}</p>}{selected.builtin ? <p>{selected.description}</p> : readError ? <p className="inline-error">{readError}</p> : markdown ? <pre data-testid="shared-skill-markdown">{markdown}</pre> : <p>读取中…</p>}</Modal>}
  </div>;
}
