import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { openNativeGateway } from '../packages/model-api/native-gateway';
import { nativeWireStream } from '../packages/model-api/native-wire';
import { collectStream } from '../packages/model-api/provider';
import { OrderedMutations } from '../packages/session-core/ordered-mutations';
import { API_DEFAULTS } from '../packages/model-api/config';

const model = { id: 'fixture', model: 'fixture', name: 'Fixture', enabled: true };
const connection = { ...API_DEFAULTS, id: 'fixture', revision: '1', name: 'Fixture', baseUrl: 'http://fixture.invalid/v1', protocol: 'chat-completions' as const, enabled: true, auth: 'none' as const, hasKey: false, models: [model], discoveredModels: [] };
const encode = (v: unknown) => new TextEncoder().encode('data: ' + (typeof v === 'string' ? v : JSON.stringify(v)) + '\n\n');
const turn = (text = '', calls: any[] = []) => ({ text, calls, usage: { inputTokens: 7, outputTokens: 9 }, raw: {} });
const counts = { inputTokens: 20, outputTokens: 9, totalTokens: 29, cacheReadTokens: 10, cacheWriteTokens: 3 };
function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function within<T>(promise: Promise<T>) { let timer: NodeJS.Timeout; try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Timed out waiting for stream evidence')), 3000); })]); } finally { clearTimeout(timer!); } }
const parse = (s: string) => s.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5)));
const body = (runtime: string) => runtime === 'codex' ? { model: 'fixture', input: 'Synthetic', stream: true } : { model: 'fixture', messages: [{ role: 'user', content: 'Synthetic' }], stream: true };
const request = (g: Awaited<ReturnType<typeof openNativeGateway>>, runtime: string, signal?: AbortSignal) => fetch(g.baseUrl + (runtime === 'codex' ? '/v1/responses' : '/v1/messages'), { method: 'POST', headers: { Authorization: 'Bearer ' + g.token }, body: JSON.stringify(body(runtime)), signal });

for (const protocol of ['responses', 'anthropic-messages'] as const) test(`${protocol}: interleaved tools retain arguments and native block order without early execution`, () => {
  const wire = nativeWireStream(protocol, { model: 'fixture', tools: [{ type: 'function', name: 'first' }, { type: 'function', name: 'second' }] });
  const events = [...wire.push({ type: 'tool', index: 0, id: 'a', name: 'first', argumentsDelta: '{"x":' }), ...wire.delta('Working'), ...wire.push({ type: 'tool', index: 1, id: 'b', name: 'second', argumentsDelta: '{"y":' }), ...wire.push({ type: 'tool', index: 0, id: 'a', name: 'first', argumentsDelta: '1}' })];
  if(protocol==='responses')assert.ok(events.some(e=>e.type==='response.function_call_arguments.delta'));
  else assert.ok(events.every(e=>e.delta?.type!=='input_json_delta'));
  assert.ok(events.every(e => !/done|stop|completed/.test(e.type)));
  const final = wire.finish(turn('Working', [{ id: 'a', name: 'first', arguments: '{"x":1}' }, { id: 'b', name: 'second', arguments: '{"y":2}' }]), counts);
  events.push(...final);
  if (protocol === 'responses') {
    assert.deepEqual(events.map(e => e.sequence_number), events.map((_, i) => i));
    assert.deepEqual(events.at(-1)!.response.output.map((v: any) => v.type), ['function_call', 'message', 'function_call']);
    assert.equal(events.filter(e => e.type === 'response.function_call_arguments.delta' && e.output_index === 0).map(e => e.delta).join(''), '{"x":1}');
  } else {
    let open:number|undefined;
    for(const event of events){
      if(event.type==='content_block_start'){assert.equal(open,undefined,'Messages blocks cannot overlap');open=event.index;}
      if(event.type==='content_block_delta')assert.equal(event.index,open,'A delta belongs to the currently open block');
      if(event.type==='content_block_stop'){assert.equal(event.index,open);open=undefined;}
    }
    assert.equal(open,undefined);
    assert.equal(events.filter(e => e.type === 'content_block_start').length, 3);
    assert.equal(events.filter(e => e.type === 'content_block_stop').length, 3);
    assert.equal(events.at(-2)!.usage.input_tokens, 7);
  }
});

test('custom freeform input streams escaped Unicode across every byte boundary', () => {
  const wire = nativeWireStream('responses', { tools: [{ type: 'custom', name: 'apply_patch' }] });
  const args = '{"ignored":{"text":"input"},"input":"line\\n\\u4e2d\\ud83d\\ude00\\\\end"}';
  const events: any[] = [];
  for (const part of args) events.push(...wire.push({ type: 'tool', index: 0, id: 'patch', name: 'apply_patch', argumentsDelta: part }));
  assert.equal(events.filter(e => e.type === 'response.custom_tool_call_input.delta').map(e => e.delta).join(''), JSON.parse(args).input);
  assert.ok(events.every(e => e.type !== 'response.output_item.done'));
  events.push(...wire.finish(turn('', [{ id: 'patch', name: 'apply_patch', arguments: args }])));
  assert.equal(events.at(-1).response.output[0].input, JSON.parse(args).input);
});

