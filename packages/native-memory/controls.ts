import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { parse } from 'smol-toml';
import { atomicWrite, digest, noLinks, optionalText, samePath, SerialQueue } from '../native-resources/files';
import { LocalCliService, type LocalRuntime } from '../native-runtime/cli';
import { codexConfiguration } from '../native-runtime/process';
import { codexToolMemoryCapability } from '../native-runtime/capabilities';

export interface NativeMemoryControl {
  runtime: LocalRuntime; installed: boolean; enabled: boolean | null; generate: boolean | null; use: boolean | null;
  allowToolChats?: boolean | null; canToggle: boolean; canToggleTools?: boolean; revision: string;
  file: string; source: string; warning?: string; error?: string;
}
interface Snapshot { state: NativeMemoryControl; version?: string; raw?: string; value?: Record<string, any> }
const object = (value: any): Record<string, any> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('NATIVE_MEMORY_INVALID'); return value; };
const bool = (value: unknown, fallback: boolean) => { if (value === undefined || value === null) return fallback; if (typeof value !== 'boolean') throw Error('NATIVE_MEMORY_INVALID'); return value; };
const relevant = (value: any) => ({ memories: value?.memories, feature: value?.features?.memories, autoMemoryEnabled: value?.autoMemoryEnabled, disabled: value?.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY });
export function codexMemoryOverrides(origins: Record<string, { name?: { type?: string } }>) {
  const overridden = (keys: string[]) => Object.entries(origins).some(([key, origin]) => keys.includes(key) && !['user', 'system'].includes(origin.name?.type ?? ''));
  return {
    memory: overridden(['features.memories', 'memories.generate_memories', 'memories.use_memories']),
    tools: overridden(['memories.disable_on_external_context', 'memories.no_memories_if_mcp_or_web_search']),
  };
}

