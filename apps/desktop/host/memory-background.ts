import type { LocalModelAccounts } from './local-model-accounts';
import type { AppState, Session, SshHost } from '../../../packages/contracts';
import type { LocalCliService } from '../../../packages/native-runtime/cli';
import type { MemoryTaskBinding, MemoryTaskExecution, MemoryTaskExecutor } from '../../../packages/native-memory/background';
import { memoryHandoffTool, memoryHandoffVerifyTool, memoryConsolidationReadTool, memoryConsolidationStoreTool, memoryConsolidationVerifyTool } from '../../../packages/native-memory/tools';
import { NativeProviderRunner } from './native-provider';
import type { ModelConnections } from './model-connections';
import { attachNativeObservation } from './native-observation';
import { captureModelUsage } from '../../../packages/model-management/usage';
import type { ModelUsageEntry } from '../../../packages/model-management/types';
import { ProcessSupervisor, type ProcessSpec } from '../../../services/remote-supervisor';
import { NativeCodexRunner } from './native-codex';
import type { NativeCodexService } from '../../../services/codex-bridge';
import type { NativeClaudeService } from '../../../services/claude-bridge';
import type { ApiModel } from '../../../packages/model-api/types';

export interface MemoryRemoteExecution {
  host(id:string):SshHost;
  codex?:NativeCodexService;
  claude?:NativeClaudeService;
  assert(session:Session):void;
  claudeModel(session:Session):ApiModel;
  before(session:Session,signal:AbortSignal):Promise<void>;
  quota?:ConstructorParameters<typeof NativeCodexRunner>[1]['quota'];
}
export interface NativeMemoryExecutorOptions {
  usage?:(entries:ModelUsageEntry[])=>Promise<void>;
  processFactory?:(spec:ProcessSpec)=>ProcessSupervisor;
  remote?:MemoryRemoteExecution;
}

/** Owned maintenance process only: do not make summaries of the summarizer's own task. */
export function memoryMaintenanceProcess(runtime:'codex'|'claude',spec:ProcessSpec):ProcessSpec {
  return runtime==='codex'?{...spec,args:['-c','memories.generate_memories=false',...spec.args]}:{...spec,env:{...spec.env,CLAUDE_CODE_DISABLE_AUTO_MEMORY:'1'}};
}

