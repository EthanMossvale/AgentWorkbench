import path from 'node:path';
import os from 'node:os';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { atomicWrite, canonicalDirectory, digest, missing, readJson, SerialQueue, textFile } from '../native-resources/files';
import { exportArchive, installArchive, readArchive, unwrapArchive } from '../native-resources/archive';
import type {ArchiveReadOptions} from '../native-resources/archive-types';
import { createFrameworkSnapshot, sharedHash } from '../memory-core';
import { readSkillDisplay } from './display';
import { claudePluginRoots } from './claude-plugins';
import { NativeSkillControls, type SkillControl } from './controls';
import { claudeBundledSkills, findExecutable } from './native-process';
import { LocalCliService } from '../native-runtime/cli';
import { NativeSkillLinks, type SkillConnection, type SkillLinkRequest } from './links';

export interface SkillOrigin { provider: 'codex' | 'claude'; kind: 'official' | 'personal' | 'project'; root: string; entryPath?: string; pluginId?: string; namespace?: string; nativeName?: string; settingsFile?: string; defaultEnabled?: boolean }
export interface NativeSkill { id: string; name: string; description: string; displayName: string; shortDescription: string; icon?: string; path: string; directory: string; hash: string; enabled: boolean; origins: SkillOrigin[]; conflicts: string[]; available: boolean; warning?: string; builtin?: boolean; control?: SkillControl; userInvocable?: boolean; runtimeAvailability?: Partial<Record<'codex'|'claude',boolean>>; connections?: Record<'codex'|'claude', SkillConnection> }
interface Preferences { version: 1; enabled: Record<string, boolean> }
export interface SkillScan { skills: NativeSkill[]; roots: SkillOrigin[]; errors: { path: string; message: string }[] }
export function skillMetadata(markdown: string, directoryName: string) {
  if (markdown.includes('\0')) throw Error('SKILL.md contains invalid text.');
  const normalized = markdown.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n'), front = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!front) throw Error('SKILL.md requires YAML frontmatter.');
  const values: Record<string, string> = {}, lines = front[1]!.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const match = /^(name|description):\s*(.*)$/.exec(lines[index]!); if (!match) continue;
    const key = match[1]!, raw = match[2]!.trim(); if (values[key]) throw Error('Duplicate skill metadata.');
    if (/^[>|][-+]?\s*$/.test(raw)) { const parts: string[] = []; while (index + 1 < lines.length && (/^\s/.test(lines[index + 1]!) || !lines[index + 1])) parts.push(lines[++index]!.trim()); values[key] = parts.join(raw[0] === '>' ? ' ' : '\n').trim(); }
    else if (raw.startsWith('"')) { const value: unknown = JSON.parse(raw); if (typeof value !== 'string') throw Error('Invalid skill metadata scalar.'); values[key] = value; }
    else if (raw.startsWith("'")) { if (!raw.endsWith("'")) throw Error('Invalid quoted skill metadata.'); values[key] = raw.slice(1, -1).replaceAll("''", "'"); }
    else { if (/^[!&*[{]/.test(raw)) throw Error('Unsupported skill metadata scalar.'); values[key] = raw.replace(/\s+#.*$/, ''); }
  }
  const body = normalized.slice(front[0].length).trim();
  const name = values.name?.trim() || directoryName, description = values.description?.trim() || body.replace(/^#+\s*/gm, '').split(/\n\s*\n/)[0]?.slice(0, 1024) || '';
  if (!body || !name || /[\r\n\0]/.test(name) || !description) throw Error('Skill needs a name, description and instruction body.');
  return { name, description, userInvocable: !/^user-invocable:\s*false\s*(?:#.*)?$/m.test(front[1]!), dynamic: /!`|\$\{CLAUDE_SKILL_DIR\}|^context:\s*fork/m.test(normalized) };
}
export class NativeSkillsService {
  private prefs: Preferences = { version: 1, enabled: {} }; private queue = new SerialQueue(); private revision = 0; private catalog = new Map<string, NativeSkill>(); private readonly preferencesFile: string;
  private links: NativeSkillLinks;
  constructor(directory: string, private readonly options: { home?: string; codexHome?: string; claudeHome?: string; projects?: () => string[]; codexExecutable?: string; claudeExecutable?: string; executable?: (runtime: 'codex' | 'claude') => Promise<string | undefined> } = {}) { this.preferencesFile = path.join(directory, 'native-skills.json'); this.links = new NativeSkillLinks(directory, () => ({ codex: path.join(this.home, '.agents', 'skills'), claude: path.join(this.claudeHome, 'skills') })); }
  private get home() { return this.options.home ?? os.homedir(); }
  private get codexHome() { return this.options.codexHome ?? process.env.CODEX_HOME ?? path.join(this.home, '.codex'); }
  private get claudeHome() { return this.options.claudeHome ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(this.home, '.claude'); }
  private async executable(runtime: 'codex' | 'claude') {
    if (this.options.executable) return this.options.executable(runtime);
    const specified = runtime === 'codex' ? this.options.codexExecutable : this.options.claudeExecutable;
    return specified ? findExecutable([specified]) : (await new LocalCliService(path.dirname(this.preferencesFile), { home: this.home, isolated: !!this.options.home }).locate(runtime))?.executable;
  }
  async initialize() { this.prefs = await readJson(this.preferencesFile, this.prefs); if (this.prefs.version !== 1 || !this.prefs.enabled || Object.values(this.prefs.enabled).some(v => typeof v !== 'boolean')) throw Error('Native skill preferences are invalid.'); }
  private async roots(): Promise<SkillOrigin[]> {
    const roots: SkillOrigin[] = [
      { provider: 'codex', kind: 'personal', root: path.join(this.home, '.agents', 'skills') },
      { provider: 'codex', kind: 'personal', root: path.join(this.codexHome, 'skills') },
      { provider: 'claude', kind: 'personal', root: path.join(this.claudeHome, 'skills') },
    ];
    if (process.platform !== 'win32') roots.push({ provider: 'codex', kind: 'official', root: '/etc/codex/skills' });
    const projects = new Set<string>();
    for (const project of this.options.projects?.() ?? []) {
      let current = path.resolve(project);
      for (;;) { projects.add(current); try { await lstat(path.join(current, '.git')); break; } catch (e) { if (!missing(e)) break; } const parent = path.dirname(current); if (parent === current || current === this.home) break; current = parent; }
    }
    for (const project of projects) { roots.push({ provider: 'codex', kind: 'project', root: path.join(project, '.agents', 'skills') }, { provider: 'claude', kind: 'project', root: path.join(project, '.claude', 'skills') }); }
    roots.push(...await claudePluginRoots(this.claudeHome, [...projects]));
    for (const provider of ['codex'] as const) {
      const cache = path.join(provider === 'codex' ? this.codexHome : this.claudeHome, 'plugins', 'cache');
      try {
        for (const marketplace of await readdir(cache, { withFileTypes: true })) {
          if (!marketplace.isDirectory()) continue;
          const official = ['openai-bundled', 'openai-primary-runtime', 'openai-curated-remote'].includes(marketplace.name);
          for (const plugin of await readdir(path.join(cache, marketplace.name), { withFileTypes: true })) {
            if (!plugin.isDirectory()) continue; const pluginRoot = path.join(cache, marketplace.name, plugin.name);
            const versions = [];
            for (const candidate of await readdir(pluginRoot, { withFileTypes: true })) if (candidate.isDirectory() && candidate.name !== 'skills' && !candidate.name.startsWith('.')) versions.push({ name: candidate.name, mtime: (await lstat(path.join(pluginRoot, candidate.name))).mtimeMs });
            versions.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }) || b.mtime - a.mtime);
            const root = versions[0] && !['assets', 'scripts', 'references'].includes(versions[0].name) ? path.join(pluginRoot, versions[0].name, 'skills') : path.join(pluginRoot, 'skills');
            const manifest = await readJson<{ name?: string }>(path.join(path.dirname(root), '.codex-plugin', 'plugin.json'), {});
            roots.push({ provider, kind: official ? 'official' : 'personal', root, pluginId: `${plugin.name}@${marketplace.name}`, namespace: manifest.name || plugin.name });
          }
        }
      } catch (error) { if (!missing(error)) throw error; }
    }
    return roots.filter((value, index) => roots.findIndex(other => other.root === value.root && other.provider === value.provider && other.pluginId === value.pluginId && other.settingsFile === value.settingsFile) === index);
  }
  private async controls(origins: SkillOrigin[] = []) {
    const codexExecutable = await this.executable('codex');
    const projects = [...new Set([...(this.options.projects?.() ?? []), ...origins.filter(o => o.kind === 'project' && !o.pluginId).map(o => path.dirname(path.dirname(o.root)))])];
    const controls = new NativeSkillControls({ home: this.home, codexHome: this.codexHome, claudeHome: this.claudeHome, projects, codexExecutable }); await controls.load(origins); return controls;
  }
  async scan(): Promise<SkillScan> {
    const roots = await this.roots(), records = new Map<string, NativeSkill>(), errors: SkillScan['errors'] = [];
    for (const origin of roots) {
      const seen = new Set<string>();
      const visit = async (directory: string, currentOrigin: SkillOrigin) => {
        const resolved = await canonicalDirectory(directory), key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        const alreadySeen = seen.has(key); seen.add(key);
        const file = path.join(resolved, 'SKILL.md');
        try {
          const markdown = await textFile(file, Infinity), parsed = skillMetadata(markdown, path.basename(resolved)), id = digest(key).slice(0, 32), existing = records.get(id);
          const skillOrigin = { ...currentOrigin, entryPath: directory, nativeName: currentOrigin.pluginId && currentOrigin.namespace ? (parsed.name.startsWith(currentOrigin.namespace + ':') ? parsed.name : `${currentOrigin.namespace}:${parsed.name}`) : currentOrigin.provider === 'claude' ? path.basename(directory) : parsed.name };
          if (existing) { if (!existing.origins.some(o => o.provider === currentOrigin.provider && o.kind === currentOrigin.kind && o.pluginId === currentOrigin.pluginId && o.settingsFile === currentOrigin.settingsFile && o.nativeName === skillOrigin.nativeName && o.entryPath === directory)) existing.origins.push(skillOrigin); return; }
          const display = await readSkillDisplay(resolved);
          records.set(id, { id, name: parsed.name, description: parsed.description, userInvocable: parsed.userInvocable, displayName: display.displayName || parsed.name, shortDescription: display.shortDescription || parsed.description.replace(/\s+/g, ' '), icon: display.icon, path: file, directory: resolved, hash: digest(markdown), enabled: true, origins: [skillOrigin], conflicts: [], available: true, ...(parsed.dynamic ? { warning: '包含 Claude 动态命令或运行时专属配置；跨运行时仅提供原始文件，不自动执行插值。' } : {}) });
          return; // Assets, scripts and backup skills inside a skill are not independent installations.
        } catch (error) { if (!missing(error)) { errors.push({ path: file, message: (error as Error).message }); return; } }
        if (alreadySeen) return;
        for (const item of await readdir(resolved, { withFileTypes: true })) {
          if (!item.isDirectory() && !item.isSymbolicLink()) continue;
          try { await visit(path.join(directory, item.name), item.name === '.system' && origin.provider === 'codex' ? { ...currentOrigin, kind: 'official' } : currentOrigin); } catch (error) { errors.push({ path: path.join(directory, item.name), message: (error as Error).message }); }
        }
      };
      try { await visit(origin.root, origin); } catch (error) { if (!missing(error)) errors.push({ path: origin.root, message: (error as Error).message }); }
    }
    const executable = await this.executable('claude');
    if (executable) {
      const metadata = await claudeBundledSkills(executable);
      if (metadata.error) errors.push({ path: executable, message: metadata.error });
      for (const entry of metadata.skills) {
        const id = digest('claude-builtin:' + entry.name).slice(0, 32);
        records.set(id, { ...entry, id, displayName: entry.name, shortDescription: entry.description.replace(/\s+/g, ' '), path: '', directory: '', hash: digest(entry.description), enabled: true, available: false, builtin: true, origins: [{ provider: 'claude', kind: 'official', root: executable, nativeName: entry.name }], conflicts: [], warning: `Claude Code ${metadata.version} 原生内置技能。指令由运行时提供，没有可导出的 SKILL.md；具体可用性仍取决于原生会话功能。` });
      }
    }
    const skills = [...records.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
    try { const controls = await this.controls(skills.flatMap(skill => skill.origins)); for (const skill of skills) controls.decorate(skill); }
    catch (error) { errors.push({ path: '', message: (error as Error).message }); for (const skill of skills) skill.control = { kind: 'unavailable', canToggle: false, detail: '原生配置无法读取，不能核实开关状态。' }; }
    for (const skill of skills) {
      if (this.prefs.enabled[skill.id] === false && skill.enabled) skill.warning = [skill.warning, '旧版工作台的关闭记录未写入原生配置；请重新关闭以真正生效。'].filter(Boolean).join(' ');
      skill.conflicts = skills.filter(other => !skill.builtin && !other.builtin && other.id !== skill.id && other.name.normalize('NFKC').toLowerCase() === skill.name.normalize('NFKC').toLowerCase()).map(other => other.id); skill.available = !skill.builtin && skill.enabled && skill.control?.kind !== 'unavailable' && !skill.conflicts.some(id => records.get(id)?.enabled);
    }
    try { await this.links.decorate(skills); } catch (error) { errors.push({ path: '', message: (error as Error).message }); }
    this.catalog = records; return { skills, roots, errors };
  }
  async planLinks(request: SkillLinkRequest) { return this.queue.run(async () => this.links.plan(request, (await this.scan()).skills)); }
  async applyLinks(planId: string) { return this.queue.run(async () => { const result = await this.links.apply(planId, (await this.scan()).skills); this.revision++; return { ...result, scan: await this.scan() }; }); }
  async listMetadata() { return (await this.scan()).skills; }
  async setEnabled(id: string, enabled: boolean, confirmParent = false) { return this.queue.run(async () => {
    if (typeof enabled !== 'boolean') throw Error('Skill enabled must be boolean.'); await this.scan(); const skill = this.catalog.get(id); if (!skill) throw Error('Native skill is no longer installed.');
    try { const controls = await this.controls(skill.origins); controls.decorate(skill); await controls.write(skill, enabled, confirmParent); } finally { this.revision++; }
    const result = await this.scan(); if (result.skills.find(item => item.id === id)?.enabled !== enabled) throw Error('Native settings did not retain the requested skill state; refresh before retrying.');
    if (id in this.prefs.enabled) { delete this.prefs.enabled[id]; await atomicWrite(this.preferencesFile, JSON.stringify(this.prefs, null, 2)); }
    return result;
  }); }
  async readMarkdown(id: string, expectedHash: string) {
    await this.scan(); const skill = this.catalog.get(id); if (!skill || skill.hash !== expectedHash) throw Error('Skill changed; refresh the catalog before reading.');
    if (skill.builtin) throw Error('Bundled Claude skills have no exportable SKILL.md.');
    const markdown = await textFile(skill.path, Infinity); if (digest(markdown) !== expectedHash) throw Error('Skill changed during reading.'); return { ...skill, markdown };
  }
  async importZip(file: string, provider: 'codex' | 'claude', options:ArchiveReadOptions={}) {
    if (provider !== 'codex' && provider !== 'claude') throw Error('Select Codex or Claude Code as the skill destination.');
    return this.queue.run(async () => {
      const files = unwrapArchive(await readArchive(file,options), 'SKILL.md'), markdown = files.find(f => f.name === 'SKILL.md')!.data.toString('utf8'), metadata = skillMetadata(markdown, path.basename(file, '.zip'));
      const name = metadata.name.normalize('NFKC').replace(/[^\p{L}\p{N}_.-]/gu, '-').replace(/^[.-]+|[. ]+$/g, '').slice(0, 100);
      if (!name) throw Error('Skill name cannot form an installation directory.');
      const root = provider === 'codex' ? path.join(this.home, '.agents', 'skills') : path.join(this.claudeHome, 'skills');
      await installArchive(path.join(root, name), files); this.revision++; return this.scan();
    });
  }
  async exportZip(id: string, expectedHash: string, destination: string) { const skill = await this.readMarkdown(id, expectedHash); return exportArchive(skill.directory, destination); }
  async createDiscoverySnapshot(input: { sessionId: string; nativeRuntime?: string }) {
    // Native runtimes own discovery. Never duplicate their catalogs or inject the other runtime's skills.
    if (input.nativeRuntime === 'codex' || input.nativeRuntime === 'claude') return createFrameworkSnapshot([], { sessionId: input.sessionId, revision: this.revision, memoryEnabled: false, source: 'native-provider-files' });
    const revision = this.revision, { skills } = await this.scan();
    const entries = skills.filter(s => s.available).map(s => ({ id: s.id, name: s.name, description: s.description, hash: s.hash, path: s.path, origins: s.origins, warning: s.warning ? 'Contains Claude dynamic commands or runtime-specific settings. Read the original file; do not evaluate interpolation in another runtime.' : undefined }));
    const content = JSON.stringify({ version: 1, entries, disabledPaths: skills.filter(s => !s.available && s.path).map(s => s.path), policy: 'This supplemental catalog is not a runtime permission boundary. Native skill controls apply to new local native sessions, not independent remote installations, session launch overrides, or already loaded context. Existing sessions are not forcibly reloaded. Read SKILL.md at its native path before use; supporting scripts and assets remain beside it. Do not execute Claude interpolation in another runtime.' });
    return createFrameworkSnapshot(entries.length || skills.length ? [{ id: 'native-skills', kind: 'skill-catalog', title: 'Native skills', content, sourceHash: sharedHash(content) }] : [], { sessionId: input.sessionId, revision, memoryEnabled: false, source: 'native-provider-files' }, () => this.revision === revision);
  }
}
