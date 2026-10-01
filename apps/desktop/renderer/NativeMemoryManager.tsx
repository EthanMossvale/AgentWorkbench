import {RememberedTextarea} from './UiMemory';
import {useUiPreference} from './ui-preferences';
import { useEffect, useRef, useState } from 'react';
import { api } from './App';
import { Icon, Modal, errorText } from './ui';
import type { NativeMemoryDocument, NativeMemoryEntry, NativeMemoryStatus, NativeMemoryCatalog, MemoryArchiveDocument, MemoryArchiveEntry, CatalogMemoryEntry, EvidenceState } from '../../../packages/native-memory';

const providerName = (entry: NativeMemoryEntry) => entry.provider === 'codex' ? 'Codex' : 'Claude Code';
const scopeName = (entry: { scope: string }) => /^User instructions/.test(entry.scope) ? '全局指令' : /^User rules/.test(entry.scope) ? '全局规则' : /^Claude project:/.test(entry.scope) ? `项目 ${entry.scope.slice(16)}` : /^Project:/.test(entry.scope) ? '项目记忆' : '原生记忆';
const runtimeName = (provider: string) => provider === 'codex' ? 'Codex' : 'Claude Code';
const receiptState: Record<EvidenceState, string> = { unchanged: '接收证据未变', changed: '接收后有变动', unavailable: '接收文件当前不可用', unknown: '当前证据未核实' };
const archiveStatus = (entry: MemoryArchiveEntry) => ({ received: '已接收', pending: `待 ${runtimeName(entry.recipient)} 接收`, receiving: '接收任务处理中', verification_failed: '回执待核验', superseded: '已被后续版本替代' })[entry.status];
const provenanceLabel = (entry?: CatalogMemoryEntry) => entry?.provenance.length ? `来源 ${[...new Set(entry.provenance.map(p => runtimeName(p.origin)))].join('、')} · 已核验接收${entry.provenance.some(p => p.currentState === 'changed') ? ' · 接收后有变动' : entry.provenance.some(p => p.currentState === 'unknown') ? ' · 当前证据未核实' : ''}` : '本机原生文件';
type Tab = 'codex' | 'claude' | 'workbench';
const managementError = (message: string) => /archive/i.test(message) ? '存档原文暂时无法核验，历史交接记录仍保留。' : /changed/.test(message) ? '这份记忆已在其他地方更新。草稿已保留，请重新读取后再修改。' : /no longer exists/.test(message) ? '这份记忆已被移除，请返回并刷新列表。' : /settings/.test(message) ? '原生配置暂时无法读取，请修复后重试。' : /markers/.test(message) ? '正文不能包含工作台的同步标记。' : /Linked/.test(message) ? '记忆路径包含链接，已保留原文件。' : /bounded/.test(message) ? '记忆不能为空，且不能超过 2 MB。' : '无法完成操作，原始错误可在提示中查看。';

