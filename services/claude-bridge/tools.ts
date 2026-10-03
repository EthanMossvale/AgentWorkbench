import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {PermissionMode} from '../../packages/contracts';
import {ProcessSupervisor, type NativeFrame, type ProcessSpec} from '../remote-supervisor';
import {normalizeClaudeToolResult} from './results';
import {claudeMcpPolicy,ClaudeToolError,claudeToolFailure,type ClaudeMcpPolicy,type ClaudeToolDiagnostic} from './policy';

/** Legacy file/process names remain exported for plugin compatibility, not admission. */
export const LOCAL_CLAUDE_TOOLS = ['Read','Write','Edit','Glob','Grep','Bash','PowerShell','NotebookEdit','TaskOutput','TaskStop'] as const;
export interface ClaudeToolCatalogSource {id:`plugin:${string}`;select(tools:readonly Record<string,unknown>[]):readonly Record<string,unknown>[]|undefined}
/** Native model/lifecycle operations stay with the bound remote runtime. */
const nativeRuntimeTools=new Set(['Agent','Task','Skill','ScheduleWakeup','CronCreate','CronDelete','CronList']);
export class ClaudeLocalToolCatalog {
 private sources=new Map<string,ClaudeToolCatalogSource>();
 register(source:ClaudeToolCatalogSource):()=>void{if(this.sources.has(source.id))throw Error('CLAUDE_LOCAL_CATALOG_DUPLICATE');const entry={...source};this.sources.set(entry.id,entry);return()=>{if(this.sources.get(entry.id)===entry)this.sources.delete(entry.id);};}
 select(tools:readonly Record<string,unknown>[]):readonly Record<string,unknown>[]{for(const source of [...this.sources.values()].reverse()){const value=source.select(tools);if(value!==undefined)return value;}return tools.filter(tool=>!nativeRuntimeTools.has(String(tool.name)));}
}
export const claudeLocalToolCatalog=new ClaudeLocalToolCatalog();
const readOnly = new Set(['Read','Glob','Grep','TaskOutput','LocalContext','LoadLocalSkill','LocalTaskOutput','ListLocalTasks','ReadLocalToolResult','workbench_list_projects','workbench_list_sessions','workbench_read_session','workbench_list_model_targets','workbench_read_agent','workbench_read_messages','workbench_wait_messages']);
export interface ClaudeToolServer {
  readonly definitions: readonly Record<string, unknown>[];
  listTools?():Promise<readonly Record<string,unknown>[]>;
  call(name:string, args:unknown, signal?:AbortSignal):Promise<unknown>;
  listPrompts?():Promise<unknown>;
  getPrompt?(name:string,args?:Record<string,string>):Promise<unknown>;
  close():Promise<void>;
}
export interface ClaudeToolServerOptions {
  executable:string;directory:string;cwd:string;env:NodeJS.ProcessEnv;signal:AbortSignal;
  policy?:Partial<ClaudeMcpPolicy>; diagnostic?(value:ClaudeToolDiagnostic):void;
  progress?(value:{callId:string;progress:number;total?:number}):void;
}
const MCP_PROTOCOL_VERSIONS=['2025-03-26','2024-11-05'] as const;
type McpProtocolVersion=typeof MCP_PROTOCOL_VERSIONS[number];

