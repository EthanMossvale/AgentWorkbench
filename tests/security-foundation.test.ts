import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SshHost } from '../packages/contracts/index';
import { buildSshArgs, buildSshEnvironment, redactSshDiagnostic, runSsh, SSH_EXECUTABLE, type SshRunner } from '../packages/ssh-transport/index';
import { probeEnvironment, projectEnvironment, unknownProfile } from '../services/environment-profile/index';
import { discoverWorkspaces, HostControlService, DISCOVERY_COMMAND } from '../services/host-control/index';
import { OwnerFileService, type FileContext } from '../services/owner-file-service/index';
import { verifyCurrentWindowsOwner } from '../services/owner-file-service/windows-owner';
import { planMaterialization } from '../services/environment-runtime/index';

const host: SshHost = { id: 'fixture-host', name: 'fixture', hostname: 'fixture.invalid', port: 22, username: 'owner', role: 'admin', identityFile: path.resolve('fixtures/no-real-key'), knownHostsFile: path.resolve('fixtures/no-real-known-hosts'), ownerId: 'owner-1', workspaceGeneration: 'g1' };
const reply = (stdout: string, exitCode = 0): SshRunner => async () => ({ stdout, stderr: '', exitCode, signal: null });
const discoveryOutput = 'identity\t0\naccount\troot\t0\t/root\t/bin/bash\naccount\towner\t1000\t/home/owner\t/bin/bash\nregistry\tabsent-or-inaccessible\nfingerprint\tSHA256:abcdefghijklmnopqrstuvwxy01234567890\n';

