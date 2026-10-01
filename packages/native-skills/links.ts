import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readlink, realpath, symlink, unlink } from 'node:fs/promises';
import { atomicWrite, canonicalDirectory, childPath, digest, missing, readJson, samePath, textFile } from '../native-resources/files';
import type { NativeSkill } from './index';

export type SkillRuntime = 'codex' | 'claude';
export type SkillLinkAction = 'connect' | 'disconnect';
export interface SkillConnection {
  status: 'connected' | 'missing' | 'conflict' | 'broken' | 'unavailable';
  ownership?: 'workbench' | 'external' | 'mixed';
  canConnect: boolean; canDisconnect: boolean;
  managedCount: number; externalCount: number;
  reason?: string; entryPath?: string; targetPath?: string;
  revision: string;
}
export interface SkillLinkRequest { runtime: SkillRuntime; action: SkillLinkAction; skills: { id: string; hash: string }[] }
export interface SkillLinkPlan {
  id: string; runtime: SkillRuntime; action: SkillLinkAction; expiresAt: number;
  items: { id: string; name: string; hash: string; operation: 'create' | 'remove' | 'reuse' | 'skip'; count: number; reason?: string }[];
  counts: { create: number; remove: number; reuse: number; skip: number };
}
export interface SkillLinkResult {
  runtime: SkillRuntime; action: SkillLinkAction;
  items: { id: string; status: 'created' | 'removed' | 'reused' | 'skipped' | 'failed'; count: number; error?: string }[];
}
interface Entry { path: string; physical?: string; state: 'missing' | 'directory' | 'link' | 'broken' | 'other'; target?: string; identity?: string }
interface Owned { runtime: SkillRuntime; source: string; identity: string }
interface Ledger { version: 1; entries: Record<string, Owned> }
interface Root { logical: string; physical: string; anchor: string; identity: string }
interface Prepared { connection: SkillConnection; entries: Entry[]; destination: Entry; root: Root; source: string; sourceIdentity: string }
const key = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const runtimeValid = (value: unknown): value is SkillRuntime => value === 'codex' || value === 'claude';
const identity = (info: Awaited<ReturnType<typeof lstat>>) => [info.dev, info.ino, info.birthtimeMs].join(':');
const inside = (parent: string, child: string) => samePath(parent, child) || (!path.relative(parent, child).startsWith('..') && !path.isAbsolute(path.relative(parent, child)));
const eligible = (skill: NativeSkill) => !skill.builtin && !skill.origins.some(o => o.kind === 'official' || o.pluginId) && skill.origins.some(o => o.kind === 'personal' && o.entryPath && !samePath(o.entryPath, o.root));

async function inspect(entry: string): Promise<Entry> {
  try {
    const info = await lstat(entry), physical = path.join(await canonicalDirectory(path.dirname(entry)), path.basename(entry));
    if (info.isSymbolicLink()) {
      const raw = await readlink(entry), fingerprint = digest(identity(info) + ':' + info.ctimeMs + ':' + raw);
      try { const target = await canonicalDirectory(entry); return { path: entry, physical, state: 'link', target, identity: fingerprint }; }
      catch (error) { if (missing(error) || (error as NodeJS.ErrnoException).code === 'ELOOP' || (error as Error).message === 'Resource root must be a directory.') return { path: entry, physical, state: 'broken', identity: fingerprint }; throw error; }
    }
    return { path: entry, physical, state: info.isDirectory() ? 'directory' : 'other', target: info.isDirectory() ? await realpath(entry) : undefined, identity: identity(info) };
  } catch (error) { if (missing(error)) return { path: entry, state: 'missing' }; throw error; }
}

/** Resolve only configured native roots; missing suffixes are pinned to an existing physical ancestor. */
async function inspectRoot(logical: string): Promise<Root> {
  let current = logical; const suffix: string[] = [];
  for (;;) {
    try {
      const info = await lstat(current);
      const anchor = await canonicalDirectory(current), stat = await lstat(anchor);
      return { logical, physical: path.join(anchor, ...suffix), anchor, identity: digest(identity(info) + ':' + identity(stat) + ':' + anchor) };
    } catch (error) {
      if (!missing(error)) throw error;
      // An existing broken link must not be treated as an absent directory.
      try { await lstat(current); throw Error('SKILL_LINK_ROOT_BROKEN'); } catch (again) { if (!missing(again)) throw again; }
      const parent = path.dirname(current); if (parent === current) throw Error('SKILL_LINK_ROOT_UNAVAILABLE');
      suffix.unshift(path.basename(current)); current = parent;
    }
  }
}

