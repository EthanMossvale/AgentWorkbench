import path from 'node:path';
import os from 'node:os';
import { realpath, stat, opendir, open } from 'node:fs/promises';
import { fileReference } from '../../../packages/navigation/file-links';
export interface FileView { path: string; parent: string; kind: 'directory' | 'text' | 'unsupported'; entries?: { name: string; path: string; directory: boolean }[]; content?: string; truncated?: boolean; line?: number; size?: number }
/** Interactive local UI only, not a model tool or an authority grant. No writes or execution. */
export async function resolveBrowsePath(cwd: string, requested?: string): Promise<string> {
  return realpath(normalizeBrowsePath(cwd, requested));
}
/** Pure path mapping, shared by local and network-share navigation. */
export function normalizeBrowsePath(cwd: string, requested?: string): string {
  const ref = fileReference(requested ?? cwd); if (!ref) throw Error('无法识别此文件路径。');
  const value = /^~[\\/]/.test(ref.path) ? path.join(os.homedir(), ref.path.slice(2)) : ref.path;
  if (process.platform === 'win32' && value.startsWith('/')&&!value.startsWith('//')) throw Error('这是 POSIX 路径，不能映射为本机 Windows 路径。');
  if (process.platform !== 'win32' && /^[a-z]:/i.test(value)) throw Error('此 Windows 路径不属于当前设备。');
  if (!path.isAbsolute(value) && !path.isAbsolute(cwd)) throw Error('此任务尚未选择工作目录。');
  return path.resolve(cwd, value);
}
export async function browseFile(cwd: string, requested?: string): Promise<FileView> {
  const target = await resolveBrowsePath(cwd, requested), metadata = await stat(target), parent = path.dirname(target);
  if (metadata.isDirectory()) {
    const entries: NonNullable<FileView['entries']> = []; let truncated = false;
    const directory = await opendir(target);
    for await (const item of directory) { if (entries.length >= 1000) { truncated = true; break; } entries.push({ name: item.name, path: path.join(target, item.name), directory: item.isDirectory() }); }
    entries.sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name));
    return { path: target, parent, kind: 'directory', entries, truncated };
  }
  const base = { path: target, parent, size: metadata.size, line: fileReference(requested ?? '')?.line };
  if (!metadata.isFile() || metadata.size > 1024*1024) return { ...base, kind: 'unsupported' };
  const handle = await open(target, 'r');
  try {
    const actual = await handle.stat(); if (!actual.isFile()) return { ...base, kind: 'unsupported' };
    const buffer = Buffer.alloc(1024*1024+1); let bytesRead = 0;
    while (bytesRead < buffer.length) { const chunk = await handle.read(buffer, bytesRead, buffer.length-bytesRead, bytesRead); if (!chunk.bytesRead) break; bytesRead += chunk.bytesRead; }
    if (bytesRead > 1024*1024 || buffer.subarray(0,bytesRead).includes(0)) return { ...base, kind: 'unsupported' };
    try { return { ...base, kind: 'text', content: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0,bytesRead)) }; } catch { return { ...base, kind: 'unsupported' }; }
  } finally { await handle.close(); }
}
