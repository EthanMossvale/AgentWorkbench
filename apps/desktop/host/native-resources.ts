import path from 'node:path';
import type { Session } from '../../../packages/contracts';
import { NativeMemoryService } from '../../../packages/native-memory';
import { NativeSkillsService } from '../../../packages/native-skills';
import type { SkillLinkRequest } from '../../../packages/native-skills/links';
import { LocalCliService, type CliOptions, type LocalRuntime } from '../../../packages/native-runtime/cli';
import { NativeMemoryControls } from '../../../packages/native-memory/controls';
import { PluginRegistry, type PluginRegistryOptions } from '../../../packages/plugins-core';
import { NativePluginsService } from '../../../packages/native-plugins';
import { combineSharedContextSnapshots, createFrameworkSnapshot, sharedHash } from '../../../packages/memory-core';
import { absolutePath, flag, object, required, text } from './validation';
import {archiveReaders,ArchivePasswordError} from '../../../packages/native-resources/archive-reader';
import type {ArchiveReadOptions,ArchivePasswordRequest} from '../../../packages/native-resources/archive-types';

export interface ResourceDialogs { openZip(kind: 'skill' | 'plugin'): Promise<string | null>; saveZip(name: string): Promise<string | null> }
export class NativeResources {
  readonly archives=archiveReaders;
  readonly memory: NativeMemoryService; readonly skills: NativeSkillsService; readonly plugins: PluginRegistry; readonly cli: LocalCliService; readonly memoryControls: NativeMemoryControls; readonly nativePlugins: NativePluginsService;
  constructor(directory: string, private dialogs: ResourceDialogs, projects: () => string[], changed: () => void, home?: string, runtime?: { codexExecutable?: string; claudeExecutable?: string; cliOptions?: CliOptions; pluginOptions?:PluginRegistryOptions }) {
    const options = home ? { home, codexHome: path.join(home, '.codex'), claudeHome: path.join(home, '.claude') } : {};
    this.cli = new LocalCliService(directory, { home, isolated: !!home, ...runtime?.cliOptions }); this.memoryControls = new NativeMemoryControls(this.cli, projects);
    this.nativePlugins = new NativePluginsService(this.cli, { projects });
    this.memory = new NativeMemoryService(directory, {...options,projects,canSync:async()=>(await Promise.all(['codex','claude'].map(p=>this.cli.locate(p as LocalRuntime)))).every(Boolean),canReceive:(provider,project)=>this.memoryControls.canReceive(provider,project)}); this.skills = new NativeSkillsService(directory, { ...options, ...runtime, projects, executable: async provider => (await this.cli.locate(provider))?.executable }); this.plugins = new PluginRegistry(directory, changed,runtime?.pluginOptions);
  }
  async initialize() { await this.cli.initialize(); await Promise.all([this.memory.initialize(), this.skills.initialize()]); await this.plugins.initialize(); }
  handles(method: string) { return /^(native-memory|native-skills|native-plugins|local-cli|extensions)\//.test(method); }
  async call(method: string, value: unknown) {
    const p = object(value ?? {});
    const archiveOptions=():ArchiveReadOptions=>({...(p.password===undefined?{}:{password:text(p.password,'Archive password',Infinity)}),...(p.volumes===undefined?{}:{volumes:(p.volumes as unknown[]).map(file=>absolutePath(file))})});
    const importArchive=async<T>(file:string,read:()=>Promise<T>):Promise<T|ArchivePasswordRequest>=>{try{return await read();}catch(error){if(error instanceof ArchivePasswordError)return{kind:'archive-password',filePath:file,incorrect:error.incorrect};throw error;}};
    const provider = (): LocalRuntime => { if (p.runtime !== 'codex' && p.runtime !== 'claude') throw Error('LOCAL_RUNTIME_REQUIRED'); return p.runtime; };
    const installMethod = () => { if (p.installMethod === undefined) return undefined; if (p.installMethod !== 'native' && p.installMethod !== 'npm') throw Error('CLI_INSTALL_METHOD_INVALID'); return p.installMethod; };
    switch (method) {
      case 'local-cli/list': return this.cli.list();
      case 'local-cli/install-directory': return this.cli.setCodexInstallDirectory(absolutePath(p.directory));
      case 'local-cli/check': return this.cli.check(provider(), installMethod());
      case 'local-cli/configure': return this.cli.configure(provider(), flag(p.enabled, 'enabled'));
      case 'local-cli/install': return this.cli.install(provider(), p.update === undefined ? false : flag(p.update, 'update'), false, installMethod());
      case 'local-cli/uninstall': return this.cli.uninstall(provider(), required(p.revision, 'Installation revision', 64));
      case 'native-plugins/list': return this.nativePlugins.scan(p.refresh === undefined ? false : flag(p.refresh, 'Refresh'));
      case 'native-plugins/change': {
        if (!['install', 'enable', 'disable'].includes(p.action as string)) throw Error('NATIVE_PLUGIN_ACTION_INVALID');
        return this.nativePlugins.change(provider(), required(p.id, 'Plugin ID', 64), required(p.revision, 'Plugin revision', 64), p.action as 'install' | 'enable' | 'disable');
      }
      case 'native-memory/settings/get': return this.memoryControls.list();
      case 'native-memory/settings/write': {
        if (p.setting !== 'enabled' && p.setting !== 'allowToolChats') throw Error('NATIVE_MEMORY_SETTING_INVALID');
        return this.memoryControls.write(provider(), required(p.revision, 'Settings revision', 64), p.setting, flag(p.enabled, 'enabled'));
      }
      case 'native-memory/get': return this.memory.status();
      case 'native-memory/tasks/list': return this.memory.background.list();
      case 'native-memory/tasks/cancel': return this.memory.background.cancel(required(p.id, 'Memory task ID', 36));
      case 'native-memory/list': return this.memory.list();
      case 'native-memory/catalog': return this.memory.catalog();
      case 'native-memory/archive/read': return this.memory.readArchive(required(p.id, 'Archive ID', 64));
      case 'native-memory/read': return this.memory.read(required(p.id, 'Memory ID', 64));
      case 'native-memory/write': return this.memory.change(required(p.id, 'Memory ID', 64), required(p.revision, 'Memory revision', 64), text(p.content, 'Memory content', 2 * 1024 * 1024));
      case 'native-memory/delete': return this.memory.change(required(p.id, 'Memory ID', 64), required(p.revision, 'Memory revision', 64), null);
      case 'native-memory/configure': {
        if (Object.keys(p).some(key => !['enabled', 'initialSources'].includes(key))) throw Error('Memory locations and both synchronization directions are automatic.');
        if (p.initialSources !== undefined && !['codex', 'claude', 'both'].includes(p.initialSources as string)) throw Error('Initial sources must be Codex, Claude or both.');
        return this.memory.configure({ enabled: flag(p.enabled, 'enabled'), initialSources: p.initialSources as 'codex'|'claude'|'both'|undefined });
      }
      case 'native-memory/sync': return this.memory.sync();
      case 'native-skills/list': return this.skills.scan();
      case 'native-skills/links/plan': return this.skills.planLinks({ runtime: provider(), action: p.action as SkillLinkRequest['action'], skills: p.skills as SkillLinkRequest['skills'] });
      case 'native-skills/links/apply': return this.skills.applyLinks(required(p.planId, 'Skill link plan ID', 36));
      case 'native-skills/toggle': return this.skills.setEnabled(required(p.id, 'Skill ID'), flag(p.enabled, 'enabled'), p.confirmParent === undefined ? false : flag(p.confirmParent, 'Parent plugin confirmation'));
      case 'native-skills/read': return this.skills.readMarkdown(required(p.id, 'Skill ID'), required(p.hash, 'Skill revision', 64));
      case 'native-skills/import': {
        if (p.provider !== 'codex' && p.provider !== 'claude') throw Error('Select Codex or Claude Code as the skill destination.');
        const file = p.filePath === undefined ? await this.dialogs.openZip('skill') : absolutePath(p.filePath);
        if (!file) return null;
        if (!/\.(zip(?:\.\d+)?|z\d+)$/i.test(file)) throw Error('Select a ZIP archive.');
        return importArchive(file,()=>this.skills.importZip(file, p.provider as 'codex'|'claude',archiveOptions()));
      }
      case 'native-skills/export': { const id = required(p.id, 'Skill ID'), hash = required(p.hash, 'Skill revision', 64), skill = await this.skills.readMarkdown(id, hash); const file = await this.dialogs.saveZip(`${skill.name.replace(/[^\p{L}\p{N}_.-]/gu, '-')}.zip`); return file ? this.skills.exportZip(id, hash, file) : null; }
      case 'extensions/list': return this.plugins.list();
      case 'extensions/storage/read': return this.plugins.readStorage(required(p.id, 'Plugin ID'), required(p.hash, 'Plugin revision', 64));
      case 'extensions/storage/write': return this.plugins.writeStorage(required(p.id, 'Plugin ID'), required(p.hash, 'Plugin revision', 64), p.revision as string | null, p.values as Parameters<PluginRegistry['writeStorage']>[3]);
      case 'extensions/services': return this.plugins.services.list();
      case 'extensions/appearance': return this.plugins.appearance();
      case 'extensions/renderers': return this.plugins.renderers();
      case 'extensions/renderer-failed': return this.plugins.rendererFailed(required(p.id, 'Plugin ID'), required(p.hash, 'Plugin revision', 64));
      case 'extensions/disable-all': return this.plugins.disableAll();
      case 'extensions/import': { const file = p.filePath === undefined ? await this.dialogs.openZip('plugin') : absolutePath(p.filePath); if (!file) return null; if (!/\.(zip(?:\.\d+)?|z\d+)$/i.test(file)) throw Error('Select a ZIP archive.');return importArchive(file,()=>this.plugins.importZip(file,archiveOptions())); }
      case 'extensions/toggle': return this.plugins.setEnabled(required(p.id, 'Plugin ID'), required(p.hash, 'Plugin revision', 64), flag(p.enabled, 'enabled'), p.approveHost === undefined ? false : flag(p.approveHost, 'Host approval'));
      case 'extensions/export': { const id = required(p.id, 'Plugin ID'), hash = required(p.hash, 'Plugin revision', 64), file = await this.dialogs.saveZip(`${id}.zip`); return file ? this.plugins.exportZip(id, hash, file) : null; }
      case 'extensions/command': return this.plugins.command(required(p.id, 'Plugin ID'), required(p.name, 'Command name'), p.payload);
      default: throw Error('Unknown native resource request.');
    }
  }
  async context(session: Session) {
    const memory = await this.memory.createSnapshot({ sessionId: session.id }), skills = await this.skills.createDiscoverySnapshot({ sessionId: session.id, nativeRuntime: session.binding.runtime });
    const revision = this.plugins.revision;
    const contributions = await this.plugins.context({ sessionId: session.id, projectPath: session.projectPath, runtime: session.binding.runtime });
    const plugins = createFrameworkSnapshot(contributions.map((value, i) => ({ id: `plugin:${value.id}:${i}`, kind: 'plugin-context' as const, title: value.id, content: value.content, sourceHash: sharedHash(value.content) })), { sessionId: session.id, revision, memoryEnabled: false }, () => this.plugins.revision === revision);
    return combineSharedContextSnapshots(combineSharedContextSnapshots(memory, skills), plugins);
  }
  async dispose() { await Promise.all([this.cli.dispose(), this.memory.dispose(), this.plugins.dispose()]); }
}
