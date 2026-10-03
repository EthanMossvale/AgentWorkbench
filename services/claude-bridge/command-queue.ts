/** Queue owned work rather than rejecting it when execution slots are occupied. */
export class ClaudeCommandQueue {
 private active=0;
 private waiting:{start():void;cancel():void}[]=[];
 constructor(private concurrency:number){}
 run<T>(signal:AbortSignal,execute:()=>Promise<T>):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
   const cancel=()=>{const index=this.waiting.indexOf(entry);if(index>=0)this.waiting.splice(index,1);signal.removeEventListener('abort',cancel);reject(Error('CLAUDE_LOCAL_TOOL_CANCELLED'));};
   const entry={cancel,start:()=>{
    signal.removeEventListener('abort',cancel);this.active++;
    void Promise.resolve().then(()=>{signal.throwIfAborted();return execute();}).then(resolve,reject).finally(()=>{this.active--;this.pump();});
   }};
   if(signal.aborted){cancel();return;}
   signal.addEventListener('abort',cancel,{once:true});this.waiting.push(entry);this.pump();
  });
 }
 private pump(){while(this.waiting.length&&(!this.concurrency||this.active<this.concurrency))this.waiting.shift()!.start();}
}