/** Filesystem distribution only. Native runtimes continue to own discovery and enablement. */
export class NativeSkillLinks {
  private plans = new Map<string, { plan: SkillLinkPlan; revisions: Map<string, string> }>();
  private file: string;
  constructor(directory: string, private roots: () => Record<SkillRuntime, string>, private now = () => Date.now()) { this.file = path.join(directory, 'native-skill-links.json'); }
  private async ledger() {
    const ledger = await readJson<Ledger>(this.file, { version: 1, entries: {} });
    if (ledger.version !== 1 || !ledger.entries || Array.isArray(ledger.entries) || Object.values(ledger.entries).some(e => !e || !runtimeValid(e.runtime) || typeof e.source !== 'string' || typeof e.identity !== 'string')) throw Error('SKILL_LINK_LEDGER_INVALID');
    return ledger;
  }
  private owned(entry: Entry, runtime: SkillRuntime, source: string, ledger: Ledger) {
    const record = ledger.entries[key(entry.physical ?? entry.path)];
    return entry.state === 'link' && !!entry.target && samePath(entry.target, source) && !!record && record.runtime === runtime && samePath(record.source, source) && record.identity === entry.identity;
  }
  private async prepare(skill: NativeSkill, runtime: SkillRuntime, skills: NativeSkill[], ledger: Ledger): Promise<Prepared> {
    const source = await canonicalDirectory(skill.directory), root = await inspectRoot(this.roots()[runtime]);
    if (digest(await textFile(path.join(source, 'SKILL.md'), 256 * 1024)) !== skill.hash) throw Error('SKILL_LINK_SOURCE_CHANGED');
    const origins = skill.origins.filter(o => o.kind === 'personal' && !o.pluginId && o.entryPath);
    const name = path.basename(origins[0]?.entryPath ?? source);
    const destination = await inspect(childPath(root.logical, name));
    const entryPaths = [...new Set(skill.origins.filter(o => o.provider === runtime && o.entryPath).map(o => o.entryPath!))];
    const discovered = await Promise.all(entryPaths.map(inspect));
    if (!discovered.some(e => samePath(e.path, destination.path))) discovered.push(destination);
    const entries = discovered.filter((e, index) => discovered.findIndex(other => samePath(other.physical ?? other.path, e.physical ?? e.path)) === index);
    const connected = entries.filter(e => e.target && samePath(e.target, source));
    const owned = connected.filter(e => this.owned(e, runtime, source, ledger));
    const otherEntries = owned.length ? await Promise.all(skill.origins.filter(o => o.provider !== runtime && o.entryPath).map(o => inspect(o.entryPath!))) : [];
    const sharedEntry = owned.some(entry => otherEntries.some(other => other.physical && entry.physical && samePath(other.physical, entry.physical)));
    const allowed = eligible(skill);
    const nameConflict = skills.some(other => other.id !== skill.id && other.name.normalize('NFKC').toLowerCase() === skill.name.normalize('NFKC').toLowerCase() && other.origins.some(o => o.provider === runtime && o.kind === 'personal' && !o.pluginId));
    const circular = inside(source, root.physical) || inside(root.physical, source);
    let status: SkillConnection['status'] = connected.length ? 'connected' : 'missing', reason: string | undefined;
    if (!allowed) { reason = 'scope'; if (!connected.length) status = 'unavailable'; }
    else if (!connected.length && destination.state === 'broken') { status = 'broken'; reason = 'broken'; }
    else if (!connected.length && (destination.state !== 'missing' || nameConflict)) { status = 'conflict'; reason = 'conflict'; }
    else if (!connected.length && circular) { status = 'unavailable'; reason = 'overlap'; }
    else if (sharedEntry) reason = 'shared-entry';
    const sourceIdentity = identity(await lstat(source));
    const connection: SkillConnection = { status, managedCount: owned.length, externalCount: connected.length - owned.length,
      ownership: connected.length ? owned.length === connected.length ? 'workbench' : owned.length ? 'mixed' : 'external' : undefined,
      canConnect: allowed && status === 'missing', canDisconnect: allowed && owned.length > 0 && !sharedEntry,
      reason, entryPath: connected[0]?.path ?? destination.path, targetPath: source,
      revision: digest(JSON.stringify({ source, sourceIdentity, hash: skill.hash, root, entries, owned: owned.map(e => e.path), nameConflict, allowed, sharedEntry })) };
    return { connection, entries, destination, root, source, sourceIdentity };
  }
  async decorate(skills: NativeSkill[]) {
    const ledger = await this.ledger();
    for (const skill of skills) {
      if (skill.builtin) continue;
      skill.connections = {} as Record<SkillRuntime, SkillConnection>;
      for (const runtime of ['codex', 'claude'] as const) {
        try { skill.connections[runtime] = (await this.prepare(skill, runtime, skills, ledger)).connection; }
        catch { skill.connections[runtime] = { status: 'unavailable', canConnect: false, canDisconnect: false, managedCount: 0, externalCount: 0, reason: 'unreadable', revision: '' }; }
      }
    }
  }
  async plan(request: SkillLinkRequest, skills: NativeSkill[]): Promise<SkillLinkPlan> {
    if (!runtimeValid(request.runtime) || !['connect', 'disconnect'].includes(request.action) || !Array.isArray(request.skills) || request.skills.length < 1 || request.skills.length > 500 || request.skills.some(s => !s || !/^[a-f0-9]{32}$/.test(s.id) || !/^[a-f0-9]{64}$/.test(s.hash)) || new Set(request.skills.map(s => s.id)).size !== request.skills.length) throw Error('SKILL_LINK_REQUEST_INVALID');
    for (const [id, value] of this.plans) if (value.plan.expiresAt <= this.now()) this.plans.delete(id);
    if (this.plans.size >= 64) this.plans.delete(this.plans.keys().next().value!);
    const ledger = await this.ledger(), revisions = new Map<string, string>();
    const plan: SkillLinkPlan = { id: randomUUID(), runtime: request.runtime, action: request.action, expiresAt: this.now() + 120_000, items: [], counts: { create: 0, remove: 0, reuse: 0, skip: 0 } };
    const destinations = new Set<string>(), nativeNames = new Set<string>();
    for (const ref of request.skills) {
      const skill = skills.find(s => s.id === ref.id); if (!skill || skill.hash !== ref.hash) throw Error('SKILL_LINK_SOURCE_CHANGED');
      const state = skill.connections?.[request.runtime];
      if (!eligible(skill) || !state || state.reason === 'unreadable') { plan.items.push({ ...ref, name: skill.displayName, operation: 'skip', count: 1, reason: !eligible(skill) ? 'scope' : 'unreadable' }); plan.counts.skip++; continue; }
      const prepared = await this.prepare(skill, request.runtime, skills, ledger), c = prepared.connection;
      revisions.set(skill.id, c.revision);
      let operation: SkillLinkPlan['items'][number]['operation'] = request.action === 'connect' ? c.canConnect ? 'create' : c.status === 'connected' ? 'reuse' : 'skip' : c.canDisconnect ? 'remove' : 'skip';
      let reason = c.reason ?? (request.action === 'disconnect' ? c.externalCount ? 'external' : 'missing' : undefined);
      const nativeName = skill.name.normalize('NFKC').toLowerCase();
      if (operation === 'create' && (destinations.has(key(prepared.destination.path)) || nativeNames.has(nativeName))) { operation = 'skip'; reason = 'conflict'; }
      if (operation === 'create') { destinations.add(key(prepared.destination.path)); nativeNames.add(nativeName); }
      const count = operation === 'remove' ? c.managedCount : 1;
      plan.items.push({ ...ref, name: skill.displayName, operation, count, reason }); plan.counts[operation] += count;
    }
    this.plans.set(plan.id, { plan: structuredClone(plan), revisions }); return plan;
  }
  async apply(id: string, skills: NativeSkill[]): Promise<SkillLinkResult> {
    const saved = this.plans.get(id); this.plans.delete(id);
    if (!saved || saved.plan.expiresAt <= this.now()) throw Error('SKILL_LINK_PLAN_EXPIRED');
    const { plan, revisions } = saved, ledger = await this.ledger(), prepared = new Map<string, Prepared>();
    // Preflight the entire batch before any writes. A plan is one-shot even after failure.
    for (const item of plan.items) {
      if (item.operation === 'skip') continue;
      const skill = skills.find(s => s.id === item.id); if (!skill || skill.hash !== item.hash) throw Error('SKILL_LINK_PLAN_STALE');
      const current = await this.prepare(skill, plan.runtime, skills, ledger);
      if (current.connection.revision !== revisions.get(item.id)) throw Error('SKILL_LINK_PLAN_STALE');
      prepared.set(item.id, current);
    }
    const result: SkillLinkResult = { runtime: plan.runtime, action: plan.action, items: [] };
    let ledgerRevision = digest(JSON.stringify(ledger));
    const save = async () => { await atomicWrite(this.file, JSON.stringify(ledger, null, 2), async () => { if (digest(JSON.stringify(await this.ledger())) !== ledgerRevision) throw Error('SKILL_LINK_LEDGER_CHANGED'); }); ledgerRevision = digest(JSON.stringify(ledger)); };
    let createdRoot: Root | undefined;
    for (const item of plan.items) {
      if (item.operation === 'skip' || item.operation === 'reuse') { result.items.push({ id: item.id, status: item.operation === 'skip' ? 'skipped' : 'reused', count: item.count }); continue; }
      const state = prepared.get(item.id)!; let completed = 0;
      try {
        if (!samePath(await canonicalDirectory(state.source), state.source) || identity(await lstat(state.source)) !== state.sourceIdentity || digest(await textFile(path.join(state.source, 'SKILL.md'), 256 * 1024)) !== item.hash) throw Error('SKILL_LINK_SOURCE_CHANGED');
        if (item.operation === 'create') {
          const expected = createdRoot ?? state.root, current = await inspectRoot(state.root.logical);
          if (JSON.stringify(current) !== JSON.stringify(expected)) throw Error('SKILL_LINK_ROOT_CHANGED');
          await mkdir(state.root.physical, { recursive: true });
          createdRoot = await inspectRoot(state.root.logical);
          if (!samePath(createdRoot.physical, state.root.physical)) throw Error('SKILL_LINK_ROOT_CHANGED');
          const physicalEntry = childPath(state.root.physical, path.basename(state.destination.path));
          if ((await inspect(physicalEntry)).state !== 'missing') throw Error('SKILL_LINK_TARGET_CHANGED');
          // Junctions require no administrator elevation on Windows; never silently copy a skill.
          await symlink(state.source, physicalEntry, process.platform === 'win32' ? 'junction' : 'dir');
          const entry = await inspect(state.destination.path);
          if (entry.state !== 'link' || !entry.target || !samePath(entry.target, state.source)) throw Error('SKILL_LINK_VERIFY_FAILED');
          completed = 1;
          ledger.entries[key(entry.physical ?? entry.path)] = { runtime: plan.runtime, source: state.source, identity: entry.identity! };
          await save();
        } else {
          for (const entry of state.entries.filter(e => this.owned(e, plan.runtime, state.source, ledger))) {
            const current = await inspect(entry.path);
            if (!this.owned(current, plan.runtime, state.source, ledger) || current.identity !== entry.identity) throw Error('SKILL_LINK_TARGET_CHANGED');
            const parent = await canonicalDirectory(path.dirname(entry.path)), physicalEntry = childPath(parent, path.basename(entry.path));
            if ((await inspect(physicalEntry)).identity !== entry.identity) throw Error('SKILL_LINK_TARGET_CHANGED');
            await unlink(physicalEntry);
            if ((await inspect(entry.path)).state !== 'missing') throw Error('SKILL_LINK_VERIFY_FAILED');
            completed++;
            delete ledger.entries[key(entry.physical ?? entry.path)]; await save();
          }
        }
        result.items.push({ id: item.id, status: item.operation === 'create' ? 'created' : 'removed', count: completed });
      } catch (error) {
        result.items.push({ id: item.id, status: 'failed', count: completed, error: (error as Error).message });
        for (const pending of plan.items.slice(result.items.length)) result.items.push({ id: pending.id, status: 'skipped', count: 0, error: 'SKILL_LINK_BATCH_STOPPED' });
        break;
      }
    }
    return result;
  }
}
