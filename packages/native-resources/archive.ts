import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicWrite, childPath, noLinks } from './files';

export interface ArchiveFile { name: string; data: Buffer }
const LIMIT = 64 * 1024 * 1024, MAX_FILES = 4096;
function crc(data: Buffer) { let value = 0xffffffff; for (const byte of data) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function validateEntries(files: ArchiveFile[]) {
  if (!files.length || files.length > MAX_FILES || files.reduce((n, f) => n + f.data.length, 0) > LIMIT) throw Error('Archive exceeds resource limits.');
  const seen = new Set<string>();
  for (const file of files) { childPath(path.resolve('archive'), file.name); const key = file.name.toLowerCase(); if (seen.has(key)) throw Error('Duplicate archive path.'); seen.add(key); }
  for (const key of seen) { const parts = key.split('/'); while (parts.length > 1) { parts.pop(); if (seen.has(parts.join('/'))) throw Error('Archive file/directory collision.'); } }
}
export function encodeZip(files: ArchiveFile[]): Buffer {
  validateEntries(files); const body: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), checksum = crc(file.data), local = Buffer.alloc(30), entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(file.data.length, 18); local.writeUInt32LE(file.data.length, 22); local.writeUInt16LE(name.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(file.data.length, 20); entry.writeUInt32LE(file.data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    body.push(local, name, file.data); central.push(entry, name); offset += local.length + name.length + file.data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, directory, end]);
}
export function decodeZip(data: Buffer): ArchiveFile[] {
  if (data.length > LIMIT + 2 * 1024 * 1024) throw Error('Archive is too large.');
  let end = -1; for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { end = i; break; }
  if (end < 0) throw Error('Invalid ZIP end record.');
  const count = data.readUInt16LE(end + 10), size = data.readUInt32LE(end + 12), start = data.readUInt32LE(end + 16);
  if (data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6) || count !== data.readUInt16LE(end + 8) || count > MAX_FILES || start + size !== end) throw Error('Split/ZIP64 archives are not supported.');
  const files: ArchiveFile[] = []; let cursor = start, total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) throw Error('Invalid ZIP directory.');
    const flags = data.readUInt16LE(cursor + 8), method = data.readUInt16LE(cursor + 10), compressed = data.readUInt32LE(cursor + 20), uncompressed = data.readUInt32LE(cursor + 24), nameLength = data.readUInt16LE(cursor + 28), extra = data.readUInt16LE(cursor + 30), comment = data.readUInt16LE(cursor + 32), offset = data.readUInt32LE(cursor + 42), attributes = data.readUInt32LE(cursor + 38);
    if (flags & 1 || ![0, 8].includes(method) || (attributes >>> 16 & 0xf000) === 0xa000 || uncompressed > LIMIT || compressed > LIMIT || cursor + 46 + nameLength + extra + comment > end) throw Error('Unsupported or unsafe ZIP entry.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(cursor + 46, cursor + 46 + nameLength));
    if (offset + 30 > start || data.readUInt32LE(offset) !== 0x04034b50 || data.readUInt16LE(offset + 8) !== method || data.readUInt16LE(offset + 6) !== flags) throw Error('Invalid ZIP local header.');
    const localLength = data.readUInt16LE(offset + 26), dataStart = offset + 30 + localLength + data.readUInt16LE(offset + 28);
    if (dataStart + compressed > start || !data.subarray(offset + 30, offset + 30 + localLength).equals(Buffer.from(name))) throw Error('ZIP path or size mismatch.');
    total += uncompressed; if (total > LIMIT) throw Error('Expanded ZIP is too large.');
    const packed = data.subarray(dataStart, dataStart + compressed), decoded = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: Math.max(1, uncompressed) });
    if (decoded.length !== uncompressed || crc(decoded) !== data.readUInt32LE(cursor + 16)) throw Error('ZIP integrity check failed.');
    if (name.endsWith('/')) { childPath(path.resolve('archive'), name.slice(0, -1)); if (decoded.length) throw Error('ZIP directory contains data.'); }
    else files.push({ name, data: decoded });
    cursor += 46 + nameLength + extra + comment;
  }
  if (cursor !== end) throw Error('ZIP directory length mismatch.'); validateEntries(files); return files;
}
export function unwrapArchive(files: ArchiveFile[], marker: string): ArchiveFile[] {
  const clean = files.filter(f => !f.name.startsWith('__MACOSX/') && !f.name.endsWith('/.DS_Store'));
  if (clean.some(f => f.name === marker)) return clean;
  const prefix = clean[0]?.name.split('/')[0];
  if (!prefix || !clean.every(f => f.name.startsWith(`${prefix}/`))) throw Error(`Archive must contain ${marker} at its root or one enclosing folder.`);
  const stripped = clean.map(f => ({ ...f, name: f.name.slice(prefix.length + 1) }));
  if (!stripped.some(f => f.name === marker)) throw Error(`Archive is missing ${marker}.`); return stripped;
}
export async function readArchive(file: string) { await noLinks(file, true); const info = await lstat(file); if (!info.isFile() || info.size > LIMIT + 2 * 1024 * 1024) throw Error('Archive file is too large.'); return decodeZip(await readFile(file)); }
export async function collectDirectory(directory: string): Promise<ArchiveFile[]> {
  const files: ArchiveFile[] = []; let total = 0;
  async function visit(current: string, prefix: string) {
    await noLinks(current, true);
    for (const item of await readdir(current, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.DS_Store', 'Thumbs.db'].includes(item.name)) continue;
      const name = prefix + item.name, file = childPath(directory, name); await noLinks(file, true); const info = await lstat(file);
      if (item.isDirectory()) await visit(file, `${name}/`);
      else if (info.isFile()) { total += info.size; if (total > LIMIT || files.length >= MAX_FILES) throw Error('Resource package exceeds export limits.'); files.push({ name, data: await readFile(file) }); }
      else throw Error('Only regular files may be exported.');
    }
  }
  await visit(directory, ''); validateEntries(files); return files;
}
export async function installArchive(directory: string, files: ArchiveFile[]) {
  validateEntries(files); await noLinks(directory); await mkdir(path.dirname(directory), { recursive: true });
  try { await lstat(directory); throw Error('Destination already exists; packages are never overwritten.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const staging = `${directory}.import-${randomUUID()}`;
  try { await mkdir(staging); for (const file of files) { const target = childPath(staging, file.name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, file.data, { flag: 'wx', mode: 0o600 }); } await noLinks(directory); try { await lstat(directory); throw Error('Destination appeared during import.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } await rename(staging, directory); }
  finally { await rm(staging, { recursive: true, force: true }); }
}
export async function exportArchive(directory: string, destination: string) { const files = await collectDirectory(directory); await atomicWrite(destination, encodeZip(files)); return { path: destination, fileCount: files.length }; }
