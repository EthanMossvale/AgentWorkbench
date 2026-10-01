import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import type { SshHost } from '../packages/contracts/index';
import { CODEX_DEVICE_AUTH_URL, RemoteCodexAuthService, scanCodexAccount, type AuthSpawn } from '../packages/remote-codex-auth/index';
import { buildRemoteCodexAuthCommand, REMOTE_CODEX_AUTH_PYTHON } from '../packages/remote-codex-auth/remote-script';

const host: SshHost = { id: 'fixture-workspace', name: 'fixture', hostname: 'fixture.invalid', port: 22, username: 'fixture-user', role: 'workspace', identityFile: path.resolve('fixtures/no-key'), knownHostsFile: path.resolve('fixtures/no-known-hosts'), ownerId: 'fixture-owner', workspaceGeneration: 'g1' };
const profile = '/home/fixture-user/.agent-workbench/codex';
class FakeProcess extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough(); killed: Array<string | undefined> = []; input = '';
  constructor() { super(); this.stdin.on('data', chunk => { this.input += chunk.toString(); }); }
  kill(signal?: string) { this.killed.push(signal); return true; }
  frame(jobId: string, type: string, fields: Record<string, unknown> = {}) { this.stdout.emit('data', Buffer.from(JSON.stringify({ protocol: 1, jobId, type, ...fields }) + '\n')); }
  close(code = 0) { this.emit('close', code); }
}
function harness(options: { now?: () => number; timeoutMs?: number } = {}) {
  const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptionsWithoutStdio; process: FakeProcess }> = [];
  const spawn: AuthSpawn = (command, args, spawnOptions) => { const process = new FakeProcess(); calls.push({ command, args, options: spawnOptions, process }); return process as unknown as ChildProcessWithoutNullStreams; };
  return { calls, spawn, service: new RemoteCodexAuthService({ spawn, ...options }) };
}
function offer(process: FakeProcess, jobId: string) { process.frame(jobId, 'ready', { profilePath: profile }); process.frame(jobId, 'awaiting-code', { verificationUrl: CODEX_DEVICE_AUTH_URL, userCode: 'ABCD-12345' }); }
function confirmed(process: FakeProcess, jobId: string) { process.frame(jobId, 'finished', { cleanup: 'confirmed' }); process.close(); }
function cancelAck(process: FakeProcess, jobId: string) { process.stdin.on('data', chunk => { if (chunk.toString().includes('cancel')) confirmed(process, jobId); }); }

test('Codex authorization accepts only explicit workspace identities and caps its lifetime', () => {
  const h = harness();
  for (const changed of [{ role: 'admin' as const }, { username: 'root' }, { username: 'ROOT' }]) assert.throws(() => h.service.start({ ...host, ...changed }), /普通工作空间/);
  assert.equal(h.calls.length, 0);
  for (const timeoutMs of [0, -1, 900001, Number.NaN]) assert.throws(() => new RemoteCodexAuthService({ timeoutMs }), /15 minutes/);
});

test('start returns preparing and passes only strict SSH/native profile controls', async () => {
  const h = harness(); const job = h.service.start(host); const call = h.calls[0]!;
  assert.equal(job.state, 'preparing'); assert.equal(job.userCode, undefined);
  for (const setting of ['StrictHostKeyChecking=yes', 'ForwardAgent=no', 'IdentityAgent=none', 'SendEnv=-*', 'PasswordAuthentication=no']) assert.ok(call.args.includes(setting));
  assert.equal(call.options.shell, false); assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.env?.OPENAI_API_KEY, undefined); assert.equal(call.options.env?.ANTHROPIC_API_KEY, undefined);
  assert.ok(call.args.at(-1)?.includes(` login 'fixture-user' 900000`));
  offer(call.process, job.jobId); assert.equal(h.service.status(host, job.jobId).userCode, 'ABCD-12345');
  call.process.stderr.write('access_token=fixture-secret raw diagnostic');
  assert.ok(!JSON.stringify(h.service.status(host, job.jobId)).includes('fixture-secret'));
  cancelAck(call.process, job.jobId); await h.service.dispose();
});

