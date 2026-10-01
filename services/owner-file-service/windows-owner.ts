import { spawn } from 'node:child_process';
import path from 'node:path';
import { buildSshEnvironment } from '../../packages/ssh-transport/index';
import type { OwnerVerifier } from './index';

/** Read-only single-path ACL owner check. Runs as the host identity, never a renderer-supplied SID. */
export const verifyCurrentWindowsOwner: OwnerVerifier = async (resolvedPath) => {
  if (process.platform !== 'win32' || !path.isAbsolute(resolvedPath) || /[\0\r\n]/.test(resolvedPath)) return false;
  const script = `$ErrorActionPreference='Stop'; $target=[Console]::In.ReadToEnd(); $owner=(Get-Acl -LiteralPath $target).GetOwner([System.Security.Principal.SecurityIdentifier]).Value; $current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if ($owner -eq $current) { [Console]::Out.Write('owned') } else { [Console]::Out.Write('other-owner') }`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise<boolean>((resolve) => {
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: buildSshEnvironment() });
    let output = '', bytes = 0, failed = false;
    const timer = setTimeout(() => { failed = true; child.kill(); }, 5000);
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024) { failed = true; child.kill(); } else output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024) { failed = true; child.kill(); } });
    child.stdin.on('error', () => { failed = true; });
    child.on('error', () => { failed = true; });
    child.on('close', code => { clearTimeout(timer); resolve(!failed && code === 0 && output === 'owned'); });
    child.stdin.end(resolvedPath);
  });
};
