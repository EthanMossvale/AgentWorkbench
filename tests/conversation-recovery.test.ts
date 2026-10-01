import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeWireRequest } from '../packages/model-api/native-wire';
import { nativeProviderDiagnostic, diagnosticMessage } from '../packages/model-api/native-diagnostics';
import { nativeProviderLaunch } from '../packages/model-api/native-launch';
import { codexModelCatalog, prepareCodexModelCatalog } from '../packages/model-api/native-catalog';
import { readFile, stat } from 'node:fs/promises';
import { nativeContextSettings, displayedContext, providerContextUsage } from '../packages/model-api/native-context';
import { mergeDirectory, modelMetadata } from '../packages/model-api/config';
import { conversationTimeline } from '../packages/collaboration-core/timeline';
import { readingTurns } from '../packages/collaboration-core/reading-turns';
import type { Session } from '../packages/contracts';
import { putInteraction, type NativeInteraction } from '../packages/native-interactions';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider';
import { NativeCodexRunner } from '../apps/desktop/host/native-codex';

const model = { id: 'fixture', model: 'custom-model', name: 'Custom', enabled: true, contextWindow: 1000000 };
function validateChat(messages: any[]) {
  const pending = new Set();
  for (const message of messages) {
    if (message.role !== 'tool') assert.equal(pending.size, 0, 'Every tool result must follow the assistant call batch.');
    if (message.role === 'tool') { assert.ok(pending.has(message.tool_call_id)); pending.delete(message.tool_call_id); }
    for (const call of message.tool_calls ?? []) pending.add(call.id);
  }
  assert.equal(pending.size, 0);
}
test('parallel Codex calls reach Chat as one batch followed by every result', () => {
  const body = { input: [{ type: 'function_call', call_id: 'a', name: 'shell', arguments: '{}' }, { type: 'reasoning', encrypted_content: 'opaque' }, { type: 'function_call', call_id: 'b', name: 'shell', arguments: '{}' }, { type: 'function_call_output', call_id: 'b', output: 'second' }, { type: 'function_call_output', call_id: 'a', output: 'first' }], tools: [] };
  const mapped = nativeWireRequest(body, 'responses', 'chat-completions', model);
  validateChat(mapped.messages); assert.equal(mapped.messages[1].tool_calls.length, 2); assert.equal(mapped.messages[2].tool_call_id, 'b');
});
test('Claude tool results precede additional user text in the same native content array', () => {
  const body = { messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: {} }, { type: 'tool_use', id: 'b', name: 'Bash', input: {} }] }, { role: 'user', content: [{ type: 'text', text: 'Extra context' }, { type: 'tool_result', tool_use_id: 'a', content: 'A' }, { type: 'tool_result', tool_use_id: 'b', content: 'B' }] }], tools: [] };
  const mapped = nativeWireRequest(body, 'anthropic-messages', 'chat-completions', model); validateChat(mapped.messages);
  assert.equal(mapped.messages.at(-1).role, 'user'); assert.equal(mapped.messages.at(-2).tool_call_id, 'b');
});
test('upstream diagnostics preserve structural cause without storing secrets or echoed content', async () => {
  const raw = { error: { message: 'Tool_call_id is invalid. User content: private fixture prose. Bearer synthetic-secret. https://private.invalid', code: 'invalid_request_error', param: 'messages[3].tool_call_id' } };
  const diagnostic = await nativeProviderDiagnostic(new Response(JSON.stringify(raw), { status: 400 }), ['synthetic-secret']);
  assert.equal(diagnostic.category, 'tool-sequence'); assert.equal(diagnostic.param, raw.error.param);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private fixture|synthetic-secret|private.invalid/); assert.match(diagnosticMessage(diagnostic), /HTTP 400/);
  const huge = await nativeProviderDiagnostic(new Response('x'.repeat(20000), { status: 500 })); assert.equal(huge.category, 'upstream');
  const unreadable = await nativeProviderDiagnostic(new Response(new ReadableStream({start(controller){controller.error(Error('Synthetic read failure'));}}), {status:400}));
  assert.equal(unreadable.status,400); assert.equal(unreadable.category,'upstream');
});
test('native catalog preserves installed instructions and uses model capacity instead of unknown-model fallback', async () => {
  const native = {slug:'native-default', visibility:'list', priority:1, base_instructions:'Installed native instructions.', model_messages:{instructions_template:'Native template.'}, shell_type:'unified_exec', context_window:272000, max_context_window:272000, tool_mode:null};
  const bundled = {models:[{...native,slug:'code-only',priority:0,tool_mode:'code_mode_only'},native]};
  const result=codexModelCatalog(model,bundled), selected=result.models.at(-1)!;
  assert.equal(selected.slug,model.model);assert.equal(selected.context_window,1000000);assert.equal(selected.max_context_window,1000000);
  assert.equal(selected.base_instructions,native.base_instructions);assert.deepEqual(selected.model_messages,native.model_messages);assert.equal(selected.tool_mode,null);assert.equal(selected.supports_search_tool,false);
  assert.equal(bundled.models.length,2);assert.equal(native.max_context_window,272000);
  const prepared=await prepareCodexModelCatalog('synthetic-native',model,{OPENAI_API_KEY:'synthetic-secret',CODEX_HOME:'never-read'},async(command,options)=>{
    assert.ok(command.args.includes('--bundled'));assert.equal(options.env.CODEX_HOME,options.cwd);assert.equal(options.env.OPENAI_API_KEY,undefined);return JSON.stringify(bundled);
  });
  assert.equal(JSON.parse(await readFile(prepared.file,'utf8')).models.at(-1).context_window,1000000);
  const launch=nativeProviderLaunch('codex',model,{baseUrl:'http://127.0.0.1:1',token:'fixture'},'default',undefined,{},undefined,'chat-completions',prepared.file);
  assert.ok(launch.args.includes('model_catalog_json='+JSON.stringify(prepared.file)));
  await prepared.dispose();await assert.rejects(stat(prepared.file));
  let directory='';await assert.rejects(prepareCodexModelCatalog('synthetic-native',model,{},async(_command,options)=>{directory=options.cwd;throw Error('Unsupported native capability');}),/NATIVE_MODEL_CATALOG_UNAVAILABLE/);await assert.rejects(stat(directory));
});
test('one-million model window configures both native runtimes without altering source environment or model identity', () => {
  const env = { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '200000' }, gateway = { baseUrl: 'http://127.0.0.1:1234/fixture', token: 'synthetic' };
  const codex = nativeProviderLaunch('codex', model, gateway, 'default', undefined, env);
  assert.ok(codex.args.includes('model_context_window=1000000')); assert.ok(codex.args.includes('model_auto_compact_token_limit=900000'));
  const claude = nativeProviderLaunch('claude', model, gateway, 'default', undefined, env);
  assert.equal(claude.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '900000'); assert.equal(claude.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '900000'); assert.equal(claude.env.ANTHROPIC_MODEL, model.model); assert.equal(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '200000');
  for(const name of ['claude-context-fixture','provider/claude-sonnet-4-6[1m]','custom[1m]']){
    const declared={...model,model:name},local=nativeProviderLaunch('claude',declared,gateway,'default',undefined,{});
    assert.match(local.env.ANTHROPIC_MODEL!,/^awb-model-/);assert.doesNotMatch(local.env.ANTHROPIC_MODEL!,/claude|\[1m\]/i);
    assert.equal(nativeWireRequest({messages:[]},'anthropic-messages','anthropic-messages',declared).model,name);
    assert.equal(local.env.DISABLE_COMPACT,undefined);
  }
});
test('Claude native compaction budget is 90 percent of any declared window without changing model capacity or user switches', () => {
  const env = { DISABLE_AUTO_COMPACT: '1' };
  for (const capacity of [32000, 64000, 128000, 258400, 400000, 1000000, 1050000]) {
    const declared = { ...model, contextWindow: capacity };
    const launch = nativeProviderLaunch('claude', declared, { baseUrl: 'http://127.0.0.1:1', token: 'fixture' }, 'default', undefined, env);
    assert.equal(launch.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, String(Math.floor(capacity * .9)));
    assert.equal(launch.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, String(Math.max(100000, Math.min(1000000, Math.floor(capacity * .9)))));
    assert.equal(declared.contextWindow, capacity); assert.equal(launch.env.DISABLE_AUTO_COMPACT, '1');
  }
  assert.deepEqual(env, { DISABLE_AUTO_COMPACT: '1' });
});
test('the shared native budget keeps exact capacity and floors 90 percent for every consumer', () => {
  assert.deepEqual(nativeContextSettings({ ...model, contextWindow: 258400 }), { window: 258400, compactAt: 232560 });
  assert.deepEqual(nativeContextSettings({ ...model, contextWindow: 32001 }), { window: 32001, compactAt: 28800 });
  for (const capacity of [undefined, 0, -1, NaN, Infinity, 1.5]) assert.equal(nativeContextSettings({ ...model, contextWindow: capacity }), undefined);
  const bundled = { models: [{ slug: 'fixture', visibility: 'list', base_instructions: 'Native fixture.' }] };
  for (const capacity of [32000, 258400, 400000, 1000000, 1050000]) {
    const declared = { ...model, contextWindow: capacity }, budget = nativeContextSettings(declared)!;
    assert.equal(codexModelCatalog(declared, bundled).models.at(-1)!.auto_compact_token_limit, budget.compactAt);
    const launch = nativeProviderLaunch('codex', declared, { baseUrl: 'http://127.0.0.1:1', token: 'fixture' }, 'default', undefined, {});
    assert.ok(launch.args.includes('model_auto_compact_token_limit=' + budget.compactAt));
    assert.ok(launch.args.includes('model_context_window=' + capacity));
  }
});
test('provider percentages use model capacity, with runtime budget separate and missing metadata unknown', () => {
  const native = { used: 129051, total: 150000, capacity: 258400, updatedAt: 'fixture' }, usage = providerContextUsage(model, native);
  assert.equal(usage.capacity, 1000000); assert.equal(usage.runtimeCapacity, 258400); assert.equal(displayedContext(model, usage).percent, 13);
  const unknown = { ...model, contextWindow: undefined }; assert.equal(displayedContext(unknown, native).percent, null); assert.equal(providerContextUsage(unknown, native).capacity, null);
  assert.equal(displayedContext(undefined, native).capacity, 258400);
});
test('manual model capacity survives directory refresh without freezing other discovered capabilities', () => {
  const connection: any = { models: [{ ...model, contextWindowSource: 'manual', efforts: ['low'] }] };
  const merged = mergeDirectory(connection, [{ ...model, contextWindow: 200000, efforts: ['high'], contextWindowSource: 'upstream' }]);
  assert.equal(merged.models[0]!.contextWindow, 1000000); assert.deepEqual(merged.models[0]!.efforts, ['high']);
  assert.equal(modelMetadata({ id: 'fixture', max_context_tokens: 1000000 }).contextWindow, 1000000);
});
test('answered questions attach to their original turn even when their receipt is later than a new message', () => {
  const session = { id: 's', status: 'idle', nativeInteractions: [{ id: 'q', receipt: 'r', turnId: 'one', status: 'answered', receivedAt: '2026-09-28T01:03:00Z', kind: 'questions', questions: [] }, { id: 'pending', status: 'pending', receivedAt: '2026-09-28T01:04:00Z' }], messages: [
    { id: 'u1', role: 'user', nativeTurnId: 'one', timestamp: '2026-09-28T01:00:00Z' }, { id: 'a1', role: 'assistant', nativeTurnId: 'one', nativeTurnEnd: true, timestamp: '2026-09-28T01:01:00Z' }, { id: 'u2', role: 'user', nativeTurnId: 'two', timestamp: '2026-09-28T01:02:00Z' },
  ] } as unknown as Session;
  const entries = conversationTimeline(session), index = entries.findIndex(e => e.type === 'interaction'); assert.equal(entries.filter(e => e.type === 'interaction').length, 1); assert.ok(index < entries.findIndex(e => e.id === 'u2'));
  const turns = readingTurns(entries, session); assert.ok(turns[0]!.process.some(e => e.type === 'interaction')); assert.ok(!turns[1]!.process.some(e => e.type === 'interaction'));
});

