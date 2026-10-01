import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { LocalCliService } from '../packages/native-runtime/cli.ts';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider.ts';
import { StateStore } from '../apps/desktop/host/store.ts';

// Real installed CLIs, isolated native homes, synthetic upstream; no provider requests.
const output = path.resolve(process.env.AWB_IMAGE_ROUTING_QA ?? 'build/qa/native-image-routing');
const home = path.join(output, 'home-' + Date.now());
await mkdir(path.join(home, '.codex'), { recursive: true }); await mkdir(path.join(home, '.claude'), { recursive: true });
const executables = { codex: process.env.AWB_QA_CODEX, claude: process.env.AWB_QA_CLAUDE };
assert.ok(executables.codex && executables.claude, 'Explicit QA executables required');
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
const chunk = (name, data) => { const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data]))); return Buffer.concat([size, type, data, crc]); };
const header = Buffer.alloc(13); header.writeUInt32BE(64, 0); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 2;
const pixels = Buffer.alloc(64 * (1 + 64 * 3), 120); for (let row = 0; row < 64; row++) pixels[row * 193] = 0;
const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
const imagePath = path.join(home, 'fixture.png'); await writeFile(imagePath, image);
const model = { id: 'fixture', model: 'image-fixture', name: 'Fixture', enabled: true, contextWindow: 128000 };
const connection = { id: 'fixture', revision: '1', name: 'Fixture', baseUrl: 'https://fixture.invalid/v1', protocol: 'chat-completions', enabled: true, auth: 'key', hasKey: true, models: [model], discoveredModels: [model], tools: true, timeoutMs: 30000, maxOutputTokens: 8192 };
const cli = new LocalCliService(output, { home, isolated: true, executables }); await cli.initialize();
const store = new StateStore(path.join(home, 'state')); await store.load(); await store.update(s => { s.modelConnections = [connection]; });
const checks = [], errors = []; let current;
const fetcher = async (_url, init) => {
  try {
    const body = JSON.parse(init.body), tools = body.tools.map(t => t.function ?? t); current.requests++;
    assert.ok(current.requests <= 2, 'No unexpected model continuation');
    let call;
    if (current.requests === 1) {
      const tool = tools.find(t => t.name === (current.runtime === 'codex' ? 'view_image' : 'Read'));
      assert.ok(tool, 'Native image reader must be advertised');
      call = { id: 'fixture-image', type: 'function', function: { name: tool.name, arguments: JSON.stringify(current.runtime === 'codex' ? { path: imagePath } : { file_path: imagePath }) } };
    } else {
      const result = body.messages.find(m => m.role === 'tool' && m.tool_call_id === 'fixture-image'); assert.ok(result);
      assert.equal(typeof result.content, 'string'); assert.ok(result.content.length < 1000); assert.ok(!result.content.includes('base64,'));
      const imageMessage = body.messages.find(m => m.role === 'user' && Array.isArray(m.content) && m.content.some(p => p.type === 'image_url'));
      assert.ok(imageMessage, 'Native image output must reach the upstream as image content');
      assert.ok(body.messages.indexOf(imageMessage) > body.messages.indexOf(result));
      const media = imageMessage.content.find(p => p.type === 'image_url'); assert.match(media.image_url.url, /^data:image\//);
      current.imageChars = media.image_url.url.length; current.toolTextChars = result.content.length;
      const end = tools.find(t => t.name === 'awb_complete_turn'); assert.ok(end);
      call = { id: 'fixture-finish', type: 'function', function: { name: end.name, arguments: JSON.stringify({ outcome: 'completed', message: 'IMAGE_ROUTE_VERIFIED' }) } };
    }
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [call] } }], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 80 } });
  } catch (error) { errors.push(error.message); throw error; }
};
const runner = new NativeProviderRunner({ connection: () => connection, key: async () => 'synthetic-key' }, cli, {
  snapshot: () => store.snapshot(), update: fn => store.update(fn), peers: id => ({ sourceSessionId: id, definitions: [], call: async () => { throw Error('No peer calls'); } }), observe: async () => {}, context: async () => '', translate: () => {}, failure: e => { errors.push(String(e)); },
}, fetcher);
try {
  for (const runtime of ['codex', 'claude']) {
    current = { runtime, requests: 0 }; const id = randomUUID();
    await store.update(s => s.sessions.push({ id, projectId: null, projectPath: home, title: 'Synthetic image route', status: 'idle', binding: { runtime, provider: 'fixture', accountRef: 'model-api:fixture', executionId: 'local', egress: 'direct-api', modelConnectionId: 'fixture', modelMappingId: 'fixture' }, modelSelection: { model: model.model }, permissionMode: runtime === 'claude' ? 'plan' : 'read-only', messages: [], pinned: false, archived: false, group: '', createdAt: new Date().toISOString() }));
    await runner.submit(id, { id: randomUUID(), original: 'Read only the synthetic fixture.png image.', translated: 'Read only the synthetic fixture.png image.', revisions: [], sourceHash: 'fixture', bypass: true, demo: false });
    const deadline = Date.now() + 45000;
    while (runner.busy(id) && !errors.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
    if (runner.busy(id)) await runner.stop(id);
    const s = store.snapshot().sessions.find(s => s.id === id);
    assert.deepEqual(errors, []); assert.equal(s.status, 'idle', s.nativeError); assert.equal(current.requests, 2);
    assert.ok(s.messages.some(m => m.role === 'assistant' && m.original.includes('IMAGE_ROUTE_VERIFIED')));
    checks.push(current); console.log('PASS', JSON.stringify(current));
  }
} finally {
  await runner.dispose(); await cli.dispose();
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, realModelCalls: 0, scope: 'Installed CLIs and actual image reads in isolated homes, synthetic upstream' }, null, 2));
}
