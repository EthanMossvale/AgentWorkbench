import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { AppState, Session } from '../packages/contracts';
import { cacheHitRate, metricsSource, parseTokenCounts, recordSessionUsage, sessionMetrics, validateUsageSample } from '../packages/session-metrics';
import { observeNativeMetrics } from '../packages/session-metrics/native';
import { UsageWireTap } from '../packages/session-metrics/wire';
import { attachNativeObservation } from '../apps/desktop/host/native-observation';
import { normalizeCodexEvent } from '../packages/runtime-codex';
import { createSessionFork } from '../packages/session-core/fork';
import { ApiConversationClient } from '../packages/model-api/provider';
import { openNativeGateway } from '../packages/model-api/native-gateway';
import { RuntimeExtensionRegistry } from '../packages/runtime-extensions';
import { PluginRuntimeHost } from '../apps/desktop/host/plugin-runtime';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
const session = (runtime: Session['binding']['runtime'] = 'codex'): Session => ({ id: 'session', title: 'Fixture', projectId: null, pinned: false, archived: false, group: '', createdAt: at(0), status: 'running', modelSelection: { model: 'model-a' }, nativeTurnId: 'turn-1', binding: { runtime, provider: 'fixture', accountRef: 'fixture', executionId: 'local', egress: 'vps', hostId: 'host', nativeSessionId: 'thread' }, messages: [{ id: 'user-1', role: 'user', original: 'Synthetic input', demo: false, nativeTurnId: 'turn-1', timestamp: at(0) }] });
const codexUsage = (input: number, output: number, read = 0) => ({ inputTokens: input, outputTokens: output, cachedInputTokens: read, totalTokens: input + output, reasoningOutputTokens: 5 });
function codex(s: Session, total: ReturnType<typeof codexUsage>, last = total, sec = 2, threadId = 'thread') { observeNativeMetrics(s, { receivedAt: at(sec), value: { method: 'thread/tokenUsage/updated', params: { threadId, turnId: s.nativeTurnId, tokenUsage: { total, last } } } }); }
const sample = (id = 'request') => ({ id, ...parseTokenCounts({ input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 60 } }, 'responses') });

