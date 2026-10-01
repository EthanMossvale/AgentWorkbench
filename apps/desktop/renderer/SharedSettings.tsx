import {RememberedTextarea} from './UiMemory';
import { useEffect, useRef, useState } from 'react';
import { api } from './App';
import { Field, Icon, Modal, Toggle, errorText } from './ui';

interface SharedProps { report: (error: unknown) => void; notify: (message: string) => void }
interface MemoryStatus { enabled: boolean; revision: number; noteCount: number; root: string; autoCapture: false }
interface MemoryNote { id: string; title: string; content: string; summary: string; tags: string[]; createdAt: string; updatedAt: string; hash: string; source: { kind: 'user-note'; sessionId?: string } }
interface SharedSkill { id: string; name: string; description: string; hash: string; importedAt: string; source: { kind: 'user-selected-file'; fileName: string }; compatibility: 'instructions-only' }
interface SharedSkillDocument extends SharedSkill { markdown: string }
export function SharedMemory({ report, notify }: SharedProps) {
  const [status, setStatus] = useState<MemoryStatus | null>(null); const [notes, setNotes] = useState<MemoryNote[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [editing, setEditing] = useState<MemoryNote | 'new' | null>(null); const [deleting, setDeleting] = useState<MemoryNote | null>(null); const [title, setTitle] = useState(''); const [content, setContent] = useState(''); const [summary, setSummary] = useState(''); const [tags, setTags] = useState('');
  const reload = async () => { const [nextStatus, nextNotes] = await Promise.all([api<MemoryStatus>('memory/get'), api<MemoryNote[]>('memory/list')]); setStatus(nextStatus); setNotes(nextNotes); };
  useEffect(() => { reload().catch(report).finally(() => setLoading(false)); }, []);
  const enable = async (enabled: boolean) => { setBusy(true); try { await api('memory/settings', { enabled }); await reload(); notify(enabled ? '共享记忆已启用' : '共享记忆已关闭，笔记仍保留在本地'); } catch (e) { report(e); } finally { setBusy(false); } };
  const edit = (note?: MemoryNote) => { setEditing(note ?? 'new'); setTitle(note?.title ?? ''); setContent(note?.content ?? ''); setSummary(note?.summary ?? ''); setTags(note?.tags.join(', ') ?? ''); };
  const save = async () => { if (!editing) return; setBusy(true); try { await api('memory/save', { ...(editing !== 'new' ? { id: editing.id, expectedHash: editing.hash } : {}), title, content, summary, tags: tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) }); await reload(); setEditing(null); notify('记忆笔记已保存'); } catch (e) { report(e); } finally { setBusy(false); } };
  const remove = async () => { if (!deleting) return; setBusy(true); try { await api('memory/delete', { id: deleting.id, expectedHash: deleting.hash }); await reload(); setDeleting(null); notify('记忆笔记已删除'); } catch (e) { report(e); } finally { setBusy(false); } };
  return <div className="shared-settings">
    <section className="settings-section"><div className="section-heading"><div><h2>共享记忆</h2><p>由工作台维护同一份记忆，Claude 与 Codex 共用，不随运行时切换。</p></div><span className="outline-label">框架级</span></div><Toggle checked={status?.enabled ?? false} onChange={enabled => { if (status && !busy) enable(enabled); }} label="启用共享记忆" description="关闭后停止将笔记加入新上下文，不删除已保存的本地笔记。" /><p className="inline-note">仅使用你明确保存的内容，不自动提取聊天，不读取原生客户端的私有记忆或聊天数据库。原生链仍需单独联验。</p>{status && <dl className="shared-storage"><dt>存储位置</dt><dd className="mono">{status.root}</dd><dt>记忆版本</dt><dd>{status.revision} · {status.noteCount} 条笔记</dd><dt>自动捕获</dt><dd>关闭 · 不后台扫描</dd></dl>}</section>
    <section className="settings-section"><div className="section-heading"><div><h2>记忆笔记</h2><p>保留需要跨任务使用的偏好、约定和项目事实。</p></div><button className="button secondary" data-testid="memory-new" disabled={loading} onClick={() => edit()}><Icon name="plus" size={15} />添加笔记</button></div><div className="shared-list" data-testid="memory-list">{loading ? <p className="inline-note">正在读取本地共享库…</p> : !notes.length ? <p className="shared-empty">还没有记忆笔记。只保存你愿意用于后续任务的内容。</p> : notes.map(note => <article key={note.id}><button className="shared-item-main" onClick={() => edit(note)}><strong>{note.title}</strong><p>{note.summary || note.content.slice(0,150)}</p><small>{note.tags.join(' · ') || '手动保存'} · {new Date(note.updatedAt).toLocaleDateString('zh-CN')}</small></button><button className="icon-button" aria-label={`删除记忆 ${note.title}`} onClick={() => setDeleting(note)}><Icon name="close" size={16} /></button></article>)}</div></section>
    {editing && <Modal title={editing === 'new' ? '添加记忆笔记' : '编辑记忆笔记'} subtitle="Claude 与 Codex 将使用同一份框架记忆。不要在这里保存密钥或登录凭据。" onClose={() => setEditing(null)}><form onSubmit={e => { e.preventDefault(); save(); }}><Field label="标题"><input data-testid="memory-title" required value={title} maxLength={200} onChange={e => setTitle(e.target.value)} autoFocus /></Field><Field label="摘要（可选）"><input value={summary} maxLength={1000} onChange={e => setSummary(e.target.value)} /></Field><Field label="记忆内容"><RememberedTextarea memoryId="SharedSettings.editor.1" data-testid="memory-content" required rows={7} value={content} onChange={e => setContent(e.target.value)} /></Field><Field label="标签（逗号分隔，可选）"><input value={tags} onChange={e => setTags(e.target.value)} /></Field><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setEditing(null)}>取消</button><button data-testid="memory-save" className="button primary" disabled={busy}>{busy ? '保存中…' : '保存笔记'}</button></div></form></Modal>}
    {deleting && <Modal title="删除记忆笔记？" onClose={() => setDeleting(null)}><p className="dialog-copy">将从共享记忆库删除“{deleting.title}”。不会删除原始会话或已经发送给模型的内容。</p><div className="modal-actions"><button className="button secondary" onClick={() => setDeleting(null)}>取消</button><button className="button danger" disabled={busy} onClick={remove}>删除笔记</button></div></Modal>}
  </div>;
}

