import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';

export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export const samePath = (a: string, b: string) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
export function childPath(root: string, name: string): string {
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..' || /[:\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw Error('Unsafe resource path.');
  const target = path.resolve(root, ...name.split('/'));
  if (!path.relative(root, target) || path.relative(root, target).startsWith('..')) throw Error('Resource path escapes its root.');
  return target;
}
/** Native skill roots may be symlinks. Mutations and archive descendants may not be. */
export async function noLinks(target: string, allowHardlinks = false): Promise<void> {
  const absolute = path.resolve(target), parsed = path.parse(absolute); let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { const info = await lstat(current); if (info.isSymbolicLink() || (!allowHardlinks && info.isFile() && info.nlink > 1)) throw Error('Linked resources cannot be changed; export supports regular hardlinked files.'); }
    catch (error) { if (!missing(error)) throw error; }
  }
}
export async function textFile(file: string, max = 2 * 1024 * 1024): Promise<string> {
  const handle = await open(file, 'r');
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > max) throw Error('Resource is not a bounded regular file.'); const value = await handle.readFile(); if (value.length > max || value.includes(0)) throw Error('Resource is not bounded UTF-8 text.'); return new TextDecoder('utf-8', { fatal: true }).decode(value); }
  finally { await handle.close(); }
}
export async function optionalText(file: string, max?: number): Promise<string | undefined> { try { return await textFile(file, max); } catch (error) { if (missing(error)) return undefined; throw error; } }
export async function atomicWrite(file: string, value: string | Buffer, beforeReplace?: () => Promise<void>): Promise<void> {
  await noLinks(file); await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { const handle = await open(temporary, 'wx', 0o600); try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); } await noLinks(file); await beforeReplace?.(); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
export async function canonicalDirectory(directory: string): Promise<string> { const resolved = await realpath(directory); if (!(await lstat(resolved)).isDirectory()) throw Error('Resource root must be a directory.'); return resolved; }
export async function readJson<T>(file: string, fallback: T): Promise<T> { const text = await optionalText(file); return text === undefined ? structuredClone(fallback) : JSON.parse(text.replace(/^\uFEFF/, '')) as T; }
export class SerialQueue {
  private pending: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> { const result = this.pending.then(operation); this.pending = result.catch(() => {}); return result; }
  async idle() { await this.pending; }
}
