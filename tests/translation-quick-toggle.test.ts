import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkbenchController, DEMO_INPUT } from '../apps/desktop/host/controller';
import { StateStore, SecretStore, initialState } from '../apps/desktop/host/store';
import type { DraftPreview, Session } from '../packages/contracts';
import { translationEnabled, translationModuleEnabled, translationQuickToggleVisible } from '../packages/translation/settings';

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(fetcher: typeof fetch = async () => { throw new Error('Unexpected network'); }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aw-translation-quick-toggle-'));
  const store = new StateStore(dir); await store.load();
  const secrets = new SecretStore(dir, { encrypt: value => Buffer.from(value), decrypt: value => value.toString() });
  const controller = new WorkbenchController(store, secrets, { translationFetcher: fetcher, pickDirectory: async () => null, copy: () => {}, openPath: async () => {}, nativeCapabilities: () => [] }, () => {});
  const create = () => controller.call('session/create', { runtime: 'demo' }) as Promise<Session>;
  const quick = (patch: { show?: boolean; paused?: boolean }) => controller.call('translation/quick-toggle', patch);
  const master = (enabled: boolean) => controller.call('plugins/set-enabled', { id: 'translation', enabled });
  const prepare = (session: Session, text: string, demo = false) => controller.call('draft/prepare', { sessionId: session.id, text, demo }) as Promise<DraftPreview>;
  const submit = (session: Session, preview: DraftPreview) => controller.call('draft/submit', { sessionId: session.id, id: preview.id, sourceHash: preview.sourceHash });
  const configure = () => { const s = store.snapshot(); return controller.call('translation/settings', { profile: { ...s.translation, baseUrl: 'https://translator.example/v1', protocol: 'chat-completions', consent: true, model: 'fixture-model' }, key: 'synthetic-translation-key', translateInput: true, translateProgress: false, translateFinal: true }); };
  return { dir, store, secrets, controller, create, quick, master, prepare, submit, configure, close: async () => { await controller.dispose(); await rm(dir, { recursive: true }); } };
}

test('translation master, optional visibility and remembered pause cover all eight combinations', () => {
  assert.equal(translationQuickToggleVisible(null), false);
  assert.equal(translationEnabled({}), true);
  for (const enabled of [false, true]) for (const show of [false, true]) for (const paused of [false, true]) {
    const state = { plugins: { translation: { enabled } }, translationQuickToggle: { show, paused } };
    assert.equal(translationModuleEnabled(state), enabled);
    assert.equal(translationQuickToggleVisible(state), enabled && show);
    assert.equal(translationEnabled(state), enabled && (!show || !paused));
  }
});

test('legacy settings migrate to a shown unpaused quick toggle without enabling a disabled plugin', async () => {
  const f = await fixture(); try {
    assert.deepEqual(f.store.snapshot().translationQuickToggle, { show: true, paused: false });
    const legacy = initialState(); delete legacy.translationQuickToggle; legacy.plugins = { translation: { enabled: false } };
    await writeFile(path.join(f.dir, 'state.json'), JSON.stringify(legacy));
    const loaded = await new StateStore(f.dir).load();
    assert.deepEqual(loaded.translationQuickToggle, { show: true, paused: false }); assert.equal(translationEnabled(loaded), false);
    await writeFile(path.join(f.dir, 'state.json'), JSON.stringify({ ...legacy, translationQuickToggle: { show: 'false', paused: false } }));
    await assert.rejects(new StateStore(f.dir).load(), /临时翻译开关格式/);
  } finally { await f.close(); }
});

test('quick pause is global, survives restart and master toggles, and hiding it restores translation', async () => {
  const f = await fixture(); try {
    await f.create(); await f.create(); await f.quick({ paused: true });
    assert.equal(f.store.snapshot().plugins?.translation?.enabled, true);
    assert.equal((await f.controller.call('plugins/list') as { enabled: boolean }[])[0]!.enabled, true);
    await f.master(false); await f.master(true);
    assert.equal(translationEnabled(f.store.snapshot()), false);
    assert.deepEqual((await new StateStore(f.dir).load()).translationQuickToggle, { show: true, paused: true });
    await f.quick({ show: false });
    assert.equal(translationEnabled(f.store.snapshot()), true);
    assert.deepEqual((await new StateStore(f.dir).load()).translationQuickToggle, { show: false, paused: true });
    await f.quick({ show: true }); assert.equal(translationEnabled(f.store.snapshot()), false);
    await f.quick({ paused: false }); assert.equal(translationEnabled(f.store.snapshot()), true);
  } finally { await f.close(); }
});

