import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { SshHost } from '../contracts/index';

export const SSH_EXECUTABLE = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe') : 'ssh';
export interface SshResult { stdout: string; stderr: string; exitCode: number; signal: string | null }
export interface SshRunOptions { timeoutMs?: number; maxOutputBytes?: number; signal?: AbortSignal; stdin?: string }
export type SshRunner = (host: SshHost, command: string, options?: SshRunOptions) => Promise<SshResult>;
export class SshTransportError extends Error {
  constructor(public readonly code: 'INVALID_HOST' | 'SPAWN_FAILED' | 'CANCELLED' | 'TIMEOUT' | 'OUTPUT_LIMIT', message: string) { super(message); this.name = 'SshTransportError'; }
}
const invalid = (message: string): never => { throw new SshTransportError('INVALID_HOST', message); };
/** Minimal child environment; no API keys, translation credentials, proxy variables or ambient SSH agent. */
export function buildSshEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'ProgramData', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL']) {
    if (source[name] !== undefined) result[name] = source[name];
  }
  result.SSH_ASKPASS_REQUIRE = 'never'; result.SSH_AUTH_SOCK = ''; result.SSH_ASKPASS = '';
  return result;
}
export function validateSshHost(host: SshHost): void {
  if (!host || typeof host !== 'object') invalid('An explicit SSH host is required.');
  const name = host.hostname;
  if (typeof name !== 'string' || name.length > 253 || (!isIP(name) && !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(name))) invalid('Invalid SSH hostname.');
  if (!Number.isInteger(host.port) || host.port < 1 || host.port > 65535) invalid('Invalid SSH port.');
  if (typeof host.username !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(host.username)) invalid('Invalid explicit SSH user.');
  for (const [label, value] of [['identity file', host.identityFile], ['known-hosts file', host.knownHostsFile]] as const) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n"]/.test(value) || value.length > 4096) invalid(`An absolute ${label} reference is required.`);
  }
  for (const value of [host.id, host.ownerId, host.workspaceGeneration]) if (typeof value !== 'string' || !value || value.length > 256 || /[\0\r\n]/.test(value)) invalid('Invalid host/owner/generation binding.');
}

/** No SSH config, agent, proxy, shared control socket, password fallback or new host trust is inherited. */
export function buildSshArgs(host: SshHost, remoteCommand: string): string[] {
  validateSshHost(host);
  if (typeof remoteCommand !== 'string' || !remoteCommand || remoteCommand.includes('\0') || remoteCommand.length > 128 * 1024) invalid('Invalid remote command.');
  const knownHosts = host.knownHostsFile.replaceAll('\\', '/');
  return ['-F', process.platform === 'win32' ? 'NUL' : '/dev/null', '-T',
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'SendEnv=-*',
    '-o', `UserKnownHostsFile="${knownHosts}"`, '-o', 'GlobalKnownHostsFile=none',
    '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'ForwardAgent=no',
    '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no', '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none',
    '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no', '-o', 'PreferredAuthentications=publickey',
    '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
    '-i', host.identityFile, '-p', String(host.port), '-l', host.username, '--', host.hostname, remoteCommand];
}

export function redactSshDiagnostic(text: string, host: SshHost): string {
  return text.replaceAll(host.identityFile, '[identity-file]').replaceAll(host.knownHostsFile, '[known-hosts-file]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[private-key-redacted]')
    .replace(/\b(?:Bearer\s+)[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1?[redacted]')
    .replace(/\b((?:access_token|refresh_token|api_key|password)\s*[=:]\s*)[^\s]+/gi, '$1[redacted]');
}

export const runSsh: SshRunner = async (host, command, options = {}) => {
  const args = buildSshArgs(host, command);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86_400_000 || !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 64 * 1024 * 1024) throw new RangeError('Invalid SSH timeout/output bound.');
  if (options.signal?.aborted) throw new SshTransportError('CANCELLED', 'SSH request cancelled.');
  return new Promise<SshResult>((resolve, reject) => {
    const child = spawn(SSH_EXECUTABLE, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: buildSshEnvironment() });
    let stdout = '', stderr = '', bytes = 0, failure: SshTransportError | undefined;
    const stdoutDecoder = new StringDecoder('utf8'); const stderrDecoder = new StringDecoder('utf8');
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: SshTransportError) => {
      if (failure) return;
      failure = error; child.kill();
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 500); forceTimer.unref();
    };
    const timer = setTimeout(() => stop(new SshTransportError('TIMEOUT', 'SSH request exceeded its deadline.')), timeoutMs);
    const cancel = () => stop(new SshTransportError('CANCELLED', 'SSH request cancelled.'));
    options.signal?.addEventListener('abort', cancel, { once: true });
    const collect = (chunk: Buffer, isError: boolean) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) { stop(new SshTransportError('OUTPUT_LIMIT', 'SSH output exceeded its bound.')); return; }
      if (isError) stderr += stderrDecoder.write(chunk); else stdout += stdoutDecoder.write(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, false));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, true));
    child.stdin.on('error', () => { /* A remote process may close stdin before consuming all input. */ });
    child.on('error', error => { failure = new SshTransportError('SPAWN_FAILED', 'Unable to start the configured OpenSSH executable: '+redactSshDiagnostic(error.message,host)); });
    child.on('close', (code, signal) => {
      clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); options.signal?.removeEventListener('abort', cancel);
      stdout += stdoutDecoder.end(); stderr += stderrDecoder.end();
      if (failure) reject(failure); else resolve({ stdout, stderr: redactSshDiagnostic(stderr, host), exitCode: code ?? 255, signal });
    });
    child.stdin.end(options.stdin);
  });
};
