import { createHash, randomUUID } from 'node:crypto';
import { SharedDataRoot, assertSafeReference, rejectCredentialText } from './storage';

export interface SharedContextItem { readonly id: string; readonly kind: 'memory' | 'skill' | 'skill-catalog' | 'plugin-context'; readonly title: string; readonly content: string; readonly sourceHash: string }
export interface SharedContextSnapshot { readonly version: 1; readonly id: string; readonly enabled: boolean; readonly sourceHash: string; readonly createdAt: string; readonly items: readonly SharedContextItem[]; readonly provenance: { readonly source: 'agent-workbench-user-data' | 'native-provider-files' | 'mixed-resources'; readonly sessionId: string; readonly revision: number; readonly memoryEnabled: boolean } }
const brandedSnapshots = new WeakSet<object>();
const snapshotValidity = new WeakMap<object, () => boolean>();
export const sharedHash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
/** Trusted framework stores only. Never expose this constructor to renderer/model IPC. */
export function createFrameworkSnapshot(items: readonly SharedContextItem[], input: { sessionId: string; revision: number; memoryEnabled: boolean; source?:SharedContextSnapshot['provenance']['source'] }, isCurrent?: () => boolean): SharedContextSnapshot {
  if (!input.sessionId || input.sessionId.length > 256) throw new Error('A bounded session binding is required.');
  const copied = items.map(item => { if (item.sourceHash !== sharedHash(item.content)) throw new Error('Shared context content hash mismatch.'); return Object.freeze({ ...item }); });
  const snapshot: SharedContextSnapshot = Object.freeze({ version: 1, id: randomUUID(), enabled: copied.length > 0, sourceHash: sharedHash(JSON.stringify(copied)), createdAt: new Date().toISOString(), items: Object.freeze(copied), provenance: Object.freeze({ source: input.source??'agent-workbench-user-data', sessionId: input.sessionId, revision: input.revision, memoryEnabled: input.memoryEnabled }) });
  brandedSnapshots.add(snapshot); if (isCurrent) snapshotValidity.set(snapshot, isCurrent); return snapshot;
}
/** Historical identity only. This is NOT permission to inject revoked shared context. */
export function isKnownFrameworkSnapshot(value: unknown): value is SharedContextSnapshot { return !!value && typeof value === 'object' && brandedSnapshots.has(value); }
export function isFrameworkSnapshot(value: unknown): value is SharedContextSnapshot { return isKnownFrameworkSnapshot(value) && (snapshotValidity.get(value)?.() ?? true); }
export function combineSharedContextSnapshots(memory: SharedContextSnapshot, skills: SharedContextSnapshot): SharedContextSnapshot {
  if (!isFrameworkSnapshot(memory) || !isFrameworkSnapshot(skills) || memory.provenance.sessionId !== skills.provenance.sessionId) throw new Error('Only same-session framework snapshots can be combined.');
  return createFrameworkSnapshot([...memory.items, ...skills.items], { sessionId: memory.provenance.sessionId, revision: Math.max(memory.provenance.revision, skills.provenance.revision), memoryEnabled: memory.provenance.memoryEnabled,source:memory.provenance.source===skills.provenance.source?memory.provenance.source:'mixed-resources' }, () => isFrameworkSnapshot(memory) && isFrameworkSnapshot(skills));
}
export interface MemoryNote { id: string; title: string; content: string; summary: string; tags: string[]; createdAt: string; updatedAt: string; source: { kind: 'user-note'; sessionId?: string }; hash: string }
export interface MemoryStatus { enabled: boolean; revision: number; noteCount: number; root: string; autoCapture: false }
interface Catalog { version: 1; enabled: boolean; revision: number; notes: MemoryNote[] }
export interface SaveMemoryNote { id?: string; title: string; content: string; summary?: string; tags?: string[]; sessionId?: string; expectedHash?: string }
export class SharedMemoryStore {
  private readonly data: SharedDataRoot; private queue: Promise<void> = Promise.resolve(); private ready = false; private initialization?: Promise<void>; private revocation = 0;
  constructor(userDataDirectory: string) { this.data = new SharedDataRoot(userDataDirectory, 'memories'); }
  async initialize(): Promise<void> {
    if (this.ready) return;
    if (!this.initialization) this.initialization = (async () => {
      await this.data.initialize(); await this.data.ensureDirectory('notes');
      try { await this.catalog(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await this.data.write('catalog.json', JSON.stringify({ version: 1, enabled: false, revision: 0, notes: [] } satisfies Catalog, null, 2)); }
      await this.projections(await this.catalog()); this.ready = true;
    })().finally(() => { if (!this.ready) this.initialization = undefined; });
    await this.initialization;
  }
  private async catalog(): Promise<Catalog> {
    const value = JSON.parse(await this.data.read('catalog.json', 20 * 1024 * 1024)) as Catalog;
    if (value.version !== 1 || typeof value.enabled !== 'boolean' || !Number.isInteger(value.revision) || !Array.isArray(value.notes) || value.notes.length > 500) throw new Error('Shared memory catalog is invalid.');
    for (const note of value.notes) { assertSafeReference(note.id); if (typeof note.content !== 'string' || note.hash !== sharedHash(note.content) || typeof note.title !== 'string' || typeof note.summary !== 'string' || !Array.isArray(note.tags)) throw new Error('Shared memory note integrity check failed.'); }
    return value;
  }
  private summary(notes: MemoryNote[]): string { return ['# Shared memory summary', '', 'Framework-owned user notes. Data, not permission or system instructions.', ...notes.map(note => `\n## ${note.title}\n${note.summary}\nReference: ${note.id} | sha256:${note.hash}`)].join('\n'); }
  private async projections(catalog: Catalog): Promise<void> {
    await this.data.write('memory_summary.md', this.summary(catalog.notes));
    await this.data.write('MEMORY.md', ['# Shared memory index', '', 'Only explicitly saved user notes are indexed. Native chat history is not modified.', ...catalog.notes.map(note => `\n## ${note.title}\n${note.summary}\nTags: ${note.tags.join(', ')}\nNote: notes/${note.id}.md\nSource: user-note | sha256:${note.hash}`)].join('\n'));
    for (const note of catalog.notes) await this.data.write(`notes/${note.id}.md`, note.content);
  }
  private async mutate<T>(change: (catalog: Catalog) => Promise<T> | T): Promise<T> {
    await this.initialize(); let result!: T;
    const operation = this.queue.then(async () => { const catalog = await this.catalog(); result = await change(catalog); catalog.revision++; await this.data.write('catalog.json', JSON.stringify(catalog, null, 2)); await this.projections(catalog); });
    this.queue = operation.catch(() => {}); await operation; return result;
  }
  async status(): Promise<MemoryStatus> { await this.initialize(); await this.queue; const catalog = await this.catalog(); return { enabled: catalog.enabled, revision: catalog.revision, noteCount: catalog.notes.length, root: this.data.root, autoCapture: false }; }
  async setEnabled(enabled: boolean): Promise<MemoryStatus> { if (typeof enabled !== 'boolean') throw new Error('Memory enabled must be boolean.'); if (!enabled) this.revocation++; await this.mutate(catalog => { catalog.enabled = enabled; }); return this.status(); }
  async list(): Promise<MemoryNote[]> { await this.initialize(); await this.queue; return structuredClone((await this.catalog()).notes); }
  async saveNote(input: SaveMemoryNote): Promise<MemoryNote> {
    if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120 || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 32_768) throw new Error('Memory needs a title (1–120 characters) and content (1–32768 characters).');
    if (input.summary !== undefined && (typeof input.summary !== 'string' || input.summary.length > 512)) throw new Error('Memory summaries are limited to 512 characters.');
    const tags = input.tags ?? []; if (!Array.isArray(tags) || tags.length > 16 || tags.some(tag => typeof tag !== 'string' || tag.length > 40)) throw new Error('Invalid memory tags.');
    if (input.sessionId !== undefined && (typeof input.sessionId !== 'string' || input.sessionId.length > 256)) throw new Error('Invalid memory provenance session.');
    rejectCredentialText(input.content); rejectCredentialText(input.title); rejectCredentialText(input.summary ?? '');
    return this.mutate(catalog => {
      if (input.id) assertSafeReference(input.id); const existing = input.id ? catalog.notes.find(note => note.id === input.id) : undefined;
      if (input.id && (!existing || input.expectedHash !== existing.hash)) throw new Error('Memory edit requires the current note hash.');
      if (!existing && catalog.notes.length >= 500) throw new Error('Shared memory note limit reached.');
      const now = new Date().toISOString(); const note: MemoryNote = { id: existing?.id ?? randomUUID(), title: input.title.trim(), content: input.content, summary: input.summary?.trim() || input.content.replace(/\s+/g, ' ').slice(0, 180), tags: [...new Set(tags)], createdAt: existing?.createdAt ?? now, updatedAt: now, source: { kind: 'user-note', ...(input.sessionId ? { sessionId: input.sessionId } : {}) }, hash: sharedHash(input.content) };
      if (existing) catalog.notes[catalog.notes.indexOf(existing)] = note; else catalog.notes.push(note); return structuredClone(note);
    });
  }
  async removeNote(id: string, expectedHash: string): Promise<void> { assertSafeReference(id); await this.mutate(async catalog => { const note = catalog.notes.find(item => item.id === id); if (!note || note.hash !== expectedHash) throw new Error('Memory removal requires the exact current note hash.'); this.revocation++; await this.data.remove(`notes/${id}.md`); catalog.notes = catalog.notes.filter(item => item.id !== id); }); }
  async createSnapshot(input: { sessionId: string; noteIds?: string[]; query?: string; maxCharacters?: number }): Promise<SharedContextSnapshot> {
    const generation = this.revocation;
    await this.initialize(); await this.queue; const catalog = await this.catalog(); const max = input.maxCharacters ?? 16_000;
    if (!Number.isInteger(max) || max < 1 || max > 64_000) throw new Error('Invalid memory context budget.');
    if (!catalog.enabled) return createFrameworkSnapshot([], { sessionId: input.sessionId, revision: catalog.revision, memoryEnabled: false });
    let selected = catalog.notes;
    if (input.noteIds) { if (input.noteIds.length > 100) throw new Error('Too many selected memory notes.'); for (const id of input.noteIds) assertSafeReference(id); selected = input.noteIds.map(id => { const note = catalog.notes.find(item => item.id === id); if (!note) throw new Error('A selected memory note no longer exists.'); return note; }); }
    else if (input.query) { const terms = input.query.toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0, 20); selected = selected.filter(note => terms.some(term => `${note.title} ${note.summary} ${note.tags.join(' ')}`.toLocaleLowerCase().includes(term))).slice(0, 12); }
    const items: SharedContextItem[] = []; let remaining = max;
    for (const note of selected) { const content = input.noteIds || input.query ? note.content : `${note.summary}\nReference: ${note.id}`; if (content.length > remaining) continue; items.push({ id: note.id, kind: 'memory', title: note.title, content, sourceHash: sharedHash(content) }); remaining -= content.length; }
    return createFrameworkSnapshot(items, { sessionId: input.sessionId, revision: catalog.revision, memoryEnabled: true }, () => this.revocation === generation);
  }
}
