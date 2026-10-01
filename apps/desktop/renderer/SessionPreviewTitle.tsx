import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Session } from '../../../packages/contracts';
import { api } from './App';
import { Icon } from './ui';

export default function SessionPreviewTitle({session}: {session: Session}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null), button = useRef<HTMLButtonElement>(null);
  const active = useRef(true), pending = useRef(false), restoreFocus = useRef(false);
  const errorId = useId();
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useLayoutEffect(() => {
    if (editing) { input.current?.focus(); input.current?.select(); }
    else if (restoreFocus.current) { restoreFocus.current = false; button.current?.focus(); }
  }, [editing]);
  const finish = () => { restoreFocus.current = true; setEditing(false); setError(''); };
  const save = async () => {
    if (pending.current) return;
    const title = draft.trim();
    if (!title || title.length > 150) { setError(!title ? '请输入会话标题' : '标题最多 150 个字符'); input.current?.focus(); return; }
    if (title === session.title) { finish(); return; }
    pending.current = true; setSaving(true); setError('');
    try {
      await api('session/update', {id: session.id, title});
      if (active.current) finish();
    } catch (cause) {
      if (active.current) { setError(`保存失败：${cause instanceof Error ? cause.message : String(cause)}`); input.current?.focus(); }
    } finally {
      pending.current = false;
      if (active.current) setSaving(false);
    }
  };
  return <strong data-workbench-session-preview-title data-session-id={session.id}>
    {editing ? <div className="session-preview-title-editor" aria-busy={saving}>
      <div className="session-preview-title-controls">
        <input ref={input} aria-label="会话标题" aria-invalid={!!error} aria-describedby={error ? errorId : undefined} value={draft} maxLength={150} readOnly={saving} onChange={event => { setDraft(event.target.value); setError(''); }} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) { event.stopPropagation(); return; }
          if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void save(); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!pending.current) finish(); }
        }}/>
        <button type="button" aria-label="保存会话标题" title="保存" disabled={saving} onClick={() => void save()}><Icon name="check" size={13}/></button>
        <button type="button" aria-label="取消重命名" title="取消" disabled={saving} onClick={finish}><Icon name="close" size={13}/></button>
      </div>
      {error && <small id={errorId} role="alert" className="session-preview-title-error">{error}</small>}
    </div> : <button ref={button} type="button" className="session-preview-title-button" aria-label="重命名会话标题" title="重命名会话" onClick={() => { setDraft(session.title); setError(''); setEditing(true); }}>{session.title}<Icon name="compose" size={12}/></button>}
  </strong>;
}
