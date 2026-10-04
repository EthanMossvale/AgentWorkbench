import type {createPeerTools} from '../../packages/collaboration-core/tools';
import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import type {PermissionMode,Session,SshHost} from '../../packages/contracts';
import {buildSshArgs,buildSshEnvironment,SSH_EXECUTABLE} from '../../packages/ssh-transport';
import {openNativeGateway} from '../../packages/model-api/native-gateway';
import {createNativeProcess,ProcessSupervisor,type NativeFrame,type NativeProcessTransport,type ProcessExit,type ProcessSpec,type ProcessState} from '../remote-supervisor';
import {NATIVE_OWNER_REMOTE_BRIDGE} from '../codex-bridge/native-owner-remote';
import {ClaudeToolMcpSession,openOfficialClaudeTools,type ClaudeToolServer,type ClaudeToolServerOptions} from './tools';
import {LocalClaudeContext,withClaudeLocalContext,type ClaudeLocalContext} from './local-context';
import {LocalClaudeTasks,withClaudeLocalTasks} from './local-tasks';
import {normalizeClaudeToolResult} from './results';
import {claudeToolPolicies,type ClaudeMcpPolicy} from './policy';
import {openIsolatedClaudeTools} from './isolation';
import {LocalClaudeResultStore,withClaudeResultStore,type ClaudeResultStore} from './result-store';
import {withClaudeModelSurface,type ClaudeModelSurfaceOptions} from './model-surface';
import {CLAUDE_SESSION_CONTEXT_MARKER,ClaudeContextLedger} from './session-context';
import {ClaudeToolPresenters} from './presentation';
import {digest} from '../../packages/native-resources/files';

export interface NativeClaudeOptions extends ClaudeToolServerOptions {
  host:SshHost;session:Session;authorize():void;
  workbenchTools?:()=>ReturnType<typeof createPeerTools>;
}
export interface NativeClaudeService {
  supports(host:SshHost,session:Session):boolean;
  defaultDirectory(sessionId:string):string;
  /** Typed replacement point; registration uses the approved host service lifecycle. */
  openTools(options:ClaudeToolServerOptions):Promise<ClaudeToolServer>;
  openContext?(options:ClaudeToolServerOptions):Promise<ClaudeLocalContext>;
  normalizeToolResult?(name:string,result:unknown):unknown;
  toolPolicy?(options:ClaudeToolServerOptions):ClaudeMcpPolicy;
  openToolProcess?(options:ClaudeToolServerOptions):Promise<ClaudeToolServer>;
  openResultStore?(options:ClaudeToolServerOptions):Promise<ClaudeResultStore>;
  /** Model-facing layer over opened tools: presentation, hooks, stale-file checks and load hints. */
  readonly toolPresenters?:ClaudeToolPresenters;
  openModelTools?(tools:ClaudeToolServer,options:ClaudeModelSurfaceOptions):Promise<ClaudeToolServer>;
  createTransport(options:NativeClaudeOptions):NativeProcessTransport;
}
export function claudeAccountBinding(ref:string){
  if(!ref.startsWith('vps-account:'))throw Error('CLAUDE_ACCOUNT_BINDING_INVALID');
  const values=ref.slice(12).split('/').map(decodeURIComponent);
  if(values.length!==5||values[2]!=='claude'||values.some(v=>!v||v.length>256||/[\x00-\x20\x7f]/.test(v)))throw Error('CLAUDE_ACCOUNT_BINDING_INVALID');
  return {authorityId:values[0],authorityGeneration:values[1],accountId:values[3],accountGeneration:values[4]};
}
export class ClaudeBridgeService implements NativeClaudeService {
  /** Shared by this service's transports so each session receives unchanged local context once. */
  readonly toolPresenters=new ClaudeToolPresenters();
  readonly contextLedger=new ClaudeContextLedger();
  constructor(private directory:string,private factory=(spec:ProcessSpec)=>createNativeProcess(spec)){}
  supports(host:SshHost,session:Session){
    try{claudeAccountBinding(session.binding.accountRef);return host.role==='workspace'&&host.username!=='root'&&session.binding.hostId===host.id&&session.binding.runtime==='claude'&&session.binding.egress==='vps'&&session.binding.executionId==='local-device'&&session.binding.accountRuntime==='native-owner';}catch{return false;}
  }
  defaultDirectory(sessionId:string){if(!/^[a-f0-9-]{36}$/.test(sessionId))throw Error('CLAUDE_SESSION_ID_INVALID');return path.join(this.directory,'workspaces',sessionId);}
  openContext(options:ClaudeToolServerOptions):Promise<ClaudeLocalContext>{return Promise.resolve(new LocalClaudeContext(options));}
  normalizeToolResult(name:string,result:unknown){return normalizeClaudeToolResult(name,result);}
  toolPolicy(options:ClaudeToolServerOptions){return claudeToolPolicies.resolve(options.policy);}
  openToolProcess(options:ClaudeToolServerOptions){return openOfficialClaudeTools(options,this.factory,(name,result)=>this.normalizeToolResult(name,result));}
  openResultStore(options:ClaudeToolServerOptions):Promise<ClaudeResultStore>{return LocalClaudeResultStore.open(options);}
  openModelTools(tools:ClaudeToolServer,options:ClaudeModelSurfaceOptions):Promise<ClaudeToolServer>{return withClaudeModelSurface(tools,options,this.toolPresenters);}
  async openTools(options:ClaudeToolServerOptions){
    options={...options,policy:this.toolPolicy(options)};
    const tools=await openIsolatedClaudeTools(options,o=>this.openToolProcess(o));let results:ClaudeResultStore|undefined;
    try{
      results=await this.openResultStore(options);
      const context=withClaudeLocalContext(tools,await this.openContext(options));
      const tasks=new LocalClaudeTasks(options,o=>this.openToolProcess(o),results);
      return withClaudeResultStore(withClaudeLocalTasks(context,tasks),results);
    }catch(error){try{await tools.close();}finally{await results?.close();}throw error;}
  }
  createTransport(options:NativeClaudeOptions){if(!this.supports(options.host,options.session))throw Error('CLAUDE_REMOTE_BINDING_INVALID');return new ClaudeSshTransport(options,o=>this.openTools(o),this.factory,(tools,o)=>this.openModelTools(tools,o),this.contextLedger);}
}