test('jobs bind the full saved identity and duplicate saved endpoints cannot race the profile', async () => {
  const h = harness(); const job = h.service.start(host); const process = h.calls[0]!.process;
  for (const change of [{ hostname: 'other.invalid' }, { username: 'other' }, { port: 2222 }, { identityFile: path.resolve('other-key') }, { knownHostsFile: path.resolve('other-hosts') }, { ownerId: 'other' }, { workspaceGeneration: 'g2' }]) assert.throws(() => h.service.status({ ...host, ...change }, job.jobId), /different or changed/);
  assert.throws(() => h.service.start({ ...host, id: 'same-endpoint-new-id' }), /already has an active/);
  cancelAck(process, job.jobId); await h.service.dispose();
});

test('invalid URLs, malformed codes and cross-job output fail closed without exposing raw output', async () => {
  for (const fields of [{ verificationUrl: 'https://attacker.invalid', userCode: 'ABCD-12345' }, { verificationUrl: CODEX_DEVICE_AUTH_URL, userCode: 'Bearer fixture-secret' }]) {
    const h = harness(); const job = h.service.start(host); const process = h.calls[0]!.process;
    cancelAck(process, job.jobId); process.frame(job.jobId, 'awaiting-code', fields);
    const result = h.service.status(host, job.jobId); assert.equal(result.state, 'failed'); assert.equal(result.userCode, undefined); assert.ok(!JSON.stringify(result).includes('fixture-secret'));
    await h.service.dispose();
  }
  const h = harness(); const job = h.service.start(host); const process = h.calls[0]!.process;
  cancelAck(process, job.jobId); process.frame('different-job', 'ready', { profilePath: profile });
  assert.equal(h.service.status(host, job.jobId).state, 'failed'); await h.service.dispose();
});

test('cancel immediately clears device codes and discards late account success', async () => {
  const h = harness(); const job = h.service.start(host); const process = h.calls[0]!.process; offer(process, job.jobId);
  process.stdin.on('data', chunk => { if (chunk.toString().includes('cancel')) { process.frame(job.jobId, 'account', { account: { status: 'authenticated', email: 'late@example.invalid' } }); confirmed(process, job.jobId); } });
  const cancelled = await h.service.cancel(host, job.jobId);
  assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.cleanup, 'confirmed'); assert.equal(cancelled.userCode, undefined); assert.equal(cancelled.account, undefined);
  await h.service.dispose();
});

test('authenticated state requires account metadata, cleanup acknowledgment and clean SSH exit', async () => {
  const h = harness(); const job = h.service.start(host); const process = h.calls[0]!.process; offer(process, job.jobId);
  process.frame(job.jobId, 'verifying'); assert.equal(h.service.status(host, job.jobId).userCode, undefined);
  process.frame(job.jobId, 'account', { account: { status: 'authenticated', email: 'fixture@example.invalid', plan: 'pro', authMethod: 'ChatGPT', access_token: 'fixture-secret', raw: 'fixture-secret' } });
  assert.equal(h.service.status(host, job.jobId).state, 'verifying');
  confirmed(process, job.jobId); const result = h.service.status(host, job.jobId);
  assert.equal(result.state, 'authenticated'); assert.equal(result.cleanup, 'confirmed'); assert.equal(result.account?.email, 'fixture@example.invalid'); assert.equal(result.account?.profilePath, profile);
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
  assert.equal((await h.service.cancel(host, job.jobId)).state, 'authenticated'); await h.service.dispose();
});

test('expired jobs clear codes and do not accept a late success', async () => {
  let now = 100000; const h = harness({ now: () => now, timeoutMs: 1000 }); const job = h.service.start(host); const process = h.calls[0]!.process;
  offer(process, job.jobId); cancelAck(process, job.jobId); now += 1001;
  const result = h.service.status(host, job.jobId); assert.equal(result.state, 'expired'); assert.equal(result.userCode, undefined); assert.equal(result.cleanup, 'confirmed');
  await h.service.dispose();
});

