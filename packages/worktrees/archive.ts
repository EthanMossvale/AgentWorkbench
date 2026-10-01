import {createReadStream,createWriteStream} from 'node:fs';
import {readdir,lstat,open,mkdir,chmod,rename,unlink,realpath} from 'node:fs/promises';
import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';import {createGzip,createGunzip} from 'node:zlib';

interface Entry {name:string;kind:'file'|'directory';size:number;mode:number;hash:string}
export interface ArchiveManifest {entries:Entry[];digest:string;bytes:number}
export interface WorktreeArchive {file:string;sha256:string;head:string;createdAt:string;files:number;bytes:number;ref:string}
const maxBytes=256*1024*1024,maxFiles=30000;
const digest=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const safe=(name:string)=>name.length<=4096&&!name.includes('\\')&&!name.includes(':')&&!/[\u0000-\u001f]/.test(name)&&!path.isAbsolute(name)&&name.split('/').every(p=>!!p&&p!=='.'&&p!=='..'&&p.toLowerCase()!=='.git');
async function fileHash(file:string){const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(file)){if((bytes+=chunk.length)>maxBytes+16*1024*1024)throw Error('WORKTREE_ARCHIVE_LIMIT');hash.update(chunk);}return hash.digest('hex');}
/** Include ignored files, empty directories and raw checkout bytes; never follow links or nested repositories. */
export async function scanCheckout(root:string):Promise<ArchiveManifest>{
 const entries:Entry[]=[];let bytes=0;
 async function walk(directory:string,prefix=''){
  for(const item of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   if(!prefix&&item.name==='.git')continue;
   const name=prefix+item.name,file=path.join(directory,item.name);if(!safe(name))throw Error('WORKTREE_ARCHIVE_UNSAFE_PATH');
   const stat=await lstat(file);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink>1||(!stat.isFile()&&!stat.isDirectory()))throw Error('WORKTREE_ARCHIVE_UNSUPPORTED_FILE');
   if(entries.length>=maxFiles||(bytes+=stat.isFile()?stat.size:0)>maxBytes)throw Error('WORKTREE_ARCHIVE_LIMIT');
   entries.push({name,kind:stat.isDirectory()?'directory':'file',size:stat.isFile()?stat.size:0,mode:stat.mode&0o777,hash:stat.isFile()?await fileHash(file):''});
   if(stat.isDirectory())await walk(file,name+'/');
  }
 }await walk(root);return {entries,bytes,digest:digest(JSON.stringify(entries))};
}
const frame=(value:unknown)=>{const json=Buffer.from(JSON.stringify(value));if(json.length>8192)throw Error('WORKTREE_ARCHIVE_HEADER_LIMIT');const length=Buffer.alloc(4);length.writeUInt32LE(json.length);return Buffer.concat([length,json]);};
export async function createArchive(root:string,directory:string,head:string,index:Buffer,manifest:ArchiveManifest):Promise<WorktreeArchive>{
 await mkdir(directory,{recursive:true});const file=path.join(directory,randomUUID()+'.awb.gz'),temporary=file+'.tmp';
 async function* source(){
  yield frame({kind:'index',size:index.length,hash:digest(index),head});yield index;
  for(const entry of manifest.entries){yield frame(entry);if(entry.kind==='file'){const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(path.join(root,entry.name))){bytes+=chunk.length;if(bytes>entry.size)throw Error('WORKTREE_CHANGED_DURING_ARCHIVE');hash.update(chunk);yield chunk;}if(bytes!==entry.size||hash.digest('hex')!==entry.hash)throw Error('WORKTREE_CHANGED_DURING_ARCHIVE');}}
  yield frame({kind:'end',digest:manifest.digest});
 }
 try{await pipeline(Readable.from(source()),createGzip(),createWriteStream(temporary,{flags:'wx'}));await rename(temporary,file);
  const archive={file,sha256:await fileHash(file),head,createdAt:new Date().toISOString(),files:manifest.entries.filter(e=>e.kind==='file').length,bytes:manifest.bytes,ref:''};
  await readArchive(archive);return archive;
 }catch(error){await unlink(temporary).catch(()=>{});await unlink(file).catch(()=>{});throw error;}
}
/** Validate every frame and checksum before removal; optional extraction uses a fresh empty target only. */
export async function readArchive(archive:WorktreeArchive,target?:string):Promise<{index:Buffer;manifest:ArchiveManifest}>{
 if(target&&((await lstat(target)).isSymbolicLink()||(await readdir(target)).some(name=>name!=='.git')))throw Error('WORKTREE_RESTORE_TARGET_NOT_EMPTY');
 if(await fileHash(archive.file)!==archive.sha256)throw Error('WORKTREE_ARCHIVE_CHECKSUM');
 const source=createReadStream(archive.file),unzip=source.pipe(createGunzip()),iterator=unzip[Symbol.asyncIterator]();let buffer=Buffer.alloc(0),ended=false,total=0,index=Buffer.alloc(0),head='';const entries:Entry[]=[],seen=new Set<string>();
 source.on('error',error=>unzip.destroy(error));
 async function read(size:number){while(buffer.length<size&&!ended){const next=await iterator.next();ended=!!next.done;if(!next.done)buffer=Buffer.concat([buffer,next.value]);}if(buffer.length<size)throw Error('WORKTREE_ARCHIVE_TRUNCATED');const result=buffer.subarray(0,size);buffer=buffer.subarray(size);return result;}
 try{for(;;){const length=(await read(4)).readUInt32LE();if(length<1||length>8192)throw Error('WORKTREE_ARCHIVE_INVALID');const entry=JSON.parse((await read(length)).toString());
   if(entry.kind==='end'){
    if(head!==archive.head||entry.digest!==digest(JSON.stringify(entries)))throw Error('WORKTREE_ARCHIVE_INVALID');
    if(buffer.length||(await iterator.next()).done!==true)throw Error('WORKTREE_ARCHIVE_TRAILING_DATA');
    return {index,manifest:{entries,bytes:total,digest:entry.digest}};
   }
   if(!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>maxBytes||!['index','directory','file'].includes(entry.kind))throw Error('WORKTREE_ARCHIVE_INVALID');
   if(entry.kind==='index'){if(head||entries.length||typeof entry.head!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(entry.head))throw Error('WORKTREE_ARCHIVE_INVALID');head=entry.head;index=await read(entry.size);if(digest(index)!==entry.hash)throw Error('WORKTREE_ARCHIVE_CHECKSUM');continue;}
   if(!head||!safe(entry.name)||seen.has(entry.name)||entries.length>=maxFiles||(total+=entry.size)>maxBytes||entry.kind==='directory'&&entry.size!==0)throw Error('WORKTREE_ARCHIVE_INVALID');seen.add(entry.name);entries.push(entry);
   if(!Number.isInteger(entry.mode)||entry.mode<0||entry.mode>0o777)throw Error('WORKTREE_ARCHIVE_INVALID');
   const destination=target?path.join(target,entry.name):undefined;
   if(destination){const parent=path.dirname(destination);if(await realpath(parent)!==parent)throw Error('WORKTREE_RESTORE_PATH_CHANGED');}
   if(entry.kind==='directory'){if(destination)await mkdir(destination,{recursive:false,mode:entry.mode});continue;}
   const output=destination?await open(destination,'wx',entry.mode):undefined,hash=createHash('sha256');
   try{for(let remaining=entry.size;remaining>0;){const data=await read(Math.min(remaining,65536));remaining-=data.length;hash.update(data);if(output){let offset=0;while(offset<data.length){const result=await output.write(data,offset,data.length-offset);if(!result.bytesWritten)throw Error('WORKTREE_RESTORE_WRITE_FAILED');offset+=result.bytesWritten;}}}if(hash.digest('hex')!==entry.hash)throw Error('WORKTREE_ARCHIVE_CHECKSUM');}finally{await output?.close();}
   if(destination&&process.platform!=='win32')await chmod(destination,entry.mode);
  }}finally{source.destroy();unzip.destroy();}
}
