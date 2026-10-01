import test from 'node:test';
import assert from 'node:assert/strict';
import { openNativeGateway } from '../packages/model-api/native-gateway';
import { nativeWireStream } from '../packages/model-api/native-wire';
import { API_DEFAULTS } from '../packages/model-api/config';
import type { ApiModel, ModelConnection } from '../packages/model-api/types';

const model: ApiModel = { id: 'fixture', model: 'fixture-model', name: 'Fixture', enabled: true };
const connection: ModelConnection = { id: 'source', revision: '1', name: 'Fixture', baseUrl: 'https://example.invalid/v1', protocol: 'chat-completions', enabled: true, auth: 'key', hasKey: true, models: [model], discoveredModels: [], ...API_DEFAULTS };
const encode = (value: unknown) => new TextEncoder().encode(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\r\n\r\n`);
const events = (text: string) => text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)));
const within = <T>(promise: Promise<T>) => Promise.race([promise, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(Error('No public text arrived before upstream completion')), 2500); timer.unref(); })]);

for (const [runtime, protocol] of [['codex', 'chat-completions'], ['claude', 'chat-completions'], ['codex', 'anthropic-messages'], ['claude', 'responses']] as const) {
  test(`public text reaches ${runtime} before ${protocol} completes, without duplicate final deltas`, async () => {
    let control!: ReadableStreamDefaultController<Uint8Array>, calls = 0;
    const usage: unknown[] = [], failures: unknown[] = [];
    const stream = new ReadableStream<Uint8Array>({ start(controller) { control = controller; } });
    const gateway = await openNativeGateway({ runtime, model, credentials: async () => ({ connection: { ...connection, protocol }, key: 'synthetic' }), usage: value => { usage.push(value); }, failure: error => failures.push(error), fetcher: async () => {
      calls++;
      if (protocol === 'chat-completions') { control.enqueue(encode({ choices: [{ delta: { reasoning_content: 'PRIVATE_THINKING' } }] })); control.enqueue(encode({ choices: [{ delta: { content: '首段 ' } }] })); }
      if (protocol === 'anthropic-messages') {
        control.enqueue(encode({ type: 'message_start', message: { id: 'upstream', usage: { input_tokens: 10 } } }));
        control.enqueue(encode({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
        control.enqueue(encode({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '首段 ' } }));
      }
      if (protocol === 'responses') control.enqueue(encode({ type: 'response.output_text.delta', delta: '首段 ' }));
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    } });
    try {
      const response = await fetch(gateway.baseUrl + (runtime === 'codex' ? '/v1/responses' : '/v1/messages'), { method: 'POST', headers: { Authorization: 'Bearer ' + gateway.token }, body: JSON.stringify(runtime === 'codex' ? { model: 'fixture', input: 'Synthetic task', stream: true } : { model: 'fixture', messages: [{ role: 'user', content: 'Synthetic task' }], stream: true }) });
      const reader = response.body!.getReader(), decoder = new TextDecoder(); let received = '';
      await within((async () => { while (!received.includes('首段')) { const chunk = await reader.read(); assert.equal(chunk.done, false); received += decoder.decode(chunk.value, { stream: true }); } })());
      assert.equal(usage.length, 0, 'No completion or usage before the real receipt');
      assert.doesNotMatch(received, /PRIVATE_THINKING|response.completed|message_stop/);
      if (protocol === 'chat-completions') {
        control.enqueue(encode({ choices: [{ delta: { content: '末段' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })); control.enqueue(encode('[DONE]'));
      } else if (protocol === 'anthropic-messages') {
        control.enqueue(encode({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '末段' } }));
        control.enqueue(encode({ type: 'content_block_stop', index: 0 }));
        control.enqueue(encode({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } })); control.enqueue(encode({ type: 'message_stop' }));
      } else {
        control.enqueue(encode({ type: 'response.output_text.delta', delta: '末段' }));
        control.enqueue(encode({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '首段 末段' }] }], usage: { input_tokens: 10, output_tokens: 5 } } }));
      }
      control.close();
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; received += decoder.decode(chunk.value, { stream: true }); }
      const parsed = events(received), deltas = parsed.filter(event => runtime === 'codex' ? event.type === 'response.output_text.delta' : event.type === 'content_block_delta' && event.delta.type === 'text_delta');
      assert.equal(deltas.map(event => runtime === 'codex' ? event.delta : event.delta.text).join(''), '首段 末段');
      assert.equal(parsed.filter(event => event.type === (runtime === 'codex' ? 'response.completed' : 'message_stop')).length, 1);
      if (runtime === 'codex') assert.deepEqual(parsed.map(event => event.sequence_number), parsed.map((_, i) => i));
      else assert.equal(parsed.find(event => event.type === 'message_delta').usage.input_tokens, 10);
      assert.equal(calls, 1); assert.equal(usage.length, 1); assert.deepEqual(failures, []);
    } finally { await gateway.close(); }
  });
}

test('a truncated upstream produces a native error event, never a success or replay', async () => {
  let calls = 0;
  const gateway = await openNativeGateway({ runtime: 'codex', model, credentials: async () => ({ connection, key: 'synthetic' }), fetcher: async () => { calls++; return new Response(encode({ choices: [{ delta: { content: 'Partial' } }] }), { headers: { 'content-type': 'text/event-stream' } }); } });
  try {
    const result = await fetch(gateway.baseUrl + '/v1/responses', { method: 'POST', headers: { Authorization: 'Bearer ' + gateway.token }, body: JSON.stringify({ input: 'Synthetic task', stream: true }) });
    const received = await result.text(); assert.match(received, /Partial/); assert.match(received, /event: error/); assert.doesNotMatch(received, /response.completed/);
    assert.equal(events(received).at(-1).type, 'error'); assert.equal(calls, 1);
  } finally { await gateway.close(); }
});

test('streaming tools retain native aliases and only appear with a complete validated call', () => {
  const wire = nativeWireStream('responses', { tools: [{ type: 'custom', name: 'apply_patch' }] });
  const first = wire.text('Preparing '); assert.ok(first.some(event => event.type === 'response.output_text.delta')); assert.ok(first.every(event => event.item?.type !== 'custom_tool_call'));
  const final = wire.finish({ text: 'Preparing patch.', calls: [{ id: 'call', name: 'apply_patch', arguments: '{"input":"*** patch"}' }], usage: { inputTokens: 10, outputTokens: 5 }, raw: {} });
  const all = [...first, ...final], completed = all.at(-1)!.response;
  assert.equal(completed.output[0].content[0].text, 'Preparing patch.'); assert.equal(completed.output[1].type, 'custom_tool_call'); assert.equal(completed.output[1].input, '*** patch');
  assert.equal(all.filter(event => event.type === 'response.output_text.delta').map(event => event.delta).join(''), 'Preparing patch.');
  assert.throws(() => wire.text('Later'), /NATIVE_STREAM_FINISHED/);
});

test('changed final text cannot overwrite previously streamed public output', () => {
  const wire = nativeWireStream('anthropic-messages', { model: 'fixture' }); wire.text('Received text');
  assert.throws(() => wire.finish({ text: 'Different text', calls: [], usage: { inputTokens: null, outputTokens: null }, raw: {} }), /NATIVE_STREAM_TEXT_CHANGED/);
});
