import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import type { Session } from '../packages/contracts';
import { decodeNativeFrame } from '../services/remote-supervisor';
import { normalizeClaudeEvent } from '../packages/runtime-claude';
import { buildNativeAgentPolicyPlan, validateNativeAgentPolicy } from '../packages/collaboration-core/native-policy';
import { buildDeferredAppServerArgs } from '../packages/runtime-codex';
import { buildClaudeArgs } from '../packages/runtime-claude';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'aw-collaboration-')), store = new StateStore(dir); await store.load();
  const controller = new WorkbenchController(store, new SecretStore(dir, { encrypt: () => { throw Error('No secrets'); }, decrypt: () => { throw Error('No secrets'); } }), { pickDirectory: async () => null, copy: () => {}, openPath: async () => {}, nativeCapabilities: () => [] }, () => {});
  return { dir, store, controller, close: async () => { await controller.dispose(); await rm(dir, { recursive: true, force: true }); } };
}

test('controller peer message persists without model turns; retries are idempotent and IPC cannot forge receipts', async () => {
  const f = await fixture(); try {
    const source = await f.controller.call('session/create', { runtime: 'demo' }) as Session, target = await f.controller.call('session/create', { runtime: 'demo' }) as Session;
    const input = { sessionId: source.id, targetSessionId: target.id, text: 'Exact text \n 保留原文', operationId: 'one' };
    const tools=f.controller.nativePeerTools(source.id), args={targetSessionId:target.id,text:input.text,operationId:input.operationId};
    await Promise.all([tools.call('workbench_send_message', args), tools.call('workbench_send_message', args)]);
    await assert.rejects(f.controller.call('collaboration/send', input));
    assert.equal(f.store.snapshot().collaboration!.messages.length, 1); assert.ok(f.store.snapshot().sessions.every(s => s.messages.length === 0));
    await assert.rejects(f.controller.call('collaboration/acknowledge', { receipt: 'forged' }));
    const reloaded = new StateStore(f.dir); await reloaded.load(); assert.equal(reloaded.snapshot().collaboration!.messages[0]!.status, 'queued'); assert.equal(reloaded.snapshot().collaboration!.messages[0]!.text, input.text);
  } finally { await f.close(); }
});

test('both runtimes inherit native agent capacity and legacy workbench limits are discarded', async () => {
  const f = await fixture(); try {
    const first = await f.controller.call('session/create', { runtime: 'demo' }) as Session;
    await assert.rejects(f.controller.call('collaboration/settings', { policy: { maxConcurrentChildren: 2, maxDepth: 1, model: 'native-small' } }));
    const second = await f.controller.call('session/create', { runtime: 'demo' }) as Session;
    assert.deepEqual(first.nativeAgentPolicy, {mode:'native'}); assert.deepEqual(second.nativeAgentPolicy, {mode:'native'});
    assert.deepEqual(f.controller.nativeAgentPolicy(first.id), {mode:'native'});
    assert.doesNotMatch(buildDeferredAppServerArgs('0.155.1').join(' '), /agents\.(max_|default_subagent_model)/);
    assert.doesNotMatch(buildClaudeArgs({ version: '2.1.281' }).join(' '), /MAX_CONCURRENT_SUBAGENTS|MAX_SUBAGENT_SPAWN_DEPTH|SUBAGENT_MODEL/);
    assert.equal(buildNativeAgentPolicyPlan('claude', '2.1.281').strictGlobalLimit, false);
    assert.deepEqual(validateNativeAgentPolicy({ maxConcurrentChildren: 50, maxDepth: 1, model:'legacy' }), {mode:'native'});
    assert.deepEqual(buildNativeAgentPolicyPlan('codex','0.155.1',{maxConcurrentChildren:1,maxDepth:1}).args, []);
    assert.throws(() => validateNativeAgentPolicy({ maxConcurrentChildren: 1, maxDepth: 1, permissions: 'all' }));
  } finally { await f.close(); }
});

test('trusted observation persists real lifecycle, child status and disconnect uncertainty without exposing a forge IPC', async () => {
  const f = await fixture(); try {
    await f.store.update(state => { state.hosts.push({ id: 'h', name: 'Fixture', hostname: 'fixture.example', port: 22, username: 'member', role: 'workspace', ownerId: 'owner', workspaceGeneration: 'one', identityFile: 'fixture', knownHostsFile: 'fixture' }); });
    const session = await f.controller.call('session/create', { runtime: 'claude', hostId: 'h' }) as Session;
    const source = new EventEmitter(), observation = await f.controller.observeNativeSession(session.id, source);
    const frame = (value: unknown) => decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n'));
    source.emit('event', normalizeClaudeEvent(frame({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'edit', name: 'Edit', input: { file_path:'fixture.ts',old_string: 'private' } }] } }), session.id, 1));
    source.emit('event', normalizeClaudeEvent(frame({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'edit' }] } }), session.id, 2));
    source.emit('childAgent', { runtime: 'claude', nativeChildId: 'child', operation: 'completed', status: 'completed' });
    source.emit('event', normalizeClaudeEvent(frame({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'pending', name: 'Bash' }] } }), session.id, 3));
    await observation.flush();
    const saved = f.store.snapshot().sessions[0]!; assert.equal(saved.activities![0]!.status, 'completed'); assert.equal(saved.nativeChildren![0]!.operation, 'completed'); assert.match(saved.activities![0]!.input!, /private/);
    assert.equal(saved.fileChangeRecords?.length,1);assert.equal(saved.fileChangeRecords![0]!.changes[0]!.path,'fixture.ts');assert.equal(saved.fileChangeRecords![0]!.changes[0]!.additions,null);
    await assert.rejects(f.controller.call('collaboration/observe', { event: 'forged' }));
    source.emit('disconnect'); await observation.flush(); assert.equal(f.store.snapshot().sessions[0]!.activities![1]!.status, 'uncertain');
    assert.equal(f.store.snapshot().sessions[0]!.status, 'blocked');
    const reload = new StateStore(f.dir); await reload.load(); assert.equal(reload.snapshot().sessions[0]!.nativeObservation, 'disconnected');assert.equal(reload.snapshot().sessions[0]!.fileChangeRecords?.length,1);
  } finally { await f.close(); }
});
