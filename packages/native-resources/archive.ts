import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { lstat, stat, realpath, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicWrite, childPath, noLinks } from './files';
import {archiveReaders} from './archive-reader';
import type {ArchiveReadOptions} from './archive-types';

export interface ArchiveFile { name: string; data: Buffer; link?:boolean }
const crcTable=Uint32Array.from({length:256},(_,index)=>{let value=index;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);return value>>>0;});
function crc(data: Buffer) { let value = 0xffffffff; for (const byte of data)value=(value>>>8)^crcTable[(value^byte)&255]!;return(value^0xffffffff)>>>0; }
function validateEntries(files: ArchiveFile[]) {
  if (!files.length) throw Error('Archive contains no files.');
  const seen = new Set<string>();
  for (const file of files) { childPath(path.resolve('archive'), file.name); const key = file.name.toLowerCase(); if (seen.has(key)) throw Error('Duplicate archive path.'); seen.add(key); }
  for (const key of seen) { const parts = key.split('/'); while (parts.length > 1) { parts.pop(); if (seen.has(parts.join('/'))) throw Error('Archive file/directory collision.'); } }
}
export function encodeZip(files: ArchiveFile[]): Buffer {
  validateEntries(files); const body: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), checksum = crc(file.data), local = Buffer.alloc(30), entry = Buffer.alloc(46),large=file.data.length>=0xffffffff,far=offset>=0xffffffff;
    const extra=(values:number[])=>{if(!values.length)return Buffer.alloc(0);const data=Buffer.alloc(4+values.length*8);data.writeUInt16LE(1);data.writeUInt16LE(values.length*8,2);values.forEach((value,i)=>data.writeBigUInt64LE(BigInt(value),4+i*8));return data;};
    const localExtra=extra(large?[file.data.length,file.data.length]:[]),centralExtra=extra([...(large?[file.data.length,file.data.length]:[]),...(far?[offset]:[])]);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(large?45:20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(Math.min(file.data.length,0xffffffff), 18); local.writeUInt32LE(Math.min(file.data.length,0xffffffff), 22); local.writeUInt16LE(name.length, 26);local.writeUInt16LE(localExtra.length,28);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(large||far?45:20, 4); entry.writeUInt16LE(large||far?45:20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(Math.min(file.data.length,0xffffffff), 20); entry.writeUInt32LE(Math.min(file.data.length,0xffffffff), 24); entry.writeUInt16LE(name.length, 28);entry.writeUInt16LE(centralExtra.length,30); entry.writeUInt32LE(Math.min(offset,0xffffffff), 42);
    if(file.link){entry.writeUInt16LE(0x314,4);entry.writeUInt32LE((0o120777<<16)>>>0,38);}
    body.push(local, name,localExtra,file.data); central.push(entry, name,centralExtra); offset += local.length + name.length + localExtra.length + file.data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Math.min(files.length,0xffff), 8); end.writeUInt16LE(Math.min(files.length,0xffff), 10); end.writeUInt32LE(Math.min(directory.length,0xffffffff), 12); end.writeUInt32LE(Math.min(offset,0xffffffff), 16);
  const footer:Buffer[]=[];
  if(files.length>=0xffff||directory.length>=0xffffffff||offset>=0xffffffff){const record=Buffer.alloc(56),locator=Buffer.alloc(20);record.writeUInt32LE(0x06064b50);record.writeBigUInt64LE(44n,4);record.writeUInt16LE(45,12);record.writeUInt16LE(45,14);record.writeBigUInt64LE(BigInt(files.length),24);record.writeBigUInt64LE(BigInt(files.length),32);record.writeBigUInt64LE(BigInt(directory.length),40);record.writeBigUInt64LE(BigInt(offset),48);locator.writeUInt32LE(0x07064b50);locator.writeBigUInt64LE(BigInt(offset+directory.length),8);locator.writeUInt32LE(1,16);footer.push(record,locator);}
  return Buffer.concat([...body, directory,...footer,end]);
}
export function decodeZip(data: Buffer): ArchiveFile[] {
  let end = -1; for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { end = i; break; }
  if (end < 0) throw Error('Invalid ZIP end record.');
  let count = data.readUInt16LE(end + 10), size = data.readUInt32LE(end + 12), start = data.readUInt32LE(end + 16),centralEnd=end;
  let disk=data.readUInt16LE(end+4),centralDisk=data.readUInt16LE(end+6),diskCount=data.readUInt16LE(end+8);
  if(end>=20&&data.readUInt32LE(end-20)===0x07064b50){const record=Number(data.readBigUInt64LE(end-12));if(!Number.isSafeInteger(record)||record+56>end-20||data.readUInt32LE(record)!==0x06064b50)throw Error('Invalid ZIP64 end record.');count=Number(data.readBigUInt64LE(record+32));diskCount=Number(data.readBigUInt64LE(record+24));disk=data.readUInt32LE(record+16);centralDisk=data.readUInt32LE(record+20);size=Number(data.readBigUInt64LE(record+40));start=Number(data.readBigUInt64LE(record+48));centralEnd=record;}
  if(disk||centralDisk||count!==diskCount)throw Error('Use readArchive with all volumes for a split ZIP.');
  if(start+size!==centralEnd)throw Error('Invalid ZIP directory extent.');
  const files: ArchiveFile[] = []; let cursor = start;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) throw Error('Invalid ZIP directory.');
    const flags = data.readUInt16LE(cursor + 8), method = data.readUInt16LE(cursor + 10), nameLength = data.readUInt16LE(cursor + 28), extra = data.readUInt16LE(cursor + 30), comment = data.readUInt16LE(cursor + 32), attributes = data.readUInt32LE(cursor + 38);
    let compressed = data.readUInt32LE(cursor + 20), uncompressed = data.readUInt32LE(cursor + 24), offset = data.readUInt32LE(cursor + 42);
    if (flags & 1 || ![0, 8].includes(method)) throw Error('Use readArchive for encrypted or extended-compression ZIP entries.');
    if(cursor+46+nameLength+extra+comment>centralEnd)throw Error('Invalid ZIP directory entry.');
    for(let at=cursor+46+nameLength;at+4<=cursor+46+nameLength+extra;){const tag=data.readUInt16LE(at),length=data.readUInt16LE(at+2);if(tag===1){let pos=at+4;const next=()=>{if(pos+8>at+4+length)throw Error('Invalid ZIP64 size field.');const value=Number(data.readBigUInt64LE(pos));pos+=8;if(!Number.isSafeInteger(value))throw Error('ZIP64 offset cannot be represented.');return value;};if(uncompressed===0xffffffff)uncompressed=next();if(compressed===0xffffffff)compressed=next();if(offset===0xffffffff)offset=next();}at+=4+length;}
    const name = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(cursor + 46, cursor + 46 + nameLength));
    if (offset + 30 > start || data.readUInt32LE(offset) !== 0x04034b50 || data.readUInt16LE(offset + 8) !== method || data.readUInt16LE(offset + 6) !== flags) throw Error('Invalid ZIP local header.');
    const localLength = data.readUInt16LE(offset + 26), dataStart = offset + 30 + localLength + data.readUInt16LE(offset + 28);
    if (dataStart + compressed > start || !data.subarray(offset + 30, offset + 30 + localLength).equals(Buffer.from(name))) throw Error('ZIP path or size mismatch.');
    const packed = data.subarray(dataStart, dataStart + compressed), decoded = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: Math.max(1, uncompressed) });
    if (decoded.length !== uncompressed || crc(decoded) !== data.readUInt32LE(cursor + 16)) throw Error('ZIP integrity check failed.');
    if (name.endsWith('/')) { childPath(path.resolve('archive'), name.slice(0, -1)); if (decoded.length) throw Error('ZIP directory contains data.'); }
    else files.push({ name, data: decoded,...((attributes>>>16&0xf000)===0xa000?{link:true}:{}) });
    cursor += 46 + nameLength + extra + comment;
  }
  if (cursor !== centralEnd) throw Error('ZIP directory length mismatch.'); validateEntries(files); return materializeArchiveLinks(files);
}
export function unwrapArchive(files: ArchiveFile[], marker: string): ArchiveFile[] {
  const clean = files.filter(f => !f.name.startsWith('__MACOSX/') && !f.name.endsWith('/.DS_Store'));
  if (clean.some(f => f.name === marker)) return clean;
  const prefix = clean[0]?.name.split('/')[0];
  if (!prefix || !clean.every(f => f.name.startsWith(`${prefix}/`))) throw Error(`Archive must contain ${marker} at its root or one enclosing folder.`);
  const stripped = clean.map(f => ({ ...f, name: f.name.slice(prefix.length + 1) }));
  if (!stripped.some(f => f.name === marker)) throw Error(`Archive is missing ${marker}.`); return stripped;
}
export async function readArchive(file: string,options:ArchiveReadOptions={}) {const files=await archiveReaders.read(file,options);validateEntries(files);return materializeArchiveLinks(files);}
/** Portable imports preserve linked content as independent files within the package. */
function materializeArchiveLinks(files:ArchiveFile[]):ArchiveFile[]{
 const entries=new Map(files.map(file=>[file.name,file]));
 const resolve=(name:string,chain:Set<string>):ArchiveFile[]=>{
  if(chain.has(name))throw Error('Archive link cycle cannot be materialized: '+name);const next=new Set(chain).add(name),entry=entries.get(name);
  if(entry&&!entry.link)return[{name,data:entry.data}];
  if(entry?.link){const raw=new TextDecoder('utf-8',{fatal:true}).decode(entry.data);if(path.posix.isAbsolute(raw)||path.win32.isAbsolute(raw))throw Error('Archive link target is outside the package.');const target=path.posix.normalize(path.posix.join(path.posix.dirname(name),raw));childPath(path.resolve('archive'),target);return resolve(target,next).map(file=>({name:name+file.name.slice(target.length),data:file.data}));}
  const descendants=[...entries.keys()].filter(key=>key.startsWith(name+'/'));if(!descendants.length)throw Error('Archive link target is missing: '+name);
  return descendants.flatMap(key=>resolve(key,next));
 };
 const result=files.flatMap(file=>resolve(file.name,new Set()));validateEntries(result);return result;
}
export async function collectDirectory(directory: string): Promise<ArchiveFile[]> {
  const files: ArchiveFile[] = [];
  async function visit(current: string, prefix: string, ancestors = new Set<string>()) {
    const canonical = await realpath(current);
    if (ancestors.has(canonical)) throw Error('Resource link cycle cannot be exported: ' + current);
    const chain = new Set(ancestors).add(canonical);
    for (const item of await readdir(current, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.DS_Store', 'Thumbs.db'].includes(item.name)) continue;
      const name = prefix + item.name, file = childPath(directory, name); const info = await stat(file);
      if (info.isDirectory()) await visit(file, `${name}/`, chain);
      else if (info.isFile()) { files.push({ name, data: await readFile(file) }); }
      else throw Error('Only regular files may be exported.');
    }
  }
  await visit(directory, ''); validateEntries(files); return files;
}
export async function installArchive(directory: string, files: ArchiveFile[]) {
  validateEntries(files);files=materializeArchiveLinks(files); await noLinks(directory); await mkdir(path.dirname(directory), { recursive: true });
  try { await lstat(directory); throw Error('Destination already exists; packages are never overwritten.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const staging = `${directory}.import-${randomUUID()}`;
  try { await mkdir(staging); for (const file of files) { const target = childPath(staging, file.name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, file.data, { flag: 'wx', mode: 0o600 }); } await noLinks(directory); try { await lstat(directory); throw Error('Destination appeared during import.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } await rename(staging, directory); }
  finally { await rm(staging, { recursive: true, force: true }); }
}
export async function exportArchive(directory: string, destination: string) { const files = await collectDirectory(directory); await atomicWrite(destination, encodeZip(files)); return { path: destination, fileCount: files.length }; }