test('SSH rejects host/user/port injection and non-explicit credential paths', () => {
  for (const override of [{ hostname: '-oProxyCommand=bad' }, { hostname: 'good;echo bad' }, { hostname: 'user@host' }, { username: 'owner;id' }, { username: '-root' }, { port: 0 }, { identityFile: 'relative-key' }, { knownHostsFile: 'known\nHosts' }]) assert.throws(() => buildSshArgs({ ...host, ...override }, 'true'));
});
test('changed host keys remain blocked; no permissive fallback or inherited SSH configuration', () => {
  const args = buildSshArgs(host, 'true');
  for (const setting of ['StrictHostKeyChecking=yes', 'UpdateHostKeys=no', 'GlobalKnownHostsFile=none', 'IdentityAgent=none', 'ForwardAgent=no', 'ClearAllForwardings=yes', 'PasswordAuthentication=no', 'SendEnv=-*']) assert.ok(args.includes(setting), setting);
  assert.equal(args[0], '-F'); assert.equal(args.at(-2), host.hostname); assert.equal(args.at(-1), 'true');
  assert.ok(!args.join(' ').includes('accept-new')); assert.ok(!args.join(' ').includes('StrictHostKeyChecking=no'));
});
test('installed OpenSSH parses strict offline configuration without a connection', () => {
  const result = spawnSync(SSH_EXECUTABLE, ['-G', ...buildSshArgs(host, 'true')], { encoding: 'utf8', timeout: 5000, windowsHide: true, shell: false, env: buildSshEnvironment() });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  for (const pattern of [/^stricthostkeychecking true$/m, /^batchmode yes$/m, /^forwardagent no$/m, /^clearallforwardings yes$/m, /^identityagent none$/m, /^updatehostkeys false$/m]) assert.match(result.stdout, pattern);
});
test('SSH environment excludes provider credentials, ambient proxy and agent', () => {
  const env = buildSshEnvironment({ PATH: '/bin', HOME: '/home/test', ANTHROPIC_API_KEY: 'fixture-secret', OPENAI_API_KEY: 'fixture-secret', HTTPS_PROXY: 'secret-proxy', SSH_AUTH_SOCK: 'ambient-agent' });
  assert.equal(env.PATH, '/bin'); assert.equal(env.ANTHROPIC_API_KEY, undefined); assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.HTTPS_PROXY, undefined); assert.equal(env.SSH_AUTH_SOCK, '');
});
test('SSH cancellation before spawn is side-effect free and diagnostics redact secrets', async () => {
  await assert.rejects(runSsh(host, 'true', { signal: AbortSignal.abort() }), /cancelled/);
  const text = redactSshDiagnostic(`${host.identityFile} Bearer pretend-token access_token=pretend-token https://example.invalid/callback?code=pretend-code\n-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----`, host);
  assert.ok(!text.includes('pretend-token')); assert.ok(!text.includes('pretend-code')); assert.ok(!text.includes(host.identityFile)); assert.ok(!text.includes('\nfixture\n'));
});
test('remote profile allowlist does not execute data and stale projection performs no fallback scan', async () => {
  let calls = 0; const now = new Date('2026-09-25T00:00:00Z');
  const profile = await probeEnvironment(host, { now, ttlMs: 1000, runner: async (...args) => { calls++; return reply('os\tLinux\narchitecture\tx86_64\nunknownSecret\tdiscard\nclaudeVersion\t$(touch impossible)\n')(...args); } });
  assert.equal(profile.fields.os?.value, 'Linux'); assert.equal(profile.fields.unknownSecret, undefined); assert.equal(profile.fields.claudeVersion?.value, '$(touch impossible)');
  const expired = projectEnvironment(profile, { hostId: host.id, ownerId: host.ownerId, now: new Date(now.getTime() + 1001) });
  assert.equal(expired.freshness, 'stale'); assert.equal(expired.fields.os?.status, 'stale'); assert.equal(expired.fields.shell?.status, 'unknown'); assert.equal(calls, 1); assert.equal(profile.fields.os?.status, 'known');
  assert.throws(() => projectEnvironment(profile, { hostId: 'other', ownerId: host.ownerId }), /binding/);
  assert.ok(Object.values(unknownProfile(host).fields).every(field => field.status === 'unknown'));
});
test('discovery is bounded, read-only, no account creation or private-key read', async () => {
  const found = await discoverWorkspaces(host, { runner: reply(discoveryOutput) });
  assert.equal(found.accounts.length, 2); assert.equal(found.accounts[1]?.classification, 'ordinary-account-unmapped'); assert.equal(found.privilege, 'root');
  assert.ok(!/useradd|userdel|rm\s|find\s|id_rsa|id_ed25519/.test(DISCOVERY_COMMAND));
  await assert.rejects(discoverWorkspaces(host, { runner: reply('identity\t1000\naccount\tother\t1001\t/home/other\t/bin/sh\n') }), /scope/);
});
test('workspace role cannot grant admin; concrete connection and generation stay bound', async () => {
  await assert.rejects(new HostControlService(reply('1000\n')).verifyAdmin(host), /not authority/);
  const control = new HostControlService(reply('0\n')); const token = await control.verifyAdmin(host);
  const found = await discoverWorkspaces(host, { runner: reply(discoveryOutput) });
  assert.throws(() => control.plan({ ...host, hostname: 'changed.invalid' }, token, found, []), /changed connection/);
  assert.throws(() => control.plan({ ...host, workspaceGeneration: 'g2' }, token, found, []), /revoked generation/);
  control.revokeGeneration(host.id, 'g1'); assert.throws(() => control.plan(host, token, found, []), /authority/);
});
test('reconcile requires exact user confirmation, no new users, and idempotent completion', async () => {
  const control = new HostControlService(reply('0\n')); const token = await control.verifyAdmin(host); const found = await discoverWorkspaces(host, { runner: reply(discoveryOutput) });
  assert.throws(() => control.plan(host, token, found, [{ workspaceId: 'w-new', username: 'absent', ownerId: host.ownerId }]), /creation is not automatic/);
  const plan = control.plan(host, token, found, [{ workspaceId: 'w1', username: 'owner', ownerId: host.ownerId }]); let applied = 0;
  await assert.rejects(control.execute(host, token, plan.id, plan.bindingHash, async () => found.stateHash, async () => { applied++; }), /confirmed/);
  assert.throws(() => control.confirm(plan.id, 'changed-parameters'), /Confirmation/);
  control.confirm(plan.id, plan.bindingHash);
  await control.execute(host, token, plan.id, plan.bindingHash, async () => found.stateHash, async () => { applied++; });
  await control.execute(host, token, plan.id, plan.bindingHash, async () => found.stateHash, async () => { applied++; }); assert.equal(applied, 1);
});
test('uncertain management side effects are not automatically replayed', async () => {
  const control = new HostControlService(reply('0\n')); const token = await control.verifyAdmin(host); const found = await discoverWorkspaces(host, { runner: reply(discoveryOutput) });
  const plan = control.plan(host, token, found, [{ workspaceId: 'w1', username: 'owner', ownerId: host.ownerId }]); control.confirm(plan.id, plan.bindingHash);
  await assert.rejects(control.execute(host, token, plan.id, plan.bindingHash, async () => found.stateHash, async () => { throw new Error('connection lost'); }), /connection lost/);
  await assert.rejects(control.execute(host, token, plan.id, plan.bindingHash, async () => found.stateHash, async () => {}), /uncertain/);
});

