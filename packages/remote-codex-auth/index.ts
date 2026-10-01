import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { SshHost } from '../contracts/index';
import { buildSshArgs, buildSshEnvironment, SSH_EXECUTABLE, validateSshHost } from '../ssh-transport/index';
import { buildRemoteCodexAuthCommand } from './remote-script';

export const CODEX_DEVICE_AUTH_URL = 'https://auth.openai.com/codex/device' as const;
export type CodexAuthState = 'preparing' | 'awaiting-code' | 'verifying' | 'authenticated' | 'cancelled' | 'expired' | 'failed';
export interface CodexAccountScan { status: 'authenticated' | 'unauthenticated' | 'unknown'; source: 'codex account/read:workbench-profile'; profilePath?: string; email?: string; plan?: string; authMethod?: 'ChatGPT' | 'api-key'; reason?: 'profile-absent' | 'account-read-failed' }
export interface CodexAuthJob { jobId: string; hostId: string; state: CodexAuthState; createdAt: string; expiresAt: string; verificationUrl?: typeof CODEX_DEVICE_AUTH_URL; userCode?: string; profilePath?: string; account?: CodexAccountScan; error?: string; cleanup: 'pending' | 'confirmed' | 'unconfirmed' }
export type AuthSpawn = (command: string, args: readonly string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
export interface RemoteCodexAuthOptions { spawn?: AuthSpawn; now?: () => number; timeoutMs?: number }
interface JobRecord { value: CodexAuthJob; host: SshHost; hostHash: string; endpoint: string; process: ChildProcessWithoutNullStreams; decoder: StringDecoder; buffer: string; bytes: number; stopped: boolean; closed: boolean; finished: boolean; accountSeen: boolean; mode: 'login' | 'scan'; timer?: ReturnType<typeof setTimeout>; heartbeat?: ReturnType<typeof setInterval>; forceTimer?: ReturnType<typeof setTimeout>; cleanupRequest?: Promise<boolean>; done: Promise<void>; resolveDone: () => void }
const SOURCE = 'codex account/read:workbench-profile' as const;
const active = (job: CodexAuthJob) => ['preparing', 'awaiting-code', 'verifying'].includes(job.state);
const safeText = (value: unknown, maximum = 256): value is string => typeof value === 'string' && value.length <= maximum && !/[\x00-\x1f\x7f]|-----BEGIN|Bearer\s|(?:access_token|refresh_token|api_key)\s*[:=]|sk-[A-Za-z0-9_-]{12,}/i.test(value);
const errors: Record<string, string> = {
  'workspace-identity-required': '只能使用已保存的普通工作空间 SSH 身份登录 Codex。',
  'profile-unavailable': '远端工作空间目录不可用。', 'unsafe-profile': '独立 Codex profile 的路径或所有者不安全，已停止。',
  'profile-busy': '此远端 Codex profile 已有授权或账号读取操作，请等待它结束。',
  'codex-unavailable': '该工作空间未找到可执行的 Codex CLI。', 'unsupported-codex-version': '远端 Codex 版本尚未通过此登录接口验证。',
  'device-login-failed': '原生 Codex 设备代码登录未成功；可以重新开始。', 'account-read-failed': '登录流程已结束，但未能确认独立 profile 的账号状态。',
  'account-not-authenticated': '独立 profile 尚未返回已认证账号。', 'remote-auth-unavailable': '远端 Codex 登录服务不可用。',
  'transport-failed': 'SSH 登录连接中断，未确认远端清理结果。', 'protocol-failed': '远端登录响应无效，已停止本次流程。',
};
function validateWorkspace(host: SshHost): void { validateSshHost(host); if (host.role !== 'workspace' || host.username.toLowerCase() === 'root') throw new Error(errors['workspace-identity-required']); }
function hostHash(host: SshHost): string { return createHash('sha256').update(JSON.stringify([host.id, host.hostname, host.port, host.username, host.identityFile, host.knownHostsFile, host.ownerId, host.workspaceGeneration, host.role])).digest('hex'); }
// Host aliases can still be ambiguous, but duplicate saved entries for the same endpoint cannot race the profile.
function endpoint(host: SshHost): string { return JSON.stringify([host.hostname.toLowerCase(), host.port, host.username]); }
function parseAccount(value: unknown, profilePath?: string): CodexAccountScan | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (row.status !== 'authenticated' && row.status !== 'unauthenticated') return;
  const account: CodexAccountScan = { status: row.status, source: SOURCE, ...(profilePath ? { profilePath } : {}) };
  for (const key of ['email', 'plan'] as const) if (safeText(row[key])) account[key] = row[key];
  if (row.authMethod === 'ChatGPT' || row.authMethod === 'api-key') account.authMethod = row.authMethod;
  if (row.reason === 'profile-absent') account.reason = row.reason;
  return account;
}

