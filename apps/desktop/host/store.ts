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
import type { AppState } from '../../../packages/contracts/index';
import { resolvePermissionMode } from '../../../packages/session-core/permissions';
import { initialCollaborationState } from '../../../packages/collaboration-core/types';
import { recoverCollaborationState } from '../../../packages/collaboration-core/inbox';
import { validateNativeAgentPolicy } from '../../../packages/collaboration-core/native-policy';
import { markObservationInterrupted } from '../../../packages/collaboration-core/activity';
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
  constructor(readonly directory:string){}
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
        draftRecovery.restart(session);
        if(session.annotationDraft!==undefined)annotationDraft(session.annotationDraft);
        delete session.followUpError;
        recoverFollowUps(session);
        delete session.nativeReady;session.nativeApprovals=[];
        for(const item of session.nativeInteractions??[]){if(item.status==='pending')item.status='uncertain';if(item.questionTranslation?.status==='pending'){item.questionTranslation.status='failed';item.questionTranslation.error='上次问答翻译因应用退出中断。';}}
        for(const message of session.messages)if(message.questionTranslation?.status==='pending'){message.questionTranslation.status='failed';message.questionTranslation.error='上次问答翻译已中断，可单独重试。';}
        session.nativeAgentPolicy=validateNativeAgentPolicy(session.nativeAgentPolicy);
        if(session.nativeObservation)markObservationInterrupted(session);
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
    return this.snapshot();
  }
  snapshot(){return structuredClone(this.state);}
  async update(mutator:(state:AppState)=>void){
    const operation=this.queue.then(async()=>{
      const next=this.snapshot();mutator(next);
      captureModelUsage(this.state, next);
      const previous = new Map(this.state.sessions.map(session => [session.id, session]));
      const observedAt = new Date().toISOString();
      this.sidebarOrdering.observe(this.state, next, observedAt);
      for (const session of next.sessions) {
        draftRecovery.observe(previous.get(session.id), session);
        observeTurnTiming(previous.get(session.id), session, observedAt);
      }
      const temp=path.join(this.directory,`state-${randomUUID()}.tmp`);
      await writeFile(temp,JSON.stringify(next,null,2),{mode:0o600});
      await rename(temp,path.join(this.directory,'state.json'));this.state=next;
    });this.queue=operation.catch(()=>{});await operation;return this.snapshot();
  }
}
export interface CryptoStore { encrypt(text:string):Buffer;decrypt(data:Buffer):string }
export class SecretStore {
  private modelFile(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid model credential reference.');return path.join(this.directory,`model-${id}.bin`);}
  async setModel(scope:string,key:string){assertIndependentTranslationKey(key);const id=randomUUID();const encrypted=this.crypto.encrypt(JSON.stringify({scope,key}));await mkdir(this.directory,{recursive:true,mode:0o700});await writeFile(this.modelFile(id),encrypted,{mode:0o600,flag:'wx'});return id;}
  async getModel(id:string|undefined,scope:string){if(!id)return '';let value;try{value=JSON.parse(this.crypto.decrypt(await readFile(this.modelFile(id))));}catch{throw Error('模型密钥无法解密；不会退回明文。');}if(value.scope!==scope)throw Error('模型密钥与连接地址不匹配。');assertIndependentTranslationKey(value.key);return value.key as string;}
  async deleteModel(id:string|undefined){if(id)await rm(this.modelFile(id),{force:true});}
  constructor(private directory:string,private crypto:CryptoStore){}
  async set(scope:string,key:string){assertIndependentTranslationKey(key);await mkdir(this.directory,{recursive:true,mode:0o700});const encrypted=this.crypto.encrypt(JSON.stringify({scope,key}));const file=path.join(this.directory,'translation-key.bin');const temp=file+'.tmp';await writeFile(temp,encrypted,{mode:0o600});await rename(temp,file);}
  async get(scope:string){let key:unknown;try{const stored=JSON.parse(this.crypto.decrypt(await readFile(path.join(this.directory,'translation-key.bin'))));key=stored.scope===scope?stored.key:'';}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return '';throw new Error('系统密钥库解密失败；不会退回明文。');}if(key==='')return '';assertIndependentTranslationKey(key);return key;}
}
