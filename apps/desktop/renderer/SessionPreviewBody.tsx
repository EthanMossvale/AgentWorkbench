import { useEffect, useState } from 'react';
import type { Session } from '../../../packages/contracts';
import { boundedPreview, SESSION_PREVIEW_EXCERPT, SESSION_PREVIEW_LIMIT, type SessionPreview } from '../../../packages/session-core/presentation';
import { api } from './App';
import './SessionPreview.css';

export default function SessionPreviewBody({session, expanded}: {session: Session; expanded: boolean}) {
  const [preview, setPreview] = useState<SessionPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [extensions, setExtensions] = useState(0);
  const first = session.messages.find(message => message.role === 'user');
  useEffect(() => window.workbench.onExtensions?.(() => setExtensions(value => value + 1)), []);
  useEffect(() => {
    let active = true;
    setPreview(null); setFailed(false);
    if (!first) return;
    void api<SessionPreview>('session/preview', {sessionId: session.id}).then(value => {
      if (!active) return;
      const content = boundedPreview(value.content, SESSION_PREVIEW_LIMIT);
      const excerpt = boundedPreview(value.excerpt, SESSION_PREVIEW_EXCERPT + 1);
      setPreview({...value, content: content.text, excerpt: excerpt.text, truncated: value.truncated || content.truncated});
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [session.id, first?.id, first?.original, first?.submitted, first?.translation, first?.translationStatus, extensions]);
  if (!first) return null;
  return <div data-workbench-session-preview-body data-session-id={session.id} className="session-preview-body" data-expanded={expanded}>
    <div className="session-preview-body-label">首条消息{preview?.source === 'translation' && <span> · 译文</span>}</div>
    <p className="session-preview-text">{failed ? '暂时无法读取预览' : !preview ? '正在读取…' : preview.source === 'empty' ? '此消息没有文字内容' : expanded ? preview.content : preview.excerpt}</p>
    {preview && preview.source !== 'empty' && <small className="session-preview-hint">{expanded ? preview.truncated ? `仅显示前 ${SESSION_PREVIEW_LIMIT} 字` : '' : '移入查看详情 · 点击标题可改名'}</small>}
  </div>;
}
