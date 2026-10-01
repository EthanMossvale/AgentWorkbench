import {RememberedDetails} from './UiMemory';
import { useState } from 'react';
import type { Session } from '../../../packages/contracts';
import { asyncQuestionState } from '../../../packages/native-interactions/inbox';
import { api } from './App';
import { errorText } from './ui';

export default function QuestionInbox({ session, refresh, disabled = false }: { session: Session; refresh: () => Promise<unknown>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const items = [
    ...session.messages.filter(message => asyncQuestionState(session, message) === 'deferred').map(message => ({ key: message.id, label: message.questions![0]!.question, target: { messageId: message.id }, blocking: false })),
    ...(session.nativeInteractions ?? []).filter(item => item.kind === 'questions' && item.status === 'pending' && item.deferred).map(item => ({ key: item.receipt!, label: item.questions?.[0]?.question ?? item.title, target: { receipt: item.receipt! }, blocking: item.blocking })),
  ];
  const act = async (target: { messageId?: string; receipt?: string }, action: 'show' | 'dismiss') => {
    if (busy || disabled) return; setBusy(true); setError('');
    try { await api('interaction/presentation', { sessionId: session.id, ...target, action }); await refresh(); }
    catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  };
  if (!items.length) return null;
  return <RememberedDetails memoryId="QuestionInbox.details.1" className="native-question-inbox" data-testid="question-inbox"><summary>待回答 · {items.length}</summary>
    {items.map(item => <div key={item.key}><span>{item.label}{item.blocking && <small>运行时仍在等待</small>}</span><button className="text-button" disabled={busy || disabled} onClick={() => void act(item.target, 'show')}>回答</button><button className="text-button" disabled={busy || disabled} onClick={() => void act(item.target, 'dismiss')}>忽略问题</button></div>)}
    {error && <p className="native-interaction-error" role="alert">{error}</p>}
  </RememberedDetails>;
}
