import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { PeerInbox, recoverCollaborationState } from '../packages/collaboration-core/inbox';
import { initialCollaborationState, type CollaborationIdentity, type CollaborationState } from '../packages/collaboration-core/types';

function fixture() {
  let state = initialCollaborationState(), queue = Promise.resolve();
  const identities: CollaborationIdentity[] = ['a', 'b', 'c', 'd'].map(id => ({ ownerId: 'same-owner', session: { id, title: id, projectId: null, status: 'idle', messages: [], archived: false, pinned: false, group: '', createdAt: 'fixture', binding: { runtime: id === 'b' ? 'claude' : 'codex', provider: 'fixture', accountRef: 'own-profile', executionId: 'executor', egress: 'vps' } } }));
  const store = {
    snapshot: () => structuredClone(state),
    update: async (change: (next: CollaborationState) => void) => { const op = queue.then(() => { const next = structuredClone(state); change(next); state = next; }); queue = op.catch(() => {}); await op; },
    identity: (id: string) => identities.find(identity => identity.session.id === id), identities: () => identities,
  };
  return { hub: new PeerInbox(store), store, identities };
}

test('unrelated collaboration cannot wake a waiting agent or advance its visible cursor', async t => {
  const f = fixture(); t.after(() => f.hub.dispose());
  let woke = false;
  const waiting = f.hub.wait('b', 0, 1000).then(result => { woke = true; return result; });
  for (let i = 0; i < 10; i++) await f.hub.send('c', 'd', 'Unrelated task.', `other-${i}`);
  await setImmediate(); assert.equal(woke, false); assert.equal(f.hub.read('b').revision, 0);
  const own = await f.hub.send('a', 'b', 'Requested assistance.', 'own');
  const result = await waiting; assert.deepEqual(result.messages.map(message => message.id), [own.id]);
  assert.equal(result.revision, own.revision); assert.equal(result.revision, 11);
});

test('idempotent sends do not manufacture repeated inbox wakeups', async t => {
  const f = fixture(); t.after(() => f.hub.dispose());
  const first = await f.hub.send('a', 'b', 'One request.', 'one');
  let woke = false; const abort = new AbortController();
  const waiting = f.hub.wait('b', f.hub.read('b').revision, 1000, abort.signal).then(() => { woke = true; });
  const rejected = assert.rejects(waiting);
  const again = await f.hub.send('a', 'b', 'One request.', 'one');
  await setImmediate(); assert.equal(woke, false); assert.equal(again.id, first.id);
  assert.equal(f.hub.read('b').revision, first.revision); abort.abort(); await rejected;
});

test('native delivery changes wake only participants and survive journal recovery', async t => {
  const f = fixture(); t.after(() => f.hub.dispose());
  await f.hub.send('a', 'b', 'Task.', 'one');
  let woke = false;
  const waiting = f.hub.wait('a', f.hub.read('a').revision, 1000).then(result => { woke = true; return result; });
  const claim = await f.hub.claim('b'); await setImmediate(); assert.equal(woke, true);
  assert.equal((await waiting).messages[0]?.status, 'claimed');
  await f.hub.acknowledge(claim, 'native-receipt');
  const state = f.store.snapshot(); recoverCollaborationState(state);
  assert.equal(state.messages[0]?.revision, 3); assert.equal(f.hub.read('c').revision, 0);
  const legacy = structuredClone(state); delete legacy.messages[0]!.revision;
  recoverCollaborationState(legacy); assert.equal(legacy.messages[0]?.revision, legacy.revision);
  const bad = structuredClone(state); bad.messages[0]!.revision = state.revision + 100;
  assert.throws(() => recoverCollaborationState(bad), /revision is invalid/);
});

test('waiting rechecks identity after timeout instead of returning data for a switched account', async t => {
  const f = fixture(); t.after(() => f.hub.dispose());
  const waiting = assert.rejects(f.hub.wait('b', 0, 1), /identity changed/);
  f.identities[1]!.session.binding.accountRef = 'different-profile'; await waiting;
});
