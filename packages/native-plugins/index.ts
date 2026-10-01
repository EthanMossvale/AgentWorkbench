import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import { atomicWrite, digest, noLinks, optionalText, readJson, samePath, SerialQueue } from '../native-resources/files';
import { LocalCliService, type LocalRuntime } from '../native-runtime/cli';
import { codexConfiguration, runCommand, type RunCommand } from '../native-runtime/process';
import { NativeSkillControls } from '../native-skills/controls';
import type { NativeSkill, SkillOrigin } from '../native-skills';

export interface NativePlugin {
  id: string; runtime: LocalRuntime; nativeId: string; name: string; description: string; marketplace: string;
  installed: boolean; enabled: boolean; version?: string; scope: string; directory?: string; revision: string;
  canInstall: boolean; canToggle: boolean; detail?: string; needsMarketplace?: boolean;
}
export interface NativePluginScan { plugins: NativePlugin[]; errors: { runtime: LocalRuntime; message: string }[] }
interface RecordInternal { view: NativePlugin; origin?: SkillOrigin; marketplacePath?: string; raw?: string }
interface Options { projects?: () => string[]; run?: RunCommand; rpc?: (method: string, params: unknown) => Promise<any>; fetcher?: typeof fetch }
const officialMarket = 'claude-plugins-official';
const officialRepo = 'anthropics/claude-plugins-official';
const catalogUrl = 'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json';
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:-]+@[a-zA-Z0-9_.-]+$/.test(value);
const plain = (value: unknown): Record<string, any> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('NATIVE_PLUGIN_INVALID'); return value as Record<string, any>; };

/** Native plugin packages stay in their provider's own installation and settings.
 * This service never loads a plugin's code into the workbench extension host. */
