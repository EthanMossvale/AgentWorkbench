import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SshHost } from '../packages/contracts';
import type { SshResult, SshRunner } from '../packages/ssh-transport';
import { RemoteWorkspaceControl, WORKSPACE_CONTROL_COMMAND } from '../packages/workspace-control';
import type { ManagedWorkspace, StudioPlan, StudioSnapshot, StudioWireApply, WorkspaceInvite } from '../packages/workspace-control/types';
import { publicKeyFingerprint, snapshot as validateSnapshot } from '../packages/workspace-control/validation';
import { WorkspaceManagementService } from '../apps/desktop/host/workspace-management';

function key(seed: number) { const raw = Buffer.alloc(51, seed); raw.writeUInt32BE(11, 0); raw.write('ssh-ed25519', 4); raw.writeUInt32BE(32, 15); return `ssh-ed25519 ${raw.toString('base64')}`; }
const host: SshHost = { id: 'administrator', name: 'Synthetic administrator', hostname: 'fixture.invalid', port: 2222, username: 'root', role: 'admin', identityFile: path.resolve('fixtures/no-real-key'), knownHostsFile: path.resolve('fixtures/no-real-hosts'), ownerId: 'owner', workspaceGeneration: 'host-g1' };
const date = '2099-01-01T00:00:00Z';
const workspace = (): ManagedWorkspace => ({ id: 'space-one', generation: 'space-g1', revision: 1, name: 'Workspace One', uid: 1001, username: 'member', root: '/srv/one', environment: { runtimes: ['codex', 'claude'], defaultDirectory: '/srv/one', env: { LANG: 'C.UTF-8' } }, allowedAccountIds: ['account-one'], budget: { period: 'month', limit: null, unit: 'usd', enforcement: 'unavailable' }, nativeQuota: 'unknown', status: 'active', devices: [], invites: [], createdAt: date, updatedAt: date });
const snapshot = (): StudioSnapshot => ({ authorityId: 'authority', generation: 'authority-g1', revision: 4, workspaces: [workspace()], connection: { hostname: host.hostname, port: host.port, hostPublicKeys: [key(1)] }, enrollmentUrl: 'https://enroll.example.invalid/device', availability: 'ready' });
const plan = (operation: StudioPlan['operation'] = 'invite/create', planId = 'plan-one'): StudioPlan => ({ planId, planHash: 'a'.repeat(64), operation, workspaceId: 'space-one', expectedRevision: 4, expiresAt: date, effects: ['Create one invitation'] });
const invitation = (): WorkspaceInvite => ({ schema: 'agent-workbench-invite', version: 1, inviteId: 'invite-one', token: 'synthetic-invitation-secret-' + 'x'.repeat(32), expiresAt: date, authorityId: 'authority', generation: 'authority-g1', workspaceId: 'space-one', workspaceGeneration: 'space-g1', workspaceName: 'Workspace One', username: 'member', root: '/srv/one', connection: snapshot().connection, enrollmentUrl: snapshot().enrollmentUrl });
const applied = (): StudioWireApply => ({ operationId: 'plan-one', state: 'applied', revision: 5, effects: ['Created one invitation'], invite: invitation() });
const response = (value: unknown): SshResult => ({ stdout: JSON.stringify({ ok: true, value }), stderr: '', exitCode: 0, signal: null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(handler: (method: string, params: Record<string, unknown>) => SshResult | Promise<SshResult> = method => response(method === 'workspace/list' ? snapshot() : method === 'workspace/plan' ? plan() : applied())) {
  const calls: { host: SshHost; method: string; params: Record<string, unknown>; timeoutMs?: number }[] = [];
  const runner: SshRunner = async (target, command, options) => { assert.equal(command, WORKSPACE_CONTROL_COMMAND); assert.equal(options?.maxOutputBytes, 2 * 1024 * 1024); const input = JSON.parse(options?.stdin ?? '{}'); assert.equal(input.protocol, 1); calls.push({ host: structuredClone(target), method: input.method, params: input.params, timeoutMs: options?.timeoutMs }); return handler(input.method, input.params); };
  return { remote: new RemoteWorkspaceControl(runner), calls };
}
async function prepared(f: ReturnType<typeof fixture>, operation: StudioPlan['operation'] = 'invite/create') { await f.remote.list(host); return f.remote.plan(host, { operation, workspaceId: 'space-one', expectedRevision: 4 }); }

test('workspace control uses administrator SSH and returns only validated public metadata', async () => {
  const f = fixture(() => response({ ...snapshot(), token: invitation().token, workspaces: [{ ...workspace(), privatePath: '/secret/profile', controlState: 'recovery-required' }] }));
  await assert.rejects(f.remote.list({ ...host, role: 'workspace' }), /管理员/); assert.equal(f.calls.length, 0);
  const value = await f.remote.list(host); assert.equal(value.availability, 'ready'); assert.equal(value.workspaces[0]?.controlState, 'recovery-required');
  assert.ok(!JSON.stringify(value).includes(invitation().token)); assert.ok(!JSON.stringify(value).includes('/secret/profile'));
  assert.deepEqual(f.calls[0]?.params, {});
  const wrong = fixture(() => response({ ...snapshot(), connection: { ...snapshot().connection, hostname: 'other.invalid' } }));
  assert.equal((await wrong.remote.list(host)).availability, 'unavailable');
  const malicious = workspace(); malicious.devices = [{ id: 'd', label: 'test', fingerprint: 'SHA256:wrong', publicKey: key(2), createdAt: date, status: 'active' }];
  assert.throws(() => validateSnapshot({ ...snapshot(), workspaces: [malicious] }), /无效/);
  malicious.devices[0]!.fingerprint = publicKeyFingerprint(key(2)); assert.equal(validateSnapshot({ ...snapshot(), workspaces: [malicious] }).workspaces[0]?.devices.length, 1);
});

test('local CAS connection binding and generated create plan IDs are checked before apply', async () => {
  const f = fixture(); await f.remote.list(host);
  await assert.rejects(f.remote.plan(host, { operation: 'invite/create', workspaceId: 'space-one', expectedRevision: 3 }), /先读取/);
  const saved = await f.remote.plan(host, { operation: 'invite/create', workspaceId: 'space-one', expectedRevision: 4 });
  await assert.rejects(f.remote.apply({ ...host, identityFile: path.resolve('changed-key') }, saved.planId, saved.planHash), /当前/);
  await assert.rejects(f.remote.apply(host, saved.planId, 'b'.repeat(64)), /当前/); assert.equal(f.calls.filter(c => c.method === 'workspace/apply').length, 0);
  const create = fixture(method => response(method === 'workspace/list' ? snapshot() : { ...plan('workspace/create'), workspaceId: 'new-space' }));
  await create.remote.list(host); assert.equal((await create.remote.plan(host, { operation: 'workspace/create', expectedRevision: 4, values: { name: 'New' } })).workspaceId, 'new-space');
});

test('uncertain apply is consumed once and only an operation query may confirm its result', async () => {
  const secret = invitation().token;
  const f = fixture(method => { if (method === 'workspace/apply') throw new Error(`transport body ${secret}`); return response(method === 'workspace/list' ? snapshot() : method === 'workspace/plan' ? plan() : { operationId: 'plan-one', state: 'uncertain', revision: 4, effects: [] }); });
  const saved = await prepared(f);
  await assert.rejects(f.remote.apply(host, saved.planId, saved.planHash), error => error instanceof Error && /未确认/.test(error.message) && !error.message.includes(secret));
  await assert.rejects(f.remote.apply(host, saved.planId, saved.planHash), /不能重放/);
  await f.remote.list(host); assert.equal((await f.remote.operation(host, saved.planId)).state, 'uncertain');
  await assert.rejects(f.remote.apply(host, saved.planId, saved.planHash), /不能重放/);
  assert.equal(f.calls.filter(c => c.method === 'workspace/apply').length, 1);
  assert.deepEqual(f.calls.find(c => c.method === 'workspace/apply')?.params, { authorityId: 'authority', generation: 'authority-g1', planId: saved.planId, planHash: saved.planHash });
});

test('out-of-order catalogs and refreshed authorities cannot revive a stale preview', async () => {
  const old = deferred<SshResult>(); const entered = deferred<void>(); let reads = 0;
  const f = fixture(method => { if (method === 'workspace/list') { if (++reads === 1) { entered.resolve(); return old.promise; } return response({ ...snapshot(), revision: 6 }); } return response({ ...plan(), expectedRevision: 6 }); });
  const late = f.remote.list(host); await entered.promise; assert.equal((await f.remote.list(host)).revision, 6); old.resolve(response(snapshot())); assert.equal((await late).availability, 'unavailable');
  assert.equal((await f.remote.plan(host, { operation: 'invite/create', workspaceId: 'space-one', expectedRevision: 6 })).expectedRevision, 6);
  let generation = 'authority-g1'; const changed = fixture(method => response(method === 'workspace/list' ? { ...snapshot(), generation } : plan()));
  const saved = await prepared(changed); generation = 'authority-g2'; await changed.remote.list(host);
  await assert.rejects(changed.remote.apply(host, saved.planId, saved.planHash), /状态已变化/); assert.equal(changed.calls.filter(c => c.method === 'workspace/apply').length, 0);
});

test('pending apply blocks another mutation and shutdown waits without issuing new work', async () => {
  const gate = deferred<SshResult>(); const entered = deferred<void>(); let plans = 0;
  const f = fixture(method => { if (method === 'workspace/list') return response(snapshot()); if (method === 'workspace/plan') return response(plan('invite/create', `plan-${++plans}`)); entered.resolve(); return gate.promise; });
  await f.remote.list(host); const a = await f.remote.plan(host, { operation: 'invite/create', workspaceId: 'space-one', expectedRevision: 4 }); const b = await f.remote.plan(host, { operation: 'invite/create', workspaceId: 'space-one', expectedRevision: 4 });
  const pending = f.remote.apply(host, a.planId, a.planHash); const rejected = assert.rejects(pending, /回执未确认/); await entered.promise;
  assert.equal(f.remote.busy(host), true); await assert.rejects(f.remote.apply(host, b.planId, b.planHash), /等待回执/);
  let disposed = false; const stopping = f.remote.dispose().then(() => { disposed = true; }); await Promise.resolve(); assert.equal(disposed, false);
  await assert.rejects(f.remote.list(host), /退出/); gate.resolve(response({ ...applied(), operationId: a.planId })); await Promise.all([rejected, stopping]); assert.equal(f.remote.busy(host), false);
});

test('invite replies must match the previewed authority workspace and both HTTPS and SSH endpoints', async () => {
  const patches: Partial<WorkspaceInvite>[] = [ { authorityId: 'wrong' }, { generation: 'wrong' }, { workspaceId: 'wrong' }, { workspaceGeneration: 'wrong' }, { username: 'other' }, { root: '/srv/other' }, { workspaceName: 'Other' }, { enrollmentUrl: 'https://other.invalid/enroll' }, { connection: { ...snapshot().connection, hostPublicKeys: [key(9)] } }, { connection: { ...snapshot().connection, port: 22 } } ];
  for (const patch of patches) {
    const f = fixture(method => response(method === 'workspace/list' ? snapshot() : method === 'workspace/plan' ? plan() : { ...applied(), invite: { ...invitation(), ...patch } }));
    const saved = await prepared(f); await assert.rejects(f.remote.apply(host, saved.planId, saved.planHash), /回执未确认/, JSON.stringify(patch));
  }
  const failed = fixture(method => response(method === 'workspace/list' ? snapshot() : method === 'workspace/plan' ? plan() : { ...applied(), state: 'uncertain' })); const saved = await prepared(failed);
  await assert.rejects(failed.remote.apply(host, saved.planId, saved.planHash), /回执未确认/);
});

test('runner failures and arbitrary server error bodies never appear in client errors', async () => {
  const secret = invitation().token;
  for (const failure of [() => { throw new Error(secret); }, () => ({ stdout: JSON.stringify({ ok: false, error: secret }), stderr: secret, exitCode: 0, signal: null })]) {
    const f = fixture(method => method === 'workspace/list' ? response(snapshot()) : failure()); await f.remote.list(host);
    await assert.rejects(f.remote.plan(host, { operation: 'invite/create', workspaceId: 'space-one', expectedRevision: 4 }), error => error instanceof Error && !error.message.includes(secret));
    await assert.rejects(f.remote.operation(host, 'plan-one'), error => error instanceof Error && !error.message.includes(secret));
  }
});

test('host management keeps invite tokens private and exports only through the selected host dialog', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aw-workspace-host-')); const file = path.join(directory, 'invitation.awworkspace'); const f = fixture(); let picked = 0;
  const manager = new WorkspaceManagementService({ directory, remote: f.remote, pickImport: async () => null, pickExport: async filename => { picked++; assert.equal(filename, 'Workspace_One.awworkspace'); return file; } });
  try {
    await manager.list(host); const saved = await manager.plan(host, { operation: 'invite/create', workspaceId: 'space-one', expectedRevision: 4 }); const result = await manager.apply(host, saved.planId, saved.planHash);
    assert.ok(result.inviteExportId); assert.ok(!JSON.stringify(result).includes(invitation().token)); assert.ok(!('invite' in result));
    await assert.rejects(manager.exportInvite({ ...host, username: 'other-admin' }, result.inviteExportId!), /不属于/); assert.equal(picked, 0);
    assert.deepEqual(await manager.exportInvite(host, result.inviteExportId!), { saved: true, path: file }); assert.equal(JSON.parse(await readFile(file, 'utf8')).token, invitation().token);
  } finally { await manager.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('host management rejects secrets smuggled into public effects and stops delayed export dialogs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aw-workspace-export-')); const chosen = deferred<string | null>(); const entered = deferred<void>(); const file = path.join(directory, 'not-written.awworkspace');
  const f = fixture(); const manager = new WorkspaceManagementService({ directory, remote: f.remote, pickImport: async () => null, pickExport: async () => { entered.resolve(); return chosen.promise; } });
  try {
    await manager.list(host); const saved = await manager.plan(host, { operation: 'invite/create', workspaceId: 'space-one', expectedRevision: 4 }); const result = await manager.apply(host, saved.planId, saved.planHash);
    const saving = manager.exportInvite(host, result.inviteExportId!); const rejected = assert.rejects(saving, /退出/); await entered.promise; await manager.dispose(); chosen.resolve(file); await rejected; await assert.rejects(readFile(file), { code: 'ENOENT' });
    const unsafe = fixture(method => response(method === 'workspace/list' ? snapshot() : method === 'workspace/plan' ? plan() : { ...applied(), effects: [invitation().token] }));
    const other = new WorkspaceManagementService({ directory, remote: unsafe.remote, pickImport: async () => null, pickExport: async () => null });
    try { await other.list(host); const preview = await other.plan(host, { operation: 'invite/create', workspaceId: 'space-one', expectedRevision: 4 }); await assert.rejects(other.apply(host, preview.planId, preview.planHash), error => error instanceof Error && /不应公开/.test(error.message) && !error.message.includes(invitation().token)); } finally { await other.dispose(); }
  } finally { chosen.resolve(null); await manager.dispose(); await rm(directory, { recursive: true, force: true }); }
});


test('discovered deletion plans bind the public target and reject substituted apply identities',async()=>{
 const target={name:'Discovered',username:'unmanaged',uid:1002,root:'/home/unmanaged/workspaces'};
 const deletion={mode:'destroy' as const,username:target.username,uid:target.uid,home:'/home/unmanaged',root:target.root,storageBytes:4096};
 const f=fixture(method=>response(method==='workspace/list'?snapshot():method==='workspace/plan'?{...plan('workspace/delete'),workspaceId:'new-tombstone',deletion}:{operationId:'plan-one',state:'applied',revision:5,effects:[],workspace:{...workspace(),id:'new-tombstone',status:'deleted',deletion:{kind:'purged',home:deletion.home,storageBytes:4096},...target}}));
 await f.remote.list(host);const preview=await f.remote.plan(host,{operation:'workspace/delete',expectedRevision:4,values:target});
 const result=await f.remote.apply(host,preview.planId,preview.planHash);assert.equal(result.workspace?.username,'unmanaged');
 const wrong=fixture(method=>response(method==='workspace/list'?snapshot():method==='workspace/plan'?{...plan('workspace/delete'),workspaceId:'new-tombstone',deletion}:{operationId:'plan-one',state:'applied',revision:5,effects:[],workspace:{...workspace(),id:'new-tombstone',status:'deleted'}}));
 await wrong.remote.list(host);const p=await wrong.remote.plan(host,{operation:'workspace/delete',expectedRevision:4,values:target});
 await assert.rejects(wrong.remote.apply(host,p.planId,p.planHash),/未确认/);
});

test('old record-only deletion plans are rejected before confirmation or mutation',async()=>{
 const f=fixture(method=>response(method==='workspace/list'?snapshot():plan('workspace/delete')));
 await f.remote.list(host);
 await assert.rejects(f.remote.plan(host,{operation:'workspace/delete',workspaceId:'space-one',expectedRevision:4}),/旧版记录删除/);
 assert.equal(f.calls.some(c=>c.method==='workspace/apply'),false);
});

test('apply allows large home removal while ordinary management reads stay bounded',async()=>{
 const f=fixture();const saved=await prepared(f);await f.remote.apply(host,saved.planId,saved.planHash);
 assert.equal(f.calls.find(c=>c.method==='workspace/apply')?.timeoutMs,915000);
 assert.ok(f.calls.filter(c=>c.method!=='workspace/apply').every(c=>c.timeoutMs===45000));
});
