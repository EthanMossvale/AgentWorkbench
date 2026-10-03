import path from 'node:path';
import { readdir, realpath, stat } from 'node:fs/promises';
import { childPath, digest, missing, noLinks, optionalText, readJson, samePath } from '../native-resources/files';

export const BEGIN = '<!-- agent-workbench-memory:start -->';
export const END = '<!-- agent-workbench-memory:end -->';
export const PROJECTION = '<!-- agent-workbench-memory:projection -->';
export type Provider = 'codex' | 'claude';
export interface MemorySource {
  provider: Provider; root: string; scope: string; relative: string; file: string; content: string; hash: string;
}
export interface NativeHomes { codex: string; claude: string; home: string; projects: string[] }
export function splitBlock(value: string) {
  const start = value.indexOf(BEGIN), end = value.indexOf(END);
  if (start < 0 && end < 0) return { block: '', remainder: value };
  if (start < 0 || end < start || value.indexOf(BEGIN, start + 1) >= 0 || value.indexOf(END, end + 1) >= 0) throw Error('The synchronization marker was edited. Native content has been preserved.');
  return { block: value.slice(start, end + END.length), remainder: value.slice(0, start) + value.slice(end + END.length).replace(/^\r?\n/, '') };
}
/** Formatting-only equivalence; never guess that two different memories mean the same thing. */
export const memoryFingerprint = (content: string) => digest(content.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').trim());
// Identical index text can link to different topics in different folders.
export const dedupKey = (source: MemorySource) => source.hash + (/\]\([^)]*\)|(?:^|\s)@\S|(?:^|[\s`])\.{1,2}\//m.test(source.content) ? `:${path.dirname(source.file)}` : '');
export async function codexInstructions(home: string) {
  const override = path.join(home, 'AGENTS.override.md');
  return await optionalText(override) !== undefined ? override : path.join(home, 'AGENTS.md');
}
export async function readNativeSources(homes: NativeHomes): Promise<{ sources: MemorySource[]; warnings: string[] }> {
  const sources: MemorySource[] = [], warnings: string[] = [], seen = new Set<string>();
  const visited = new Set<string>();
  const add = async (provider: Provider, root: string, relative: string, scope: string) => {
    const file = childPath(root, relative);
    let canonical: string; try { canonical = await realpath(file); } catch(error) { if(missing(error))return; throw error; }
    const key = `${provider}:${process.platform === 'win32' ? canonical.toLowerCase() : canonical}`;
    if (seen.has(key)) return; seen.add(key);
    const original = await optionalText(file);
    if (original === undefined || original.startsWith(PROJECTION)) return;
    const content = splitBlock(original).remainder;
    if (!content.trim()) return;
    sources.push({ provider, root, scope, relative, file, content, hash: memoryFingerprint(content) });
  };
  const walk = async (provider: Provider, root: string, scope: string, prefix = '', depth = 0): Promise<void> => {
    const directory = prefix ? childPath(root, prefix.slice(0, -1)) : root;
    let canonical: string; try { canonical = await realpath(directory); } catch(error) { if(missing(error))return; throw error; }
    const key = provider + ':' + (process.platform === 'win32' ? canonical.toLowerCase() : canonical);
    if(visited.has(key))return; visited.add(key);
    let items; try { items = await readdir(directory, { withFileTypes: true }); } catch (error) { if (missing(error)) return; throw error; }
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith('.') || item.name === 'workbench-sync' || item.name.startsWith('workbench-sync-') || ['skills', 'raw_memories', 'raw_memories.md', 'sessions'].includes(item.name)) continue;
      const relative = prefix + item.name;
      const info = item.isSymbolicLink() ? await stat(childPath(root, relative)) : item;
      if (info.isDirectory()) await walk(provider, root, scope, `${relative}/`, depth + 1);
      else if (info.isFile() && /\.md$/i.test(item.name)) await add(provider, root, relative, scope);
    }
  };
  await add('codex', homes.codex, path.basename(await codexInstructions(homes.codex)), 'User instructions (all projects)');
  await walk('codex', homes.codex, 'Codex memory; retain each entry\'s original project scope', 'memories/');
  await add('claude', homes.claude, 'CLAUDE.md', 'User instructions (all projects)');
  await walk('claude', homes.claude, 'Imported references; retain original source scope', 'memory/received/');
  await walk('claude', homes.claude, 'User rules; retain any paths frontmatter', 'rules/');
  const memoryRoots: { root: string; scope: string }[] = [];
  const settings = [{ file: path.join(homes.claude, 'settings.json'), scope: 'Claude user-configured memory' }, ...homes.projects.flatMap(project => [
    { file: path.join(project, '.claude', 'settings.json'), scope: `Project: ${project}` },
    { file: path.join(project, '.claude', 'settings.local.json'), scope: `Project: ${project}` },
  ])];
  for (const setting of settings) {
    try {
      const value = await readJson<{ autoMemoryDirectory?: unknown }>(setting.file, {});
      if (typeof value.autoMemoryDirectory === 'string') {
        const root = value.autoMemoryDirectory.startsWith('~/') ? path.join(homes.home, value.autoMemoryDirectory.slice(2)) : value.autoMemoryDirectory;
        if (path.isAbsolute(root)) memoryRoots.push({ root, scope: setting.scope });
      }
    } catch { warnings.push('A Claude settings file could not be read; standard memory locations are still included.'); }
  }
  try {
    const projects = await readdir(path.join(homes.claude, 'projects'), { withFileTypes: true });
    for (const project of projects.sort((a, b) => a.name.localeCompare(b.name))) if (project.isDirectory()) await walk('claude', homes.claude, `Claude project: ${project.name}`, `projects/${project.name}/memory/`);
  } catch (error) { if (!missing(error)) throw error; }
  for (const [index, entry] of memoryRoots.entries()) if (memoryRoots.findIndex(other => samePath(other.root, entry.root)) === index) await walk('claude', entry.root, entry.scope);
  return { sources, warnings };
}
