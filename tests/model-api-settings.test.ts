import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateConnection } from '../packages/model-api/config';
import { isEmptyModelDraft, normalizeModelApiUrl, retainManualModelSettings } from '../packages/model-api/settings';
import type { ModelConnection } from '../packages/model-api/types';
import { ModelConnections } from '../apps/desktop/host/model-connections';
import { SecretStore, StateStore } from '../apps/desktop/host/store';

const model = { id: 'writer', model: 'upstream-writer', name: 'Writer', enabled: true };
const config = { name: 'Fixture', baseUrl: 'https://gateway.example', protocol: 'chat-completions', models: [model] };

test('model API addresses preserve explicit prefixes without inventing a version', () => {
  for (const [input, expected] of [
    ['https://gateway.example', 'https://gateway.example'],
    [' https://gateway.example/ ', 'https://gateway.example'],
    ['https://api.openai.com', 'https://api.openai.com'],
    ['https://api.anthropic.com/messages', 'https://api.anthropic.com'],
    ['https://gateway.example/v1/', 'https://gateway.example/v1'],
    ['https://gateway.example/proxy', 'https://gateway.example/proxy'],
    ['https://gateway.example/proxy/chat/completions', 'https://gateway.example/proxy'],
    ['https://gateway.example/v1/responses', 'https://gateway.example/v1'],
    ['https://gateway.example/v2/messages', 'https://gateway.example/v2'],
    ['https://gateway.example/v1beta/models', 'https://gateway.example/v1beta'],
    ['https://gateway.example/api/v1/openai', 'https://gateway.example/api/v1/openai'],
    ['http://localhost:8123', 'http://localhost:8123'],
    ['http://127.0.0.1:8123/api', 'http://127.0.0.1:8123/api'],
    ['http://[::1]:8123', 'http://[::1]:8123'],
  ]) {
    assert.equal(normalizeModelApiUrl(input!), expected);
    assert.equal(normalizeModelApiUrl(expected!), expected);
    assert.equal(validateConnection({ ...config, baseUrl: input }).baseUrl, expected);
  }
});

test('URL completion preserves credential and protocol boundaries while accepting explicit HTTP query and fragment', () => {
  for (const baseUrl of ['https://user:pass@example.com', 'file:///tmp/api', 'https://claude.ai']) {
    assert.throws(() => normalizeModelApiUrl(baseUrl));
  }
});

test('empty and unchecked model drafts are discarded; a model ID supplies its missing display name', () => {
  const empty = { id: 'empty', name: '', model: '', enabled: true };
  const result = validateConnection({ ...config, models: [empty, { ...empty, id: 'unchecked', enabled: false }, { ...empty, id: 'name-only', name: 'Unfinished', model: '  ' }, { ...model, name: '', model: ' upstream-writer ' }] });
  assert.deepEqual(result.models, [{ ...model, name: 'upstream-writer' }]);
  assert.deepEqual(validateConnection({ ...config, models: [empty] }).models, []);
  assert.equal(isEmptyModelDraft(empty), true);
  assert.equal(isEmptyModelDraft(null), false);
  assert.throws(() => validateConnection({ ...config, models: [null] }));
  assert.throws(() => validateConnection({ ...config, models: [{ ...model, model: 'invalid model' }] }));
});

test('blank drafts are removed before checking the configured model limit', () => {
  const models = Array.from({ length: 2000 }, (_, i) => ({ ...model, id: 'm' + i }));
  assert.equal(validateConnection({ ...config, models: [...models, { id: 'blank', model: '', name: '', enabled: true }] }).models.length, 2000);
  assert.throws(() => validateConnection({ ...config, models: [...models, { ...model, id: 'too-many' }] }));
});

async function fixture(fetcher?: typeof fetch) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aw-model-settings-'));
  const store = new StateStore(directory); await store.load();
  const secrets = new SecretStore(path.join(directory, 'secrets'), { encrypt: text => Buffer.from(text).reverse(), decrypt: data => Buffer.from(data).reverse().toString() });
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const send: typeof fetch = fetcher ?? (async (url, init) => {
    requests.push({ url: String(url), headers: init?.headers as Record<string, string> });
    return new Response(JSON.stringify({ data: [{ id: model.model }, { id: 'second' }] }), { headers: { 'content-type': 'application/json' } });
  });
  const connect = (state: StateStore) => new ModelConnections({ snapshot: () => state.snapshot(), update: change => state.update(change), busy: () => false }, secrets, send);
  return { directory, store, secrets, requests, connections: connect(store), connect, close: () => rm(directory, { recursive: true, force: true }) };
}

