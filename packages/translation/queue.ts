export interface TranslationScheduling {id:`plugin:${string}`;concurrency:number}
export class TranslationQueue {
  private running=0;
  private pending:{key:string;priority:number;run:()=>Promise<unknown>;resolve:(value:unknown)=>void;reject:(error:unknown)=>void;signal?:AbortSignal}[]=[];
  private inflight=new Map<string,Promise<unknown>>();
  private policies=new Map<string,TranslationScheduling>();
  /** The obsolete capacity parameter remains accepted; pending requests are never discarded. */
  constructor(private concurrency=2,_capacity?:number){if(concurrency<1)throw new Error('Invalid queue concurrency');}
  limits(){return {concurrency:[...this.policies.values()].at(-1)?.concurrency??this.concurrency};}
  register(policy:TranslationScheduling):()=>void{
    if(this.policies.has(policy.id)||!Number.isSafeInteger(policy.concurrency)||policy.concurrency<1)throw Error('TRANSLATION_SCHEDULING_INVALID');
    const entry={...policy};this.policies.set(entry.id,entry);this.pump();return()=>{if(this.policies.get(entry.id)===entry){this.policies.delete(entry.id);this.pump();}};
  }
  enqueue<T>(key:string,kind:'input'|'final'|'progress',run:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
    const existing=this.inflight.get(key);if(existing)return existing as Promise<T>;
    if(signal?.aborted)return Promise.reject(signal.reason);
    let resolve!:(value:unknown)=>void,reject!:(error:unknown)=>void;
    const promise=new Promise<unknown>((res,rej)=>{resolve=res;reject=rej;});this.inflight.set(key,promise);
    this.pending.push({key,priority:kind==='input'?0:kind==='final'?1:2,run,resolve,reject,signal});
    this.pending.sort((a,b)=>a.priority-b.priority);this.pump();
    return promise as Promise<T>;
  }
  private pump(){while(this.running<this.limits().concurrency&&this.pending.length){const task=this.pending.shift()!;
    if(task.signal?.aborted){this.inflight.delete(task.key);task.reject(task.signal.reason);continue;}
    this.running++;Promise.resolve().then(task.run).then(task.resolve,task.reject).finally(()=>{this.inflight.delete(task.key);this.running--;this.pump();});
  }}
}
