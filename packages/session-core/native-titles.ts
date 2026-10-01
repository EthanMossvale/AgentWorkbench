import path from 'node:path';
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { noLinks, samePath } from '../native-resources/files';

export interface NativeTitleReadRequest {
  runtime: string; nativeSessionId: string; cwd: string; configDir: string;
  projectDirectoryName?: string;
  signal?: AbortSignal;
}
export interface NativeSessionTitle {
  nativeSessionId: string; title: string; source: 'custom' | 'generated';
}
export interface NativeSessionTitlesService {
  read(request: NativeTitleReadRequest): Promise<NativeSessionTitle | undefined>;
}
export type NativeTitleRefreshResult = {status: 'updated' | 'unchanged' | 'unavailable' | 'protected'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validTitle=(value:unknown):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=500&&!/[\x00-\x1f\x7f]/.test(value);
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const parse=(text:string)=>{try{return object(JSON.parse(text));}catch{return {};}};
const HEAD=64*1024,TAIL=256*1024;

/** Bounded reads of one already-bound native session. No enumeration or transcript output. */
export class NativeSessionTitles implements NativeSessionTitlesService {
  async read(request: NativeTitleReadRequest): Promise<NativeSessionTitle | undefined> {
    if(request.signal?.aborted||request.runtime!=='claude'||!UUID.test(request.nativeSessionId)||!path.isAbsolute(request.cwd)||!path.isAbsolute(request.configDir))return;
    try {
      const cwd=await realpath(request.cwd),root=await realpath(request.configDir);
      const override=request.projectDirectoryName;
      if(override!==undefined&&(!/^[a-zA-Z0-9_-]{1,220}$/.test(override)||override==='.'||override==='..'))return;
      // Native long-path hashed layouts are deliberately not guessed or enumerated.
      const directories=override?[override]:[...new Set([cwd,request.cwd].map(value=>value.replace(/[^a-zA-Z0-9]/g,'-')).filter(value=>value.length<=200))];
      for(const directory of directories){
        if(request.signal?.aborted)return;
        const folder=path.join(root,'projects',directory),file=path.join(folder,request.nativeSessionId+'.jsonl');
        const chunks=await this.chunks(file);
        if(!chunks)continue;
        let identity=false,sidechain=false,tailCustom=false,custom:string|undefined,generated:string|undefined;
        // Ignore messages entirely; only top-level native metadata can supply a title.
        for(const [index,chunk] of chunks.entries())for(const line of chunk.split('\n')){
          if(line.length>16384||!/("cwd"|"isSidechain"|"customTitle"|"aiTitle")\s*:/.test(line))continue;
          const entry=parse(line);
          if(entry.sessionId!==request.nativeSessionId)continue;
          identity=true;
          if(entry.isSidechain===true){sidechain=true;continue;}
          if(typeof entry.cwd==='string'&&!samePath(entry.cwd,cwd))return;
          if(entry.type==='user'||entry.type==='assistant')continue;
          if(validTitle(entry.customTitle)){custom=entry.customTitle;if(index===chunks.length-1)tailCustom=true;}
          if(validTitle(entry.aiTitle))generated=entry.aiTitle;
        }
        if(!identity||sidechain)continue;
        if(!tailCustom){
          const sidecar=await this.chunks(path.join(folder,request.nativeSessionId,'custom-title.json'),16384);
          const value=sidecar&&parse(sidecar[0]??'').customTitle;
          if(validTitle(value))custom=value;
        }
        const title=custom??generated;
        if(title&&!request.signal?.aborted)return {nativeSessionId:request.nativeSessionId,title,source:custom?'custom':'generated'};
      }
    } catch { /* Metadata failure must never fail, resume or replay a model task. */ }
  }

  private async chunks(file:string,limit?:number):Promise<string[]|undefined>{
    try {
      await noLinks(file);
      const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      try {
        const stat=await handle.stat();if(!stat.isFile()||!stat.size||limit&&stat.size>limit)return;
        const size=limit??HEAD,head=Buffer.alloc(Math.min(size,stat.size));
        const first=await handle.read(head,0,head.length,0);
        const result=[head.subarray(0,first.bytesRead).toString('utf8')];
        if(!limit&&stat.size>HEAD){
          const start=Math.max(HEAD,stat.size-TAIL)-1,tail=Buffer.alloc(stat.size-start);
          const last=await handle.read(tail,0,tail.length,start);
          const text=tail.subarray(0,last.bytesRead).toString('utf8');
          // Drop a split leading line; do not reinterpret fragments as metadata.
          const newline=text.indexOf('\n');
          result.push(newline<0?'':text.slice(newline+1));
        }
        return result;
      } finally {await handle.close();}
    } catch {return;}
  }
}
export const nativeSessionTitles = new NativeSessionTitles();
