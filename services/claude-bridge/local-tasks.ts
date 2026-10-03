import {ClaudeCommandQueue} from './command-queue';
import {claudeMcpPolicy} from './policy';
import {randomUUID} from 'node:crypto';
import type {ClaudeToolServer,ClaudeToolServerOptions} from './tools';
import {type ClaudeResultStore,type ClaudeResultReference,resultReferenceContent} from './result-store';
import {claudeToolFailure} from './policy';

export type LocalClaudeShell = 'Bash'|'PowerShell';
export interface LocalClaudeCommand {requestId:string;command:string;shell?:LocalClaudeShell;timeout?:number;description?:string}
export interface LocalClaudeTask {
  id:string;requestId:string;shell:LocalClaudeShell;command:string;description?:string;
  state:'queued'|'starting'|'running'|'completed'|'failed'|'cancelled'|'uncertain';
  startedAt:string;finishedAt?:string;collected:boolean;result?:unknown;error?:string;
  output?:ClaudeResultReference;outputError?:string;
}
export interface ClaudeLocalTasks {
  start(input:LocalClaudeCommand,signal?:AbortSignal):Promise<LocalClaudeTask>;
  output(id:string,waitMs?:number,signal?:AbortSignal):Promise<LocalClaudeTask>;
  stop(id:string):Promise<LocalClaudeTask>;
  list():LocalClaudeTask[];
  /** Uncollected results also retain the session, without sending a model input. */
  pending():boolean;
  subscribe(listener:(task:LocalClaudeTask)=>void):()=>void;
  close():Promise<void>;
}
export function localClaudeShell(definitions:readonly Record<string,unknown>[],shell?:'bash'|'powershell'|LocalClaudeShell):LocalClaudeShell {
  const names=new Set(definitions.map(t=>t.name));
  if(shell==='Bash'||shell==='bash'){if(!names.has('Bash'))throw Error('LOCAL_SKILL_SHELL_UNAVAILABLE');return 'Bash';}
  if((shell==='PowerShell'||shell==='powershell')&&names.has('PowerShell'))return 'PowerShell';
  if(names.has('Bash'))return 'Bash';
  if(names.has('PowerShell'))return 'PowerShell';
  throw Error('LOCAL_SKILL_SHELL_UNAVAILABLE');
}
type Entry={value:LocalClaudeTask;abort:AbortController;server?:ClaudeToolServer;done:Promise<void>;closing?:Promise<void>;input:string};
const final=(task:LocalClaudeTask)=>!['queued','starting','running'].includes(task.state);
const copy=(task:LocalClaudeTask)=>structuredClone(task);

