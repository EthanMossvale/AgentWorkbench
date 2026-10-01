import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { AccountCatalog, SshHost } from '../packages/contracts/index';
import type { SshRunner } from '../packages/ssh-transport/index';
import { RemoteAccountCatalogService, REMOTE_CATALOG_COMMAND } from '../packages/remote-account-catalog/index';

const host: SshHost = { id: 'fixture-member', name: 'fixture', hostname: 'fixture.invalid', port: 22, username: 'member', role: 'workspace', identityFile: path.resolve('fixtures/no-key'), knownHostsFile: path.resolve('fixtures/no-hosts'), ownerId: 'owner', workspaceGeneration: 'g1' };
const jobId = '00000000-0000-4000-8000-000000000001';
const observedAt = '2026-09-25T00:00:00Z';
const account = { id: 'account-1', generation: 'credential-g1', provider: 'codex' as const, status: 'authenticated' as const, email: 'fixture@example.invalid', plan: 'pro', observedAt };
const ready = (): AccountCatalog => ({ authorityId: 'authority-1', generation: 'authority-g1', revision: 4, workspaceId: 'workspace-1', selectionRevision: 2, accounts: [account], availability: 'ready' });
const job = (state = 'preparing', extra: Record<string, unknown> = {}) => ({ jobId, hostId: 'remote-authority', state, cleanup: 'pending', createdAt: observedAt, expiresAt: '2026-09-25T00:15:00Z', ...extra });
const response = (value: unknown) => ({ stdout: JSON.stringify({ ok: true, value }), stderr: '', exitCode: 0, signal: null });
const failure = (code: string) => ({ stdout: JSON.stringify({ ok: false, error: code }), stderr: '', exitCode: 0, signal: null });
function client(handler: (method: string, params: Record<string, unknown>) => Promise<unknown> | unknown) {
  const calls: Array<{ command: string; method: string; params: Record<string, unknown>; stdin: string }> = [];
  const runner: SshRunner = async (_host, command, options) => { const input = JSON.parse(options?.stdin ?? '{}'); calls.push({ command, method: input.method, params: input.params, stdin: options?.stdin ?? '' }); assert.equal(options?.maxOutputBytes, 256 * 1024); return await handler(input.method, input.params) as ReturnType<typeof response>; };
  return { service: new RemoteAccountCatalogService({ runner }), calls };
}

test('shared catalog strips unapproved metadata and never returns native central paths', async () => {
  const h = client(() => response({ ...ready(), token: 'fixture-secret', root: '/private/service', accounts: [{ ...account, access_token: 'fixture-secret', profilePath: '/private/profile' }] }));
  const result = await h.service.list(host); assert.equal(result.availability, 'ready'); assert.equal(result.accounts[0]?.email, 'fixture@example.invalid');
  assert.ok(!JSON.stringify(result).includes('fixture-secret')); assert.ok(!JSON.stringify(result).includes('/private'));
  assert.equal(h.calls[0]?.command, REMOTE_CATALOG_COMMAND); assert.deepEqual(h.calls[0]?.params, {});
});

test('missing or unauthorized shared services never fall back to private authorization', async () => {
  const h = client(() => failure('BROKER_UNAVAILABLE'));
  assert.equal((await h.service.list(host)).availability, 'unavailable');
  await assert.rejects(h.service.start(host), /不会回退/);
  assert.ok(h.calls.every(call => call.method === 'catalog/list'));
  const denied = client(() => failure('UNAUTHORIZED'));
  assert.match((await denied.service.list(host)).reason!, /未被.*授权/);
});

test('selection binds authority, generation and the workspace CAS revision', async () => {
  const input = { accountId: 'account-1', expectedRevision: 2, authorityId: 'authority-1', generation: 'authority-g1' };
  const h = client((method, params) => { assert.equal(method, 'selection/set'); assert.deepEqual(params, input); return response({ ...ready(), selectionRevision: 3, selectedAccountId: 'account-1' }); });
  assert.equal((await h.service.select(host, input)).selectionRevision, 3);
  await assert.rejects(h.service.select({ ...host, role: 'admin' }, input), /管理员/);
  const stale = client(() => failure('STALE_AUTHORITY')); await assert.rejects(stale.service.select(host, input), /身份或代际/);
  const staleSelection = client(() => failure('STALE_SELECTION')); await assert.rejects(staleSelection.service.select(host, input), /选择已变化/);
});

