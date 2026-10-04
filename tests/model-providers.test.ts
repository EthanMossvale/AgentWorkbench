import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { modelProviders, ModelProviders } from '../packages/model-api/providers';
import { validateConnection } from '../packages/model-api/config';
import { ApiConversationClient, discoverModels } from '../packages/model-api/provider';
import { openNativeGateway } from '../packages/model-api/native-gateway';
import { Translator } from '../packages/translation/provider';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { PluginRegistry } from '../packages/plugins-core';
import { encodeZip } from '../packages/native-resources/archive';
import { NativeResources } from '../apps/desktop/host/native-resources';
import { SharedMemoryStore } from '../packages/memory-core';
import { SharedSkillsStore } from '../packages/skills-core';
import type { Protocol, TranslationProfile } from '../packages/contracts';
import type { ModelConnection } from '../packages/model-api/types';
import type { ModelProviderSummary } from '../packages/model-api/providers';

const reply = (protocol: Protocol, text = 'OK') => protocol === 'chat-completions' ? { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] } : protocol === 'responses' ? { status: 'completed', output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text }] }] } : { stop_reason: 'end_turn', content: [{ type: 'text', text }] };
const routeProtocol = (url: string): Protocol => url.endsWith('/messages') ? 'anthropic-messages' : url.endsWith('/responses') ? 'responses' : 'chat-completions';
const go = (models: string[]) => validateConnection({ name: 'OpenCode Go', providerId: 'core.opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1', protocol: 'chat-completions', auth: 'key', models: models.map(id => ({ id, model: id, name: id, enabled: true })) });
interface Seen { url: string; headers: Record<string, string> }
const recorder = (seen: Seen[]): typeof fetch => async (url, init) => {
  seen.push({ url: String(url), headers: Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])) });
  return init?.method === 'GET' ? Response.json({ data: [{ id: 'deepseek-v4.1-flash' }] }) : Response.json(reply(routeProtocol(String(url))));
};
const turn = (connection: ModelConnection, model: string, fetcher: typeof fetch, sessionId?: string) => new ApiConversationClient({ connection, model: connection.models.find(m => m.model === model)!, system: '', history: [{ role: 'user', content: 'hi' }], tools: [], sessionId }, 'oc-synthetic-key', fetcher).next(new AbortController().signal, () => {});

