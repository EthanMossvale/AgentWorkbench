import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppState, Session } from '../packages/contracts';
import { initialState, StateStore, SecretStore } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { HostServiceRegistry } from '../packages/plugins-core/services';
import { SIDEBAR_IDLE_MS, initializeSidebarSessions, observeSidebarSessions, orderedSidebarSessions, reorderSidebarSession, sidebarSessionScope } from '../packages/session-core/sidebar-sessions';

const start = Date.parse('2026-01-01T00:00:00Z');
const at = (offset = 0) => new Date(start + offset).toISOString();
const chat = (id: string, patch: Partial<Session> = {}): Session => ({ id, projectId: 'p', projectPath: '/synthetic/project', title: id,
  pinned: false, archived: false, group: '', binding: { runtime: 'demo', provider: 'demo', accountRef: 'demo', executionId: 'local-device', egress: 'demo' },
  status: 'idle', messages: [], createdAt: at(), ...patch });
const makeState = (...sessions: Session[]): AppState => ({ ...initialState(), sessions });
const ids = (state: AppState) => orderedSidebarSessions(state).map(session => session.id);
function prepared(...sessions: Session[]) { const state = makeState(...sessions); initializeSidebarSessions(state); state.sidebarSessionOrder = sessions.map(item => item.id); return state; }
function mutate(state: AppState, offset: number, fn: (next: AppState) => void) {
  const next = structuredClone(state); fn(next); observeSidebarSessions(state, next, at(offset)); return next;
}
const message = (session: Session, id: string, offset: number) => session.messages.push({ id, role: 'assistant', original: id, demo: true, timestamp: at(offset) });

test('legacy migration freezes current priority once, normalizes IDs and retains native identity', () => {
  const state = makeState(chat('old'), chat('new', { createdAt: at(10) }), chat('attention', { status: 'blocked' }));
  const original = structuredClone(state.sessions);
  initializeSidebarSessions(state);
  assert.deepEqual(ids(state), ['attention', 'new', 'old']);
  assert.deepEqual(state.sessions.map(({ sidebarActivityAt, ...session }) => session), original);
  state.sidebarSessionOrder = ['old', 'old', 'gone', 'attention'];
  initializeSidebarSessions(state);
  assert.deepEqual(state.sidebarSessionOrder, ['old', 'attention', 'new']);
  state.sessions[0]!.status = 'running';
  assert.deepEqual(ids(state), ['old', 'attention', 'new']);
});

for (const offset of [SIDEBAR_IDLE_MS - 1, SIDEBAR_IDLE_MS, SIDEBAR_IDLE_MS + 1]) test(`reactivation uses a strict one-hour boundary at ${offset}ms`, () => {
  const state = prepared(chat('first'), chat('last'));
  const next = mutate(state, offset, s => { s.sessions[1]!.status = 'running'; });
  assert.deepEqual(ids(next), offset > SIDEBAR_IDLE_MS ? ['last', 'first'] : ['first', 'last']);
  assert.equal(next.sessions[1]!.sidebarActivityAt, at(offset));
});

test('successive activity renews the idle clock and never reorders parallel active sessions', () => {
  let state = prepared(chat('first'), chat('second'), chat('third'));
  for (let i = 1; i <= 9; i++) state = mutate(state, i * 30 * 60_000, s => {
    for (const session of s.sessions) { session.status = i % 2 ? 'running' : 'idle'; message(session, `message-${i}`, i * 30 * 60_000); session.unread = true; }
  });
  assert.deepEqual(ids(state), ['first', 'second', 'third']);
  state = mutate(state, 10 * 30 * 60_000, s => { s.sessions[2]!.status = 'blocked'; });
  assert.deepEqual(ids(state), ['first', 'second', 'third']);
});

test('a silent long-running task does not become idle and completion starts its idle clock', () => {
  let state = prepared(chat('first'), chat('running', { status: 'running' }));
  state = mutate(state, 3 * SIDEBAR_IDLE_MS, s => { s.sessions[1]!.status = 'idle'; message(s.sessions[1]!, 'done', 3 * SIDEBAR_IDLE_MS); });
  assert.deepEqual(ids(state), ['first', 'running']);
  state = mutate(state, 4 * SIDEBAR_IDLE_MS, s => { s.sessions[1]!.status = 'running'; });
  assert.deepEqual(ids(state), ['first', 'running']);
});

test('only the reactivated row moves, retaining priority and other manually ordered peers', () => {
  const state = prepared(chat('idle-a'), chat('attention', { status: 'blocked' }), chat('idle-b'), chat('wake'));
  const next = mutate(state, SIDEBAR_IDLE_MS + 1, s => { s.sessions[3]!.status = 'running'; });
  assert.deepEqual(ids(next).filter(id => id !== 'wake'), ['idle-a', 'attention', 'idle-b']);
  assert.equal(ids(next)[0], 'wake'); // No global reshuffle of an intentionally unsorted section.
  const sorted = prepared(chat('attention', { status: 'blocked' }), chat('idle'), chat('wake'));
  assert.deepEqual(ids(mutate(sorted, SIDEBAR_IDLE_MS + 1, s => { s.sessions[2]!.status = 'running'; })), ['attention', 'wake', 'idle']);
});

