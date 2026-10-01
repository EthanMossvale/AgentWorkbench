export class TranslationQueue {
  private running=0;
  private pending:{key:string;priority:number;run:()=>Promise<unknown>;resolve:(value:unknown)=>void;reject:(error:unknown)=>void;signal?:AbortSignal}[]=[];
  private inflight=new Map<string,Promise<unknown>>();
  constructor(private concurrency=2,private capacity=64){if(concurrency<1||capacity<1)throw new Error('Invalid queue limits');}
  enqueue<T>(key:string,kind:'input'|'final'|'progress',run:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
    const existing=this.inflight.get(key);if(existing)return existing as Promise<T>;
    if(this.pending.length>=this.capacity)return Promise.reject(new Error('翻译队列已满；原生进度不受影响。'));
    if(signal?.aborted)return Promise.reject(signal.reason);
    let resolve!:(value:unknown)=>void,reject!:(error:unknown)=>void;
    const promise=new Promise<unknown>((res,rej)=>{resolve=res;reject=rej;});this.inflight.set(key,promise);
    this.pending.push({key,priority:kind==='input'?0:kind==='final'?1:2,run,resolve,reject,signal});
    this.pending.sort((a,b)=>a.priority-b.priority);this.pump();
    return promise as Promise<T>;
  }
  private pump(){while(this.running<this.concurrency&&this.pending.length){const task=this.pending.shift()!;
    if(task.signal?.aborted){this.inflight.delete(task.key);task.reject(task.signal.reason);continue;}
    this.running++;Promise.resolve().then(task.run).then(task.resolve,task.reject).finally(()=>{this.inflight.delete(task.key);this.running--;this.pump();});
  }}
}
