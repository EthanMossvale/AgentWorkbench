import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeWireRequest } from '../packages/model-api/native-wire';
import { openNativeGateway } from '../packages/model-api/native-gateway';
import { nativeRequestCodec } from '../packages/model-api/native-request';
import type { ApiModel } from '../packages/model-api/types';

const model: ApiModel = { id: 'fixture', name: 'Fixture', model: 'fixture', enabled: true };
const data = Buffer.alloc(200_000, 7).toString('base64');
const url = 'data:image/png;base64,' + data;
const request = (from: 'responses' | 'anthropic-messages') => from === 'responses' ? {
  instructions: 'Fixture', input: [
    { type: 'function_call', name: 'inspect', call_id: 'image', arguments: '{}' },
    { type: 'custom_tool_call', name: 'inspect_more', call_id: 'text', input: 'fixture' },
    { type: 'function_call_output', call_id: 'image', output: [{ type: 'input_text', text: 'Caption' }, { type: 'input_image', image_url: url, detail: 'high' }] },
    { type: 'custom_tool_call_output', call_id: 'text', output: [{ type: 'input_text', text: 'Second result' }] },
    { role: 'user', content: 'Continue' },
  ],
} : {
  system: 'Fixture', messages: [
    { role: 'assistant', content: [{ type: 'tool_use', name: 'inspect', id: 'image', input: {} }, { type: 'tool_use', name: 'inspect_more', id: 'text', input: {} }] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'image', content: [{ type: 'text', text: 'Caption' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] },
      { type: 'tool_result', tool_use_id: 'text', content: 'Second result' },
      { type: 'text', text: 'Continue' },
    ] },
  ],
};

for (const from of ['responses', 'anthropic-messages'] as const) {
  test(`${from} to Chat preserves images outside text and closes all tool calls before attaching them`, () => {
    const input = request(from), before = JSON.stringify(input);
    const mapped = nativeWireRequest(input, from, 'chat-completions', model);
    assert.deepEqual(mapped.messages.map((m: any) => m.role), ['system', 'assistant', 'tool', 'tool', 'user', 'user']);
    assert.equal(mapped.messages[2].tool_call_id, 'image'); assert.equal(mapped.messages[3].tool_call_id, 'text');
    assert.equal(mapped.messages[2].content, 'Caption'); assert.equal(mapped.messages[3].content, 'Second result');
    assert.equal(mapped.messages[4].content[1].image_url.url, url);
    assert.match(mapped.messages[4].content[0].text, /image/);
    assert.equal(mapped.messages[5].content[0].text, 'Continue');
    const prose = mapped.messages.flatMap((m: any) => typeof m.content === 'string' ? [m.content] : (m.content ?? []).filter((p: any) => p.type === 'text').map((p: any) => p.text)).join('\n');
    assert.ok(prose.length < 300); assert.ok(!prose.includes(data));
    assert.equal(JSON.stringify(input), before);
    if (from === 'responses') assert.equal(mapped.messages[4].content[1].image_url.detail, 'high');
  });
  test(`${from} same-protocol image output remains opaque`, () => {
    const input = request(from); const mapped = nativeWireRequest(input, from, from, model);
    if (from === 'responses') assert.deepEqual(mapped.input, input.input);
    else assert.deepEqual(mapped.messages, input.messages);
  });
}

test('Responses images become nested Anthropic tool-result image blocks', () => {
  const mapped = nativeWireRequest(request('responses'), 'responses', 'anthropic-messages', model);
  const output = mapped.messages[1].content;
  assert.equal(output[0].tool_use_id, 'image'); assert.equal(output[0].content[0].text, 'Caption');
  assert.deepEqual(output[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
  assert.equal(output[1].tool_use_id, 'text'); assert.equal(output[1].content[0].text, 'Second result');
});

test('Claude image results survive conversion to Responses', () => {
  const mapped = nativeWireRequest(request('anthropic-messages'), 'anthropic-messages', 'responses', model);
  const output = mapped.input.find((item: any) => item.call_id === 'image' && item.type === 'function_call_output');
  assert.deepEqual(output.output, [{ type: 'input_text', text: 'Caption' }, { type: 'input_image', image_url: url }]);
});

test('image-only terminal tool batches flush URL media once without fetching or textualizing it', () => {
  const imageUrl = 'https://fixture.invalid/image.png';
  const input = { input: [{ type: 'function_call_output', call_id: 'one', output: [{ type: 'input_image', image_url: imageUrl }] }, { type: 'function_call_output', call_id: 'two', output: [{ type: 'input_image', image_url: imageUrl }] }] };
  const mapped = nativeWireRequest(input, 'responses', 'chat-completions', model);
  assert.deepEqual(mapped.messages.map((m: any) => m.role), ['system', 'tool', 'tool', 'user']);
  assert.ok(mapped.messages[1].content); assert.equal(mapped.messages[3].content.filter((p: any) => p.type === 'image_url').length, 2);
  const anthropic = nativeWireRequest(input, 'responses', 'anthropic-messages', model);
  assert.deepEqual(anthropic.messages[0].content[0].content[0].source, { type: 'url', url: imageUrl });
});

test('unknown tool content is rejected instead of silently dropping or serializing opaque media', () => {
  for (const from of ['responses', 'anthropic-messages'] as const) {
    const input = from === 'responses' ? { input: [{ type: 'function_call_output', call_id: 'one', output: [{ type: 'future_media', data: 'opaque' }] }] }
      : { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'one', content: [{ type: 'future_media', data: 'opaque' }] }] }] };
    assert.throws(() => nativeWireRequest(input, from, 'chat-completions', model), /NATIVE_PROVIDER_CONTENT_UNSUPPORTED/);
  }
});