test('admin login routes to the shared authority and never exposes a central profile path', async () => {
  const h = client((method, params) => {
    if (method === 'catalog/list') return response({ ...ready(), workspaceId: 'administrator' });
    assert.equal(method, 'login/start'); assert.deepEqual(params, { authorityId: 'authority-1', generation: 'authority-g1' });
    return response(job('awaiting-code', { verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-12345', profilePath: '/private/central-profile' }));
  });
  const result = await h.service.start({ ...host, role: 'admin', username: 'root' });
  assert.equal(result.hostId, host.id); assert.equal(result.userCode, 'ABCD-12345'); assert.equal(result.profilePath, undefined);
});

test('jobs stay bound to the saved SSH identity and malformed device URLs fail closed', async () => {
  const h = client(method => method === 'catalog/list' ? response(ready()) : response(job()));
  await h.service.start(host);
  await assert.rejects(h.service.status({ ...host, identityFile: path.resolve('changed-key') }, jobId), /不属于/);
  assert.equal(h.calls.length, 2);
  const unsafe = client(method => method === 'catalog/list' ? response(ready()) : response(job('awaiting-code', { verificationUrl: 'https://attacker.invalid', userCode: 'ABCD-12345' })));
  await assert.rejects(unsafe.service.start(host), /无法确认远端任务/);
});

test('late status responses cannot restore a code after cancellation', async () => {
  let finishStatus!: (value: unknown) => void;
  const h = client(method => {
    if (method === 'catalog/list') return response(ready());
    if (method === 'login/start') return response(job());
    if (method === 'login/status') return new Promise(resolve => { finishStatus = resolve; });
    return response(job('cancelled', { cleanup: 'confirmed' }));
  });
  await h.service.start(host); const status = h.service.status(host, jobId);
  const cancelled = await h.service.cancel(host, jobId); assert.equal(cancelled.state, 'cancelled');
  finishStatus(response(job('awaiting-code', { verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-12345' })));
  const late = await status; assert.equal(late.state, 'cancelled'); assert.equal(late.userCode, undefined);
  await h.service.dispose();
});

test('invalid catalogs and arbitrary server exceptions are not reflected into desktop state', async () => {
  const h = client(() => response({ ...ready(), accounts: [account, account] })); assert.equal((await h.service.list(host)).availability, 'unavailable');
  const error = client(() => failure('Bearer fixture-secret'));
  assert.ok(!JSON.stringify(await error.service.list(host)).includes('fixture-secret'));
});

test('a lost authorization receipt reports uncertain remote cleanup and preserves the busy guard', async () => {
  let starts = 0;
  const h = client(method => {
    if (method === 'catalog/list') return response(ready());
    if (starts++ === 0) throw new Error('fixture transport disconnect');
    return failure('LOGIN_BUSY');
  });
  await assert.rejects(h.service.start(host), /重新发起不代表上次清理已确认/);
  await assert.rejects(h.service.start(host), /清理尚未确认/);
  assert.ok(h.calls.every(call => call.method === 'catalog/list' || call.method === 'login/start'));
});

test('client bounds responses independently and cannot restore a code from an invalid cancel receipt', async () => {
  const oversized = client(() => ({ stdout: ' '.repeat(256 * 1024 + 1), stderr: '', exitCode: 0, signal: null }));
  assert.equal((await oversized.service.list(host)).availability, 'unavailable');
  const h = client(method => method === 'catalog/list' ? response(ready()) : response(job('awaiting-code', { verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-12345' })));
  await h.service.start(host);
  await assert.rejects(h.service.cancel(host, jobId), /未能完成/);
  const status = await h.service.status(host, jobId);
  assert.equal(status.state, 'cancelled'); assert.equal(status.cleanup, 'unconfirmed'); assert.equal(status.userCode, undefined);
});

test('disposal waits for pending discovery and prevents its late result from starting authorization', async () => {
  let finishList!: (value: unknown) => void;
  const h = client(method => { assert.equal(method, 'catalog/list'); return new Promise(resolve => { finishList = resolve; }); });
  const starting = assert.rejects(h.service.start(host), /正在退出/);
  let disposed = false;
  const disposal = h.service.dispose().then(() => { disposed = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(disposed, false);
  finishList(response(ready()));
  await Promise.all([starting, disposal]);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0]?.method, 'catalog/list');
  await assert.rejects(h.service.start(host), /正在退出/);
  assert.equal((await h.service.list(host)).availability, 'unavailable');
  assert.equal(h.calls.length, 1);
});

test('disposal waits for a late start receipt and cancellation without returning its device code', async () => {
  let finishStart!: (value: unknown) => void;
  let finishCancel!: (value: unknown) => void;
  const h = client(method => {
    if (method === 'catalog/list') return response(ready());
    if (method === 'login/start') return new Promise(resolve => { finishStart = resolve; });
    assert.equal(method, 'login/cancel');
    return new Promise(resolve => { finishCancel = resolve; });
  });
  await h.service.list(host);
  const starting = assert.rejects(h.service.start(host), /正在退出/);
  const firstDisposal = h.service.dispose(); assert.equal(h.service.dispose(), firstDisposal);
  let disposed = false;
  const disposal = firstDisposal.then(() => { disposed = true; });
  finishStart(response(job('awaiting-code', { verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-12345' })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, false);
  assert.deepEqual(h.calls.at(-1)?.params, { jobId, authorityId: 'authority-1', generation: 'authority-g1' });
  assert.equal(h.calls.at(-1)?.method, 'login/cancel');
  await assert.rejects(h.service.start(host), /正在退出/);
  finishCancel(response(job('cancelled', { cleanup: 'confirmed' })));
  await Promise.all([starting, disposal]); assert.equal(disposed, true);
  assert.equal(h.calls.filter(call => call.method === 'login/cancel').length, 1);
});

test('failed cleanup of a late start remains cancelled and cannot return a device code', async () => {
  let finishStart!: (value: unknown) => void;
  const h = client(method => {
    if (method === 'catalog/list') return response(ready());
    if (method === 'login/start') return new Promise(resolve => { finishStart = resolve; });
    if (method === 'login/cancel') throw new Error('fixture disconnect during cancel');
    return response(job('awaiting-code', { verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-12345' }));
  });
  await h.service.list(host);
  const starting = assert.rejects(h.service.start(host), /正在退出/);
  const disposal = h.service.dispose();
  finishStart(response(job('awaiting-code', { verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-12345' })));
  await Promise.all([starting, disposal]);
  const result = await h.service.status(host, jobId);
  assert.equal(result.state, 'cancelled'); assert.equal(result.cleanup, 'unconfirmed'); assert.equal(result.userCode, undefined);
  assert.equal(h.calls.filter(call => call.method === 'login/cancel').length, 1);
});
