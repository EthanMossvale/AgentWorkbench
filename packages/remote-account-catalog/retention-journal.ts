import {mkdir,open,readFile,rename,rm,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import type {RetentionLogEntry,RetentionLogPage} from './retention-types';
import type {RemoteCliProvider} from './cli';

const MAX_ENTRIES=Number.MAX_SAFE_INTEGER,DAYS=Number.MAX_SAFE_INTEGER,MAX_BYTES=Number.MAX_SAFE_INTEGER;
type Input=Omit<RetentionLogEntry,'id'|'at'|'lastAt'|'repeat'>;
interface State {entries:RetentionLogEntry[];pending:RetentionLogEntry[];loaded:boolean;writing?:Promise<void>;issue?:string;blocked?:boolean}
/** Local, bounded metadata journal. Its failures never gate native deletion. */
export class RetentionJournal {
 private states=new Map<string,State>();
 constructor(readonly directory:string,private now=Date.now){}
 private file(scope:string){return path.join(this.directory,createHash('sha256').update(scope).digest('hex')+'.json');}
 private state(scope:string){let state=this.states.get(scope);if(!state){state={entries:[],pending:[],loaded:false};this.states.set(scope,state);}return state;}
 private trim(entries:RetentionLogEntry[]){let bytes=32;const kept:RetentionLogEntry[]=[];for(const entry of entries.filter(e=>e.lastAt>=this.now()-DAYS*86400000).sort((a,b)=>b.lastAt-a.lastAt||b.id.localeCompare(a.id))){const size=Buffer.byteLength(JSON.stringify(entry))+1;if(kept.length>=MAX_ENTRIES||bytes+size>MAX_BYTES)break;kept.push(entry);bytes+=size;}return kept;}
 record(scope:string,input:Input):void {
  const state=this.state(scope),now=this.now();
  state.pending.push({provider:input.provider,kind:input.kind,sessionIds:input.sessionIds.map(id=>id),message:input.message,id:randomUUID(),at:now,lastAt:now,repeat:1,...(input.accountId?{accountId:input.accountId.slice(0,256)}:{}),...(input.archiveId?{archiveId:input.archiveId.slice(0,32)}:{}),...(input.code?{code:input.code.slice(0,80)}:{}),...(input.bytes!==undefined?{bytes:input.bytes}:{})});
  this.pump(scope,state);
 }
 private pump(scope:string,state:State){
  if(state.writing)return;
  state.writing=(async()=>{
   if(!state.loaded){
    try{
     const file=this.file(scope),info=await stat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
     if(info){if(!info.isFile()||info.size>MAX_BYTES)throw Error('INVALID_LOG');const raw=JSON.parse(await readFile(file,'utf8'));
      if(raw.version!==1||!Array.isArray(raw.entries)||raw.entries.length>MAX_ENTRIES||raw.entries.some((e:RetentionLogEntry)=>!e||typeof e.id!=='string'||e.id.length>80||typeof e.message!=='string'||!Number.isFinite(e.at)||!Number.isFinite(e.lastAt)||e.at<0||e.lastAt>8640000000000000||!['codex','claude'].includes(e.provider)||!['checked','archiving','reclaimed','deferred','error','cancelled','restoring','restored','policy'].includes(e.kind)||!Number.isSafeInteger(e.repeat)||e.repeat<1||!Array.isArray(e.sessionIds)||e.sessionIds.some(id=>typeof id!=='string'||id.length>256)))throw Error('INVALID_LOG');
      state.entries=this.trim(raw.entries);
     }state.loaded=true;
    }catch{state.blocked=true;state.loaded=true;state.issue='本机历史日志无法读取；原文件保留，新记录仅暂存内存。请检查日志文件和目录权限。';}
   }
   while(state.pending.length){
    const pending=state.pending.splice(0);
    for(const entry of pending){
     // Empty checks are coalesced hourly, avoiding a log flood while idle.
     const previous=entry.kind==='checked'?state.entries.find(e=>e.provider===entry.provider&&e.kind==='checked'&&e.message===entry.message&&entry.at-e.at<3600000):undefined;
     if(previous){previous.lastAt=entry.lastAt;previous.repeat++;}else state.entries.push(entry);
    }
    state.entries=this.trim(state.entries);
    if(state.blocked)continue;
    const file=this.file(scope),temporary=file+'.'+randomUUID()+'.pending';
    try{
     await mkdir(this.directory,{recursive:true,mode:0o700});
     const handle=await open(temporary,'wx',0o600);
     try{await handle.writeFile(JSON.stringify({version:1,entries:state.entries}));await handle.sync();}finally{await handle.close();}
     await rename(temporary,file);state.issue=undefined;
    }catch(error){const code=(error as NodeJS.ErrnoException).code;state.issue=code==='ENOSPC'||code==='EDQUOT'?'本机空间不足，清理日志未能落盘；本次记录暂存内存，请释放本机空间。':'清理日志未能写入本机，记录暂存内存；请检查日志目录权限、文件占用或磁盘状态。';}
    finally{await rm(temporary,{force:true}).catch(()=>{});}
   }
  })().catch(()=>{state.issue='本机清理日志写入失败；会话清理不受日志锁阻塞，请检查本机磁盘。';}).finally(()=>{state.writing=undefined;if(state.pending.length)this.pump(scope,state);});
 }
 async settle(scope:string):Promise<boolean>{
  const state=this.state(scope);this.pump(scope,state);
  let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
  try{await Promise.race([state.writing,new Promise<void>(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve();},2000);timer.unref();})]);}finally{if(timer)clearTimeout(timer);}
  return !timedOut;
 }
 async list(scope:string,provider:RemoteCliProvider,options:{before?:string;limit?:number}={}):Promise<RetentionLogPage>{
  const limit=options.limit??50;if(!Number.isInteger(limit)||limit<1||options.before!==undefined&&(typeof options.before!=='string'||options.before.length>80))throw Error('清理日志分页参数无效。');
  const settled=await this.settle(scope),state=this.state(scope);
  const entries=this.trim([...state.entries,...state.pending]).filter(e=>e.provider===provider);
  const offset=options.before?entries.findIndex(e=>e.id===options.before)+1:0;
  if(options.before&&!offset)throw Error('日志分页已过期，请刷新最近记录。');
  const page=entries.slice(offset,offset+limit);
  return {entries:page,nextBefore:offset+limit<entries.length?page.at(-1)!.id:null,location:this.directory,maxEntries:MAX_ENTRIES,retentionDays:DAYS,...(!settled?{issue:'本机日志读取或写入较慢，当前显示内存记录；请稍后刷新。'}:state.issue?{issue:state.issue}:{})};
 }
}