test('cross-protocol conversion rejects opaque tool objects but preserves JSON/code strings verbatim', () => {
  const data = Buffer.alloc(4096, 7).toString('base64');
  for (const from of ['responses', 'anthropic-messages'] as const) {
    const input = from === 'responses'
      ? { input: [{ type: 'function_call_output', call_id: 'one', output: { filename: 'fixture.zip', mime: 'application/zip', data } }] }
      : { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'one', content: { filename: 'fixture.pdf', file_data: data } }] }] };
    assert.throws(() => nativeWireRequest(input, from, 'chat-completions', model), /NATIVE_PROVIDER_CONTENT_UNSUPPORTED/);
  }
  const source = JSON.stringify({ filename: 'fixture.json', data, code: 'const value = 1;' });
  const responses = nativeWireRequest({ input: [{ type: 'function_call_output', call_id: 'one', output: source }] }, 'responses', 'chat-completions', model);
  assert.equal(responses.messages[1].content, source);
  const anthropic = nativeWireRequest({ messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'one', content: source }] }] }, 'anthropic-messages', 'chat-completions', model);
  assert.equal(anthropic.messages[1].content, source);
  const large = 'x'.repeat(1_000_001);
  assert.equal(nativeWireRequest({ input: [{ type: 'function_call_output', call_id: 'one', output: large }] }, 'responses', 'chat-completions', model).messages[1].content, large);
});

test('opaque cross-protocol content fails locally without an upstream retry', async () => {
  let requests = 0;
  const gateway = await openNativeGateway({ runtime: 'codex', model,
    credentials: async () => ({ connection: { protocol: 'chat-completions', baseUrl: 'https://fixture.invalid', timeoutMs: 2000 } as any, key: '' }),
    fetcher: async () => { requests++; throw Error('unexpected upstream request'); },
  });
  try {
    const response = await fetch(gateway.baseUrl + '/v1/responses', { method: 'POST', headers: { authorization: 'Bearer ' + gateway.token }, body: JSON.stringify({ input: [{ type: 'function_call_output', call_id: 'one', output: { filename: 'fixture.zip', data: 'opaque' } }] }) });
    assert.equal(response.status, 422); assert.equal(requests, 0); assert.match(await response.text(), /NATIVE_PROVIDER_CONTENT_UNSUPPORTED/);
  } finally { await gateway.close(); }
});

for (const runtime of ['codex', 'claude'] as const) test(`${runtime} gateway forwards media and meters one upstream receipt`, async () => {
  let requests = 0, mappings = 0; const usage: any[] = [];
  const from = runtime === 'codex' ? 'responses' : 'anthropic-messages';
  const gateway = await openNativeGateway({ runtime, model,
    request: { map(...args) { mappings++; return nativeRequestCodec.map(...args); } },
    credentials: async () => ({ connection: { protocol: 'chat-completions', baseUrl: 'https://fixture.invalid', timeoutMs: 2000 } as any, key: '' }),
    usage: value => { usage.push(value); }, fetcher: async (_url, init) => {
      requests++; const mapped = JSON.parse(String(init?.body));
      assert.equal(mapped.messages[4].content[1].image_url.url, url);
      assert.equal(mapped.messages[2].content, 'Caption');
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Fixture' } }], usage: { prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 80 } });
    },
  });
  try {
    const response = await fetch(gateway.baseUrl + (runtime === 'codex' ? '/v1/responses' : '/v1/messages'), { method: 'POST', headers: { authorization: 'Bearer ' + gateway.token }, body: JSON.stringify({ ...request(from), stream: true }) });
    assert.equal(response.status, 200); assert.match(await response.text(), /Fixture/); await gateway.flushUsage();
    assert.equal(requests, 1); assert.equal(mappings, 1); assert.equal(usage.length, 1); assert.equal(usage[0].counts.totalTokens, 105);
  } finally { await gateway.close(); }
});
