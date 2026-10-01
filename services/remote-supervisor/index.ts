import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { SshHost } from '../../packages/contracts/index.js';
import { buildSshArgs, buildSshEnvironment, SSH_EXECUTABLE } from '../../packages/ssh-transport/index.js';

export type ProcessState = 'new' | 'starting' | 'running' | 'stopping' | 'closed' | 'failed';
export interface NativeFrame {
  readonly sequence?: number;
  readonly rawText: string;
  /** The exact wire bytes, including the line terminator. Never a replacement signature. */
  readonly rawBase64: string;
  readonly sha256: string;
  readonly receivedAt: string;
  readonly value: Readonly<Record<string, unknown>>;
}
export interface ProcessSpec {
  executable: string;
  args: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxFrameBytes?: number;
  maxOutputBytes?: number;
  lifetimeMs?: number;
  outputMode?: 'jsonl' | 'opaque';
}
export interface ProcessExit { code: number | null; signal: NodeJS.Signals | null; reason: string }
/** Native stream lifecycle shared by local processes and session-bound SSH transports. */
export interface NativeProcessTransport extends EventEmitter {
  state:ProcessState;
  start():Promise<void>;
  write(value:unknown):Promise<void>;
  stop(reason?:string):Promise<ProcessExit>;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const member of Object.values(value)) deepFreeze(member);
  }
  return value;
}

