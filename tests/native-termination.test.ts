import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { nativeWireRequest } from '../packages/model-api/native-wire';
import { parseTurn, collectStream } from '../packages/model-api/provider';
import { openNativeGateway } from '../packages/model-api/native-gateway';
import { nativeForwardingDiagnostic } from '../packages/model-api/native-diagnostics';
import { nativeTurnFailure } from '../packages/native-events/turn-failure';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider';
import { StateStore } from '../apps/desktop/host/store';
import { ProcessSupervisor, decodeNativeFrame, type ProcessSpec } from '../services/remote-supervisor';

const model = { id: 'fixture', model: 'fixture', name: 'Fixture', enabled: true };
const connection = { id: 'fixture', revision: '1', name: 'Fixture', baseUrl: 'https://fixture.invalid/v1', protocol: 'chat-completions' as const, timeoutMs: 1000, enabled: true, auth: 'none' as const, hasKey: false, models: [model], discoveredModels: [], tools: true as const, maxOutputTokens: 8192 };
const sse = (...frames: unknown[]) => frames.map(v => 'data: ' + (typeof v === 'string' ? v : JSON.stringify(v)) + '\n\n').join('');
const chat = (reason = 'stop', extra = {}) => ({ choices: [{ finish_reason: reason, message: { content: 'I will check next.', ...extra } }] });

test('wire mapping preserves instructions; completion policy is applied at the gateway', () => {
  const body = { model: 'fixture', instructions: 'NATIVE PROMPT', input: 'Task', tools: [{ type: 'function', name: 'read', parameters: { type: 'object' } }] };
  assert.deepEqual(nativeWireRequest(body, 'responses', 'responses', model), body);
  const mapped = nativeWireRequest(body, 'responses', 'chat-completions', model);
  assert.equal(mapped.messages[0].content, body.instructions);
  assert.equal(nativeWireRequest({ ...body, tools: [] }, 'responses', 'chat-completions', model).messages[0].content, body.instructions);
  assert.equal(parseTurn(chat(), 'chat-completions').calls.length, 0, 'Intent prose cannot authorize invented tool calls or automatic continuation');
});

