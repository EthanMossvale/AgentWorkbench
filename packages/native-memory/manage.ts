import path from 'node:path';
import { rm } from 'node:fs/promises';
import { atomicWrite, digest, noLinks, optionalText, samePath } from '../native-resources/files';
import { BEGIN, END, PROJECTION, readNativeSources, splitBlock, type MemorySource, type NativeHomes, type Provider } from './sources';

export interface NativeMemoryEntry {
  id: string; revision: string; provider: Provider; name: string; relative: string; scope: string; preview: string;
}
export interface NativeMemoryDocument extends NativeMemoryEntry { content: string }
const idFor = (source: MemorySource) => digest(`${source.provider}:${process.platform === 'win32' ? path.resolve(source.file).toLowerCase() : path.resolve(source.file)}`);
export function describeMemory(source: MemorySource): NativeMemoryEntry {
  const heading = source.content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  return { id: idFor(source), revision: digest(source.content), provider: source.provider, name: (heading || path.basename(source.file)).slice(0, 160), relative: source.relative, scope: source.scope, preview: source.content.replace(/\s+/g, ' ').trim().slice(0, 160) };
}
async function discover(homes: NativeHomes) {
  const { sources, warnings } = await readNativeSources(homes);
  if (warnings.length) throw Error('Native settings could not be read; memory management is paused.');
  return sources;
}
export async function listMemories(homes: NativeHomes): Promise<NativeMemoryEntry[]> { return (await discover(homes)).map(describeMemory); }
async function resolve(homes: NativeHomes, id: string) {
  const source = (await discover(homes)).find(item => idFor(item) === id);
  if (!source) throw Error('Native memory no longer exists. Refresh the memory list.');
  return source;
}
export async function readMemory(homes: NativeHomes, id: string): Promise<NativeMemoryDocument> {
  const source = await resolve(homes, id); return { ...describeMemory(source), content: source.content };
}
/** Only IDs discovered in native memory roots are writable; callers cannot supply paths. */
export async function changeMemory(homes: NativeHomes, id: string, revision: string, content: string | null) {
  if (content !== null && (typeof content !== 'string' || !content.trim() || content.includes('\0'))) throw Error('Memory content must be nonempty UTF-8 text.');
  if (content !== null && [BEGIN, END, PROJECTION].some(marker => content.includes(marker))) throw Error('Managed synchronization markers cannot be inserted into native memory.');
  const source = await resolve(homes, id);
  if (digest(source.content) !== revision) throw Error('Native memory changed since it was opened. Reload before saving or deleting.');
  await noLinks(source.file);
  const original = await optionalText(source.file);
  if (original === undefined || digest(splitBlock(original).remainder) !== revision) throw Error('Native memory changed since it was opened. Reload before saving or deleting.');
  const { block } = splitBlock(original), next = (block ? `${block}\n` : '') + (content ?? '');
  // Keep empty instruction entry points: deleting AGENTS.override.md would activate a different file.
  const entryPoint = (samePath(source.root, homes.codex) && /^AGENTS(?:\.override)?\.md$/i.test(source.relative)) || (samePath(source.root, homes.claude) && source.relative === 'CLAUDE.md');
  await noLinks(source.file);
  if (await optionalText(source.file) !== original) throw Error('Native memory changed during the operation. Newer content was preserved.');
  if (content === null && !block && !entryPoint) await rm(source.file);
  else await atomicWrite(source.file, next);
}