/** In-memory authorization lifecycle. No job/code/token is persisted in application state. */
export class RemoteCodexAuthService {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly spawnProcess: AuthSpawn;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private disposed = false;
  constructor(options: RemoteCodexAuthOptions = {}) {
    this.spawnProcess = options.spawn ?? ((command, args, spawnOptions) => spawn(command, [...args], { ...spawnOptions, stdio: ['pipe', 'pipe', 'pipe'] }));
    this.now = options.now ?? Date.now; this.timeoutMs = options.timeoutMs ?? 15 * 60_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 900_000) throw new Error('Codex device authorization must expire within 15 minutes.');
  }
  start(host: SshHost): CodexAuthJob { return this.launch(host, 'login', this.timeoutMs); }
  status(host: SshHost, jobId: string): CodexAuthJob {
    const job = this.bound(host, jobId);
    if (active(job.value) && this.now() >= Date.parse(job.value.expiresAt)) this.stop(job, 'expired');
    return structuredClone(job.value);
  }
  async cancel(host: SshHost, jobId: string): Promise<CodexAuthJob> {
    const job = this.bound(host, jobId);
    if (job.value.state === 'authenticated' && job.value.cleanup === 'confirmed') return structuredClone(job.value);
    if (active(job.value)) this.stop(job, 'cancelled');
    else if (!job.closed && job.value.cleanup !== 'confirmed') this.requestStop(job);
    await Promise.race([job.done, new Promise<void>(resolve => { const timer = setTimeout(resolve, 2000); timer.unref(); })]);
    if (job.value.cleanup === 'pending') job.value.cleanup = 'unconfirmed';
    if (job.value.cleanup !== 'confirmed') {
      job.cleanupRequest ??= this.cleanupRemote(job).finally(() => { job.cleanupRequest = undefined; });
      if (await job.cleanupRequest) job.value.cleanup = 'confirmed';
    }
    return structuredClone(job.value);
  }
  async scan(host: SshHost, signal?: AbortSignal): Promise<CodexAccountScan> {
    if (signal?.aborted) throw new Error('Codex account status request cancelled.');
    const value = this.launch(host, 'scan', Math.min(this.timeoutMs, 25_000)); const job = this.jobs.get(value.jobId)!;
    const abort = () => this.stop(job, 'cancelled'); signal?.addEventListener('abort', abort, { once: true });
    try {
      await job.done;
      if (job.stopped || job.value.cleanup !== 'confirmed' || !job.value.account) return { status: 'unknown', source: SOURCE, ...(job.value.profilePath ? { profilePath: job.value.profilePath } : {}), reason: 'account-read-failed' };
      return structuredClone(job.value.account);
    } finally { signal?.removeEventListener('abort', abort); }
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.jobs.values()].filter(job => active(job.value) || job.value.cleanup !== 'confirmed').map(job => this.cancel(job.host, job.value.jobId)));
  }
  private bound(host: SshHost, jobId: string): JobRecord {
    validateWorkspace(host); const job = this.jobs.get(jobId);
    if (!job || job.hostHash !== hostHash(host)) throw new Error('Codex authorization belongs to a different or changed SSH connection.');
    return job;
  }
  private launch(host: SshHost, mode: 'login' | 'scan', timeoutMs: number): CodexAuthJob {
    validateWorkspace(host); if (this.disposed) throw new Error('Codex authorization service has stopped.');
    const target = endpoint(host);
    if ([...this.jobs.values()].some(job => job.endpoint === target && (active(job.value) || job.value.cleanup !== 'confirmed'))) throw new Error('This workspace already has an active Codex authorization or account request.');
    // Keep a bounded set of terminal results; active cleanup jobs are never evicted.
    if (this.jobs.size >= 128) for (const [id, job] of this.jobs) { if (job.closed && !active(job.value) && job.value.cleanup === 'confirmed') { this.jobs.delete(id); break; } }
    if (this.jobs.size >= 128) throw new Error('Too many active Codex authorization requests.');
    const jobId = randomUUID(); const created = this.now();
    const value: CodexAuthJob = { jobId, hostId: host.id, state: 'preparing', createdAt: new Date(created).toISOString(), expiresAt: new Date(created + timeoutMs).toISOString(), cleanup: 'pending' };
    let process: ChildProcessWithoutNullStreams;
    try { process = this.spawnProcess(SSH_EXECUTABLE, buildSshArgs(host, buildRemoteCodexAuthCommand(jobId, mode, host.username, timeoutMs)), { shell: false, windowsHide: true, env: buildSshEnvironment() }); }
    catch { throw new Error(errors['transport-failed']); }
    let resolveDone!: () => void; const done = new Promise<void>(resolve => { resolveDone = resolve; });
    const job: JobRecord = { value, host: structuredClone(host), hostHash: hostHash(host), endpoint: target, process, decoder: new StringDecoder('utf8'), buffer: '', bytes: 0, stopped: false, closed: false, finished: false, accountSeen: false, mode, done, resolveDone };
    this.jobs.set(jobId, job);
    process.stdout.on('data', (chunk: Buffer | string) => this.collect(job, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), false));
    process.stderr.on('data', (chunk: Buffer | string) => this.collect(job, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), true));
    process.stdin.on('error', () => { /* The remote supervisor may close stdin after acknowledging cleanup. */ });
    process.on('error', () => { if (!job.closed) { this.stop(job, 'failed', 'transport-failed'); this.closed(job, 255); } });
    process.on('close', (code: number | null) => this.closed(job, code));
    job.timer = setTimeout(() => this.stop(job, 'expired'), timeoutMs); job.timer.unref();
    job.heartbeat = setInterval(() => { if (!job.stopped && !job.closed) { try { process.stdin.write('heartbeat\n'); } catch { this.stop(job, 'failed', 'transport-failed'); } } }, 2500); job.heartbeat.unref();
    try { process.stdin.write('heartbeat\n'); } catch { this.stop(job, 'failed', 'transport-failed'); }
    // First render is always preparing; device code arrives through status polling.
    return structuredClone(value);
  }
  private collect(job: JobRecord, chunk: Buffer, stderr: boolean): void {
    if (job.closed) return;
    job.bytes += chunk.length;
    if (job.bytes > 256 * 1024) { this.stop(job, 'failed', 'protocol-failed'); return; }
    if (stderr) return; // Never retain or surface native/SSH raw diagnostics.
    job.buffer += job.decoder.write(chunk);
    if (job.buffer.length > 16_384) { job.buffer = ''; this.stop(job, 'failed', 'protocol-failed'); return; }
    let end: number;
    while ((end = job.buffer.indexOf('\n')) >= 0) {
      const line = job.buffer.slice(0, end); job.buffer = job.buffer.slice(end + 1);
      let frame: unknown; try { frame = JSON.parse(line); } catch { this.stop(job, 'failed', 'protocol-failed'); continue; }
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) { this.stop(job, 'failed', 'protocol-failed'); continue; }
      this.frame(job, frame as Record<string, unknown>);
    }
  }
  private frame(job: JobRecord, frame: Record<string, unknown>): void {
    if (frame.protocol !== 1 || frame.jobId !== job.value.jobId) { this.stop(job, 'failed', 'protocol-failed'); return; }
    if (frame.type === 'finished' && (frame.cleanup === 'confirmed' || frame.cleanup === 'unconfirmed')) { job.finished = frame.cleanup === 'confirmed'; job.value.cleanup = frame.cleanup; this.clearCode(job); return; }
    if (job.stopped || job.finished) return;
    if (frame.type === 'ready') {
      if (!job.value.profilePath && job.value.state === 'preparing' && safeText(frame.profilePath, 4096) && frame.profilePath.startsWith('/') && frame.profilePath.endsWith('/.agent-workbench/codex') && !frame.profilePath.split('/').includes('..')) job.value.profilePath = frame.profilePath;
      else this.stop(job, 'failed', 'protocol-failed');
    } else if (frame.type === 'awaiting-code' && job.mode === 'login' && job.value.state === 'preparing') {
      if (!job.value.profilePath || frame.verificationUrl !== CODEX_DEVICE_AUTH_URL || typeof frame.userCode !== 'string' || !/^[A-Z0-9]{4,6}-[A-Z0-9]{4,6}$/.test(frame.userCode)) { this.stop(job, 'failed', 'protocol-failed'); return; }
      job.value.state = 'awaiting-code'; job.value.verificationUrl = CODEX_DEVICE_AUTH_URL; job.value.userCode = frame.userCode;
    } else if (frame.type === 'verifying' && job.mode === 'login' && job.value.profilePath && ['preparing', 'awaiting-code'].includes(job.value.state)) { job.value.state = 'verifying'; this.clearCode(job); }
    else if (frame.type === 'account') {
      const account = parseAccount(frame.account, job.value.profilePath);
      if (!account || !job.value.profilePath || (job.mode === 'login' && (job.value.state !== 'verifying' || account.status !== 'authenticated'))) { this.stop(job, 'failed', 'protocol-failed'); return; }
      job.value.account = account; job.accountSeen = true; job.value.state = 'verifying'; this.clearCode(job);
    } else if (frame.type === 'cancelled' || frame.type === 'expired') { this.stop(job, frame.type); }
    else if (frame.type === 'error') { this.stop(job, 'failed', typeof frame.error === 'string' && errors[frame.error] ? frame.error : 'remote-auth-unavailable'); }
    else this.stop(job, 'failed', 'protocol-failed');
  }
  private clearCode(job: JobRecord): void { delete job.value.userCode; delete job.value.verificationUrl; }
  private async cleanupRemote(job: JobRecord): Promise<boolean> {
    return new Promise(resolve => {
      let child: ChildProcessWithoutNullStreams;
      try { child = this.spawnProcess(SSH_EXECUTABLE, buildSshArgs(job.host, buildRemoteCodexAuthCommand(job.value.jobId, 'cleanup', job.host.username, 15_000)), { shell: false, windowsHide: true, env: buildSshEnvironment() }); }
      catch { resolve(false); return; }
      let output = ''; let bytes = 0; let confirmed = false; let settled = false;
      const finish = (success: boolean) => { if (settled) return; settled = true; clearTimeout(timer); resolve(success); };
      const timer = setTimeout(() => { child.kill(); const force = setTimeout(() => child.kill('SIGKILL'), 500); force.unref(); finish(false); }, 17_000);
      child.stdout.on('data', (chunk: Buffer | string) => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk); if (bytes > 16_384) { child.kill(); finish(false); return; }
        output += chunk.toString(); let end: number;
        while ((end = output.indexOf('\n')) >= 0) { const line = output.slice(0, end); output = output.slice(end + 1); try { const frame = JSON.parse(line); if (frame.protocol === 1 && frame.jobId === job.value.jobId && frame.type === 'cleanup' && frame.cleanup === 'confirmed') confirmed = true; } catch { /* No raw diagnostics escape this boundary. */ } }
      });
      child.stderr.on('data', () => {}); child.stdin.on('error', () => {});
      child.on('error', () => finish(false)); child.on('close', (code: number | null) => finish(code === 0 && confirmed));
      child.stdin.end();
    });
  }
  private stop(job: JobRecord, state: 'failed' | 'cancelled' | 'expired', error?: string): void {
    if (job.closed || job.stopped || job.value.state === 'authenticated') return;
    job.stopped = true; job.value.state = state; if (error) job.value.error = errors[error] ?? errors['remote-auth-unavailable'];
    this.clearCode(job); delete job.value.account; if (job.timer) clearTimeout(job.timer); if (job.heartbeat) clearInterval(job.heartbeat);
    this.requestStop(job);
  }
  private requestStop(job: JobRecord): void {
    if (job.closed) return;
    try { if (!job.process.stdin.writableEnded) job.process.stdin.end('cancel\n'); } catch { /* Lease expiry still cleans the remote native process group. */ }
    if (!job.forceTimer) { job.forceTimer = setTimeout(() => { if (!job.closed) { if (job.value.cleanup !== 'confirmed') job.value.cleanup = 'unconfirmed'; job.process.kill(); const last = setTimeout(() => { if (!job.closed) { job.process.kill('SIGKILL'); this.closed(job, 255); } }, 500); last.unref(); } }, 1500); job.forceTimer.unref(); }
  }
  private closed(job: JobRecord, code: number | null): void {
    if (job.closed) return; job.closed = true;
    if (job.timer) clearTimeout(job.timer); if (job.heartbeat) clearInterval(job.heartbeat); if (job.forceTimer) clearTimeout(job.forceTimer);
    this.clearCode(job); job.buffer = ''; try { job.process.stdin.end(); } catch { /* Already closed. */ }
    if (!job.finished) job.value.cleanup = 'unconfirmed';
    if (!job.stopped) {
      if (code === 0 && job.finished && job.accountSeen) job.value.state = 'authenticated';
      else { job.value.state = 'failed'; job.value.error = errors['transport-failed']; delete job.value.account; }
    }
    job.resolveDone();
  }
}

/** Explicit native state refresh; an existing profile may receive native CLI housekeeping writes. */
export async function scanCodexAccount(host: SshHost, options: RemoteCodexAuthOptions & { signal?: AbortSignal } = {}): Promise<CodexAccountScan> {
  const service = new RemoteCodexAuthService(options);
  try { return await service.scan(host, options.signal); } finally { await service.dispose(); }
}