export function SharedSkills({ report, notify }: SharedProps) {
  const [skills, setSkills] = useState<SharedSkill[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [selected, setSelected] = useState<SharedSkill | null>(null); const [deleting, setDeleting] = useState<SharedSkill | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null); const [reading, setReading] = useState(false); const [readError, setReadError] = useState('');
  const detailGeneration = useRef(0); const selectedRef = useRef<SharedSkill | null>(null);
  const reload = async () => setSkills(await api<SharedSkill[]>('skills/list'));
  useEffect(() => { let current = true; api<SharedSkill[]>('skills/list').then(result => { if (current) setSkills(result); }).catch(e => { if (current) report(e); }).finally(() => { if (current) setLoading(false); }); return () => { current = false; detailGeneration.current++; }; }, []);
  const closePreview = () => { detailGeneration.current++; selectedRef.current = null; setSelected(null); setMarkdown(null); setReading(false); setReadError(''); };
  const openSkill = async (skill: SharedSkill) => {
    const generation = ++detailGeneration.current; selectedRef.current = skill; setSelected(skill); setMarkdown(null); setReadError(''); setReading(true);
    try {
      const result = await api<SharedSkillDocument>('skills/read', { id: skill.id, expectedHash: skill.hash });
      if (generation !== detailGeneration.current) return;
      if (result.id !== skill.id || result.hash !== skill.hash || typeof result.markdown !== 'string') throw new Error('技能版本已变化或正文不可用，请刷新目录后再读取。');
      setMarkdown(result.markdown);
    } catch (e) { if (generation === detailGeneration.current) { setMarkdown(null); setReadError(errorText(e)); } }
    finally { if (generation === detailGeneration.current) setReading(false); }
  };
  const refreshSelected = async () => {
    const id = selected?.id; const generation = ++detailGeneration.current; setMarkdown(null); setReadError(''); setReading(true);
    try { const latest = await api<SharedSkill[]>('skills/list'); if (generation !== detailGeneration.current) return; setSkills(latest); const skill = latest.find(item => item.id === id); if (skill) await openSkill(skill); else closePreview(); }
    catch (e) { if (generation === detailGeneration.current) setReadError(errorText(e)); }
    finally { if (generation === detailGeneration.current) setReading(false); }
  };
  const importSkill = async () => { setBusy(true); try { const result = await api<SharedSkill | null>('skills/import'); if (result) { if (selectedRef.current?.id === result.id && selectedRef.current.hash !== result.hash) closePreview(); await reload(); notify('技能已导入全局共享库'); } } catch (e) { report(e); } finally { setBusy(false); } };
  const remove = async () => { if (!deleting) return; setBusy(true); try { await api('skills/delete', { id: deleting.id, expectedHash: deleting.hash }); if (selectedRef.current?.id === deleting.id) closePreview(); await reload(); setDeleting(null); notify('技能已从共享库移除'); } catch (e) { report(e); } finally { setBusy(false); } };
  return <div className="shared-settings">
    <section className="settings-section"><div className="section-heading"><div><h2>共享技能</h2><p>Claude 与 Codex 共用全局技能库，不需要在新会话中重复选择。</p></div><button className="button secondary" data-testid="skills-import" disabled={busy || loading} onClick={importSkill}><Icon name="plus" size={15} />{busy ? '处理中…' : '导入 SKILL.md'}</button></div>
      <p className="inline-note">目录只读取名称与说明；打开某项时，才按需读取这一份完整 SKILL.md。不会把全部技能正文一次性加入会话。导入不执行脚本、安装依赖或授予权限；原生工具兼容性仍需分别验证。</p>
      <div className="shared-list" data-testid="skills-list">{loading ? <p className="shared-empty">正在读取共享技能目录…</p> : !skills.length ? <p className="shared-empty">尚未导入技能。选择一个明确的 SKILL.md 文件开始。</p> : skills.map(skill => <article key={skill.id}><button className="shared-item-main" data-testid={`shared-skill-${skill.id}`} onClick={() => void openSkill(skill)}><strong>{skill.name}</strong><p>{skill.description}</p><small>全局共享 · 来源：{skill.source.fileName}</small></button><button className="icon-button" aria-label={`移除技能 ${skill.name}`} disabled={busy} onClick={() => setDeleting(skill)}><Icon name="close" size={16} /></button></article>)}</div>
    </section>
    {selected && <section className="settings-section skill-detail" data-testid="shared-skill-detail"><div className="section-heading"><div><h2>{selected.name}</h2><p>完整 SKILL.md · 不作为执行或权限授予依据</p></div><button className="icon-button" aria-label="关闭技能预览" onClick={closePreview}><Icon name="close" size={16} /></button></div>
      {reading ? <p className="inline-note" role="status">正在读取这一份技能…</p> : readError ? <div className="inline-error" role="alert">{readError}<p>请刷新目录以确认当前版本；不会显示旧正文。</p><button className="text-button" data-testid="refresh-skill-detail" disabled={busy} onClick={refreshSelected}>刷新目录并重新读取</button></div> : markdown !== null && <pre data-testid="shared-skill-markdown">{markdown}</pre>}
      <small>版本摘要 {selected.hash.slice(0,16)} · {new Date(selected.importedAt).toLocaleString('zh-CN')}</small>
    </section>}
    {deleting && <Modal title="移除共享技能？" onClose={() => setDeleting(null)}><p className="dialog-copy">从工作台共享库移除“{deleting.name}”。你导入的原始 SKILL.md 文件不会被删除。</p><div className="modal-actions"><button className="button secondary" onClick={() => setDeleting(null)}>取消</button><button className="button danger" disabled={busy} onClick={remove}>移除技能</button></div></Modal>}
  </div>;
}
