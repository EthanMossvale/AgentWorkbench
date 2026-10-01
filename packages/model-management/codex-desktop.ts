import path from 'node:path';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { runCommand, type RunCommand } from '../native-runtime/process';
import { noLinks } from '../native-resources/files';
import type { LoginHandle } from './native';
import type { LocalModelAccount, AccountLogin } from './types';

export interface CodexDesktopInstallation { executable: string; packageFamily: string; appId: string }
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const powershell = (env: NodeJS.ProcessEnv) => path.join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
/** Windows registered package discovery reads installation metadata, never a user profile. */
export async function detectCodexDesktop(env: NodeJS.ProcessEnv, run: RunCommand = runCommand): Promise<CodexDesktopInstallation | undefined> {
  if (process.platform !== 'win32') return;
  const script = `$ErrorActionPreference='Stop'; $p=Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1; if($p){ $m=Get-AppxPackageManifest -Package $p; $a=@($m.Package.Applications.Application | Where-Object { $_.Executable -match '(ChatGPT|Codex)\\.exe$' }); if($a.Count -eq 1){ @{executable=(Join-Path $p.InstallLocation $a[0].Executable);packageFamily=$p.PackageFamilyName;appId=$a[0].Id} | ConvertTo-Json -Compress } }`;
  try {
    const raw = await run({ executable: powershell(env), args: ['-NoProfile','-NonInteractive','-Command',script] }, { cwd: env.TEMP ?? process.cwd(), env, timeout: 10000 });
    if (!raw.trim()) return; const value = JSON.parse(raw.trim());
    if (typeof value.executable !== 'string' || !path.isAbsolute(value.executable) || !/^OpenAI\.Codex_/.test(value.packageFamily) || !/^[\w.-]+$/.test(value.appId) || !(await stat(value.executable)).isFile()) return;
    return value;
  } catch { return; }
}
export interface DesktopLoginOptions { detect?(env: NodeJS.ProcessEnv): Promise<CodexDesktopInstallation | undefined>; run?: RunCommand; pollMs?: number }
/** Owns one new package process and one unique Electron directory, never the running default app. */
export async function startCodexDesktopLogin(account: LocalModelAccount, home: string, env: NodeJS.ProcessEnv, changed: (job: AccountLogin) => void, options: DesktopLoginOptions = {}): Promise<LoginHandle> {
  const installation = await (options.detect ?? detectCodexDesktop)(env); if (!installation) throw Error('LOCAL_ACCOUNT_DESKTOP_MISSING');
  const run = options.run ?? runCommand, id = randomUUID(), folder = path.join(path.dirname(home), 'desktop-login-' + id), pidFile = path.join(folder, 'owned-process.json');
  await noLinks(folder); await mkdir(folder, { recursive: true, mode: 0o700 });
  const config = path.join(home,'config.toml'); await noLinks(config);
  try { const file = await open(config,'wx',0o600); try { await file.writeFile('cli_auth_credentials_store = "file"\ncheck_for_update_on_startup = false\n'); } finally { await file.close(); } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const job: AccountLogin = { id, accountId: account.id, method: 'desktop', status: 'waiting', expiresAt: new Date(Date.now()+600000).toISOString() };
  let pid: number | undefined, ended = false, timer: ReturnType<typeof setTimeout> | undefined, stopping: Promise<void> | undefined;
  const ps = (script: string) => run({ executable: powershell(env), args: ['-NoProfile','-NonInteractive','-Command',script] }, { env, cwd: folder, timeout: 15000 });
  const cleanup = () => stopping ??= (async () => {
    clearTimeout(timer);
    if (pid) await ps(`$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){ if($p.ExecutablePath -ine ${quote(installation.executable)} -or -not $p.CommandLine.Contains(${quote('--user-data-dir='+folder)})){ throw 'Owned desktop identity changed' }; & "$env:SystemRoot\\System32\\taskkill.exe" /PID ${pid} /T /F | Out-Null; if($LASTEXITCODE -ne 0){throw 'Owned desktop did not stop'} }`);
    await noLinks(folder); await rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  })();
  const finish = async (status: AccountLogin['status'], error?: string) => {
    if (ended) return; ended = true; clearTimeout(timer);
    try { await cleanup(); job.status = status; job.error = error; } catch { job.status = 'failed'; job.error = 'LOCAL_ACCOUNT_DESKTOP_CLEANUP_FAILED'; }
    changed({...job});
  };
  try {
    // Package identity is required by Store builds. The inner process receives the
    // isolated paths explicitly because package activation need not inherit env.
    const inner = `$ErrorActionPreference='Stop'; Get-ChildItem Env: | Where-Object { $_.Name -match '^(OPENAI_|ANTHROPIC_|CLAUDE_CODE_|CODEX_|AWB_PROVIDER_TOKEN|ELECTRON_RUN_AS_NODE|NODE_OPTIONS)' } | Remove-Item; $env:CODEX_HOME=${quote(home)}; $env:CODEX_ELECTRON_USER_DATA_PATH=${quote(folder)}; $p=Start-Process -FilePath ${quote(installation.executable)} -ArgumentList ${quote('"--user-data-dir='+folder+'"')} -PassThru; @{pid=$p.Id} | ConvertTo-Json -Compress | Set-Content -LiteralPath ${quote(pidFile)} -Encoding UTF8`;
    const script = `$ErrorActionPreference='Stop'; $p=Get-AppxPackage -Name OpenAI.Codex | Where-Object {$_.PackageFamilyName -eq ${quote(installation.packageFamily)}}; if(-not $p){throw 'Desktop registration changed'}; $a=@((Get-AppxPackageManifest -Package $p).Package.Applications.Application | Where-Object {$_.Id -eq ${quote(installation.appId)} -and (Join-Path $p.InstallLocation $_.Executable) -eq ${quote(installation.executable)}}); if($a.Count -ne 1){throw 'Desktop registration changed'}; Invoke-CommandInDesktopPackage -PackageFamilyName ${quote(installation.packageFamily)} -AppId ${quote(installation.appId)} -PreventBreakaway -Command ${quote(powershell(env))} -Args ${quote('-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+Buffer.from(inner,'utf16le').toString('base64'))}`;
    await ps(script);
    for (let attempt=0;attempt<100;attempt++) { try { await noLinks(pidFile); const record=JSON.parse((await readFile(pidFile,'utf8')).replace(/^\uFEFF/,'')); if(Number.isSafeInteger(record.pid)&&record.pid>0)pid=record.pid; } catch { /* Wait only for this owned launch record. */ } if(pid)break;await pause(100); }
    if (!pid) throw Error('LOCAL_ACCOUNT_DESKTOP_START_FAILED');
    const poll = async () => {
      if (ended) return;
      if (Date.parse(job.expiresAt) <= Date.now()) { await finish('failed','LOCAL_ACCOUNT_LOGIN_EXPIRED'); return; }
      try { const auth = path.join(home,'auth.json'); await noLinks(auth); if ((await stat(auth)).isFile()) { await finish('verifying'); return; } } catch { /* No native credential yet. */ }
      try { if ((await ps(`if(Get-Process -Id ${pid} -ErrorAction SilentlyContinue){'running'}else{'closed'}`)).trim() !== 'running') { await finish('failed','LOCAL_ACCOUNT_DESKTOP_CLOSED'); return; } } catch { await finish('failed','LOCAL_ACCOUNT_DESKTOP_STATUS_FAILED'); return; }
      timer = setTimeout(()=>void poll(),options.pollMs??1000);
    };
    timer = setTimeout(()=>void poll(),options.pollMs??1000);
    return { job, cancel: async()=>{await finish('cancelled');if(job.error==='LOCAL_ACCOUNT_DESKTOP_CLEANUP_FAILED')throw Error(job.error);} };
  } catch { await finish('failed','LOCAL_ACCOUNT_DESKTOP_START_FAILED'); throw Error(job.error??'LOCAL_ACCOUNT_DESKTOP_START_FAILED'); }
}
