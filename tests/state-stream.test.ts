import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore, initialState } from '../apps/desktop/host/store';
import { createStatePublisher, createStateReceiver } from '../packages/session-core/state-stream';
import type { AppState, Session } from '../packages/contracts';

const session = (id: string, text = 'hello'): Session => ({ id, projectId: null, projectPath: '', title: id, pinned: false, archived: false, group: '', binding: { runtime: 'demo', provider: 'offline', accountRef: 'none', executionId: 'local', egress: 'demo' }, status: 'idle', messages: [{ id: id + '-m', role: 'user', original: text, demo: true, timestamp: '2026-10-04T00:00:00.000Z' }] } as Session);

async function store(sessions: Session[]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aw-stream-'));
  const saved = initialState(); saved.sessions = sessions;
  await writeFile(path.join(dir, 'state.json'), JSON.stringify(saved));
  const value = new StateStore(dir); await value.load();
  return { dir, value };
}

test('session updates copy one session and keep peer identity', async () => {
  const { dir, value } = await store([session('a'), session('b')]);
  try {
    const before = value.read(), peer = before.sessions[1];
    assert.equal(await value.updateSession('a', s => { s.messages[0]!.original = 'changed'; }), true);
    const after = value.read();
    assert.notEqual(after.sessions[0], before.sessions[0]);
    assert.equal(after.sessions[1], peer);
    assert.equal(before.sessions[0]!.messages[0]!.original, 'hello', 'the committed revision is never mutated');
    assert.equal(JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8')).sessions[0].messages[0].original, 'changed');
    assert.equal(await value.updateSession('missing', () => { throw Error('not called'); }), false);
    await assert.rejects(value.updateSession('a', () => { throw Error('rejected'); }), /rejected/);
    assert.equal(value.read(), after, 'a failed mutation commits nothing');
  } finally { await rm(dir, { recursive: true }); }
});

test('generic updates restore identity of unchanged sessions and root values', async () => {
  const { dir, value } = await store([session('a'), session('b')]);
  try {
    const before = value.read();
    await value.update(state => { state.sessions[0]!.title = 'renamed'; });
    const after = value.read();
    assert.notEqual(after.sessions[0], before.sessions[0]);
    assert.equal(after.sessions[1], before.sessions[1]);
    assert.equal(after.translation, before.translation);
  } finally { await rm(dir, { recursive: true }); }
});

test('deferred writes stay in memory until flush and durable writes include them', async () => {
  const { dir, value } = await store([session('a')]);
  try {
    const file = path.join(dir, 'state.json'), read = async () => JSON.parse(await readFile(file, 'utf8')).sessions[0].messages[0].original;
    await value.updateSession('a', s => { s.messages[0]!.original = 'partial'; }, { persist: 'deferred' });
    assert.equal(value.read().sessions[0]!.messages[0]!.original, 'partial');
    assert.equal(await read(), 'hello');
    await value.flush();
    assert.equal(await read(), 'partial');
    await value.updateSession('a', s => { s.messages[0]!.original = 'more'; }, { persist: 'deferred' });
    await value.update(state => { state.theme = 'dark'; });
    assert.equal(await read(), 'more');
    const reloaded = await new StateStore(dir).load();
    assert.equal(reloaded.theme, 'dark');
  } finally { await rm(dir, { recursive: true }); }
});

test('concurrent durable updates are group committed and all observed', async () => {
  const { dir, value } = await store([session('a'), session('b')]);
  try {
    await Promise.all(Array.from({ length: 20 }, (_, i) => value.updateSession(i % 2 ? 'a' : 'b', s => { s.messages[0]!.original += String(i); })));
    const saved = JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8')) as AppState;
    assert.equal(saved.sessions[0]!.messages[0]!.original, 'hello' + [1, 3, 5, 7, 9, 11, 13, 15, 17, 19].join(''));
    assert.equal(saved.sessions[1]!.messages[0]!.original, 'hello' + [0, 2, 4, 6, 8, 10, 12, 14, 16, 18].join(''));
  } finally { await rm(dir, { recursive: true }); }
});

test('state stream sends only changed sessions and keeps receiver identity', () => {
  const publisher = createStatePublisher(), receiver = createStateReceiver();
  const a = session('a'), b = session('b');
  const first = { ...initialState(), sessions: [a, b] } as AppState;
  const full = publisher.next(first)!;
  assert.equal(full.base, null); assert.equal(full.sessions.length, 2);
  const merged = receiver.apply(structuredClone(full)) as AppState;
  assert.equal(publisher.next(first), undefined, 'no change, no patch');
  const changedA = { ...a, title: 'new' };
  const patch = publisher.next({ ...first, sessions: [changedA, b] })!;
  assert.deepEqual(patch.sessions.map(s => s.id), ['a']);
  assert.deepEqual(Object.keys(patch.root), []);
  const next = receiver.apply(structuredClone(patch)) as AppState;
  assert.equal(next.sessions[1], merged.sessions[1]);
  assert.equal(next.sessions[0]!.title, 'new');
  const removed = publisher.next({ ...first, theme: 'dark', sessions: [b] })!;
  const last = receiver.apply(structuredClone(removed)) as AppState;
  assert.deepEqual(last.sessions.map(s => s.id), ['b']);
  assert.equal(last.theme, 'dark');
  assert.equal(receiver.apply({ ...removed, revision: removed.revision + 5, base: removed.revision + 4 }), 'resync');
  publisher.reset();
  assert.equal(publisher.next({ ...first, sessions: [b] })!.base, null);
});

test('state stream sends changed array entries and keeps the others', () => {
  const publisher = createStatePublisher(), receiver = createStateReceiver();
  const messages = Array.from({ length: 10 }, (_, i) => ({ id: 'm' + i, role: 'assistant' as const, original: 'text ' + i, demo: false, timestamp: '2026-10-04T00:00:00.000Z' }));
  const live = { ...session('a'), messages };
  const merged = receiver.apply(structuredClone(publisher.next({ ...initialState(), sessions: [live] } as AppState)!)) as AppState;
  const grown = { ...live, messages: [...messages.slice(0, 9), { ...messages[9]!, original: 'text 9 more' }, { ...messages[0]!, id: 'm10' }] };
  const patch = publisher.next({ ...initialState(), sessions: [grown] } as AppState)!;
  const delta = patch.sessions[0] as unknown as { delta: true; arrays: Record<string, { length: number; set: [number, unknown][] }>; fields: Record<string, unknown> };
  assert.equal(delta.delta, true);
  assert.deepEqual(Object.keys(delta.fields), []);
  assert.deepEqual(delta.arrays.messages!.set.map(([index]) => index), [9, 10]);
  const next = receiver.apply(structuredClone(patch)) as AppState;
  assert.equal(next.sessions[0]!.messages.length, 11);
  assert.equal(next.sessions[0]!.messages[3], merged.sessions[0]!.messages[3], 'unchanged entries keep identity');
  assert.equal(next.sessions[0]!.messages[9]!.original, 'text 9 more');
  assert.equal(createStateReceiver().apply(structuredClone(patch)), 'resync', 'a delta without its base resynchronises');
});

test('session updates share untouched entries and replay writes to older entries on a full copy', async () => {
  const many = { ...session('a'), messages: Array.from({ length: 30 }, (_, i) => ({ id: 'm' + i, role: 'user' as const, original: 'text ' + i, demo: true, timestamp: '2026-10-04T00:00:00.000Z' })) } as Session;
  const { dir, value } = await store([many]);
  try {
    const before = value.read().sessions[0]!;
    await value.updateSession('a', s => { s.messages.at(-1)!.original += ' tail'; });
    let after = value.read().sessions[0]!;
    assert.equal(after.messages[0], before.messages[0]);
    assert.notEqual(after.messages[29], before.messages[29]);
    assert.ok(Object.isFrozen(after.messages[29]));
    await value.updateSession('a', s => { s.messages[0]!.original = 'old entry edited'; });
    after = value.read().sessions[0]!;
    assert.equal(after.messages[0]!.original, 'old entry edited');
    assert.equal(after.messages[1], before.messages[1], 'the replay still shares unchanged entries');
    const inserted = { id: 'external', role: 'user' as const, original: 'caller owned', demo: true, timestamp: '2026-10-04T00:00:00.000Z' };
    await value.updateSession('a', s => { s.messages.push(inserted); });
    inserted.original = 'changed by caller later';
    assert.equal(value.read().sessions[0]!.messages.at(-1)!.original, 'caller owned');
    const saved = JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8')) as AppState;
    assert.deepEqual(saved.sessions[0], JSON.parse(JSON.stringify(value.read().sessions[0])));
  } finally { await rm(dir, { recursive: true }); }
});
