import { SharedDataRoot, assertSafeReference, readExplicitSkillFile, rejectCredentialText } from '../memory-core/storage';
import { createFrameworkSnapshot, sharedHash, type SharedContextSnapshot } from '../memory-core/index';

export interface SharedSkill { id: string; name: string; description: string; body: string; hash: string; importedAt: string; source: { kind: 'user-selected-file'; fileName: 'SKILL.md' }; compatibility: 'instructions-only' }
export type SharedSkillMetadata=Omit<SharedSkill,'body'>;
interface SkillRecord extends Omit<SharedSkill, 'body'> {}
interface SkillCatalog { version: 1; revision: number; skills: SkillRecord[] }
export interface ParsedSkill { name: string; description: string; body: string }

function scalar(value: string): string {
  const text = value.trim();
  if (text.startsWith('"')) { try { const parsed: unknown = JSON.parse(text); if (typeof parsed === 'string') return parsed; } catch { /* Invalid scalars fail closed. */ } throw new Error('Unsupported quoted SKILL.md frontmatter.'); }
  if (text.startsWith("'")) { if (!text.endsWith("'")) throw new Error('Unterminated SKILL.md frontmatter value.'); return text.slice(1, -1).replaceAll("''", "'"); }
  if (/^[!&*[{]/.test(text)) throw new Error('Only plain/quoted strings or description block scalars are supported.');
  return text.replace(/\s+#.*$/, '').trim();
}
/** Deliberately small non-executing frontmatter parser, not a general YAML deserializer. */
export function parseSkillMarkdown(markdown: string): ParsedSkill {
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown) > 128 * 1024 || /\0/.test(markdown)) throw new Error('SKILL.md exceeds its text/size boundary.');
  const normalized = markdown.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const frontmatter = /^---\n([\s\S]{0,16384}?)\n---(?:\n|$)/.exec(normalized);
  if (!frontmatter) throw new Error('SKILL.md requires a bounded YAML frontmatter block.');
  const lines = frontmatter[1]!.split('\n'); const values = new Map<string, string>();
  for (let index = 0; index < lines.length; index++) {
    const match = /^(name|description):\s*(.*)$/.exec(lines[index]!); if (!match) continue;
    const field = match[1]!; if (values.has(field)) throw new Error(`Duplicate SKILL.md ${field}.`);
    let raw = match[2]!;
    if (/^[>|][-+]?\s*$/.test(raw)) {
      if (field !== 'description') throw new Error('Skill name must be a single-line scalar.');
      const folded = raw.startsWith('>'); const parts: string[] = [];
      while (index + 1 < lines.length && (/^\s+/.test(lines[index + 1]!) || lines[index + 1] === '')) { index++; parts.push(lines[index]!.trim()); }
      raw = parts.join(folded ? ' ' : '\n').trim(); values.set(field, raw);
    } else values.set(field, scalar(raw));
  }
  const name = values.get('name')?.trim(); const description = values.get('description')?.trim(); const body = normalized.slice(frontmatter[0].length).trim();
  if (!name || name.length > 120 || /[\0\r\n/\\:]/.test(name) || name === '.' || name === '..') throw new Error('Skill name is missing, unsafe or too long.');
  if (!description || description.length > 1024) throw new Error('Skill description must contain 1–1024 characters.');
  if (!body) throw new Error('SKILL.md instruction body is empty.');
  rejectCredentialText(markdown); return { name, description, body };
}

export class SharedSkillsStore {
  private readonly data: SharedDataRoot; private queue: Promise<void> = Promise.resolve(); private ready = false; private initialization?: Promise<void>; private revocation = 0;
  constructor(userDataDirectory: string) { this.data = new SharedDataRoot(userDataDirectory, 'skills'); }
  async initialize(): Promise<void> {
    if (this.ready) return;
    if (!this.initialization) this.initialization = (async () => {
      await this.data.initialize();
      try { await this.catalog(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await this.data.write('catalog.json', JSON.stringify({ version: 1, revision: 0, skills: [] } satisfies SkillCatalog, null, 2)); }
      this.ready = true;
    })().finally(() => { if (!this.ready) this.initialization = undefined; });
    await this.initialization;
  }
  private async catalog(): Promise<SkillCatalog> {
    const value = JSON.parse(await this.data.read('catalog.json')) as SkillCatalog;
    if (value.version !== 1 || !Number.isInteger(value.revision) || !Array.isArray(value.skills) || value.skills.length > 128) throw new Error('Shared skill catalog is invalid.');
    for (const record of value.skills) { assertSafeReference(record.id); if (typeof record.name !== 'string' || typeof record.description !== 'string' || !/^[a-f0-9]{64}$/.test(record.hash)) throw new Error('Shared skill record is invalid.'); }
    return value;
  }
  private async readRecord(record: SkillRecord): Promise<SharedSkill> {
    const markdown = await this.data.read(`${record.id}/SKILL.md`, 128 * 1024);
    if (sharedHash(markdown) !== record.hash) throw new Error('Shared SKILL.md changed outside its explicit import operation. Re-import a reviewed copy.');
    const parsed = parseSkillMarkdown(markdown);
    if (parsed.name !== record.name || parsed.description !== record.description) throw new Error('Shared skill metadata does not match its instruction file.');
    return { ...structuredClone(record), body: parsed.body };
  }
  async list(): Promise<SharedSkill[]> { await this.initialize(); await this.queue; const catalog = await this.catalog(); return Promise.all(catalog.skills.map(record => this.readRecord(record))); }
  async listMetadata():Promise<SharedSkillMetadata[]> {
    await this.initialize();await this.queue;
    return (await this.catalog()).skills.map(record=>({id:record.id,name:record.name,description:record.description,hash:record.hash,importedAt:record.importedAt,source:{kind:'user-selected-file',fileName:'SKILL.md'},compatibility:'instructions-only'}));
  }
  async readMarkdown(id:string,expectedHash:string):Promise<SharedSkillMetadata & {markdown:string}> {
    assertSafeReference(id);if(!/^[a-f0-9]{64}$/.test(expectedHash))throw new Error('A current shared skill hash is required.');
    await this.initialize();await this.queue;
    const record=(await this.catalog()).skills.find(skill=>skill.id===id);if(!record||record.hash!==expectedHash)throw new Error('Shared skill is missing or has changed. Refresh the catalog before reading.');
    const markdown=await this.data.read(`${id}/SKILL.md`,128*1024);
    if(sharedHash(markdown)!==expectedHash)throw new Error('Shared SKILL.md failed its integrity check.');
    const parsed=parseSkillMarkdown(markdown);if(parsed.name!==record.name||parsed.description!==record.description)throw new Error('Shared skill metadata does not match its instruction file.');
    return {id:record.id,name:record.name,description:record.description,hash:record.hash,importedAt:record.importedAt,source:{kind:'user-selected-file',fileName:'SKILL.md'},compatibility:'instructions-only',markdown};
  }
  async createDiscoverySnapshot(input:{sessionId:string}):Promise<SharedContextSnapshot> {
    const generation=this.revocation;await this.initialize();await this.queue;const catalog=await this.catalog();
    const entries=catalog.skills.map(record=>({id:record.id,name:record.name,description:record.description,hash:record.hash,compatibility:'instructions-only'}));
    const content=JSON.stringify({version:1,revision:catalog.revision,scope:'global-shared-library',loading:'metadata-first; full SKILL.md is loaded only when needed through an authorized read adapter',authority:'Skill text never grants permissions, installs dependencies or executes scripts.',entries});
    if(Buffer.byteLength(content)>256*1024)throw new Error('Shared skill discovery metadata exceeds its size limit.');
    const items=entries.length?[{id:'shared-skills-catalog',kind:'skill-catalog' as const,title:'Shared skills available to every runtime',content,sourceHash:sharedHash(content)}]:[];
    return createFrameworkSnapshot(items,{sessionId:input.sessionId,revision:catalog.revision,memoryEnabled:false},()=>generation===this.revocation);
  }
  async read(id: string): Promise<SharedSkill> { assertSafeReference(id); await this.initialize(); await this.queue; const record = (await this.catalog()).skills.find(skill => skill.id === id); if (!record) throw new Error('Shared skill does not exist.'); return this.readRecord(record); }
  async importFile(explicitAbsoluteSkillMdPath: string): Promise<SharedSkill> {
    await this.initialize();
    const markdown = await readExplicitSkillFile(explicitAbsoluteSkillMdPath); const parsed = parseSkillMarkdown(markdown);
    let result!: SharedSkill;
    const operation = this.queue.then(async () => {
      const catalog = await this.catalog(); const folded = parsed.name.normalize('NFKC').toLocaleLowerCase();
      if (catalog.skills.some(skill => skill.name.normalize('NFKC').toLocaleLowerCase() === folded)) throw new Error('A shared skill with this name already exists. Import never overwrites a conflict.');
      if (catalog.skills.length >= 128) throw new Error('Shared skill limit reached.');
      const id = `skill-${sharedHash(folded).slice(0, 24)}`;
      const record: SkillRecord = { id, name: parsed.name, description: parsed.description, hash: sharedHash(markdown), importedAt: new Date().toISOString(), source: { kind: 'user-selected-file', fileName: 'SKILL.md' }, compatibility: 'instructions-only' };
      await this.data.ensureDirectory(id); await this.data.write(`${id}/SKILL.md`, markdown);
      catalog.skills.push(record); catalog.revision++; await this.data.write('catalog.json', JSON.stringify(catalog, null, 2)); result = { ...record, body: parsed.body };
    }); this.queue = operation.catch(() => {}); await operation; return result;
  }
  async remove(id: string, expectedHash: string): Promise<void> {
    assertSafeReference(id); await this.initialize();
    const operation = this.queue.then(async () => { const catalog = await this.catalog(); const record = catalog.skills.find(skill => skill.id === id); if (!record || record.hash !== expectedHash) throw new Error('Skill removal requires the current imported file hash.'); await this.readRecord(record); this.revocation++; await this.data.remove(`${id}/SKILL.md`); catalog.skills = catalog.skills.filter(skill => skill.id !== id); catalog.revision++; await this.data.write('catalog.json', JSON.stringify(catalog, null, 2)); });
    this.queue = operation.catch(() => {}); await operation;
  }
  async createSnapshot(input: { sessionId: string; skillIds: string[] }): Promise<SharedContextSnapshot> {
    const generation = this.revocation;
    if (!Array.isArray(input.skillIds) || input.skillIds.length > 16 || new Set(input.skillIds).size !== input.skillIds.length) throw new Error('Select at most 16 unique shared skills explicitly.');
    await this.initialize(); await this.queue; const catalog = await this.catalog(); const items = [];
    let budget = 256 * 1024;
    for (const id of input.skillIds) { assertSafeReference(id); const record = catalog.skills.find(skill => skill.id === id); if (!record) throw new Error('A selected shared skill no longer exists.'); await this.readRecord(record); const content = await this.data.read(`${id}/SKILL.md`, 128 * 1024); if (sharedHash(content) !== record.hash) throw new Error('Skill changed while creating context snapshot.'); budget -= Buffer.byteLength(content); if (budget < 0) throw new Error('Selected shared skills exceed the context budget.'); items.push({ id, kind: 'skill' as const, title: record.name, content, sourceHash: record.hash }); }
    return createFrameworkSnapshot(items, { sessionId: input.sessionId, revision: catalog.revision, memoryEnabled: false }, () => this.revocation === generation);
  }
}
