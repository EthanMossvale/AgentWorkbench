import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

async function terminate(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const killer = spawn(path.join(process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { killer.kill(); reject(Error('CLI_PROCESS_STATE_UNKNOWN')); }, 10000);
      killer.on('error', () => { clearTimeout(timer); reject(Error('CLI_PROCESS_STATE_UNKNOWN')); });
      killer.on('close', code => { clearTimeout(timer); if (code === 0 || child.exitCode !== null) resolve(); else reject(Error('CLI_PROCESS_STATE_UNKNOWN')); });
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw Error('CLI_PROCESS_STATE_UNKNOWN'); }
  }
}

export interface Command { executable: string; args: string[] }
export type RunCommand = (command: Command, options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number }) => Promise<string>;
export function cliFailureCode(output: string): string {
  if (/checksum (verification failed|mismatch)/i.test(output)) return 'CLI_INSTALL_CHECKSUM_FAILED';
  if (/does not support 32-bit|platform .* not found in manifest|unsupported platform/i.test(output)) return 'CLI_INSTALL_PLATFORM_UNSUPPORTED';
  if (/failed to get (latest version|manifest)|failed to download binary|unable to connect|could not resolve|name resolution/i.test(output)) return 'CLI_INSTALL_DOWNLOAD_FAILED';
  if (/access (is )?denied|permission denied|unauthorizedaccessexception/i.test(output)) return 'CLI_INSTALL_PERMISSION_DENIED';
  return 'CLI_COMMAND_FAILED';
}
/** Bounded native commands only; output is never persisted or sent to a model. */
export const runCommand: RunCommand = (command, options) => new Promise((resolve, reject) => {
  const child = spawn(command.executable, command.args, { cwd: options.cwd, env: options.env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', diagnostic = '', settled = false, stopping = false;
  const done = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(output); };
  const stop = (code: string) => { if (settled || stopping) return; stopping = true; void terminate(child).then(() => done(Error(code)), error => done(error)); };
  const timer = setTimeout(() => stop('CLI_COMMAND_TIMED_OUT'), options.timeout);
  child.on('error', () => done(Error('CLI_COMMAND_FAILED')));
  child.stdout.on('data', chunk => { if (stopping) return; output += chunk.toString(); if (output.length > 1024 * 1024) stop('CLI_OUTPUT_TOO_LARGE'); });
  child.stderr.on('data', chunk => { if (!stopping && diagnostic.length < 8192) diagnostic += chunk.toString().slice(0, 8192 - diagnostic.length); });
  child.on('close', code => { if (!stopping) done(code === 0 ? undefined : Error(cliFailureCode(output + '\n' + diagnostic))); });
});

export async function codexConfiguration<T>(executable: string, env: NodeJS.ProcessEnv, cwd: string, operation: (request: (method: string, params: unknown) => Promise<any>) => Promise<T>, strict = false, timeout = 15000): Promise<T> {
  const child = spawn(executable, ['-c', 'check_for_update_on_startup=false', 'app-server', ...(strict ? ['--strict-config'] : []), '--listen', 'stdio://'], { env, cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'ignore'] });
  const closed = new Promise<void>(resolve => { child.once('close', () => resolve()); child.once('error', () => resolve()); });
  let sequence = 0, buffer = '', bytes = 0, ended = false;
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= terminate(child);
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const fail = () => { ended = true; for (const value of pending.values()) value.reject(Error('NATIVE_CONFIG_UNAVAILABLE')); pending.clear(); };
  child.on('error', fail); child.on('close', fail); child.stdin.on('error', fail);
  child.stdout.on('data', chunk => {
    bytes += chunk.length; if (bytes > 8 * 1024 * 1024) { fail(); void stop().catch(() => {}); return; }
    buffer += chunk.toString();
    for (;;) { const end = buffer.indexOf('\n'); if (end < 0) break; const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); let value: any;
      try { value = JSON.parse(line); } catch { fail(); void stop().catch(() => {}); return; }
      const handler = pending.get(value.id); if (!handler) continue; pending.delete(value.id);
      value.error ? handler.reject(Error('NATIVE_CONFIG_REJECTED')) : handler.resolve(value.result);
    }
  });
  const request = (method: string, params: unknown) => new Promise<any>((resolve, reject) => { if (ended) { reject(Error('NATIVE_CONFIG_UNAVAILABLE')); return; } const id = ++sequence; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
  const timer = setTimeout(() => { fail(); void stop().catch(() => {}); }, timeout);
  try { await request('initialize', { clientInfo: { name: 'agent_workbench_native_settings', version: '1' }, capabilities: { experimentalApi: true } }); child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n'); return await operation(request); }
  finally {
    clearTimeout(timer);
    // The metadata response confirms the write is durable. Terminate this owned
    // process tree, including any background native discovery helpers, before
    // releasing the profile; killing only the parent can leave pipes open.
    try { await stop(); } finally { child.stdin.destroy(); child.stdout.destroy(); fail(); }
    await closed;
  }
}
