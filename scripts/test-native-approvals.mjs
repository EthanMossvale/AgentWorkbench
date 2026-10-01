import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { LocalCliService } from '../packages/native-runtime/cli.ts';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider.ts';

// Native binaries and synthetic upstream only. Never inspect an existing native home.
const output = path.resolve(process.env.AWB_APPROVAL_QA ?? 'build/qa/approval-ui/live'), home = path.join(output, 'home-' + Date.now());
for (const name of ['.codex', '.claude']) await mkdir(path.join(home, name), { recursive: true });
assert.ok(process.env.AWB_QA_CODEX && process.env.AWB_QA_CLAUDE, 'Explicit isolated QA executable paths required.');
const checks = [], errors = [], receipts = [], upstream = [], budgets = [];
let scenario = 'approval', rejected = false;
const server = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw), tools = body.tools?.map(t => t.function?.name) ?? [], claude = tools.includes('Bash');
    const results = body.messages.filter(m => m.role === 'tool');
    upstream.push({ runtime: claude ? 'claude' : 'codex', model:body.model, toolNames: tools, results: results.map(m => m.content) });
    if (upstream.length > 16) { res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({error:{message:'Synthetic fixture request guard reached.'}})); return; }
    if(scenario==='context'){res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'CONTEXT_COMPLETE'}}],usage:{prompt_tokens:300000,completion_tokens:10}}));return;}
    if (scenario === 'recovery') {
      if (!rejected) { rejected = true; res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'invalid_request_error', param: 'messages[2].role', message: 'An assistant message with tool_calls must be followed by the matching tool results.' } })); return; }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'MANUAL_RECOVERY_COMPLETE' } }], usage: { prompt_tokens: 300000, completion_tokens: 10 } })); return;
    }
    const command = claude ? 'node -e "console.log(\'APPROVAL_RULE_OK\')"' : 'git --version';
    const name = claude ? 'Bash' : tools.includes('exec_command') ? 'exec_command' : 'shell_command';
    const args = claude ? { command, description: 'Run a synthetic local approval fixture.' } : { [name === 'exec_command' ? 'cmd' : 'command']: command, sandbox_permissions: 'require_escalated', justification: 'Allow the isolated synthetic approval fixture?', prefix_rule: ['git', '--version'] };
    const response = results.length >= 2 ? { finish_reason: 'stop', message: { role: 'assistant', content: 'APPROVAL_FIXTURE_COMPLETE' } } : { finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: `approval-fixture-${results.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [response], usage: { prompt_tokens: 300000, completion_tokens: 20 } }));
  } catch (error) { errors.push(String(error)); res.writeHead(500).end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const model = { id: 'fixture', model: 'fixture-model', name: 'Fixture', enabled: true, contextWindow: 1000000 };
const connection = { id: 'fixture', revision: 'fixture', name: 'Fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: 'chat-completions', enabled: true, auth: 'key', hasKey: true, models: [model], tools: true, timeoutMs: 20000, maxOutputTokens: 8192 };
const cli = new LocalCliService(output, { home, isolated: true, executables: { codex: process.env.AWB_QA_CODEX, claude: process.env.AWB_QA_CLAUDE } }); await cli.initialize();
const state = { hosts: [], sessions: [], modelConnections: [connection] };
const runner = new NativeProviderRunner({ connection: () => connection, key: async () => 'synthetic' }, cli, {
  snapshot: () => structuredClone(state), update: async fn => fn(state), context: async () => '', translate: () => {},
  observe: async (_id, source) => { source.on('raw', frame => { if(frame.value.method==='thread/tokenUsage/updated') budgets.push(frame.value.params.tokenUsage); if(frame.value.method?.endsWith('/requestApproval'))receipts.push(frame.value); }); },
  peers: id => ({ sourceSessionId: id, definitions: [], call: async () => { throw Error('Unexpected tool.'); } }), failure: error => errors.push(String(error)),
});
const wait = async (predicate, label) => { const until = Date.now() + 45000; while (!predicate() && Date.now() < until) await new Promise(r => setTimeout(r, 50)); assert.ok(predicate(), label + ' ' + JSON.stringify({ errors, receipts, upstream })); };
try {
  for (const runtime of ['codex', 'claude']) {
    const projectPath = path.join(home, 'project-' + runtime); await mkdir(projectPath, { recursive: true });
    const session = { id: randomUUID(), projectId: null, projectPath, title: 'Approval fixture', status: 'idle', binding: { runtime, provider: 'fixture', accountRef: 'model-api:fixture', executionId: 'local-device', egress: 'direct-api', modelConnectionId: 'fixture', modelMappingId: 'fixture' }, modelSelection: { model: model.model }, permissionMode: 'default', messages: [] }; state.sessions.push(session);
    await runner.submit(session.id, { id: randomUUID(), original: 'Run the synthetic command twice, then finish.', translated: 'Run the synthetic command twice, then finish.', revisions: [], sourceHash: 'fixture', bypass: true, demo: false });
    await wait(() => session.nativeApprovals?.length || session.status === 'idle', runtime + ' approval arrival');
    const approval = session.nativeApprovals?.[0]; assert.ok(approval, runtime + ' must request native approval');
    const saved = approval.options.find(o => o.scope === 'saved'); assert.ok(saved, runtime + ' must supply a native saved rule. ' + JSON.stringify(approval));
    await assert.rejects(runner.approval(session.id, approval.id, { optionId: saved.id, receipt: 'stale' }), /EXPIRED/);
    await runner.approval(session.id, approval.id, { optionId: saved.id, receipt: approval.receipt });
    await assert.rejects(runner.approval(session.id, approval.id, { optionId: saved.id, receipt: approval.receipt }), /EXPIRED/);
    await wait(() => session.nativeApprovals?.length || session.status === 'idle', runtime + ' repeated command completion');
    assert.equal(session.nativeApprovals?.length ?? 0, 0, runtime + ' matching second command should use native saved rule');
    assert.match(session.messages.at(-1)?.original ?? '', /APPROVAL_FIXTURE_COMPLETE/);
    checks.push(runtime + ': native saved rule permits repeated command without a second prompt'); console.log('PASS ' + checks.at(-1));
    await wait(() => !runner.busy(session.id), runtime + ' process cleanup');
    assert.equal(session.nativeContextUsage?.capacity, 1000000);
    assert.ok(session.nativeContextUsage?.runtimeCapacity >= 900000, runtime + ' native budget follows the declared model: ' + JSON.stringify(session.nativeContextUsage));
    checks.push(runtime + ': 1M model reaches native context budget with 300K synthetic usage'); console.log('PASS ' + checks.at(-1));
    scenario = 'recovery'; rejected = false; const before = upstream.length;
    const preview = () => ({ id: randomUUID(), original: 'Explicit recovery test.', translated: 'Explicit recovery test.', revisions: [], sourceHash: 'fixture', bypass: true, demo: false });
    await runner.submit(session.id, preview()); await wait(() => !runner.busy(session.id), runtime + ' authoritative failed turn');
    assert.equal(session.status, 'idle'); assert.equal(session.nativeTurnStatus, 'failed'); assert.match(session.nativeError, /HTTP 400/); assert.match(session.nativeError, /工具调用/); assert.equal(upstream.length, before + 1, 'No host replay after rejection');
    await runner.submit(session.id, preview()); await wait(() => !runner.busy(session.id), runtime + ' explicit manual submission');
    assert.match(session.messages.at(-1)?.original ?? '', /MANUAL_RECOVERY_COMPLETE/);
    checks.push(runtime + ': confirmed HTTP 400 ends in idle and accepts an explicit new submission'); console.log('PASS ' + checks.at(-1));
    scenario = 'approval';
  }
  scenario='context';model.model='claude-context-fixture[1m]';
  const contextProject=path.join(home,'claude-recognized-context');await mkdir(contextProject,{recursive:true});
  const contextSession={id:randomUUID(),projectId:null,projectPath:contextProject,title:'Context fixture',status:'idle',binding:{runtime:'claude',provider:'fixture',accountRef:'model-api:fixture',executionId:'local-device',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'fixture'},modelSelection:{model:model.model},permissionMode:'default',messages:[]};state.sessions.push(contextSession);
  await runner.submit(contextSession.id,{id:randomUUID(),original:'Return the context fixture.',translated:'Return the context fixture.',revisions:[],sourceHash:'fixture',bypass:true,demo:false});
  await wait(()=>!runner.busy(contextSession.id),'Claude recognized spelling context completion');
  assert.equal(contextSession.nativeContextUsage?.runtimeCapacity,900000);assert.match(contextSession.messages.at(-1)?.original??'',/CONTEXT_COMPLETE/);assert.equal(upstream.at(-1).model,model.model);
  checks.push('claude: recognized-family/[1m] spelling obeys declared window while upstream identity stays exact');console.log('PASS '+checks.at(-1));
  assert.deepEqual(errors, []);
} finally {
  await runner.dispose(); await cli.dispose(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, receipts, upstream, budgets, scope: 'Actual native CLI; disposable homes; synthetic loopback provider; no real model, credentials, SSH or deployment.' }, null, 2));
}