test('tool finish without calls and unsupported call kinds cannot become text-only success', () => {
  assert.throws(() => parseTurn(chat('tool_calls'), 'chat-completions'));
  assert.throws(() => parseTurn(chat('stop', { function_call: { name: 'read', arguments: '{}' } }), 'chat-completions'));
  assert.throws(() => parseTurn({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'Working' }] }, 'anthropic-messages'));
  assert.throws(() => parseTurn({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Working' }, { type: 'server_tool_use', id: 'call' }] }, 'anthropic-messages'));
  for (const extra of [{ type: 'custom_tool_call', call_id: 'call' }, { type: 'future_tool_call', call_id: 'call' }, { type: 'function_call', status: 'in_progress', call_id: 'call', name: 'read', arguments: '{}' }]) assert.throws(() => parseTurn({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Working' }] }, extra] }, 'responses'));
  const valid = parseTurn(chat('tool_calls', { tool_calls: [{ id: 'call', function: { name: 'read', arguments: '{}' } }] }), 'chat-completions');
  assert.equal(valid.calls[0]?.name, 'read');
});

test('foreign DONE markers and missing finish reasons are not completion receipts', async () => {
  for (const protocol of ['responses', 'anthropic-messages', 'chat-completions'] as const) await assert.rejects(collectStream(new Response(sse({ choices: [{ delta: { content: 'Partial' } }] }, '[DONE]')), protocol));
});

for (const [runtime, protocol] of [['codex', 'responses'], ['claude', 'anthropic-messages'], ['codex', 'chat-completions'], ['claude', 'chat-completions']] as const) test(`${runtime}/${protocol} diagnoses EOF without completion and never replays`, async () => {
  const diagnostics: any[] = []; let requests = 0;
  const gateway = await openNativeGateway({ runtime, model, credentials: async () => ({ connection: { ...connection, protocol }, key: '' }), diagnostic: value => diagnostics.push(value), fetcher: async () => { requests++; return new Response(sse(protocol === 'responses' ? { type: 'response.output_text.delta', delta: 'Partial' } : protocol === 'anthropic-messages' ? { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial' } } : { choices: [{ delta: { content: 'Partial' } }] }), { headers: { 'content-type': 'text/event-stream' } }); } });
  try {
    const result = await fetch(gateway.baseUrl + (runtime === 'codex' ? '/v1/responses' : '/v1/messages'), { method: 'POST', headers: { Authorization: 'Bearer ' + gateway.token }, body: JSON.stringify(runtime === 'codex' ? { stream:true,input: 'Fixture' } : { stream:true,messages: [{ role: 'user', content: 'Fixture' }] }) });
    const text = await result.text(); assert.match(text, /event: error/); assert.doesNotMatch(text, /response.completed|message_stop/);
    assert.equal(diagnostics[0].category, 'protocol'); assert.equal(requests, 1);
  } finally { await gateway.close(); }
});

test('timeout, transport and conversion diagnostics contain no exception secrets', async () => {
  const diagnostics: any[] = [];
  const gateway = await openNativeGateway({ runtime: 'codex', model, credentials: async () => ({ connection: { ...connection, timeoutMs: 20 }, key: '' }), diagnostic: d => diagnostics.push(d), fetcher: async (_url, init) => { await new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })); throw Error('unreachable'); } });
  try { const result = await fetch(gateway.baseUrl + '/v1/responses', { method: 'POST', headers: { Authorization: 'Bearer ' + gateway.token }, body: '{"input":"Fixture"}' }); assert.equal(result.status, 504); assert.match(await result.text(), /NATIVE_UPSTREAM_TIMEOUT/); assert.equal(diagnostics[0].category, 'timeout'); }
  finally { await gateway.close(); }
  const detail = nativeForwardingDiagnostic(Object.assign(Error('SECRET https://private.invalid'), { cause: { code: 'ECONNRESET' } }));
  assert.equal(detail.code, 'ECONNRESET'); assert.doesNotMatch(JSON.stringify(detail), /SECRET|private.invalid/);
  for(const code of ['NATIVE_STREAM_TOOL_CHANGED','NATIVE_STREAM_INVALID_TOOL_JSON','NATIVE_PROVIDER_TOOL_UNSUPPORTED']){
    const diagnostic=nativeForwardingDiagnostic(Error(code+': SECRET https://private.invalid'));
    assert.equal(diagnostic.code,code);assert.doesNotMatch(JSON.stringify(diagnostic),/SECRET|private.invalid/);
  }
  assert.match(nativeTurnFailure('codex', { message: 'SECRET', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } } }), /HTTP 502/);
  assert.match(nativeTurnFailure('claude', { subtype: 'error_max_turns', errors: ['SECRET'] }), /回合数限制/);
});

class TerminalFixture extends ProcessSupervisor {
  writes: any[] = [];
  constructor(spec: ProcessSpec, readonly runtime: 'codex' | 'claude', readonly scenario: 'failure' | 'retry' | 'commentary') { super(spec); }
  frame(value: unknown) { this.emit('frame', decodeNativeFrame(Buffer.from(JSON.stringify(value) + '\n'))); }
  override async start() { this.state = 'running'; }
  override async write(v: any) {
    this.writes.push(v);
    if (this.runtime === 'codex' && v.id && v.method) {
      this.frame({ id: v.id, result: v.method === 'thread/start' ? { thread: { id: 'root' } } : v.method === 'turn/start' ? { turn: { id: 'turn' } } : {} });
      if (v.method === 'turn/start') setTimeout(() => {
        this.frame({ method: 'turn/started', params: { threadId: 'root', turn: { id: 'turn', status: 'inProgress' } } });
        this.frame({ method: 'turn/completed', params: { threadId: 'root', turn: { id: 'old-turn', status: 'failed' } } });
        this.frame({ method: 'error', params: { threadId: 'child', turnId: 'child-turn', error: { message: 'SECRET' } } });
        if (this.scenario !== 'commentary') this.frame({ method: 'error', params: { threadId: 'root', turnId: 'turn', willRetry: this.scenario === 'retry', error: { message: 'SECRET', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } } } } });
        this.frame({ method: 'item/completed', params: { threadId: 'root', turnId: 'turn', item: { id: 'text', type: 'agentMessage', text: 'Public progress.', ...(this.scenario === 'commentary' ? { phase: 'commentary' } : {}) } } });
        this.frame({ method: 'turn/completed', params: { threadId: 'root', turn: { id: 'turn', status: this.scenario === 'failure' ? 'failed' : 'completed', ...(this.scenario === 'failure' ? { error: { message: 'SECRET', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } } } } : {}) } } });
      }, 5);
    } else if (this.runtime === 'claude' && v.type === 'user') setTimeout(() => {
      this.frame({ type: 'system', subtype: 'init', session_id: 'root', permissionMode: 'default' });
      this.frame({ type: 'assistant', session_id: 'root', uuid: 'text', message: { id: 'text', content: [{ type: 'text', text: 'Public progress.' }] } });
      this.frame({ type: 'result', session_id: 'root', subtype: 'error_max_turns', is_error: true, errors: ['SECRET'] });
    }, 5);
  }
  override async stop() { this.state = 'closed'; this.emit('disconnect'); return { code: 0, signal: null, reason: 'fixture' }; }
}

for (const official of [false, true]) for (const runtime of ['codex', 'claude'] as const) for (const scenario of (runtime === 'codex' ? ['failure', 'retry', 'commentary'] : ['failure']) as ('failure' | 'retry' | 'commentary')[]) test(`${runtime} ${official ? 'official' : 'third-party'} ${scenario}: terminal reasons survive storage`, async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'awb-termination-')); const store = new StateStore(home); await store.load(); let child!: TerminalFixture; const observed: string[] = [];
  const session: any = { id: 'fixture', title: 'Synthetic', projectId: null, projectPath: home, status: 'idle', messages: [], modelSelection: { model: model.model }, binding: { runtime, provider: 'fixture', accountRef: 'fixture', executionId: 'local', egress: 'direct-api', ...(official ? { localAccountId: 'account' } : { modelConnectionId: 'fixture', modelMappingId: 'fixture' }) } };
  await store.update(s => { s.sessions = [session]; });
  const accounts: any = { execution: () => ({ model, env: { HOME: home, USERPROFILE: home } }), account: () => ({ usage: undefined }), observeQuota: async () => {} };
  const runner = new NativeProviderRunner({ connection: () => connection, key: async () => '' } as any, { home, env: {}, locate: async () => ({ executable: 'fixture' }), isMaintaining: () => false } as any, { snapshot: () => store.snapshot(), update: async fn => { const result = await store.update(fn); if (result.sessions[0]?.nativeError) observed.push(result.sessions[0].nativeError); return result; }, context: async () => '', peers: () => ({ definitions: [], call: async () => {} }) as any, translate: () => {}, observe: async () => {} }, async () => { throw Error('No external inference'); }, accounts, spec => child = new TerminalFixture(spec, runtime, scenario));
  try {
    await runner.submit('fixture', { id: 'prompt', original: 'Fixture', translated: 'Fixture', revision: 1, revisions: [], sourceHash: 'fixture', bypass: true, demo: false });
    const deadline = Date.now() + 5000; while (runner.busy('fixture') && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    assert.equal(runner.busy('fixture'), false); const saved = (await new StateStore(home).load()).sessions[0]!;
    assert.equal(saved.nativeTurnStatus, scenario === 'failure' ? 'failed' : 'completed'); assert.doesNotMatch(JSON.stringify(saved), /SECRET/);
    assert.equal(child.writes.filter(v => runtime === 'codex' ? v.method === 'turn/start' : v.type === 'user').length, 1);
    if (scenario === 'failure') assert.match(saved.turnTimings![0]!.error!, runtime === 'codex' ? /HTTP 502/ : /回合数限制/);
    else { assert.equal(saved.nativeError, undefined); assert.equal(saved.turnTimings![0]!.status, 'completed'); }
    if (scenario === 'retry') assert.ok(observed.some(s => s.includes('正在重试')));
    if (scenario === 'commentary') assert.equal(saved.messages.at(-1)?.phase, 'commentary');
  } finally { await runner.dispose(); await rm(home, { recursive: true, force: true }); }
});
