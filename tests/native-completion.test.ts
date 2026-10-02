import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeCompletionCodec, nativeCompletionReceipt } from '../packages/model-api/native-completion';
import { nativeWireRequest, nativeWireStream } from '../packages/model-api/native-wire';
import { openNativeGateway } from '../packages/model-api/native-gateway';
import type { ApiTurn } from '../packages/model-api/types';

const model = { id: 'fixture', model: 'fixture', name: 'Fixture', enabled: true };
const connection = { id: 'fixture', revision: '1', name: 'Fixture', baseUrl: 'https://fixture.invalid/v1', protocol: 'chat-completions' as const, timeoutMs: 3000, enabled: true, auth: 'none' as const, hasKey: false, models: [model], discoveredModels: [], tools: true, maxOutputTokens: 8192 };
const request = { instructions: 'Native instructions.', input: 'Inspect and repair.', tools: [{ type: 'function', name: 'inspect', parameters: { type: 'object' } }] };
const turn = (text = '', calls: ApiTurn['calls'] = []): ApiTurn => ({ text, calls, usage: { inputTokens: 10, outputTokens: 5 }, raw: { choices: [{ finish_reason: calls.length ? 'tool_calls' : 'stop' }] } });
const prepare = () => nativeCompletionCodec.prepare(nativeWireRequest(request, 'responses', 'chat-completions', model), 'chat-completions')!;
const complete = (name: string, value: unknown) => ({ id: 'completion', name, arguments: JSON.stringify(value) });

test('ordinary progress cannot silently complete a tool-bearing cross-protocol request', async () => {
  let calls = 0; const receipts: unknown[] = [], diagnostics: any[] = [];
  const gateway = await openNativeGateway({ runtime: 'codex', model, credentials: async () => ({ connection, key: '' }), completionReceipt: r => receipts.push(r), diagnostic: d => diagnostics.push(d), fetcher: async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body)); assert.equal(body.tool_choice, 'auto');
    assert.ok(body.tools.some((t: any) => t.function.name === 'awb_complete_turn'));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'I am checking the remaining step.' } }] });
  } });
  try {
    const response = await fetch(gateway.baseUrl + '/v1/responses', { method: 'POST', headers: { authorization: 'Bearer ' + gateway.token }, body: JSON.stringify(request) });
    assert.equal(response.status, 422); const text = await response.text();
    assert.match(text, /NATIVE_COMPLETION_REQUIRED/); assert.doesNotMatch(text, /response.completed/);
    assert.equal(calls, 1); assert.equal(diagnostics[0].code, 'NATIVE_COMPLETION_REQUIRED');
    assert.deepEqual(receipts, [{ protocol: 'chat-completions', finishReason: 'stop', toolCalls: 0, textChars: 33, boundary: 'unmarked' }]);
  } finally { await gateway.close(); }
});

for (const protocol of ['responses', 'anthropic-messages', 'chat-completions'] as const) test(`${protocol}: completion codec exposes a typed explicit finish and preserves native tools`, () => {
  const mapped = nativeWireRequest(request, 'responses', protocol, model);
  const boundary = nativeCompletionCodec.prepare(mapped, protocol)!;
  assert.deepEqual(boundary.request.tools.slice(0, -1), mapped.tools);
  assert.deepEqual(boundary.request.tool_choice, protocol === 'anthropic-messages' ? { type: 'auto' } : 'auto');
  const tool = boundary.request.tools.at(-1), name = tool.function?.name ?? tool.name;
  for (const outcome of ['completed', 'needs_input', 'blocked']) {
    const parsed = turn('', [complete(name, { outcome, message: 'Final answer.' })]);
    const final = boundary.finish(parsed); assert.equal(final.text, 'Final answer.'); assert.deepEqual(final.calls, []); assert.equal(final.completionOutcome, outcome);
    assert.equal(nativeCompletionReceipt(parsed, 'chat-completions', final).boundary, 'explicit');
  }
});

test('completion outcome is not a guess about natural-language task success', () => {
  for (const message of ['I am checking.', 'Done.', '继续检查', '']) assert.throws(() => prepare().finish(turn(message)), /COMPLETION_REQUIRED/);
  const boundary = prepare(), call = complete('awb_complete_turn', { outcome: 'completed', message: 'Task verified.' });
  for (const value of [{ message: 'Reply' }, { outcome: 'continue', message: 'Reply' }, { outcome: 'completed', message: '' }, { outcome: 'blocked', message: 'Reply', command: 'private' }, null]) assert.throws(() => boundary.finish(turn('', [complete(call.name, value)])), /COMPLETION_INVALID/);
  assert.throws(() => boundary.finish(turn('', [call, { id: 'read', name: 'inspect', arguments: '{}' }])), /COMPLETION_MIXED/);
});

