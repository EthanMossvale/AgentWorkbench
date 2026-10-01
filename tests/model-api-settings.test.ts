import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateConnection } from '../packages/model-api/config';
import { isEmptyModelDraft, normalizeModelApiUrl } from '../packages/model-api/settings';
import type { ModelConnection } from '../packages/model-api/types';
import { ModelConnections } from '../apps/desktop/host/model-connections';
import { SecretStore, StateStore } from '../apps/desktop/host/store';

const model = { id: 'writer', model: 'upstream-writer', name: 'Writer', enabled: true };
const config = { name: 'Fixture', baseUrl: 'https://gateway.example', protocol: 'chat-completions', models: [model] };

test('model API addresses complete v1 once, preserving gateway prefixes and explicit versions', () => {
  for (const [input, expected] of [
    ['https://gateway.example', 'https://gateway.example/v1'],
    [' https://gateway.example/ ', 'https://gateway.example/v1'],
    ['https://gateway.example/v1/', 'https://gateway.example/v1'],
    ['https://gateway.example/proxy', 'https://gateway.example/proxy/v1'],
    ['https://gateway.example/proxy/chat/completions', 'https://gateway.example/proxy/v1'],
    ['https://gateway.example/v1/responses', 'https://gateway.example/v1'],
    ['https://gateway.example/v2/messages', 'https://gateway.example/v2'],
    ['https://gateway.example/v1beta/models', 'https://gateway.example/v1beta'],
    ['https://gateway.example/api/v1/openai', 'https://gateway.example/api/v1/openai'],
    ['http://localhost:8123', 'http://localhost:8123/v1'],
    ['http://127.0.0.1:8123/api', 'http://127.0.0.1:8123/api/v1'],
    ['http://[::1]:8123', 'http://[::1]:8123/v1'],
  ]) {
    assert.equal(normalizeModelApiUrl(input!), expected);
    assert.equal(normalizeModelApiUrl(expected!), expected);
    assert.equal(validateConnection({ ...config, baseUrl: input }).baseUrl, expected);
  }
});

test('URL completion does not bypass existing credential, scheme, query or host validation', () => {
  for (const baseUrl of ['https://user:pass@example.com', 'https://gateway.example/?key=secret', 'https://gateway.example/#key', 'file:///tmp/api', 'http://remote.example', 'https://claude.ai', 'https://0.0.0.0']) {
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
  return { directory, store, requests, connections: connect(store), connect, close: () => rm(directory, { recursive: true, force: true }) };
}

test('an empty connection saves, reopens after restart, and can change every connection field and selection', async () => {
  const f = await fixture();
  try {
    let saved = await f.connections.call('model-api/save', { connection: { ...config, models: [{ id: 'blank', name: '', model: '', enabled: false }] }, key: 'synthetic-key-one' }) as ModelConnection;
    assert.equal(saved.models.length, 0); assert.equal(saved.discoveredModels.length, 2);
    assert.equal(f.requests[0]!.url, 'https://gateway.example/v1/models');
    const reopened = new StateStore(f.directory); await reopened.load();
    const connections = f.connect(reopened), listed = await connections.call('model-api/list', {}) as ModelConnection[];
    assert.equal(listed[0]!.id, saved.id); assert.equal(listed[0]!.models.length, 0);
    saved = await connections.call('model-api/save', { id: saved.id, revision: saved.revision, connection: { ...saved, name: 'Edited', baseUrl: 'https://another.example/proxy', protocol: 'responses', models: [{ ...model, name: '' }] }, key: 'synthetic-key-two' }) as ModelConnection;
    assert.equal(saved.id, listed[0]!.id); assert.equal(saved.name, 'Edited'); assert.equal(saved.protocol, 'responses'); assert.equal(saved.baseUrl, 'https://another.example/proxy/v1'); assert.equal(saved.models[0]!.name, model.model);
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