test('translations, read flags, titles, selection and unrelated preferences never reset activity or sort', () => {
  const state = prepared(chat('a'), chat('b')); message(state.sessions[1]!, 'message', 0);
  const next = mutate(state, 2 * SIDEBAR_IDLE_MS, s => {
    s.theme = 'dark'; s.sessions[1]!.unread = true; s.sessions[1]!.title = 'renamed';
    s.sessions[1]!.messages[0]!.translation = 'translation'; s.sessions[1]!.messages[0]!.translationStatus = 'complete';
  });
  assert.deepEqual(ids(next), ['a', 'b']); assert.equal(next.sessions[1]!.sidebarActivityAt, at());
});

test('native tool progress, child activity and approvals count, while translated prompts do not', () => {
  let state = prepared(chat('a'), chat('b'));
  state = mutate(state, SIDEBAR_IDLE_MS + 1, s => { s.sessions[1]!.activities = [{ id: 'tool', runtime: 'codex', kind: 'tool', status: 'running', startedAt: at(), updatedAt: at(SIDEBAR_IDLE_MS + 1) }]; });
  assert.deepEqual(ids(state), ['b', 'a']);
  state = mutate(state, 2 * SIDEBAR_IDLE_MS, s => { s.sessions[1]!.nativeChildren = [{ runtime: 'codex', nativeChildId: 'child', operation: 'progress', status: 'running', updatedAt: at(2 * SIDEBAR_IDLE_MS) }]; });
  assert.equal(state.sessions[1]!.sidebarActivityAt, at(2 * SIDEBAR_IDLE_MS));
  state = mutate(state, 3 * SIDEBAR_IDLE_MS, s => { s.sessions[1]!.nativeApprovals = [{ id: 'approval', kind: 'command', turnId: 'turn', details: 'synthetic', decisions: ['accept'] }]; });
  assert.equal(state.sessions[1]!.sidebarActivityAt, at(3 * SIDEBAR_IDLE_MS));
  const translated = mutate(state, 5 * SIDEBAR_IDLE_MS, s => { s.sessions[1]!.nativeApprovals![0]!.planTranslation = { status: 'complete', translation: 'translated' } as any; });
  assert.equal(translated.sessions[1]!.sidebarActivityAt, at(3 * SIDEBAR_IDLE_MS));
});

test('manual before/after moves protect the whole section from immediate wake-up and keep native data', () => {
  const state = prepared(chat('a'), chat('b'), chat('c'), chat('outside', { projectId: 'other' }));
  const original = structuredClone(state.sessions);
  let next = mutate(state, 2 * SIDEBAR_IDLE_MS, s => reorderSidebarSession(s, { id: 'c', targetId: 'a', scope: 'project:p', edge: 'before' }, at(2 * SIDEBAR_IDLE_MS)));
  assert.deepEqual(ids(next), ['c', 'a', 'b', 'outside']);
  next = mutate(next, 2 * SIDEBAR_IDLE_MS + 1, s => { s.sessions[1]!.status = 'running'; });
  assert.deepEqual(ids(next), ['c', 'a', 'b', 'outside']);
  assert.equal(next.sessions[3]!.sidebarActivityAt, at());
  for (let i = 0; i < original.length; i++) {
    assert.deepEqual(next.sessions[i]!.binding, original[i]!.binding); assert.equal(next.sessions[i]!.projectPath, original[i]!.projectPath);
  }
  next = mutate(next, 3 * SIDEBAR_IDLE_MS, s => reorderSidebarSession(s, { id: 'c', targetId: 'b', scope: 'project:p', edge: 'after' }, at(3 * SIDEBAR_IDLE_MS)));
  assert.deepEqual(ids(next), ['a', 'b', 'c', 'outside']);
});

