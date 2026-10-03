import path from 'node:path';
import os from 'node:os';
import { realpath, stat, opendir, open } from 'node:fs/promises';
import { fileReference } from '../../../packages/navigation/file-links';
import type {Stats} from 'node:fs';
import type {FileView,FileBrowseOptions,FileBrowseReader,FileBrowserApi} from '../../../packages/navigation/file-browser';
export type {FileView,FileBrowseOptions} from '../../../packages/navigation/file-browser';
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
const versionOf = (s:Stats) => [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
const changed = () => Error('文件或目录已变化，请刷新后继续读取。');
export async function browseFile(cwd: string, requested?: string, options:FileBrowseOptions = {}): Promise<FileView> {
  const target = await resolveBrowsePath(cwd, requested), metadata = await stat(target), parent = path.dirname(target), version = versionOf(metadata);
  const offset = options.cursor?.offset ?? 0, limit = options.pageSize ?? (metadata.isDirectory()?1000:1024*1024);
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1)throw Error('分页位置和大小必须是有效整数。');
  if(options.cursor&&options.cursor.version!==version)throw changed();
  if (metadata.isDirectory()) {
    const entries: NonNullable<FileView['entries']> = []; let position = 0, more = false;
    const directory = await opendir(target);
    for await (const item of directory) {
      if(position++<offset)continue;
      if(entries.length===limit){more=true;break;}
      entries.push({name:item.name,path:path.join(target,item.name),directory:item.isDirectory()});
    }
    if(versionOf(await stat(target))!==version)throw changed();
    entries.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name));
    return {path:target,parent,kind:'directory',entries,truncated:more,...(more?{next:{offset:offset+entries.length,version}}:{})};
  }
  const base = { path: target, parent, size: metadata.size, line: fileReference(requested ?? '')?.line };
  if (!metadata.isFile()) return { ...base, kind: 'unsupported' };
  const handle = await open(target, 'r');
  try {
    if(versionOf(await handle.stat())!==version)throw changed();
    let position=offset,startLine=options.cursor?.line??1;
    // Seek a distant line without allocating its preceding contents.
    const wanted=options.cursor?1:Math.max(1,(base.line??1)-50);
    if(wanted>1){
      const scan=Buffer.alloc(64*1024);let line=1;
      while(position<metadata.size&&line<wanted){
        const {bytesRead}=await handle.read(scan,0,scan.length,position);if(!bytesRead)break;
        let n=0;for(;n<bytesRead&&line<wanted;n++)if(scan[n]===10)line++;
        position+=n;
      }
      startLine=line;
    }
    const buffer=Buffer.alloc(Math.min(limit+4,Math.max(0,metadata.size-position)));let length=0;
    while(length<buffer.length){const part=await handle.read(buffer,length,buffer.length-length,position+length);if(!part.bytesRead)break;length+=part.bytesRead;}
    if(versionOf(await handle.stat())!==version||versionOf(await stat(target))!==version)throw changed();
    let end=Math.min(limit,length);
    // Include a split UTF-8 code point in this page, so each page decodes independently.
    while(end<length&&(buffer[end]!&0xc0)===0x80)end++;
    const bytes=buffer.subarray(0,end);
    if(bytes.includes(0))return {...base,kind:'unsupported'};
    let content:string;
    try{content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:position!==0}).decode(bytes);}catch{return {...base,kind:'unsupported'};}
    const more=position+end<metadata.size;
    return {...base,kind:'text',content,startLine,truncated:more,...(more?{next:{offset:position+end,version,line:startLine+(content.match(/\n/g)?.length??0)}}:{})};
  } finally { await handle.close(); }
}

/** The production reader directory supports additions and per-method replacement. */
export class FileBrowserService implements FileBrowserApi {
  private readers=new Map<string,FileBrowseReader>();
  registerReader(reader:FileBrowseReader):()=>void {
    if(!/^plugin:[a-z\d][a-z\d._-]*\/[a-z\d][a-z\d._-]*$/i.test(reader.id)||typeof reader.browse!=='function')throw Error('FILE_READER_INVALID');
    if(this.readers.has(reader.id))throw Error('FILE_READER_DUPLICATE');
    const entry={...reader};this.readers.set(entry.id,entry);return()=>{if(this.readers.get(entry.id)===entry)this.readers.delete(entry.id);};
  }
  async browse(cwd:string,requested?:string,options:FileBrowseOptions={}):Promise<FileView>{
    for(const reader of [...this.readers.values()].reverse()){
      try {
        const result=await reader.browse(cwd,requested,options);
        if(this.readers.get(reader.id)===reader&&result)return result;
      } catch(error) { if(this.readers.get(reader.id)===reader)throw error; }
    }
    return browseFile(cwd,requested,options);
  }
}