test('final answer streams through escaped Unicode fragments without exposing the envelope as a native tool', () => {
  const boundary = prepare(), wire = nativeWireStream('responses', request), events: any[] = [];
  const message = 'Verified.\n中文😀';
  const call = complete('awb_complete_turn', { outcome: 'completed', message });
  for (const name of ['awb_', 'awb_complete_', 'awb_complete_turn']) for (const part of boundary.push({ type: 'tool', index: 0, id: call.id, name, argumentsDelta: '' })) events.push(...wire.push(part));
  for (const c of call.arguments) for (const part of boundary.push({ type: 'tool', index: 0, id: call.id, name: call.name, argumentsDelta: c })) events.push(...wire.push(part));
  assert.equal(events.filter(e => e.type === 'response.output_text.delta').map(e => e.delta).join(''), message);
  assert.ok(events.every(e => e.item?.type !== 'function_call' && e.type !== 'response.completed'));
  events.push(...wire.finish(boundary.finish(turn('', [call]))));
  assert.equal(events.at(-1).response.output[0].phase, 'final_answer');
  assert.equal(events.at(-1).response.output[0].content[0].text, message);
});

test('tool progress stays attached to its calls in the next model request', () => {
  const wire = nativeWireStream('responses', request), boundary = prepare();
  const calls = [{ id: 'inspect1', name: 'inspect', arguments: '{}' }, { id: 'inspect2', name: 'inspect', arguments: '{}' }];
  const output = wire.finish(boundary.finish(turn('Checking.', calls))).at(-1)!.response.output;
  assert.equal(output[0].phase, 'commentary');
  const mapped = nativeWireRequest({ ...request, input: [{ role: 'user', content: 'Task' }, ...output, ...calls.map(c => ({ type: 'function_call_output', call_id: c.id, output: 'Evidence' }))] }, 'responses', 'chat-completions', model);
  const assistant = mapped.messages.filter((m: any) => m.role === 'assistant');
  assert.equal(assistant.length, 1); assert.equal(assistant[0].content, 'Checking.'); assert.equal(assistant[0].tool_calls.length, 2);
  assert.deepEqual(mapped.messages.slice(-2).map((m: any) => m.tool_call_id), ['inspect1', 'inspect2']);
});

test('tool-free and explicitly forced requests retain their original control', () => {
  for (const from of ['responses', 'anthropic-messages'] as const) for (const to of ['responses', 'anthropic-messages', 'chat-completions'] as const) {
    if (from === to) continue;
    const body = from === 'responses' ? request : { system: 'Native', messages: [{ role: 'user', content: 'Task' }], tools: [{ name: 'inspect', input_schema: { type: 'object' } }] };
    const none = nativeWireRequest({ ...body, tool_choice: from === 'responses' ? 'none' : { type: 'none' } }, from, to, model);
    assert.equal(nativeCompletionCodec.prepare(none, to), undefined);
    const forced = nativeWireRequest({ ...body, tool_choice: from === 'responses' ? { type: 'function', name: 'inspect' } : { type: 'tool', name: 'inspect' } }, from, to, model);
    assert.equal(nativeCompletionCodec.prepare(forced, to), undefined);
  }
  assert.equal(nativeCompletionCodec.prepare({ tools: [] }, 'chat-completions'), undefined);
  assert.deepEqual(nativeWireRequest(request, 'responses', 'responses', model), { ...request, model: 'fixture' });
});

test('a native tool name collision does not steal the native tool', () => {
  const mapped = nativeWireRequest({ ...request, tools: [...request.tools, { type: 'function', name: 'awb_complete_turn', parameters: { type: 'object' } }] }, 'responses', 'chat-completions', model);
  const boundary = nativeCompletionCodec.prepare(mapped, 'chat-completions')!;
  assert.equal(boundary.request.tools.at(-1).function.name, 'awb_complete_turn_1');
  const native = turn('', [{ id: 'native', name: 'awb_complete_turn', arguments: '{}' }]); assert.equal(boundary.finish(native), native);
});

test('thinking requests retain automatic tool choice while still requiring an explicit final boundary', () => {
  const mapped = nativeWireRequest(request, 'responses', 'anthropic-messages', { ...model, adaptiveThinking: true });
  const boundary = nativeCompletionCodec.prepare(mapped, 'anthropic-messages')!;
  assert.deepEqual(boundary.request.thinking, { type: 'adaptive' });
  assert.deepEqual(boundary.request.tool_choice, { type: 'auto' });
  assert.throws(() => boundary.finish(turn('Progress only.')), /COMPLETION_REQUIRED/);
});