async function fileFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-workbench-security-')); const a = path.join(directory, 'project-a'); const b = path.join(directory, 'project-b'); const control = path.join(directory, 'management');
  await Promise.all([mkdir(a), mkdir(b), mkdir(control)]); const file = path.join(b, '普通 文件.txt'); await writeFile(file, 'original computer-name stays unchanged'); await writeFile(path.join(control, 'credential.txt'), 'fixture-not-a-real-secret');
  // Test identity is deliberately injected. It is not proof of production Windows/multi-tenant isolation.
  const service = await OwnerFileService.create({ ownerId: 'owner-1', deviceId: 'device-1', generation: 'g1', controlPaths: [control], verifyOwner: async target => !target.includes('other-owner') });
  const grant = service.issueGrant({ operations: ['read', 'write'], expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const context: FileContext = { grantId: grant.id, ownerId: 'owner-1', deviceId: 'device-1', generation: 'g1', sessionId: 's1', workspaceId: 'project-a', operationId: 'op1', os: process.platform };
  return { directory, a, b, control, file, service, context };
}
test('owner-wide read crosses workspace siblings without content projection', async () => {
  const f = await fileFixture(); try { const result = await f.service.read(f.context, f.file); assert.equal(result.content, 'original computer-name stays unchanged'); assert.equal(result.realPath, await import('node:fs/promises').then(fs => fs.realpath(f.file))); } finally { await rm(f.directory, { recursive: true, force: true }); }
});
test('other owner/device/OS and revoked generations are denied independently of workspace', async () => {
  const f = await fileFixture(); try {
    for (const changed of [{ ownerId: 'other' }, { deviceId: 'other' }, { generation: 'g2' }, { os: (process.platform === 'win32' ? 'linux' : 'win32') as NodeJS.Platform }]) await assert.rejects(f.service.read({ ...f.context, ...changed }, f.file));
    const other = path.join(f.b, 'other-owner.txt'); await writeFile(other, 'fixture'); await assert.rejects(f.service.read(f.context, other), /not verified/);
    f.service.revokeGeneration('g1'); await assert.rejects(f.service.read(f.context, f.file), /revoked/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
test('control directories and symlinks into them are denied', async () => {
  const f = await fileFixture(); try {
    await assert.rejects(f.service.read(f.context, path.join(f.control, 'credential.txt')), /outside the ordinary/);
    const link = path.join(f.a, 'ordinary-looking'); await symlink(f.control, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(f.service.read(f.context, path.join(link, 'credential.txt')), /outside the ordinary/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
test('approved writes bind exact context/content/version and read back the result', async () => {
  const f = await fileFixture(); try {
    const original = await f.service.read(f.context, f.file); const preview = await f.service.prepareWrite(f.context, f.file, original.version, '用户确认的新内容');
    await assert.rejects(f.service.write(f.context, preview.id, preview.bindingHash), /exact, current/);
    assert.throws(() => f.service.confirmWrite(preview.id, 'changed'), /different parameters/); f.service.confirmWrite(preview.id, preview.bindingHash);
    await assert.rejects(f.service.write({ ...f.context, sessionId: 'different' }, preview.id, preview.bindingHash), /exact, current/);
    const result = await f.service.write(f.context, preview.id, preview.bindingHash); assert.equal(result.content, '用户确认的新内容'); assert.equal(await readFile(f.file, 'utf8'), '用户确认的新内容');
    assert.equal((await f.service.write(f.context, preview.id, preview.bindingHash)).version, result.version);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
test('changed write baselines require a new preview and approval', async () => {
  const f = await fileFixture(); try {
    const original = await f.service.read(f.context, f.file); const preview = await f.service.prepareWrite(f.context, f.file, original.version, 'proposed'); f.service.confirmWrite(preview.id, preview.bindingHash); await writeFile(f.file, 'external edit');
    await assert.rejects(f.service.write(f.context, preview.id, preview.bindingHash), /baseline changed/); assert.equal(await readFile(f.file, 'utf8'), 'external edit');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
test('Windows owner verification is explicit and cannot silently use fake Node UID', { skip: process.platform !== 'win32' }, async () => {
  await assert.rejects(OwnerFileService.create({ ownerId: 'o', deviceId: 'd', generation: 'g', controlPaths: [], expectedUid: 0 }), /trusted native adapter/);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-workbench-owner-acl-')); try {
    const file = path.join(directory, 'owned.txt'); await writeFile(file, 'fixture');
    const owned = await verifyCurrentWindowsOwner(file, await import('node:fs/promises').then(fs => fs.stat(file)));
    assert.equal(typeof owned, 'boolean');
    const service = await OwnerFileService.create({ ownerId: 'owner', deviceId: 'device', generation: 'g', controlPaths: [], verifyOwner: verifyCurrentWindowsOwner });
    const grant = service.issueGrant({ operations: ['read'], expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const context: FileContext = { grantId: grant.id, ownerId: 'owner', deviceId: 'device', generation: 'g', sessionId: 's', workspaceId: 'unrelated-workspace', operationId: 'read', os: 'win32' };
    if (owned) assert.equal((await service.read(context, file)).content, 'fixture'); else await assert.rejects(service.read(context, file), /not verified/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('materialization is a deterministic plan only and rejects unapproved dependencies', async () => {
  const profile = await probeEnvironment(host, { runner: reply('os\tLinux\n') });
  const policy = { approvedImages: ['approved-image'], approvedDependencies: ['git'], isolation: 'vm' as const, image: 'approved-image', dependencies: ['git'] };
  const plan = planMaterialization(profile, policy); assert.equal(plan.status, 'requires-explicit-confirmation'); assert.equal(plan.id, planMaterialization(profile, policy).id); assert.ok(plan.forbiddenHostChanges.includes('system accounts'));
  assert.throws(() => planMaterialization(profile, { ...policy, dependencies: ['unapproved'] }), /does not authorize/);
  assert.throws(() => planMaterialization(unknownProfile(host), policy), /current remote profile/);
});