/** The official CLI implements every file/command tool. This adapter only frames MCP. */
export async function openOfficialClaudeTools(options:ClaudeToolServerOptions, factory=(spec:ProcessSpec)=>new ProcessSupervisor(spec),normalize=normalizeClaudeToolResult):Promise<ClaudeToolServer> {
  options.signal.throwIfAborted();
  const policy=claudeMcpPolicy(options.policy);
  await mkdir(options.directory,{recursive:true});
  const profile=await mkdtemp(path.join(options.directory,'tools-'));
  const env={...options.env};
  for(const key of Object.keys(env))if(/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$)/i.test(key))delete env[key];
  // Preserve explicit local shell selection and policy, without inheriting auth or model routing.
  for(const key of ['CLAUDE_CODE_GIT_BASH_PATH','CLAUDE_CODE_SHELL','CLAUDE_CODE_SHELL_PREFIX','CLAUDE_CODE_USE_POWERSHELL_TOOL','CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY'])if(options.env[key]!==undefined)env[key]=options.env[key];
  Object.assign(env,{CLAUDE_CONFIG_DIR:profile,ANTHROPIC_CONFIG_DIR:profile,ANTHROPIC_API_KEY:'awb-tool-only-no-inference',ANTHROPIC_BASE_URL:'http://127.0.0.1:1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL:'1',CLAUDE_CODE_DISABLE_AUTO_MEMORY:'1',CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:'1',DISABLE_AUTOUPDATER:'1'});
  const process=factory({executable:options.executable,args:['--setting-sources','','--settings','{"autoMemoryEnabled":false}','mcp','serve'],env,cwd:options.cwd,maxFrameBytes:policy.frameBytes,maxOutputBytes:policy.outputWindowBytes});
  let closed=false,closing:Promise<void>|undefined;
  let catalogRevision=0,listedRevision=-1;
  const pending=new Map<string,{resolve(value:unknown):void;reject(error:Error):void}>();
  const fail=(error?:unknown)=>{
    const message=error instanceof Error?error.message:'';
    const code=/frame limit|output limit/i.test(message)?'CLAUDE_LOCAL_WIRE_LIMIT':/truncated/i.test(message)?'CLAUDE_LOCAL_TRUNCATED_FRAME':/Invalid native JSONL/i.test(message)?'CLAUDE_LOCAL_INVALID_FRAME':'CLAUDE_LOCAL_TOOLS_DISCONNECTED';
    for(const p of pending.values())p.reject(new ClaudeToolError({code,stage:'transport',outcome:'unknown'}));
  };
  process.on('fault',fail);process.on('disconnect',fail);
  process.on('frame',(frame:NativeFrame)=>{
    const message=frame.value;
    // Each peer owns its request IDs. A server request can reuse an outbound ID.
    if(typeof message.method==='string'){
      if(message.id===undefined){
        if(message.method==='notifications/tools/list_changed')catalogRevision++;
        const p=message.params as any;
        if(message.method==='notifications/progress'&&typeof p?.progressToken==='string'&&pending.has(p.progressToken)&&Number.isFinite(p.progress)&&p.progress>=0){try{options.progress?.({callId:p.progressToken,progress:p.progress,...(Number.isFinite(p.total)&&p.total>=p.progress?{total:p.total}:{})});}catch{/* Observers do not own execution. */}}
        return;
      }
      if(message.method==='roots/list')void process.write({jsonrpc:'2.0',id:message.id,result:{roots:[{uri:pathToFileURL(options.cwd).href,name:'project'}]}}).catch(fail);
      else if(message.method==='ping')void process.write({jsonrpc:'2.0',id:message.id,result:{}}).catch(fail);
      // A tool-only server must never ask this host to sample a model or open auth.
      else void process.write({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Model sampling and authentication are unavailable on this tool-only host.'}}).catch(fail);
      return;
    }
    const entry=pending.get(String(message.id));
    if(entry){if(message.error)entry.reject(Error('CLAUDE_LOCAL_TOOL_REJECTED'));else entry.resolve(message.result);}
  });
  const close=()=>closing??=(async()=>{closed=true;fail();options.signal.removeEventListener('abort',abort);await process.stop('claude-tools-close');await rm(profile,{recursive:true,force:true});})();
  const abort=()=>{void close().catch(()=>{});};options.signal.addEventListener('abort',abort,{once:true});
  const request=async(method:string,params:unknown,signal?:AbortSignal,timeoutMs=180000):Promise<any>=>{
    if(closed)throw Error('CLAUDE_LOCAL_TOOLS_CLOSED');options.signal.throwIfAborted();signal?.throwIfAborted();
    const id=randomUUID();
    const started=Date.now();
    if(!pending.size)process.resetOutputBudget();
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error?:Error,value?:unknown)=>{
        if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);pending.delete(id);
        if(error){const failure=claudeToolFailure(error),diagnostic:ClaudeToolDiagnostic={...failure.diagnostic,code:failure.code,stage:failure.diagnostic?.stage??(method==='tools/call'?'execute':'catalog'),outcome:failure.diagnostic?.outcome??'unknown',callId:id,...(method==='tools/call'?{tool:(params as any)?.name}:{}),elapsedMs:Date.now()-started};try{options.diagnostic?.(diagnostic);}catch{/* Diagnostics never change execution. */}reject(new ClaudeToolError(diagnostic));}else resolve(value);
      };
      // Unknown execution is never retried. End this owned server tree on cancellation.
      const cancel=()=>{void process.write({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id,reason:'Caller cancelled.'}}).catch(()=>{});finish(Error('CLAUDE_LOCAL_TOOL_CANCELLED'));void close().catch(()=>{});};
      const timer=setTimeout(()=>{finish(Error('CLAUDE_LOCAL_TOOL_TIMEOUT'));void close().catch(()=>{});},timeoutMs);
      pending.set(id,{resolve:value=>finish(undefined,value),reject:error=>finish(error)});signal?.addEventListener('abort',cancel,{once:true});
      void process.write({jsonrpc:'2.0',id,method,params:{...(params as object),...(method==='tools/call'?{_meta:{progressToken:id}}:{})}}).catch(error=>finish(error));
    });
  };
  try{
    options.signal.throwIfAborted();await process.start();options.signal.throwIfAborted();
    const initialized=await request('initialize',{protocolVersion:'2024-11-05',capabilities:{roots:{listChanged:false}},clientInfo:{name:'agent-workbench-local-tools',version:'1'}},undefined,20000);
    if(!(MCP_PROTOCOL_VERSIONS as readonly unknown[]).includes(initialized?.protocolVersion))throw Error('CLAUDE_LOCAL_MCP_VERSION_UNSUPPORTED');
    await process.write({jsonrpc:'2.0',method:'notifications/initialized'});
    let definitions:Record<string,unknown>[]=[],listing:Promise<readonly Record<string,unknown>[]>|undefined;
    const listTools=():Promise<readonly Record<string,unknown>[]>=>{
      if(listedRevision===catalogRevision)return Promise.resolve(claudeLocalToolCatalog.select(definitions));
      return listing??=(async()=>{
        const revision=catalogRevision,found:Record<string,unknown>[]=[],cursors=new Set<string>(),names=new Set<string>();let cursor:string|undefined;
        for(let page=0;;page++){
          if(page>=policy.catalogPages)throw Error('CLAUDE_LOCAL_TOOL_CATALOG_LIMIT');
          const listed=await request('tools/list',cursor?{cursor}:{},undefined,20000);
          if(!Array.isArray(listed?.tools))throw Error('CLAUDE_LOCAL_TOOL_CATALOG_INVALID');
          for(const tool of listed.tools){if(typeof tool?.name!=='string'||names.has(tool.name)||names.size>=policy.catalogTools)throw Error('CLAUDE_LOCAL_TOOL_CATALOG_INVALID');names.add(tool.name);found.push(tool);}
          if(listed.nextCursor===undefined)break;
          if(typeof listed.nextCursor!=='string'||!listed.nextCursor||cursors.has(listed.nextCursor))throw Error('CLAUDE_LOCAL_TOOL_CATALOG_INVALID');
          cursor=listed.nextCursor as string;cursors.add(cursor);
        }
        definitions=found;listedRevision=revision;return claudeLocalToolCatalog.select(definitions);
      })().finally(()=>{listing=undefined;});
    };
    await listTools();
    return {get definitions(){return claudeLocalToolCatalog.select(definitions);},listTools,call:async(name,args,signal)=>{
      const available=await listTools();
      if(!available.some((tool:any)=>tool.name===name))throw Error('CLAUDE_LOCAL_TOOL_FORBIDDEN');
      const requested=(args as any)?.timeout;
      const timeout=['Bash','PowerShell'].includes(name)&&Number.isFinite(requested)&&requested>0?Math.min(600000,requested)+30000:180000;
      return normalize(name,await request('tools/call',{name,arguments:args},signal,timeout));
    },close};
  }catch(error){await close();throw error;}
}

