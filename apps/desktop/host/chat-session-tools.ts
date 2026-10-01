import { createHash,randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AppState,DraftPreview,NativeModelSelection,Session } from '../../../packages/contracts';
import type { ModelTarget } from '../../../packages/model-api/types';
import { assertChatCreation,chatSessionToolDefinitions,type ChatCreationOperation } from '../../../packages/collaboration-core/session-tools';

interface Hooks {
  snapshot():AppState;
  update(change:(state:AppState)=>void):Promise<unknown>;
  assertSource(id:string):void;
  owner(session:Pick<Session,'binding'>):string;
  targets():Promise<ModelTarget[]>;
  validateSelection(target:ModelTarget,selection:NativeModelSelection):NativeModelSelection;
  create(input:Record<string,unknown>):Promise<Session>;
  submit(session:Session,preview:DraftPreview):Promise<unknown>;
}
const bounded=(value:unknown,max:number)=>typeof value==='string'&&!!value.trim()&&value.length<=max&&!/[\x00]/.test(value);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const samePath=(a:string,b:string)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);

/** Source-bound chat creation; the durable reservation prevents replay after a lost receipt. */
export class ChatSessionTools {
  private pending=new Map<string,{hash:string;promise:Promise<unknown>}>();
  private closed=false;
  constructor(private hooks:Hooks){}
  dispose(){this.closed=true;}
  private source(id:string){
    if(this.closed)throw Error('CHAT_TOOLS_DISPOSED');
    this.hooks.assertSource(id);
    const session=this.hooks.snapshot().sessions.find(s=>s.id===id);
    if(!session||session.archived)throw Error('CHAT_SOURCE_UNAVAILABLE');
    return session;
  }
  async call(sourceId:string,name:string,p:Record<string,unknown>,signal?:AbortSignal):Promise<unknown>{
    const definition=chatSessionToolDefinitions.find(d=>d.name===name);
    if(!definition||Object.keys(p).some(key=>!Object.hasOwn(definition.inputSchema.properties as object,key)))throw Error('CHAT_TOOL_ARGUMENTS_INVALID');
    this.source(sourceId);signal?.throwIfAborted();
    return name==='workbench_list_projects'?this.listProjects(sourceId,p):this.create(sourceId,p,signal);
  }
  listProjects(sourceId:string,p:Record<string,unknown>={}){
    this.source(sourceId);
    if(Object.keys(p).some(key=>!['query','cursor','limit'].includes(key))||p.query!==undefined&&!bounded(p.query,200)||p.cursor!==undefined&&!bounded(p.cursor,256)||p.limit!==undefined&&(!Number.isSafeInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>100))throw Error('CHAT_PROJECT_QUERY_INVALID');
    const query=String(p.query??'').toLocaleLowerCase(),projects=this.hooks.snapshot().projects.filter(project=>!query||[project.name,...project.paths??[project.path]].some(value=>value.toLocaleLowerCase().includes(query)));
    const index=p.cursor===undefined?-1:projects.findIndex(project=>project.id===p.cursor);if(p.cursor!==undefined&&index<0)throw Error('CHAT_PROJECT_CURSOR_STALE');
    const page=projects.slice(index+1,index+1+Number(p.limit??20));
    return {projects:page.map(({id,name,path,paths})=>({id,name,paths:paths??[path]})),nextCursor:index+1+page.length<projects.length?page.at(-1)!.id:null,note:'Existing local workbench projects; no chat or model task was started.'};
  }
  private receipt(operation:ChatCreationOperation,reused:boolean){
    const session=operation.sessionId?this.hooks.snapshot().sessions.find(s=>s.id===operation.sessionId):undefined;
    return {operationId:operation.operationId,sessionId:operation.sessionId??null,state:operation.state==='pending'?'uncertain':operation.state,status:session?.status??'unavailable',title:session?.title??null,reused,note:'Independent sidebar chat. An existing operation is never resubmitted; use workbench_read_session to inspect a returned session ID.'};
  }
  async create(sourceId:string,p:Record<string,unknown>,signal?:AbortSignal):Promise<unknown>{
    const allowed=chatSessionToolDefinitions[1]!.inputSchema.properties as object;
    if(Object.keys(p).some(key=>!Object.hasOwn(allowed,key))||!bounded(p.operationId,256)||!bounded(p.task,100000)||!bounded(p.authorizationQuote,2000)||p.title!==undefined&&!bounded(p.title,200)||p.targetId!==undefined&&!bounded(p.targetId,2048)||p.effort!==undefined&&(!bounded(p.effort,256)||/[\x00-\x1f]/.test(String(p.effort)))||p.projectId!==undefined&&p.projectId!==null&&!bounded(p.projectId,256)||p.projectPath!==undefined&&!bounded(p.projectPath,4096))throw Error('CHAT_CREATE_ARGUMENTS_INVALID');
    const source=this.source(sourceId),operationId=String(p.operationId),task=String(p.task),key=JSON.stringify([sourceId,operationId]);
    const requestHash=hash(JSON.stringify(['projectId','projectPath','targetId','title','task','authorizationQuote','effort'].map(key=>[Object.hasOwn(p,key),p[key]])));
    const pending=this.pending.get(key);if(pending){if(pending.hash!==requestHash)throw Error('CHAT_OPERATION_CONFLICT');return pending.promise;}
    const existing=this.hooks.snapshot().chatCreations?.find(op=>op.sourceSessionId===sourceId&&op.operationId===operationId);
    if(existing){if(existing.requestHash!==requestHash)throw Error('CHAT_OPERATION_CONFLICT');return this.receipt(existing,true);}
    const run=this.start(source,p,task,operationId,requestHash,signal);this.pending.set(key,{hash:requestHash,promise:run});
    try{return await run;}finally{this.pending.delete(key);}
  }
  private directRequest(source:Session){
    const message=source.messages.filter(m=>m.role==='user').at(-1);
    if(source.status!=='running'||!message||source.agentCreated?.initialMessageId===message.id||source.agentParent&&source.messages.filter(m=>m.role==='user').length===1||this.hooks.snapshot().chatCreations?.some(op=>op.sessionId===source.id&&op.initialMessageId===message.id))throw Error('CHAT_REQUIRES_DIRECT_USER_TASK');
    return message;
  }
  private unchangedSource(source:Session,request:{id:string;original:string}){
    const current=this.source(source.id),latest=this.directRequest(current);
    const scope=(session:Session)=>JSON.stringify([session.binding,session.permissionMode,session.projectId,session.projectPath]);
    if(latest.id!==request.id||latest.original!==request.original||scope(current)!==scope(source))throw Error('CHAT_SOURCE_CHANGED');
  }
  private async start(source:Session,p:Record<string,unknown>,task:string,operationId:string,requestHash:string,signal?:AbortSignal){
    const request=this.directRequest(source);assertChatCreation(request.original,p.authorizationQuote,request.submitted);
    const targets=await this.hooks.targets();
    const targetId=p.targetId??source.modelTargetId;
    const target=targets.find(t=>targetId?t.id===targetId:t.runtime===source.binding.runtime&&t.binding.modelConnectionId===source.binding.modelConnectionId&&t.binding.modelMappingId===source.binding.modelMappingId&&t.binding.hostId===source.binding.hostId&&t.binding.accountRef===source.binding.accountRef);
    if(!target?.ready)throw Error('CHAT_MODEL_TARGET_UNAVAILABLE');
    if(this.hooks.owner(source)!==this.hooks.owner(target))throw Error('CHAT_OWNER_MISMATCH');
    if(source.binding.executionId!==target.binding.executionId||source.binding.hostId!==target.binding.hostId)throw Error('CHAT_TARGET_LOCATION_MISMATCH');
    const defaults=p.targetId===undefined||target.id===source.modelTargetId?source.nativeActiveSettings?.modelSelection??source.modelSelection??target.selection:target.selection;
    if(p.effort!==undefined&&!defaults?.model)throw Error('CHAT_MODEL_SELECTION_REQUIRED: Select a model target before specifying its reasoning effort.');
    const selection=defaults?this.hooks.validateSelection(target,{...defaults,...(p.effort!==undefined?{effort:String(p.effort)}:{})}):undefined;
    const projectId=p.projectId===undefined?source.projectId:p.projectId as string|null,project=projectId?this.hooks.snapshot().projects.find(project=>project.id===projectId):undefined;
    if(projectId&&!project)throw Error('CHAT_PROJECT_UNAVAILABLE');
    const projectPath=p.projectPath===undefined?(projectId===source.projectId&&source.projectPath?source.projectPath:project?.path??source.projectPath):String(p.projectPath);
    if(p.projectPath!==undefined&&(!project||!(project.paths??[project.path]).some(folder=>samePath(folder,projectPath!))))throw Error('CHAT_PROJECT_PATH_UNREGISTERED');
    signal?.throwIfAborted();this.unchangedSource(source,request);
    const operation:ChatCreationOperation={sourceSessionId:source.id,operationId,requestHash,authorizationMessageId:request.id,authorizationQuote:p.authorizationQuote as string,initialMessageId:randomUUID(),state:'pending',createdAt:new Date().toISOString()};
    await this.hooks.update(state=>{state.chatCreations??=[];if(state.chatCreations.some(op=>op.sourceSessionId===source.id&&op.operationId===operationId))throw Error('CHAT_OPERATION_RESERVED');if(state.chatCreations.length>=10000)throw Error('CHAT_OPERATION_CAPACITY');state.chatCreations.push(operation);});
    let attempted=false;
    try{
      signal?.throwIfAborted();this.unchangedSource(source,request);
      const mode=source.permissionMode==='read-only'&&target.runtime==='claude'?'plan':source.permissionMode==='plan'&&target.runtime==='codex'?'read-only':source.permissionMode??'default';
      const session=await this.hooks.create({modelTargetId:target.id,projectId,projectPath,permissionMode:mode,...(selection?{modelSelection:selection}:{})});
      await this.hooks.update(state=>{const op=state.chatCreations!.find(op=>op.sourceSessionId===source.id&&op.operationId===operationId)!;op.sessionId=session.id;const chat=state.sessions.find(s=>s.id===session.id)!;chat.agentCreated={sourceSessionId:source.id,operationId,initialMessageId:operation.initialMessageId};chat.title=String(p.title??task.trim().replace(/\s+/g,' ').slice(0,48));});
      signal?.throwIfAborted();this.unchangedSource(source,request);
      attempted=true;
      await this.hooks.submit(session,{id:operation.initialMessageId,revision:1,original:task,translated:task,sourceHash:hash(task),demo:false,bypass:true});
      await this.hooks.update(state=>{state.chatCreations!.find(op=>op.sourceSessionId===source.id&&op.operationId===operationId)!.state='started';});
    }catch{
      await this.hooks.update(state=>{const op=state.chatCreations!.find(op=>op.sourceSessionId===source.id&&op.operationId===operationId)!;op.state=attempted?'uncertain':'failed';const chat=state.sessions.find(s=>s.id===op.sessionId);if(chat&&!attempted){chat.status='blocked';chat.nativeError='新会话任务未启动；不会自动重试。';}});
    }
    return this.receipt(this.hooks.snapshot().chatCreations!.find(op=>op.sourceSessionId===source.id&&op.operationId===operationId)!,false);
  }
}