test('protocol counts include cache once and preserve missing values', () => {
  assert.deepEqual(parseTokenCounts({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 30 }, 'anthropic-messages'), { inputTokens: 180, outputTokens: 20, totalTokens: 200, cacheReadTokens: 50, cacheWriteTokens: 30 });
  assert.equal(parseTokenCounts(codexUsage(100, 20, 60), 'codex').totalTokens, 120);
  assert.equal(parseTokenCounts({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 60 } }, 'chat-completions').cacheReadTokens, 60);
  assert.equal(parseTokenCounts({ input_tokens: 100 }, 'responses').outputTokens, null);
  assert.equal(parseTokenCounts({}, 'responses').totalTokens, null);
  assert.equal(parseTokenCounts({ input_tokens: -1, output_tokens: Infinity }, 'responses').inputTokens, null);
});
test('usage validation rejects invalid counters without inventing zero cache', () => {
  assert.throws(() => validateUsageSample({ ...sample(), cacheReadTokens: 101 }), /SESSION_USAGE_INVALID/);
  assert.throws(() => validateUsageSample({ ...sample(), steps: -1 }), /SESSION_USAGE_INVALID/);
  assert.throws(() => validateUsageSample({ ...sample(), elapsedMs: NaN }), /SESSION_USAGE_INVALID/);
  assert.equal(sessionMetrics(session()).totalTokens, null);
  assert.equal(sessionMetrics().rounds, 0);
  assert.equal(sessionMetrics().steps, 0);
});
test('request snapshots replace duplicates; missing fields and out-of-order updates do not erase data', () => {
  const s = session(), source = metricsSource(s);
  recordSessionUsage(s, sample(), { source, turnId: 'turn-1', at: at(2) });
  recordSessionUsage(s, { ...sample(), outputTokens: 30, totalTokens: 130 }, { source, turnId: 'turn-1', at: at(3) });
  recordSessionUsage(s, { ...sample(), outputTokens: null, cacheReadTokens: null, totalTokens: null }, { source, turnId: 'turn-1', at: at(4) });
  recordSessionUsage(s, sample(), { source, turnId: 'turn-1', at: at(1) });
  assert.equal(sessionMetrics(s).totalTokens, 130); assert.equal(sessionMetrics(s).steps, 1); assert.equal(sessionMetrics(s).cacheReadTokens, 60);
});
test('SSH Codex cumulative events deduplicate, accumulate deltas, and exclude child threads', () => {
  const s = session(); codex(s, codexUsage(100, 20, 60)); codex(s, codexUsage(100, 20, 60));
  codex(s, codexUsage(300, 50, 200), codexUsage(200, 30, 140), 3);
  codex(s, codexUsage(999, 999), undefined, 4, 'child-thread');
  codex(s, codexUsage(100, 20, 60), undefined, 5); // Replayed older receipt, fresh transport timestamp.
  assert.equal(sessionMetrics(s).totalTokens, 350); assert.equal(sessionMetrics(s).steps, 2);
  assert.equal(sessionMetrics(s).cacheHitRate, 200 / 300);
  assert.equal(sessionMetrics(s).tokensPerSecond, 50 / 3);
});
test('native turn completion freezes speed and a new turn does not reuse it', () => {
  const s = session(); codex(s, codexUsage(100, 20, 60));
  observeNativeMetrics(s, { receivedAt: at(5), value: { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn-1' } } } });
  s.status = 'idle'; assert.equal(sessionMetrics(s).tokensPerSecond, 4);
  s.status = 'running'; s.nativeTurnId = 'turn-2'; assert.equal(sessionMetrics(s).tokensPerSecond, null);
});
test('persisted cursors survive restart and model switching attributes only new native deltas', () => {
  let s = session(); codex(s, codexUsage(100, 20, 60)); s = JSON.parse(JSON.stringify(s));
  codex(s, codexUsage(100, 20, 60)); s.modelSelection = { model: 'model-b' };
  codex(s, codexUsage(150, 30, 70), codexUsage(50, 10, 10), 3);
  const result = sessionMetrics(s); assert.equal(result.totalTokens, 180);
  assert.deepEqual(result.groups.map(g => [g.model, g.totalTokens]), [['model-a', 120], ['model-b', 60]]);
});
test('a changed model is attributed to its submitted turn, not stale native defaults or future selections', () => {
  const s = session(); s.nativeEffectiveModel = { model: 'old-default' };
  s.messages[0]!.modelSource = { targetId: 'fixture', name: 'Fixture', runtime: 'codex', model: 'model-a' };
  s.modelSelection = { model: 'next-model' }; codex(s, codexUsage(100, 20, 60));
  s.nativeTurnId = 'turn-2'; s.messages.push({ ...s.messages[0]!, id: 'second', nativeTurnId: 'turn-2', modelSource: { targetId: 'fixture', name: 'Fixture', runtime: 'codex', model: 'model-b' } });
  codex(s, codexUsage(200, 40, 120), codexUsage(100, 20, 60), 4);
  assert.deepEqual(sessionMetrics(s).groups.map(g => [g.model, g.totalTokens]), [['model-a', 120], ['model-b', 120]]);
});
test('first historical cumulative report uses last request and marks unavailable prior history', () => {
  const s = session(); codex(s, codexUsage(2000, 300, 1000), codexUsage(100, 20, 60));
  assert.equal(sessionMetrics(s).totalTokens, 120); assert.equal(sessionMetrics(s).partialHistory, true);
});
test('runtime and model lanes retain prior totals; cache percentage uses token weighting', () => {
  const s = session(); codex(s, codexUsage(100, 20, 60));
  s.binding = { ...s.binding, runtime: 'claude', nativeSessionId: 'other-thread' }; s.modelSelection = { model: 'model-b' };
  recordSessionUsage(s, { ...sample('second'), model: 'model-b', inputTokens: 900, cacheReadTokens: 90, outputTokens: 50, totalTokens: 950, elapsedMs: 1000 }, { source: metricsSource(s), turnId: 'turn-1', at: at(4) });
  const result = sessionMetrics(s); assert.equal(result.totalTokens, 1070); assert.equal(result.cacheHitRate, .15);
  assert.deepEqual(result.groups.map(g => [g.runtime, g.model]), [['codex', 'model-a'], ['claude', 'model-b']]);
  assert.equal(result.tokensPerSecond, 50);
});
test('rounds exclude unsent messages and deduplicate steering; fork does not inherit billed usage', () => {
  const s = session(); s.messages.push({ ...s.messages[0]!, id: 'steer' }, { ...s.messages[0]!, id: 'pending', nativeTurnId: 'pending', delivery: 'pending' }); codex(s, codexUsage(100, 20));
  assert.equal(sessionMetrics(s).rounds, 1); s.status = 'idle';
  const fork = createSessionFork(s, 'fork', at(6)); assert.equal(fork.metrics, undefined); assert.equal(sessionMetrics(fork).totalTokens, null);
});

test('selected runtime and model are separate from historical usage, including no-receipt switches', () => {
  const s = session(); recordSessionUsage(s, { ...sample(), model: 'model-a' }, { source: metricsSource(s), turnId: 'turn-1', at: at(1) });
  s.binding.runtime = 'claude'; s.modelSelection = { model: 'model-b' };
  const before = JSON.stringify(s), snapshot = sessionMetrics(s);
  assert.deepEqual(snapshot.selection, { runtime: 'claude', model: 'model-b' });
  assert.deepEqual(snapshot.groups.map(g => [g.runtime, g.model, g.totalTokens]), [['codex', 'model-a', 120]]);
  assert.equal(JSON.stringify(s), before);
  recordSessionUsage(s, { ...sample(), model: 'model-b' }, { source: metricsSource(s), turnId: 'turn-2', at: at(2) });
  assert.equal(sessionMetrics(s).totalTokens, 240);
  s.binding.runtime = 'codex'; s.modelSelection = { model: 'model-a' };
  assert.deepEqual(sessionMetrics(JSON.parse(JSON.stringify(s))).groups.map(g => [g.runtime, g.model, g.totalTokens]), [['codex', 'model-a', 120], ['claude', 'model-b', 120]]);
});

test('same-name models remain distinct by runtime and selected settings do not rewrite receipt identity', () => {
  const s = session(); s.nativeEffectiveModel = { model: 'old-default' };
  for (const runtime of ['codex', 'claude'] as const) {
    s.binding.runtime = runtime;
    recordSessionUsage(s, { ...sample(), model: 'shared-model' }, { source: metricsSource(s), turnId: 'turn-1', at: at(1) });
  }
  s.modelSelection = { model: 'next-choice' };
  assert.deepEqual(sessionMetrics(s).selection, { runtime: 'claude', model: 'next-choice' });
  assert.equal(sessionMetrics(s).groups.length, 2);
  s.modelSelection = undefined;
  assert.equal(sessionMetrics(s).selection?.model, 'old-default');
  s.nativeEffectiveModel = undefined;
  assert.equal(sessionMetrics(s).selection?.model, '');
  assert.equal(sessionMetrics().selection, undefined);
});
test('partial reported fields retain lower bounds without hiding the observed cache ratio', () => {
  const s = session(); recordSessionUsage(s, sample(), { source: 'a', turnId: 'turn-1', at: at(1) });
  recordSessionUsage(s, { ...sample('missing'), cacheReadTokens: null, totalTokens: null }, { source: 'b', turnId: 'turn-1', at: at(2) });
  assert.equal(sessionMetrics(s).totalTokens, 120); assert.equal(sessionMetrics(s).cacheHitRate, .6);
  assert.ok(sessionMetrics(s).incomplete.includes('totalTokens'));
});
test('cache hit ratios pair counters per request and weight by input tokens across groups', () => {
  const s = session();
  for (const [id, model, inputTokens, cacheReadTokens] of [
    ['first', 'a', 100, 90], ['large', 'b', 900, 90], ['missing-read', 'b', 5000, null], ['missing-input', 'a', null, 4000],
  ] as const) recordSessionUsage(s, { id, model, inputTokens, cacheReadTokens, cacheWriteTokens: null, outputTokens: null, totalTokens: null }, { source: 'fixture', turnId: 'turn-1', at: at(1) });
  const result = sessionMetrics(s);
  assert.equal(result.cacheHitRate, .18); assert.deepEqual(result.groups.map(g => g.cacheHitRate), [.9, .1]);
  assert.equal(result.inputTokens, 6000); assert.equal(result.cacheReadTokens, 4180);
  assert.deepEqual(cacheHitRate([{inputTokens:100,cacheReadTokens:0}]), 0);
  assert.equal(cacheHitRate([{inputTokens:0,cacheReadTokens:0}]), null);
  assert.equal(cacheHitRate([{inputTokens:100,cacheReadTokens:null},{inputTokens:null,cacheReadTokens:80}]), null);
  assert.equal(cacheHitRate([{inputTokens:100,cacheReadTokens:101}]), null);
  recordSessionUsage(s, { id:'missing-read',model:'b',inputTokens:5000,cacheReadTokens:4000,cacheWriteTokens:null,outputTokens:null,totalTokens:null }, { source:'fixture',turnId:'turn-1',at:at(2) });
  assert.equal(sessionMetrics(s).cacheHitRate,4180/6000);
});
test('Claude message snapshots and final result are not counted twice, including repeated results', () => {
  const s = session('claude');
  const assistant = { type: 'assistant', session_id: 'thread', message: { id: 'msg-1', model: 'claude-fixture', content: [], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 30 } } };
  observeNativeMetrics(s, { value: assistant, receivedAt: at(2) }); observeNativeMetrics(s, { value: assistant, receivedAt: at(3) });
  const result = { type: 'result', session_id: 'thread', usage: assistant.message.usage, num_turns: 1, duration_api_ms: 1000 };
  observeNativeMetrics(s, { value: result, receivedAt: at(4) }); observeNativeMetrics(s, { value: result, receivedAt: at(5) });
  observeNativeMetrics(s, { value: assistant, receivedAt: at(6) });
  assert.equal(sessionMetrics(s).totalTokens, 200); assert.equal(sessionMetrics(s).steps, 1); assert.equal(sessionMetrics(s).tokensPerSecond, 20);
  assert.equal(sessionMetrics(s).groups[0]!.model, 'claude-fixture');
});
test('Claude result-only usage is supported; modelUsage cumulative totals are never added', () => {
  const s = session('claude'); observeNativeMetrics(s, { receivedAt: at(4), value: { type: 'result', session_id: 'thread', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 }, num_turns: 2, duration_api_ms: 1000, modelUsage: { 'reported-model': { inputTokens: 99999 } } } });
  assert.equal(sessionMetrics(s).totalTokens, 105); assert.equal(sessionMetrics(s).steps, 2); assert.equal(sessionMetrics(s).groups[0]!.model, 'reported-model');
});
test('a replayed Claude result cannot be charged to a newly submitted turn', () => {
  const s = session('claude'), result = { type: 'result', uuid: 'result-1', session_id: 'thread', usage: { input_tokens: 10, output_tokens: 5 }, num_turns: 1 };
  observeNativeMetrics(s, { receivedAt: at(2), value: result });
  s.nativeTurnId = 'turn-2'; s.messages.push({ ...s.messages[0]!, id: 'user-2', nativeTurnId: 'turn-2' });
  observeNativeMetrics(s, { receivedAt: at(3), value: result });
  assert.equal(sessionMetrics(s).totalTokens, 15); assert.equal(sessionMetrics(s).steps, 1);
});
test('Claude child frames and direct-provider native receipts are not double billed', () => {
  const s = session('claude'); const value = { type: 'assistant', session_id: 'thread', parent_tool_use_id: 'tool-child', message: { id: 'child', model: 'fixture', usage: { input_tokens: 100, output_tokens: 20 } } };
  observeNativeMetrics(s, { value, receivedAt: at(2) }); assert.equal(s.metrics, undefined);
  const direct = session(); direct.binding.egress = 'direct-api'; direct.binding.modelConnectionId = 'connection'; codex(direct, codexUsage(100, 20)); assert.equal(direct.metrics, undefined);
});
test('trusted observation receives non-public native usage for SSH without exposing private text', async () => {
  const s = session(), state = { sessions: [s], hosts: [{ id: 'host' }] } as AppState, source = new EventEmitter();
  const observer = attachNativeObservation(s.id, source, () => structuredClone(state), async change => change(state));
  const frame = { receivedAt: at(2), value: { method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'turn-1', tokenUsage: { last: codexUsage(100, 20, 60), total: codexUsage(100, 20, 60) } } } } as any;
  const event = normalizeCodexEvent(frame, s.id, 1); assert.equal(event.public, false); source.emit('event', event); await observer.flush();
  assert.equal(sessionMetrics(s).totalTokens, 120); assert.equal(s.activities?.length ?? 0, 0); await observer.dispose();
});
test('passive wire tap handles fragmented UTF-8 streams and cache write counters', () => {
  const tap = new UsageWireTap('anthropic-messages', true);
  const text = 'data: ' + JSON.stringify({ type: 'message_start', message: { model: '模型', usage: { input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 } } }) + '\r\n\r\ndata: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: 7 } }) + '\n\n';
  for (const byte of Buffer.from(text)) tap.feed(Uint8Array.of(byte));
  assert.deepEqual(tap.finish(), { model: '模型', counts: { inputTokens: 100, outputTokens: 7, cacheReadTokens: 80, cacheWriteTokens: 10, totalTokens: 107 } });
});
test('direct API callbacks cover actual responses without changing their contents', async () => {
  const observed: any[] = [], connection = { protocol: 'responses', auth: 'none', baseUrl: 'http://fixture.invalid', timeoutMs: 1000 } as any;
  const client = new ApiConversationClient({ connection, model: { model: 'fixture', maxOutputTokens: 100 } as any, system: '', history: [], tools: [], onUsage: (turn, elapsedMs) => { observed.push({ turn, elapsedMs }); } }, '', async () => new Response(JSON.stringify({ id: 'response', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Fixture reply' }] }], usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 60 } } }), { headers: { 'content-type': 'application/json' } }));
  assert.equal((await client.next(new AbortController().signal, () => {})).text, 'Fixture reply');
  assert.equal(observed.length, 1); assert.ok(observed[0].elapsedMs > 0); assert.equal(observed[0].turn.raw.usage.input_tokens_details.cached_tokens, 60);
});
for (const [runtime, protocol] of [['codex', 'responses'], ['claude', 'anthropic-messages'], ['codex', 'chat-completions']] as const) test(`gateway meters ${runtime}/${protocol} before conversion with no duplicate HTTP call`, async () => {
  let calls = 0; const receipts: any[] = [];
  const raw = protocol === 'responses' ? { id: 'response', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 60 } } } : protocol === 'anthropic-messages' ? { id: 'response', model: 'upstream', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 20, cache_read_input_tokens: 60, cache_creation_input_tokens: 20 } } : { id: 'response', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 60 } } };
  const gateway = await openNativeGateway({ runtime, model: { model: 'upstream', enabled: true } as any, credentials: async () => ({ key: '', connection: { protocol, auth: 'none', baseUrl: 'http://fixture.invalid', timeoutMs: 2000 } as any }), usage: receipt => { receipts.push(receipt); }, fetcher: async () => { calls++; return new Response(JSON.stringify(raw), { headers: { 'content-type': 'application/json' } }); } });
  try {
    const reply = await fetch(gateway.baseUrl + (runtime === 'codex' ? '/v1/responses' : '/v1/messages'), { method: 'POST', headers: { authorization: 'Bearer ' + gateway.token, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'native-alias', input: [], messages: [], stream: true }) });
    assert.equal(reply.status, 200); assert.match(await reply.text(), /ok/); assert.equal(calls, 1); assert.equal(receipts.length, 1); assert.equal(receipts[0].counts.totalTokens, 120); assert.equal(receipts[0].counts.cacheReadTokens, 60); assert.equal(receipts[0].model, 'upstream');
  } finally { await gateway.close(); }
});
test('plugin runtime usage is persisted and IDs scoped to each run', async () => {
  const registry = new RuntimeExtensionRegistry(); const state = { sessions: [] } as unknown as AppState;
  const host = new PluginRuntimeHost(registry, { snapshot: () => structuredClone(state), update: async change => change(state), translate: () => {} });
  const definition = { apiVersion: 1 as const, id: 'plugin:meter', name: 'Meter', description: 'Fixture', permissions: [{ value: 'default' as const, label: 'Default', description: 'Fixture' }] };
  // The registry takes an approved host owner; no native installation is involved.
  registry.register('fixture', definition as any, { run: async context => { await context.emit({ type: 'usage', usage: sample() }); await context.emit({ type: 'usage', usage: sample() }); }, stop: async () => {} });
  const s = session('plugin:meter'); s.status = 'idle'; s.messages = []; s.modelSelection = undefined; state.sessions.push(s); await host.initialize(s);
  for (let run = 0; run < 2; run++) {
    await host.submit(s.id, { id: 'preview-' + run, original: 'Fixture', translated: 'Fixture' } as any);
    for (let i = 0; i < 100 && host.busy(s.id); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(s.status, 'idle');
  }
  assert.equal(sessionMetrics(s).totalTokens, 240); assert.equal(sessionMetrics(s).steps, 2); assert.equal(sessionMetrics(s).rounds, 2);
});
test('session/metrics is read-only, survives actual state reload, and rejects missing sessions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'awb-metrics-'));
  let controller: WorkbenchController | undefined;
  try {
    const store = new StateStore(dir); await store.load(); const s = session(); s.status = 'idle'; codex(s, codexUsage(100, 20, 60)); await store.update(state => state.sessions.push(s));
    const reloaded = new StateStore(dir); await reloaded.load(); let writes = 0;
    controller = new WorkbenchController(reloaded, new SecretStore(dir, { encrypt: () => { throw Error('No test credentials'); }, decrypt: () => '' }), { pickDirectory: async () => null, copy: () => {}, openPath: async () => {}, nativeCapabilities: () => [] }, () => { writes++; });
    const before = JSON.stringify(reloaded.snapshot());
    const metrics = await controller.call('session/metrics', { sessionId: s.id }) as ReturnType<typeof sessionMetrics>;
    assert.equal(metrics.totalTokens, 120); assert.equal(metrics.groups[0]!.model, 'model-a'); assert.equal(JSON.stringify(reloaded.snapshot()), before); assert.equal(writes, 0);
    await assert.rejects(controller.call('session/metrics', { sessionId: 'missing' }));
  } finally { await controller?.dispose(); await rm(dir, { recursive: true, force: true }); }
});
