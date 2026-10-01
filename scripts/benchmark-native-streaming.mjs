import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const baseline = process.env.AWB_STREAM_BASELINE_REF;
assert.ok(baseline, 'Provide an explicit baseline Git revision');
const root = process.cwd(), out = path.resolve('build/qa/native-stream-repair/benchmark');
await mkdir(out, { recursive: true });
const implementations = {};
for (const name of ['before', 'after']) {
  const outfile = path.join(out, name + '.mjs');
  await build({ stdin: { contents: "export { openNativeGateway } from './packages/model-api/native-gateway'; export { nativeWireStream } from './packages/model-api/native-wire';", resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent',
    plugins: name === 'before' ? [{ name: 'frozen-baseline', setup(b) { b.onLoad({ filter: /\.ts$/ }, args => ({ contents: execFileSync('git', ['show', baseline + ':' + path.relative(root, args.path).replaceAll('\\', '/')], { cwd: root, encoding: 'utf8', windowsHide: true }), loader: 'ts' })); } }] : [] });
  implementations[name] = await import(pathToFileURL(outfile));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const encode = v => new TextEncoder().encode('data: ' + (typeof v === 'string' ? v : JSON.stringify(v)) + '\n\n');
const model = { id: 'fixture', model: 'fixture', name: 'Fixture', enabled: true }, rows = [];
for (const [runtime, protocol] of [['codex', 'responses'], ['claude', 'anthropic-messages'], ['codex', 'chat-completions'], ['claude', 'chat-completions'], ['codex', 'anthropic-messages'], ['claude', 'responses']]) {
  for (let repeat = 0; repeat < 3; repeat++) for (const name of repeat % 2 ? ['after', 'before'] : ['before', 'after']) {
    let first, complete, calls = 0;
    const gateway = await implementations[name].openNativeGateway({ runtime, model, credentials: async () => ({ key: '', connection: { protocol, baseUrl: 'http://unused.invalid', auth: 'none', timeoutMs: 5000 } }), usage: () => sleep(120), fetcher: async () => {
      calls++;
      return new Response(new ReadableStream({ async start(c) {
        const send = v => c.enqueue(encode(v));
        if (protocol === 'anthropic-messages') { send({ type: 'message_start', message: { id: 'fixture', usage: { input_tokens: 7 } } }); send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }); }
        await sleep(15); first = performance.now();
        if (protocol === 'chat-completions') send({ choices: [{ delta: { content: 'First' } }] });
        else if (protocol === 'responses') send({ type: 'response.output_text.delta', delta: 'First' });
        else send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'First' } });
        await sleep(35); complete = performance.now();
        if (protocol === 'chat-completions') { send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 9 } }); send('[DONE]'); }
        else if (protocol === 'responses') send({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'First' }] }], usage: { input_tokens: 7, output_tokens: 9 } } });
        else { send({ type: 'content_block_stop', index: 0 }); send({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }); send({ type: 'message_stop' }); }
        c.close();
      } }), { headers: { 'content-type': 'text/event-stream' } });
    } });
    try {
      const r = await fetch(gateway.baseUrl + (runtime === 'codex' ? '/v1/responses' : '/v1/messages'), { method: 'POST', headers: { Authorization: 'Bearer ' + gateway.token }, body: JSON.stringify(runtime === 'codex' ? { input: 'Fixture', stream: true } : { messages: [{ role: 'user', content: 'Fixture' }], stream: true }) });
      const reader = r.body.getReader(); let received = '', firstSeen;
      while (true) { const part = await reader.read(); if (part.done) break; received += new TextDecoder().decode(part.value); if (!firstSeen && received.includes('First')) firstSeen = performance.now(); }
      rows.push({ name, runtime, protocol, repeat, firstDeltaLagMs: firstSeen - first, finishDeliveryLagMs: performance.now() - complete });
      assert.equal(calls, 1); assert.match(received, /First/); assert.match(received, /response.completed|message_stop/);
    } finally { await gateway.close(); }
  }
}
const dense = [];
for (let repeat = 0; repeat < 3; repeat++) for (const name of repeat % 2 ? ['after', 'before'] : ['before', 'after']) {
  global.gc?.(); const wire = implementations[name].nativeWireStream('responses', {}), piece = 'x'.repeat(64); let text = '', characters = 0;
  const start = performance.now();
  for (let i = 0; i < 16000; i++) { text += piece; const events = name === 'before' ? wire.text(text) : wire.push({ type: 'text', delta: piece }); characters += events.filter(e => e.type === 'response.output_text.delta').reduce((n, e) => n + e.delta.length, 0); }
  const result = wire.finish({ text, calls: [], usage: { inputTokens: 7, outputTokens: 9 }, raw: {} });
  assert.equal(characters, text.length); assert.equal(result.at(-1).response.output[0].content[0].text, text);
  dense.push({ name, repeat, chunks: 16000, characters, processingMs: performance.now() - start });
}
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = Object.fromEntries(['before', 'after'].map(name => [name, { firstDeltaLagMedianMs: median(rows.filter(r => r.name === name).map(r => r.firstDeltaLagMs)), finishDeliveryLagMedianMs: median(rows.filter(r => r.name === name).map(r => r.finishDeliveryLagMs)), denseProcessingMedianMs: median(dense.filter(r => r.name === name).map(r => r.processingMs)) }]));
await writeFile(path.join(out, 'report.json'), JSON.stringify({ baselineRevision: baseline, node: process.version, scope: 'Sequential synthetic loopback pairs; 120ms telemetry delay; no native CLI or paid model throughput claim', summary, rows, dense }, null, 2));
console.log(JSON.stringify(summary, null, 2));
