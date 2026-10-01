import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore, SecretStore, initialState } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import type { Session } from '../packages/contracts';

test('explicit runtime preference persists without creating or changing a session', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'awb-runtime-pref-'));
  const store = new StateStore(dir); await store.load();
  const controller = new WorkbenchController(store, new SecretStore(dir, { encrypt: () => { throw Error('No credentials'); }, decrypt: () => '' }), { pickDirectory: async () => null, copy: () => {}, openPath: async () => {}, nativeCapabilities: () => [] }, () => {});
  try {
    const old = await controller.call('session/create', { runtime: 'demo', permissionMode: 'read-only' }) as Session;
    for (const runtime of ['claude', 'codex', 'demo']) {
      await controller.call('runtime/select', { runtime });
      assert.equal((await new StateStore(dir).load()).lastSelectedRuntime, runtime);
      assert.deepEqual(store.snapshot().sessions, [old]);
    }
    await controller.call('runtime/select', { runtime: 'codex' });
    for (const runtime of [undefined, null, '', 'Codex', 'unsupported', 1, {}, []]) {
      await assert.rejects(controller.call('runtime/select', { runtime }), /不支持的运行时/);
      assert.equal(store.snapshot().lastSelectedRuntime, 'codex');
    }
    await controller.call('session/create', { runtime: 'demo' });
    await controller.call('state/get');
    assert.equal(store.snapshot().lastSelectedRuntime, 'codex', 'history and session creation do not overwrite an explicit choice');
    await Promise.all(['demo', 'claude', 'codex'].map(runtime => controller.call('runtime/select', { runtime })));
    assert.equal((await new StateStore(dir).load()).lastSelectedRuntime, 'codex');
  } finally { await controller.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('legacy and invalid persisted runtime preferences safely use the existing demo default', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'awb-runtime-migration-'));
  try {
    assert.equal(initialState().lastSelectedRuntime, 'demo');
    for (const value of [undefined, null, 'removed-runtime', 2, {}, []]) {
      await writeFile(path.join(dir, 'state.json'), JSON.stringify({ ...initialState(), lastSelectedRuntime: value }));
      assert.equal((await new StateStore(dir).load()).lastSelectedRuntime, 'demo');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
