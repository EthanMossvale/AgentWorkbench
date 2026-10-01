import type { Session } from '../contracts';

export type SessionTitleSource = 'fallback' | 'native' | 'manual';
export interface SessionTitleMetadata { titleSource?: SessionTitleSource }
export interface SessionPreview {
  messageId?: string;
  source: 'translation' | 'original' | 'submitted' | 'empty';
  excerpt: string;
  content: string;
  truncated: boolean;
}
export const SESSION_PREVIEW_EXCERPT = 180;
export const SESSION_PREVIEW_LIMIT = 1200;
export interface SessionPresentationService {
  fallback(session: Session, title: string): boolean;
  nativeTitle(session: Session, title: unknown): boolean;
  codex(session: Session, threadId: string | undefined, frame: { method?: unknown; params?: unknown }): boolean;
  preview(session: Session): SessionPreview;
}

/** Read at most limit + 1 code points, even for very large prompts. */
export function boundedPreview(text: string, limit: number): { text: string; truncated: boolean } {
  let value = '', count = 0;
  for (const point of text) {
    if (count++ === limit) return { text: value, truncated: true };
    value += point;
  }
  return { text: value, truncated: false };
}

/** Synchronous presentation policy. Never calls a model or changes native data. */
export class SessionPresentation implements SessionPresentationService {
  fallback(session: Session, title: string): boolean {
    if (session.branch || session.agentCreated || session.agentParent || session.titleSource === 'manual' || session.titleSource === 'native') return false;
    session.title = title;
    session.titleSource = 'fallback';
    return true;
  }

  nativeTitle(session: Session, title: unknown): boolean {
    // Unmarked legacy titles may have been renamed; do not guess their origin.
    if (!['fallback', 'native'].includes(session.titleSource ?? '') || session.branch || session.agentCreated || session.agentParent) return false;
    if (typeof title !== 'string' || !title.trim() || title.length > 500 || /[\u0000-\u001f\u007f]/.test(title)) return false;
    session.title = title;
    session.titleSource = 'native';
    return true;
  }

  codex(session: Session, threadId: string | undefined, frame: { method?: unknown; params?: unknown }): boolean {
    const p = frame.params as { threadId?: unknown; threadName?: unknown } | undefined;
    if (frame.method !== 'thread/name/updated' || !threadId || p?.threadId !== threadId || session.binding.nativeSessionId !== threadId) return false;
    return this.nativeTitle(session, p.threadName);
  }

  preview(session: Session): SessionPreview {
    const message = session.messages.find(item => item.role === 'user');
    if (!message) return { source: 'empty', excerpt: '', content: '', truncated: false };
    const translated = message.translation && (!message.translationStatus || message.translationStatus === 'complete') && message.translation.trim();
    // For translated input, original is the saved user-language draft;
    // submitted is the model-facing text. Preserve that existing counterpart.
    const source = translated ? 'translation' : message.original.trim() ? 'original' : message.submitted?.trim() ? 'submitted' : 'empty';
    const value = source === 'translation' ? message.translation! : source === 'original' ? message.original : source === 'submitted' ? message.submitted! : '';
    const content = boundedPreview(value, SESSION_PREVIEW_LIMIT);
    const excerpt = boundedPreview(content.text, SESSION_PREVIEW_EXCERPT);
    return { messageId: message.id, source, excerpt: excerpt.text + (excerpt.truncated || content.truncated ? '…' : ''), content: content.text, truncated: content.truncated };
  }
}

/** Registered as sessions.presentation; every host consumer uses this instance. */
export const sessionPresentation = new SessionPresentation();