/** Each asynchronous command owns an official foreground tool server. No shell is emulated. */
export class LocalClaudeTasks implements ClaudeLocalTasks {
  private entries=new Map<string,Entry>();private requests=new Map<string,string>();
  private listeners=new Set<(task:LocalClaudeTask)=>void>();private closed=false;private closing?:Promise<void>;
  private abort=()=>{void this.close().catch(()=>{});};
  private queue:ClaudeCommandQueue;
  constructor(private options:ClaudeToolServerOptions,private open:(options:ClaudeToolServerOptions)=>Promise<ClaudeToolServer>,private results?:ClaudeResultStore){this.queue=new ClaudeCommandQueue(claudeMcpPolicy(options.policy).commandConcurrency);options.signal.addEventListener('abort',this.abort,{once:true});}
  private alive(){if(this.closed)throw Error('LOCAL_TASKS_CLOSED');this.options.signal.throwIfAborted();}
  private entry(id:string){this.alive();const entry=this.entries.get(id);if(!entry)throw Error('LOCAL_TASK_UNAVAILABLE');return entry;}
  private emit(entry:Entry){for(const listener of this.listeners){try{listener(copy(entry.value));}catch{/* Observers cannot change task execution. */}}}
  private closeServer(entry:Entry){return entry.closing??=(entry.server?.close()??Promise.resolve());}
  list(){this.alive();return [...this.entries.values()].map(e=>copy({...e.value,result:undefined}));}
  pending(){return [...this.entries.values()].some(e=>!final(e.value)||!e.value.collected);}
  subscribe(listener:(task:LocalClaudeTask)=>void){this.alive();this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  async start(input:LocalClaudeCommand,signal?:AbortSignal){
    this.alive();signal?.throwIfAborted();
    if(!input||typeof input.requestId!=='string'||!input.requestId.trim()||typeof input.command!=='string'||!input.command.trim()||input.command.includes('\0')||input.shell!==undefined&&!['Bash','PowerShell'].includes(input.shell)||input.timeout!==undefined&&(!Number.isSafeInteger(input.timeout)||input.timeout<0)||input.description!==undefined&&typeof input.description!=='string')throw Error('LOCAL_TASK_INPUT_INVALID');
    const canonical=JSON.stringify([input.command,input.shell??null,input.timeout??null,input.description??null]),previous=this.requests.get(input.requestId);
    if(previous){const entry=this.entry(previous);if(entry.input!==canonical)throw Error('LOCAL_TASK_REQUEST_CHANGED');return copy(entry.value);}
    const entry:Entry={value:{id:randomUUID(),requestId:input.requestId,shell:input.shell??'Bash',command:input.command,description:input.description,state:'queued',startedAt:new Date().toISOString(),collected:false},abort:new AbortController(),done:Promise.resolve(),input:canonical};
    this.entries.set(entry.value.id,entry);this.requests.set(input.requestId,entry.value.id);this.emit(entry);
    const cancel=()=>entry.abort.abort();signal?.addEventListener('abort',cancel,{once:true});
    const immediate=this.queue.available;
    let acknowledge!:()=>void;
    const started=new Promise<void>(resolve=>{acknowledge=resolve;});
    entry.done=this.queue.run(entry.abort.signal,async()=>{
      entry.value.state='starting';this.emit(entry);
      entry.server=await this.open({...this.options,signal:entry.abort.signal});
      if(this.closed||entry.abort.signal.aborted)throw Error('LOCAL_TASK_CANCELLED');
      entry.value.shell=localClaudeShell(entry.server.definitions,input.shell);
      if(input.shell&&entry.value.shell!==input.shell)throw Error('LOCAL_TASK_SHELL_UNAVAILABLE');
      entry.value.state='running';this.emit(entry);acknowledge();
      await this.run(entry,input);
    }).catch(async error=>{
      entry.value.state=entry.abort.signal.aborted?'cancelled':'failed';entry.abort.abort();
      entry.value.error=error instanceof Error&&/^LOCAL_/.test(error.message)?error.message:entry.value.state==='cancelled'?'LOCAL_TASK_CANCELLED':'LOCAL_TASK_START_FAILED';
      try{await this.closeServer(entry);}catch{entry.value.state='uncertain';entry.value.error='LOCAL_TASK_CLEANUP_UNCONFIRMED';}
      entry.value.finishedAt=new Date().toISOString();this.emit(entry);
    }).finally(()=>{signal?.removeEventListener('abort',cancel);acknowledge();});
    // Available slots acknowledge process startup; queued work returns its receipt immediately.
    if(immediate)await started;
    signal?.removeEventListener('abort',cancel);
    return copy(entry.value);
  }

  private async run(entry:Entry,input:LocalClaudeCommand){
    let state:LocalClaudeTask['state']='uncertain';
    try{
      const result:any=await entry.server!.call(entry.value.shell,{command:input.command,...(input.timeout!==undefined?{timeout:input.timeout}:{}),...(input.description?{description:input.description}:{})},entry.abort.signal);
      const texts=Array.isArray(result?.content)?result.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n'):'';
      let value:any;try{value=JSON.parse(texts);}catch{/* Native versions may return ordinary text. */}
      state=result?.isError||value?.interrupted||Number(value?.exitCode??value?.exit_code??0)!==0?'failed':'completed';
      if(Buffer.byteLength(JSON.stringify(result)??'')>(this.results?.inlineBytes??1024*1024)){
        try{if(!this.results)throw Error('LOCAL_TASK_OUTPUT_LIMIT');entry.value.output=await this.results.put(result);entry.value.result=resultReferenceContent(entry.value.output);}
        catch(error){entry.value.outputError=claudeToolFailure(error).code;}
      }else entry.value.result=result;
    }catch(error){state=entry.abort.signal.aborted?'cancelled':'uncertain';entry.value.error=claudeToolFailure(error).code;}
    finally{
      try{await this.closeServer(entry);}catch{state='uncertain';entry.value.error='LOCAL_TASK_CLEANUP_UNCONFIRMED';}
      entry.value.state=state;entry.value.finishedAt=new Date().toISOString();this.emit(entry);
    }
  }
  async output(id:string,waitMs=0,signal?:AbortSignal){
    const entry=this.entry(id);signal?.throwIfAborted();if(!Number.isSafeInteger(waitMs)||waitMs<0)throw Error('LOCAL_TASK_WAIT_INVALID');
    if(waitMs&&!final(entry.value))await new Promise<void>((resolve,reject)=>{
      const deadline=performance.now()+waitMs;let timer:ReturnType<typeof setTimeout>|undefined;
      const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
      const finish=()=>{clean();resolve();},cancel=()=>{clean();reject(Error('LOCAL_TASK_WAIT_CANCELLED'));};
      const wait=()=>{const remaining=deadline-performance.now();if(remaining<=0)finish();else timer=setTimeout(wait,Math.min(remaining,2147483647));};
      signal?.addEventListener('abort',cancel,{once:true});void entry.done.then(finish);wait();
    });
    this.alive();signal?.throwIfAborted();if(final(entry.value)){entry.value.collected=true;this.emit(entry);}return copy(entry.value);
  }
  async stop(id:string){const entry=this.entry(id);entry.abort.abort();if(entry.server)await this.closeServer(entry);await entry.done;entry.value.collected=true;this.emit(entry);return copy(entry.value);}
  close(){return this.closing??=(async()=>{this.closed=true;this.options.signal.removeEventListener('abort',this.abort);for(const entry of this.entries.values())entry.abort.abort();const results=await Promise.allSettled([...this.entries.values()].map(async entry=>{await entry.done;await this.closeServer(entry);}));this.listeners.clear();if(results.some(r=>r.status==='rejected'))throw Error('LOCAL_TASK_CLEANUP_UNCONFIRMED');})();}
}

export function withClaudeLocalTasks(tools:ClaudeToolServer,tasks:ClaudeLocalTasks):ClaudeToolServer {
  const definitions=[...tools.definitions,
    {name:'StartLocalCommand',description:'Start a local Bash or PowerShell command asynchronously in an owned official tool process or receive a queued receipt when execution slots are occupied. Reuse requestId only for the same request to retrieve its receipt without replay. Poll LocalTaskOutput for final output; ListLocalTasks lists receipts. Results remain in this session until read or stopped. No model requests or automatic continuation.',inputSchema:{type:'object',properties:{requestId:{type:'string'},command:{type:'string'},shell:{enum:['Bash','PowerShell']},timeout:{type:'integer',minimum:0},description:{type:'string'}},required:['requestId','command'],additionalProperties:false}},
    {name:'LocalTaskOutput',description:'Read a local asynchronous command receipt and final native tool result. Optional waitMs selects how long to await completion; cancelling a wait leaves the command running. Output is available after completion, not incrementally. Reading a final result acknowledges it; waiting cancellation does not cancel the command.',inputSchema:{type:'object',properties:{taskId:{type:'string'},waitMs:{type:'integer',minimum:0}},required:['taskId'],additionalProperties:false},annotations:{readOnlyHint:true}},
    {name:'ListLocalTasks',description:'List this local connection\'s command receipts without acknowledging results. Never lists unrelated OS processes.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
    {name:'StopLocalTask',description:'Stop one owned local command process tree and acknowledge its receipt. Does not stop other local commands or native VPS agents.',inputSchema:{type:'object',properties:{taskId:{type:'string'}},required:['taskId'],additionalProperties:false}}
  ];
  const extraDefinitions=definitions.slice(tools.definitions.length);
  let closing:Promise<void>|undefined;
  return {...tools,get definitions(){return [...tools.definitions,...extraDefinitions];},listTools:async()=>[...await tools.listTools?.()??tools.definitions,...extraDefinitions],call:async(name,args:any,signal)=>{
    const value=name==='StartLocalCommand'?await tasks.start(args,signal):name==='LocalTaskOutput'?await tasks.output(args?.taskId,args?.waitMs,signal):name==='ListLocalTasks'?tasks.list():name==='StopLocalTask'?await tasks.stop(args?.taskId):undefined;
    if(value===undefined)return tools.call(name,args,signal);
    const text=JSON.stringify(value),copy=JSON.parse(text);return {content:[{type:'text',text}],structuredContent:Array.isArray(copy)?{tasks:copy}:copy};
  },close:()=>closing??=(async()=>{const results=await Promise.allSettled([tasks.close(),tools.close()]);if(results.some(r=>r.status==='rejected'))throw Error('LOCAL_TASK_CLEANUP_UNCONFIRMED');})()};
}
