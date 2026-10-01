import type { AppState } from '../../../packages/contracts';
import type { PluginContentContext, PluginContentResult } from './plugin-lifecycle';

export const coreSettingsTabs = ['general','appearance','shortcuts','plugins','translation','memory','skills','runtimes','models','connections','capabilities','privacy','archive','about','worktrees'] as const;
export type CoreSettingsTab = typeof coreSettingsTabs[number];
export const coreSettingsLabels: Readonly<Record<CoreSettingsTab,string>> = Object.freeze({general:'常规',appearance:'外观',shortcuts:'键盘快捷键',plugins:'插件',translation:'双语工作流',memory:'记忆',skills:'技能',runtimes:'运行时 CLI',models:'模型',connections:'连接与环境',capabilities:'能力与验收',privacy:'数据与隐私',archive:'归档会话',about:'关于',worktrees:'工作树'});
export type SettingsPageId = CoreSettingsTab | `plugin:${string}`;
export interface SettingsPageContext extends PluginContentContext { state(): AppState }
export interface PluginSettingsDefinition {
  id: string; label: string; keywords?: string; order?: number;
  /** Replace an existing settings page through the same lifecycle. */
  replaces?: CoreSettingsTab;
  render(context: SettingsPageContext): PluginContentResult | Promise<PluginContentResult>;
}
export interface PluginSettingsHandle { id: SettingsPageId; open(): void; dispose(): void }
export interface PluginSettingsApi {
  register(definition: PluginSettingsDefinition): PluginSettingsHandle;
  open(id: SettingsPageId): void;
  list(): { id: SettingsPageId; label: string; owner?: string }[];
}
export interface SettingsContribution { owner: string; key: string; id: SettingsPageId; definition: PluginSettingsDefinition; failed(error: unknown): void }

export class PluginSettingsRegistry {
  private entries: SettingsContribution[] = [];
  private listeners = new Set<() => void>();
  private snapshot: SettingsContribution[] = [];
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  get(id: string) { return this.snapshot.find(entry => entry.id === id); }
  has(id: unknown): id is SettingsPageId { return typeof id === 'string' && ((coreSettingsTabs as readonly string[]).includes(id) || !!this.get(id)); }
  private publish() {
    const current = new Map<SettingsPageId, SettingsContribution>();
    for (const entry of this.entries) current.set(entry.id,entry);
    this.snapshot = [...current.values()].sort((a,b) => (a.definition.order ?? 0)-(b.definition.order ?? 0) || a.id.localeCompare(b.id));
    for (const listener of this.listeners) listener();
  }
  register(owner: string, input: PluginSettingsDefinition, failed: (error: unknown) => void) {
    if (!/^[a-z][a-z0-9.-]{0,79}$/.test(input?.id) || typeof input.label !== 'string' || !input.label.trim() || input.label.length > 120 || typeof input.render !== 'function' || input.keywords !== undefined && (typeof input.keywords !== 'string' || input.keywords.length > 2000) || input.order !== undefined && !Number.isFinite(input.order) || input.replaces !== undefined && !(coreSettingsTabs as readonly string[]).includes(input.replaces)) throw Error('PLUGIN_SETTINGS_INVALID');
    const key = `plugin:${owner}/${input.id}`;
    if (this.entries.some(entry => entry.key === key)) throw Error('PLUGIN_SETTINGS_DUPLICATE');
    const entry: SettingsContribution = {owner,key,id:input.replaces ?? key as SettingsPageId,definition:Object.freeze({...input}),failed};
    this.entries.push(entry); this.publish();
    return {id:entry.id,dispose:() => { const index = this.entries.indexOf(entry); if (index >= 0) { this.entries.splice(index,1); this.publish(); } }};
  }
}
export const pluginSettings = new PluginSettingsRegistry();
