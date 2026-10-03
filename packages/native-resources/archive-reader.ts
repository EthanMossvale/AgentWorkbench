import path from 'node:path';
import {open,readdir,type FileHandle} from 'node:fs/promises';
import {Reader,ZipReader,Uint8ArrayWriter,ERR_INVALID_PASSWORD} from '@zip.js/zip.js';
import {childPath} from './files';
import type {ArchiveFile} from './archive';
import type {ArchiveReadOptions} from './archive-types';

export class ArchivePasswordError extends Error {
 constructor(readonly filePath:string,readonly incorrect:boolean){super(incorrect?'ARCHIVE_PASSWORD_INCORRECT':'ARCHIVE_PASSWORD_REQUIRED');}
}
export interface ArchiveReaderExtension {id:`plugin:${string}`;read(file:string,options:ArchiveReadOptions):Promise<ArchiveFile[]>|undefined}
/** The selected reader owns the operation; a rejection never retries another reader. */
export class ArchiveReaders {
 private readers=new Map<string,ArchiveReaderExtension>();
 register(extension:ArchiveReaderExtension):()=>void {if(this.readers.has(extension.id))throw Error('ARCHIVE_READER_DUPLICATE');const entry={...extension};this.readers.set(entry.id,entry);return()=>{if(this.readers.get(entry.id)===entry)this.readers.delete(entry.id);};}
 read(file:string,options:ArchiveReadOptions={}):Promise<ArchiveFile[]>{for(const reader of [...this.readers.values()].reverse()){const result=reader.read(file,options);if(result!==undefined)return result;}return readZip(file,options);}
}
export const archiveReaders=new ArchiveReaders();

class ArchiveFileReader extends Reader<FileHandle>{
 constructor(readonly handle:FileHandle,size:number){super(handle);this.size=size;}
 async readUint8Array(index:number,length:number){const data=Buffer.alloc(Math.min(length,Math.max(0,this.size-index)));let total=0;while(total<data.length){const {bytesRead}=await this.handle.read(data,total,data.length-total,index+total);if(!bytesRead)break;total+=bytesRead;}return data.subarray(0,total);}
 static async open(file:string){const handle=await open(file,'r');try{const info=await handle.stat();if(!info.isFile())throw Error('Archive volume must be a regular file.');return new ArchiveFileReader(handle,info.size);}catch(error){await handle.close();throw error;}}
}
class JoinedArchiveReader extends Reader<ArchiveFileReader[]>{
 constructor(readonly parts:ArchiveFileReader[]){super(parts);this.size=parts.reduce((sum,part)=>sum+part.size,0);}
 async readUint8Array(index:number,length:number){const chunks:Buffer[]=[];let at=0,remaining=Math.min(length,Math.max(0,this.size-index));for(const part of this.parts){if(index<at+part.size&&remaining){const start=Math.max(0,index-at),data=await part.readUint8Array(start,Math.min(remaining,part.size-start));chunks.push(data);remaining-=data.length;index+=data.length;}at+=part.size;}return Buffer.concat(chunks);}
}

async function archiveVolumes(file:string,options:ArchiveReadOptions){
 if(options.volumes?.length)return options.volumes;
 const numbered=/^(.*\.zip)\.(\d+)$/i.exec(file);
 if(numbered){const base=path.basename(numbered[1]!);return(await readdir(path.dirname(file))).filter(name=>name.startsWith(base+'.')&&/^\d+$/.test(name.slice(base.length+1))).sort((a,b)=>Number(a.slice(base.length+1))-Number(b.slice(base.length+1))).map(name=>path.join(path.dirname(file),name));}
 const final=file.replace(/\.z\d+$/i,'.zip'),source=await ArchiveFileReader.open(final);let tail:Buffer;try{tail=await source.readUint8Array(Math.max(0,source.size-65557),65557);}finally{await source.handle.close();}
 let disks=1;for(let at=tail.length-22;at>=0;at--)if(tail.readUInt32LE(at)===0x06054b50&&at+22+tail.readUInt16LE(at+20)===tail.length){disks=tail.readUInt16LE(at+4)+1;if(disks===65536&&at>=20&&tail.readUInt32LE(at-20)===0x07064b50)disks=tail.readUInt32LE(at-4);break;}
 return [...Array.from({length:disks-1},(_,i)=>final.replace(/\.zip$/i,'.z'+String(i+1).padStart(2,'0'))),final];
}
async function readZip(file:string,options:ArchiveReadOptions):Promise<ArchiveFile[]>{
 const volumes=await archiveVolumes(file,options),readers:ArchiveFileReader[]=[];let reader:ZipReader<unknown>|undefined;
 try{
  for(const volume of volumes)readers.push(await ArchiveFileReader.open(volume));
  reader=new ZipReader(/\.zip\.\d+$/i.test(file)?new JoinedArchiveReader(readers):readers.length===1?readers[0]!:readers,{useWebWorkers:false,useCompressionStream:true,checkCrc32:true,checkLocalFilename:true,password:options.password});
  const entries=await reader.getEntries(),files:ArchiveFile[]=[];
  if(entries.some(entry=>entry.encrypted)&&options.password===undefined)throw new ArchivePasswordError(file,false);
  for(const entry of entries){options.signal?.throwIfAborted();const name=entry.directory?entry.filename.replace(/\/$/,''):entry.filename;childPath(path.resolve('archive'),name);
   if(entry.directory){if(entry.uncompressedSize)throw Error('ZIP directory contains data.');continue;}
   const data=Buffer.from(await entry.getData(new Uint8ArrayWriter(),{signal:options.signal})!);files.push({name,data,...(entry.symlink?{link:true}:{})});
  }
  return files;
 }catch(error){if(error instanceof ArchivePasswordError)throw error;if((error as Error).message===ERR_INVALID_PASSWORD)throw new ArchivePasswordError(file,true);throw Error('ZIP: '+(error as Error).message,{cause:error});}
 finally{await reader?.close();await Promise.all(readers.map(source=>source.handle.close()));}
}
