import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalCliService } from '../packages/native-runtime/cli.ts';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider.ts';

// Actual native CLIs + synthetic Chat Completions; no real native home or model service.
const output = path.resolve(process.env.AWB_COMPACTION_QA ?? 'build/qa/claude-compaction/live');
assert.ok(process.env.AWB_QA_CLAUDE && process.env.AWB_QA_CODEX, 'Explicit native Claude and Codex executables are required.');
await mkdir(output, { recursive: true });
const home = await mkdtemp(path.join(os.tmpdir(), 'awb-compaction-'));
for (const folder of ['.claude', '.codex', 'project']) await mkdir(path.join(home, folder));
const fixture = path.join(home, 'project', 'fixture.txt'); await writeFile(fixture, 'Synthetic context fixture.');
const marker = 'COMPACTION_FIXTURE_COMPLETE', checks = [], errors = [], observations = [];
let current, versions = {}, passed = false;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/chat/completions');
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw), index = current.requests.length;
    assert.equal(body.model, current.model, 'The native budget alias must never replace the upstream ID.');
    current.requests.push({ index, model: body.model, messageCount: body.messages.length, carriesSummary: JSON.stringify(body.messages).includes(marker) });
    if (index > 5) throw Error('Synthetic request guard reached.');
    const toolNames = body.tools?.map(tool => tool.function?.name) ?? [];
    const tool = current.runtime === 'claude' ? 'Read' : toolNames.includes('exec_command') ? 'exec_command' : 'shell_command';
    const args = current.runtime === 'claude' ? { file_path: fixture } : { [tool === 'exec_command' ? 'cmd' : 'command']: 'echo SYNTHETIC_CONTEXT_FIXTURE' };
    const first = index === 0, message = first ? { role: 'assistant', content: null, tool_calls: [{ id: 'read-fixture', type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: marker };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: first ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: first ? Math.floor(current.window * current.ratio) : 2000, completion_tokens: 20 } }));
  } catch (error) { errors.push(String(error)); res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Synthetic compaction fixture rejected the request.' } })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const model = { id: 'fixture', model: 'gpt-context-fixture', name: 'Fixture', enabled: true, contextWindow: 128000 };
const connection = { id: 'fixture', revision: 'fixture', name: 'Fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: 'chat-completions', enabled: true, auth: 'key', hasKey: true, models: [model], tools: true, timeoutMs: 15000, maxOutputTokens: 8192 };
const cli = new LocalCliService(home, { home, isolated: true, executables: { claude: process.env.AWB_QA_CLAUDE, codex: process.env.AWB_QA_CODEX } }); await cli.initialize();
const switches = ['DISABLE_COMPACT', 'DISABLE_AUTO_COMPACT', 'CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT', 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'];
// Test inputs are explicit and isolated; production still honors native user controls.
for (const key of switches) delete cli.env[key];
const state = { hosts: [], sessions: [], modelConnections: [connection] };
const runner = new NativeProviderRunner({ connection: () => connection, key: async () => 'synthetic' }, cli, {
  snapshot: () => structuredClone(state), update: async fn => fn(state), context: async () => '', translate: () => {},
  observe: async (_id, source) => { source.on('event', event => {
    const value = event.raw?.value;
    if (value?.type === 'system' && value.subtype === 'compact_boundary') current.boundaries.push({ trigger: value.compact_metadata?.trigger, preTokens: value.compact_metadata?.pre_tokens, postTokens: value.compact_metadata?.post_tokens });
  }); source.on('raw', frame => {
    if (frame.value.method === 'item/completed' && frame.value.params?.item?.type === 'contextCompaction') current.boundaries.push({ trigger: 'auto' });
  }); },
  peers: id => ({ sourceSessionId: id, definitions: [], call: async () => { throw Error('Unexpected peer tool.'); } }), failure: error => errors.push(String(error)),
});
const wait = async (fn, label) => { const until = Date.now() + 45000; while (!fn() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 60)); assert.ok(fn(), label); };
try {
  for (const runtime of ['claude', 'codex']) versions[runtime] = (await promisify(execFile)(runtime === 'claude' ? process.env.AWB_QA_CLAUDE : process.env.AWB_QA_CODEX, ['--version'], { cwd: home, env: cli.env, windowsHide: true, timeout: 10000 })).stdout.trim();
  const common = [
    { window: 128000, ratio: .5, compact: false },
    { window: 128000, ratio: .91, compact: true },
    { window: 32000, ratio: .91, compact: true },
    { window: 258400, ratio: .91, compact: true },
    { window: 400000, ratio: .91, compact: true },
    { window: 1000000, ratio: .91, compact: true },
    { window: 1050000, ratio: .91, compact: true },
  ];
  for (const scenario of [...common.map(item => ({ ...item, runtime: 'claude' })),
    // Native headroom can compact before the requested budget; keep this observed control.
    { window: 258400, ratio: .94, compact: true, runtime: 'claude' },
    { window: 64000, ratio: .91, compact: true, model: 'provider/claude-small-fixture[1m]', runtime: 'claude' },
    { window: 128000, ratio: .91, compact: false, disable: 'DISABLE_AUTO_COMPACT', runtime: 'claude' },
    ...common.map(item => ({ ...item, runtime: 'codex' })),
    { window: 258400, ratio: .89, compact: false, runtime: 'codex' },
    // The verified native ModelInfo clamps requested limits to 90% of capacity.
    { window: 258400, ratio: .9, compact: true, runtime: 'codex' },
  ]) {
    current = { ...scenario, model: scenario.model ?? 'gpt-context-fixture', requests: [], boundaries: [] }; observations.push(current);
    for (const key of switches) delete cli.env[key]; if (scenario.disable) cli.env[scenario.disable] = '1';
    model.model = current.model; model.contextWindow = scenario.window;
    const session = { id: randomUUID(), projectId: null, projectPath: path.join(home, 'project'), title: 'Compaction fixture', status: 'idle', binding: { runtime: scenario.runtime, provider: 'fixture', accountRef: 'model-api:fixture', executionId: 'local-device', egress: 'direct-api', modelConnectionId: 'fixture', modelMappingId: 'fixture' }, modelSelection: { model: model.model }, permissionMode: 'full-access', messages: [] }; state.sessions.push(session);
    await runner.submit(session.id, { id: randomUUID(), original: 'Read the supplied fixture and finish.', translated: 'Read the supplied fixture and finish.', revisions: [], sourceHash: 'fixture', bypass: true, demo: false });
    await wait(() => !runner.busy(session.id), 'Native compaction process cleanup');
    current.turnStatus = session.nativeTurnStatus; current.runtimeCapacity = session.nativeContextUsage?.runtimeCapacity;
    assert.equal(session.status, 'idle');
    if (scenario.disable) {
      assert.equal(session.nativeTurnStatus, 'failed', 'Native context enforcement stops when auto-compaction is explicitly disabled.');
      assert.equal(current.requests.length, 1); assert.equal(current.boundaries.length, 0);
    } else {
      assert.equal(session.nativeTurnStatus, 'completed'); assert.match(session.messages.at(-1)?.original ?? '', /COMPACTION_FIXTURE_COMPLETE/);
      // Codex reports its 95% usable window independently of the 90% compaction threshold.
      assert.equal(current.runtimeCapacity, Math.floor(scenario.window * (scenario.runtime === 'codex' ? .95 : .9))); assert.equal(session.nativeContextUsage?.capacity, scenario.window); assert.ok(session.nativeContextUsage?.used >= 2000 && session.nativeContextUsage?.used < 2100);
      assert.equal(current.requests.length, scenario.compact ? 3 : 2); assert.equal(current.boundaries.length, scenario.compact ? 1 : 0);
    }
    if (scenario.compact) {
      const boundary = current.boundaries[0]; assert.equal(boundary.trigger, 'auto');
      if (scenario.runtime === 'claude') { assert.ok(boundary.preTokens < scenario.window); assert.ok(boundary.postTokens > 0 && boundary.postTokens < boundary.preTokens); }
      assert.equal(current.requests.at(-1).carriesSummary, true, 'Normal generation resumes with the native summary.');
    }
    const label = `${scenario.runtime}: ${scenario.window} tokens at ${scenario.ratio * 100}%: ${scenario.compact ? 'native auto-compaction and continuation' : scenario.disable ? 'explicit native disable remains honored' : 'no premature compaction'}`;
    checks.push(label); console.log('PASS ' + label);
  }
  assert.deepEqual(errors, []); passed = true;
} finally {
  await runner.dispose(); await cli.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed, versions, checks, errors, observations, scope: 'Actual native Claude Code and Codex; temporary home; synthetic token usage and loopback provider. No real large-text semantic validation or live user configuration.' }, null, 2));
  assert.equal(path.dirname(home), path.resolve(os.tmpdir())); assert.ok(path.basename(home).startsWith('awb-compaction-'));
  await rm(home, { recursive: true, force: true, maxRetries: 3 });
}
