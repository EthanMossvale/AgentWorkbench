import { mkdir, open, readFile, realpath, writeFile, rm, lstat, rename, readdir, copyFile } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Attachment, AttachmentInput, AttachmentPayload, AttachmentView } from '../../../packages/attachments/types';

import {AttachmentPayloadPolicies,type AttachmentPayloadOptions} from '../../../packages/attachments/payload';
import {attachmentMime,readAttachmentFile} from './attachment-file';

const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const validId = (id: string) => /^[0-9a-f-]{36}$/.test(id);
const specialPath=(value:string)=>process.platform==='win32'&&(/^(?:\\\\|\/\/)[.?][\\/]/.test(value)||value.slice(2).includes(':'));
const samePath=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const generatedPath=(item:Pick<Attachment,'id'|'path'|'generatedRoot'>,extension='png')=>/^[a-z\d]+$/i.test(extension)&&typeof item.generatedRoot==='string'&&path.isAbsolute(item.generatedRoot)&&samePath(item.path,path.join(item.generatedRoot,'generated_images','image-'+item.id.replaceAll('-','')+'.'+extension));
const mime=(data:Buffer,_name:string)=>attachmentMime(data);
export class AttachmentStore {
  readonly payloadPolicies=new AttachmentPayloadPolicies();
  private retained=new Set<string>();
  /** `thumbnail` may answer asynchronously (the core process asks the UI process to resize). */
  constructor(readonly directory: string, private thumbnail?: (data: Buffer) => string | undefined | Promise<string | undefined>, private controlPaths:string[] = [], private pickSave?:(name:string)=>Promise<string|null>,private options:{nativePaths?:boolean;temporaryDirectory?:string;copyImage?:(data:Uint8Array)=>void|Promise<void>}={}) {}
  /** Copy verified original pixels through the host, never a preview URL. */
  async copyImage(id:string):Promise<{copied:true}>{
    const item=(await this.payloads([id]))[0]!;
    if(!item.attachment.mime.startsWith('image/'))throw Error('ATTACHMENT_IMAGE_INVALID');
    if(!this.options.copyImage)throw Error('ATTACHMENT_COPY_IMAGE_UNAVAILABLE');
    await this.options.copyImage(item.data);return {copied:true};
  }
  private get temporaryDirectory(){return this.options.temporaryDirectory??path.join(tmpdir(),'agentworkbench-clipboard');}
  locations(){return {managed:this.directory,clipboard:this.temporaryDirectory,files:'original' as const};}
  /** Register an already-saved workspace image without making another image copy. */
  async generatedRecord(identity:string):Promise<Attachment|undefined>{
    const id=`${identity.slice(0,8)}-${identity.slice(8,12)}-${identity.slice(12,16)}-${identity.slice(16,20)}-${identity.slice(20,32)}`;
    try{return (await this.resolve([id]))[0];}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  }
  async registerGenerated(filePath:string,sha256:string,size:number,identity:string,format:Pick<import('../../../packages/generated-images/types').GeneratedImageFormat,'mime'|'extension'>={mime:'image/png',extension:'png'}):Promise<Attachment>{
    if(!/^[a-f0-9]{64}$/.test(identity)||!/^[a-f0-9]{64}$/.test(sha256)||!Number.isSafeInteger(size)||size<1||!path.isAbsolute(filePath)||specialPath(filePath)||!samePath(await realpath(filePath),filePath))throw Error('GENERATED_IMAGE_RECORD_INVALID');
    const id=`${identity.slice(0,8)}-${identity.slice(8,12)}-${identity.slice(12,16)}-${identity.slice(16,20)}-${identity.slice(20,32)}`;
    const item:Attachment={id,name:path.basename(filePath),path:filePath,size,mime:format.mime,sha256,storage:'source',generatedRoot:path.dirname(path.dirname(filePath)),createdAt:new Date().toISOString()};
    if(!generatedPath(item,format.extension))throw Error('GENERATED_IMAGE_RECORD_INVALID');
    const handle=await open(filePath,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size!==size)throw Error('GENERATED_IMAGE_FILE_CHANGED');const bytes=Buffer.alloc(size);let offset=0;while(offset<size){const result=await handle.read(bytes,offset,size-offset,offset);if(!result.bytesRead)break;offset+=result.bytesRead;}const after=await handle.stat();if(offset!==size||after.size!==size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs||digest(bytes)!==sha256||!samePath(await realpath(filePath),filePath))throw Error('GENERATED_IMAGE_FILE_CHANGED');}finally{await handle.close();}
    await mkdir(path.join(this.directory,id),{recursive:true,mode:0o700});
    const metadata=path.join(this.directory,id,'metadata.json');
    try{await writeFile(metadata,JSON.stringify(item),{flag:'wx',mode:0o600});}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const existing=(await this.resolve([id]))[0]!;if(existing.sha256!==sha256||existing.path!==filePath||existing.size!==size)throw Error('GENERATED_IMAGE_RECORD_CHANGED');}
    const verified=(await this.payloads([id]))[0]!.attachment;this.retained.add(id);return verified;
  }
  /** Remove only old, unused, owned bytes. Originals and referenced history are never deleted. */
  async cleanup(referencedIds:string[],now=Date.now()){
    if(!Array.isArray(referencedIds)||referencedIds.some(id=>!validId(id)))throw Error('ATTACHMENT_REFERENCES_INVALID');
    const keep=new Set([...referencedIds,...this.retained]);let removed=0,bytes=0;
    const dirs=await readdir(this.directory,{withFileTypes:true}).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;});
    for(const dir of dirs){if(!validId(dir.name)||keep.has(dir.name)||!dir.isDirectory()||dir.isSymbolicLink())continue;const root=path.join(this.directory,dir.name);try{
      if(await realpath(root)!==root)continue;
      const file=path.join(root,'metadata.json'),meta=JSON.parse(await readFile(file,'utf8')) as Attachment,created=Date.parse(meta.createdAt??'');
      if(meta.id!==dir.name||!Number.isFinite(created)||now-created<7*86400000)continue;
      if(meta.storage==='clipboard'){const target=path.join(this.temporaryDirectory,dir.name);if(path.dirname(meta.path)!==target||await realpath(target)!==target)continue;await rm(target,{recursive:true});bytes+=meta.size;}
      else if(meta.storage!=='source'){if(path.dirname(meta.path)!==root)continue;bytes+=meta.size;}
      await rm(root,{recursive:true});removed++;
    }catch{/* Changed or malformed records remain untouched. */}}
    return {removed,bytes};
  }
  /** Save a verified attachment or a PNG annotation copy, through a native user dialog. */
  async saveAs(id:string,png?:unknown):Promise<boolean>{
    const original=(await this.payloads([id],{channel:'verify'}))[0]!;
    if(!this.pickSave)throw Error('ATTACHMENT_SAVE_UNAVAILABLE');
    let data:Buffer|undefined,name=original.attachment.name;
    if(png!==undefined){if(!(png instanceof Uint8Array)||!original.attachment.mime.startsWith('image/')||mime(Buffer.from(png),'')!=='image/png')throw Error('ATTACHMENT_EDIT_INVALID');data=Buffer.from(png);name=path.parse(name).name+'-marked.png';}
    const selected=await this.pickSave(name);if(!selected)return false;
    if(!path.isAbsolute(selected)||specialPath(selected))throw Error('ATTACHMENT_SAVE_PATH_INVALID');
    const parent=await realpath(path.dirname(selected)),destination=path.join(parent,path.basename(selected));
    if(samePath(destination,original.attachment.path))throw Error('ATTACHMENT_ORIGINAL_PROTECTED');
    const existing=await lstat(destination).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;return null;});
    if(existing&&(!existing.isFile()||existing.isSymbolicLink()||existing.nlink>1))throw Error('ATTACHMENT_SAVE_PATH_INVALID');
    const temporary=path.join(parent,'.awb-image-'+randomUUID()+'.tmp');
    try{if(data)await writeFile(temporary,data,{flag:'wx',mode:0o600});else{await copyFile(original.attachment.path,temporary,1);if((await readAttachmentFile(temporary)).sha256!==original.attachment.sha256)throw Error('附件正在变化，请重新添加。');}await rename(temporary,destination);}finally{await rm(temporary,{force:true});}
    return true;
  }
  /** Display-only snapshots of a bound native view; never attached to a model turn. */
  async importViewedImages(filePaths:string[],workspaceRoot:string):Promise<AttachmentView[]> {
    if(!Array.isArray(filePaths)||!filePaths.length)throw Error('ACTIVITY_IMAGE_SOURCE_UNAVAILABLE');
    // Viewed images are display-only snapshots.  Their source location is not
    // classified by directory; the normal snapshot integrity checks still apply.
    return this.importFiles(filePaths.map(filePath=>({filePath})),true);
  }
  async import(inputs: AttachmentInput[]): Promise<AttachmentView[]> {return this.importFiles(inputs);}
  private async importFiles(inputs:AttachmentInput[],viewed=false):Promise<AttachmentView[]> {
    if(!Array.isArray(inputs)||!inputs.length)throw Error('请选择要添加的附件。');
    const staged:{item:Attachment;data?:Buffer;source?:string}[]=[];
    for(const input of inputs){
      let data:Buffer|undefined,name:string,originalPath:string|undefined,size:number,sha256:string,type:string;
      if(typeof input.filePath==='string'&&input.filePath){
        if(!path.isAbsolute(input.filePath))throw Error('附件必须是本机文件。');
        if(specialPath(input.filePath))throw Error('不支持设备路径或备用数据流附件。');
        originalPath=await realpath(input.filePath);if(specialPath(originalPath))throw Error('不支持设备路径或备用数据流附件。');
        const read=await readAttachmentFile(originalPath,mime=>mime.startsWith('image/'));
        ({data,size,sha256,mime:type}=read);name=path.basename(originalPath);
      }else{
        if(!(input.bytes instanceof Uint8Array))throw Error('附件数据无效。');
        data=Buffer.from(input.bytes);size=data.length;sha256=digest(data);type=mime(data,'');name=typeof input.name==='string'?path.basename(input.name.replaceAll('\\','/')):'粘贴图片.png';
      }
      name=name.replace(/[\x00-\x1f\x7f]/g,'').slice(0,180);if(!name||name==='.'||name==='..')throw Error('附件名称无效。');
      if(staged.some(v=>v.item.sha256===sha256&&v.item.name===name))continue;
      const id=randomUUID(),safe=name.replace(/[<>:"/\\|?*]/g,'_');
      const storage=this.options.nativePaths&&!viewed?(originalPath?'source':type.startsWith('image/')?'clipboard':'managed'):'managed';
      if(viewed&&!type.startsWith('image/'))throw Error('ACTIVITY_IMAGE_SOURCE_UNAVAILABLE');
      staged.push({item:{id,name,size,mime:type,sha256,storage,createdAt:new Date().toISOString(),path:storage==='source'?originalPath!:path.join(storage==='clipboard'?this.temporaryDirectory:this.directory,id,'file-'+safe)},data,source:originalPath});
    }
    try{
      for(const {item,data,source} of staged){
        await mkdir(path.join(this.directory,item.id),{recursive:true,mode:0o700});
        if(item.storage!=='source'){
          await mkdir(path.dirname(item.path),{recursive:true,mode:0o700});
          if(source){await copyFile(source,item.path,1);const copied=await readAttachmentFile(item.path);if(copied.sha256!==item.sha256)throw Error('附件正在变化，请重新添加。');}
          else await writeFile(item.path,data!,{flag:'wx',mode:0o600});
        }
        await writeFile(path.join(this.directory,item.id,'metadata.json'),JSON.stringify(item),{flag:'wx',mode:0o600});this.retained.add(item.id);
      }
      return Promise.all(staged.map(async({item,data})=>({...item,...(item.mime.startsWith('image/')&&data?{preview:(await this.thumbnail?.(data))??`data:${item.mime};base64,${data.toString('base64')}`}:{})})));
    }catch(error){await Promise.all(staged.map(async({item})=>{await rm(path.join(this.directory,item.id),{recursive:true,force:true});if(item.storage==='clipboard')await rm(path.join(this.temporaryDirectory,item.id),{recursive:true,force:true});}));throw error;}
  }
  async resolve(ids: unknown): Promise<Attachment[]> {
    if(ids===undefined)return [];
    if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!validId(id))||new Set(ids).size!==ids.length)throw Error('附件列表无效。');
    const items=await Promise.all(ids.map(async id=>{
      const item=JSON.parse(await readFile(path.join(this.directory,id,'metadata.json'),'utf8')) as Attachment;
      if(item.id!==id||!Number.isSafeInteger(item.size)||item.size<0||typeof item.path!=='string')throw Error('附件记录无效，请重新添加。');
      if(item.storage==='source'){if(!path.isAbsolute(item.path)||specialPath(item.path))throw Error('ATTACHMENT_SOURCE_INVALID');}
      else{const expected=path.join(item.storage==='clipboard'?this.temporaryDirectory:this.directory,id);if(!samePath(await realpath(path.dirname(item.path)),await realpath(expected)))throw Error('ATTACHMENT_RECORD_INVALID');item.path=path.join(expected,path.basename(item.path));}
      return item;
    }));
    return items;
  }
  async payloads(ids: unknown,options:AttachmentPayloadOptions={}): Promise<AttachmentPayload[]> {
    const payloads:AttachmentPayload[]=[];
    for(const attachment of await this.resolve(ids)){
      if(!samePath(await realpath(attachment.path),attachment.path))throw Error('附件快照路径已变化，请重新添加。');
      const read=await readAttachmentFile(attachment.path,this.payloadPolicies.includeData(attachment,options.channel));
      if(read.size!==attachment.size||read.sha256!==attachment.sha256)throw Error(`附件“${attachment.name}”已变化，请重新添加。`);
      payloads.push({attachment,data:read.data??Buffer.alloc(0),...(read.data?{}:{dataOmitted:true})});this.retained.add(attachment.id);
    }
    return payloads;
  }
  async views(ids:unknown):Promise<AttachmentView[]> { return Promise.all((await this.payloads(ids,{channel:'preview'})).map(async({attachment,data})=>({...attachment,...(attachment.mime.startsWith('image/')?{preview:(await this.thumbnail?.(Buffer.from(data)))??`data:${attachment.mime};base64,${Buffer.from(data).toString('base64')}`}:{})}))); }
}
