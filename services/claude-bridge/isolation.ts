import type {ClaudeToolServer,ClaudeToolServerOptions} from './tools';
import {claudeMcpPolicy,ClaudeToolError} from './policy';

/** File operations retain native read-before-edit state; shell calls own separate trees. */
export async function openIsolatedClaudeTools(options:ClaudeToolServerOptions,open:(options:ClaudeToolServerOptions)=>Promise<ClaudeToolServer>):Promise<ClaudeToolServer>{
  const policy=claudeMcpPolicy(options.policy),base=await open(options);
  let closed=false,cleanupFailed=false,closing:Promise<void>|undefined,tail:Promise<unknown>=Promise.resolve();
  const commands=new Set<AbortController>(),running=new Set<Promise<unknown>>();
  const call=(name:string,args:unknown,signal?:AbortSignal):Promise<unknown>=>{
    if(closed)return Promise.reject(Error('CLAUDE_LOCAL_TOOLS_CLOSED'));
    if(signal?.aborted)return Promise.reject(Error('CLAUDE_LOCAL_TOOL_CANCELLED'));
    const shell=['Bash','PowerShell'].includes(name);
    if(shell&&commands.size>=policy.commandConcurrency)return Promise.reject(new ClaudeToolError({code:'CLAUDE_LOCAL_COMMAND_BUSY',tool:name,stage:'execute',outcome:'not-started'}));
    let operation:Promise<unknown>;
    if(shell){
      const abort=new AbortController();commands.add(abort);
      const cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});options.signal.addEventListener('abort',cancel,{once:true});
      operation=(async()=>{let tools:ClaudeToolServer|undefined;try{options.signal.throwIfAborted();tools=await open({...options,signal:abort.signal});abort.signal.throwIfAborted();return await tools.call(name,args,abort.signal);}finally{try{await tools?.close();}catch{cleanupFailed=true;throw Error('CLAUDE_LOCAL_CLEANUP_UNCONFIRMED');}}})().finally(()=>{commands.delete(abort);signal?.removeEventListener('abort',cancel);options.signal.removeEventListener('abort',cancel);});
    }else{
      operation=tail.catch(()=>{}).then(()=>{if(closed)throw Error('CLAUDE_LOCAL_TOOLS_CLOSED');if(signal?.aborted)throw new ClaudeToolError({code:'CLAUDE_LOCAL_TOOL_CANCELLED',tool:name,stage:'execute',outcome:'not-started'});return base.call(name,args,signal);});
      tail=operation;
    }
    running.add(operation);void operation.finally(()=>running.delete(operation)).catch(()=>{});return operation;
  };
  const close=()=>closing??=(async()=>{closed=true;options.signal.removeEventListener('abort',abort);for(const c of commands)c.abort();const result=await Promise.allSettled([base.close(),...running]);if(result[0]?.status==='rejected'||cleanupFailed)throw Error('CLAUDE_LOCAL_CLEANUP_UNCONFIRMED');})();
  const abort=()=>{void close().catch(()=>{});};options.signal.addEventListener('abort',abort,{once:true});
  if(options.signal.aborted){await close();throw Error('CLAUDE_LOCAL_TOOL_CANCELLED');}
  return {get definitions(){return base.definitions;},listTools:()=>base.listTools?.()??Promise.resolve(base.definitions),call,close};
}
