import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { SshHost } from '../contracts/index';

export const SSH_EXECUTABLE = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe') : 'ssh';
export interface SshResult { stdout: string; stderr: string; exitCode: number; signal: string | null }
export interface SshRunOptions { timeoutMs?: number; maxOutputBytes?: number; signal?: AbortSignal; stdin?: string; onStdout?:(chunk:string)=>void; onStderr?:(chunk:string)=>void; collectOutput?:boolean }
export type SshRunner = (host: SshHost, command: string, options?: SshRunOptions) => Promise<SshResult>;
export class SshTransportError extends Error {
  constructor(public readonly code: 'INVALID_HOST' | 'SPAWN_FAILED' | 'CANCELLED' | 'TIMEOUT' | 'OUTPUT_LIMIT', message: string) { super(message); this.name = 'SshTransportError'; }
}
const invalid = (message: string): never => { throw new SshTransportError('INVALID_HOST', message); };
/** Inherit the actual local environment; Workbench account secrets are never injected. */
export function buildSshEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {...source};
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

/** Inherit user SSH routing while binding the selected identity, member and host trust. */
export function buildSshArgs(host: SshHost, remoteCommand: string): string[] {
  validateSshHost(host);
  if (typeof remoteCommand !== 'string' || !remoteCommand || remoteCommand.includes('\0') || remoteCommand.length > 128 * 1024) invalid('Invalid remote command.');
  const knownHosts = host.knownHostsFile.replaceAll('\\', '/');
  return ['-T',
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'SendEnv=-*',
    '-o', `UserKnownHostsFile="${knownHosts}"`, '-o', 'GlobalKnownHostsFile=none',
    '-o', 'IdentitiesOnly=yes', '-o', 'ForwardAgent=no',
    '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no',
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
  const timeoutMs = options.timeoutMs ?? 0;
  const maxOutputBytes = options.maxOutputBytes ?? 0;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || !Number.isInteger(maxOutputBytes) || maxOutputBytes < 0) throw new RangeError('Invalid SSH timeout/output bound.');
  if (options.signal?.aborted) throw new SshTransportError('CANCELLED', 'SSH request cancelled.');
  return new Promise<SshResult>((resolve, reject) => {
    const child = spawn(SSH_EXECUTABLE, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: buildSshEnvironment() });
    let stdout = '', stderr = '', diagnosticPending = '', privateBlock = false, bytes = 0, failure: SshTransportError | undefined;
    const stdoutDecoder = new StringDecoder('utf8'); const stderrDecoder = new StringDecoder('utf8');
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: SshTransportError) => {
      if (failure) return;
      failure = error; child.kill();
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 500); forceTimer.unref();
    };
    let timer:ReturnType<typeof setTimeout>|undefined;
    const started=performance.now(),wait=()=>{const remaining=timeoutMs-(performance.now()-started);if(remaining<=0)stop(new SshTransportError('TIMEOUT','SSH request exceeded its deadline.'));else timer=setTimeout(wait,Math.min(remaining,2147483647));};if(timeoutMs)wait();
    const cancel = () => stop(new SshTransportError('CANCELLED', 'SSH request cancelled.'));
    options.signal?.addEventListener('abort', cancel, { once: true });
    const diagnostic=(value:string,final=false)=>{
      diagnosticPending+=value;
      let end:number;
      while((end=diagnosticPending.indexOf('\n'))>=0||final&&diagnosticPending.length){
        const line=end>=0?diagnosticPending.slice(0,end+1):diagnosticPending;
        diagnosticPending=end>=0?diagnosticPending.slice(end+1):'';
        if(/-----BEGIN [^-]*PRIVATE KEY-----/.test(line)){privateBlock=true;options.onStderr?.('[private-key-redacted]\n');}
        if(privateBlock){if(/-----END [^-]*PRIVATE KEY-----/.test(line))privateBlock=false;continue;}
        options.onStderr?.(redactSshDiagnostic(line,host));
      }
    };
    const collect = (chunk: Buffer, isError: boolean) => {
      bytes += chunk.length;
      if (maxOutputBytes && bytes > maxOutputBytes) { stop(new SshTransportError('OUTPUT_LIMIT', 'SSH output exceeded its bound.')); return; }
      const value=(isError?stderrDecoder:stdoutDecoder).write(chunk);
      if(isError){diagnostic(value);if(options.collectOutput!==false)stderr+=value;}else{options.onStdout?.(value);if(options.collectOutput!==false)stdout+=value;}
    };
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, false));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, true));
    child.stdin.on('error', () => { /* A remote process may close stdin before consuming all input. */ });
    child.on('error', error => { failure = new SshTransportError('SPAWN_FAILED', 'Unable to start the configured OpenSSH executable: '+redactSshDiagnostic(error.message,host)); });
    child.on('close', (code, signal) => {
      clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); options.signal?.removeEventListener('abort', cancel);
      const out=stdoutDecoder.end(),err=stderrDecoder.end();if(out)options.onStdout?.(out);diagnostic(err,true);if(options.collectOutput!==false){stdout+=out;stderr+=err;}
      if (failure) reject(failure); else resolve({ stdout, stderr: redactSshDiagnostic(stderr, host), exitCode: code ?? 255, signal });
    });
    child.stdin.end(options.stdin);
  });
};
