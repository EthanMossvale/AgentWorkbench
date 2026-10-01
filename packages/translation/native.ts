import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { ProcessSupervisor, type NativeFrame, type ProcessSpec } from '../../services/remote-supervisor';
import { CodexRpcClient } from '../runtime-codex';
import { parseTokenCounts, tokenCount } from '../session-metrics';
import { TranslationExecutionError } from './types';
import type { TranslationCompletion, TranslationExecutionRequest } from './types';

export interface NativeTranslationLaunch { runtime: 'codex'|'claude'; executable: string; env: NodeJS.ProcessEnv; model: string; effort?: string }
/** One owned native request. No account tokens, chat history, tools, or outer retries. */
export class NativeTranslationRunner {
  private active = new Map<string,{abort:AbortController;done:Promise<unknown>}>();
  constructor(private directory:string, private factory:(spec:ProcessSpec)=>ProcessSupervisor=spec=>new ProcessSupervisor(spec)){}
  busy(){return this.active.size>0;}
  async run(launch:NativeTranslationLaunch,request:TranslationExecutionRequest):Promise<TranslationCompletion>{
    const id=randomUUID(),abort=new AbortController();
    const done=this.execute(launch,{...request,signal:AbortSignal.any([request.signal,abort.signal])});
    this.active.set(id,{abort,done});try{return await done;}finally{this.active.delete(id);}
  }
  async dispose(){for(const task of this.active.values())task.abort.abort();await Promise.allSettled([...this.active.values()].map(task=>task.done));}
  private async execute(launch:NativeTranslationLaunch,request:TranslationExecutionRequest):Promise<TranslationCompletion>{
    request.signal.throwIfAborted();
    const root=path.join(this.directory,'translation-runs');await mkdir(root,{recursive:true});
    const cwd=await mkdtemp(path.join(root,'request-'));
    const codex=launch.runtime==='codex';
    const config:Record<string,unknown>={check_for_update_on_startup:false,web_search:'disabled',mcp_servers:{},project_doc_max_bytes:0,'tools.update_plan.enabled':false,'tools.experimental_request_user_input.enabled':false,'features.skip_host_skill_discovery':true};
    for(const feature of ['goals','token_budget','shell_tool','unified_exec','apply_patch_freeform','multi_agent','apps','memories','memory_tool','hooks','codex_hooks','plugin_hooks','plugins','js_repl','image_generation','view_image','browser_use','computer_use','default_mode_request_user_input','collaboration_modes','shell_snapshot'])config['features.'+feature]=false;
    const args=codex?[...Object.entries(config).flatMap(([k,v])=>['-c',`${k}=${JSON.stringify(v)}`]),'app-server','--listen','stdio://']:
      ['--print','--verbose','--input-format','stream-json','--output-format','stream-json','--no-session-persistence','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands','--setting-sources','','--settings','{"autoMemoryEnabled":false,"disableAllHooks":true}','--model',launch.model,'--system-prompt',request.instructions,...(launch.effort?['--effort',launch.effort]:[])];
    const child=this.factory({executable:launch.executable,args,cwd,env:launch.env,maxFrameBytes:8*1024*1024,maxOutputBytes:32*1024*1024});
    let completed=false,threadId:string|undefined,text='',reasoningTokens:number|null=null,counts=parseTokenCounts(undefined,codex?'codex':'anthropic-messages');
    let resolve!:(value:TranslationCompletion)=>void,reject!:(error:Error)=>void;
    const result=new Promise<TranslationCompletion>((yes,no)=>{resolve=yes;reject=no;});void result.catch(()=>{});
    const fail=(code:string)=>{if(completed)return;completed=true;reject(new TranslationExecutionError(code,counts,launch.model,reasoningTokens));void child.stop('translation-failed').catch(()=>{});};
    const finish=()=>{if(completed)return;if(!text.trim()){fail('TRANSLATION_NATIVE_EMPTY');return;}completed=true;resolve({text,counts,model:launch.model,reasoningTokens});};
    const cancel=()=>{fail('TRANSLATION_CANCELLED');void child.stop('translation-cancelled').catch(()=>{});};
    request.signal.addEventListener('abort',cancel,{once:true});
    const rpc=codex?new CodexRpcClient(child,randomUUID()):undefined;
    rpc?.on('fault',()=>fail('TRANSLATION_NATIVE_PROTOCOL'));rpc?.on('uncertain',()=>fail('TRANSLATION_NATIVE_RESULT_UNKNOWN'));
    rpc?.on('serverRequest',(frame:NativeFrame)=>{void child.write({id:frame.value.id,error:{code:-32601,message:'Translation does not allow tools or interactive requests.'}}).catch(()=>{});fail('TRANSLATION_NATIVE_TOOL_REJECTED');});
    child.on('fault',()=>fail('TRANSLATION_NATIVE_PROTOCOL'));
    child.on('disconnect',()=>fail('TRANSLATION_NATIVE_RESULT_UNKNOWN'));
    child.on('frame',(frame:NativeFrame)=>{
      const v=frame.value as Record<string,any>,p=v.params??{};
      if(codex){
        if(!threadId||p.threadId!==threadId)return;
        if(v.method==='thread/tokenUsage/updated'){const usage=p.tokenUsage?.total??p.tokenUsage?.last;counts={...parseTokenCounts(usage,'codex'),cacheWriteTokens:tokenCount(usage?.cacheWriteInputTokens)};reasoningTokens=tokenCount(usage?.reasoningOutputTokens);}
        if(v.method==='item/completed'&&p.item?.type==='agentMessage')text=String(p.item.text??'');
        if(v.method==='item/started'&&['commandExecution','fileChange','mcpToolCall','dynamicToolCall','collabAgentToolCall','webSearch'].includes(p.item?.type))fail('TRANSLATION_NATIVE_TOOL_REJECTED');
        if(v.method==='turn/completed'){if(p.turn?.status==='completed')finish();else fail('TRANSLATION_NATIVE_FAILED');}
      }else{
        if(v.type==='control_request'){void child.write({type:'control_response',response:{subtype:'error',request_id:v.request_id,error:'Translation does not allow tools or interactive requests.'}}).catch(()=>{});fail('TRANSLATION_NATIVE_TOOL_REJECTED');}
        if(v.type==='assistant'&&Array.isArray(v.message?.content)){
          if(v.message.content.some((part:any)=>part.type==='tool_use'))fail('TRANSLATION_NATIVE_TOOL_REJECTED');
          text=v.message.content.filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('');
          if(v.message.usage)counts=parseTokenCounts(v.message.usage,'anthropic-messages');
        }
        if(v.type==='result'){if(v.usage)counts=parseTokenCounts(v.usage,'anthropic-messages');if(v.subtype==='success'&&!v.is_error){if(typeof v.result==='string')text=v.result;finish();}else fail('TRANSLATION_NATIVE_FAILED');}
      }
    });
    try{
      request.signal.throwIfAborted();await Promise.race([child.start(),result]);if(completed)return await result;
      if(rpc){
        await Promise.race([rpc.initialize(),result]);request.signal.throwIfAborted();if(completed)return await result;
        const start=await Promise.race([rpc.request<any>('thread/start',{cwd,model:launch.model,modelProvider:'openai',approvalPolicy:'never',sandbox:'read-only',ephemeral:true,baseInstructions:request.instructions,developerInstructions:'Return only the requested translation. Do not call tools.',dynamicTools:[],config}),result]);
        if(completed)return await result;request.signal.throwIfAborted();
        if(typeof start.thread?.id!=='string')throw Error('TRANSLATION_NATIVE_PROTOCOL');threadId=start.thread.id;rpc.bindRootThread(threadId!);
        await Promise.race([rpc.request('turn/start',{threadId,input:[{type:'text',text:request.input}],model:launch.model,...(launch.effort?{effort:launch.effort}:{}),approvalPolicy:'never',sandboxPolicy:{type:'readOnly'}}),result]);
      }else await child.write({type:'user',message:{role:'user',content:request.input},parent_tool_use_id:null,session_id:'',uuid:randomUUID()});
      return await result;
    }catch(error){if(error instanceof TranslationExecutionError)throw error;throw new TranslationExecutionError(request.signal.aborted?'TRANSLATION_CANCELLED':'TRANSLATION_NATIVE_FAILED',counts,launch.model,reasoningTokens);}
    finally{request.signal.removeEventListener('abort',cancel);try{await child.stop('translation-finished');}finally{await rm(cwd,{recursive:true,force:true});}}
  }
}