const interaction = (turnId: string, status: NativeInteraction['status'] = 'pending'): NativeInteraction => ({ id: 7, threadId: 'thread', turnId, kind: 'questions', method: 'item/tool/requestUserInput', status, blocking: true, receivedAt: '2026-09-28T01:00:00Z', title: '', questions: [] });
test('reused native request IDs retain answered history with independent receipts', () => {
  const session: { nativeInteractions?: NativeInteraction[] } = {}, first = interaction('first', 'answered');
  putInteraction(session, first);
  const next = interaction('second'); putInteraction(session, next);
  assert.equal(session.nativeInteractions!.length, 2); assert.notEqual(first.receipt, next.receipt);
  assert.equal(session.nativeInteractions![0], first); assert.equal(first.status, 'answered');
  assert.throws(() => putInteraction(session, interaction('second')), /Duplicate pending/);
  for (let i = 0; i < 110; i++) putInteraction(session, { ...interaction('historical-' + i, 'answered'), id: 100 + i });
  assert.equal(session.nativeInteractions!.length, 100); assert.ok(session.nativeInteractions!.includes(next));
});

for (const [name, Runner] of [['provider', NativeProviderRunner], ['codex', NativeCodexRunner]] as const) {
  for (const fail of [false, true]) test(`${name} reply ${fail ? 'failure' : 'success'} updates only the captured receipt after native ID reuse`, async () => {
    const first = interaction('first', 'answered'), current = interaction('second');
    const session: { nativeInteractions?: NativeInteraction[] } = {};
    putInteraction(session, first); putInteraction(session, current);
    const runner: any = Object.create(Runner.prototype);
    runner.session = () => structuredClone(session);
    const mutate = async (_id: string, change: (session: any) => void) => change(session);
    const rpc = { replyInteraction: async () => { if (fail) throw Error('Synthetic disconnect'); }, pendingApprovals: () => [] };
    if (name === 'provider') {
      runner.update = mutate;
      runner.active = new Map([['session', { stopping: false, approvals: new Map([[7, {}]]), rpc, queue: Promise.resolve() }]]);
    } else {
      runner.updateSession = mutate; runner.leases = { assert: () => {} };
      runner.tracked = new Map([['session', { active: true, lease: {}, stopping: false, handle: { connection: { rpc } }, queue: Promise.resolve() }]]);
    }
    if (fail) await assert.rejects(runner.interaction('session', 7, { action: 'decline' }), /Synthetic disconnect/);
    else await runner.interaction('session', 7, { action: 'decline' });
    assert.equal(first.status, 'answered'); assert.equal(current.status, fail ? 'uncertain' : 'declined');
  });
}
