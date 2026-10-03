import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { NativeModelSelection, PermissionMode, SessionBinding } from '../contracts';
import { atomicWrite, digest, readJson, SerialQueue } from '../native-resources/files';
import type { MemoryRuntime } from './protocol';
import { receiptMessages, type MemoryReceiptCode, type MemoryReceiptVerification } from './receipts';
import type { MemoryConsolidationInput } from './consolidation';

export interface MemoryTaskBinding {
  binding: SessionBinding; modelSelection?: NativeModelSelection;
  permissionMode?: PermissionMode; projectPath?: string;
}
export type MemoryTaskState = 'queued'|'running'|'completed'|'blocked'|'failed'|'uncertain'|'cancelled';
export interface MemoryBackgroundAdmission {started:boolean;taskId?:string;reason?:string;at:string;runtime?:MemoryRuntime}
export interface MemoryBackgroundTask {
  id: string; runtime: MemoryRuntime; model: string; effort?: string; permissionMode: PermissionMode;
  submissionKey: string; state: MemoryTaskState; createdAt: string; finishedAt?: string;
  processed: number; total: number; reason?: string;
  receiptIssues?: MemoryReceiptCode[];
  mode?:'consolidation'; workKey?:string;
  recipientRuntime?:MemoryRuntime;
  lastBatchWorkKeys?:string[];
}
export interface MemoryTaskExecution {
  sessionId: string; target: MemoryTaskBinding; prompt: string; signal: AbortSignal;
  read(query: Record<string,unknown>): Promise<unknown>;
  verify(): Promise<MemoryReceiptVerification>;
  store?(input:MemoryConsolidationInput):Promise<{verified:number;total:number;entries:{archiveId:string;state:'verified'|'pending';code?:string}[]}>;
}
export interface MemoryTaskExecutor {
  mode?:'consolidation';
  supports(target: MemoryTaskBinding): boolean;
  run(task: MemoryTaskExecution): Promise<{state:'completed'|'blocked'|'failed'|'uncertain';reason?:string}>;
}
export interface MemoryBackgroundPort {
  allowed(target: MemoryTaskBinding): Promise<boolean>;
  pending(runtime: MemoryRuntime): Promise<string[]>;
  prepare(target: MemoryTaskBinding, sessionId: string, submissionId: string, entries: string[]): Promise<{prompt:string;deliveryId:string;count:number}|undefined>;
  finish(runtime: MemoryRuntime, sessionId: string, deliveryId: string): Promise<number>;
  read(target: MemoryTaskBinding, sessionId: string, query: Record<string,unknown>): Promise<unknown>;
  verify?(target: MemoryTaskBinding, sessionId: string): Promise<MemoryReceiptVerification>;
  issues?(deliveryId: string): MemoryReceiptCode[];
  prepareConsolidation?(target:MemoryTaskBinding,sessionId:string,submissionId:string,entries:string[]):Promise<{prompt:string;deliveryIds:string[];count:number}|undefined>;
  readConsolidation?(target:MemoryTaskBinding,sessionId:string,query:Record<string,unknown>):Promise<unknown>;
  storeConsolidation?(target:MemoryTaskBinding,sessionId:string,input:MemoryConsolidationInput,signal:AbortSignal):Promise<{verified:number;total:number;entries:{archiveId:string;state:'verified'|'pending';code?:string}[]}>;
  verifyConsolidation?(target:MemoryTaskBinding,sessionId:string):Promise<MemoryReceiptVerification>;
  finishConsolidation?(sessionId:string):Promise<number>;
}
type Active = {task:MemoryBackgroundTask;target:MemoryTaskBinding;executor:MemoryTaskExecutor;abort:AbortController;done:Promise<void>};
type ReceiverSequence={targets:MemoryTaskBinding[];entries:string[][];executors:(MemoryTaskExecutor|undefined)[];submissionId:string;retry?:boolean;abort:AbortController;done:Promise<void>};
const terminal = new Set<MemoryTaskState>(['completed','blocked','failed','uncertain','cancelled']);
const safeReason = (error:unknown) => error instanceof Error && /^MEMORY_[A-Z_]+$/.test(error.message) ? error.message : 'MEMORY_BACKGROUND_FAILED';
const entryWorkKey=(target:MemoryTaskBinding,id:string)=>{const {nativeSessionId:_native,executionSessionId:_execution,...binding}=target.binding;return digest(JSON.stringify([binding,target.modelSelection,target.permissionMode,id]));};

