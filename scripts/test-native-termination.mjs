import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalCliService } from '../packages/native-runtime/cli.ts';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider.ts';
import { nativeWireEvents } from '../packages/model-api/native-wire.ts';
import { nativeCompletionCodec } from '../packages/model-api/native-completion.ts';
import { PluginRegistry } from '../packages/plugins-core/index.ts';
import { encodeZip } from '../packages/native-resources/archive.ts';

// Installed CLIs and real tool execution, isolated homes and synthetic providers.
const output = path.resolve(process.env.AWB_TERMINATION_QA ?? 'build/qa/native-termination-native'); await mkdir(output, { recursive: true });
const home = await mkdtemp(path.join(os.tmpdir(), 'awb-terminal-native-'));
const executables = { codex: process.env.AWB_QA_CODEX, claude: process.env.AWB_QA_CLAUDE };
assert.ok(executables.codex && executables.claude, 'Explicit QA executables required');
for (const folder of ['.codex', '.claude', 'project']) await mkdir(path.join(home, folder));
const cli = new LocalCliService(home, { home, isolated: true, executables }); await cli.initialize();
const model = { id: 'fixture', model: 'termination-fixture', name: 'Fixture', enabled: true, contextWindow: 128000 };
const connection = { id: 'fixture', revision: '1', name: 'Fixture', baseUrl: 'https://fixture.invalid/v1', protocol: 'chat-completions', timeoutMs: 10000, enabled: true, auth: 'none', hasKey: false, models: [model] };
const state = { hosts: [], sessions: [], modelConnections: [connection] }, results = [], errors = [];
let current;
function response(protocol, text, calls = []) {
  if (protocol === 'chat-completions') return Response.json({ choices: [{ finish_reason: calls.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}) } }], usage: { prompt_tokens: 10, completion_tokens: 8 } });
  return new Response(nativeWireEvents({ text, calls, usage: { inputTokens: 10, outputTokens: 8 }, raw: {} }, protocol, { model: model.model }).map(v => `event: ${v.type}\ndata: ${JSON.stringify(v)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
const runner = new NativeProviderRunner({ connection: () => connection, key: async () => '' }, cli, {
  snapshot: () => structuredClone(state), update: async fn => fn(state), context: async () => '', translate: () => {},
  peers: () => ({ definitions: [{ name: 'termination_fixture', description: 'Read synthetic local acceptance evidence.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }], call: async (name) => { assert.equal(name, 'termination_fixture'); current.executions++; return { evidence: 'TOOL_EXECUTED_ONCE' }; } }),
  observe: async (_id, source) => {
    source.on('raw', frame => { if (frame.value.method === 'turn/completed') current.terminal.push(frame.value.params.turn.status); if(frame.value.method==='error') (current.nativeErrors??=[]).push(frame.value.params); });
    source.on('event', event => { if (event.raw?.value?.type === 'result') current.terminal.push(event.raw.value.subtype); });
  }, failure: e => { if (String(e).includes('NATIVE_COMPLETION_REQUIRED') && current.scenario === 'unmarked') return; errors.push(String(e)); },
}, async (_url, init) => {
  current.requests++; assert.ok(current.requests <= 32, 'Native retry acceptance guard');
  const body = JSON.parse(init.body), protocol = connection.protocol;
  const native = protocol === (current.runtime === 'codex' ? 'responses' : 'anthropic-messages');
  assert.equal(body.model, model.model);
  if (protocol === 'chat-completions') {
    assert.equal(body.tool_choice, 'auto', 'The bridge does not force tools on thinking providers');
    assert.ok(body.messages.every(m => ['system','user','assistant','tool'].includes(m.role)), 'Compatible roles only');
    assert.ok(body.messages.every(m => m.content === null || typeof m.content === 'string'), 'Text-only histories use string content');
  }
  if (native) return response(protocol, 'Native final response.');
  const complete = body.tools.map(t => t.function ?? t).find(t => t.name === 'awb_complete_turn'); assert.ok(complete, 'Explicit completion contract is present');
  assert.match(protocol === 'chat-completions' ? body.messages[0].content : protocol === 'anthropic-messages' ? body.system : body.instructions, /A text-only reply is not a valid completion/);
  if (current.scenario === 'unmarked') return response(protocol, 'I am still checking the remaining step.');
  if (current.requests === 1) {
    const tool = body.tools.map(t => t.function ?? t).find(t => t.name.includes('termination_fixture')); assert.ok(tool);
    return response(protocol, 'Checking the fixture.', [{ id: 'fixture_call', name: tool.name, arguments: '{}' }]);
  }
  assert.equal(current.executions, 1); assert.ok(init.body.includes('TOOL_EXECUTED_ONCE'));
  if (protocol === 'chat-completions' && current.runtime === 'codex') {
    const assistant = body.messages.find(m => m.tool_calls?.some(c => c.id === 'fixture_call'));
    assert.equal(assistant.content, 'Checking the fixture.', 'Progress and actual calls share the assistant batch');
  }
  return response(protocol, '', [{ id: 'finish_call', name: complete.name, arguments: JSON.stringify({ outcome: 'completed', message: 'Fixture completed and verified.' }) }]);
});
const plugins = new PluginRegistry(path.join(home, 'plugins')); await plugins.initialize();
plugins.services.register('runtime.native-provider', runner, { version: 1 });
plugins.services.register('runtime.native-completion', nativeCompletionCodec, { version: 1 });
const manifest = { schemaVersion: 1, apiVersion: 1, id: 'qa.termination', name: 'Synthetic completion', version: '1.0.0', description: 'Synthetic completion codec lifecycle', capabilities: ['host'], main: 'main.mjs' };
const source = `export function activate(api) { let prepared=0, disposed=0; api.registerCommand('counts',()=>({prepared,disposed})); api.services.intercept('runtime.native-completion','prepare',(next,...args)=> { const boundary=next(...args); if(!boundary)return boundary; prepared++; return {...boundary,finish(turn){const result=boundary.finish(turn);return result.completionOutcome?{...result,text:result.text+' PLUGIN_VERIFIED'}:result;},dispose(){disposed++;boundary.dispose?.();}}; }); }`;
try {
  const zip = path.join(home, 'plugin.zip'); await writeFile(zip, encodeZip([{ name: 'workbench.plugin.json', data: Buffer.from(JSON.stringify(manifest)) }, { name: 'main.mjs', data: Buffer.from(source) }]));
  await plugins.importZip(zip); const plugin = (await plugins.list())[0];
  await assert.rejects(plugins.setEnabled(manifest.id, plugin.hash, true), /Explicit approval/);
  const cross = [['codex', 'chat-completions'], ['claude', 'chat-completions'], ['codex', 'anthropic-messages'], ['claude', 'responses']];
  const scenarios = cross.flatMap(([runtime, protocol]) => ['unmarked', 'tools'].map(scenario => ({ runtime, protocol, scenario, phase: 'core' })));
  scenarios.push(...['codex', 'claude'].map(runtime => ({ runtime, protocol: runtime === 'codex' ? 'responses' : 'anthropic-messages', scenario: 'native', phase: 'core' })));
  scenarios.push(...['enabled', 'disabled', 'reenabled', 'removed'].map(phase => ({ runtime: 'codex', protocol: 'chat-completions', scenario: 'tools', phase })));
  for (const { runtime, protocol, scenario, phase } of scenarios) {
    if(process.env.AWB_TERMINATION_CASE && ![runtime,protocol,scenario,phase].join('/').includes(process.env.AWB_TERMINATION_CASE))continue;
    if (phase === 'enabled' || phase === 'reenabled') await plugins.setEnabled(manifest.id, plugin.hash, true, phase === 'enabled');
    if (phase === 'disabled') await plugins.setEnabled(manifest.id, plugin.hash, false);
    if (phase === 'removed') { const installed = (await plugins.list()).find(p => p.manifest.id === manifest.id).directory; assert.equal(path.dirname(installed), path.join(home, 'plugins', 'plugins')); await rm(installed, { recursive: true }); await plugins.refresh(); }
    current = { runtime, protocol, phase, scenario, requests: 0, executions: 0, terminal: [] }; results.push(current); connection.protocol = protocol;
    const id = randomUUID(), session = { id, title: 'Synthetic terminal', projectId: null, projectPath: path.join(home, 'project'), status: 'idle', messages: [], modelSelection: { model: model.model }, permissionMode: runtime === 'claude' ? 'plan' : 'read-only', binding: { runtime, provider: 'fixture', accountRef: 'fixture', executionId: 'local', egress: 'direct-api', modelConnectionId: 'fixture', modelMappingId: 'fixture' } };
    state.sessions.push(session); await runner.submit(id, { id: randomUUID(), original: 'Inspect the synthetic fixture and report the evidence.', translated: 'Inspect the synthetic fixture and report the evidence.', revision: 1, revisions: [], sourceHash: 'fixture', bypass: true, demo: false });
    const deadline = Date.now() + 45000;
    while (runner.busy(id) && Date.now() < deadline) {
      for (const approval of session.nativeApprovals ?? []) {
        const detail = JSON.parse(approval.details); assert.equal(detail.tool, 'mcp__workbench__termination_fixture');
        await runner.approval(id, approval.id, { decision: 'accept', receipt: approval.receipt });
      }
      await new Promise(r => setTimeout(r, 30));
    }
    assert.equal(runner.busy(id), false, JSON.stringify({ runtime, scenario, errors }));
    if (scenario === 'unmarked') {
      assert.equal(session.nativeTurnStatus, 'failed'); assert.match(session.nativeError, /NATIVE_COMPLETION_REQUIRED/);
      assert.ok(session.nativeProviderReceipts.some(r => r.boundary === 'unmarked'));
      assert.equal(current.executions, 0);
    } else {
      assert.equal(session.nativeTurnStatus, 'completed');
      if (scenario === 'tools') {
        assert.equal(current.requests, 2); assert.equal(current.executions, 1);
        assert.deepEqual(session.nativeProviderReceipts.map(r => r.boundary), ['tools', 'explicit']);
        if (runtime === 'codex') assert.deepEqual(session.messages.filter(m => m.role === 'assistant').map(m => m.phase), ['commentary', 'final']);
        assert.equal(session.messages.at(-1).original, 'Fixture completed and verified.' + (['enabled', 'reenabled'].includes(phase) ? ' PLUGIN_VERIFIED' : ''));
      } else { assert.equal(current.requests, 1); assert.equal(session.messages.at(-1).original, 'Native final response.'); }
    }
    if (['enabled', 'reenabled'].includes(phase)) assert.deepEqual(await plugins.command(manifest.id, 'counts', {}), { prepared: 2, disposed: 2 });
    current.errorCode = scenario === 'unmarked' ? 'NATIVE_COMPLETION_REQUIRED' : undefined;
    console.log('PASS', runtime, protocol, scenario, phase, current.requests, 'requests');
  }
  assert.deepEqual(errors, []);
} finally {
  await plugins.dispose(); await runner.dispose(); await cli.dispose();
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ results, errors, realModelCalls: 0, scope: 'Installed native CLIs; explicit completion/tool round trips and rejected unmarked progress; synthetic providers; approved plugin lifecycle. No real-model semantic-quality claim.' }, null, 2));
  assert.equal(path.dirname(home), path.resolve(os.tmpdir())); assert.ok(path.basename(home).startsWith('awb-terminal-native-')); await rm(home, { recursive: true, force: true, maxRetries: 3 });
}
