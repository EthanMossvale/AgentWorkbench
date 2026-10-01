import type { AppState, Session } from '../../../packages/contracts';
import type { NativeFrame } from '../../../services/remote-supervisor';
import type { GeneratedImageDelivery, GeneratedImageReceipt, GeneratedImageService } from '../../../packages/generated-images/types';

export interface GeneratedImageObservation {
  service: GeneratedImageService;
  acknowledge?(receipt: GeneratedImageReceipt): Promise<{ removed: boolean }>;
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** The caller serializes this with activity persistence, before sending any receipt. */
export async function receiveGeneratedImage(frame: NativeFrame, activityId: string, initial: Session, snapshot: () => AppState,
  update: (change: (state: AppState) => void) => Promise<unknown>, images: GeneratedImageObservation) {
  const params = record(frame.value.params), item = record(params.item);
  if (frame.value.method !== 'item/completed' || item.type !== 'imageGeneration' || item.status !== 'completed') return;
  const current = (state: AppState) => {
    const session = state.sessions.find(s => s.id === initial.id);
    if (!session || session.projectPath !== initial.projectPath || session.binding.accountRef !== initial.binding.accountRef || session.binding.executionId !== initial.binding.executionId || session.binding.hostId !== initial.binding.hostId || session.binding.runtime !== 'codex') throw Error('GENERATED_IMAGE_SESSION_CHANGED');
    return session;
  };
  const set = (delivery: GeneratedImageDelivery) => update(state => {
    const activity = current(state).activities?.find(a => a.id === activityId);
    if (!activity) throw Error('GENERATED_IMAGE_ACTIVITY_MISSING');
    activity.imageDelivery = delivery;
    if (delivery.attachment) activity.title = delivery.attachment.path;
  });
  const before = current(snapshot()), previous = before.activities?.find(a => a.id === activityId)?.imageDelivery;
  if (previous?.status === 'saved') return; // Repeated completion is not a new generation.
  await set({ status: 'receiving', ...(initial.binding.egress === 'vps' ? {} : {remoteCopy:'not-applicable' as const}) });
  let attachment;
  try {
    if (typeof params.threadId !== 'string' || typeof params.turnId !== 'string' || typeof item.id !== 'string' || typeof item.result !== 'string' || !initial.projectPath) throw Error('GENERATED_IMAGE_IDENTITY_INVALID');
    if (params.threadId !== before.binding.nativeSessionId && !before.nativeChildren?.some(c => c.nativeChildId === params.threadId)) throw Error('GENERATED_IMAGE_THREAD_NOT_OWNED');
    attachment = await images.service.receive({ sessionId: initial.id, threadId: params.threadId, turnId: params.turnId, itemId: item.id, projectPath: initial.projectPath, result: item.result });
  } catch (error) {
    const code = error instanceof Error && /^GENERATED_IMAGE_[A-Z_]+$/.test(error.message) ? error.message : 'GENERATED_IMAGE_SAVE_FAILED';
    await set({ status: 'failed', error: code, remoteCopy: initial.binding.egress === 'vps' ? 'retained' : 'not-applicable' }); return;
  }
  const remote = initial.binding.egress === 'vps';
  // This must complete durably before remote deletion is even requested.
  await set({ status: 'saved', attachment, remoteCopy: remote ? 'pending' : 'not-applicable' });
  if (!remote) return;
  let removed = false;
  try {
    current(snapshot());
    removed = (await images.acknowledge?.({ threadId: params.threadId as string, turnId: params.turnId as string, itemId: item.id as string, sha256: attachment.sha256, size: attachment.size }))?.removed === true;
  } catch { /* Unconfirmed receipt never removes a local artifact or retries generation. */ }
  await set({ status: 'saved', attachment, remoteCopy: removed ? 'removed' : 'retained', ...(removed ? {} : { error: 'GENERATED_IMAGE_REMOTE_CLEANUP_UNCONFIRMED' }) });
}