/** Metadata journal only. Never owns foreground messages, native memory or authentication. */
export class MemoryBackgroundTasks extends EventEmitter {
  private tasks:MemoryBackgroundTask[]=[];
  private active=new Map<MemoryRuntime,Active>();
  private executors:MemoryTaskExecutor[]=[];
  private queue=new SerialQueue();
  private stopped=false;
  private initialized=false;
  private lastAdmission?:MemoryBackgroundAdmission;
  private receiverAdmissions:Partial<Record<MemoryRuntime,MemoryBackgroundAdmission>>={};
  private receiverSequence?:ReceiverSequence;
  private file:string;
  constructor(directory:string, private port:MemoryBackgroundPort){super();this.file=path.join(directory,'memory-background.json');}
  async initialize(){
    const stored=await readJson<{version:number;tasks:MemoryBackgroundTask[]}>(this.file,{version:1,tasks:[]});
    if(stored.version!==1||!Array.isArray(stored.tasks)||stored.tasks.some(t=>!t||!['codex','claude'].includes(t.runtime)||typeof t.id!=='string'||typeof t.model!=='string'||!/^\w{64}$/.test(t.submissionKey)||!['queued','running',...terminal].includes(t.state)||!Number.isSafeInteger(t.processed)||!Number.isSafeInteger(t.total)))throw Error('MEMORY_BACKGROUND_JOURNAL_INVALID');
    this.tasks=stored.tasks;
    for(const task of this.tasks)if(task.receiptIssues!==undefined&&(!Array.isArray(task.receiptIssues)||task.receiptIssues.some(code=>!Object.hasOwn(receiptMessages,code))))throw Error('MEMORY_BACKGROUND_JOURNAL_INVALID');
    for(const task of this.tasks)if(task.mode!==undefined&&task.mode!=='consolidation'||task.workKey!==undefined&&!/^[a-f\d]{64}$/.test(task.workKey))throw Error('MEMORY_BACKGROUND_JOURNAL_INVALID');
    for(const task of this.tasks)if(task.recipientRuntime!==undefined&&task.recipientRuntime!==task.runtime)throw Error('MEMORY_BACKGROUND_JOURNAL_INVALID');
    for(const task of this.tasks)if(task.lastBatchWorkKeys!==undefined&&(!Array.isArray(task.lastBatchWorkKeys)||task.lastBatchWorkKeys.some(key=>typeof key!=='string'||!/^[a-f\d]{64}$/.test(key))))throw Error('MEMORY_BACKGROUND_JOURNAL_INVALID');
    for(const task of this.tasks)if(!terminal.has(task.state)){task.state='uncertain';task.reason='MEMORY_BACKGROUND_INTERRUPTED';task.finishedAt=new Date().toISOString();}
    await this.save();this.initialized=true;
  }
  private save(){return atomicWrite(this.file,JSON.stringify({version:1,tasks:this.tasks},null,2));}
  private async change(task:MemoryBackgroundTask,patch:Partial<MemoryBackgroundTask>){
    await this.queue.run(async()=>{Object.assign(task,patch);await this.save();this.emit('changed',structuredClone(task));});
  }
  list(){return structuredClone(this.tasks);}
  admission(){return this.lastAdmission?structuredClone(this.lastAdmission):undefined;}
  admissions(){return structuredClone(this.receiverAdmissions);}
  private recordAdmission(result:{started:boolean;taskId?:string;reason?:string},runtime?:MemoryRuntime){this.lastAdmission={...result,at:new Date().toISOString(),...(runtime?{runtime}:{})};if(runtime)this.receiverAdmissions[runtime]=this.lastAdmission;return result;}
  decline(reason:string,runtime?:MemoryRuntime){return this.recordAdmission({started:false,reason:/^MEMORY_[A-Z_]+$/.test(reason)?reason:'MEMORY_BACKGROUND_DEFAULT_UNAVAILABLE'},runtime);}
  busy(connectionId?:string){return [...this.active.values()].some(a=>!connectionId||a.target.binding.modelConnectionId===connectionId||a.target.binding.localAccountId===connectionId||a.target.binding.hostId===connectionId)||!!this.receiverSequence?.targets.some(t=>!connectionId||t.binding.modelConnectionId===connectionId||t.binding.localAccountId===connectionId||t.binding.hostId===connectionId);}
  registerExecutor(executor:MemoryTaskExecutor){
    if(typeof executor?.supports!=='function'||typeof executor?.run!=='function'||executor.mode!==undefined&&executor.mode!=='consolidation')throw Error('MEMORY_BACKGROUND_EXECUTOR_INVALID');
    this.executors.push(executor);let live=true;
    return ()=>{if(!live)return;live=false;this.executors=this.executors.filter(e=>e!==executor);if(this.receiverSequence?.executors.includes(executor))this.receiverSequence.abort.abort('MEMORY_BACKGROUND_EXECUTOR_REMOVED');for(const a of this.active.values())if(a.executor===executor)a.abort.abort('MEMORY_BACKGROUND_EXECUTOR_REMOVED');};
  }
  /** Called only after an explicit user submission is accepted. Never from capture timers or peer messages. */
  async start(target:MemoryTaskBinding,submissionId:string,options:{retry?:boolean;maxEntries?:number}={}):Promise<{started:boolean;taskId?:string;reason?:string}>{
    if(options.maxEntries!==undefined&&(!Number.isSafeInteger(options.maxEntries)||options.maxEntries<1))throw Error('MEMORY_CONSOLIDATION_ARGUMENT_INVALID');
    return this.admit(target,submissionId,options);
  }
  /** Freeze each recipient's own backlog, then run separate native sessions serially. */
  async startReceivers(targets:MemoryTaskBinding[],submissionId:string,options:{retry?:boolean}={}):Promise<{started:boolean;taskId?:string;reason?:string}>{
    return this.queue.run(async()=>{
      if(this.stopped||!this.initialized)return this.decline('MEMORY_BACKGROUND_UNAVAILABLE');
      if(this.active.size||this.receiverSequence)return this.decline('MEMORY_BACKGROUND_BUSY');
      if(!submissionId||!targets.length||targets.length>2||new Set(targets.map(t=>t.binding.runtime)).size!==targets.length||targets.some(t=>!['codex','claude'].includes(t.binding.runtime)))throw Error('MEMORY_CONSOLIDATION_ARGUMENT_INVALID');
      const executors=targets.map(target=>this.executors.findLast(e=>e.supports(target))),entries=[];
      for(const target of targets)entries.push(await this.port.pending(target.binding.runtime as MemoryRuntime));
      if(entries.every(ids=>!ids.length))return this.decline('MEMORY_BACKGROUND_EMPTY');
      if(executors.some(e=>e&&!this.executors.includes(e)))return this.decline('MEMORY_BACKGROUND_EXECUTOR_REMOVED');
      const sequence:ReceiverSequence={targets:structuredClone(targets),entries,executors,submissionId,retry:options.retry,abort:new AbortController(),done:Promise.resolve()};
      this.receiverSequence=sequence;
      sequence.done=this.runReceivers(sequence).finally(()=>{if(this.receiverSequence===sequence)this.receiverSequence=undefined;});
      void sequence.done.catch(()=>{});
      return this.recordAdmission({started:true});
    });
  }
  private async runReceivers(sequence:ReceiverSequence){
    for(const [i,target] of sequence.targets.entries()){
      if(sequence.abort.signal.aborted||this.stopped)break;
      try{
        const admitted=await this.admit(target,sequence.submissionId,{retry:sequence.retry},sequence,sequence.entries[i]);
        if(!admitted.started)continue;
        const active=[...this.active.values()].find(a=>a.task.id===admitted.taskId);await active?.done;
        // A failed or interrupted native turn ends this dispatch; never continue transport work automatically.
        if(this.tasks.find(t=>t.id===admitted.taskId)?.state!=='completed')break;
      }catch(error){this.decline(safeReason(error),target.binding.runtime as MemoryRuntime);break;}
    }
  }
  private async admit(target:MemoryTaskBinding,submissionId:string,options:{retry?:boolean;maxEntries?:number},sequence?:ReceiverSequence,frozen?:string[]):Promise<{started:boolean;taskId?:string;reason?:string}>{
    const result=await this.queue.run(async()=>{
      const runtime=target.binding.runtime;
      if(this.stopped||!this.initialized||!['codex','claude'].includes(runtime))return {started:false,reason:'MEMORY_BACKGROUND_UNAVAILABLE'};
      if(!submissionId||!target.modelSelection?.model)return {started:false,reason:'MEMORY_BACKGROUND_MODEL_REQUIRED'};
      const native=runtime as MemoryRuntime,submissionKey=digest(submissionId+':'+native);
      const prior=this.tasks.find(t=>t.submissionKey===submissionKey);
      if(prior)return {started:false,taskId:prior.id,reason:'MEMORY_BACKGROUND_DUPLICATE'};
      if(this.active.size||this.receiverSequence&&this.receiverSequence!==sequence)return {started:false,reason:'MEMORY_BACKGROUND_BUSY'};
      if(sequence?.abort.signal.aborted)return {started:false,reason:'MEMORY_BACKGROUND_CANCELLED'};
      if(!await this.port.allowed(target))return {started:false,reason:'MEMORY_BACKGROUND_DISABLED'};
      if(sequence?.abort.signal.aborted)return {started:false,reason:'MEMORY_BACKGROUND_CANCELLED'};
      const executor=sequence?sequence.executors[sequence.targets.indexOf(target)]:this.executors.findLast(e=>e.supports(target));
      if(executor&&!this.executors.includes(executor))return {started:false,reason:'MEMORY_BACKGROUND_EXECUTOR_REMOVED'};
      const consolidate=executor?.mode==='consolidation';
      const pending=frozen??await this.port.pending(native),entries=pending.slice(0,options.maxEntries);
      if(!entries.length)return {started:false,reason:'MEMORY_BACKGROUND_EMPTY'};
      const {nativeSessionId:_native,executionSessionId:_execution,...binding}=target.binding;
      const workKey=consolidate||!executor?digest(JSON.stringify([consolidate?'receiver-v1':'unsupported-v1',binding,target.modelSelection,target.permissionMode,entries.slice().sort()])):undefined;
      const unchanged=workKey&&this.tasks.findLast(t=>t.workKey===workKey);
      if(unchanged&&!options.retry)return {started:false,taskId:unchanged.id,reason:'MEMORY_BACKGROUND_UNCHANGED'};
      const failedBatch=!options.retry&&consolidate&&this.tasks.findLast(t=>t.state!=='completed'&&t.lastBatchWorkKeys?.some(key=>entries.some(id=>entryWorkKey(target,id)===key)));
      if(failedBatch)return {started:false,taskId:failedBatch.id,reason:'MEMORY_BACKGROUND_UNCHANGED'};
      const task:MemoryBackgroundTask={id:randomUUID(),runtime:native,model:target.modelSelection.model,effort:target.modelSelection.effort,permissionMode:target.permissionMode??'default',submissionKey,state:'queued',createdAt:new Date().toISOString(),processed:0,total:entries.length};
      if(workKey)task.workKey=workKey;
      if(consolidate){task.mode='consolidation';task.recipientRuntime=native;}
      if(!executor||target.permissionMode==='read-only'||target.permissionMode==='plan'){task.state='blocked';task.reason=!executor?'MEMORY_BACKGROUND_BINDING_UNSUPPORTED':'MEMORY_BACKGROUND_READ_ONLY';task.finishedAt=new Date().toISOString();}
      this.tasks.push(task);await this.save();this.emit('changed',structuredClone(task));
      if(!executor||task.state==='blocked')return {started:false,taskId:task.id,reason:task.reason};
      const active:Active={task,target:structuredClone(target),executor,abort:new AbortController(),done:Promise.resolve()};
      const abortSequence=()=>active.abort.abort(sequence!.abort.signal.reason);
      if(sequence){if(sequence.abort.signal.aborted)abortSequence();else sequence.abort.signal.addEventListener('abort',abortSequence,{once:true});}
      if(!this.executors.includes(executor))active.abort.abort('MEMORY_BACKGROUND_EXECUTOR_REMOVED');
      this.active.set(native,active);
      active.done=this.run(active,entries).finally(()=>{sequence?.abort.signal.removeEventListener('abort',abortSequence);this.active.delete(native);});
      // Rejections remain visible in the journal; never start another model turn here.
      void active.done.catch(()=>{});
      return {started:true,taskId:task.id};
    });
    return this.recordAdmission(result,['codex','claude'].includes(target.binding.runtime)?target.binding.runtime as MemoryRuntime:undefined);
  }
  private async run(active:Active,entries:string[]){
    const {task,target,abort,executor}=active;
    let checking=false;
    const guard=setInterval(()=>{if(checking||abort.signal.aborted)return;checking=true;void this.port.allowed(target).then(allowed=>{if(!allowed)abort.abort('MEMORY_BACKGROUND_DISABLED');},()=>abort.abort('MEMORY_BACKGROUND_SETTINGS_UNKNOWN')).finally(()=>{checking=false;});},2000);guard.unref();
    try{
      await this.change(task,{state:'running'});
      if(task.mode==='consolidation'){
        await this.runConsolidation(active,entries);return;
      }
      // Frozen backlog, ten bounded batches at most; continuation requires verified progress.
      for(let offset=0;offset<entries.length;offset+=12){
        abort.signal.throwIfAborted();
        if(!await this.port.allowed(target))throw Error('MEMORY_BACKGROUND_DISABLED');
        const sessionId=randomUUID(),batch=await this.port.prepare(target,sessionId,task.id+':'+offset,entries.slice(offset,offset+12));
        if(!batch)continue;
        let result:Awaited<ReturnType<MemoryTaskExecutor['run']>>;
        let verified=0,checks=0;const processedBeforeBatch=task.processed;
        try{abort.signal.throwIfAborted();result=await executor.run({sessionId,target:structuredClone(target),prompt:batch.prompt,signal:abort.signal,read:async query=>{abort.signal.throwIfAborted();return this.port.read(target,sessionId,query);},verify:async()=>{
          abort.signal.throwIfAborted();
          if(!this.port.verify)throw Error('MEMORY_HANDOFF_VERIFY_UNSUPPORTED');
          if(checks>=2)throw Error('MEMORY_HANDOFF_VERIFY_LIMIT');
          checks++;
          const feedback=await this.port.verify(target,sessionId);
          await this.change(task,{processed:processedBeforeBatch+feedback.verified,receiptIssues:[...new Set(feedback.entries.flatMap(e=>e.code?[e.code]:[]))]});
          return feedback;
        }});}
        finally{verified=await this.port.finish(task.runtime,sessionId,batch.deliveryId);await this.change(task,{processed:processedBeforeBatch+verified,receiptIssues:this.port.issues?.(batch.deliveryId)});}
        abort.signal.throwIfAborted();
        if(result.state!=='completed'){await this.change(task,{state:result.state,reason:result.reason??'MEMORY_BACKGROUND_NATIVE_FAILED'});return;}
        if(verified!==batch.count){await this.change(task,{state:'blocked',reason:'MEMORY_BACKGROUND_RECEIPT_UNVERIFIED'});return;}
      }
      await this.change(task,{state:task.processed===task.total?'completed':'blocked',reason:task.processed===task.total?undefined:'MEMORY_BACKGROUND_SOURCE_CHANGED'});
    }catch(error){
      await this.change(task,{state:abort.signal.aborted?'cancelled':'failed',reason:abort.signal.aborted?String(abort.signal.reason):safeReason(error)});
      }finally{clearInterval(guard);await this.change(task,{finishedAt:new Date().toISOString()});}
  }
  private async runConsolidation(active:Active,entries:string[]){
    // A fresh native context per small batch avoids retransmitting the entire
    // backlog's growing tool history on every archive read and write.
    for(let offset=0;offset<entries.length;offset+=6){
      active.abort.signal.throwIfAborted();
      await this.change(active.task,{lastBatchWorkKeys:entries.slice(offset,offset+6).map(id=>entryWorkKey(active.target,id))});
      const complete=await this.runConsolidationBatch(active,entries.slice(offset,offset+6),offset);
      if(!complete)return;
    }
    await this.change(active.task,{state:'completed',reason:undefined});
  }
  private async runConsolidationBatch(active:Active,entries:string[],offset:number):Promise<boolean>{
    const {task,target,abort,executor}=active;
    if(!this.port.prepareConsolidation||!this.port.readConsolidation||!this.port.storeConsolidation||!this.port.verifyConsolidation||!this.port.finishConsolidation)throw Error('MEMORY_CONSOLIDATION_UNSUPPORTED');
    const sessionId=randomUUID();abort.signal.throwIfAborted();
    const batch=await this.port.prepareConsolidation(target,sessionId,task.id+':'+offset,entries);
    if(!batch||batch.count!==entries.length){if(batch)await this.port.finishConsolidation(sessionId);await this.change(task,{state:'blocked',reason:'MEMORY_BACKGROUND_SOURCE_CHANGED'});return false;}
    const processedBeforeBatch=task.processed;let verified=0;
    let result:Awaited<ReturnType<MemoryTaskExecutor['run']>>;
    const attempts=new Map<string,number>(),storageErrors=new Map<string,string>();let checks=0;
    try{
      abort.signal.throwIfAborted();
      result=await executor.run({sessionId,target:structuredClone(target),prompt:batch.prompt,signal:abort.signal,
        read:async query=>{abort.signal.throwIfAborted();return this.port.readConsolidation!(target,sessionId,query);},
        store:async input=>{
          abort.signal.throwIfAborted();
          const {consolidationInput}=await import('./consolidation');consolidationInput(input);
          for(const e of input.entries)if((attempts.get(e.archiveId)??0)>=2)throw Error('MEMORY_HANDOFF_VERIFY_LIMIT');
          for(const e of input.entries)attempts.set(e.archiveId,(attempts.get(e.archiveId)??0)+1);
          const feedback=await this.port.storeConsolidation!(target,sessionId,input,abort.signal);
          for(const entry of feedback.entries){if(entry.code)storageErrors.set(entry.archiveId,entry.code);else storageErrors.delete(entry.archiveId);}
          await this.change(task,{processed:processedBeforeBatch+feedback.verified,reason:storageErrors.values().next().value});return feedback;
        },
        verify:async()=>{abort.signal.throwIfAborted();if(++checks>2)throw Error('MEMORY_HANDOFF_VERIFY_LIMIT');return this.port.verifyConsolidation!(target,sessionId);},
      });
    }finally{
      verified=await this.port.finishConsolidation(sessionId);
      await this.change(task,{processed:processedBeforeBatch+verified,receiptIssues:[...new Set(batch.deliveryIds.flatMap(id=>this.port.issues?.(id)??[]))]});
    }
    abort.signal.throwIfAborted();
    if(result.state!=='completed'){await this.change(task,{state:result.state,reason:result.reason??'MEMORY_BACKGROUND_NATIVE_FAILED'});return false;}
    if(verified!==batch.count){await this.change(task,{state:'blocked',reason:storageErrors.values().next().value??'MEMORY_BACKGROUND_RECEIPT_UNVERIFIED'});return false;}
    return true;
  }
  async cancel(id:string){
    const active=[...this.active.values()].find(a=>a.task.id===id);
    if(!active){if(!this.tasks.some(t=>t.id===id))throw Error('MEMORY_BACKGROUND_TASK_NOT_FOUND');return {cancelled:false};}
    this.receiverSequence?.abort.abort('MEMORY_BACKGROUND_CANCELLED');active.abort.abort('MEMORY_BACKGROUND_CANCELLED');await active.done;return {cancelled:true};
  }
  async cancelAll(reason='MEMORY_BACKGROUND_DISABLED'){
    this.receiverSequence?.abort.abort(reason);for(const item of this.active.values())item.abort.abort(reason);
    // Wait for admission before collecting tasks; never hold this queue while awaiting execution.
    const {sequence,active}=await this.queue.run(async()=>{
      const sequence=this.receiverSequence;sequence?.abort.abort(reason);
      const active=[...this.active.values()];for(const item of active)item.abort.abort(reason);
      return {sequence,active};
    });
    await Promise.allSettled(active.map(a=>a.done));
    await sequence?.done;
  }
  async dispose(){this.stopped=true;await this.cancelAll('MEMORY_BACKGROUND_SHUTDOWN');await this.queue.idle();this.removeAllListeners();}
}