test('an empty connection saves, reopens after restart, and can change every connection field and selection', async () => {
  const f = await fixture();
  try {
    let saved = await f.connections.call('model-api/save', { connection: { ...config, models: [{ id: 'blank', name: '', model: '', enabled: false }] }, key: 'synthetic-key-one' }) as ModelConnection;
    assert.equal(saved.models.length, 0); assert.equal(saved.discoveredModels.length, 2);
    assert.equal(f.requests[0]!.url, 'https://gateway.example/models');
    const reopened = new StateStore(f.directory); await reopened.load();
    const connections = f.connect(reopened), listed = await connections.call('model-api/list', {}) as ModelConnection[];
    assert.equal(listed[0]!.id, saved.id); assert.equal(listed[0]!.models.length, 0);
    saved = await connections.call('model-api/save', { id: saved.id, revision: saved.revision, connection: { ...saved, name: 'Edited', baseUrl: 'https://another.example/proxy', protocol: 'responses', models: [{ ...model, name: '' }] }, key: 'synthetic-key-two' }) as ModelConnection;
    assert.equal(saved.id, listed[0]!.id); assert.equal(saved.name, 'Edited'); assert.equal(saved.protocol, 'responses'); assert.equal(saved.baseUrl, 'https://another.example/proxy'); assert.equal(saved.models[0]!.name, model.model);
    assert.equal(f.requests.at(-1)!.headers.authorization, 'Bearer synthetic-key-two');
    saved = await connections.call('model-api/save', { id: saved.id, revision: saved.revision, connection: { ...saved, baseUrl: 'https://another.example/proxy', models: [] } }) as ModelConnection;
    assert.equal(saved.models.length, 0); assert.equal(saved.hasKey, true); assert.equal(f.requests.at(-1)!.headers.authorization, 'Bearer synthetic-key-two');
    assert.equal((await connections.call('model-api/list', {}) as ModelConnection[]).length, 1);
  } finally { await f.close(); }
});

test('a failed directory request still saves an empty connection for later manual reconfiguration', async () => {
  const f = await fixture(async () => new Response('{}', { status: 404 }));
  try {
    let saved = await f.connections.call('model-api/save', { connection: { ...config, models: [{ id: 'blank', model: '', name: 'unfinished', enabled: true }] }, key: '' }) as ModelConnection;
    assert.equal(saved.models.length, 0); assert.match(saved.discoveryError!, /404/);
    saved = await f.connections.call('model-api/save', { id: saved.id, revision: saved.revision, connection: { ...saved, models: [model] } }) as ModelConnection;
    assert.deepEqual(saved.models, [model]); assert.equal(saved.auth, 'none');
  } finally { await f.close(); }
});

test('manual values survive source and model edits while stale provider evidence is cleared', () => {
  const input = { ...model, contextWindow: 1048576, contextWindowSource: 'manual' as const, manualEfforts: ['medium','xhigh'], efforts: ['medium','xhigh'], defaultEffort: 'xhigh', maxOutputTokens: 8192, metadataSource: 'upstream' as const, adaptiveThinking: true, reasoningProbe: { status: 'verified' as const, accepted: ['xhigh'], rejected: [], checkedAt: '2026-10-03T00:00:00Z', fingerprint: 'old' } };
  const changed = retainManualModelSettings(input);
  assert.equal(changed.contextWindow, 1048576); assert.equal(changed.contextWindowSource, 'manual');
  assert.deepEqual(changed.manualEfforts, ['medium','xhigh']); assert.deepEqual(changed.efforts, changed.manualEfforts); assert.equal(changed.defaultEffort, 'xhigh');
  assert.equal(changed.reasoningProbe, undefined); assert.equal(changed.maxOutputTokens, undefined); assert.equal(changed.adaptiveThinking, undefined);
  const legacy = retainManualModelSettings({ ...input, metadataSource: 'manual', contextWindowSource: undefined });
  assert.equal(legacy.contextWindow, input.contextWindow); assert.equal(legacy.maxOutputTokens, 8192); assert.equal(legacy.adaptiveThinking, true);
});