/** The native files remain authoritative. No mirrored enabled flags are stored. */
export class NativeMemoryControls {
  private queue = new SerialQueue();
  private configurationQueue = new SerialQueue();
  constructor(readonly cli: LocalCliService, private projects: () => string[] = () => []) {}
  private get homes() { return { codex: this.cli.env.CODEX_HOME ?? path.join(this.cli.home, '.codex'), claude: this.cli.env.CLAUDE_CONFIG_DIR ?? path.join(this.cli.home, '.claude') }; }
  private file(runtime: LocalRuntime) { return path.join(this.homes[runtime], runtime === 'codex' ? 'config.toml' : 'settings.json'); }
  private environment() {
    const env: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(this.cli.env)) if (['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'PROGRAMDATA'].includes(name.toUpperCase())) env[name] = value;
    return { ...env, HOME: this.cli.home, USERPROFILE: this.cli.home, CODEX_HOME: this.homes.codex, APPDATA: path.join(this.cli.home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(this.cli.home, 'AppData', 'Local'), OTEL_SDK_DISABLED: 'true' };
  }
  private empty(runtime: LocalRuntime, installed: boolean): NativeMemoryControl { return { runtime, installed, enabled: null, generate: null, use: null, canToggle: false, revision: '', file: this.file(runtime), source: 'local-user' }; }
  private async projectFiles(runtime: LocalRuntime, project?: string) {
    if (!project) return [];
    const paths: string[] = []; let current = path.resolve(project);
    for (let i = 0; i < 32; i++) { paths.unshift(current); const parent = path.dirname(current); if (parent === current || samePath(current, this.cli.home)) break; current = parent; }
    const files = paths.flatMap(folder => runtime === 'claude' ? [path.join(folder, '.claude', 'settings.json'), path.join(folder, '.claude', 'settings.local.json')] : [path.join(folder, '.codex', 'config.toml')]);
    return [...new Set(files)].filter(file => !samePath(file, this.file(runtime)));
  }
  private async claudeSnapshot(installed: boolean, project?: string): Promise<Snapshot> {
    const file = this.file('claude'); await noLinks(file); const raw = await optionalText(file), value = raw === undefined ? {} : object(JSON.parse(raw.replace(/^\uFEFF/, '')));
    const sources: { file: string; raw?: string; value: Record<string, any> }[] = [{ file, raw, value }];
    for (const item of await this.projectFiles('claude', project)) { const text = await optionalText(item); if (text !== undefined) sources.push({ file: item, raw: text, value: object(JSON.parse(text.replace(/^\uFEFF/, ''))) }); }
    let managed: string | undefined;
    if (!this.cli.options.isolated) {
      managed = this.cli.platform === 'win32' ? path.join(this.cli.env.ProgramFiles ?? 'C:\\Program Files', 'ClaudeCode', 'managed-settings.json') : this.cli.platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-settings.json' : '/etc/claude-code/managed-settings.json';
      const text = await optionalText(managed); if (text !== undefined) sources.push({ file: managed, raw: text, value: object(JSON.parse(text.replace(/^\uFEFF/, ''))) });
    }
    let enabled = true, source = 'local-user', disabled: unknown = this.cli.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
    for (const layer of sources) {
      if (layer.value.autoMemoryEnabled !== undefined) { enabled = bool(layer.value.autoMemoryEnabled, true); source = samePath(layer.file, file) ? 'local-user' : layer.file === managed ? 'managed' : 'project'; }
      if (layer.value.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY !== undefined) disabled = layer.value.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
    }
    const environmentDisabled = ['1', 'true'].includes(String(disabled).toLowerCase()); if (environmentDisabled) { enabled = false; source = 'environment'; }
    const controlled = source === 'managed' || environmentDisabled;
    return { raw, value, state: { ...this.empty('claude', installed), enabled, generate: enabled, use: enabled, canToggle: installed && !controlled, source, revision: digest(JSON.stringify([sources.map(s => [s.file, s.raw]), disabled])), warning: controlled ? 'NATIVE_MEMORY_OVERRIDDEN' : undefined } };
  }
  private async codexSnapshot(installed: boolean, executable?: string, project?: string, request?: (method: string, params: unknown) => Promise<any>): Promise<Snapshot> {
    if (!installed || !executable) return { state: this.empty('codex', false) };
    const inspect = async (rpc: (method: string, params: unknown) => Promise<any>) => {
      const result = await rpc('config/read', { includeLayers: true, ...(project ? { cwd: project } : {}) });
      const config = object(result.config), layers: any[] = Array.isArray(result.layers) ? result.layers : [];
      const user = layers.find(layer => layer.name?.type === 'user' && typeof layer.name.file === 'string' && samePath(layer.name.file, this.file('codex')));
      if (!user?.version) throw Error('NATIVE_MEMORY_UNAVAILABLE');
      let feature = config.features?.memories;
      if (typeof feature !== 'boolean') {
        let cursor: string | undefined;
        for (let i = 0; i < 8; i++) { const page = await rpc('experimentalFeature/list', { limit: 100, ...(cursor ? { cursor } : {}) }); const memory = page.data?.find((item: any) => item.name === 'memories'); if (memory) { feature = memory.enabled; break; } cursor = page.nextCursor; if (!cursor) break; }
      }
      if (typeof feature !== 'boolean') throw Error('NATIVE_MEMORY_UNAVAILABLE');
      const memory = config.memories ?? {}, generate = feature && bool(memory.generate_memories, true), use = feature && bool(memory.use_memories, true);
      const raw = await optionalText(this.file('codex'));
      // Inspect the installed protocol's typed field; do not write a guessed legacy spelling.
      const known = await codexToolMemoryCapability(executable);
      const allowToolChats = known ? !bool(memory.disable_on_external_context ?? memory.no_memories_if_mcp_or_web_search, false) : null;
      const overrides = codexMemoryOverrides(result.origins ?? {}), anyOverride = overrides.memory || overrides.tools;
      return { version: user.version, raw, state: { ...this.empty('codex', true), enabled: generate && use, generate, use, allowToolChats, canToggle: !overrides.memory, canToggleTools: known && !overrides.tools, source: anyOverride ? 'override' : 'local-user', revision: digest(JSON.stringify([raw, layers.map(layer => [layer.name, layer.version]), relevant(config)])), warning: anyOverride ? 'NATIVE_MEMORY_OVERRIDDEN' : generate !== use ? 'NATIVE_MEMORY_PARTIAL' : undefined } };
    };
    return request ? inspect(request) : this.configurationQueue.run(() => codexConfiguration(executable, this.environment(), this.cli.home, inspect));
  }
  private async snapshot(runtime: LocalRuntime, project?: string): Promise<Snapshot> {
    const found = await this.cli.locate(runtime);
    return runtime === 'claude' ? this.claudeSnapshot(!!found, project) : this.codexSnapshot(!!found, found?.executable, project);
  }
  async list(): Promise<NativeMemoryControl[]> {
    return Promise.all((['codex', 'claude'] as const).map(async runtime => {
      try { const { state } = await this.snapshot(runtime); if (!state.warning) for (const project of this.projects()) for (const file of await this.projectFiles(runtime, project)) { const raw = await optionalText(file); if (!raw) continue; const value = runtime === 'claude' ? JSON.parse(raw.replace(/^\uFEFF/, '')) : parse(raw); if (Object.values(relevant(value)).some(v => v !== undefined)) state.warning = 'NATIVE_MEMORY_PROJECT_SETTINGS'; } return state; }
      catch { return { ...this.empty(runtime, !!await this.cli.locate(runtime)), error: 'NATIVE_MEMORY_UNAVAILABLE' }; }
    }));
  }
  async canReceive(runtime: LocalRuntime, project?: string) {
    try { const { state } = await this.snapshot(runtime, project); return state.installed && state.enabled === true; } catch { return false; }
  }
  async write(runtime: LocalRuntime, revision: string, setting: 'enabled' | 'allowToolChats', enabled: boolean) {
    return this.queue.run(async () => {
      if (runtime === 'claude' && setting !== 'enabled') throw Error('NATIVE_MEMORY_SETTING_INVALID');
      const initial = await this.snapshot(runtime);
      if (setting === 'allowToolChats' ? !initial.state.canToggleTools : !initial.state.canToggle) throw Error('NATIVE_MEMORY_OVERRIDDEN');
      if (!revision || initial.state.revision !== revision) throw Error('NATIVE_MEMORY_CONFLICT');
      const file = this.file(runtime); await noLinks(file);
      if (runtime === 'claude') {
        const value = { ...initial.value, autoMemoryEnabled: enabled };
        if ((await this.snapshot(runtime)).state.revision !== revision) throw Error('NATIVE_MEMORY_CONFLICT');
        await atomicWrite(file, JSON.stringify(value, null, 2) + '\n', async () => { if ((await this.snapshot(runtime)).state.revision !== revision) throw Error('NATIVE_MEMORY_CONFLICT'); });
      } else {
        const executable = (await this.cli.locate('codex'))!.executable; await mkdir(this.homes.codex, { recursive: true });
        await this.configurationQueue.run(() => codexConfiguration(executable, this.environment(), this.cli.home, async request => {
          const before = await this.codexSnapshot(true, executable, undefined, request);
          if (before.state.revision !== revision) throw Error('NATIVE_MEMORY_CONFLICT');
          const entries = setting === 'enabled' ? [{ keyPath: 'features.memories', value: enabled }, { keyPath: 'memories.generate_memories', value: enabled }, { keyPath: 'memories.use_memories', value: enabled }] : [{ keyPath: 'memories.disable_on_external_context', value: !enabled }, { keyPath: 'memories.no_memories_if_mcp_or_web_search', value: null }];
          const result = await request('config/batchWrite', { filePath: file, expectedVersion: before.version, edits: entries.map(edit => ({ ...edit, mergeStrategy: 'replace' })) });
          if (result.status !== 'ok') throw Error('NATIVE_MEMORY_OVERRIDDEN');
        }));
      }
      const after = await this.snapshot(runtime); if ((setting === 'enabled' ? after.state.enabled : after.state.allowToolChats) !== enabled) throw Error('NATIVE_MEMORY_VERIFY_FAILED');
      return this.list();
    });
  }
}
