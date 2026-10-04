import type { DraftPreview } from '../../../packages/contracts';
import type { SkillInvocation } from '../../../packages/native-skills/invocation';
import type { AttachmentView } from '../../../packages/attachments/types';

/** Composer work that outlived its workspace view; the next view of the same session adopts it. */
export interface ParkedDraft {
  text: string;
  skills: SkillInvocation[];
  attachments: AttachmentView[];
  isDemoSample: boolean;
  /** A host preview that still waits for the user's confirmation. */
  preview?: DraftPreview;
  /** Translation policy key the preview was prepared under. */
  policy?: string;
  error?: string;
}
type Listener = (sessionId: string) => void;
const parked = new Map<string, ParkedDraft>();
const listeners = new Set<Listener>();
export const draftHandoff = {
  /** Returns the displaced entry so the caller can release its host preview. */
  park(sessionId: string, draft: ParkedDraft): ParkedDraft | undefined {
    const previous = parked.get(sessionId);
    parked.set(sessionId, draft);
    for (const listener of [...listeners]) listener(sessionId);
    return previous;
  },
  take(sessionId: string): ParkedDraft | undefined {
    const draft = parked.get(sessionId);
    parked.delete(sessionId);
    return draft;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