export default function NativeMemoryManager({ onClose, notify, onChanged }: { onClose: () => void; notify: (message: string) => void; onChanged: () => void }) {
  const [catalog, setCatalog] = useState<NativeMemoryCatalog | null>(null), [query, setQuery] = useState(''), [tab, setTab] = useUiPreference<Tab>('settings.memory-tab'), [limit, setLimit] = useState(200);
  const [archive, setArchive] = useState<MemoryArchiveDocument | null>(null);
  const [document, setDocument] = useState<NativeMemoryDocument | null>(null), [draft, setDraft] = useState(''), [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [deleting, setDeleting] = useState(false), [discard, setDiscard] = useState<'close' | 'back' | 'reload' | null>(null);
  const active = useRef(true), locked = useRef(false), generation = useRef(0), catalogGeneration = useRef(0);
  const dirty = !!document && draft !== document.content;
  const run = async (operation: () => Promise<void>) => {
    if (locked.current) return; locked.current = true; setBusy(true); setError('');
    try { await operation(); } catch (failure) { if (active.current) setError(errorText(failure)); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  };
  const reload = async () => { const request = ++catalogGeneration.current, result = await api<NativeMemoryCatalog>('native-memory/catalog'); if (active.current && request === catalogGeneration.current) setCatalog(result); };
  useEffect(() => {
    active.current = true; void run(reload);
    // Refresh metadata only: external edits must never replace an open draft/revision.
    const refresh = () => { if (!locked.current) void reload().catch(() => {}); };
    const timer = window.setInterval(refresh, 5000); window.addEventListener('focus', refresh);
    return () => { active.current = false; generation.current++; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const open = async (id: string) => {
    const request = ++generation.current, result = await api<NativeMemoryDocument>('native-memory/read', { id });
    if (active.current && request === generation.current) { setArchive(null); setDocument(result); setDraft(result.content); setEditing(false); setDeleting(false); }
  };
  const openArchive = async (id: string) => {
    const request = ++generation.current, result = await api<MemoryArchiveDocument>('native-memory/archive/read', { id });
    if (active.current && request === generation.current) { setDocument(null); setArchive(result); setEditing(false); }
  };
  const navigate = (target: 'close' | 'back' | 'reload', confirmed = false) => {
    if (locked.current) return;
    if (dirty && !confirmed) { setDiscard(target); return; }
    setDiscard(null); setDeleting(false); setError('');
    if (target === 'close') onClose();
    else if (target === 'back') { setDocument(null); setArchive(null); setEditing(false); void run(reload); }
    else if (document) void run(() => open(document.id));
    else if (archive) void run(async () => { await reload(); await openArchive(archive.id); });
  };
  const mutate = (remove: boolean) => void run(async () => {
    if (!document) return;
    const status = await api<NativeMemoryStatus>(remove ? 'native-memory/delete' : 'native-memory/write', { id: document.id, revision: document.revision, ...(remove ? {} : { content: draft }) });
    if (!active.current) return;
    notify((remove ? '记忆已删除' : '记忆已保存') + (status.enabled && status.lastError ? '，交接档案暂未更新' : status.enabled && !status.needsInitialImport ? '，已更新交接档案' : '；开启并完成首次上传后交接'));
    onChanged(); setDeleting(false); await reload();
    if (remove) { setDocument(null); setEditing(false); }
    else await open(document.id);
  });
  const matches = (text: string) => text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const filtered = catalog?.native.filter(entry => entry.provider === tab && matches(`${entry.name} ${entry.relative} ${entry.preview} ${providerName(entry)} ${scopeName(entry)} ${provenanceLabel(entry)}`));
  const archives = catalog?.archives.filter(entry => matches(`${entry.name} ${entry.relative} ${entry.scope} ${runtimeName(entry.origin)} ${runtimeName(entry.recipient)} ${archiveStatus(entry)}`));
  const nativeDetail = catalog?.native.find(entry => entry.id === document?.id);
  const archiveDetail = archive && { ...archive, ...catalog?.archives.find(entry => entry.id === archive.id) };
  const chooseTab = (value: Tab) => { setTab(value); setQuery(''); setLimit(200); };
  return <Modal title={document?.name || archive?.name || '记忆'} onClose={() => navigate('close')} className={`native-memory-modal${archive ? ' memory-archive-modal' : ''}`}>
    {discard ? <div className="memory-confirm" role="alert"><p>放弃尚未保存的修改？</p><div className="memory-actions"><button className="button secondary" onClick={() => setDiscard(null)}>继续编辑</button><button className="button danger" onClick={() => navigate(discard, true)}>放弃修改</button></div></div> : <>
      {document ? <>
        <div className="memory-detail-header"><button className="button secondary" disabled={busy} onClick={() => navigate('back')}>返回列表</button><span>{providerName(document)} · {scopeName(document)}</span><button className="icon-button" aria-label="重新读取记忆" title="重新读取" disabled={busy} onClick={() => navigate('reload')}><Icon name="refresh" size={16}/></button></div>
        <p className="memory-file-name" title={document.relative}>{document.relative}</p>
        <p className="memory-provenance">{provenanceLabel(nativeDetail)}</p>
        <RememberedTextarea memoryId="NativeMemoryManager.editor.1" className="memory-editor" aria-label="记忆内容" data-testid="native-memory-content" readOnly={!editing || busy || deleting} value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false}/>
        {deleting ? <div className="memory-confirm" role="alert"><p>删除这份 {providerName(document)} 原始记忆？{document.provider === 'codex' ? 'Claude Code' : 'Codex'} 会在下次任务收到来源撤回通知；不会直接删除其原生记忆。</p><div className="memory-actions"><button className="button secondary" disabled={busy} onClick={() => setDeleting(false)}>取消删除</button><button className="button danger" disabled={busy} onClick={() => mutate(true)}>确认删除</button></div></div> : <div className="memory-actions"><button className="button secondary memory-delete" disabled={busy || dirty} onClick={() => setDeleting(true)}>删除记忆</button>{editing ? <><button className="button secondary" disabled={busy} onClick={() => { setDraft(document.content); setEditing(false); setError(''); }}>取消编辑</button><button className="button" disabled={busy || !dirty || !draft.trim()} onClick={() => mutate(false)}>保存修改</button></> : <button className="button" disabled={busy} onClick={() => setEditing(true)}>编辑记忆</button>}</div>}
      </> : <>
        {archiveDetail ? <>
          <div className="memory-detail-header"><button className="button secondary" disabled={busy} onClick={() => navigate('back')}>返回列表</button><span>工作台 · 来源 {runtimeName(archiveDetail.origin)} → {runtimeName(archiveDetail.recipient)}</span><button className="icon-button" aria-label="重新读取记忆" title="重新读取" disabled={busy} onClick={() => navigate('reload')}><Icon name="refresh" size={16}/></button></div>
          <div className="memory-archive-status" data-testid="memory-archive-status"><strong>{archiveStatus(archiveDetail)}</strong>{archiveDetail.currentState && <span>{receiptState[archiveDetail.currentState]}</span>}<span>{archiveDetail.operation === 'withdraw' ? '来源撤回' : '来源存档'} · 第 {archiveDetail.revision} 版</span></div>
          <p className="memory-file-name" title={archiveDetail.relative}>{archiveDetail.relative} · {scopeName(archiveDetail)}</p>
          <p className="memory-archive-time">存档 <time dateTime={archiveDetail.createdAt}>{new Date(archiveDetail.createdAt).toLocaleString()}</time>{archiveDetail.acknowledgedAt && <> · 核验接收 <time dateTime={archiveDetail.acknowledgedAt}>{new Date(archiveDetail.acknowledgedAt).toLocaleString()}</time></>}</p>
          {archiveDetail.operation === 'withdraw' && <p className="inline-note">来源已撤回，以下保留第 {archiveDetail.contentRevision} 版的原文证据。</p>}
          <RememberedTextarea memoryId="NativeMemoryManager.editor.2" className="memory-editor" aria-label="存档原文" data-testid="memory-archive-content" readOnly value={archiveDetail.content} spellCheck={false}/>
          <p className="inline-note">只读交接记录。接收后的原文或标记变动、文件移除，均不会移除此记录或撤销历史接收状态。</p>
          <div className="memory-archive-links">{[archiveDetail.sourceMemoryId, ...archiveDetail.destinationMemoryIds].filter((id): id is string => !!id).map(id => { const entry = catalog?.native.find(item => item.id === id); return entry && <button key={id} className="button secondary" disabled={busy} onClick={() => void run(() => open(id))}>查看 {runtimeName(entry.provider)} · {entry.name}</button>; })}</div>
        </> : <>
          <div className="skill-tabs memory-tabs" role="tablist" aria-label="记忆归属">{(['codex', 'claude', 'workbench'] as const).map((value, index, tabs) => <button key={value} id={`memory-tab-${value}`} role="tab" aria-controls="memory-tab-panel" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} disabled={busy} data-testid={`memory-tab-${value}`} onClick={() => chooseTab(value)} onKeyDown={event => { const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1; if (next >= 0) { event.preventDefault(); chooseTab(tabs[next]!); event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus(); } }}>{value === 'workbench' ? '工作台' : runtimeName(value)}<span>{catalog ? value === 'workbench' ? catalog.archives.length : catalog.native.filter(e => e.provider === value).length : ''}</span></button>)}</div>
          <div id="memory-tab-panel" role="tabpanel" aria-labelledby={`memory-tab-${tab}`}>
            <div className="memory-list-toolbar"><label className="skill-search"><Icon name="search" size={15}/><input aria-label="搜索记忆" placeholder="搜索记忆" value={query} onChange={event => { setQuery(event.target.value); setLimit(200); }}/></label><button className="icon-button" aria-label="刷新记忆" title="刷新记忆" disabled={busy} onClick={() => void run(reload)}><Icon name="refresh" size={16}/></button></div>
            <p className="inline-note">{tab === 'workbench' ? '保留全部来源档案与交接记录，包括待接收、已接收和历史版本。' : `管理 ${runtimeName(tab)} 的原始记忆；已核验接收的文件另标注来源。`}</p>
            {catalog?.nativeUnavailable && <p className="inline-error">部分原生记忆暂时无法读取；工作台历史记录仍保留，当前文件状态未核实。</p>}
            <div className="memory-entry-list" data-testid="native-memory-list">{!catalog ? <p>{busy ? '正在读取记忆…' : '暂时无法读取记忆'}</p> : tab === 'workbench' ? !archives?.length ? <p className="shared-empty">没有匹配的交接记录</p> : archives.slice(0, limit).map(entry => <button key={entry.id} className="memory-entry" data-archive-id={entry.id} disabled={busy} onClick={() => void run(() => openArchive(entry.id))}><span className="memory-entry-title"><strong>{entry.name}</strong><span>{archiveStatus(entry)}</span></span><span className="memory-entry-preview">来源 {runtimeName(entry.origin)} → {runtimeName(entry.recipient)} · 第 {entry.revision} 版{entry.operation === 'withdraw' ? ' · 来源撤回' : ''}{entry.currentState ? ` · ${receiptState[entry.currentState]}` : ''}</span><small title={entry.relative}>{entry.relative}</small></button>) : !filtered?.length ? <p className="shared-empty">没有匹配的记忆</p> : filtered.slice(0, limit).map(entry => <button key={entry.id} className="memory-entry" disabled={busy} onClick={() => void run(() => open(entry.id))}><span className="memory-entry-title"><strong>{entry.name}</strong><span>{scopeName(entry)}</span></span><span className="memory-provenance">{provenanceLabel(entry)}</span><span className="memory-entry-preview">{entry.preview}</span><small title={entry.relative}>{entry.relative}</small></button>)}</div>
            {(tab === 'workbench' ? archives?.length ?? 0 : filtered?.length ?? 0) > limit && <button className="button secondary" onClick={() => setLimit(limit + 200)}>显示更多</button>}
          </div>
        </>}
      </>}
      {error && <p className="inline-error" role="alert" title={error}>{managementError(error)}</p>}
    </>}
  </Modal>;
}