test('pinned, named-group and recent sections reorder independently; stale scopes and archives reject', () => {
  const state = prepared(chat('a', { pinned: true }), chat('b', { pinned: true, projectId: 'other' }), chat('c', { group: 'notes' }), chat('d', { group: 'notes', projectId: null }), chat('e', { projectId: null }), chat('f', { projectId: null }));
  for (const [id, targetId, scope] of [['b', 'a', 'pinned'], ['d', 'c', 'group:notes'], ['f', 'e', 'project:__recent__']]) {
    reorderSidebarSession(state, { id: id!, targetId: targetId!, scope: scope!, edge: 'before' }, at());
  }
  assert.deepEqual(ids(state), ['b', 'a', 'd', 'c', 'f', 'e']);
  const order = [...state.sidebarSessionOrder!];
  for (const request of [{ id: 'a', targetId: 'c', scope: 'pinned' }, { id: 'e', targetId: 'f', scope: 'project:old' }]) assert.throws(() => reorderSidebarSession(state, { ...request, edge: 'before' }, at()), /SCOPE_CHANGED/);
  state.sessions[0]!.archived = true;
  assert.throws(() => reorderSidebarSession(state, { id: 'a', targetId: 'b', scope: 'pinned', edge: 'before' }, at()), /ARCHIVED/);
  assert.throws(() => reorderSidebarSession(state, { id: 'missing', targetId: 'b', scope: 'pinned', edge: 'before' }, at()), /NOT_FOUND/);
  assert.deepEqual(state.sidebarSessionOrder, order);
});

test('create, restore, move and delete keep saved IDs coherent without reordering other rows', () => {
  let state = prepared(chat('a'), chat('b'), chat('archived', { archived: true }));
  state = mutate(state, 100, s => { s.sessions.push(chat('new', { createdAt: at(100) })); });
  assert.deepEqual(ids(state), ['new', 'a', 'b', 'archived']);
  state = mutate(state, 200, s => { s.sessions = s.sessions.filter(item => item.id !== 'b'); s.sessions.find(item => item.id === 'archived')!.archived = false; });
  assert.deepEqual(ids(state), ['new', 'a', 'archived']);
  const moved = mutate(state, 300, s => { s.sessions[0]!.projectId = 'other'; });
  assert.deepEqual(ids(moved), ids(state));
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'awb-session-order-'));
  const state = prepared(chat('a'), chat('b'), chat('c'), chat('d'));
  await writeFile(path.join(directory, 'state.json'), JSON.stringify(state));
  const store = new StateStore(directory); await store.load(); const broadcasts: AppState[] = [];
  const controller = new WorkbenchController(store, new SecretStore(directory, { encrypt: () => { throw Error('No credentials'); }, decrypt: () => '' }),
    { pickDirectory: async () => null, openPath: async () => {}, copy: () => {}, nativeCapabilities: () => [] }, value => broadcasts.push(value));
  return { directory, store, controller, broadcasts, close: async () => { await controller.dispose(); await rm(directory, { recursive: true, force: true }); } };
}

test('controller serializes concurrent anchor moves, broadcasts and persists both through restart', async () => {
  const f = await fixture(); try {
    await Promise.all([
      f.controller.call('session/reorder', { id: 'b', targetId: 'a', edge: 'before', scope: 'project:p' }),
      f.controller.call('session/reorder', { id: 'd', targetId: 'c', edge: 'before', scope: 'project:p' }),
    ]);
    assert.deepEqual(ids(f.store.snapshot()), ['b', 'a', 'd', 'c']);
    assert.deepEqual(ids(f.broadcasts.at(-1)!), ['b', 'a', 'd', 'c']);
    const reload = new StateStore(f.directory); await reload.load(); assert.deepEqual(ids(reload.snapshot()), ['b', 'a', 'd', 'c']);
    await assert.rejects(f.controller.call('session/reorder', { id: 'a', targetId: 'b', edge: 'inside', scope: 'project:p' }), /EDGE_INVALID/);
    await f.controller.call('session/update', { id: 'a', pinned: true });
    await assert.rejects(f.controller.call('session/reorder', { id: 'a', targetId: 'b', edge: 'after', scope: 'project:p' }), /SCOPE_CHANGED/);
    assert.deepEqual(ids(f.store.snapshot()), ['b', 'a', 'd', 'c']);
  } finally { await f.close(); }
});

test('sidebar.order plugin replacement runs in real store/controller paths and disposal restores defaults', async () => {
  const f = await fixture(); const registry = new HostServiceRegistry(); try {
    registry.register('sidebar.order', f.controller.developmentServices()['sidebar.order']!, { version: 1 });
    const release = registry.override('sidebar.order', { reorder: () => { throw Error('PLUGIN_ORDER_OVERRIDE'); } });
    const request = { id: 'b', targetId: 'a', edge: 'before', scope: sidebarSessionScope(f.store.snapshot().sessions[0]!) };
    await assert.rejects(f.controller.call('session/reorder', request), /PLUGIN_ORDER_OVERRIDE/);
    release(); await f.controller.call('session/reorder', request); assert.deepEqual(ids(f.store.snapshot()), ['b', 'a', 'c', 'd']);
    let observed = 0;
    const stop = registry.intercept('sidebar.order', 'observe', (next, ...args) => { observed++; return next(...args); });
    await f.controller.call('theme/set', { theme: 'dark' }); assert.equal(observed, 1);
    stop(); await f.controller.call('theme/set', { theme: 'light' }); assert.equal(observed, 1);
  } finally { await f.close(); }
});