test('disconnected unconfirmed jobs block new work and cleanup retry opens a bound fresh SSH request', async () => {
  const h = harness(); const job = h.service.start(host); h.calls[0]!.process.close(255);
  assert.equal(h.service.status(host, job.jobId).cleanup, 'unconfirmed');
  assert.throws(() => h.service.start({ ...host, id: 'duplicate' }), /already has an active/);
  const cancelling = h.service.cancel(host, job.jobId);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.length, 2); const cleanup = h.calls[1]!;
  assert.ok(cleanup.args.at(-1)?.includes(`'${job.jobId}' cleanup 'fixture-user'`));
  cleanup.process.frame(job.jobId, 'cleanup', { cleanup: 'confirmed' }); cleanup.process.close();
  assert.equal((await cancelling).cleanup, 'confirmed');
  const second = h.service.start(host); cancelAck(h.calls[2]!.process, second.jobId); await h.service.dispose();
});

test('failed cleanup is honest, and a later retry can recover without repeating login', async () => {
  const h = harness(); const job = h.service.start(host); h.calls[0]!.process.close(255);
  const first = h.service.cancel(host, job.jobId); await new Promise(resolve => setImmediate(resolve)); h.calls[1]!.process.close(255);
  assert.equal((await first).cleanup, 'unconfirmed');
  const next = h.service.cancel(host, job.jobId); await new Promise(resolve => setImmediate(resolve));
  h.calls[2]!.process.frame(job.jobId, 'cleanup', { cleanup: 'confirmed' }); h.calls[2]!.process.close();
  assert.equal((await next).cleanup, 'confirmed'); assert.equal(h.calls.length, 3); await h.service.dispose();
});

test('account scan returns absent without initiating a login and preserves only allowed fields', async () => {
  const h = harness(); const promise = scanCodexAccount(host, { spawn: h.spawn });
  const call = h.calls[0]!; const match = call.args.at(-1)!.match(/'([a-f0-9-]{36})' scan /); assert.ok(match); const jobId = match[1]!;
  call.process.frame(jobId, 'ready', { profilePath: profile }); call.process.frame(jobId, 'account', { account: { status: 'unauthenticated', reason: 'profile-absent', refresh_token: 'fixture-secret' } }); confirmed(call.process, jobId);
  assert.deepEqual(await promise, { status: 'unauthenticated', source: 'codex account/read:workbench-profile', profilePath: profile, reason: 'profile-absent' });
});

test('spawn exceptions are sanitized errors, and do not create unusable job IDs', () => {
  const service = new RemoteCodexAuthService({ spawn: () => { throw new Error('fixture-secret'); } });
  assert.throws(() => service.start(host), error => error instanceof Error && !error.message.includes('fixture-secret'));
});

