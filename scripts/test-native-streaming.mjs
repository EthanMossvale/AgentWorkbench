import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { LocalCliService } from '../packages/native-runtime/cli.ts';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider.ts';
import { StateStore } from '../apps/desktop/host/store.ts';

// Real CLI binaries, isolated native homes, synthetic loopback SSE. No paid requests.
const output = path.resolve(process.env.AWB_STREAMING_QA ?? 'build/qa/session-feedback/native');
const home = path.join(output, 'home-' + Date.now());
await mkdir(path.join(home, '.codex'), { recursive: true }); await mkdir(path.join(home, '.claude'), { recursive: true });
const executables = { codex: process.env.AWB_QA_CODEX, claude: process.env.AWB_QA_CLAUDE };
assert.ok(executables.codex && executables.claude, 'Explicit isolated QA CLI executable paths are required');
const checks = [], errors = []; let requests = 0, release;
const record = name => { checks.push(name); console.log('PASS ' + name); };
const wait = async (check, name) => { const end = Date.now() + 30000; while (!check() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 40)); assert.ok(check(), name); };
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); assert.equal(body.model, 'stream-fixture'); requests++;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  const send = value => res.write(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`);
  send({ choices: [{ delta: { role: 'assistant', content: 'FIRST_CHUNK ' } }] });
  await new Promise(resolve => { release = resolve; req.on('close', resolve); });
  send({ choices: [{ delta: { content: 'LAST_CHUNK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  send('[DONE]'); res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const model = { id: 'fixture', model: 'stream-fixture', name: 'Fixture', enabled: true, contextWindow: 128000 };
const connection = { id: 'fixture', revision: 'one', name: 'Fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: 'chat-completions', enabled: true, auth: 'key', hasKey: true, models: [model], discoveredModels: [model], tools: true, timeoutMs: 60000, maxOutputTokens: 8192 };
const cli = new LocalCliService(output, { home, isolated: true, executables }); await cli.initialize();
const store = new StateStore(path.join(home, 'state')); await store.load(); await store.update(s => { s.modelConnections = [connection]; });
const runner = new NativeProviderRunner({ connection: () => connection, key: async () => 'synthetic-key' }, cli, { snapshot: () => store.snapshot(), update: fn => store.update(fn), peers: id => ({ sourceSessionId: id, definitions: [], call: async () => { throw Error('No tools in the streaming fixture'); } }), observe: async () => {}, context: async () => '', translate: () => {}, failure: error => errors.push(String(error)) });
try {
  for (const runtime of ['codex', 'claude']) {
    const id = randomUUID(), before = requests;
    await store.update(s => { s.sessions.push({ id, projectId: null, projectPath: path.join(home, 'project-' + runtime), title: 'Synthetic stream', status: 'idle', binding: { runtime, provider: 'fixture', accountRef: 'model-api:fixture', executionId: 'local', egress: 'direct-api', modelConnectionId: 'fixture', modelMappingId: 'fixture' }, modelSelection: { model: model.model }, permissionMode: runtime === 'claude' ? 'plan' : 'read-only', messages: [], pinned: false, archived: false, group: '', createdAt: new Date().toISOString() }); });
    const session = () => store.snapshot().sessions.find(s => s.id === id);
    await runner.submit(id, { id: randomUUID(), original: 'Reply briefly. Do not use tools.', translated: 'Reply briefly. Do not use tools.', revisions: [], sourceHash: 'fixture', bypass: true, demo: false });
    assert.equal(session().turnTimings.at(-1).status, 'running');
    await wait(() => session().messages.some(m => m.role === 'assistant' && m.original.includes('FIRST_CHUNK')), runtime + ' exposes the first CLI delta before upstream completion');
    assert.equal(session().status, 'running'); assert.ok(session().messages.every(m => !m.original.includes('LAST_CHUNK')));
    assert.equal(session().turnTimings.at(-1).endedAt, undefined); record(runtime + ' native CLI exposes partial text during an unfinished upstream stream');
    release(); await wait(() => !runner.busy(id), runtime + ' finishes after the real upstream receipt');
    assert.equal(session().status, 'idle', errors.join('\n'));
    assert.equal(session().messages.filter(m => m.role === 'assistant').map(m => m.original).join(''), 'FIRST_CHUNK LAST_CHUNK');
    assert.equal(session().turnTimings.at(-1).status, 'completed'); assert.ok(session().turnTimings.at(-1).endedAt);
    assert.equal(requests - before, 1); record(runtime + ' records completion and duration once, with no duplicated output or request');
  }
  assert.deepEqual(errors, []);
} finally {
  release?.(); await runner.dispose(); await cli.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, requests, realModelCalls: 0, scope: 'Installed CLIs, isolated native homes, synthetic loopback upstream' }, null, 2));
}