test('protocol and address edits reuse the encrypted key and retain manual choices through discover, save and restart', async () => {
  const f = await fixture();
  try {
    let saved = await f.connections.call('model-api/save', { connection: { ...config, models: [{ ...model, contextWindow: 1048576, contextWindowSource: 'manual', manualEfforts: ['low','medium','high','xhigh','max'], defaultEffort: 'xhigh' }] }, key: 'synthetic-retained-key' }) as ModelConnection;
    for (const protocol of ['responses', 'anthropic-messages', 'chat-completions'] as const) {
      const prior = saved, baseUrl = protocol === 'anthropic-messages' ? 'https://gateway.example/anthropic' : 'https://gateway.example';
      const payload = { id: saved.id, revision: saved.revision, connection: { ...saved, baseUrl, protocol } };
      await f.connections.call('model-api/discover', payload);
      assert.equal(await f.connections.key(prior), 'synthetic-retained-key', 'Discovery does not change the saved credential');
      saved = await f.connections.call('model-api/save', payload) as ModelConnection;
      assert.equal(saved.baseUrl, baseUrl); assert.equal(saved.hasKey, true);
      assert.equal(await f.connections.key(saved), 'synthetic-retained-key');
      assert.equal(f.requests.at(-1)!.headers[protocol === 'anthropic-messages' ? 'x-api-key' : 'authorization'], protocol === 'anthropic-messages' ? 'synthetic-retained-key' : 'Bearer synthetic-retained-key');
      assert.equal(saved.models[0]!.contextWindow, 1048576); assert.equal(saved.models[0]!.defaultEffort, 'xhigh');
      assert.deepEqual(saved.models[0]!.manualEfforts, ['low','medium','high','xhigh','max']); assert.equal(saved.models[0]!.reasoningProbe, undefined);
      await assert.rejects(f.connections.call('model-api/save', payload), /更新/);
      const reopened = new StateStore(f.directory); await reopened.load();
      assert.deepEqual(reopened.snapshot().modelConnections![0]!.models, JSON.parse(JSON.stringify(saved.models)));
      assert.equal(await f.connect(reopened).key(reopened.snapshot().modelConnections![0]!), 'synthetic-retained-key');
      assert.doesNotMatch(JSON.stringify(reopened.snapshot()), /synthetic-retained-key/);
    }
    saved = await f.connections.call('model-api/save', { id: saved.id, revision: saved.revision, connection: saved, key: '' }) as ModelConnection;
    assert.equal(saved.hasKey, false); assert.equal(await f.connections.key(saved), '');
    assert.equal(f.requests.at(-1)!.headers.authorization, undefined);
  } finally { await f.close(); }
});

test('failed credential rebinding and busy edits leave the previous encrypted key readable', async () => {
  const f = await fixture();
  try {
    const saved = await f.connections.call('model-api/save', { connection: config, key: 'synthetic-original-key' }) as ModelConnection;
    const payload = { id: saved.id, revision: saved.revision, connection: { ...saved, protocol: 'responses', baseUrl: 'https://another.example' } };
    const failing = new ModelConnections({ snapshot: () => f.store.snapshot(), update: async () => { throw Error('Synthetic persistence failure'); }, busy: () => false }, f.secrets, async () => Response.json({ data: [] }));
    await assert.rejects(failing.call('model-api/save', payload), /persistence failure/);
    assert.equal(await f.connections.key(saved), 'synthetic-original-key');
    assert.equal(f.store.snapshot().modelConnections![0]!.revision, saved.revision); failing.dispose();
    const busy = new ModelConnections({ snapshot: () => f.store.snapshot(), update: fn => f.store.update(fn), busy: () => true }, f.secrets);
    await assert.rejects(busy.call('model-api/save', payload), /正在使用/);
    assert.equal(await f.connections.key(saved), 'synthetic-original-key'); busy.dispose();
  } finally { await f.close(); }
});
