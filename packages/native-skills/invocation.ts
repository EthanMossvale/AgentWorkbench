import path from 'node:path';
import type { SkillScan } from './index';
export { skillPrompt } from '../composer-core';

export interface SkillInvocation { id: string; hash: string; runtime: 'codex' | 'claude'; name: string; displayName: string; path?: string; icon?: string }
export interface ComposerSkill extends SkillInvocation { description: string; icon?: string; source: string }
const within = (directory: string, parent: string) => { const relative = path.relative(parent, directory); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };

/** UI discovery is local and never appends a cross-runtime catalog to a prompt. */
export function composerSkills(scan: SkillScan, runtime: string, directory?: string): ComposerSkill[] {
  if (runtime !== 'codex' && runtime !== 'claude') return [];
  const entries = scan.skills.flatMap<ComposerSkill>(skill => {
    if (!skill.enabled || skill.runtimeAvailability?.[runtime] === false || skill.control?.kind === 'unavailable' || skill.userInvocable === false || (!skill.available && !skill.builtin && !skill.conflicts.length)) return [];
    const origins = skill.origins.filter(origin => origin.provider === runtime && (origin.kind !== 'project' || !!directory && within(directory, path.dirname(path.dirname(origin.root)))));
    const origin = origins[0];
    if (!origin) return [];
    const name = origin.nativeName || skill.name;
    if (/\0|[\r\n]/.test(name) || runtime === 'claude' && /\s/.test(name)) return [];
    return [{ id: skill.id, hash: skill.hash, runtime, name, displayName: skill.displayName, path: skill.builtin ? undefined : skill.path, description: skill.shortDescription, icon: skill.icon, source: `${runtime === 'claude' ? 'Claude Code' : 'Codex'} · ${origins.some(o => o.kind === 'official') ? '官方' : '个人'}` }];
  });
  return entries.filter(skill=>runtime==='codex'||entries.filter(other=>other.name===skill.name).length===1);
}

export function resolveSkills(catalog: ComposerSkill[], requested: unknown): SkillInvocation[] {
  if (requested === undefined) return [];
  if (!Array.isArray(requested)) throw Error('SKILL_SELECTION_INVALID');
  const ids = new Set<string>();
  const selected = requested.map(value => {
    if (!value || typeof value !== 'object' || Object.keys(value).some(k => !['id', 'hash'].includes(k)) || ids.has(value.id)) throw Error('SKILL_SELECTION_INVALID');
    const skill = catalog.find(item => item.id === value.id && item.hash === value.hash);
    if (!skill) throw Error('SKILL_SELECTION_STALE');
    ids.add(skill.id);
    const { id, hash, runtime, name, displayName, path, icon } = skill;
    return { id, hash, runtime, name, displayName, path, ...(icon ? {icon} : {}) };
  });
  // Claude parses one leading slash command; additional names would only be arguments.
  if (selected.length > 1 && selected.some(skill => skill.runtime === 'claude')) throw Error('SKILL_SELECTION_LIMIT');
  return selected;
}

/** The native runtime expands the selected skill, including its own arguments and permissions. */
export function codexSkillInputs(skills: readonly SkillInvocation[] = []): { type: 'skill'; name: string; path: string }[] {
  return skills.filter(skill => skill.runtime === 'codex' && skill.path).map(skill => ({ type: 'skill', name: skill.name, path: skill.path! }));
}