test('core catalog lists shipped presets with stable IDs and verification levels', () => {
  const list = modelProviders.list(), ids = list.map(item => item.id);
  for (const id of ['core.opencode-go', 'core.opencode-zen', 'core.deepseek', 'core.openai', 'core.anthropic', 'core.openrouter', 'core.moonshot', 'core.zai', 'core.minimax', 'core.qwen']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(list.find(item => item.id === 'core.opencode-go')!.verification, 'key');
  assert.ok(list.filter(item => item.id !== 'core.opencode-go').every(item => item.verification !== 'key'));
  for (const item of list) assert.equal(new URL(item.baseUrl).protocol, 'https:');
});

test('OpenCode Go routes each model to its documented protocol with session and client headers', async () => {
  const seen: Seen[] = [], connection = go(['deepseek-v4.1-flash', 'minimax-m2.7', 'qwen3.8-max', 'gpt-6-luna']), fetcher = recorder(seen);
  modelProviders.clientVersion = '9.8.7';
  for (const model of ['deepseek-v4.1-flash', 'minimax-m2.7', 'qwen3.8-max', 'gpt-6-luna']) await turn(connection, model, fetcher, 'session-a');
  await turn(connection, 'deepseek-v4.1-flash', fetcher, 'session-a');
  await turn(connection, 'deepseek-v4.1-flash', fetcher, 'session-b');
  assert.deepEqual(seen.slice(0, 4).map(item => item.url), ['https://opencode.ai/zen/go/v1/chat/completions', 'https://opencode.ai/zen/go/v1/messages', 'https://opencode.ai/zen/go/v1/messages', 'https://opencode.ai/zen/go/v1/responses']);
  assert.equal(seen[0]!.headers.authorization, 'Bearer oc-synthetic-key');
  assert.equal(seen[1]!.headers['x-api-key'], 'oc-synthetic-key'); assert.equal(seen[1]!.headers['anthropic-version'], '2023-06-01');
  for (const item of seen) { assert.match(item.headers['x-opencode-session']!, /^[0-9a-f]{32}$/); assert.equal(item.headers['user-agent'], 'AgentWorkbench/9.8.7'); }
  // Stable per conversation, distinct across conversations, and never the raw workbench session ID.
  assert.equal(seen[4]!.headers['x-opencode-session'], seen[0]!.headers['x-opencode-session']);
  assert.notEqual(seen[5]!.headers['x-opencode-session'], seen[0]!.headers['x-opencode-session']);
  assert.ok(seen.every(item => !JSON.stringify(item.headers).includes('session-a')));
  // The saved connection keeps its own protocol; only the request view changes.
  assert.equal(connection.protocol, 'chat-completions');
});

test('directory reads, custom connections and missing providers keep core behavior', async () => {
  const seen: Seen[] = [];
  await discoverModels(go([]), 'oc-synthetic-key', recorder(seen));
  assert.equal(seen[0]!.url, 'https://opencode.ai/zen/go/v1/models'); assert.match(seen[0]!.headers['x-opencode-session']!, /^[0-9a-f]{32}$/);
  const custom = validateConnection({ name: 'Custom', baseUrl: 'https://gateway.example/v1', protocol: 'chat-completions', auth: 'key', models: [{ id: 'm', model: 'minimax-m2.7', name: 'm', enabled: true }] });
  await turn(custom, 'minimax-m2.7', recorder(seen));
  assert.equal(seen[1]!.url, 'https://gateway.example/v1/chat/completions'); assert.equal(seen[1]!.headers['x-opencode-session'], undefined); assert.equal(seen[1]!.headers['user-agent'], undefined);
  const orphan = validateConnection({ ...custom, providerId: 'plugin:gone.plugin/acme' });
  assert.equal(orphan.providerId, 'plugin:gone.plugin/acme');
  await turn(orphan, 'minimax-m2.7', recorder(seen));
  assert.equal(seen[2]!.url, 'https://gateway.example/v1/chat/completions'); assert.equal(seen[2]!.headers['x-opencode-session'], undefined);
  assert.throws(() => validateConnection({ ...custom, providerId: 'not a provider' }), /模型提供商无效/);
  assert.equal(validateConnection({ ...custom, providerId: undefined }).providerId, undefined);
});

test('provider registrations validate IDs and cannot override credential or framing headers', () => {
  const registry = new ModelProviders(), base = { label: 'Fixture', baseUrl: 'https://fixture.example/v1', protocol: 'chat-completions' as const, verification: 'docs' as const };
  assert.throws(() => registry.register({ ...base, id: 'fixture' }), /MODEL_PROVIDER_ID_INVALID/);
  assert.throws(() => registry.register({ ...base, id: 'core.fixture', baseUrl: 'file:///etc' }), /MODEL_PROVIDER_URL_INVALID/);
  const dispose = registry.register({ ...base, id: 'core.fixture', headers: () => ({ Authorization: 'Bearer stolen' }) });
  assert.throws(() => registry.register({ ...base, id: 'core.fixture' }), /MODEL_PROVIDER_DUPLICATE/);
  const connection = validateConnection({ name: 'F', providerId: 'core.fixture', baseUrl: base.baseUrl, protocol: 'chat-completions', models: [] });
  assert.throws(() => registry.headers(connection), /MODEL_PROVIDER_HEADER_INVALID/);
  dispose(); assert.deepEqual(registry.headers(connection), {});
  registry.register({ ...base, id: 'core.fixture', headers: () => { throw Error('boom'); } });
  assert.throws(() => registry.headers(connection), /MODEL_PROVIDER_HEADERS_FAILED/);
});

for (const runtime of ['claude', 'codex'] as const) test(runtime + ' native gateway applies per-model protocol and provider headers for OpenCode Go', async () => {
  for (const [model, route] of [['deepseek-v4.1-flash', '/chat/completions'], ['minimax-m2.7', '/messages']] as const) {
    const seen: Seen[] = [], connection = go([model]);
    const gateway = await openNativeGateway({ runtime, model: connection.models[0]!, sessionId: 'workbench-session', credentials: async () => ({ connection, key: 'oc-synthetic-key' }), fetcher: recorder(seen) });
    try {
      const body = runtime === 'codex' ? { model, input: 'hi' } : { model, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] };
      const response = await fetch(gateway.baseUrl + (runtime === 'codex' ? '/v1/responses' : '/v1/messages'), { method: 'POST', headers: { authorization: 'Bearer ' + gateway.token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      await response.text(); assert.equal(response.status, 200);
      assert.equal(seen[0]!.url, 'https://opencode.ai/zen/go/v1' + route);
      assert.match(seen[0]!.headers['x-opencode-session']!, /^[0-9a-f]{32}$/); assert.match(seen[0]!.headers['user-agent']!, /^AgentWorkbench\//);
    } finally { await gateway.close(); }
  }
});

test('translation backends forward provider headers on direct HTTP requests', async () => {
  const seen: Seen[] = [];
  const profile: TranslationProfile = { id: 't', name: 'T', baseUrl: 'https://opencode.ai/zen/go/v1', protocol: 'chat-completions', model: 'deepseek-v4.1-flash', verifiedEfforts: [], consent: true, maxCharacters: 0, maxCalls: 0, timeoutMs: 10000 };
  const fetcher: typeof fetch = async (url, init) => { seen.push({ url: String(url), headers: Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])) }); return Response.json(reply('chat-completions', 'Translation')); };
  await new Translator(fetcher).translate('文本', 'input', profile, 'oc-synthetic-key', undefined, 'translation', { profile, runtime: 'api', sourceId: 'api/x', requestHeaders: sessionId => ({ 'x-opencode-session': 'derived-' + sessionId.length }) }, 'session-z');
  assert.equal(seen[0]!.headers['x-opencode-session'], 'derived-9'); assert.equal(seen[0]!.headers.authorization, 'Bearer oc-synthetic-key');
});

test('approved plugin registers and replaces providers through the real catalog, request path and disable recovery', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'awb-model-providers-'));
  const store = new StateStore(home); await store.load();
  const native = new NativeResources(home, { openZip: async () => null, saveZip: async () => null }, () => [], () => {}, home, { cliOptions: { executables: { codex: process.execPath, claude: process.execPath } } });
  const seen: Seen[] = [];
  const controller = new WorkbenchController(store, new SecretStore(path.join(home, 'secrets'), { encrypt: s => Buffer.from(s).reverse(), decrypt: b => Buffer.from(b).reverse().toString() }), { pickDirectory: async () => null, openPath: async () => {}, copy: () => {}, nativeCapabilities: () => [], modelFetcher: recorder(seen) } as never, () => {}, { memory: new SharedMemoryStore(home), skills: new SharedSkillsStore(home), native });
  const plugins = new PluginRegistry(path.join(home, 'plugins')); await plugins.initialize();
  for (const [id, service] of Object.entries(controller.developmentServices())) if (service) plugins.services.register(id, service, { version: 1 });
  const manifest = { schemaVersion: 1, apiVersion: 1, id: 'qa.providers', name: 'Provider fixture', version: '1.0.0', description: 'Synthetic provider contract', capabilities: ['host'], main: 'main.mjs' };
  const source = `export function activate(api){
    const providers=api.services.get('models.providers');
    api.onDispose(providers.register({id:'plugin:'+api.id+'/acme',label:'Acme Gateway',baseUrl:'https://acme.example/v1',protocol:'chat-completions',verification:'docs',modelProtocol:m=>m.startsWith('claude-')?'anthropic-messages':undefined,headers:r=>({'x-acme-session':r.sessionId})}));
    api.onDispose(providers.register({id:'plugin:'+api.id+'/go-override',replaces:'core.opencode-go',label:'OpenCode Go (fixture)',baseUrl:'https://opencode.ai/zen/go/v1',protocol:'chat-completions',verification:'docs',headers:r=>({'x-fixture':'1','x-opencode-session':r.sessionId})}));
    api.registerCommand('list',()=>providers.list().map(p=>p.id));
  }`;
  try {
    const file = path.join(home, 'plugin.zip'); await writeFile(file, encodeZip([{ name: 'workbench.plugin.json', data: Buffer.from(JSON.stringify(manifest)) }, { name: 'main.mjs', data: Buffer.from(source) }]));
    await plugins.importZip(file); const plugin = (await plugins.list())[0]!;
    await plugins.setEnabled(manifest.id, plugin.hash, true, true);
    const acmeId = 'plugin:qa.providers/acme';
    const saved = await controller.call('model-api/save', { connection: { name: 'Acme', providerId: acmeId, baseUrl: 'https://acme.example/v1', protocol: 'chat-completions', models: [{ id: 'c', model: 'claude-x', name: 'c', enabled: true }] }, key: 'acme-synthetic-key' }) as ModelConnection;
    assert.equal(saved.providerId, acmeId);
    for (const enabled of [true, false, true]) {
      await plugins.setEnabled(manifest.id, plugin.hash, enabled);
      const list = await controller.call('model-api/providers') as ModelProviderSummary[];
      assert.equal(list.some(item => item.id === acmeId), enabled);
      const goEntry = list.find(item => item.id === 'core.opencode-go')!;
      assert.equal(goEntry.label, enabled ? 'OpenCode Go (fixture)' : 'OpenCode Go'); assert.equal(goEntry.source, enabled ? 'plugin:qa.providers/go-override' : 'core.opencode-go');
      if (enabled) assert.ok((await plugins.command(manifest.id, 'list', undefined) as string[]).includes(acmeId));
      const current = (controller.call('model-api/list') as Promise<ModelConnection[]>);
      const connection = (await current).find(item => item.id === saved.id)!;
      assert.equal(connection.providerId, acmeId, 'a disabled provider never erases the saved selection');
      seen.length = 0; await turn(connection, 'claude-x', recorder(seen), 'session-p');
      assert.equal(seen[0]!.url, enabled ? 'https://acme.example/v1/messages' : 'https://acme.example/v1/chat/completions');
      assert.equal(!!seen[0]!.headers['x-acme-session'], enabled);
      seen.length = 0; await turn(go(['minimax-m2.7']), 'minimax-m2.7', recorder(seen), 'session-p');
      // The replacement supplies no model rules, so Go falls back to its saved protocol while it is active.
      assert.equal(seen[0]!.url, enabled ? 'https://opencode.ai/zen/go/v1/chat/completions' : 'https://opencode.ai/zen/go/v1/messages');
      assert.equal(seen[0]!.headers['x-fixture'], enabled ? '1' : undefined);
    }
    await plugins.setEnabled(manifest.id, plugin.hash, false);
    assert.equal(modelProviders.get('core.opencode-go')!.label, 'OpenCode Go');
    assert.doesNotMatch(JSON.stringify(await controller.call('state/get')), /acme-synthetic-key/);
  } finally { await plugins.dispose(); await controller.dispose(); await rm(home, { recursive: true, force: true }); }
});
