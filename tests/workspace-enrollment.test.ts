import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceEnrollmentService, type EnrollmentOptions } from '../packages/workspace-control/enrollment';
import type { WorkspaceEnrollment, WorkspaceInvite } from '../packages/workspace-control/types';

function key(seed: number) { const raw = Buffer.alloc(51, seed); raw.writeUInt32BE(11, 0); raw.write('ssh-ed25519', 4); raw.writeUInt32BE(32, 15); return `ssh-ed25519 ${raw.toString('base64')}`; }
const fingerprint = (value: string) => 'SHA256:' + createHash('sha256').update(Buffer.from(value.split(' ')[1]!, 'base64')).digest('base64').replace(/=+$/, '');
const deviceKey = key(2);
const secret = 'synthetic-invite-secret-' + 'x'.repeat(32);
const invite = (): WorkspaceInvite => ({ schema: 'agent-workbench-invite', version: 1, inviteId: 'invite-one', token: secret, expiresAt: '2099-01-01T00:00:00Z', authorityId: 'authority-one', generation: 'authority-g1', workspaceId: 'space-one', workspaceGeneration: 'space-g1', workspaceName: 'Workspace One', username: 'member', root: '/srv/one', connection: { hostname: 'fixture.invalid', port: 2222, hostPublicKeys: [key(1)] }, enrollmentUrl: 'https://enroll.example.invalid/device' });
const receipt = (descriptor: WorkspaceInvite): WorkspaceEnrollment => ({ schema: 'agent-workbench-device', version: 1, authorityId: descriptor.authorityId, generation: descriptor.generation, workspaceId: descriptor.workspaceId, workspaceGeneration: descriptor.workspaceGeneration, workspaceName: descriptor.workspaceName, username: descriptor.username, root: descriptor.root, deviceId: 'device-one', fingerprint: fingerprint(deviceKey), connection: structuredClone(descriptor.connection) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aw-workspace-enrollment-')); const file = path.join(directory, 'invitation.awworkspace'); const descriptor = invite();
  await writeFile(file, JSON.stringify(descriptor));
  const calls = { keys: [] as string[], fetches: [] as { url: string; init: RequestInit; body: Record<string, unknown> }[], ssh: [] as string[] };
  const options: EnrollmentOptions = {
    directory,
    secureDirectory: async folder => { await mkdir(folder, { recursive: true, mode: 0o700 }); },
    createKey: async filename => { calls.keys.push(filename); await writeFile(filename, 'SYNTHETIC PRIVATE FIXTURE', { flag: 'wx', mode: 0o600 }); await writeFile(filename + '.pub', deviceKey + '\n', { flag: 'wx' }); },
    fetcher: async (url, init) => { calls.fetches.push({ url: String(url), init: init!, body: JSON.parse(String(init?.body)) }); return Response.json(receipt(descriptor)); },
    runner: async (host, command, requestOptions) => { assert.equal(command, 'id -un && id -u'); assert.equal(requestOptions?.maxOutputBytes, 1024); calls.ssh.push(host.id); assert.equal(await readFile(host.knownHostsFile, 'utf8'), `[fixture.invalid]:2222 ${key(1)}\n`); return { stdout: 'member\n1001\n', stderr: '', exitCode: 0, signal: null }; },
  };
  const service = new WorkspaceEnrollmentService(options);
  return { directory, file, descriptor, calls, options, service, close: async () => { await service.dispose(); await rm(directory, { recursive: true, force: true }); } };
}

test('import previews hide tokens and completed files reject repeat imports across restarts', async () => {
  const f = await fixture(); try {
    const preview = await f.service.preview(f.file); assert.ok(!JSON.stringify(preview).includes(secret)); assert.ok(!('token' in preview));
    const first = await f.service.import(preview.previewId, 'My device');
    assert.equal(first.role, 'workspace'); assert.equal(first.remoteWorkspaceId, 'space-one'); assert.equal(first.authorityGeneration, 'authority-g1'); assert.equal(first.deviceId, 'device-one');
    assert.equal(f.calls.keys.length, 1); assert.equal(f.calls.fetches.length, 1);
    const request = f.calls.fetches[0]!; assert.equal(request.url, f.descriptor.enrollmentUrl); assert.equal(request.init.method, 'POST'); assert.equal(request.init.redirect, 'error'); assert.equal(request.init.credentials, 'omit');
    assert.deepEqual(request.body, { token: secret, publicKey: deviceKey, deviceLabel: 'My device' });
    assert.ok(!JSON.stringify(first).includes(secret)); assert.ok(!JSON.stringify(first).includes('SYNTHETIC PRIVATE'));
    await assert.rejects(f.service.preview(f.file), /文件已失效/);
    await assert.rejects(f.service.import(preview.previewId, 'Again'), /文件已失效/);
    const restarted = new WorkspaceEnrollmentService(f.options); try { await assert.rejects(restarted.preview(f.file), /文件已失效/); } finally { await restarted.dispose(); }
    assert.equal(f.calls.keys.length, 1); assert.equal(f.calls.fetches.length, 1); assert.equal(f.calls.ssh.length, 1);
    const journal = await readFile(path.join(path.dirname(first.identityFile), 'enrollment.json'), 'utf8'); assert.ok(!journal.includes(secret)); assert.ok(!journal.includes('SYNTHETIC PRIVATE'));
  } finally { await f.close(); }
});

test('insecure or secret-bearing previews are rejected and server dates never use the client clock', async () => {
  const f = await fixture(); try {
    for (const enrollmentUrl of ['http://enroll.example.invalid/device', 'https://user:password@enroll.example.invalid/device', 'https://enroll.example.invalid/device?token=hidden', 'https://enroll.example.invalid/device#fragment']) {
      await writeFile(f.file, JSON.stringify({ ...f.descriptor, enrollmentUrl })); await assert.rejects(f.service.preview(f.file), /无效/);
    }
    await writeFile(f.file, JSON.stringify({ ...f.descriptor, expiresAt: '2000-01-01T00:00:00Z' })); assert.equal((await f.service.preview(f.file)).expiresAt,'2000-01-01T00:00:00Z');
    await writeFile(f.file, JSON.stringify({ ...f.descriptor, workspaceName: secret })); await assert.rejects(f.service.preview(f.file), error => error instanceof Error && /不应显示/.test(error.message) && !error.message.includes(secret));
    assert.equal(f.calls.keys.length, 0); assert.equal(f.calls.fetches.length, 0);
  } finally { await f.close(); }
});

test('enrollment receipt must match authority generation workspace identity fingerprint and exact host pins', async () => {
  const variants: Partial<WorkspaceEnrollment>[] = [{ authorityId: 'other' }, { generation: 'other' }, { workspaceId: 'other' }, { workspaceGeneration: 'other' }, { username: 'other' }, { root: '/srv/other' }, { fingerprint: fingerprint(key(9)) }, { connection: { ...invite().connection, hostPublicKeys: [key(9)] } }, { connection: { ...invite().connection, hostname: 'other.invalid' } }, { connection: { ...invite().connection, port: 22 } }];
  for (const patch of variants) {
    const f = await fixture(); try {
      f.options.fetcher = async () => Response.json({ ...receipt(f.descriptor), ...patch }); const preview = await f.service.preview(f.file);
      await assert.rejects(f.service.import(preview.previewId, 'Fixture'), /回执与邀请或本机公钥不一致/, JSON.stringify(patch)); assert.equal(f.calls.ssh.length, 0);
      const journal = JSON.parse(await readFile(path.join(path.dirname(f.calls.keys[0]!), 'enrollment.json'), 'utf8')); assert.equal(journal.receipt, undefined);
    } finally { await f.close(); }
  }
});

test('redirected oversized and error responses keep private server bodies out of errors', async () => {
  const responses = [() => new Response(secret, { status: 500 }), () => new Response(secret, { status: 302, headers: { location: 'https://other.invalid' } }), () => new Response('x'.repeat(65537)), () => { const result = Response.json(receipt(invite())); Object.defineProperty(result, 'redirected', { value: true }); return result; }, () => { const result = Response.json(receipt(invite())); Object.defineProperty(result, 'url', { value: 'https://other.invalid/device' }); return result; }];
  for (const respond of responses) {
    const f = await fixture(); try {
      f.options.fetcher = async () => respond(); const preview = await f.service.preview(f.file);
      await assert.rejects(f.service.import(preview.previewId, 'Fixture'), error => error instanceof Error && /回执未确认/.test(error.message) && !error.message.includes(secret)); assert.equal(f.calls.ssh.length, 0);
    } finally { await f.close(); }
  }
});

test('a lost HTTP response retries the same public key and never generates a second device identity', async () => {
  const f = await fixture(); const publicKeys: string[] = []; let requests = 0;
  try {
    f.options.fetcher = async (_url, init) => { publicKeys.push(JSON.parse(String(init?.body)).publicKey); if (++requests === 1) throw new Error(`Synthetic response body ${secret}`); return Response.json(receipt(f.descriptor)); };
    const preview = await f.service.preview(f.file); await assert.rejects(f.service.import(preview.previewId, 'Fixture'), error => error instanceof Error && /回执未确认/.test(error.message) && !error.message.includes(secret));
    const second = await f.service.preview(f.file); const host = await f.service.import(second.previewId, 'Fixture'); assert.equal(host.deviceId, 'device-one'); assert.equal(f.calls.keys.length, 1); assert.deepEqual(publicKeys, [deviceKey, deviceKey]);
  } finally { await f.close(); }
});

test('an unbound old key is neither reused nor overwritten by a new enrollment journal', async () => {
  const f = await fixture(); let seeded = '';
  try {
    f.options.secureDirectory = async folder => { await mkdir(folder, { recursive: true }); seeded = path.join(folder, 'device-key'); await writeFile(seeded, 'OLD SYNTHETIC KEY', { flag: 'wx' }); await writeFile(seeded + '.pub', deviceKey, { flag: 'wx' }); };
    const preview = await f.service.preview(f.file); await assert.rejects(f.service.import(preview.previewId, 'Fixture'), /未绑定/);
    assert.equal(f.calls.keys.length, 0); assert.equal(f.calls.fetches.length, 0); assert.equal(await readFile(seeded, 'utf8'), 'OLD SYNTHETIC KEY');
  } finally { await f.close(); }
});

test('missing enrolled keys and changed public keys cannot cause duplicate registration', async () => {
  const f = await fixture(); try {
    const preview = await f.service.preview(f.file); const host = await f.service.import(preview.previewId, 'Fixture');
    const journalFile=path.join(path.dirname(host.identityFile),'enrollment.json');const journal=JSON.parse(await readFile(journalFile,'utf8'));delete journal.completedAt;await writeFile(journalFile,JSON.stringify(journal));
    await writeFile(host.identityFile + '.pub', key(9)); await assert.rejects(f.service.import(preview.previewId, 'Fixture'), /公钥与原导入记录不一致/);
    await writeFile(host.identityFile + '.pub', deviceKey); await rm(host.identityFile); await assert.rejects(f.service.import(preview.previewId, 'Fixture'), /原密钥缺失/);
    assert.equal(f.calls.keys.length, 1); assert.equal(f.calls.fetches.length, 1);
  } finally { await f.close(); }
});

test('same-invitation imports are mutually exclusive and disposal awaits pending enrollment without starting SSH', async () => {
  const f = await fixture(); const gate = deferred<Response>(); const entered = deferred<void>(); let posted = 0;
  try {
    f.options.fetcher = async () => { posted++; entered.resolve(); return gate.promise; };
    const one = await f.service.preview(f.file); const two = await f.service.preview(f.file); const pending = f.service.import(one.previewId, 'Fixture'); const rejected = assert.rejects(pending, /退出/); await entered.promise;
    await assert.rejects(f.service.import(two.previewId, 'Other'), /正在配置/);
    let disposed = false; const stopping = f.service.dispose().then(() => { disposed = true; }); await Promise.resolve(); assert.equal(disposed, false); assert.throws(() => f.service.import(two.previewId, 'Other'), /退出/);
    gate.resolve(Response.json(receipt(f.descriptor))); await Promise.all([rejected, stopping]); assert.equal(f.calls.ssh.length, 0);
    const restarted = new WorkspaceEnrollmentService(f.options); try { const restored = await restarted.preview(f.file); assert.equal((await restarted.import(restored.previewId, 'Restored')).deviceId, 'device-one'); } finally { await restarted.dispose(); }
    assert.equal(posted, 1); assert.equal(f.calls.keys.length, 1);
  } finally { gate.resolve(Response.json(receipt(f.descriptor))); await f.close(); }
});

test('SSH verification rejects root wrong members extra lines and raw transport diagnostics', async () => {
  const variants = ['root\n0\n', 'other\n1001\n', 'member\n0\n', 'member\n4294967295\n', 'member\n1001\nextra\n'];
  for (const stdout of [...variants, null]) {
    const f = await fixture(); try {
      f.options.runner = async () => { if (stdout === null) throw new Error(secret); return { stdout, stderr: secret, exitCode: 0, signal: null }; };
      const preview = await f.service.preview(f.file); await assert.rejects(f.service.import(preview.previewId, 'Fixture'), error => error instanceof Error && /SSH 核实/.test(error.message) && !error.message.includes(secret));
    } finally { await f.close(); }
  }
});

test('client clock skew does not block exact-key recovery or decide server expiry', async t => {
  const f = await fixture(); const startedAt = Date.now(); let posts = 0;
  try {
    f.descriptor.expiresAt = new Date(startedAt + 60_000).toISOString(); await writeFile(f.file, JSON.stringify(f.descriptor));
    f.options.fetcher = async () => { if (++posts === 1) throw new Error('Lost original response'); return Response.json({ ...receipt(f.descriptor), workspaceName: 'Renamed workspace' }); };
    const first = await f.service.preview(f.file); assert.equal(first.resumeExistingDevice, false); await assert.rejects(f.service.import(first.previewId, 'Fixture'), /回执未确认/);
    t.mock.method(Date, 'now', () => startedAt + 120_000);
    const recovery = await f.service.preview(f.file); assert.equal(recovery.resumeExistingDevice, true); const restored = await f.service.import(recovery.previewId, 'Fixture'); assert.equal(restored.name, 'Renamed workspace');
    await assert.rejects(f.service.preview(f.file),/文件已失效/); assert.equal(f.calls.keys.length, 1); assert.equal(posts, 2);
    await writeFile(f.file, JSON.stringify({ ...f.descriptor, inviteId: 'different-expired-invite' })); assert.equal((await f.service.preview(f.file)).resumeExistingDevice,false); assert.equal(f.calls.keys.length, 1);
  } finally { t.mock.restoreAll(); await f.close(); }
});