/** Only stdio and tool transport cross SSH. Native authentication remains with the broker. */
export class ClaudeSshTransport extends EventEmitter implements NativeProcessTransport {
  state:ProcessState='new';
  private ssh?:ProcessSupervisor;private tools?:ClaudeToolServer;private gateway?:Awaited<ReturnType<typeof openNativeGateway>>;
  private abort=new AbortController();private cleanup?:Promise<ProcessExit>;private starting?:Promise<void>;
  private nativeClosed?:boolean;private permission:PermissionMode;private permissionRequests=new Map<string,PermissionMode>();
  private ready=false;private threadId?:string;
  private bootstrapWritten=false;
  /** Raw tools keep JSON results for workbench-internal reads such as local context assembly. */
  private rawTools?:ClaudeToolServer;
  /** Local instructions are attached to the first user turn and again after a compaction. */
  private contextPending=true;private replayed=new Map<string,unknown>();
  constructor(private options:NativeClaudeOptions,private openTools:(o:ClaudeToolServerOptions)=>Promise<ClaudeToolServer>,private factory:(spec:ProcessSpec)=>ProcessSupervisor,private openModelTools?:(tools:ClaudeToolServer,o:ClaudeModelSurfaceOptions)=>Promise<ClaudeToolServer>,private ledger=new ClaudeContextLedger()){super();this.permission=options.session.permissionMode??'default';}
  start(){if(this.state!=='new')return Promise.reject(Error('CLAUDE_TRANSPORT_ALREADY_STARTED'));this.state='starting';return this.starting=this.open();}
  private async open(){
    const o=this.options;
    const externalAbort=()=>{void this.stop('claude-cancelled').catch(()=>{});};o.signal.addEventListener('abort',externalAbort,{once:true});
    this.abort.signal.addEventListener('abort',()=>o.signal.removeEventListener('abort',externalAbort),{once:true});
    try{
      o.signal.throwIfAborted();o.authorize();
      const localEnv={...o.env,CLAUDE_EFFORT:o.session.modelSelection?.effort??o.env.CLAUDE_EFFORT};
      this.tools=this.rawTools=await this.openTools({...o,env:localEnv,signal:this.abort.signal});this.abort.signal.throwIfAborted();
      if(this.openModelTools){this.tools=await this.openModelTools(this.rawTools,{...o,env:localEnv,signal:this.abort.signal,sessionId:o.session.id,permission:()=>this.permission});this.abort.signal.throwIfAborted();}
      const modelTools=this.tools;
      this.tools={...modelTools,get definitions(){return modelTools.definitions;},call:async(name,args,signal)=>{
        const result:any=await modelTools.call(name,args,signal);
        if(!this.ready||!this.contextPending||name==='LocalContext')return result;
        const context=await this.localContext();
        this.contextPending=false;this.ledger.record(o.session.id,digest(context));
        return {...result,content:[...(result?.content??[]),{type:'text',text:context}]};
      }};
      if(o.workbenchTools){
        const local=this.tools,workbench=o.workbenchTools;
        const merge=(definitions:readonly Record<string,unknown>[])=>{
          if(workbench().definitions.some(tool=>definitions.some(local=>local.name===tool.name)))throw Error('CLAUDE_TOOL_NAME_COLLISION');
          return [...definitions,...workbench().definitions];
        };
        this.tools={...local,get definitions(){return merge(local.definitions);},listTools:async()=>merge(await local.listTools?.()??local.definitions),
          call:async(name,args,signal)=>{
            if(!workbench().definitions.some(tool=>tool.name===name))return local.call(name,args,signal);
            this.abort.signal.throwIfAborted();signal?.throwIfAborted();o.authorize();
            const value=await workbench().call(name,args,signal);
            return {content:[{type:'text',text:JSON.stringify(value??null)}]};
          },close:()=>local.close()};
      }
      const model={id:o.session.modelSelection?.model??'default',model:o.session.modelSelection?.model??'default',name:'Claude',enabled:true};
      this.gateway=await openNativeGateway({runtime:'claude',model,mcpOnly:true,authorizeMcp:()=>{this.abort.signal.throwIfAborted();o.authorize();},credentials:async()=>{throw Error('LOCAL_MODEL_NETWORKING_FORBIDDEN');},mcp:()=>new ClaudeToolMcpSession(this.tools!,()=>this.permission,()=>{this.abort.signal.throwIfAborted();o.authorize();})});
      this.abort.signal.throwIfAborted();
      const sessionId=o.session.binding.executionSessionId??o.session.id,socketPath=`/tmp/agent-workbench-${sessionId}-${randomBytes(8).toString('hex')}.sock`,endpoint=new URL(this.gateway.baseUrl);
      const command=`exec /usr/bin/python3 -u -c "import base64;exec(base64.b64decode('${Buffer.from(NATIVE_OWNER_REMOTE_BRIDGE).toString('base64')}'))"`;
      const args=buildSshArgs(o.host,command).map(v=>v==='ClearAllForwardings=yes'?'ClearAllForwardings=no':v);
      args.splice(args.indexOf('--'),0,'-o','ExitOnForwardFailure=yes','-o','StreamLocalBindMask=0177','-o','StreamLocalBindUnlink=no','-R',`${socketPath}:127.0.0.1:${endpoint.port}`);
      const ssh=this.ssh=this.factory({executable:SSH_EXECUTABLE,args,env:buildSshEnvironment()});
      let resolve!:()=>void,reject!:(error:Error)=>void;
      const connected=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});connected.catch(()=>{});
      // Owner preflight can use 25s for identity, 25s for initialize and 20s for MCP.
      const timer=setTimeout(()=>reject(Error('CLAUDE_REMOTE_PREPARATION_TIMEOUT')),90000);
      const cancel=()=>reject(Error('CLAUDE_REMOTE_CANCELLED'));this.abort.signal.addEventListener('abort',cancel,{once:true});
      ssh.on('frame',(received:NativeFrame)=>{
        let frame=received;const value=frame.value,params=value.params as any;
        if(value.method==='workbench/bridgeReady'){
          const receipt=params?.sessionReceipt;
          const fork=!o.session.binding.nativeSessionId?o.session.branch?.native:undefined;
          if(fork&&(receipt?.threadId!==o.session.id||receipt?.fork?.threadId!==fork.threadId||receipt?.fork?.lastMessageId!==fork.lastMessageId)){reject(Error('CLAUDE_REMOTE_FORK_UNSUPPORTED_OR_MISMATCH'));return;}
          if(this.ready||params?.provider!=='claude'||params?.transport!=='official-mcp-v1'||receipt?.cwd!==o.cwd||receipt?.environmentId!=='local-device'||typeof receipt?.threadId!=='string'||o.session.binding.nativeSessionId&&receipt.threadId!==o.session.binding.nativeSessionId){reject(Error('CLAUDE_REMOTE_RECEIPT_MISMATCH'));return;}
          this.threadId=receipt.threadId;this.ready=true;resolve();return;
        }
        if(value.method==='workbench/bridgeClosed'){this.nativeClosed=params?.cleanupConfirmed===true;return;}
        if(!this.ready){reject(Error('CLAUDE_REMOTE_UNAVAILABLE: The broker must support official-mcp-v1.'));return;}
        if(value.type==='control_response'){
          const response=value.response as any,id=response?.request_id,mode=this.permissionRequests.get(id);
          if(mode){this.permissionRequests.delete(id);if(response.subtype==='success'&&response.response?.mode===({default:'default',plan:'plan','accept-edits':'acceptEdits','full-access':'bypassPermissions'} as any)[mode])this.permission=mode;}
        }
        if(value.type==='system'&&value.subtype==='compact_boundary'&&!value.parent_tool_use_id){this.contextPending=true;this.ledger.reset(this.options.session.id);}
        // The replayed user turn shows what the user sent, without the attached local context.
        if(value.type==='user'&&!value.parent_tool_use_id&&typeof value.uuid==='string'&&this.replayed.has(value.uuid)){const original=this.replayed.get(value.uuid);this.replayed.delete(value.uuid);frame={...frame,value:{...value,message:{...(value.message as object),content:original}}};}
        this.emit('frame',frame);
      });
      ssh.on('fault',(error:Error)=>{reject(error);this.emit('fault',error);void this.stop('claude-ssh-fault').catch(()=>{});});
      ssh.on('disconnect',()=>{reject(Error('CLAUDE_REMOTE_DISCONNECTED'));if(this.state!=='stopping'&&this.state!=='closed'){this.emit('fault',Error('CLAUDE_REMOTE_DISCONNECTED'));void this.stop('claude-disconnect').catch(()=>{});}});
      try{
        await ssh.start();this.abort.signal.throwIfAborted();
        this.bootstrapWritten=true;
        await ssh.write({provider:'claude',username:o.host.username,sessionId,environmentId:'local-device',cwd:o.cwd,socketPath,secret:this.gateway.token,toolPath:endpoint.pathname+'/mcp',...claudeAccountBinding(o.session.binding.accountRef),selection:o.session.modelSelection??{},permissionMode:this.permission,...(!o.session.binding.nativeSessionId&&o.session.branch?.native?{fork:o.session.branch.native}:{})});
        await connected;this.abort.signal.throwIfAborted();this.state='running';
      }finally{clearTimeout(timer);this.abort.signal.removeEventListener('abort',cancel);}
    }catch(error){this.state='failed';this.emit('fault',error);throw error;}
  }
  async write(input:any){
    if(this.state!=='running'||!this.ssh)throw Error('CLAUDE_REMOTE_NOT_CONNECTED');this.options.authorize();
    if(input?.type==='control_request'&&input.request?.subtype==='set_permission_mode'){
      const mode=({default:'default',plan:'plan',acceptEdits:'accept-edits',bypassPermissions:'full-access'} as Record<string,PermissionMode>)[input.request.mode];
      if(!mode)throw Error('CLAUDE_PERMISSION_MODE_INVALID');this.permissionRequests.set(input.request_id,mode);
    }
    if(input?.type!=='user'){await this.ssh.write(input);return;}
    const loaded=this.contextPending&&!input.parent_tool_use_id?await this.localContext():undefined,session=this.options.session.id;
    const hash=loaded===undefined?undefined:digest(loaded),attach=hash&&this.ledger.needs(session,hash)?loaded:undefined;
    const message=attach?{...input.message,content:[{type:'text',text:attach},...(typeof input.message?.content==='string'?[{type:'text',text:input.message.content}]:Array.isArray(input.message?.content)?input.message.content:[])]}:input.message;
    if(attach&&typeof input.uuid==='string')this.replayed.set(input.uuid,input.message?.content);
    await this.ssh.write({...input,message,session_id:this.threadId});
    if(loaded!==undefined)this.contextPending=false;
    if(attach&&hash)this.ledger.record(session,hash);
  }
  /** Native-equivalent instruction and memory context from the bound local device. */
  private async localContext():Promise<string>{
    try{
      const result:any=await this.rawTools!.call('LocalContext',{includeContents:true},this.abort.signal);
      const value=JSON.parse(result?.content?.[0]?.text);if(typeof value?.contents==='string')return value.contents;
    }catch{/* Reported to the model below; the user turn is still delivered. */}
    return CLAUDE_SESSION_CONTEXT_MARKER+'\n<system-reminder>\nLocal instruction and memory context could not be attached automatically. Call LocalContext with includeContents true before project work.\n</system-reminder>';
  }
  stop(reason='requested'):Promise<ProcessExit>{return this.cleanup??=(async()=>{
    this.state='stopping';this.abort.abort();
    await this.starting?.catch(()=>{});this.state='stopping';
    // Revoke the local endpoint first, then ask the owner to reap the remote process.
    const local=Promise.allSettled([this.tools?.close(),this.gateway?.close()]);
    if(this.ready&&this.ssh?.state==='running'){
      let timer:ReturnType<typeof setTimeout>|undefined;
      const exited=new Promise<void>(resolve=>{this.ssh!.once('disconnect',resolve);timer=setTimeout(resolve,5000);});
      try{await this.ssh.write({type:'workbench_close'});await exited;}catch{/* Exit evidence below remains authoritative. */}finally{clearTimeout(timer);}
    }
    const exit=await this.ssh?.stop(reason)??{code:null,signal:null,reason};
    const cleaned=await local;this.state='closed';this.emit('disconnect',exit);
    if(cleaned.some(result=>result.status==='rejected')||this.bootstrapWritten&&!this.nativeClosed)throw Error('CLAUDE_CLEANUP_UNCONFIRMED');
    return exit;
  })();}
}
