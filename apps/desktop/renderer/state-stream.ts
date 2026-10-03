import type { AppState } from '../../../packages/contracts';
import { createStateReceiver } from '../../../packages/session-core/state-stream';
import { shareState } from './state-sharing';

/**
 * Renderer-owned application state stream. Patches are merged in this world so
 * unchanged sessions keep their identity, and listeners are notified at most once
 * per frame however fast the host publishes. A bridge without patches falls back
 * to the legacy whole-state listener.
 */
type Listener = (state: AppState) => void;
const listeners = new Set<Listener>();
const receiver = createStateReceiver(shareState);
let started = false, scheduled = false, resyncing = false, latest: AppState | undefined;

function deliver() {
  if (!scheduled || !latest) return;
  scheduled = false;
  const state = latest;
  for (const listener of [...listeners]) {
    try { listener(state); } catch (error) { queueMicrotask(() => { throw error; }); }
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  // The timeout keeps hidden or occluded windows current when frames are paused.
  requestAnimationFrame(deliver);
  setTimeout(deliver, 100);
}

function start() {
  if (started) return;
  const bridge = window.workbench;
  if (!bridge) return;
  started = true;
  if (!bridge.onStatePatch) { bridge.onState(state => { latest = state; schedule(); }); return; }
  bridge.onStatePatch(patch => {
    const state = receiver.apply(patch);
    if (state === 'resync') { resyncing = true; bridge.requestStateResync?.(); return; }
    resyncing = false; latest = state; schedule();
  });
}

export const stateStream = Object.freeze({
  onState(listener: Listener): () => void {
    start();
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** Deliver a pending merged state now, e.g. before reading it after a user action. */
  flush() { deliver(); },
  /**
   * Current state after the host republishes changes; the host sends the patch
   * before answering. Undefined until the stream holds a complete state.
   */
  async sync(): Promise<AppState | undefined> {
    start();
    const bridge = window.workbench;
    if (!bridge?.onStatePatch || !receiver.current() || resyncing) return undefined;
    await bridge.call('state/sync');
    const state = receiver.current();
    if (!state || resyncing) return undefined;
    deliver(); return state;
  },
});
