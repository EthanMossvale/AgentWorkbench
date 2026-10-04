import path from 'node:path';
import os from 'node:os';
import { lstat, stat, realpath } from 'node:fs/promises';
import { atomicWrite, digest, noLinks, readJson, samePath, SerialQueue } from '../native-resources/files';
import { cliFailureDetail, runCommand, type Command, type RunCommand } from './process';
import { codexWindowsInstall, codexWindowsRemoval } from './native-install';

export type LocalRuntime = 'codex' | 'claude';
export type InstallMethod = 'native' | 'npm';
export interface CliInstallMethod { method: InstallMethod; available: boolean; command?: string }
export interface LocalCli {
  runtime: LocalRuntime; installed: boolean; executable?: string; version?: string; source?: 'npm' | 'native' | 'path';
  latest?: string; channel: 'latest' | 'stable'; checkedAt?: string; updateAvailable: boolean; autoUpdate: boolean;
  busy: boolean; canInstall: boolean; canUpdate: boolean; canUninstall: boolean; revision: string; command?: string; error?: string;
  installMethods: CliInstallMethod[]; checkedMethod?: InstallMethod; installDirectory?:string;
}
interface Preferences { version: 1; autoUpdate: Record<LocalRuntime, boolean>; lastAttempt: Partial<Record<LocalRuntime, number>>; codexInstallDirectory?:string }
export interface CliOptions {
  home?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; executables?: Partial<Record<LocalRuntime, string>>;
  run?: RunCommand; fetcher?: typeof fetch; idle?: () => boolean; isolated?: boolean;
}
const providers: LocalRuntime[] = ['codex', 'claude'];
const versionPattern = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
export function newerVersion(next: string, current: string) {
  if (!versionPattern.test(next) || !versionPattern.test(current)) return false;
  const a = next.split(/[.-]/).slice(0, 3).map(Number), b = current.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return !next.includes('-') && current.includes('-');
}
const exists = async (file: string) => { try { return (await stat(file)).isFile(); } catch { return false; } };
const quotePs = (value: string) => "'" + value.replaceAll("'", "''") + "'";