test('invalid and unavailable quick-control calls cannot change the master or stored pause', async () => {
  const f = await fixture(); try {
    for (const value of [{}, { paused: 'false' }, { show: 1 }]) await assert.rejects(f.controller.call('translation/quick-toggle', value));
    await f.quick({ show: false }); await assert.rejects(f.quick({ paused: true }), /不可用/);
    await f.master(false); await f.quick({ show: true }); await assert.rejects(f.quick({ paused: false }), /不可用/);
    assert.deepEqual(f.store.snapshot().translationQuickToggle, { show: true, paused: false });
    assert.equal(f.store.snapshot().plugins?.translation?.enabled, false);
    await f.master(true);
    const results = await Promise.allSettled([f.master(false), f.quick({ paused: true })]);
    assert.equal(results[0]!.status, 'fulfilled'); assert.equal(results[1]!.status, 'rejected');
    assert.equal(f.store.snapshot().translationQuickToggle?.paused, false);
  } finally { await f.close(); }
});

test('paused input sends exact originals in every session without keys or output translation', async () => {
  const f = await fixture(); try {
    let reads = 0; f.secrets.get = async () => { reads++; throw new Error('No key reads while paused'); };
    await f.quick({ paused: true });
    for (const session of [await f.create(), await f.create()]) {
      const text = '原文及空格  \nKeep `src/main.ts`.'; const preview = await f.prepare(session, text, true);
      assert.equal(preview.moduleDisabled, true); assert.equal(preview.bypass, true); assert.equal(preview.translated, text);
      await f.submit(session, preview); await assert.rejects(f.submit(session, preview));
      const saved = f.store.snapshot().sessions.find(s => s.id === session.id)!;
      assert.equal(saved.messages[0]!.submitted, text); assert.equal(saved.messages[1]!.translationStatus, 'off');
    }
    assert.equal(reads, 0); assert.equal(f.store.snapshot().plugins?.translation?.enabled, true);
  } finally { await f.close(); }
});

test('pause, resume and hiding a paused control revoke incompatible ready previews', async () => {
  const f = await fixture(); try {
    const session = await f.create(); const translated = await f.prepare(session, DEMO_INPUT, true);
    await f.quick({ paused: true }); await assert.rejects(f.submit(session, translated));
    const raw = await f.prepare(session, 'A raw draft.');
    await f.quick({ paused: false }); await assert.rejects(f.submit(session, raw));
    await f.quick({ paused: true }); const hidden = await f.prepare(session, 'Do not send the old raw preview.');
    await f.quick({ show: false }); await assert.rejects(f.submit(session, hidden));
    assert.equal(f.store.snapshot().sessions[0]!.messages.length, 0);
  } finally { await f.close(); }
});

test('temporary pause permits explicit model discovery, while master off blocks it', async () => {
  let calls = 0;
  const f = await fixture(async (_url, init) => { calls++; assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined); return Response.json({ data: [{ id: 'fixture-model' }] }); });
  try {
    await f.configure(); await f.quick({ paused: true });
    assert.deepEqual(await f.controller.call('translation/models'), { models: ['fixture-model'], source: 'https://translator.example/v1' });
    await assert.rejects(f.controller.call('translation/auto-submit', { enabled: true }), /临时暂停/);
    await f.master(false); await assert.rejects(f.controller.call('translation/models'), /模块已关闭/);
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('pausing cancels queued and in-flight input without accepting late translation results', async () => {
  const arrived = deferred<void>(), response = deferred<Response>(); let calls = 0;
  const f = await fixture(async () => { calls++; if (calls === 2) arrived.resolve(); return response.promise; });
  try {
    await f.configure(); const sessions = [await f.create(), await f.create(), await f.create()];
    const pending = sessions.map(session => assert.rejects(f.prepare(session, '等待翻译')));
    await arrived.promise; await f.quick({ paused: true }); response.resolve(Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Late translation' } }] }));
    await Promise.all(pending); assert.equal(calls, 2); assert.ok(f.store.snapshot().sessions.every(s => s.messages.length === 0));
    assert.equal(f.store.snapshot().plugins?.translation?.enabled, true);
  } finally { response.resolve(Response.json({})); await f.close(); }
});

test('pausing output retries preserves prior translation and rejects late overwrites', async () => {
  const arrived = deferred<void>(), response = deferred<Response>();
  const f = await fixture(async () => { arrived.resolve(); return response.promise; });
  try {
    await f.configure(); const session = await f.create();
    await f.store.update(s => s.sessions[0]!.messages.push({ id: 'answer', role: 'assistant', original: 'Original output.', translation: '原有译文', translationStatus: 'complete', demo: false, timestamp: 'fixture' }));
    const pending = f.controller.call('message/retranslate', { sessionId: session.id, messageId: 'answer' });
    await arrived.promise; await f.quick({ paused: true }); response.resolve(Response.json({ choices: [{ finish_reason: 'stop', message: { content: '迟到译文' } }] })); await pending;
    const message = f.store.snapshot().sessions[0]!.messages[0]!;
    assert.equal(message.translation, '原有译文'); assert.equal(message.translationStatus, 'off'); assert.equal(message.translationError, undefined);
  } finally { response.resolve(Response.json({})); await f.close(); }
});
