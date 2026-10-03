import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function assertNoLinks(target: string, allowMissing = false): Promise<void> {
  const absolute = path.resolve(target); const parsed = path.parse(absolute); let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { const item = await lstat(current); if (item.isSymbolicLink()) throw new Error('Shared data paths may not traverse symbolic links or junctions.'); }
    catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
}
export class SharedDataRoot {
  readonly root: string;
  constructor(userDataDirectory: string, component: 'memories' | 'skills') {
    if (!path.isAbsolute(userDataDirectory) || /[\0\r\n]/.test(userDataDirectory)) throw new Error('A framework-owned absolute userData directory is required.');
    this.root = path.join(path.normalize(userDataDirectory), 'shared', component);
  }
  async initialize(): Promise<void> { await assertNoLinks(this.root, true); await mkdir(this.root, { recursive: true, mode: 0o700 }); await assertNoLinks(this.root); }
  resolve(relative: string): string {
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..') || /[\0\r\n:]/.test(relative)) throw new Error('Invalid shared-data relative path.');
    const resolved = path.join(this.root, relative); if (!resolved.startsWith(this.root + path.sep)) throw new Error('Shared data path escaped its root.'); return resolved;
  }
  async read(relative: string, maximum = 2 * 1024 * 1024): Promise<string> {
    const target = this.resolve(relative); await assertNoLinks(target);
    const handle = await open(target, 'r');
    try {
      const before = await handle.stat(); if (!before.isFile() || before.size > maximum) throw new Error('Shared data must be a bounded regular file.');
      const buffer = Buffer.alloc(Math.min(maximum + 1, before.size + 1)); let length = 0;
      while (length < buffer.length) { const result = await handle.read(buffer, length, buffer.length - length, length); if (!result.bytesRead) break; length += result.bytesRead; }
      if (length > maximum) throw new Error('Shared data exceeded the size limit.');
      const after = await handle.stat(); if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || length !== after.size) throw new Error('Shared data changed while being read.');
      await assertNoLinks(target); return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
    } finally { await handle.close(); }
  }
  async write(relative: string, text: string): Promise<void> {
    const target = this.resolve(relative); await assertNoLinks(target, true); await assertNoLinks(path.dirname(target));
    const temporary = `${target}.${randomUUID()}.tmp`; const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    try { await assertNoLinks(target, true); await rename(temporary, target); } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
  async ensureDirectory(relative: string): Promise<void> { const target = this.resolve(relative); await assertNoLinks(target, true); await mkdir(target, { recursive: true, mode: 0o700 }); await assertNoLinks(target); }
  async remove(relative: string): Promise<void> { const target = this.resolve(relative); await assertNoLinks(target); const item = await lstat(target); if (!item.isFile() || item.nlink > 1) throw new Error('Only the exact managed regular file may be removed.'); await unlink(target); }
}

/** Read one explicitly chosen file, never enumerate its parent or a global skill directory. */
export async function readExplicitSkillFile(selectedPath: string, maximum = 128 * 1024): Promise<string> {
  if (!path.isAbsolute(selectedPath) || path.basename(selectedPath) !== 'SKILL.md' || /[\0\r\n]/.test(selectedPath)) throw new Error('Select an explicit absolute SKILL.md file.');
  await assertNoLinks(selectedPath); const resolved = await realpath(selectedPath);
  const item = await lstat(resolved); if (!item.isFile() || item.size > maximum) throw new Error('SKILL.md must be a bounded regular file.');
  const handle = await open(resolved, 'r');
  try { const buffer = Buffer.alloc(Math.min(maximum + 1, item.size + 1)); let length = 0; while (length < buffer.length) { const read = await handle.read(buffer, length, buffer.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; } if (length > maximum) throw new Error('SKILL.md is too large.'); const after = await handle.stat(); if (after.size !== item.size || after.mtimeMs !== item.mtimeMs || length !== after.size) throw new Error('SKILL.md changed while reading.'); await assertNoLinks(selectedPath); return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length)); }
  finally { await handle.close(); }
}

export function assertSafeReference(id: string): void { if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) throw new Error('Invalid shared item identifier.'); }
export function rejectCredentialText(content: string): void {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._-]{16,}|\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}|\b(?:access_token|refresh_token|api_key)\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}/i.test(content)) throw new Error('Potential credentials must not be stored in shared memory or skills.');
}