test('final mismatch, invalid JSON, missing calls and changed identities never complete tools', () => {
  for (const args of ['{"x":2}', '{', '[]']) {
    const wire = nativeWireStream('responses', {}); wire.push({ type: 'tool', index: 0, id: 'call', name: 'run', argumentsDelta: '{"x":1}' });
    assert.throws(() => wire.finish(turn('', [{ id: 'call', name: 'run', arguments: args }])));
  }
  const missing = nativeWireStream('responses', {}); missing.push({ type: 'tool', index: 0, id: 'call', name: 'run', argumentsDelta: '{}' });
  assert.throws(() => missing.finish(turn('Text')), /TOOL_CHANGED/);
  assert.throws(() => missing.push({ type: 'tool', index: 0, id: 'other', name: 'run', argumentsDelta: '' }), /TOOL_CHANGED/);
});

for (const protocol of ['chat-completions', 'responses', 'anthropic-messages'] as const) test(`${protocol}: incremental tools, fragmented UTF-8 and terminal receipt without EOF`, async () => {
  let canceled = false; const deltas: any[] = [];
  const call = { id: 'call', name: 'Read', arguments: '{ "path": "中😀" }' };
  const frames: any[] = protocol === 'chat-completions' ? [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: call.id, function: { name: 'Read', arguments: '{ "path": ' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"中😀" }' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 7, completion_tokens: 9 } }, '[DONE]',
  ] : protocol === 'responses' ? [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: call.id, name: call.name, arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: call.arguments },
    { type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments }], usage: { input_tokens: 7, output_tokens: 9 } } },
  ] : [
    { type: 'message_start', message: { id: 'fixture', usage: { input_tokens: 7 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: call.arguments } },
    { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }, { type: 'message_stop' },
  ];
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (const f of frames) for (const byte of encode(f)) c.enqueue(Uint8Array.of(byte)); }, cancel() { canceled = true; } });
  const result = await within(collectStream(new Response(stream), protocol, undefined, { onDelta: d => { deltas.push(d); } }));
  assert.ok(canceled); assert.ok(result); assert.equal(deltas.filter(d => d.type === 'tool').map(d => d.argumentsDelta).join(''), call.arguments);
  const trailing = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Buffer.concat([...frames.map(encode), Buffer.from('data: invalid trailer\n\n')])); } });
  assert.deepEqual(await within(collectStream(new Response(trailing), protocol)), result);
});

