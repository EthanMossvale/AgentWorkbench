import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalCliService } from '../packages/native-runtime/cli.ts';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider.ts';
import { currentProviderContext } from '../packages/model-api/native-context.ts';
import { PluginRegistry } from '../packages/plugins-core/index.ts';
import { encodeZip } from '../packages/native-resources/archive.ts';

// Real CLI processes, isolated homes and synthetic provider responses only.
const output = path.resolve('build/qa/context-usage-native');
await mkdir(output, { recursive: true });
const home = await mkdtemp(path.join(os.tmpdir(), 'awb-context-usage-'));
const executables = { codex: process.env.AWB_QA_CODEX, claude: process.env.AWB_QA_CLAUDE };
assert.ok(executables.codex && executables.claude, 'Explicit QA executables are required.');
for (const folder of ['.codex', '.claude', 'project']) await mkdir(path.join(home, folder));
const cli = new LocalCliService(home, { home, isolated: true, executables });
await cli.initialize();
const model = { id: 'fixture', model: 'context-usage-fixture', name: 'Fixture', enabled: true, contextWindow: 1000000 };
const connection = { id: 'fixture', revision: 'one', name: 'Fixture', baseUrl: 'https://fixture.invalid/v1', protocol: 'chat-completions', enabled: true, auth: 'none', hasKey: false, models: [model], timeoutMs: 10000 };
const state = { hosts: [], sessions: [], modelConnections: [connection] };
const observations = [], errors = [];
let current;
const runner = new NativeProviderRunner({ connection: () => connection, key: async () => '' }, cli, {
  snapshot: () => structuredClone(state), update: async change => change(state), context: async () => '', translate: () => {},
  peers: id => ({ sourceSessionId: id, definitions: [], call: async () => { throw Error('Unexpected fixture tool'); } }),
  failure: error => errors.push(String(error)),
  observe: async (_id, source) => {
    source.on('event', event => { const value = event.raw?.value; if (value?.type === 'assistant') current.receipts.push({ type: value.type, usage: value.message?.usage }); if (value?.type === 'stream_event' && value.event?.usage) current.receipts.push({ type: value.event.type, usage: value.event.usage }); if (value?.type === 'result') current.receipts.push({ type: value.type, usage: value.usage, modelUsage: value.modelUsage }); });
    source.on('raw', frame => { if (frame.value.method === 'thread/tokenUsage/updated') current.receipts.push(frame.value.params?.tokenUsage); });
  },
}, async () => {
  current.requests++;
  assert.ok(current.requests <= 1, 'A single synthetic request must suffice.');
  const raw = { id: 'synthetic-response', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'CONTEXT_USAGE_READY' } }], usage: { prompt_tokens: 80000, completion_tokens: 100, prompt_cache_hit_tokens: 78000, prompt_cache_miss_tokens: 2000 } };
  if (!current.streaming) return new Response(JSON.stringify(raw), { headers: { 'content-type': 'application/json' } });
  return new Response('data: ' + JSON.stringify({ ...raw, choices: [{ finish_reason: 'stop', delta: { content: 'CONTEXT_USAGE_READY' } }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
});
const plugins = new PluginRegistry(path.join(home, 'plugins')); await plugins.initialize();
plugins.services.register('runtime.native-provider', runner, { version: 1 });
const manifest = { schemaVersion: 1, apiVersion: 1, id: 'qa.context-usage', name: 'Synthetic context usage', version: '1.0.0', description: 'Isolated provider usage lifecycle test', capabilities: ['host'], main: 'main.mjs' };
const pluginSource = `export function activate(api) {
  api.registerCommand('runtimes', () => api.services.get('runtime.native-provider').runtimes());
  api.services.intercept('runtime.native-provider', 'openGateway', (next, options) => next({ ...options, fetcher: async (...args) => {
    const response = await options.fetcher(...args), body = await response.json();
    body.usage.prompt_tokens += 10000; body.usage.prompt_cache_miss_tokens += 10000;
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  } }));
}`;
try {
  const zip = path.join(home, 'context-plugin.zip');
  await writeFile(zip, encodeZip([{ name: 'workbench.plugin.json', data: Buffer.from(JSON.stringify(manifest)) }, { name: 'main.mjs', data: Buffer.from(pluginSource) }]));
  await plugins.importZip(zip); const plugin = (await plugins.list())[0];
  await assert.rejects(plugins.setEnabled(manifest.id, plugin.hash, true), /Explicit approval/);
  const scenarios = ['claude', 'codex'].flatMap(runtime => [false, true].map(streaming => ({ runtime, streaming, phase: 'core', expected: 80100 })));
  scenarios.push(...['enabled', 'disabled', 'reenabled', 'removed'].map(phase => ({ runtime: 'claude', streaming: false, phase, expected: phase === 'enabled' || phase === 'reenabled' ? 90100 : 80100 })));
  for (const { runtime, streaming, phase, expected } of scenarios) {
    if (phase === 'enabled' || phase === 'reenabled') {
      await plugins.setEnabled(manifest.id, plugin.hash, true, phase === 'enabled');
      assert.deepEqual((await plugins.command(manifest.id, 'runtimes', {})).sort(), ['claude', 'codex']);
    } else if (phase === 'disabled') await plugins.setEnabled(manifest.id, plugin.hash, false);
    else if (phase === 'removed') {
      const installed = (await plugins.list()).find(item => item.manifest.id === manifest.id).directory;
      assert.equal(path.dirname(installed), path.join(home, 'plugins', 'plugins'));
      await rm(installed, { recursive: true }); await plugins.refresh();
    }
    current = { runtime, streaming, phase, requests: 0, receipts: [] }; observations.push(current);
    const session = { id: randomUUID(), projectId: null, projectPath: path.join(home, 'project'), title: 'Synthetic context', status: 'idle', binding: { runtime, provider: 'fixture', accountRef: 'model-api:fixture', executionId: 'local-device', egress: 'direct-api', modelConnectionId: 'fixture', modelMappingId: 'fixture' }, modelSelection: { model: model.model }, permissionMode: runtime === 'claude' ? 'plan' : 'read-only', messages: [] };
    state.sessions.push(session);
    await runner.submit(session.id, { id: randomUUID(), original: 'Reply once. Do not use tools.', translated: 'Reply once. Do not use tools.', revisions: [], sourceHash: 'fixture', bypass: true, demo: false });
    const deadline = Date.now() + 45000;
    while (runner.busy(session.id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(runner.busy(session.id), false, 'The synthetic native process must complete.');
    current.status = session.nativeTurnStatus;
    current.native = session.nativeContextUsage;
    current.displayed = currentProviderContext(session, model);
    current.metrics = session.metrics?.records.map(({ inputTokens, outputTokens, cacheReadTokens }) => ({ inputTokens, outputTokens, cacheReadTokens }));
    assert.equal(current.status, 'completed');
    assert.equal(current.native?.used, expected);
    assert.equal(current.displayed?.used, expected);
    console.log(`PASS ${runtime} ${streaming ? 'streaming' : 'JSON'} ${phase}: ${expected} context tokens`);
  }
  assert.deepEqual(errors, []);
} finally {
  await plugins.dispose(); await runner.dispose(); await cli.dispose();
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ observations, errors, scope: 'Installed native CLIs, isolated temporary homes, synthetic upstream only; no user sessions or external model calls.' }, null, 2));
  assert.equal(path.dirname(home), path.resolve(os.tmpdir())); assert.ok(path.basename(home).startsWith('awb-context-usage-'));
  await rm(home, { recursive: true, force: true, maxRetries: 3 });
}