/** HTTP clients get their own MCP state, but share only this session's official tool process. */
export class ClaudeToolMcpSession {
  private initialized=false;private ready=false;private closed=false;
  private pending=new Map<string,AbortController>();
  constructor(private tools:ClaudeToolServer,private permission:()=>PermissionMode,private authorize:()=>void){}
  async handle(input:any):Promise<unknown>{
    const id=input?.id,hasId=typeof id==='string'||Number.isSafeInteger(id);
    const error=(code:number,message:string)=>({jsonrpc:'2.0',id:hasId?id:null,error:{code,message}});
    const result=(value:unknown)=>({jsonrpc:'2.0',id,result:value});
    if(this.closed)return error(-32000,'Local tool session closed.');
    if(input?.jsonrpc!=='2.0'||typeof input.method!=='string')return error(-32600,'Invalid MCP request.');
    this.authorize();
    if(!hasId){if(input.method==='notifications/initialized'&&this.initialized)this.ready=true;if(input.method==='notifications/cancelled')this.pending.get(JSON.stringify(input.params?.requestId))?.abort();return;}
    if(input.method==='initialize'){
      if(this.initialized)return error(-32600,'Already initialized.');
      const requested=input.params?.protocolVersion;
      if(requested!==undefined&&typeof requested!=='string')return error(-32602,'protocolVersion must be a string.');
      const protocol=(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)?requested as McpProtocolVersion:MCP_PROTOCOL_VERSIONS[0];
      this.initialized=true;
      return result({protocolVersion:protocol,capabilities:{tools:{listChanged:false},...(this.tools.listPrompts&&this.tools.getPrompt?{prompts:{listChanged:false}}:{})},serverInfo:{name:'agent-workbench-claude-tools',version:'2'},instructions:'Official file/command tools execute in the selected project environment. Workbench LocalContext and LoadLocalSkill expose the current project resources; use them before project work and after compaction. Use Read for images, instructions and memory files. For an independent sidebar chat requested by the user, discover and call workbench_create_session; native Agent creates a subagent instead. Use workbench_list_sessions and workbench_read_session for existing sidebar chats. Only direct user authorization permits creation or messaging; native Agent remains available for subagent work. No model sampling is available here.'});
    }
    if(!this.ready)return error(-32000,'Initialize first.');
    if(input.method==='ping')return result({});
    if(input.method==='tools/list'){try{return result({tools:await this.tools.listTools?.()??this.tools.definitions});}catch(e){return {...error(-32603,claudeToolFailure(e).code)};}}
    if(input.method==='prompts/list'&&this.tools.listPrompts){try{return result(await this.tools.listPrompts());}catch{return error(-32000,'Local prompts could not be discovered.');}}
    if(input.method==='prompts/get'&&this.tools.getPrompt){try{return result(await this.tools.getPrompt(input.params?.name,input.params?.arguments));}catch{return error(-32602,'Local prompt is unavailable or unsupported; refresh discovery.');}}
    if(input.method!=='tools/call')return error(-32601,'Unsupported MCP method.');
    const name=input.params?.name,key=JSON.stringify(id);
    if(this.pending.has(key)||this.pending.size>=64)return error(-32000,'Tool request is already pending or the transport is busy.');
    const abort=new AbortController();this.pending.set(key,abort);
    try{
      const definitions=await this.tools.listTools?.()??this.tools.definitions;
      if(this.closed||abort.signal.aborted)throw Error('CLAUDE_LOCAL_TOOL_CANCELLED');
      this.authorize();
      if(!definitions.some(t=>t.name===name))return error(-32602,'This local tool is unavailable.');
      if(['Bash','PowerShell'].includes(name)&&input.params?.arguments?.run_in_background===true)return result({isError:true,content:[{type:'text',text:'This local tool connection supports foreground commands only. Native Agent orchestration remains available on the VPS.'}]});
      if(['plan','read-only'].includes(this.permission())&&!readOnly.has(name))return result({isError:true,content:[{type:'text',text:'The current local permission mode only permits read-only tools.'}]});
      return result(await this.tools.call(name,input.params?.arguments??{},abort.signal));
    }
    catch(e){const failure=claudeToolFailure(e),message=failure.diagnostic?.outcome==='returned'?'The native tool returned, but its result could not be delivered.':failure.diagnostic?.outcome==='not-started'?'The local tool was not started.':'The local tool did not confirm completion.';return result({isError:true,content:[{type:'text',text:failure.code+': '+message+' It was not retried.'}],structuredContent:{error:failure.code,...(failure.diagnostic?{diagnostic:failure.diagnostic}:{}),retried:false}});}
    finally{this.pending.delete(key);}
  }
  dispose(){this.closed=true;for(const abort of this.pending.values())abort.abort();this.pending.clear();}
}
