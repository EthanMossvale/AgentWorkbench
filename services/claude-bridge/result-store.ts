import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,open,lstat,rm} from 'node:fs/promises';
import path from 'node:path';
import {claudeMcpPolicy,ClaudeToolError,claudeToolFailure,type ClaudeMcpPolicy} from './policy';
import type {ClaudeToolServer,ClaudeToolServerOptions} from './tools';

export interface ClaudeResultReference {id:string;bytes:number;sha256:string;encoding:'utf8-json';preview:string}
export interface ClaudeResultPage {id:string;offset:number;nextOffset:number;bytes:number;text:string;eof:boolean}
export interface ClaudeResultStore {
  readonly inlineBytes:number;
  readonly maxResultBytes:number;
  put(value:unknown):Promise<ClaudeResultReference>;
  read(id:string,offset?:number,maxBytes?:number):Promise<ClaudeResultPage>;
  close():Promise<void>;
}
/** Opaque, session-owned handles; no caller-selected filesystem paths. */
export class LocalClaudeResultStore implements ClaudeResultStore {
  readonly inlineBytes:number;
  readonly maxResultBytes:number;
  private entries=new Map<string,ClaudeResultReference>();private used=0;private closed=false;
  private writes=new Set<Promise<unknown>>();private closing?:Promise<void>;
  private constructor(private directory:string,private policy:ClaudeMcpPolicy){this.inlineBytes=policy.inlineBytes;this.maxResultBytes=policy.resultBytes;}
  static async open(options:ClaudeToolServerOptions){
    const policy=claudeMcpPolicy(options.policy);options.signal.throwIfAborted();await mkdir(options.directory,{recursive:true});
    const directory=await mkdtemp(path.join(options.directory,'results-'));return new LocalClaudeResultStore(directory,policy);
  }
  async put(value:unknown){
    if(this.closed)throw Error('LOCAL_RESULT_STORE_CLOSED');
    const text=JSON.stringify(value);if(text===undefined)throw Error('LOCAL_RESULT_INVALID');
    const data=Buffer.from(text,'utf8');
    if(data.length>this.policy.resultBytes||this.used+data.length>this.policy.storedBytes)throw Error('LOCAL_RESULT_STORAGE_LIMIT');
    const id=randomUUID(),reference:ClaudeResultReference={id,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),encoding:'utf8-json',preview:text.slice(0,2048)};
    this.used+=data.length;
    const writing=writeFile(path.join(this.directory,id+'.json'),data,{flag:'wx',mode:0o600});this.writes.add(writing);
    try{await writing;if(this.closed)throw Error('LOCAL_RESULT_STORE_CLOSED');this.entries.set(id,reference);return {...reference};}catch(error){this.used-=data.length;throw error;}finally{this.writes.delete(writing);}
  }
  async read(id:string,offset=0,maxBytes=64*1024){
    if(this.closed)throw Error('LOCAL_RESULT_STORE_CLOSED');const ref=this.entries.get(id);
    if(!ref)throw Error('LOCAL_RESULT_UNAVAILABLE');
    if(!Number.isSafeInteger(offset)||offset<0||offset>ref.bytes||!Number.isSafeInteger(maxBytes)||maxBytes<4||maxBytes>256*1024)throw Error('LOCAL_RESULT_RANGE_INVALID');
    const file=path.join(this.directory,id+'.json'),stat=await lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==ref.bytes)throw Error('LOCAL_RESULT_CHANGED');
    const handle=await open(file,'r');
    try{
      const buffer=Buffer.alloc(Math.min(maxBytes+1,ref.bytes-offset)),{bytesRead}=await handle.read(buffer,0,buffer.length,offset);
      if(bytesRead&&((buffer[0]!&0xc0)===0x80))throw Error('LOCAL_RESULT_RANGE_INVALID');
      let length=Math.min(maxBytes,bytesRead);while(length>0&&length<bytesRead&&(buffer[length]!&0xc0)===0x80)length--;
      const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length));
      return {id,offset,nextOffset:offset+length,bytes:ref.bytes,text,eof:offset+length===ref.bytes};
    }finally{await handle.close();}
  }
  close(){return this.closing??=(async()=>{this.closed=true;await Promise.allSettled(this.writes);this.entries.clear();await rm(this.directory,{recursive:true,force:true});})();}
}
export function resultReferenceContent(reference:ClaudeResultReference){return {content:[{type:'text',text:JSON.stringify({output:reference,instructions:'The complete native result is stored for this session. Use ReadLocalToolResult with this id and byte offset to retrieve it. Do not repeat the command to retrieve output.'})}],structuredContent:{output:reference}};}
export function withClaudeResultStore(tools:ClaudeToolServer,store:ClaudeResultStore):ClaudeToolServer {
  const reader={name:'ReadLocalToolResult',description:'Read a bounded UTF-8 JSON page from an owned completed local tool result. Use nextOffset for the next page. Handles expire when this connection closes. This never executes the original tool again.',inputSchema:{type:'object',properties:{id:{type:'string'},offset:{type:'integer',minimum:0},maxBytes:{type:'integer',minimum:4,maximum:262144}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:true}};
  let closing:Promise<void>|undefined;
  return {...tools,get definitions(){return [...tools.definitions,reader];},listTools:async()=>[...await tools.listTools?.()??tools.definitions,reader],
    call:async(name,args:any,signal)=>{
      signal?.throwIfAborted();if(name==='ReadLocalToolResult'){const page=await store.read(args?.id,args?.offset,args?.maxBytes);return {content:[{type:'text',text:JSON.stringify(page)}],structuredContent:page};}
      const result:any=await tools.call(name,args,signal);
      const bytes=Buffer.byteLength(JSON.stringify(result)??'');
      if(bytes>store.maxResultBytes)return {isError:true,content:[{type:'text',text:'LOCAL_RESULT_SIZE_LIMIT: The native tool returned a result exceeding the delivery limit. It was not retried. For file reads, request a smaller range.'}],structuredContent:{error:'LOCAL_RESULT_SIZE_LIMIT',bytes,outcome:'returned',retried:false}};
      if(bytes<=store.inlineBytes||result?.content?.some((c:any)=>c.type==='image'))return result;
      try{return {...resultReferenceContent(await store.put(result)),...(result?.isError?{isError:true}:{})};}
      catch(error){throw new ClaudeToolError({code:claudeToolFailure(error).code,stage:'delivery',outcome:'returned',bytes});}
    },close:()=>closing??=(async()=>{try{await tools.close();}finally{await store.close();}})()};
}
