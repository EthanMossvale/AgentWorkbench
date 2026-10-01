import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { parse } from 'smol-toml';
import { atomicWrite, noLinks, optionalText, samePath } from '../native-resources/files';
import { writeCodexSkill } from './native-process';
import type { NativeSkill, SkillOrigin } from './index';

export interface SkillControl { kind: 'skill' | 'plugin' | 'unavailable'; canToggle: boolean; detail: string; enableParent?: boolean }
export interface ControlOptions { home: string; codexHome: string; claudeHome: string; codexExecutable?: string; projects: string[] }
const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Native skill settings must be an object.');
  return value as Record<string, any>;
};
async function json(file: string) { const raw = await optionalText(file); return { raw, value: raw === undefined ? {} : object(JSON.parse(raw.replace(/^\uFEFF/, ''))) }; }
const table = (value: any, key: string) => value[key] === undefined ? {} : object(value[key]);

export class NativeSkillControls {
  private codex: Record<string, any> = {};
  private codexProjects: Record<string, any>[] = [];
  private claude = new Map<string, Record<string, any>>();
  constructor(private options: ControlOptions) {}
  async load(origins: SkillOrigin[] = []) {
    const raw = await optionalText(path.join(this.options.codexHome, 'config.toml'));
    this.codex = raw ? parse(raw) : {};
    for (const project of this.options.projects) { const config = await optionalText(path.join(project, '.codex', 'config.toml')); if (config) this.codexProjects.push(parse(config)); }
    for (const file of new Set([...this.claudeFiles(), ...origins.filter(o => o.provider === 'claude' && o.settingsFile).map(o => o.settingsFile!)])) this.claude.set(file, (await json(file)).value);
  }
  private claudeFiles() {
    const files = [path.join(this.options.claudeHome, 'settings.json')];
    for (const project of this.options.projects) files.push(path.join(project, '.claude', 'settings.json'), path.join(project, '.claude', 'settings.local.json'));
    const managed = process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode', 'managed-settings.json') : process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-settings.json' : '/etc/claude-code/managed-settings.json';
    // Isolated test profiles must never read machine policy as fixture data.
    if (samePath(this.options.home, process.env.USERPROFILE || process.env.HOME || '')) files.push(managed);
    return [...new Set(files)];
  }
  private claudeTarget(origin: SkillOrigin) { return origin.settingsFile || path.join(this.options.claudeHome, 'settings.json'); }
  private claudeKey(skill: NativeSkill, origin: SkillOrigin) { return origin.pluginId || origin.nativeName || skill.name; }
  private state(skill: NativeSkill, origin: SkillOrigin) {
    if (origin.provider === 'codex') {
      const configs = table(this.codex, 'skills').config ?? [];
      if (!Array.isArray(configs)) throw Error('Native Codex skills.config must be an array.');
      const matched = configs.filter(entry => entry && ((typeof entry.path === 'string' && samePath(entry.path, skill.path)) || entry.name === (origin.nativeName || skill.name)));
      const pluginDisabled = origin.pluginId && table(this.codex, 'plugins')[origin.pluginId]?.enabled === false;
      const overridden = this.codexProjects.some(config => table(config, 'skills').config !== undefined || (origin.pluginId && table(config, 'plugins')[origin.pluginId] !== undefined));
      const enabled = !pluginDisabled && !matched.some(entry => entry.enabled === false);
      return { enabled, enableParent: !!pluginDisabled, blocked: !this.options.codexExecutable || overridden, detail: overridden ? '项目 Codex 配置包含技能或插件覆盖，请先在原生设置中处理。' : pluginDisabled ? `将启用所属插件 ${origin.pluginId} 及此技能。插件的其他组件也会启用，其他技能的独立停用设置保留，新会话生效。` : this.options.codexExecutable ? '写入 Codex 原生配置，新会话生效。' : '未找到可用的 Codex 原生配置接口。' };
    }
    const target = this.claudeTarget(origin), settings = this.claude.get(target) ?? {}, group = origin.pluginId ? 'enabledPlugins' : 'skillOverrides', key = this.claudeKey(skill, origin);
    const value = table(settings, group)[key], enabled = origin.pluginId ? value === undefined ? origin.defaultEnabled !== false : value !== false : value !== 'off';
    const blockedByBundle = !!skill.builtin && [...this.claude.values()].some(config => config.disableBundledSkills === true) && skill.name !== 'doctor';
    const overridden = [...this.claude].some(([file, config]) => file !== target && table(config, group)[key] !== undefined && table(config, group)[key] !== value);
    return { enabled: enabled && !blockedByBundle, blocked: blockedByBundle || overridden, detail: blockedByBundle ? 'Claude 已全局关闭内置技能；请先在原生设置中解除。' : overridden ? '项目或受管配置覆盖了此技能；请先在对应原生设置中处理。' : origin.pluginId ? `原生插件开关：会同时${enabled ? '关闭' : '开启'} ${origin.pluginId} 的全部技能及其他组件，新会话生效。` : '写入 Claude Code 原生 skillOverrides，新会话生效，同名技能一并受控。' };
  }
  decorate(skill: NativeSkill) {
    const states = skill.origins.map(origin => this.state(skill, origin));
    skill.enabled = states.some(state => state.enabled);
    skill.runtimeAvailability = Object.fromEntries((['codex','claude'] as const).map(runtime=>[runtime,states.some((state,i)=>skill.origins[i]?.provider===runtime&&state.enabled&&!state.blocked)]));
    const mixed = states.some(state => state.enabled !== states[0]?.enabled);
    skill.control = { kind: skill.origins.some(o => o.pluginId && o.provider === 'claude') ? 'plugin' : 'skill', enableParent: states.some(state => state.enableParent), canToggle: !states.some(state => state.blocked), detail: [...new Set(states.map(state => state.detail))].join(' ') + (mixed ? ' 两方当前状态不同，切换会统一两方设置。' : '') };
  }
  async write(skill: NativeSkill, enabled: boolean, confirmParent = false) {
    if (!skill.control?.canToggle) throw Error('Native skill control is unavailable or overridden; refresh the catalog.');
    if (enabled && skill.control.enableParent && !confirmParent) throw Error('Enabling the parent plugin requires explicit confirmation.');
    for (const origin of skill.origins) {
      if (origin.provider === 'codex') {
        const file = path.join(this.options.codexHome, 'config.toml'); await noLinks(file); await mkdir(this.options.codexHome, { recursive: true });
        await writeCodexSkill(this.options.codexExecutable!, this.options.home, this.options.codexHome, skill.path, enabled, origin.pluginId ? origin.nativeName : undefined, enabled && this.state(skill, origin).enableParent ? origin.pluginId : undefined);
      } else {
        const file = this.claudeTarget(origin), { raw, value } = await json(file), group = origin.pluginId ? 'enabledPlugins' : 'skillOverrides', key = this.claudeKey(skill, origin);
        const entries = table(value, group); entries[key] = origin.pluginId ? enabled : enabled ? 'on' : 'off'; value[group] = entries;
        if (await optionalText(file) !== raw) throw Error('Native settings changed concurrently; refresh before changing the skill.');
        await atomicWrite(file, JSON.stringify(value, null, 2) + '\n');
        if (table((await json(file)).value, group)[key] !== entries[key]) throw Error('Native skill settings changed before verification.');
      }
    }
  }
}
