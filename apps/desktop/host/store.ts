import {rememberRuntimeModel} from '../../../packages/model-api/runtime-target';
import {annotationDraft} from '../../../packages/context-annotations';
import {draftRecovery} from '../../../packages/session-core/draft-recovery';
import {refreshNativeEventHistory} from '../../../packages/native-events';
import {recoverFollowUps} from '../../../packages/session-core/follow-ups';
import { isPluginRuntime } from '../../../packages/runtime-extensions/types';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { API_DEFAULTS } from '../../../packages/model-api/config';
import type { AppState, Session } from '../../../packages/contracts/index';
import { resolvePermissionMode } from '../../../packages/session-core/permissions';
import { initialCollaborationState } from '../../../packages/collaboration-core/types';
import { recoverCollaborationState } from '../../../packages/collaboration-core/inbox';
import { validateNativeAgentPolicy } from '../../../packages/collaboration-core/native-policy';
import { dropToolProgressPhantoms, markObservationInterrupted } from '../../../packages/collaboration-core/activity';
import { assertIndependentTranslationKey } from '../../../packages/translation/credentials';
import { observeTurnTiming } from '../../../packages/session-core/turn-timing';
import { createSidebarOrderingService } from '../../../packages/session-core/sidebar-sessions';
import { validateTranslationUsage } from '../../../packages/translation/usage';
import { captureModelUsage } from '../../../packages/model-management/usage';
export function initialState():AppState {
  return {version:1,theme:'light',lastSelectedRuntime:'demo',projects:[],sessions:[],hosts:[],profiles:[],plugins:{translation:{enabled:true}},collaboration:initialCollaborationState(),translateIntermediate:true,translateInput:true,translateProgress:false,translateFinal:true,autoSubmitTranslated:false,
    translationQuickToggle:{show:true,paused:false},
    translation:{id:'translation-default',name:'独立翻译服务',baseUrl:'https://api.openai.com/v1',protocol:'responses',model:'',verifiedEfforts:[],consent:false,hasKey:false,source:{kind:'custom'},maxCharacters:0,maxCalls:0,timeoutMs:0}};
}
export class StateStore {
  readonly sidebarOrdering = createSidebarOrderingService();
  private state=initialState();private queue:Promise<void>=Promise.resolve();
  constructor(readonly directory:string){deepFreeze(this.state);}
  async load(){
    await mkdir(this.directory,{recursive:true,mode:0o700});
    try{const saved=JSON.parse(await readFile(path.join(this.directory,'state.json'),'utf8')) as AppState;
      if(saved.version!==1||!Array.isArray(saved.projects)||!Array.isArray(saved.sessions)||!Array.isArray(saved.hosts)||!saved.translation)throw new Error('状态文件版本或结构不受支持；原文件未覆盖。');
      this.state=saved;this.state.profiles??=[];
      delete this.state.runtimeExtensions;
      delete this.state.followUpModes;
      delete this.state.translationLayouts;
      if(!isPluginRuntime(this.state.lastSelectedRuntime)&&!['demo','claude','codex','api'].includes(this.state.lastSelectedRuntime??''))this.state.lastSelectedRuntime='demo';
      this.state.modelConnections??=[];for(const connection of this.state.modelConnections){connection.enabled??=true;Object.assign(connection,API_DEFAULTS);}
      this.state.accountCatalogs??={};
      if(!this.state.hosts.some(host=>host.id===this.state.activeWorkspaceId&&host.role==='workspace'&&host.username.toLowerCase()!=='root'))delete this.state.activeWorkspaceId;
      this.state.collaboration??=initialCollaborationState();recoverCollaborationState(this.state.collaboration);
      this.state.nativeAgentDefaults=validateNativeAgentPolicy(this.state.nativeAgentDefaults);
      this.state.autoSubmitTranslated??=false;
      // Input translation is part of the module; the obsolete per-input switch is retired.
      this.state.translateInput=true;this.state.translateFinal=true;
      this.state.translation.source??={kind:'custom'};
      if(this.state.translationUsage)validateTranslationUsage(this.state.translationUsage);
      this.state.translationQuickToggle??={show:true,paused:false};
      if(typeof this.state.translationQuickToggle.show!=='boolean'||typeof this.state.translationQuickToggle.paused!=='boolean')throw new Error('临时翻译开关格式不正确；原文件未覆盖。');
      if(this.state.translationLayout===undefined)this.state.translationLayout='panel';
      else if(typeof this.state.translationLayout!=='string'||!this.state.translationLayout.trim()||this.state.translationLayout.length>160)throw Error('TRANSLATION_LAYOUT_INVALID: 原文件未覆盖。');
      if(this.state.plugins===undefined)this.state.plugins={translation:{enabled:true}};
      else if(!this.state.plugins||typeof this.state.plugins!=='object'||Array.isArray(this.state.plugins))throw new Error('模块设置格式不正确；原文件未覆盖。');
      const translationModule=this.state.plugins.translation;
      if(translationModule===undefined)this.state.plugins.translation={enabled:true};
      else if(!translationModule||typeof translationModule.enabled!=='boolean')throw new Error('翻译模块开关格式不正确；原文件未覆盖。');
      for(const project of this.state.projects)project.paths??=project.path?[project.path]:[];
      this.sidebarOrdering.initialize(this.state);
      const placeholder=this.state.projects.find(project=>project.id==='welcome'&&project.name==='开始使用'&&project.path===''&&project.paths?.length===0&&project.group===''&&project.authority==='local');
      if(placeholder){this.state.projects=this.state.projects.filter(project=>project!==placeholder);for(const session of this.state.sessions)if(session.projectId===placeholder.id)session.projectId=null;}
      const preferences=this.state.runtimeModelPreferences;
      if(preferences&&(preferences.version!==1||!preferences.entries||typeof preferences.entries!=='object'||Array.isArray(preferences.entries)||Object.values(preferences.entries).some(value=>!value||typeof value!=='object'||value.targetId!==undefined&&typeof value.targetId!=='string'||value.hostId!==undefined&&typeof value.hostId!=='string'||value.selection!==undefined&&(!value.selection||typeof value.selection.model!=='string'||value.selection.effort!==undefined&&typeof value.selection.effort!=='string'||value.selection.serviceTier!==undefined&&typeof value.selection.serviceTier!=='string'))))throw Error('RUNTIME_MODEL_PREFERENCES_INVALID');
      if(!preferences)rememberRuntimeModel(this.state);
      for(const session of this.state.sessions){
        if(session.translationCalls!==undefined&&(!Number.isSafeInteger(session.translationCalls)||session.translationCalls<0))throw Error('TRANSLATION_CALLS_INVALID');
        if(session.apiCallBudget!==undefined&&(!Number.isSafeInteger(session.apiCallBudget)||session.apiCallBudget<0))throw Error('API_CALL_BUDGET_INVALID');
        draftRecovery.restart(session);
        if(session.annotationDraft!==undefined)annotationDraft(session.annotationDraft);
        delete session.followUpError;
        recoverFollowUps(session);
        delete session.nativeReady;session.nativeApprovals=[];
        for(const item of session.nativeInteractions??[]){if(item.status==='pending')item.status='uncertain';if(item.questionTranslation?.status==='pending'){item.questionTranslation.status='failed';item.questionTranslation.error='上次问答翻译因应用退出中断。';}}
        for(const message of session.messages)if(message.questionTranslation?.status==='pending'){message.questionTranslation.status='failed';message.questionTranslation.error='上次问答翻译已中断，可单独重试。';}
        session.nativeAgentPolicy=validateNativeAgentPolicy(session.nativeAgentPolicy);
        if(session.nativeObservation)markObservationInterrupted(session);
        dropToolProgressPhantoms(session);
        // Presentation code may be missing or disabled on restart. Keep metadata,
        // but require a fresh approved adapter invocation for custom display text.
        for(const activity of session.activities??[])if(activity.protocol){delete activity.protocol.presentation;delete activity.protocol.receipt.adapterId;}
        for(const receipt of session.nativeEventAudit?.receipts??[])delete receipt.adapterId;
        refreshNativeEventHistory(session);
        session.permissionMode=resolvePermissionMode(session.binding.runtime,session.permissionMode);
        session.projectId??=null;
        session.projectPath??=this.state.projects.find(project=>project.id===session.projectId)?.path??'';
        if(session.status==='running')session.status='uncertain';
        for(const timing of session.turnTimings??[])if(timing.status==='running')timing.status='uncertain';
        for(const message of session.messages)if(message.delivery==='pending')message.delivery='uncertain';
        for(const message of session.messages)if(message.translationStatus==='pending'){message.translationStatus='failed';message.translationError='上次翻译因应用退出中断；仅重试翻译不会重跑原生任务。';}
        for(const message of session.messages)for(const block of message.planTranslationBlocks??[])if(block.translationStatus==='pending'){block.translationStatus='failed';block.translationError='上次本段翻译已中断，可单独重试。';message.translationStatus='failed';message.translationError??=block.translationError;}
        for(const child of session.nativeChildren??[])for(const message of [...(child.messages??[]),...(child.taskTranslation?[child.taskTranslation]:[])])if(message.translationStatus==='pending'){message.translationStatus='failed';message.translationError='上次翻译已中断，可单独重试。';}
      }
    }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    deepFreeze(this.state);this.visible=this.state;
    return this.snapshot();
  }
  snapshot(){return structuredClone(this.visible);}
  /**
   * The visible state, shared by reference. Committed objects are deeply frozen
   * and never mutated: every update replaces only the objects it changes, so
   * unchanged sessions, messages and activities keep their identity across
   * revisions. A durable change becomes visible only after it is written, as
   * before; only deferred streaming partials are visible ahead of their write.
   */
  read():Readonly<AppState>{return this.visible;}
  /** Deep copy of one session; avoids cloning every conversation to inspect one. */
  sessionSnapshot(id:string):Session|undefined{const session=this.visible.sessions.find(item=>item.id===id);return session&&structuredClone(session);}
  private visible=this.state;private visibleRevision=0;
  private show(revision:number,state:AppState){if(revision>this.visibleRevision){this.visibleRevision=revision;this.visible=state;}}
  /** Generic mutation of a private deep copy. Prefer updateSession for one conversation. */
  async update(mutator:(state:AppState)=>void){
    // Boxed so the in-memory queue does not wait for the disk write it schedules.
    const operation=this.queue.then(()=>{
      const previous=this.state,next=structuredClone(previous) as AppState;mutator(next);
      this.observe(previous,next);this.share(previous,next);return {written:this.commit(next)};
    });this.queue=operation.then(()=>{},()=>{});await (await operation).written;return this.snapshot();
  }
  /**
   * Session-scoped mutation. `change` may mutate only `session`; `state` is the
   * next revision for reads. The draft copies the session shell, its arrays and
   * their newest entries; older entries stay frozen and shared. A change that
   * writes to a shared entry is replayed once on a complete copy, so callers see
   * ordinary mutable data either way. Returns false without committing when the
   * session no longer exists.
   * `persist:'deferred'` resolves after the in-memory commit and writes within
   * DEFERRED_WRITE_MS; use it only for streamed partials that a later durable
   * update supersedes (native completion events, final API saves).
   */
  async updateSession(id:string,change:(session:Session,state:Readonly<AppState>)=>void,options:{persist?:'durable'|'deferred'}={}){
    const operation=this.queue.then(()=>{
      const previous=this.state,index=previous.sessions.findIndex(item=>item.id===id);
      if(index<0)return undefined;
      const before=previous.sessions[index]!,only=new Set([id]);
      const attempt=(draft:Session)=>{const sessions=previous.sessions.slice();sessions[index]=draft;const next:AppState={...previous,sessions};change(draft,next);this.observe(previous,next,only);return next;};
      let next:AppState;
      try{next=attempt(draftSession(before));}
      catch(error){if(!frozenWrite(error))throw error;next=attempt(structuredClone(before));}
      next.sessions[index]=this.finalize(before,next.sessions[index]!);
      if(next.sidebarSessionOrder&&previous.sidebarSessionOrder&&next.sidebarSessionOrder.length===previous.sidebarSessionOrder.length&&next.sidebarSessionOrder.every((item,i)=>item===previous.sidebarSessionOrder![i]))next.sidebarSessionOrder=previous.sidebarSessionOrder;
      return {written:this.commit(next,options.persist==='deferred')};
    });this.queue=operation.then(()=>{},()=>{});const result=await operation;if(!result)return false;await result.written;return true;
  }
  /** Resolves once every committed revision is on disk; used before exit, relocation and updates. */
  async flush(){await this.queue;if(this.deferredTimer){clearTimeout(this.deferredTimer);this.deferredTimer=undefined;}if(this.written<this.committed)await this.persist();else await this.writing;}
  /** Runs inside every mutation with the draft session, so a change it makes lands in the same revision. */
  sessionTransition?:(before:Session|undefined,after:Session)=>void;
  private observe(previous:AppState,next:AppState,only?:ReadonlySet<string>){
    captureModelUsage(previous,next,only);
    const before=new Map(previous.sessions.map(session=>[session.id,session]));
    const observedAt=new Date().toISOString();
    this.sidebarOrdering.observe(previous,next,observedAt);
    for(const session of next.sessions){
      if(only&&!only.has(session.id))continue;
      this.sessionTransition?.(before.get(session.id),session);
      draftRecovery.observe(before.get(session.id),session);
      observeTurnTiming(before.get(session.id),session,observedAt);
    }
  }
  /** Restore the committed identity of everything a generic update left unchanged. */
  private share(previous:AppState,next:AppState){
    const before=new Map(previous.sessions.map(session=>[session.id,session]));
    next.sessions=next.sessions.map(session=>{const old=before.get(session.id);return old?this.finalize(old,session):isolate(session) as Session;});
    const target=next as unknown as Record<string,unknown>,source=previous as unknown as Record<string,unknown>;
    for(const key of Object.keys(target))if(key!=='sessions'&&target[key]!==source[key]&&target[key]!==null&&typeof target[key]==='object')target[key]=Object.hasOwn(source,key)&&this.same(target[key],source[key])?source[key]:isolate(target[key]);
  }
  /**
   * Committed form of a changed session: equal fields and array entries reuse
   * the previous objects; new values are copied so committed state never aliases
   * objects a caller keeps.
   */
  private finalize(old:Session,draft:Session):Session{
    const before=old as unknown as Record<string,unknown>,after=draft as unknown as Record<string,unknown>,result:Record<string,unknown>={};
    const keys=Object.keys(after);let same=keys.length===Object.keys(before).length;
    for(const key of keys){
      const value=after[key],previous=before[key];let shared:unknown;
      if(value===previous)shared=previous;
      else if(Array.isArray(value)&&Array.isArray(previous))shared=this.shareArray(previous,value);
      else if(value!==null&&typeof value==='object'&&previous!==null&&typeof previous==='object'&&this.same(value,previous))shared=previous;
      else shared=isolate(value);
      if(shared!==previous||!Object.hasOwn(before,key))same=false;
      result[key]=shared;
    }
    return same?old:result as unknown as Session;
  }
  private shareArray(previous:unknown[],next:unknown[]){
    if(next.length===previous.length&&next.every((item,index)=>item===previous[index]))return previous;
    const known=new Set(previous);
    const result=next.map((item,index)=>known.has(item)?item:item!==null&&typeof item==='object'&&index<previous.length&&this.same(item,previous[index])?previous[index]:isolate(item));
    return result.length===previous.length&&result.every((item,index)=>item===previous[index])?previous:result;
  }
  /** Encoded JSON, cached for frozen (committed) objects; equal to JSON.stringify. */
  private bytes(value:unknown):Buffer{
    if(value===null||typeof value!=='object')return Buffer.from(JSON.stringify(value)??'null');
    const frozen=Object.isFrozen(value),cached=frozen?this.encoded.get(value):undefined;if(cached)return cached;
    const bytes=Buffer.from(JSON.stringify(value));if(frozen)this.encoded.set(value,bytes);return bytes;
  }
  private same(a:unknown,b:unknown){return this.bytes(a).equals(this.bytes(b));}
  private encoded=new WeakMap<object,Buffer>();
  /** Session JSON as cached chunks: unchanged messages and activities are never re-encoded or copied. */
  private serialized(session:Session):Buffer[]{
    let chunks=this.sessionBytes.get(session);if(chunks)return chunks;
    chunks=[];let first=true;
    for(const [key,value] of Object.entries(session)){
      if(value===undefined||typeof value==='function')continue;
      const name=(first?'{':',')+JSON.stringify(key)+':';first=false;
      if(!Array.isArray(value)){chunks.push(Buffer.from(name),this.bytes(value));continue;}
      chunks.push(Buffer.from(name+'['));
      value.forEach((item,index)=>{if(index)chunks!.push(COMMA);chunks!.push(item===undefined||typeof item==='function'?NULL:this.bytes(item));});
      chunks.push(CLOSE_ARRAY);
    }
    chunks.push(first?EMPTY_OBJECT:CLOSE_OBJECT);this.sessionBytes.set(session,chunks);return chunks;
  }
  private sessionBytes=new WeakMap<Session,Buffer[]>();
  private committed=0;private written=0;private writing:Promise<void>=Promise.resolve();private writeWaiters:{revision:number;resolve():void;reject(error:unknown):void}[]=[];private deferredTimer?:ReturnType<typeof setTimeout>;
  /** Group commit: one write covers every revision committed before it starts. */
  private commit(next:AppState,deferred=false):Promise<void>{
    deepFreeze(next);
    this.state=next;const revision=++this.committed;
    if(deferred){this.show(revision,next);if(!this.deferredTimer&&!this.draining)this.deferredTimer=setTimeout(()=>{this.deferredTimer=undefined;void this.persist().catch(()=>{});},DEFERRED_WRITE_MS);return Promise.resolve();}
    const written=new Promise<void>((resolve,reject)=>this.writeWaiters.push({revision,resolve,reject}));
    void this.persist().catch(()=>{});return written;
  }
  private draining=false;
  private persist():Promise<void>{
    if(this.draining)return this.writing;
    if(this.deferredTimer){clearTimeout(this.deferredTimer);this.deferredTimer=undefined;}
    this.draining=true;
    this.writing=(async()=>{
      try{
        while(this.written<this.committed){
          const revision=this.committed,written=this.state,{sessions,...root}=written,head=JSON.stringify(root),comma=Buffer.from(',');
          const chunks:Buffer[]=[Buffer.from(`${head.slice(0,-1)}${head.length>2?',':''}"sessions":[`)];
          sessions.forEach((session,index)=>{if(index)chunks.push(comma);for(const chunk of this.serialized(session))chunks.push(chunk);});chunks.push(Buffer.from(']}'));
          const temp=path.join(this.directory,`state-${randomUUID()}.tmp`);
          try{await writeFile(temp,Buffer.concat(chunks),{mode:0o600});await replaceFile(temp,path.join(this.directory,'state.json'));}
          // Memory stays committed and the next update retries the write; every
          // waiting durable update observes the failure instead of hanging.
          catch(error){await rm(temp,{force:true}).catch(()=>{});this.settle(Infinity,error);throw error;}
          this.written=revision;this.show(revision,written);this.settle(revision);
        }
      }finally{this.draining=false;}
    })();
    return this.writing;
  }
  private settle(revision:number,error?:unknown){
    const done=this.writeWaiters.filter(waiter=>waiter.revision<=revision);this.writeWaiters=this.writeWaiters.filter(waiter=>waiter.revision>revision);
    for(const waiter of done)if(error===undefined)waiter.resolve();else waiter.reject(error);
  }
}
const COMMA=Buffer.from(','),NULL=Buffer.from('null'),CLOSE_ARRAY=Buffer.from(']'),CLOSE_OBJECT=Buffer.from('}'),EMPTY_OBJECT=Buffer.from('{}');
/** Upper bound on how long streamed text may stay in memory only. */
export const DEFERRED_WRITE_MS=750;
/** Newest entries copied into a session draft; runtime events touch these. Other arrays are copied whole. */
const DRAFT_TAIL:Record<string,number>={messages:4,activities:16,nativeChildren:4};
function draftSession(session:Session):Session{
  const draft:Record<string,unknown>={};
  for(const [key,value] of Object.entries(session)){
    if(Array.isArray(value)){const tail=DRAFT_TAIL[key];draft[key]=tail===undefined?structuredClone(value):value.map((item,index)=>index>=value.length-tail?structuredClone(item):item);}
    else draft[key]=value!==null&&typeof value==='object'?structuredClone(value):value;
  }
  return draft as unknown as Session;
}
/** A strict-mode write into frozen committed state. */
function frozenWrite(error:unknown){return error instanceof TypeError&&/read[ -]only|not extensible|Cannot (add|delete|define|redefine) property|Cannot assign to/.test(error.message);}
/** Copy everything that is not already committed (frozen) state. */
function isolate(value:unknown):unknown{
  if(value===null||typeof value!=='object'||Object.isFrozen(value))return value;
  if(Array.isArray(value))return value.map(isolate);
  const result:Record<string,unknown>={};for(const [key,item] of Object.entries(value))result[key]=isolate(item);return result;
}
/** Windows refuses to replace a file another process (indexer, antivirus, reader) holds open; retry briefly. */
async function replaceFile(from:string,to:string){for(let attempt=0;;attempt++){try{await rename(from,to);return;}catch(error){const code=(error as NodeJS.ErrnoException).code;if(attempt>=20||!['EPERM','EACCES','EBUSY'].includes(code??''))throw error;await new Promise(resolve=>setTimeout(resolve,Math.min(100,10*(attempt+1))));}}}
/** Committed state is immutable; a write to it throws in the (strict-mode) host instead of corrupting shared revisions. */
function deepFreeze(value:unknown){if(!value||typeof value!=='object'||Object.isFrozen(value))return;Object.freeze(value);for(const item of Object.values(value))deepFreeze(item);}
/** May answer asynchronously: the core process asks the UI process's OS credential store. */
export interface CryptoStore { encrypt(text:string):Buffer|Uint8Array|Promise<Buffer|Uint8Array>;decrypt(data:Buffer):string|Promise<string> }
export class SecretStore {
  private modelFile(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid model credential reference.');return path.join(this.directory,`model-${id}.bin`);}
  async setModel(scope:string,key:string){assertIndependentTranslationKey(key);const id=randomUUID();const encrypted=await this.crypto.encrypt(JSON.stringify({scope,key}));await mkdir(this.directory,{recursive:true,mode:0o700});await writeFile(this.modelFile(id),encrypted,{mode:0o600,flag:'wx'});return id;}
  async getModel(id:string|undefined,scope:string){if(!id)return '';let value;try{value=JSON.parse(await this.crypto.decrypt(await readFile(this.modelFile(id))));}catch{throw Error('模型密钥无法解密；不会退回明文。');}if(value.scope!==scope)throw Error('模型密钥与连接地址不匹配。');assertIndependentTranslationKey(value.key);return value.key as string;}
  async deleteModel(id:string|undefined){if(id)await rm(this.modelFile(id),{force:true});}
  constructor(private directory:string,private crypto:CryptoStore){}
  async set(scope:string,key:string){assertIndependentTranslationKey(key);await mkdir(this.directory,{recursive:true,mode:0o700});const encrypted=await this.crypto.encrypt(JSON.stringify({scope,key}));const file=path.join(this.directory,'translation-key.bin');const temp=file+'.tmp';await writeFile(temp,encrypted,{mode:0o600});await rename(temp,file);}
  async get(scope:string){let key:unknown;try{const stored=JSON.parse(await this.crypto.decrypt(await readFile(path.join(this.directory,'translation-key.bin'))));key=stored.scope===scope?stored.key:'';}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return '';throw new Error('系统密钥库解密失败；不会退回明文。');}if(key==='')return '';assertIndependentTranslationKey(key);return key;}
}
