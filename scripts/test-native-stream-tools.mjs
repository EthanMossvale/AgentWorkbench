import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { LocalCliService } from '../packages/native-runtime/cli.ts';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider.ts';
import { StateStore } from '../apps/desktop/host/store.ts';
import { HostServiceRegistry } from '../packages/plugins-core/services.ts';
import { nativeWireEvents } from '../packages/model-api/native-wire.ts';

const output = path.resolve(process.env.AWB_STREAM_TOOLS_QA ?? 'build/qa/native-stream-repair/tools');
const home = path.join(output, 'home-' + Date.now());
await mkdir(path.join(home, '.codex'), { recursive: true }); await mkdir(path.join(home, '.claude'), { recursive: true });
const sentinel = 'LOCAL_STREAM_TOOL_' + randomUUID();
const executables = { codex: process.env.AWB_QA_CODEX, claude: process.env.AWB_QA_CLAUDE };
assert.ok(executables.codex && executables.claude, 'Explicit QA executables required');
const checks = [], errors = [], traces = []; let current;
const wait = async (check, name) => { const end = Date.now() + 30000; while (!await check() && Date.now() < end) await new Promise(r => setTimeout(r, 20)); assert.ok(await check(), name + ': ' + errors.join(' | ')); };
const server = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), test = current; assert.equal(body.model, 'stream-fixture'); test.requests++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = v => res.write('data: ' + (typeof v === 'string' ? v : JSON.stringify(v)) + '\n\n');
    const tools = body.tools.map(t => t.function ?? t);
    if (test.requests === 1) {
      traces.push({ runtime: test.runtime, protocol: test.protocol, tools: tools.map(t => t.name) });
      const tool = tools.find(t => t.name.includes('stream_fixture'));
      assert.ok(tool, 'No native fixture tool registration');
      const args = JSON.stringify({ probe: 'streamed-arguments' });
      const split = Math.floor(args.length / 2), first = args.slice(0, split), last = args.slice(split);
      if (test.protocol === 'chat-completions') {
        send({choices:[{delta:{content:'Inspecting. '}}]});
        send({ choices: [{ delta: { tool_calls: [0,1,2].map(index=>({ index, id: 'fixture_call_'+index, type: 'function', function: { name: tool.name, arguments: first } })) } }] });
      }
      else if (test.protocol === 'anthropic-messages') {
        send({ type: 'message_start', message: { id: 'fixture', role: 'assistant', type: 'message', model: 'stream-fixture', content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
        send({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'fixture_call', name: tool.name, input: {} } });
        send({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: first } });
      } else {
        send({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_fixture', call_id: 'fixture_call', name: tool.name, arguments: '', status: 'in_progress' } });
        send({ type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_fixture', delta: first });
      }
      await new Promise(r => setTimeout(r, 20));
      if (test.protocol === 'chat-completions') for(const index of [2,0,1])send({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: last } }] } }] });
      else if (test.protocol === 'anthropic-messages') send({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: last } });
      else send({ type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_fixture', delta: last });
      await new Promise(r => { test.release = r; res.once('close', r); });
      if (test.protocol === 'chat-completions') { send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 10 } }); send('[DONE]'); }
      else if (test.protocol === 'anthropic-messages') { send({ type: 'content_block_stop', index: 0 }); send({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 10 } }); send({ type: 'message_stop' }); }
      else send({ type: 'response.completed', response: { id: 'fixture', status: 'completed', output: [{ type: 'function_call', id: 'fc_fixture', call_id: 'fixture_call', name: tool.name, arguments: args, status: 'completed' }], usage: { input_tokens: 10, output_tokens: 10 } } });
    } else {
      assert.equal(test.requests, 2, 'The fixture must not restart or replay');
      if (!raw.includes(sentinel)) console.error('TOOL_RESULTS', JSON.stringify((body.messages ?? body.input ?? []).filter(m => m.role === 'tool' || m.type === 'function_call_output' || m.content?.some?.(p => p.type === 'tool_result')))); assert.ok(raw.includes(sentinel), 'The native tool did not return the fixture evidence'); test.toolVerified = true;
      const text = 'TOOL_RESULT_VERIFIED';
      const completion = tools.find(t => t.name === 'awb_complete_turn'); assert.ok(completion);
      const call = { id: 'final_call', name: completion.name, arguments: JSON.stringify({ outcome: 'completed', message: text }) };
      if (test.protocol === 'chat-completions') { send({ choices: [{ delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 5 } }); send('[DONE]'); }
      else for (const event of nativeWireEvents({ text: '', calls: [call], usage: { inputTokens: 20, outputTokens: 5 }, raw: {} }, test.protocol, body)) send(event);
    }
    res.end();
  } catch (error) { errors.push(String(error)); console.error('FIXTURE', error); res.end('data: [DONE]\n\n'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const model = { id: 'fixture', model: 'stream-fixture', name: 'Fixture', enabled: true, contextWindow: 128000 };
const connection = { id: 'fixture', revision: '1', name: 'Fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: 'chat-completions', enabled: true, auth: 'key', hasKey: true, models: [model], discoveredModels: [model], tools: true, timeoutMs: 60000, maxOutputTokens: 8192 };
const cli = new LocalCliService(output, { home, isolated: true, executables }); await cli.initialize();
const store = new StateStore(path.join(home, 'state')); await store.load(); await store.update(s => { s.modelConnections = [connection]; });
let writes = 0;
const runner = new NativeProviderRunner({ connection: () => connection, key: async () => 'fixture-key' }, cli, { snapshot: () => store.snapshot(), update: fn => { writes++; return store.update(fn); }, peers: id => ({ sourceSessionId: id, definitions: [{ name: 'stream_fixture', description: 'Read-only synthetic streaming check.', inputSchema: { type: 'object', properties: { probe: { type: 'string' } }, required: ['probe'], additionalProperties: false } }], call: async (name, args) => { assert.equal(name, 'stream_fixture'); assert.deepEqual(args, { probe: 'streamed-arguments' }); current.toolExecutions++; return { evidence: sentinel }; } }), observe: async () => {}, context: async () => '', translate: () => {}, failure: e => { errors.push(String(e)); console.error('RUNNER', e); } });
const registry = new HostServiceRegistry(); registry.register('runtime.native-provider', runner); let wrapped = 0;
const undo = registry.intercept('runtime.native-provider', 'openGateway', (next, options) => { wrapped++; return next(options); });
try {
  for (const [runtime, protocol] of [['codex', 'chat-completions'], ['claude', 'chat-completions'], ['codex', 'anthropic-messages'], ['claude', 'responses']]) {
    current = { runtime, protocol, requests: 0, toolExecutions: 0 }; connection.protocol = protocol;
    if (wrapped === 2) undo();
    const id = randomUUID(), before = writes;
    await store.update(s => { s.modelConnections = [connection]; s.sessions.push({ id, projectId: null, projectPath: home, title: 'Synthetic native tool', status: 'idle', binding: { runtime, provider: 'fixture', accountRef: 'model-api:fixture', executionId: 'local', egress: 'direct-api', modelConnectionId: 'fixture', modelMappingId: 'fixture' }, modelSelection: { model: model.model }, permissionMode: runtime === 'claude' ? 'plan' : 'read-only', messages: [], pinned: false, archived: false, group: '', createdAt: new Date().toISOString() }); });
    const session = () => store.snapshot().sessions.find(s => s.id === id);
    await runner.submit(id, { id: randomUUID(), original: 'Invoke only the read-only stream_fixture test tool.', translated: 'Invoke only the read-only stream_fixture test tool.', revisions: [], sourceHash: 'fixture', bypass: true, demo: false });
    await wait(() => current.release || errors.length || session().nativeTurnStatus === 'failed', 'Tool argument stream opened'); assert.ok(current.release, 'Tool request failed: ' + errors.join(' | '));
    await new Promise(r => setTimeout(r, 80)); assert.equal(current.requests, 1, 'No next request before the final receipt'); assert.equal(current.toolExecutions, 0, 'Complete JSON must not execute before the final receipt');
    current.release(); await wait(async () => { for(const a of session().nativeApprovals ?? []) { const detail = JSON.parse(a.details); assert.equal(detail.tool, 'mcp__workbench__stream_fixture'); assert.deepEqual(detail.input, { probe: 'streamed-arguments' }); await runner.approval(id, a.id, { decision: 'accept', receipt: a.receipt }); } return !runner.busy(id) || errors.length; }, 'Native tool round trip completed'); if(errors.length) await runner.stop(id); assert.deepEqual(errors, []);
    assert.equal(session().status, 'idle'); assert.ok(current.toolVerified); assert.equal(current.requests, 2); assert.equal(current.toolExecutions, protocol==='chat-completions'?3:1);
    assert.equal(session().messages.filter(m => m.role === 'assistant').map(m => m.original).join(''), (protocol==='chat-completions'?'Inspecting. ':'')+'TOOL_RESULT_VERIFIED');
    const result = { runtime, protocol, requests: current.requests, stateUpdates: writes - before }; checks.push(result); console.log('PASS', JSON.stringify(result));
  }
  assert.equal(wrapped, 2); assert.deepEqual(errors, []); checks.push({ pluginInterceptAndRestore: true });
} finally {
  undo(); current?.release?.(); server.closeAllConnections(); await new Promise(r => server.close(r)); await runner.dispose(); await cli.dispose();
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, traces, realModelCalls: 0, scope: 'Installed CLIs, isolated homes, side-effect-free native fixture tools and synthetic upstream' }, null, 2));
}
