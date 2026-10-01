import { useLayoutEffect, useRef, useState } from 'react';
import type { AppState, DraftPreview, Session } from '../../../packages/contracts';
import { prepareAsyncQuestion, questionContext } from '../../../packages/native-interactions/inbox';
import { api } from './App';
import { preparedDraftAction, translationFlowPolicy } from './translation-flow';
import { errorText } from './ui';

export function useAsyncQuestionReply({ session, messageId, state, active, disabled, onBusyChange, onSent }: {
  session: Session; messageId: string; state: AppState | null; active: boolean; disabled: boolean;
  onBusyChange?: (busy: boolean) => void; onSent?: () => Promise<unknown>;
}) {
  const policy = translationFlowPolicy(state), context = questionContext(session);
  const [preview, setPreview] = useState<DraftPreview | null>(null), [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [submitting, setSubmitting] = useState(false), [error, setError] = useState('');
  const pending = useRef<string | null>(null), ready = useRef<DraftPreview | null>(null), sequence = useRef(0), sending = useRef(false), preparing = useRef(false);
  const latest = useRef({ policy, context, active, disabled, auto: !!state?.autoSubmitTranslated, onBusyChange, onSent });
  latest.current = { policy, context, active, disabled, auto: !!state?.autoSubmitTranslated, onBusyChange, onSent };
  const cancel = () => {
    if (sending.current) return;
    sequence.current++; preparing.current = false;
    if (pending.current) void api('draft/cancel', { requestId: pending.current }).catch(() => {});
    if (ready.current) void api('draft/cancel', { id: ready.current.id }).catch(() => {});
    pending.current = null; ready.current = null; setPreview(null); setBusy(false); latest.current.onBusyChange?.(false);
  };
  useLayoutEffect(() => { cancel(); }, [policy.key, context, active, messageId]);
  useLayoutEffect(() => () => { cancel(); latest.current.onBusyChange?.(false); }, []);

  const submit = async (value: DraftPreview, automatic = false) => {
    if (sending.current || ready.current?.id !== value.id || !latest.current.active || latest.current.disabled) return;
    sending.current = true; setSubmitting(true); setBusy(true); setError('');
    try {
      await api('draft/submit', { sessionId: session.id, id: value.id, sourceHash: value.sourceHash, automatic });
      ready.current = null; setPreview(null); setSent(true);
      // A failed state refresh must never turn an acknowledged reply into a retry.
      await latest.current.onSent?.().catch(() => {});
    } catch (failure) {
      ready.current = null; setPreview(null); setError(errorText(failure));
    } finally { sending.current = false; setSubmitting(false); setBusy(false); latest.current.onBusyChange?.(false); }
  };
  const prepare = async (answers: Record<string, string[]>) => {
    if (!state || !active || disabled || sent || preparing.current || sending.current || ready.current) return;
    preparing.current = true; setBusy(true); setError(''); latest.current.onBusyChange?.(true);
    const currentSequence = ++sequence.current, requested = policy, requestedContext = context, requestId = crypto.randomUUID(); pending.current = requestId;
    try {
      const source = prepareAsyncQuestion(session, { messageId, answers }).original;
      const value = await api<DraftPreview>('draft/prepare', { sessionId: session.id, questionReply: { messageId, answers }, requestId });
      const action = preparedDraftAction({ requested, current: latest.current.policy, preview: value, source, bypass: false, autoSubmit: latest.current.auto });
      if (currentSequence !== sequence.current || !latest.current.active || latest.current.context !== requestedContext || action === 'discard') { await api('draft/cancel', { id: value.id }); return; }
      ready.current = value;
      if (action === 'review') setPreview(value);
      else await submit(value, action === 'submit-translated');
    } catch (failure) { if (currentSequence === sequence.current) setError(errorText(failure)); }
    finally {
      if (currentSequence === sequence.current) { pending.current = null; preparing.current = false; setBusy(false); if (!ready.current) latest.current.onBusyChange?.(false); }
    }
  };
  return { preview, busy, submitting, sent, error, setError, cancel, prepare, confirm: () => preview && void submit(preview) };
}
