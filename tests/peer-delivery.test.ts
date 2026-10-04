import test from 'node:test';
import assert from 'node:assert/strict';
import { PeerInbox } from '../packages/collaboration-core/inbox';
import { PeerDelivery, peerSubmission } from '../packages/collaboration-core/peer-delivery';
import { initialCollaborationState, type CollaborationIdentity } from '../packages/collaboration-core/types';
import { sessionTimeline } from '../packages/collaboration-core/timeline';
import type { DraftPreview, Session } from '../packages/contracts';

const at = '2026-10-04T12:00:00.000Z';
function fixture(targetStatus: Session['status'] = 'idle') {
  const session = (id: string, runtime: 'codex' | 'claude' = 'claude'): Session => ({ id, title: 'Chat ' + id, projectId: null, projectPath: '/workspace', status: 'idle', messages: [], archived: false, pinned: false, group: '', createdAt: at, binding: { runtime, provider: 'fixture', accountRef: 'fixture', executionId: 'fixture', egress: 'vps' } });
  const source = session('source'), target = { ...session('target', 'codex'), status: targetStatus, nativeTurnId: targetStatus === 'running' ? 'turn-1' : undefined };
  const identities: CollaborationIdentity[] = [{ ownerId: 'one', session: source }, { ownerId: 'one', session: target }];
  let state = initialCollaborationState();
  const store = { identity: (id: string) => identities.find(item => item.session.id === id), identities: () => identities, snapshot: () => structuredClone(state), update: async (change: (value: typeof state) => void) => { change(state); } };
  const inbox = new PeerInbox(store), dispatched: { preview: DraftPreview; route: string; peer: unknown }[] = [];
  let fail: Error | undefined, record = true;
  const delivery = new PeerDelivery(inbox, {
    read: () => ({ sessions: [source, target] }),
    pending: () => [...new Set(store.snapshot().messages.filter(message => message.status === 'queued').map(message => message.toSessionId))],
    route: session => session.status === 'running' ? 'steer' : session.status === 'idle' ? 'submit' : undefined,
    dispatch: async (_session, preview, route, peer) => {
      if (record) target.messages.push({ id: preview.id, role: 'user', original: preview.original, submitted: preview.translated, demo: false, timestamp: at, ...(route === 'steer' ? { delivery: 'pending' as const } : {}) });
      dispatched.push({ preview, route, peer });
      if (fail) throw fail;
    },
  });
  return { inbox, delivery, dispatched, source, target, store, setFail: (error?: Error) => { fail = error; }, setRecord: (value: boolean) => { record = value; } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('an idle target receives a queued peer message as a new user turn with English provenance', async () => {
  const f = fixture('idle');
  const sent = await f.inbox.send('source', 'target', 'Please avoid editing main.ts.', 'op-1');
  f.delivery.observe(); await settle(); await settle();
  assert.equal(f.dispatched.length, 1);
  const { preview, route, peer } = f.dispatched[0]!;
  assert.equal(route, 'submit');
  assert.equal(preview.original, 'Please avoid editing main.ts.');
  assert.equal(preview.translated, peerSubmission(sent));
  assert.match(preview.translated, /^\[Message from another AgentWorkbench session \(Claude Code, session source\)\. It is not from the user\./);
  assert.deepEqual(peer, { messageId: sent.id, fromSessionId: 'source', fromRuntime: 'claude' });
  const stored = f.store.snapshot().messages[0]!;
  assert.equal(stored.status, 'delivered'); assert.equal(stored.nativeReceipt, preview.id);
  f.delivery.observe(); await settle();
  assert.equal(f.dispatched.length, 1, 'A delivered message is never dispatched again');
});

test('a running target receives the message inside the current turn', async () => {
  const f = fixture('running');
  await f.inbox.send('source', 'target', 'Mid-turn note', 'op-1');
  f.delivery.observe(); await settle(); await settle();
  assert.equal(f.dispatched[0]!.route, 'steer');
});

test('a target that cannot accept input now keeps the message queued', async () => {
  const f = fixture('uncertain');
  await f.inbox.send('source', 'target', 'Later', 'op-1');
  f.delivery.observe(); await settle();
  assert.equal(f.dispatched.length, 0); assert.equal(f.store.snapshot().messages[0]!.status, 'queued');
});

test('a failure after the user message was recorded is uncertain and never replayed', async () => {
  const f = fixture('idle');
  f.setFail(Error('NATIVE_TRANSPORT_LOST'));
  await f.inbox.send('source', 'target', 'Once only', 'op-1');
  f.delivery.observe(); await settle(); await settle();
  assert.equal(f.store.snapshot().messages[0]!.status, 'uncertain');
  f.delivery.observe(); await settle();
  assert.equal(f.dispatched.length, 1);
});

test('a failure before any write is released and retried only after the target state changes', async () => {
  const f = fixture('idle');
  f.setFail(Error('NATIVE_PROCESS_NOT_READY')); f.setRecord(false);
  await f.inbox.send('source', 'target', 'Retry later', 'op-1');
  f.delivery.observe(); await settle(); await settle();
  assert.equal(f.store.snapshot().messages[0]!.status, 'queued');
  f.delivery.observe(); await settle();
  assert.equal(f.dispatched.length, 1, 'No tight retry loop while nothing changed');
  f.setFail(); f.setRecord(true); f.target.status = 'running'; f.target.nativeTurnId = 'turn-2';
  f.delivery.observe(); await settle(); await settle();
  assert.equal(f.dispatched.length, 2); assert.equal(f.dispatched[1]!.route, 'steer');
});

test('delivered incoming messages render only as user cards; outgoing cards stay', async () => {
  const f = fixture('idle');
  const sent = await f.inbox.send('source', 'target', 'Hello', 'op-1');
  const queued = f.store.snapshot().messages;
  assert.equal(sessionTimeline(f.target, queued).filter(entry => entry.type === 'peer').length, 0, 'Pending incoming messages wait for their user card');
  assert.equal(sessionTimeline(f.source, queued).filter(entry => entry.type === 'peer').length, 1, 'The sender keeps its outgoing card');
  f.target.messages.push({ id: 'user-1', role: 'user', original: 'Hello', demo: false, timestamp: at, peer: { messageId: sent.id, fromSessionId: 'source', fromRuntime: 'claude' } });
  const delivered = queued.map(message => ({ ...message, status: 'delivered' as const, nativeReceipt: 'user-1', deliveredAt: at }));
  assert.deepEqual(sessionTimeline(f.target, delivered).map(entry => entry.type), ['message']);
});