test('native helper source uses dedicated profile, version pin, account/read without refresh and process-group cleanup', t => {
  assert.ok(REMOTE_CODEX_AUTH_PYTHON.includes("os.path.join(parent, 'codex')"));
  assert.ok(REMOTE_CODEX_AUTH_PYTHON.includes("'login', '--device-auth'"));
  assert.ok(REMOTE_CODEX_AUTH_PYTHON.includes("'method': 'account/read', 'params': {'refreshToken': False}"));
  assert.ok(!REMOTE_CODEX_AUTH_PYTHON.includes('auth.json')); assert.ok(!REMOTE_CODEX_AUTH_PYTHON.includes('thread/start')); assert.ok(!REMOTE_CODEX_AUTH_PYTHON.includes('turn/start'));
  assert.ok(REMOTE_CODEX_AUTH_PYTHON.includes('start_new_session=True')); assert.ok(REMOTE_CODEX_AUTH_PYTHON.includes('os.killpg'));
  assert.ok(REMOTE_CODEX_AUTH_PYTHON.includes("if account.pw_uid == 0 or account.pw_name != USERNAME"));
  const result = spawnSync('python', ['-c', "import ast,sys; ast.parse(sys.stdin.read()); print('ok')"], { input: REMOTE_CODEX_AUTH_PYTHON, encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') { t.skip('Python source syntax check requires Python on the test host.'); return; }
  assert.equal(result.status, 0, result.stderr);
  assert.throws(() => buildRemoteCodexAuthCommand('bad', 'login', 'root;whoami', 900000));
});

test('remote worker cleanup cannot confirm a native process that survives both termination attempts', t => {
  const harness = String.raw`
import ast,json,subprocess,sys,types
tree=ast.parse(sys.stdin.read())
fn=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='terminate_worker')
calls=[]
class Worker:
    pid=4242
    stdout=None
    stdin=None
    def wait(self,timeout): raise subprocess.TimeoutExpired('fixture',timeout)
    def poll(self): return None
worker=Worker()
scope={'WORKER':worker,'STOP':None,'os':types.SimpleNamespace(killpg=lambda pid,sig:calls.append([pid,sig])),'signal':types.SimpleNamespace(SIGTERM=15,SIGKILL=9),'subprocess':subprocess}
exec(compile(ast.Module(body=[fn],type_ignores=[]),'<cleanup-fixture>','exec'),scope)
result=scope['terminate_worker']()
print(json.dumps({'result':result,'retained':scope['WORKER'] is worker,'stop':scope['STOP'],'calls':calls}))
`;
  const result = spawnSync('python', ['-c', harness], { input: REMOTE_CODEX_AUTH_PYTHON, encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') { t.skip('Python is not installed on this test host.'); return; }
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { result: false, retained: true, stop: 'cancelled', calls: [[4242, 15], [4242, 9]] });
});

test('remote main refuses UID zero and unsafe profiles; absent status scan creates nothing', t => {
  const harness = String.raw`
import ast,json,posixpath,re,stat,sys,types
tree=ast.parse(sys.stdin.read())
fn=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='main')
code=compile(ast.Module(body=[fn],type_ignores=[]),'<remote-main-fixture>','exec')
results=[]
for mode,uid,unsafe in [('login',0,False),('scan',1000,False),('login',1000,True)]:
    events=[]; writes=[]
    path=types.SimpleNamespace(isabs=posixpath.isabs,join=posixpath.join,isdir=lambda value:value=='/home/fixture-user',lexists=lambda value:unsafe and value.endswith('/.agent-workbench'))
    os=types.SimpleNamespace(geteuid=lambda:uid,path=path,lstat=lambda value:types.SimpleNamespace(st_uid=1000,st_mode=stat.S_IFLNK|0o777),mkdir=lambda *args:writes.append(args))
    scope={'os':os,'pwd':types.SimpleNamespace(getpwuid=lambda value:types.SimpleNamespace(pw_uid=uid,pw_name='fixture-user',pw_dir='/home/fixture-user')),'USERNAME':'fixture-user','MODE':mode,'emit':lambda kind,**fields:events.append(dict(type=kind,**fields)),'stat':stat,'prepare_job_record':lambda value:writes.append('job-record')}
    exec(code,scope); scope['main']()
    results.append({'events':events,'writes':writes})
print(json.dumps(results))
`;
  const result = spawnSync('python', ['-c', harness], { input: REMOTE_CODEX_AUTH_PYTHON, encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') { t.skip('Python is not installed on this test host.'); return; }
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout) as Array<{ events: Array<Record<string, unknown>>; writes: unknown[] }>;
  assert.deepEqual(rows[0], { events: [{ type: 'error', error: 'workspace-identity-required' }], writes: [] });
  assert.deepEqual(rows[1], { events: [{ type: 'ready', profilePath: profile }, { type: 'account', account: { status: 'unauthenticated', reason: 'profile-absent' } }], writes: [] });
  assert.deepEqual(rows[2], { events: [{ type: 'error', error: 'unsafe-profile' }], writes: [] });
});