let nativeFrameSequence = 0;
export function decodeNativeFrame(bytes: Buffer, receivedAt = new Date().toISOString()): NativeFrame {
  // JSONL transports are UTF-8. A fatal decoder prevents lossily rewriting signed content.
  const wire = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const rawText = wire.endsWith('\r\n') ? wire.slice(0, -2) : wire.endsWith('\n') ? wire.slice(0, -1) : wire;
  const value: unknown = JSON.parse(rawText);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native frame must be a JSON object');
  return deepFreeze({ rawText, rawBase64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'), receivedAt, sequence: ++nativeFrameSequence, value: value as Record<string, unknown> });
}

/** One subprocess, no restart, replay, local-runtime fallback, or ambient shell. */
export class ProcessSupervisor extends EventEmitter {
  state: ProcessState = 'new';
  private child?: ChildProcessWithoutNullStreams;
  private pending = Buffer.alloc(0);
  private outputBytes = 0;
  private lifetime?: ReturnType<typeof setTimeout>;
  private closingReason = 'process-exit';
  private exitValue?: ProcessExit;
  private stopPromise?: Promise<ProcessExit>;

  constructor(readonly spec: ProcessSpec) {
    super();
    if (!spec.executable || /[\0\r\n]/.test(spec.executable)) throw new Error('Invalid executable');
    if (spec.args.some(arg => arg.includes('\0'))) throw new Error('Invalid process argument');
    for (const limit of [spec.maxFrameBytes, spec.maxOutputBytes, spec.lifetimeMs]) {
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) throw new Error('Process limits must be positive integer bounds');
    }
  }

  async start(): Promise<void> {
    if (this.state !== 'new') throw new Error('Process can only start once');
    this.state = 'starting';
    this.child = spawn(this.spec.executable, [...this.spec.args], {
      cwd: this.spec.cwd, env: this.spec.env, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const child = this.child;
    child.stdout.on('data', (chunk: Buffer) => this.acceptBytes(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      this.outputBytes += chunk.length;
      if (this.outputBytes > (this.spec.maxOutputBytes ?? 128 * 1024 * 1024)) { this.protocolFailure('Native output limit exceeded'); return; }
      this.emit('diagnostic', chunk.toString('utf8'));
    });
    child.stdin.on('error', error => this.emit('fault', error));
    child.on('error', error => {
      this.state = 'failed';
      this.emit('fault', error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(this.lifetime);
      if (this.pending.length) this.emit('fault', new Error('Native stream ended with a truncated frame'));
      this.pending = Buffer.alloc(0);
      if (this.state !== 'failed') this.state = 'closed';
      this.exitValue = { code, signal, reason: this.closingReason };
      this.emit('disconnect', this.exitValue);
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { child.off('spawn', onSpawn); reject(error); };
      const onSpawn = () => { child.off('error', onError); if (this.state === 'starting') this.state = 'running'; resolve(); };
      child.once('error', onError);
      child.once('spawn', onSpawn);
    });
    if (this.spec.lifetimeMs !== undefined && (this.state as ProcessState) === 'running') {
      this.lifetime = setTimeout(() => { void this.stop('lifetime-timeout'); }, this.spec.lifetimeMs);
      this.lifetime.unref();
    }
  }

  private acceptBytes(chunk: Buffer): void {
    if (this.state === 'stopping' || this.state === 'failed') return;
    this.outputBytes += chunk.length;
    const limit = this.spec.maxFrameBytes ?? 8 * 1024 * 1024;
    if (this.outputBytes > (this.spec.maxOutputBytes ?? 128 * 1024 * 1024)) {
      this.protocolFailure('Native output limit exceeded'); return;
    }
    if (this.spec.outputMode === 'opaque') { this.emit('stdout', Buffer.from(chunk)); return; }
    this.pending = Buffer.concat([this.pending, chunk]);
    let end: number;
    while ((end = this.pending.indexOf(10)) >= 0) {
      if (end + 1 > limit) { this.protocolFailure('Native frame limit exceeded'); return; }
      const frameBytes = this.pending.subarray(0, end + 1);
      this.pending = this.pending.subarray(end + 1);
      try { this.emit('frame', decodeNativeFrame(frameBytes)); }
      catch { this.protocolFailure('Invalid native JSONL frame'); return; }
    }
    if (this.pending.length > limit) this.protocolFailure('Native frame limit exceeded');
  }

  private protocolFailure(message: string): void {
    this.emit('fault', new Error(message));
    void this.stop('protocol-failure');
  }

  async write(value: unknown): Promise<void> {
    const child = this.child;
    if (this.state !== 'running' || !child || child.stdin.destroyed) throw new Error('Native process is not connected');
    const data = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(data) > (this.spec.maxFrameBytes ?? 8 * 1024 * 1024)) throw new Error('Outbound native frame limit exceeded');
    await new Promise<void>((resolve, reject) => child.stdin.write(data, error => error ? reject(error) : resolve()));
  }

  waitForExit(): Promise<ProcessExit> {
    if (this.exitValue) return Promise.resolve(this.exitValue);
    return new Promise(resolve => this.once('disconnect', resolve));
  }

  /** Start a new bounded exchange only when the caller has no outstanding request. */
  resetOutputBudget():void { this.outputBytes=0; }

  /** One explicit native login reply. Never serialize it as JSON or emit it. */
  async writeLoginCode(value: string): Promise<void> {
    if (this.spec.outputMode !== 'opaque' || !value || value.length > 4096 || /\s/.test(value)) throw Error('NATIVE_LOGIN_CODE_INVALID');
    const child = this.child;
    if (this.state !== 'running' || !child || child.stdin.destroyed) throw Error('NATIVE_LOGIN_NOT_CONNECTED');
    await new Promise<void>((resolve, reject) => child.stdin.write(value + '\n', error => error ? reject(error) : resolve()));
  }

  stop(reason = 'requested'): Promise<ProcessExit> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopOnce(reason);
    return this.stopPromise;
  }

  private async stopOnce(reason: string): Promise<ProcessExit> {
    if (this.exitValue) return this.exitValue;
    this.closingReason = reason;
    const child = this.child;
    if (!child || !child.pid) {
      this.state = 'closed';
      this.exitValue = { code: null, signal: null, reason };
      this.emit('disconnect', this.exitValue);
      return this.exitValue;
    }
    this.state = 'stopping';
    // Terminate only the process group/PID created by this supervisor.
    if (process.platform === 'win32') {
      // Keep the owner alive until taskkill captures its descendants. Closing stdin
      // first lets a native CLI exit and orphan tool processes holding our pipes.
      await new Promise<void>(resolve => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => { child.kill(); resolve(); });
        killer.once('close', () => resolve());
      });
      child.stdin.end();
    } else {
      child.stdin.end();
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      const timer = setTimeout(() => {
        if (!this.exitValue) try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }, 1500);
      timer.unref();
      this.once('disconnect', () => clearTimeout(timer));
    }
    return this.waitForExit();
  }
}

export function quotePosixArgument(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error('Remote argument contains a control character');
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function remoteCommand(executable: string, args: readonly string[], cwd?: string): string {
  if (!executable.startsWith('/')) throw new Error('Remote native executable must be an absolute pinned path');
  if (cwd && !cwd.startsWith('/')) throw new Error('Remote cwd must be absolute POSIX path');
  const command = `exec ${[executable, ...args].map(quotePosixArgument).join(' ')}`;
  return cwd ? `cd -- ${quotePosixArgument(cwd)} && ${command}` : command;
}

/** Local SSH only transports stdio; native runtime/auth remain on the configured VPS. */
export function createRemoteSupervisor(host: SshHost, executable: string, args: readonly string[], cwd?: string): ProcessSupervisor {
  return new ProcessSupervisor({ executable: SSH_EXECUTABLE, args: buildSshArgs(host, remoteCommand(executable, args, cwd)), env: buildSshEnvironment() });
}