/** The existing native transport, with a private ephemeral store and no foreground hooks. */
export class NativeMemoryTaskExecutor implements MemoryTaskExecutor {
  readonly mode='consolidation' as const;
  constructor(private connections:ModelConnections,private cli:LocalCliService,private fetcher?:typeof fetch,private accounts?:LocalModelAccounts,private options:NativeMemoryExecutorOptions={}){}
  supports(target:MemoryTaskBinding){
    const b=target.binding;if(!['codex','claude'].includes(b.runtime))return false;
    if(b.hostId){
      const remote=this.options.remote;
      if(!remote||b.egress!=='vps'||b.executionId!=='local-device'||b.modelConnectionId||b.localAccountId)return false;
      try{const session={...target} as Session;remote.assert(session);return !!(b.runtime==='codex'?remote.codex:remote.claude)?.supports(remote.host(b.hostId),session);}catch{return false;}
    }
    return b.egress==='direct-api'&&!!b.modelConnectionId||!!this.accounts&&b.egress==='runtime-managed'&&!!b.localAccountId&&!b.modelConnectionId;
  }
  async run(task:MemoryTaskExecution):ReturnType<MemoryTaskExecutor['run']>{
    if(!this.supports(task.target))throw Error('MEMORY_BACKGROUND_BINDING_UNSUPPORTED');
    const {binding,modelSelection,permissionMode,projectPath}=structuredClone(task.target);
    delete binding.nativeSessionId;delete binding.executionSessionId;
    const session:Session={id:task.sessionId,projectId:null,projectPath,title:'Memory maintenance',pinned:false,archived:false,group:'',binding,modelSelection,permissionMode,status:'idle',messages:[],createdAt:new Date().toISOString()};
    // Only the runner's ephemeral state. Never expose the foreground store or collaboration catalog.
    const remote=binding.hostId?this.options.remote:undefined;
    const host=remote?structuredClone(remote.host(binding.hostId!)):undefined;
    const hostBinding=(value:SshHost)=>{const {name:_label,...identity}=value;return JSON.stringify(identity);};
    const authorize=()=>{
      task.signal.throwIfAborted();
      if(remote){if(hostBinding(remote.host(binding.hostId!))!==hostBinding(host!))throw Error('MEMORY_BACKGROUND_BINDING_CHANGED');remote.assert(session);}
    };
    const state={sessions:[session],hosts:host?[host]:[],projects:[],modelConnections:[]} as unknown as AppState;
    let blocked=false,failed=false,observation:ReturnType<typeof attachNativeObservation>|undefined;
    const published=new Map<string,string>();
    const update=async(fn:(state:AppState)=>void)=>{
        fn(state);
        captureModelUsage(state,state);
        const changed=(state.modelUsage??[]).filter(row=>published.get(row.key)!==JSON.stringify(row));
        if(changed.length&&this.options.usage){await this.options.usage(structuredClone(changed));for(const row of changed)published.set(row.key,JSON.stringify(row));}
        if(session.nativeApprovals?.length||session.nativeInteractions?.some(i=>i.status==='pending'||i.kind==='unsupported')||session.messages.some(m=>m.questions?.length)){
          blocked=true;queueMicrotask(()=>stop());
        }
    };
    const peers=()=>({sourceSessionId:session.id,definitions:task.store?[memoryConsolidationReadTool,memoryConsolidationStoreTool,memoryConsolidationVerifyTool]:[memoryHandoffTool,memoryHandoffVerifyTool],call:async(name:string,input:unknown)=>{
        authorize();
        if(!input||typeof input!=='object'||Array.isArray(input))throw Error('MEMORY_BACKGROUND_TOOL_REJECTED');
        if(name===memoryHandoffTool.name)return task.read(input as Record<string,unknown>);
        if(name===memoryConsolidationStoreTool.name&&task.store)return task.store(input as Parameters<NonNullable<MemoryTaskExecution['store']>>[0]);
        if(name===memoryHandoffVerifyTool.name){if(Object.keys(input).length)throw Error('MEMORY_HANDOFF_ARGUMENT_INVALID');return task.verify();}
        throw Error('MEMORY_BACKGROUND_TOOL_REJECTED');
      }});
    const before=async()=>{authorize();await remote!.before(session,task.signal);authorize();};
    // A background runner owns only its fresh session, never the shared SSH service.
    const codex=remote?.codex;
    const runner=remote&&binding.runtime==='codex'?new NativeCodexRunner({
      supports:(h,s)=>codex!.supports(h,s),defaultDirectory:id=>codex!.defaultDirectory(id),
      connect:(h,s,o)=>{authorize();return codex!.connect(h,s,o);},close:id=>codex!.close(id),
      dispose:()=>codex!.close(session.id),
    },{snapshot:()=>structuredClone(state),update,beforeConnect:before,quota:remote.quota,
      context:async()=>({}),peers:()=>({peerTools:peers()}),translate:()=>{},
      observe:async(id,handle)=>{observation=attachNativeObservation(id,handle.connection.rpc,()=>structuredClone(state),update);},
    }):new NativeProviderRunner(this.connections,this.cli,{
      snapshot:()=>structuredClone(state),update,peers,
      context:async()=>'',translate:()=>{},observe:async(id,source)=>{observation=attachNativeObservation(id,source,()=>structuredClone(state),update);},failure:()=>{failed=true;},
      ...(remote?{remoteClaude:remote.claude,assertRemoteClaude:()=>{authorize();return remote.claudeModel(session);},beforeRemoteClaude:before}:{}),
    },this.fetcher,this.accounts,spec=>(this.options.processFactory??(spec=>new ProcessSupervisor(spec)))(memoryMaintenanceProcess(binding.runtime as 'codex'|'claude',spec)));
    let stopping:Promise<unknown>|undefined;
    const stop=()=>{stopping??=runner.stop(session.id).catch(()=>{}).finally(()=>{stopping=undefined;});};
    task.signal.addEventListener('abort',stop,{once:true});
    try{
      task.signal.throwIfAborted();
      await runner.submit(session.id,{id:task.sessionId,original:task.prompt,translated:task.prompt,revision:1,sourceHash:'memory-background',bypass:true,demo:false});
      if(task.signal.aborted)stop();
      while(runner.busy(session.id)){if(task.signal.aborted||blocked)stop();await new Promise(resolve=>setTimeout(resolve,25));}
      await stopping;
      // Codex keeps an idle transport after completion. Drain its event queue and
      // require owned cleanup before reporting success, without closing other chats.
      if(runner instanceof NativeCodexRunner)await runner.close(session.id);
      if(blocked)return {state:'blocked',reason:'MEMORY_BACKGROUND_INTERACTION_REQUIRED'};
      if(session.status==='uncertain')return {state:'uncertain',reason:'MEMORY_BACKGROUND_NATIVE_UNCERTAIN'};
      if(failed||session.nativeTurnStatus!=='completed')return {state:'failed',reason:'MEMORY_BACKGROUND_NATIVE_FAILED'};
      return {state:'completed'};
    }catch(error){
      if(session.status==='uncertain')return {state:'uncertain',reason:'MEMORY_BACKGROUND_NATIVE_UNCERTAIN'};
      throw error;
    }finally{
      task.signal.removeEventListener('abort',stop);
      try{await runner.dispose();}catch{return {state:'uncertain',reason:'MEMORY_BACKGROUND_CLEANUP_UNCONFIRMED'};}
      finally{await observation?.dispose();}
    }
  }
}
