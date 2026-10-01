import type { DraftPreview, Session, Message } from '../contracts';
import {annotationDraft} from '../context-annotations';

export interface DraftRecovery {
  id: string;
  preview: DraftPreview;
  outcome: 'pending' | 'not-sent' | 'failed' | 'uncertain';
}
/** Durable original input; observing a receipt never submits or replays work. */
export interface DraftRecoveryService {
  pendingMessages(session: Session, timestamp: string): Message[];
  capture(session: Session, preview: DraftPreview): void;
  observe(previous: Session | undefined, session: Session): void;
  fail(session: Session, id: string): void;
  dismiss(session: Session, id: string): void;
  restart(session: Session): void;
}
export const draftRecovery: DraftRecoveryService = {
  pendingMessages(session,timestamp) {
    return (session.draftRecoveries??[]).filter(item=>item.outcome==='pending'&&!session.messages.some(message=>message.id===item.id)).map(({preview})=>({
      id:preview.id,role:'user',original:preview.original,submitted:preview.translated,annotations:preview.annotations,attachments:preview.attachments,skills:preview.skills,draftRevisions:preview.revisions,demo:preview.demo,timestamp,delivery:'pending',
    }));
  },
  capture(session, preview) {
    if (session.draftRecoveries?.some(item => item.id === preview.id)) throw Error('DRAFT_RECOVERY_CONFLICT');
    if ((session.draftRecoveries?.length ?? 0) >= 32) throw Error('DRAFT_RECOVERY_FULL: Review saved failed inputs before sending another message.');
    session.draftRecoveries ??= [];
    session.draftRecoveries.push({ id: preview.id, preview: structuredClone(preview), outcome: 'pending' });
  },
  observe(previous, session) {
    for (const item of [...session.draftRecoveries ?? []]) {
      if (item.outcome !== 'pending') continue;
      const before = previous?.draftRecoveries?.find(entry => entry.id === item.id);
      if (!before || session.status === 'running') continue;
      const message = session.messages.find(message => message.id === item.id);
      if (session.status === 'uncertain') item.outcome = 'uncertain';
      else if (session.nativeError && (previous?.status === 'running' || previous?.nativeError !== session.nativeError)) {
        item.outcome = !message || message.delivery === 'not-sent' ? 'not-sent' : session.nativeTurnStatus === 'failed' ? 'failed' : 'uncertain';
      } else if (message && session.status === 'idle' && !session.nativeError) {
        session.draftRecoveries = session.draftRecoveries?.filter(entry => entry.id !== item.id);
      }
    }
  },
  fail(session, id) {
    const item = session.draftRecoveries?.find(entry => entry.id === id);
    if (item?.outcome === 'pending') {
      const message = session.messages.find(message => message.id === id);
      item.outcome = !message || message.delivery === 'not-sent' ? 'not-sent' : 'uncertain';
    }
  },
  dismiss(session, id) {
    const item = session.draftRecoveries?.find(entry => entry.id === id);
    if (!item || item.outcome === 'pending') throw Error('DRAFT_RECOVERY_CONFLICT');
    session.draftRecoveries = session.draftRecoveries?.filter(entry => entry.id !== id);
  },
  restart(session) {
    if (session.draftRecoveries === undefined) return;
    if (!Array.isArray(session.draftRecoveries) || session.draftRecoveries.length > 32) throw Error('DRAFT_RECOVERY_INVALID');
    const ids = new Set<string>();
    for (const item of session.draftRecoveries) {
      if (!item || typeof item.id !== 'string' || ids.has(item.id) || item.preview?.id !== item.id ||
          typeof item.preview.original !== 'string' || typeof item.preview.translated !== 'string' ||
          typeof item.preview.sourceHash !== 'string' || !Number.isSafeInteger(item.preview.revision) ||
          [item.preview.attachments,item.preview.skills,item.preview.annotations].some(value=>value!==undefined&&!Array.isArray(value)) ||
          item.preview.attachments?.some(value=>!value||typeof value.id!=='string'||typeof value.name!=='string'||typeof value.mime!=='string'||!Number.isFinite(value.size)) ||
          item.preview.skills?.some(value=>!value||typeof value.id!=='string'||typeof value.hash!=='string'||typeof value.displayName!=='string') ||
          !['pending', 'not-sent', 'failed', 'uncertain'].includes(item.outcome)) throw Error('DRAFT_RECOVERY_INVALID');
      if(item.preview.annotations)annotationDraft({version:1,revision:0,items:item.preview.annotations});
      ids.add(item.id);
      if (item.outcome === 'pending') item.outcome = 'uncertain';
    }
  },
};