for (const [runtime, protocol] of [['codex', 'responses'], ['claude', 'anthropic-messages'], ['codex', 'chat-completions'], ['claude', 'chat-completions'], ['codex', 'anthropic-messages'], ['claude', 'responses']] as const) test(`${runtime}/${protocol}: slow or failing telemetry cannot delay or erase native completion`, async () => {
  const gate = deferred(); let hook = false;
  const raw = protocol === 'responses' ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done' }] }], usage: { input_tokens: 7, output_tokens: 9 } } : protocol === 'anthropic-messages' ? { content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn', usage: { input_tokens: 7, output_tokens: 9 } } : { choices: [{ message: { content: 'Done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 9 } };
  const errors: unknown[] = [];
  const g = await openNativeGateway({ runtime, model, credentials: async () => ({ connection: { ...connection, protocol }, key: '' }), fetcher: async () => new Response(JSON.stringify(raw), { headers: { 'content-type': 'application/json' } }), usage: async () => { hook = true; await gate.promise; throw Error('Synthetic telemetry failure'); }, failure: e => errors.push(e) });
  try {
    const text = await within((await request(g, runtime)).text()); assert.match(text, /Done/); assert.ok(hook); assert.equal(errors.length, 0);
    gate.resolve(); await g.flushUsage(); assert.equal(errors.length, 1);
  } finally { gate.resolve(); await g.close(); }
});

for (const same of [false, true]) test(`${same ? 'same' : 'cross'} protocol cancellation stops an idle upstream read`, async () => {
  const canceled = deferred();
  const g = await openNativeGateway({ runtime: 'codex', model, credentials: async () => ({ connection: { ...connection, protocol: same ? 'responses' : 'chat-completions' }, key: '' }), fetcher: async () => new Response(new ReadableStream({ cancel() { canceled.resolve(); } }), { headers: { 'content-type': 'text/event-stream' } }) });
  const abort = new AbortController();
  try { const response = await request(g, 'codex', abort.signal); abort.abort(); await response.body?.cancel().catch(() => {}); await within(canceled.promise); }
  finally { abort.abort(); await g.close(); }
});

test('same-protocol slow readers apply backpressure and closing releases upstream', async () => {
  let pulls = 0, canceled = false;
  const chunk = new TextEncoder().encode(':' + 'x'.repeat(65530) + '\n\n');
  const g = await openNativeGateway({ runtime: 'codex', model, credentials: async () => ({ connection: { ...connection, protocol: 'responses' }, key: '' }), fetcher: async () => new Response(new ReadableStream({ pull(c) { pulls++; c.enqueue(chunk); if (pulls === 2048) c.close(); }, cancel() { canceled = true; } }), { headers: { 'content-type': 'text/event-stream' } }) });
  const url = new URL(g.baseUrl + '/v1/responses'), socket = createConnection({ host: url.hostname, port: Number(url.port) });
  try {
    await once(socket, 'connect'); socket.write(`POST ${url.pathname} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${g.token}\r\nContent-Length: 2\r\n\r\n{}`);
    await once(socket, 'data'); socket.pause(); await new Promise(r => setTimeout(r, 120));
    assert.ok(pulls < 2048, `Upstream was drained despite a paused reader: ${pulls}`);
    socket.destroy(); await new Promise(r => setTimeout(r, 30)); assert.ok(canceled);
  } finally { socket.destroy(); await g.close(); }
});

test('state bursts coalesce around persistence barriers with exact ordering and failure propagation', async () => {
  const gate = deferred(), state: string[] = []; let writes = 0;
  const q = new OrderedMutations<string[]>(async mutate => { writes++; if (writes === 1) await gate.promise; mutate(state); });
  const first = q.push(s => s.push('first')); await Promise.resolve();
  for (let i = 0; i < 1000; i++) void q.push(s => s.push(String(i)));
  const middle = q.barrier(async () => { state.push('barrier'); });
  for (let i = 0; i < 1000; i++) void q.push(s => s.push('b' + i));
  gate.resolve(); await first; await middle; await q.flush();
  assert.equal(writes, 3); assert.deepEqual(state, ['first', ...Array.from({ length: 1000 }, (_, i) => String(i)), 'barrier', ...Array.from({ length: 1000 }, (_, i) => 'b' + i)]);
  const failing = new OrderedMutations<string[]>(async () => { throw Error('Disk failure'); }); await assert.rejects(failing.push(() => {}), /Disk failure/); await assert.rejects(failing.flush(), /Disk failure/);
});

test('timed state batches combine separate event-loop deliveries and flush before a barrier', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const state:number[]=[];let writes=0;
  const queue=new OrderedMutations<number[]>(async mutate=>{writes++;mutate(state);},100);
  for(let i=0;i<8;i++){void queue.push(s=>s.push(i));await Promise.resolve();t.mock.timers.tick(2);}
  assert.equal(writes,0);
  await queue.barrier(async()=>{assert.deepEqual(state,[0,1,2,3,4,5,6,7]);state.push(8);});
  void queue.push(s=>s.push(9));await queue.flush();
  assert.equal(writes,2);assert.deepEqual(state,[0,1,2,3,4,5,6,7,8,9]);
});

for (const runtime of ['codex', 'claude'] as const) test(`${runtime}: the gateway preserves native streaming constraints and rejects invalid final JSON`, async () => {
  for (const valid of [true, false]) {
    const release = deferred(); const errors: unknown[] = [];
    const upstream = new ReadableStream<Uint8Array>({ async start(c) {
      c.enqueue(encode({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'fixture', arguments: '{"x":' } }] } }] }));
      await release.promise;
      c.enqueue(encode({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: valid ? '1}' : 'bad}' } }] }, finish_reason: 'tool_calls' }] }));
      c.enqueue(encode('[DONE]')); c.close();
    } });
    const g = await openNativeGateway({ runtime, model, credentials: async () => ({ connection, key: '' }), fetcher: async () => new Response(upstream, { headers: { 'content-type': 'text/event-stream' } }), failure: e => errors.push(e) });
    try {
      const response = await request(g, runtime), reader = response.body!.getReader(), decoder = new TextDecoder(); let received = '';
      const read = async () => { const part = await within(reader.read()); if (!part.done) received += decoder.decode(part.value, { stream: true }); return !part.done; };
      while (!received.includes(runtime === 'codex' ? 'response.function_call_arguments.delta' : 'message_start')) assert.ok(await read());
      if(runtime==='claude')assert.doesNotMatch(received,/input_json_delta/);
      assert.doesNotMatch(received, /event: (?:response\.function_call_arguments\.done|response\.output_item\.done|content_block_stop|message_stop)/);
      release.resolve(); while (await read()) {}
      if (valid) { assert.match(received, /event: (?:response.completed|message_stop)/); assert.equal(errors.length, 0); }
      else { assert.match(received, /event: error/); assert.doesNotMatch(received, /event: (?:response.completed|response\.function_call_arguments\.done|response\.output_item\.done|content_block_stop|message_stop)/); assert.equal(errors.length, 1); }
    } finally { release.resolve(); await g.close(); }
  }
});
