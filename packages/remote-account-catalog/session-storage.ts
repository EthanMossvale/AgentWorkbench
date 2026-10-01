import {mkdir,open,readdir,readFile,rename,rm,statfs} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import type {Session,SshHost} from '../contracts';
import {runSsh,validateSshHost,type SshRunner} from '../ssh-transport';
import {accountSetupScript} from './setup';
import {RetentionJournal} from './retention-journal';
import {RetentionError,retentionFailure} from './retention-errors';
import {retentionPolicy,type RetentionInspection,type RetentionSession,type RetentionLogEntry} from './retention-types';
import type {RemoteCliPolicy} from './cli';

type Provider='codex'|'claude';
interface Entry {path:string;sha256:string;size:number;mode:number;mtime:number;delete:boolean}
interface Archive {version:1;archiveId:string;host:string;authorityId:string;generation:string;provider:Provider;accountId:string;accountGeneration:string;sessions:string[];files:Entry[];status:'partial'|'verified'|'reclaimed'|'restored';createdAt:string;progress?:Record<string,{bytes:number;sha256:string}>}
const endpoint=(host:SshHost)=>host.hostname.toLowerCase()+':'+host.port;
const categories={codex:['sessions','archived_sessions','generated_images'],claude:['projects','file-history','todos','tasks','session-env']};
const chunkSize=256*1024;
export interface RetentionOptions {signal?:AbortSignal;maxBytes?:number;maxDurationMs?:number;maxCandidates?:number}
class RetentionYield extends Error {constructor(){super('归档已分段保存，将在下一轮继续。');}}
interface RetentionBudget {signal:AbortSignal;bytes:number;limit:number}
export class NativeSessionStorage {
 private locks=new Set<string>();
 private shutdown=new AbortController();
 private passes=new Map<string,{abort:AbortController;done:Promise<void>;accountId?:string;sessions?:string[]}>();
 private cursors=new Map<string,number>();
 private damaged=new Set<string>();
 private recent=new Map<string,{checkedAt:string;reclaimedBytes:number;deferred?:boolean;transferredBytes?:number;error?:string}>();
 private journal:RetentionJournal;
 constructor(private directory:string,private runner:SshRunner=runSsh){this.journal=new RetentionJournal(path.join(directory,'logs'));}
 private log(host:SshHost,provider:Provider,kind:RetentionLogEntry['kind'],message:string,fields:Partial<Pick<RetentionLogEntry,'sessionIds'|'accountId'|'archiveId'|'code'|'bytes'>>={}){this.journal.record(endpoint(host),{provider,kind,message,sessionIds:[],...fields});}
 private archiveLog(a:Archive){return {sessionIds:a.sessions,accountId:a.accountId,archiveId:a.archiveId};}
 async recordPolicy(host:SshHost,provider:Provider,policy:RemoteCliPolicy){this.log(host,provider,'policy',`自动清理已${policy.reclaimIdle?'开启':'关闭'}，闲置时限 ${policy.idleHours} 小时；设置已保存并回读。`);await this.journal.settle(endpoint(host));}
 logs(host:SshHost,provider:Provider,options:{before?:string;limit?:number}={}){validateSshHost(host);if(host.role!=='admin'||host.username!=='root'||!['codex','claude'].includes(provider))throw new RetentionError('ADMIN_REQUIRED');return this.journal.list(endpoint(host),provider,options);}
 dispose(){this.shutdown.abort();}
 cancel(host:SshHost,provider:Provider){this.passes.get(endpoint(host)+':'+provider)?.abort.abort(new Error('会话回收已取消；已保存分块保留。'));}
 private folder(id:string){if(!/^[a-f0-9]{32}$/.test(id))throw Error('归档编号无效。');return path.join(this.directory,id);}
 private binding(a:Archive){return {provider:a.provider,accountId:a.accountId,accountGeneration:a.accountGeneration,archiveId:a.archiveId,sessions:a.sessions};}
 private async request(host:SshHost,request:unknown,signal:AbortSignal=this.shutdown.signal){
  signal.throwIfAborted();validateSshHost(host);if(host.role!=='admin'||host.username!=='root')throw Error('原生会话归档需要此 VPS 的管理员连接。');
  const result=await this.runner(host,'exec python3 -B -',{stdin:accountSetupScript(request),timeoutMs:120000,maxOutputBytes:16*1024*1024,signal}).catch(error=>{if(signal.aborted){if(signal.reason?.name==='TimeoutError')throw new RetentionError('TIMEOUT');throw signal.reason;}throw new RetentionError(retentionFailure(error).code);});
  let value:any;try{value=JSON.parse(result.stdout);}catch{throw new RetentionError(result.exitCode===255?'SSH_FAILED':'STORAGE_OPERATION_UNCONFIRMED');}
  if(result.exitCode!==0||value?.ok!==true)throw new RetentionError(typeof value?.error==='string'&&/^[A-Z][A-Z_]{0,79}$/.test(value.error)?value.error:'STORAGE_OPERATION_UNCONFIRMED');return value.value;
 }
 async inspect(host:SshHost,provider:Provider,options:{after?:string;limit?:number}={}):Promise<RetentionInspection>{
  const limit=options.limit??50;if(!['codex','claude'].includes(provider)||!Number.isInteger(limit)||limit<1||limit>100||options.after!==undefined&&(typeof options.after!=='string'||options.after.length>256))throw Error('会话列表分页参数无效。');
  const result=await this.request(host,{method:'retention/inspect',provider,after:options.after??'',limit},AbortSignal.any([this.shutdown.signal,AbortSignal.timeout(15000)]));
  const policy=retentionPolicy(result?.policy),receivedAt=Date.now()/1000,available=result?.available===true;
  if(!Number.isFinite(result.observedAt))throw Error('远端会话时间回执无效。');
  const base={provider,policy,available,observedAt:result.observedAt,receivedAt,running:this.passes.has(endpoint(host)+':'+provider),lastCheck:this.recent.get(endpoint(host)+':'+provider)};
  if(!available)return {...base,sessions:[],total:0,nextCursor:null,loginBusy:false,issue:new RetentionError('STORAGE_UNAVAILABLE').message};
  const identifier=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\x00-\x1f]/.test(v),timestamp=(v:unknown)=>v===null||typeof v==='number'&&Number.isFinite(v)&&v>=0;
  if(!Array.isArray(result.sessions)||result.sessions.length>limit||!Number.isSafeInteger(result.total)||result.total<result.sessions.length||!(result.nextCursor===null||identifier(result.nextCursor))||typeof result.loginBusy!=='boolean'||!identifier(result.authorityId)||!identifier(result.generation))throw Error('远端会话列表回执无效。');
  const archives=(await this.archives()).filter(a=>a.host===endpoint(host)&&a.provider===provider&&a.authorityId===result.authorityId&&a.generation===result.generation);
  const sessions:RetentionSession[]=result.sessions.map((r:any)=>{
   if(!r||![r.sessionId,r.accountId,r.accountGeneration].every(identifier)||!(r.threadId===null||identifier(r.threadId))||![r.lastModelActivity,r.idleSeconds,r.dueAt].every(timestamp)||!['eligible','active','interrupted','uncertain'].every(k=>typeof r[k]==='boolean')||!['activity_unknown','clock_ahead','expired','recent_model_activity'].includes(r.clockReason)||!['present','marked','reclaimed','restore_pending'].includes(r.remoteState)||![null,'archiving','restoring'].includes(r.operation)||r.archiveId!==undefined&&!/^[a-f0-9]{32}$/.test(r.archiveId))throw Error('远端会话详情回执无效。');
   const local=archives.filter(a=>a.accountId===r.accountId&&a.accountGeneration===r.accountGeneration&&a.sessions.includes(r.sessionId)&&(!r.archiveId||r.archiveId===a.archiveId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
   return {sessionId:r.sessionId,accountId:r.accountId,accountGeneration:r.accountGeneration,threadId:r.threadId,lastModelActivity:r.lastModelActivity,idleSeconds:r.idleSeconds,dueAt:r.dueAt,eligible:r.eligible,clockReason:r.clockReason,active:r.active,interrupted:r.interrupted,uncertain:r.uncertain,remoteState:r.remoteState,operation:r.operation,...(r.archiveId?{archiveId:r.archiveId}:{}),...(local?{localArchive:local.status,localBytes:local.status==='partial'?Object.values(local.progress??{}).reduce((n,p)=>n+p.bytes,0):local.files.reduce((n,f)=>n+f.size,0)}:{})};
  });
  return {...base,sessions,total:result.total,nextCursor:result.nextCursor,loginBusy:result.loginBusy};
 }
 private entries(raw:unknown,provider:Provider):Entry[]{
  if(!Array.isArray(raw)||raw.length>10000)throw Error('原生归档清单无效。');const seen=new Set<string>();let total=0;
  return raw.map(e=>{if(!e||typeof e.path!=='string'||e.path.startsWith('/')||e.path.includes('\\')||!categories[provider].includes(e.path.split('/')[0])||e.path.split('/').some((v:string)=>!v||v==='.'||v==='..')||!Number.isSafeInteger(e.size)||e.size<0||typeof e.sha256!=='string'||!/^[a-f0-9]{64}$/.test(e.sha256)||typeof e.delete!=='boolean'||!Number.isInteger(e.mode)||e.mode<0||e.mode>4095||!Number.isFinite(e.mtime)||seen.has(e.path))throw Error('原生归档文件清单无效。');total+=e.size;if(total>8*1024**3)throw Error('单次原生归档超过 8 GB，未回收。');seen.add(e.path);return {path:e.path,sha256:e.sha256,size:e.size,mode:e.mode,mtime:e.mtime,delete:e.delete};});
 }
 private async save(a:Archive){
  const directory=this.folder(a.archiveId),temp=path.join(directory,'manifest.pending');const handle=await open(temp,'w',0o600);
  try{await handle.writeFile(JSON.stringify(a));await handle.sync();}finally{await handle.close();}await rename(temp,path.join(directory,'manifest.json'));
  if(process.platform!=='win32'){const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}}
 }
 private async archives(){
  await mkdir(this.directory,{recursive:true,mode:0o700});const values:Archive[]=[];
  for(const item of await readdir(this.directory,{withFileTypes:true})){
   if(!item.isDirectory()||!/^[a-f0-9]{32}$/.test(item.name))continue;let a:Archive;
   try{a=JSON.parse(await readFile(path.join(this.folder(item.name),'manifest.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.damaged.add(item.name);continue;}
   try{if(a.version!==1||a.archiveId!==item.name||!['codex','claude'].includes(a.provider)||!['partial','verified','reclaimed','restored'].includes(a.status)||!Array.isArray(a.sessions))throw Error();a.files=this.entries(a.files,a.provider);values.push(a);this.damaged.delete(item.name);}catch{this.damaged.add(item.name);}
  }return values;
 }
 private async verify(a:Archive,signal:AbortSignal=this.shutdown.signal){
  for(let i=0;i<a.files.length;i++){
   signal.throwIfAborted();
   const entry=a.files[i]!,file=await open(path.join(this.folder(a.archiveId),String(i)),'r');
   try{const info=await file.stat();if(!info.isFile()||info.size!==entry.size)throw Error('本机原生归档大小校验失败。');const hash=createHash('sha256'),buffer=Buffer.alloc(chunkSize);let offset=0;while(offset<info.size){signal.throwIfAborted();const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);if(!bytesRead)throw Error('本机归档读取中断。');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}if(hash.digest('hex')!==entry.sha256)throw Error('本机原生归档校验失败。');}finally{await file.close();}
  }
 }
 async status(host:SshHost){const all=(await this.archives()).filter(a=>a.host===endpoint(host)&&a.status!=='restored');return {damaged:this.damaged.size,archives:all.filter(a=>a.status!=='partial').length,partial:all.filter(a=>a.status==='partial').length,bytes:all.reduce((n,a)=>n+a.files.reduce((s,f)=>s+f.size,0),0),providers:Object.fromEntries((['codex','claude'] as const).map(p=>[p,this.recent.get(endpoint(host)+':'+p)??null]))};}
 private async download(host:SshHost,a:Archive,budget:RetentionBudget){
  const signal=budget.signal;
  const space=await statfs(this.directory),available=Number(space.bavail)*Number(space.bsize),total=Number(space.blocks)*Number(space.bsize);
  const remaining=a.files.reduce((n,e,i)=>n+Math.max(0,e.size-(a.progress?.[String(i)]?.bytes??0)),0);
  if(available-remaining<Math.min(2*1024**3,total*.1))throw Error('本机归档空间不足，未删除远端副本。');
  for(let i=0;i<a.files.length;i++){
   signal.throwIfAborted();const entry=a.files[i]!,target=path.join(this.folder(a.archiveId),String(i)),file=await open(target,'r+').catch(error=>{if(error.code!=='ENOENT')throw error;return open(target,'wx+',0o600);});
   try{
    let offset=0,hash=createHash('sha256');const progress=a.progress?.[String(i)],info=await file.stat();
    if(progress&&Number.isSafeInteger(progress.bytes)&&progress.bytes>=0&&progress.bytes<=entry.size&&info.size>=progress.bytes){
     const buffer=Buffer.alloc(chunkSize);while(offset<progress.bytes){signal.throwIfAborted();const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,progress.bytes-offset),offset);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
     // Partial archives have never authorized deletion. A damaged prefix can
     // safely restart from the still-present, manifest-bound remote original.
     if(offset!==progress.bytes||hash.copy().digest('hex')!==progress.sha256){offset=0;hash=createHash('sha256');a.progress![String(i)]={bytes:0,sha256:hash.copy().digest('hex')};await this.save(a);}
    }
    await file.truncate(offset);
    while(offset<entry.size){
     signal.throwIfAborted();if(budget.bytes+Math.min(chunkSize,entry.size-offset)>budget.limit)throw new RetentionYield();const reply=await this.request(host,{method:'retention/read',...this.binding(a),entry,offset},signal);
     if(reply.offset!==offset||typeof reply.data!=='string'||reply.data.length>chunkSize*2)throw Error('原生归档分块回执无效。');const bytes=Buffer.from(reply.data,'base64');
     if(!bytes.length||bytes.length>chunkSize||offset+bytes.length>entry.size)throw Error('原生归档分块大小无效。');
     let written=0;while(written<bytes.length){const result=await file.write(bytes,written,bytes.length-written,offset+written);if(!result.bytesWritten)throw Error('本机归档写入中断。');written+=result.bytesWritten;}await file.sync();hash.update(bytes);offset+=bytes.length;budget.bytes+=bytes.length;
     a.progress??={};a.progress[String(i)]={bytes:offset,sha256:hash.copy().digest('hex')};await this.save(a);
    }
    await file.sync();
    if(hash.digest('hex')!==entry.sha256){a.progress??={};a.progress[String(i)]={bytes:0,sha256:createHash('sha256').digest('hex')};await file.truncate(0);await file.sync();await this.save(a);throw Error('本机原生归档校验失败；已丢弃未确认分块，下轮重新传输。');}
   }finally{await file.close();}
  }
 }
 async reclaim(host:SshHost,provider:Provider,options:RetentionOptions={}){
  const limit=options.maxBytes??16*1024*1024,duration=options.maxDurationMs??30000,maxCandidates=options.maxCandidates??8;
  if(!Number.isSafeInteger(limit)||limit<chunkSize||limit>8*1024**3||!Number.isSafeInteger(duration)||duration<1||duration>300000||!Number.isSafeInteger(maxCandidates)||maxCandidates<1||maxCandidates>1000)throw Error('SESSION_RETENTION_BUDGET_INVALID');
  const abort=new AbortController(),signal=AbortSignal.any([abort.signal,this.shutdown.signal,...(options.signal?[options.signal]:[])]);signal.throwIfAborted();
  const key=endpoint(host)+':'+provider;if(this.locks.has(key))return;this.locks.add(key);let reclaimedBytes=0,deferred=false;const errors:string[]=[];
  let finish!:()=>void;const pass={abort,done:new Promise<void>(resolve=>{finish=resolve;}),accountId:undefined as string|undefined,sessions:undefined as string[]|undefined};this.passes.set(key,pass);
  const timer=setTimeout(()=>abort.abort(new RetentionYield()),duration);timer.unref();const budget:RetentionBudget={signal,bytes:0,limit};
  try{
   const existing=await this.archives(),result=await this.request(host,{method:'retention/candidates',provider},signal);
   if(!Array.isArray(result?.candidates)||result.candidates.length>1000)throw Error('原生回收候选回执无效。');
   const candidates=result.candidates,start=(this.cursors.get(key)??0)%Math.max(1,candidates.length);
   if(!candidates.length)this.log(host,provider,'checked','检查完成，本轮没有可处理的到期会话。');
   for(let index=0;index<Math.min(maxCandidates,candidates.length);index++){
    const position=(start+index)%candidates.length,candidate=candidates[position];this.cursors.set(key,(position+1)%candidates.length);
    signal.throwIfAborted();let a:Archive|undefined;
    try{
     if(![candidate.accountId,candidate.accountGeneration,result.authorityId,result.generation].every(v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v))||!Array.isArray(candidate.sessions)||candidate.sessions.some((v:any)=>typeof v!=='string'))throw Error('原生账号归档回执无效。');
     a=existing.find(a=>a.host===endpoint(host)&&a.authorityId===result.authorityId&&a.generation===result.generation&&a.provider===provider&&a.accountId===candidate.accountId&&a.accountGeneration===candidate.accountGeneration&&a.status!=='restored'&&a.sessions.some(id=>candidate.sessions.includes(id)));
     if(candidate.archiveId&&a?.archiveId!==candidate.archiveId)throw Error('远端副本已归档，但本机完整归档缺失；不会继续删除。');
     if(a?.status==='reclaimed'&&!candidate.restorePending&&!candidate.reconcile)continue;
     if(a?.status==='reclaimed')a.status='verified';
     a??={version:1,archiveId:randomBytes(16).toString('hex'),host:endpoint(host),authorityId:result.authorityId,generation:result.generation,provider,accountId:candidate.accountId,accountGeneration:candidate.accountGeneration,sessions:candidate.sessions,files:[],status:'partial',createdAt:new Date().toISOString()};
     pass.accountId=a.accountId;pass.sessions=a.sessions;
     this.log(host,provider,'archiving','开始核对并归档原生会话；校验完成前保留远端副本。',this.archiveLog(a));
     if(a.status==='verified')await this.verify(a,signal);
     const started=await this.request(host,{method:'retention/begin',...this.binding(a),resume:a.status==='verified',...(a.status==='verified'?{files:a.files}:{})},signal);
     const next=this.entries(started.files,provider);if(!next.length)continue;
     if(a.status==='verified'&&JSON.stringify(next)!==JSON.stringify(a.files))throw Error('已校验归档与远端清单不同，未删除。');
     if(a.status==='partial'&&JSON.stringify(next)!==JSON.stringify(a.files)){await rm(this.folder(a.archiveId),{recursive:true,force:true});a.files=next;a.progress={};}
     await mkdir(this.folder(a.archiveId),{recursive:true,mode:0o700});await this.save(a);
     if(a.status==='partial'){await this.download(host,a,budget);await this.verify(a,signal);a.status='verified';delete a.progress;await this.save(a);}
     signal.throwIfAborted();const ack=await this.request(host,{method:'retention/commit',...this.binding(a),files:a.files},signal);
     if(ack.reclaimedBytes!==a.files.filter(e=>e.delete).reduce((n,e)=>n+e.size,0))throw Error('原生副本回收未确认。');a.status='reclaimed';await this.save(a);reclaimedBytes+=ack.reclaimedBytes;
     this.log(host,provider,'reclaimed','本机归档已校验，远端会话副本已清理。',{...this.archiveLog(a),bytes:ack.reclaimedBytes});
    }catch(error){if(error instanceof RetentionYield||signal.reason instanceof RetentionYield){deferred=true;this.log(host,provider,'deferred','达到本轮传输或时间限额；进度已保存，下轮继续。',a?this.archiveLog(a):{});}else if(signal.aborted)throw signal.reason;else {const failure=retentionFailure(error);errors.push(failure.message);this.log(host,provider,'error',failure.message,{...(a?this.archiveLog(a):{}),code:failure.code});}}
    finally{pass.accountId=undefined;pass.sessions=undefined;if(a&&!this.shutdown.signal.aborted)await this.request(host,{method:'retention/release',...this.binding(a)},AbortSignal.any([this.shutdown.signal,AbortSignal.timeout(2000)])).catch(()=>{});}
    if(deferred||budget.bytes>=budget.limit){deferred=true;break;}
   }
   deferred ||= candidates.length>maxCandidates;
   this.recent.set(key,{checkedAt:new Date().toISOString(),reclaimedBytes,deferred,transferredBytes:budget.bytes,...(errors.length?{error:errors.join('；')}:{})});
   if(errors.length)throw Error(errors.join('；'));return {reclaimedBytes,deferred,transferredBytes:budget.bytes};
  }catch(error){if(signal.reason instanceof RetentionYield){this.recent.set(key,{checkedAt:new Date().toISOString(),reclaimedBytes,deferred:true,transferredBytes:budget.bytes});this.log(host,provider,'deferred','达到本轮时间限额，已结束等待；下轮重新检查。');return {reclaimedBytes,deferred:true,transferredBytes:budget.bytes};}const failure=retentionFailure(error);this.recent.set(key,{checkedAt:new Date().toISOString(),reclaimedBytes,error:errors.length?errors.join('；'):failure.message});if(!errors.length)this.log(host,provider,signal.aborted?'cancelled':'error',failure.message,{code:failure.code});throw error;}finally{clearTimeout(timer);this.locks.delete(key);this.passes.delete(key);finish();await this.journal.settle(endpoint(host));}
 }
 async restoreFor(host:SshHost|undefined,session:Session,options:{signal?:AbortSignal}={}){
  const signal=AbortSignal.any([this.shutdown.signal,...(options.signal?[options.signal]:[])]);signal.throwIfAborted();const parts=session.binding.accountRef?.startsWith('vps-account:')?session.binding.accountRef.slice(12).split('/').map(decodeURIComponent):[];if(parts.length!==5)return;
  const pass=host?this.passes.get(endpoint(host)+':'+parts[2]):undefined;
  if(pass&&pass.accountId===parts[3]&&pass.sessions?.some(id=>id===session.id||id===session.branch?.native?.sourceSessionId)){pass.abort.abort(new Error('前台恢复会话，已暂停对应归档。'));await pass.done;}
  const archives=(await this.archives()).filter(a=>!['partial','restored'].includes(a.status)&&a.authorityId===parts[0]&&a.generation===parts[1]&&a.provider===parts[2]&&a.accountId===parts[3]&&a.accountGeneration===parts[4]&&a.sessions.some(id=>id===session.id||id===session.branch?.native?.sourceSessionId));if(!archives.length)return;
  if(!host)throw Error('此会话的原生副本已在本机归档；请接回同一 VPS 的管理员连接以自动恢复。');
  const key=endpoint(host)+':'+parts[2];if(this.locks.has(key))throw Error('原生历史正在归档或恢复，请稍候。');this.locks.add(key);
  let restoring:Archive|undefined;
  try{for(const a of archives){
   restoring=a;this.log(host,a.provider,'restoring','开始从本机归档恢复原生会话。',this.archiveLog(a));
   if(a.host!==endpoint(host))throw Error('原生归档与当前 VPS 不匹配。');await this.verify(a,signal);
   await this.request(host,{method:'retention/begin',...this.binding(a),restore:true,files:a.files},signal);
   try{
    for(let i=0;i<a.files.length;i++){
     const entry=a.files[i]!,file=await open(path.join(this.folder(a.archiveId),String(i)),'r');
     try{let offset=0;do{signal.throwIfAborted();const data=Buffer.alloc(Math.min(chunkSize,entry.size-offset));const {bytesRead}=await file.read(data,0,data.length,offset);if(bytesRead!==data.length)throw Error('本机归档读取中断。');await this.request(host,{method:'retention/write',...this.binding(a),entry,offset,data:data.toString('base64')},signal);offset+=bytesRead;}while(offset<entry.size);}finally{await file.close();}
    }
    await this.request(host,{method:'retention/restored',...this.binding(a),files:a.files},signal);a.status='restored';await this.save(a);
    this.log(host,a.provider,'restored','原生会话已恢复并收到确认，可以继续原线程。',this.archiveLog(a));
   }finally{if(!this.shutdown.signal.aborted)await this.request(host,{method:'retention/release',...this.binding(a)},AbortSignal.any([this.shutdown.signal,AbortSignal.timeout(2000)])).catch(()=>{});}
  }}catch(error){if(restoring){const failure=retentionFailure(error);this.log(host,restoring.provider,signal.aborted?'cancelled':'error',failure.message,{...this.archiveLog(restoring),code:failure.code});}throw error;}finally{this.locks.delete(key);await this.journal.settle(endpoint(host));}
 }
}