export class NativePluginsService {
  private queues = { codex: new SerialQueue(), claude: new SerialQueue() };
  private official?: { entries: any[]; checked: number };
  private warnings = new Map<LocalRuntime, string>();
  constructor(private cli: LocalCliService, private options: Options = {}) {}
  private get homes() { return { codex: this.cli.env.CODEX_HOME ?? path.join(this.cli.home, '.codex'), claude: this.cli.env.CLAUDE_CONFIG_DIR ?? path.join(this.cli.home, '.claude') }; }
  private env(runtime: LocalRuntime) {
    const source = this.cli.options.isolated ? Object.fromEntries(Object.entries(this.cli.env).filter(([key]) => ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT'].includes(key.toUpperCase()))) : this.cli.env;
    return { ...source, HOME: this.cli.home, USERPROFILE: this.cli.home, CODEX_HOME: this.homes.codex, CLAUDE_CONFIG_DIR: this.homes.claude, APPDATA: path.join(this.cli.home, 'AppData/Roaming'), LOCALAPPDATA: path.join(this.cli.home, 'AppData/Local'), DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  }
  private async command(args: string[]) {
    const found = await this.cli.locate('claude'); if (!found) throw Error('NATIVE_PLUGIN_RUNTIME_MISSING');
    return (this.options.run ?? runCommand)({ executable: found.executable, args }, { env: this.env('claude'), cwd: this.cli.home, timeout: 120000 });
  }
  private async codex<T>(operation: (rpc: (method: string, params: unknown) => Promise<any>) => Promise<T>, timeout = 20000) {
    if (this.options.rpc) return operation(this.options.rpc);
    const found = await this.cli.locate('codex'); if (!found) throw Error('NATIVE_PLUGIN_RUNTIME_MISSING');
    return codexConfiguration(found.executable, this.env('codex'), this.cli.home, operation, false, timeout);
  }
  private record(runtime: LocalRuntime, nativeId: string, extra: Partial<NativePlugin>, raw?: string): RecordInternal {
    const view: NativePlugin = { id: digest(`${runtime}:${nativeId}:${extra.scope ?? 'user'}`).slice(0, 32), runtime, nativeId, name: nativeId.split('@')[0]!, description: '', marketplace: nativeId.split('@').slice(1).join('@'), installed: false, enabled: false, scope: 'user', canInstall: false, canToggle: false, revision: '', ...extra };
    view.revision = digest(JSON.stringify([view, raw])); return { view, raw };
  }
  private async codexRecords(refresh: boolean): Promise<RecordInternal[]> {
    const result = await this.codex(async rpc => {
      const cwds = this.options.projects?.() ?? [];
      const installed = await rpc('plugin/installed', { cwds }).catch(() => undefined);
      let catalog: any;
      try { catalog = await rpc('plugin/list', { forceRefetch: refresh, cwds }); }
      catch (error) { if (!Array.isArray(installed?.marketplaces)) throw error; this.warnings.set('codex', '可安装目录暂时无法获取；仍显示原生运行时确认的已安装插件。'); return installed; }
      if (!Array.isArray(catalog.marketplaces)) throw Error('NATIVE_PLUGIN_INVALID');
      // Some native catalogs omit installed packages that no longer appear in
      // the available marketplace. Keep native installed discovery authoritative.
      for (const market of installed?.marketplaces ?? []) {
        let target = catalog.marketplaces.find((entry: any) => entry.name === market.name && entry.path === market.path);
        if (!target) { target = { ...market, plugins: [] }; catalog.marketplaces.push(target); }
        for (const plugin of market.plugins ?? []) if (plugin.installed === true) { const index = target.plugins.findIndex((entry: any) => entry.id === plugin.id); if (index >= 0) target.plugins[index] = { ...target.plugins[index], ...plugin }; else target.plugins.push(plugin); }
      }
      return catalog;
    });
    if (!Array.isArray(result.marketplaces)) throw Error('NATIVE_PLUGIN_INVALID');
    if (result.marketplaceLoadErrors?.length) this.warnings.set('codex', '部分原生插件市场无法读取；这里只显示成功读取的条目。');
    const file = path.join(this.homes.codex, 'config.toml'), raw = await optionalText(file), config = raw ? parse(raw) as any : {};
    const projects = await Promise.all((this.options.projects?.() ?? []).map(async project => { const text = await optionalText(path.join(project, '.codex/config.toml')); return text ? parse(text) as any : {}; }));
    const records: RecordInternal[] = [];
    for (const market of result.marketplaces) {
      if (typeof market.name !== 'string' || !Array.isArray(market.plugins)) throw Error('NATIVE_PLUGIN_INVALID');
      for (const item of market.plugins) {
        if (!safeId(item.id) || typeof item.name !== 'string' || typeof item.installed !== 'boolean' || typeof item.enabled !== 'boolean') throw Error('NATIVE_PLUGIN_INVALID');
        const overridden = projects.some(project => project.plugins?.[item.id] !== undefined), restricted = item.availability === 'DISABLED_BY_ADMIN' || !!item.disabledReason || item.installPolicy === 'NOT_AVAILABLE';
        const record = this.record('codex', item.id, { name: item.interface?.displayName || item.name, description: item.interface?.shortDescription || '', marketplace: market.name, installed: item.installed, enabled: item.enabled, version: item.localVersion || item.version || undefined, canInstall: !item.installed && !restricted, canToggle: item.installed && !restricted && !overridden, detail: restricted ? '原生运行时限制了此插件的使用或安装。' : overridden ? '项目配置覆盖此插件，请在对应原生配置中调整。' : '按原生插件整组控制，影响其技能、工具和其他组件；新会话生效。' }, raw);
        record.marketplacePath = typeof market.path === 'string' ? market.path : undefined;
        // Include the native config subtree even when a disabled cached package is listed.
        record.view.revision = digest(JSON.stringify([record.view.revision, config.plugins?.[item.id], projects.map(project => project.plugins?.[item.id])])); records.push(record);
      }
    }
    return records;
  }
  private async officialCatalog(refresh: boolean) {
    if (this.official && !refresh && Date.now() - this.official.checked < 300000) return this.official.entries;
    const response = await (this.options.fetcher ?? fetch)(catalogUrl, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw Error('NATIVE_PLUGIN_CATALOG_UNAVAILABLE');
    const text = await response.text(); if (text.length > 2 * 1024 * 1024) throw Error('NATIVE_PLUGIN_INVALID');
    const data = JSON.parse(text); if (data.name !== officialMarket || !Array.isArray(data.plugins)) throw Error('NATIVE_PLUGIN_INVALID');
    this.official = { entries: data.plugins, checked: Date.now() }; return data.plugins;
  }
  private async claudeRecords(refresh: boolean): Promise<RecordInternal[]> {
    const output = JSON.parse(await this.command(['plugin', 'list', '--available', '--json']));
    if (!Array.isArray(output.installed) || !Array.isArray(output.available)) throw Error('NATIVE_PLUGIN_INVALID');
    const raw = await optionalText(path.join(this.homes.claude, 'settings.json'));
    const known = await readJson<Record<string, any>>(path.join(this.homes.claude, 'plugins/known_marketplaces.json'), {});
    const records: RecordInternal[] = [], controls = new NativeSkillControls({ home: this.cli.home, codexHome: this.homes.codex, claudeHome: this.homes.claude, projects: this.options.projects?.() ?? [] }); await controls.load();
    for (const item of output.installed) {
      if (!safeId(item.id) || typeof item.enabled !== 'boolean' || typeof item.scope !== 'string') throw Error('NATIVE_PLUGIN_INVALID');
      const manifest = typeof item.installPath === 'string' ? await readJson<any>(path.join(item.installPath, '.claude-plugin/plugin.json'), {}) : {};
      const origin: SkillOrigin = { provider: 'claude', kind: 'personal', root: item.installPath ?? '', pluginId: item.id, defaultEnabled: item.enabled, settingsFile: path.join(this.homes.claude, 'settings.json') };
      const skill = { id: '', name: item.id, origins: [origin], path: '' } as NativeSkill; controls.decorate(skill);
      const record = this.record('claude', item.id, { name: manifest.name || item.id.split('@')[0], description: manifest.description || '', installed: true, enabled: item.enabled, version: item.version, scope: item.scope + (item.projectPath ? ':' + item.projectPath : ''), directory: item.installPath, canToggle: item.scope === 'user' && !!skill.control?.canToggle, detail: item.scope !== 'user' ? '此插件安装在项目或托管范围，请在原生配置中调整。' : skill.control?.detail }, raw); record.origin = origin; records.push(record);
    }
    const available = [...output.available];
    if (!known[officialMarket]) {
      try { for (const item of await this.officialCatalog(refresh)) if (typeof item.name === 'string') available.push({ ...item, pluginId: `${item.name}@${officialMarket}`, marketplaceName: officialMarket, needsMarketplace: true }); }
      catch { this.warnings.set('claude', '官方可安装目录暂时无法获取；已安装插件和本机市场条目仍可查看。'); }
    }
    for (const item of available) {
      if (!safeId(item.pluginId) || typeof item.name !== 'string' || typeof item.marketplaceName !== 'string') throw Error('NATIVE_PLUGIN_INVALID');
      if (records.some(record => record.view.nativeId === item.pluginId)) continue;
      const record = this.record('claude', item.pluginId, { name: item.name, description: typeof item.description === 'string' ? item.description : '', marketplace: item.marketplaceName, canInstall: true, needsMarketplace: item.needsMarketplace === true, detail: item.needsMarketplace ? '首次安装会先通过 Claude Code 注册 Anthropic 官方插件市场，然后安装到原生用户目录。' : '通过 Claude Code 原生安装命令安装到用户范围。' }, raw);
      record.view.revision = digest(JSON.stringify([record.view.revision, item.source])); records.push(record);
    }
    return records;
  }
  private async records(runtime: LocalRuntime, refresh = false) { if (!await this.cli.locate(runtime)) return []; return runtime === 'codex' ? this.codexRecords(refresh) : this.claudeRecords(refresh); }
  async scan(refresh = false): Promise<NativePluginScan> {
    const plugins: NativePlugin[] = [], errors: NativePluginScan['errors'] = [];
    await Promise.all((['codex', 'claude'] as const).map(async runtime => { this.warnings.delete(runtime); try { plugins.push(...(await this.records(runtime, refresh)).map(record => record.view)); const warning = this.warnings.get(runtime); if (warning) errors.push({ runtime, message: warning }); } catch { errors.push({ runtime, message: '原生插件目录暂时无法读取，请检查 CLI 版本、网络和原生市场配置后刷新。' }); } }));
    return { plugins: plugins.sort((a, b) => a.runtime.localeCompare(b.runtime) || a.name.localeCompare(b.name)), errors };
  }
  async change(runtime: LocalRuntime, id: string, revision: string, action: 'install' | 'enable' | 'disable') {
    return this.queues[runtime].run(() => this.cli.withNativeOperation(runtime, async () => {
      const record = (await this.records(runtime)).find(item => item.view.id === id);
      if (!record || revision !== record.view.revision) throw Error('NATIVE_PLUGIN_CONFLICT');
      const view = record.view;
      if (action === 'install' ? !view.canInstall : !view.canToggle) throw Error('NATIVE_PLUGIN_UNAVAILABLE');
      if (runtime === 'claude') {
        if (action === 'install') {
          if (view.needsMarketplace) await this.command(['plugin', 'marketplace', 'add', officialRepo]);
          // Never auto-accept marketplace-declared shell commands or headersHelper.
          await this.command(['plugin', 'install', view.nativeId, '--scope', 'user', '--json']);
        } else {
          const file = path.join(this.homes.claude, 'settings.json'); await noLinks(file);
          const value = record.raw ? plain(JSON.parse(record.raw)) : {};
          value.enabledPlugins = { ...plain(value.enabledPlugins ?? {}), [view.nativeId]: action === 'enable' };
          await atomicWrite(file, JSON.stringify(value, null, 2) + '\n', async () => { if (await optionalText(file) !== record.raw) throw Error('NATIVE_PLUGIN_CONFLICT'); });
        }
      } else await this.codex(async rpc => {
        if (action === 'install') {
          await rpc('plugin/install', { pluginName: view.nativeId.split('@')[0], ...(record.marketplacePath ? { marketplacePath: record.marketplacePath } : { remoteMarketplaceName: view.marketplace }), installAttemptId: randomUUID() });
        } else {
          const file = path.join(this.homes.codex, 'config.toml'); await noLinks(file);
          const result = await rpc('config/read', { includeLayers: true }), user = result.layers?.find((layer: any) => layer.name?.type === 'user' && samePath(layer.name.file, file));
          if (!user?.version || await optionalText(file) !== record.raw) throw Error('NATIVE_PLUGIN_CONFLICT');
          const plugins = plain(user.config?.plugins ?? {});
          const write = await rpc('config/batchWrite', { filePath: file, expectedVersion: user.version, edits: [{ keyPath: 'plugins', value: { ...plugins, [view.nativeId]: { ...plugins[view.nativeId], enabled: action === 'enable' } }, mergeStrategy: 'replace' }] });
          if (write.status !== 'ok') throw Error('NATIVE_PLUGIN_UNAVAILABLE');
        }
      }, action === 'install' ? 120000 : 20000);
      const after = (await this.records(runtime)).find(item => item.view.nativeId === view.nativeId && item.view.scope === 'user')?.view;
      if (!after || (action === 'install' ? !after.installed : after.enabled !== (action === 'enable'))) throw Error('NATIVE_PLUGIN_VERIFY_FAILED');
      return this.scan();
    }));
  }
}