/** Manages installed local CLIs, never the pinned remote execution bridge or login data. */
export class LocalCliService {
  readonly home: string; readonly env: NodeJS.ProcessEnv; readonly platform: NodeJS.Platform;
  private file: string; private queue = new SerialQueue(); private timer?: ReturnType<typeof setInterval>;
  private preferences: Preferences = { version: 1, autoUpdate: { codex: false, claude: false }, lastAttempt: {} };
  private versions = new Map<string, Promise<string>>(); private catalog: Partial<Record<LocalRuntime, Pick<LocalCli, 'latest' | 'checkedAt' | 'channel' | 'checkedMethod'>>> = {};
  private busy = new Set<LocalRuntime>(); private errors: Partial<Record<LocalRuntime, string>> = {}; private closed = false;
  private processUnknown = new Set<LocalRuntime>(); private checking = new Set<LocalRuntime>(); private operations = new Set<Promise<unknown>>();
  constructor(directory: string, readonly options: CliOptions = {}) {
    this.home = options.home ?? os.homedir(); this.env = { ...(options.env ?? (options.isolated ? { ...process.env, HOME: this.home, USERPROFILE: this.home, CODEX_HOME: path.join(this.home, '.codex'), CLAUDE_CONFIG_DIR: path.join(this.home, '.claude') } : process.env)) }; this.platform = options.platform ?? process.platform; this.file = path.join(directory, 'local-cli.json');
  }
  async initialize() {
    this.preferences = await readJson(this.file, this.preferences);
    if (this.preferences.version !== 1 || providers.some(p => typeof this.preferences.autoUpdate?.[p] !== 'boolean')) throw Error('CLI_PREFERENCES_INVALID');
    if(this.preferences.codexInstallDirectory!==undefined&&(!path.isAbsolute(this.preferences.codexInstallDirectory)||this.preferences.codexInstallDirectory.includes('\0')))throw Error('CLI_PREFERENCES_INVALID');
    if (!this.preferences.lastAttempt || typeof this.preferences.lastAttempt !== 'object' || Array.isArray(this.preferences.lastAttempt) || Object.values(this.preferences.lastAttempt).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw Error('CLI_PREFERENCES_INVALID');
    this.timer = setInterval(() => { if (!this.closed) void this.automatic().catch(() => {}); }, 60000); this.timer.unref();
  }
  private async save() { await atomicWrite(this.file, JSON.stringify(this.preferences, null, 2)); }
  private codexEnvironment(found?:{executable:string}):NodeJS.ProcessEnv{
    const selected=this.preferences.codexInstallDirectory;
    // CODEX_HOME here is installer storage only. Runtime/login/resource callers
    // keep this.env, so choosing a program drive never changes native identity.
    return selected&&(!found||samePath(found.executable,path.join(selected,'bin','codex.exe')))?{...this.env,CODEX_HOME:path.join(selected,'home'),CODEX_INSTALL_DIR:path.join(selected,'bin')}:{...this.env};
  }
  async setCodexInstallDirectory(directory:string){
    if(this.platform!=='win32'||!path.isAbsolute(directory)||!(/^[A-Za-z]:\\/.test(directory))||directory.includes('\0')||path.resolve(directory)===path.parse(directory).root)throw Error('CLI_INSTALL_DIRECTORY_INVALID');
    return this.maintain('codex',()=>this.queue.run(async()=>{
      await noLinks(directory);
      if(await this.locate('codex'))throw Error('CLI_INSTALL_STATE_CHANGED');
      const previous=this.preferences.codexInstallDirectory;
      this.preferences.codexInstallDirectory=path.resolve(directory);
      try{await this.save();}catch(error){this.preferences.codexInstallDirectory=previous;throw error;}
    }));
  }
  isMaintaining() { return this.busy.size > 0; }
  async withNativeOperation<T>(runtime: LocalRuntime, operation: () => Promise<T>): Promise<T> { let value: T; await this.maintain(runtime, async () => { value = await operation(); }); return value!; }
  private async rememberAttempt(runtime: LocalRuntime) { await this.queue.run(async () => { this.preferences.lastAttempt[runtime] = Date.now(); await this.save(); }); }
  private pathCandidates(name: string) {
    // A copied Windows environment is an ordinary case-sensitive object; unlike
    // process.env, its usual `Path` key cannot be read as `PATH`.
    const searchPath = this.env.PATH ?? (this.platform === 'win32' ? Object.entries(this.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] : undefined);
    return this.options.isolated ? [] : (searchPath ?? '').split(this.platform === 'win32' ? ';' : ':').filter(Boolean).map(folder => path.join(folder.replace(/^"|"$/g, ''), name));
  }
  async locate(runtime: LocalRuntime): Promise<{ executable: string; source: LocalCli['source'] } | undefined> {
    if (this.options.executables?.[runtime]) return await exists(this.options.executables[runtime]!) ? { executable: this.options.executables[runtime]!, source: 'native' } : undefined;
    const windows = this.platform === 'win32', native = runtime === 'codex' && windows ? codexWindowsInstall(this.home, this.preferences.codexInstallDirectory?{...this.env,CODEX_HOME:path.join(this.preferences.codexInstallDirectory,'home'),CODEX_INSTALL_DIR:path.join(this.preferences.codexInstallDirectory,'bin')}:this.env).executable : path.join(this.home, '.local', 'bin', runtime + (windows ? '.exe' : ''));
    // Keep the official launcher path visible; the versioned target is used by revisions.
    if (await exists(native)) return { executable: native, source: 'native' };
    if(runtime==='codex'&&windows&&this.preferences.codexInstallDirectory){
      const original=codexWindowsInstall(this.home,this.env).executable;
      if(await exists(original))return {executable:original,source:'native'};
    }
    if (windows) {
      const roots = [path.join(this.env.APPDATA || path.join(this.home, 'AppData/Roaming'), 'npm'), ...this.pathCandidates(runtime + '.cmd').map(p => path.dirname(p))];
      for (const root of new Set(roots)) {
        if (runtime === 'claude') { const file = path.join(root, 'node_modules/@anthropic-ai/claude-code/bin/claude.exe'); if (await exists(file)) return { executable: file, source: 'npm' }; }
        else for (const arch of ['x86_64', 'aarch64']) {
          const suffix = arch === 'x86_64' ? 'x64' : 'arm64';
          const packageRoot = path.join(root, 'node_modules', '@openai', 'codex');
          const vendors = [path.join(packageRoot, 'node_modules', '@openai', 'codex-win32-' + suffix, 'vendor'), path.join(root, 'node_modules', '@openai', 'codex-win32-' + suffix, 'vendor'), path.join(packageRoot, 'vendor')];
          for (const vendor of vendors) for (const directory of ['bin', 'codex']) {
            const file = path.join(vendor, arch + '-pc-windows-msvc', directory, 'codex.exe');
            if (await exists(file)) return { executable: file, source: 'npm' };
          }
        }
      }
    }
    for (const candidate of this.pathCandidates(runtime + (windows ? '.exe' : ''))) if (await exists(candidate)) { try { return { executable: await realpath(candidate), source: 'path' }; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    return undefined;
  }
  private async npm() { return this.options.isolated && this.options.run ? 'npm.cmd' : (await Promise.all(this.pathCandidates('npm.cmd').map(async p => await exists(p) ? p : undefined))).find(Boolean); }
  private async revision(found?: Awaited<ReturnType<LocalCliService['locate']>>) {
    if (!found) return '';
    const info = await stat(found.executable);
    return digest(JSON.stringify([await realpath(found.executable), found.source, info.size, info.mtimeMs, info.ino]));
  }
  private async removable(runtime: LocalRuntime, found?: Awaited<ReturnType<LocalCliService['locate']>>) {
    if (!found || this.platform !== 'win32' || (this.options.isolated && !this.options.run)) return false;
    if (found.source === 'npm') return !!await this.npm();
    if (runtime === 'codex') { try { await codexWindowsRemoval(this.home, this.codexEnvironment(found), found.executable); return found.source === 'native'; } catch { return false; } }
    return found.source === 'native' && samePath(found.executable, path.join(this.home, '.local', 'bin', 'claude.exe'));
  }
  private async nativeVersion(executable: string) {
    const info = await stat(executable), key = `${await realpath(executable)}:${info.size}:${info.mtimeMs}`;
    let result = this.versions.get(key);
    // A freshly installed 250 MB binary can take tens of seconds on its first, antivirus-scanned launch.
    if (!result) { result = (this.options.run ?? runCommand)({ executable, args: ['--version'] }, { cwd: this.home, env: this.env, timeout: 60000 }).then(text => { const match = text.match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/); if (!match) throw Error(`CLI_VERSION_UNVERIFIED\n${cliFailureDetail(text) || '--version printed no version.'}`); return match[0]; }, error => { throw Error(`CLI_VERSION_UNVERIFIED\n${(error as Error).message}`); }); this.versions.set(key, result); }
    try { return await result; } catch (error) { this.versions.delete(key); throw error; }
  }
  private async command(runtime: LocalRuntime, update: boolean, found?: Awaited<ReturnType<LocalCliService['locate']>>, method: InstallMethod = 'native'): Promise<{ spec: Command; label: string } | undefined> {
    if (this.options.isolated && !this.options.run) return undefined;
    if (update) { if (found?.source !== 'native' && found?.source !== 'npm') return undefined; method = found.source; }
    if (runtime === 'claude' && update && found && found.source === 'native') return { spec: { executable: found.executable, args: ['update'] }, label: 'claude update' };
    if (this.platform === 'win32') {
      const powershell = path.join(this.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      if (method === 'native') {
        const label = runtime === 'codex' ? 'irm https://chatgpt.com/codex/install.ps1 | iex' : 'irm https://claude.ai/install.ps1 | iex';
        return { spec: { executable: powershell, args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', "$ErrorActionPreference='Stop'; " + label] }, label };
      }
      const npm = await this.npm();
      if (!npm) return undefined;
      const pkg = runtime === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code';
      return { spec: { executable: powershell, args: ['-NoProfile', '-NonInteractive', '-Command', `& ${quotePs(npm)} install -g '${pkg}@latest'; exit $LASTEXITCODE`] }, label: `npm install -g ${pkg}@latest` };
    }
    if (method !== 'native') return undefined;
    const command = runtime === 'codex' ? 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' : 'curl -fsSL https://claude.ai/install.sh | bash';
    return { spec: { executable: '/bin/bash', args: ['-o', 'pipefail', '-c', command] }, label: command };
  }
  async list(): Promise<LocalCli[]> {
    return Promise.all(providers.map(async runtime => {
      const found = await this.locate(runtime); let version: string | undefined, error = this.errors[runtime];
      if (found) try { version = await this.nativeVersion(found.executable); } catch (failure) { error = (failure as Error).message; }
      const command = await this.command(runtime, !!found, found), catalog = this.catalog[runtime];
      const installMethods = await Promise.all((['native', 'npm'] as const).map(async method => { const value = await this.command(runtime, false, undefined, method); return { method, available: !!value, command: value?.label }; }));
      const revision = await this.revision(found).catch(() => '');
      return { runtime, installed: !!found, ...found, version, channel: catalog?.channel ?? 'latest', ...catalog, installMethods, installDirectory:runtime==='codex'?this.preferences.codexInstallDirectory:undefined, updateAvailable: !!(version && catalog?.latest && (!catalog.checkedMethod || catalog.checkedMethod === found?.source) && newerVersion(catalog.latest, version)), autoUpdate: this.preferences.autoUpdate[runtime], busy: this.busy.has(runtime), canInstall: !found ? !!command : (found.source === 'path' || found.source === 'native' && !version) && installMethods.some(item => item.method === 'native' && item.available), canUpdate: !!found && !!command && !!version && !!revision, canUninstall: !!revision && await this.removable(runtime, found), revision, command: command?.label, error: error ?? (!found && !command ? 'CLI_INSTALL_PREREQUISITE' : undefined) };
    }));
  }
  async check(runtime: LocalRuntime, requestedMethod: InstallMethod = 'native') {
    const found = await this.locate(runtime), method = found?.source === 'npm' ? 'npm' : found?.source === 'native' ? 'native' : requestedMethod;
    const channel = runtime === 'claude' && method === 'native' ? (await readJson<{ autoUpdatesChannel?: string }>(path.join(this.env.CLAUDE_CONFIG_DIR ?? path.join(this.home, '.claude'), 'settings.json'), {}).catch(() => ({} as { autoUpdatesChannel?: string }))).autoUpdatesChannel === 'stable' ? 'stable' : 'latest' : 'latest';
    const url = method === 'npm' ? `https://registry.npmjs.org/${runtime === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code'}/latest` : runtime === 'codex' ? 'https://releases.openai.com/codex/channels/latest' : `https://downloads.claude.ai/claude-code-releases/${channel}`;
    try {
      const response = await (this.options.fetcher ?? fetch)(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw Error('CLI_UPDATE_CHECK_FAILED');
      const text = await response.text(); if (text.length > 2 * 1024 * 1024) throw Error('CLI_UPDATE_CHECK_FAILED');
      const latest = method === 'npm' ? JSON.parse(text).version : runtime === 'codex' ? String(JSON.parse(text).tag_name ?? '').replace(/^rust-v/, '') : text.trim();
      if (typeof latest !== 'string' || !versionPattern.test(latest)) throw Error('CLI_UPDATE_CHECK_FAILED');
      this.catalog[runtime] = { latest, channel, checkedAt: new Date().toISOString(), checkedMethod: method }; delete this.errors[runtime];
    } catch { this.errors[runtime] = 'CLI_UPDATE_CHECK_FAILED'; }
    return this.list();
  }
  async configure(runtime: LocalRuntime, enabled: boolean) { return this.queue.run(async () => { this.preferences.autoUpdate[runtime] = enabled; await this.save(); return this.list(); }); }
  async install(runtime: LocalRuntime, update = false, automatic = false, requestedMethod?: InstallMethod) {
    return this.maintain(runtime, async () => {
      if (automatic && !this.preferences.autoUpdate[runtime]) return this.list();
      if (this.closed || this.options.idle?.() === false) throw Error('CLI_TASKS_ACTIVE');
      const found = await this.locate(runtime);
      // Only an explicit native installation may coexist with an unowned PATH
      // binary. Updating or automatically replacing that binary stays forbidden.
      const separate = !update && !automatic && requestedMethod === 'native' && found?.source === 'path';
      // A native install whose version cannot be read is repaired by rerunning the official installer.
      const repair = !update && !automatic && requestedMethod === 'native' && found?.source === 'native' && !await this.nativeVersion(found.executable).then(() => true, () => false);
      if (update !== !!found && !separate && !repair) throw Error('CLI_INSTALL_STATE_CHANGED');
      if (requestedMethod !== undefined && requestedMethod !== 'native' && requestedMethod !== 'npm') throw Error('CLI_INSTALL_METHOD_INVALID');
      if (update && requestedMethod && requestedMethod !== found?.source) throw Error('CLI_INSTALL_STATE_CHANGED');
      const method = update && found?.source === 'npm' ? 'npm' : update ? 'native' : requestedMethod ?? 'native';
      const command = await this.command(runtime, update, found, method); if (!command) throw Error('CLI_INSTALL_PREREQUISITE');
      await this.rememberAttempt(runtime);
      if (automatic && !this.preferences.autoUpdate[runtime]) return;
      if (this.closed || this.options.idle?.() === false) throw Error('CLI_TASKS_ACTIVE');
      const env = runtime==='codex'&&method==='native'?this.codexEnvironment(separate?undefined:found):{ ...this.env };
      if (runtime === 'codex' && method === 'native') {
        for (const name of ['CODEX_INSTALL_DAEMON_ONLY', 'CODEX_INSTALL_DEFER_SELECTION', 'CODEX_INSTALL_IF_LATEST', 'CODEX_INSTALL_IF_CURRENT', 'CODEX_UPDATE_FROM_RELEASE']) delete env[name];
        env.CODEX_RELEASE = 'latest'; env.CODEX_NON_INTERACTIVE = '1';
      }
      await (this.options.run ?? runCommand)(command.spec, { cwd: this.home, env, timeout: 10 * 60000 }); this.versions.clear();
      const after = await this.locate(runtime); if (!after || after.source !== method) throw Error('CLI_INSTALL_NOT_DISCOVERED');
      const version = await this.nativeVersion(after.executable); if (update && this.catalog[runtime]?.checkedMethod === method && this.catalog[runtime]?.latest && newerVersion(this.catalog[runtime]!.latest!, version)) throw Error('CLI_UPDATE_NOT_APPLIED');
    });
  }
  async uninstall(runtime: LocalRuntime, revision: string) {
    return this.maintain(runtime, async () => {
      const found = await this.locate(runtime);
      if (!found || !revision || revision !== await this.revision(found)) throw Error('CLI_INSTALL_STATE_CHANGED');
      if (!await this.removable(runtime, found)) throw Error('CLI_UNINSTALL_UNSUPPORTED');
      const powershell = path.join(this.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      let script: string;
      if (found.source === 'npm') {
        const npm = (await this.npm())!;
        const prefix = (await (this.options.run ?? runCommand)({ executable: powershell, args: ['-NoProfile', '-NonInteractive', '-Command', `& ${quotePs(npm)} prefix -g; exit $LASTEXITCODE`] }, { cwd: this.home, env: this.env, timeout: 15000 })).trim();
        const pkg = runtime === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code';
        const ownedRoots = [path.join(prefix, 'node_modules', pkg), ...(runtime === 'codex' ? ['x64', 'arm64'].map(arch => path.join(prefix, 'node_modules', '@openai', 'codex-win32-' + arch)) : [])];
        if (!path.isAbsolute(prefix) || !ownedRoots.some(root => { const relative = path.relative(root, found.executable); return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative); })) throw Error('CLI_UNINSTALL_UNSUPPORTED');
        script = `& ${quotePs(npm)} uninstall -g '${pkg}'; exit $LASTEXITCODE`;
      } else if (runtime === 'codex') script = await codexWindowsRemoval(this.home, this.codexEnvironment(found), found.executable, true);
      else {
        const binary = path.join(this.home, '.local', 'bin', 'claude.exe'), versions = path.join(this.home, '.local', 'share', 'claude');
        // Unlinking the official launcher's hard link is safe; never follow a
        // linked parent directory or a substituted version-store junction.
        await noLinks(path.dirname(binary)); await noLinks(versions);
        if ((await lstat(binary)).isSymbolicLink()) throw Error('CLI_UNINSTALL_UNSUPPORTED');
        script = `$ErrorActionPreference='Stop'; Remove-Item -LiteralPath ${quotePs(binary)} -Force; if (Test-Path -LiteralPath ${quotePs(versions)}) { Remove-Item -LiteralPath ${quotePs(versions)} -Recurse -Force }`;
      }
      if (revision !== await this.revision(await this.locate(runtime))) throw Error('CLI_INSTALL_STATE_CHANGED');
      if (this.closed || this.options.idle?.() === false) throw Error('CLI_TASKS_ACTIVE');
      await (this.options.run ?? runCommand)({ executable: powershell, args: ['-NoProfile', '-NonInteractive', '-Command', script] }, { cwd: this.home, env: this.env, timeout: 10 * 60000 }); this.versions.clear();
      const after = await this.locate(runtime);
      if (after && samePath(after.executable, found.executable)) throw Error('CLI_UNINSTALL_NOT_APPLIED');
      if (after) this.errors[runtime] = 'CLI_OTHER_INSTALLATION_REMAINS';
    });
  }
  private async maintain(runtime: LocalRuntime, operation: () => Promise<unknown>) {
    if (this.busy.has(runtime)) throw Error('CLI_RUNTIME_BUSY');
    if (this.processUnknown.has(runtime)) throw Error('CLI_PROCESS_STATE_UNKNOWN');
    if (this.closed || this.options.idle?.() === false) throw Error('CLI_TASKS_ACTIVE');
    this.busy.add(runtime); delete this.errors[runtime];
    const pending = operation(); this.operations.add(pending);
    try { await pending; }
    catch (error) { this.errors[runtime] = (error as Error).message; if (this.errors[runtime] === 'CLI_PROCESS_STATE_UNKNOWN') this.processUnknown.add(runtime); throw error; }
    finally { this.busy.delete(runtime); this.operations.delete(pending); }
    return this.list();
  }
  private async automatic() {
    if (this.closed || this.options.isolated || this.options.idle?.() === false) return;
    await Promise.all(providers.map(async runtime => {
      if (this.busy.has(runtime) || this.checking.has(runtime) || this.processUnknown.has(runtime) || !this.preferences.autoUpdate[runtime] || Date.now() - (this.preferences.lastAttempt[runtime] ?? 0) < 24 * 3600000) return;
      this.checking.add(runtime);
      try {
      await this.rememberAttempt(runtime);
      const status = (await this.check(runtime)).find(item => item.runtime === runtime)!;
      if (!this.closed && status.installed && status.updateAvailable && status.canUpdate && this.preferences.autoUpdate[runtime] && this.options.idle?.() !== false) await this.install(runtime, true, true).catch(() => {});
      } finally { this.checking.delete(runtime); }
    }));
  }
  async dispose() { this.closed = true; if (this.timer) clearInterval(this.timer); await Promise.allSettled([...this.operations]); await this.queue.idle(); }
}
