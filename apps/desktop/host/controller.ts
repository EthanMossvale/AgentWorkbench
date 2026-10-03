import {modelUsageRevision} from '../../../packages/model-management/usage';
import {workspaceExportTtl} from '../../../packages/workspace-control/export-policy';
import {rememberRuntimeModel, runtimeTarget} from '../../../packages/model-api/runtime-target';
import {createAnnotationService} from '../../../packages/context-annotations/service';
import {annotationsNeedInputTranslation} from '../../../packages/context-annotations';
import {RemoteConfigurationRegistry,configurationAutoUpdateEligible,type RemoteConfigurationRow} from '../../../packages/remote-account-catalog/configuration';
import { sessionPresentation } from '../../../packages/session-core/presentation';
import { nativeContextState } from '../../../packages/model-api/context-state';
import { FollowUpService } from './follow-ups';
import type { FollowUpIntent } from '../../../packages/session-core/follow-ups';
import { nativeEventSemantics } from '../../../packages/native-events/semantics';
import { nativeSessionTitles } from '../../../packages/session-core/native-titles';
import { nativeCompletionCodec } from '../../../packages/model-api/native-completion';
import { nativeRequestCodec } from '../../../packages/model-api/native-request';
import { nativeMcpSessionPolicy } from '../../../packages/model-api/native-gateway';
import { AccountNames } from './account-names';
import { resolveShortcuts, updateShortcuts } from '../../../packages/shortcuts';
import {ActivityImageReader} from './activity-images';
import { resolveAppearance, updateAppearance, type FontCatalog } from '../../../packages/appearance';
import { listInstalledFonts } from './appearance-fonts';
import {availableReasoningEfforts} from '../../../packages/model-api/reasoning-info';
import { RuntimeExtensionRegistry, isPluginRuntime } from '../../../packages/runtime-extensions';
import { PluginRuntimeHost } from './plugin-runtime';
import { composerCommands, composerScopeKey } from '../../../packages/composer-core';
import { parseApprovalReply } from '../../../packages/native-approvals';
import { NativePlanFlow } from './plan-flow';
import { parsePlanReference, pendingCodexPlan } from '../../../packages/session-core/plan-review';
import { composerSkills, resolveSkills } from '../../../packages/native-skills/invocation';
import { NativeMemoryTaskExecutor } from './memory-background';
import { defaultMemoryTarget, rememberMemoryDefault, type MemoryDefaultService } from '../../../packages/native-memory/default-target';
import path from 'node:path';
import { LocalAccountExport } from './account-export';
import { expireInteractions, isRequestId, safeInteractionUrl, type InteractionReply, type RequestId } from '../../../packages/native-interactions';
import { NativeInteractionFlow } from './interaction-flow';
import { asyncQuestionState, currentAsyncQuestion, prepareAsyncQuestion, questionContext, type AsyncQuestionReference } from '../../../packages/native-interactions/inbox';
import type { NativeResources } from './native-resources';
import {retireDeletedWorkspace,retireSshOnlyConnections} from './workspace-connections';
import { browseFile, resolveBrowsePath } from './file-browser';
import { FileNavigationService, fileResolutionContext } from './file-navigation';
import { fileReference } from '../../../packages/navigation/file-links';
import type { FileActionService } from './file-actions';
import { webReference } from '../../../packages/navigation/file-links';
import {validateModelSelection} from '../../../packages/runtime-codex/models';
import type {NativeModelOption} from '../../../packages/contracts';
import { mkdir, stat, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { sessionMetrics } from '../../../packages/session-metrics';
import {LegacyMigrationClient,migrationManifest,adoptMigration} from '../../../packages/remote-account-catalog/migration';
import { setTimeout as delay } from 'node:timers/promises';
import type { AccountCatalog, AppState, Capability, DraftPreview, Message, Project, RuntimeKind, Session, SshHost } from '../../../packages/contracts/index';
import { StateStore, SecretStore } from './store';
import { InputGate } from '../../../packages/translation/gate';
import { TranslationModule, translationEnabled } from '../../../packages/translation/module';
import { NativeTranslationRunner } from '../../../packages/translation/native';
import { recordTranslationUsage } from '../../../packages/translation/usage';
import { WorkbenchTranslationTargets } from './translation-targets';
import { translationQuickToggleVisible } from '../../../packages/translation/settings';
import { freezeSessionBinding, SessionLeaseRegistry, SubmissionLedger } from '../../../packages/session-core/index';
import {createSessionFork,forkUnavailable,forkSourceKey,nextForkTitle} from '../../../packages/session-core/fork';
import type { WorktreeService, WorktreeRecord } from '../../../packages/worktrees';
import { protocolCandidates } from '../../../packages/translation/provider';
import { hashText } from '../../../packages/translation/protection';
import { absolutePath, flag, integer, object, required, text, translationProfile } from './validation';
import { probeEnvironment,projectEnvironment } from '../../../services/environment-profile/index';
import { discoverWorkspaces } from '../../../services/host-control/index';
import {verifyWorkspaceMember} from '../../../services/host-control/verify-member';
import { validateSshHost } from '../../../packages/ssh-transport/index';
import { threadDeepLink } from '../../../packages/navigation/index';
import { SharedMemoryStore, combineSharedContextSnapshots,isFrameworkSnapshot,type SharedContextSnapshot } from '../../../packages/memory-core/index';
import { SharedSkillsStore } from '../../../packages/skills-core/index';
import { visibleReply } from '../../../packages/session-core/memory-citations';
import { resolvePermissionMode, rememberedPermission, rememberPermission, permissionScope } from '../../../packages/session-core/permissions';
import { resolveCollaborationMode } from '../../../packages/session-core/planning';
import type { CodexAuthJob } from '../../../packages/remote-codex-auth/index';
import { RemoteAccountCatalogService } from '../../../packages/remote-account-catalog/index';
import type {AccountServiceSetup} from '../../../packages/remote-account-catalog/setup';
import { selectedSharedAccount, selectedSharedAccountRef, sharedAccountRef, usableSharedAccount } from '../../../packages/account-selection/index';
import type { NativeRuntimeControl } from '../../../packages/workspace-control/native-runtime';
import { PeerInbox } from '../../../packages/collaboration-core/inbox';
import { initialCollaborationState } from '../../../packages/collaboration-core/types';
import { NativePeerContextSession } from '../../../packages/collaboration-core/native-inbox';
import { createPeerTools } from '../../../packages/collaboration-core/tools';
import { PeerMcpSession } from '../../../packages/collaboration-core/mcp';
import { validateNativeAgentPolicy } from '../../../packages/collaboration-core/native-policy';
import { attachNativeObservation } from './native-observation';
import { draftRecovery } from '../../../packages/session-core/draft-recovery';
import type { EventEmitter } from 'node:events';
import type { SshOnboardingService } from './ssh-onboarding';
import type { WorkspaceManagementActions, WorkspacePreparation } from './workspace-management';
import type { StudioOperation } from '../../../packages/workspace-control/types';
import type { NativeCodexService } from '../../../services/codex-bridge';
import type {NativeQuotaAccounting} from './quota-accounting';
import type {AccountUsage} from '../../../packages/account-usage/types';
import type {AccountUsageService} from '../../../packages/account-usage';
import { NativeCodexRunner } from './native-codex';
import { RECENT_PROJECT_ID, recentProject, projectSessionId } from '../../../packages/session-core/projects';
import { AttachmentStore } from './attachments';
import { WorkspaceGeneratedImages } from './generated-images';
import { CodexRpcClient } from '../../../packages/runtime-codex';
import { reorderProject, moveSessionProject, orderedProjects } from '../../../packages/session-core/sidebar-order';
import { ModelConnections } from './model-connections';
import { LocalModelAccounts } from './local-model-accounts';
import { localModelBinding } from '../../../packages/model-management/types';
import { ApiRunner } from './api-runner';
import { NativeProviderRunner } from './native-provider';
import { ApiLocalTools } from './api-local-tools';
import { modelTargets, sourceLabel } from '../../../packages/model-api/targets';
import { modelAgentTools, assertDelegation } from '../../../packages/model-api/agent-tools';
import { chatSessionToolDefinitions } from '../../../packages/collaboration-core/session-tools';
import { ChatSessionTools } from './chat-session-tools';
import type { ModelTarget, ModelTargetCatalog, ModelLane } from '../../../packages/model-api/types';
import { composeSharedContextInput } from '../../../packages/session-core/shared-context';
import type {NativeClaudeService} from '../../../services/claude-bridge';

export const DEMO_INPUT='请检查 `src/main.ts`，不要修改文件。最后用中文写一份说明。';
export const DEMO_TRANSLATED='Please inspect `src/main.ts`, do not modify any files. Finally, write an explanation in Chinese.';
const DEMO_FINAL='This is an offline workflow demonstration.\n\nYour reviewed prompt was submitted exactly once to the demo runtime. No repository was inspected, no files were modified, and no model or SSH connection was started.\n\nThe original response remains unchanged on the left. Its Chinese translation is a separate display layer. In a connected session, file operations must come from the native runtime and carry their actual execution evidence.';
const DEMO_FINAL_ZH='这是一次离线工作流演示。\n\n经你确认的提示词仅提交了一次到演示运行时。本次没有检查仓库、修改文件，也没有启动模型或 SSH 连接。\n\n左侧原文保持不变，中文译文是独立的展示层。真实会话里的文件操作必须来自原生运行时，并提供实际执行证据。';
const DEMO_PROGRESS='Demonstrating the reviewed-input boundary. No tools are running.';
const DEMO_PROGRESS_ZH='正在演示输入确认边界，没有工具正在运行。';
export interface HostActions { listFonts?(): Promise<FontCatalog> }
export interface HostActions { nativeClaude?:NativeClaudeService }
export interface HostActions { pickAccountExport?(fileName: string): Promise<string | null> }
export interface HostActions { sshOnboarding?: SshOnboardingService; openWeb?(url:string):Promise<void>; revealPath?(target:string):void; nativeCodex?:NativeCodexService;pickDirectory():Promise<string|null>;pickDirectories?():Promise<string[]>;pickSkill?():Promise<string|null>;getNavigation?():string|null;openSession?(sessionId:string):void;probeEnvironment?(host:SshHost):ReturnType<typeof probeEnvironment>;discoverWorkspaces?(host:SshHost):ReturnType<typeof discoverWorkspaces>;accountCatalog?:Pick<RemoteAccountCatalogService,'list'|'select'|'start'|'status'|'cancel'|'dispose'> & Partial<Pick<RemoteAccountCatalogService,'setEnabled'>>;workspaceManagement?:WorkspaceManagementActions;openExternal?(url:string):Promise<void>;translationFetcher?:typeof fetch;openPath(path:string):Promise<void>;copy(text:string):void; nativeCapabilities():Capability[] }
export interface SharedServices { memory:SharedMemoryStore;skills:SharedSkillsStore;native?:NativeResources }
export interface HostActions { remoteBrowser?:Pick<import('../../../packages/remote-account-catalog/browser').RemoteBrowserService,'profiles'|'setup'|'start'|'status'|'openViewer'|'code'|'cancel'|'busy'|'dispose'> & Partial<Pick<import('../../../packages/remote-account-catalog/browser').RemoteBrowserService,'control'>> }
export interface HostActions { remoteCli?:Pick<import('../../../packages/remote-account-catalog/cli').RemoteCliService,'list'|'plan'|'apply'> }
export interface HostActions { accountMigration?:Pick<LegacyMigrationClient,'resolve'> }
export interface HostActions { fileActions?: FileActionService }
export interface HostActions { remoteResources?:import('../../../packages/remote-account-catalog/resources').RemoteResourceService }
export interface HostActions { sessionStorage?:import('../../../packages/remote-account-catalog/session-storage').NativeSessionStorage }
export interface HostActions { remoteCliPolicies?:Pick<import('../../../packages/remote-account-catalog/cli').RemoteCliService,'configure'|'autoUpdate'> }
export interface HostActions { runtimeExtensions?:RuntimeExtensionRegistry }
export interface HostActions { worktrees?:WorktreeService }
export interface HostActions { attachments?:AttachmentStore;pickAttachments?():Promise<string[]> }
export interface HostActions { modelFetcher?:typeof fetch;modelControlPaths?:string[] }
export interface HostActions { accountSetup?:Pick<AccountServiceSetup,'plan'|'apply'>; quotaAccounting?:NativeQuotaAccounting; accountUsage?:AccountUsageService; nativeAccounts?:Pick<NativeRuntimeControl,'status'|'createClaude'|'loginCommand'> & Partial<Pick<NativeRuntimeControl,'enrollLegacy'|'remove'|'models'|'prepareClaude'|'discardClaude'|'draft'>>; verifyWorkspaceMember?:typeof verifyWorkspaceMember }
export class WorkbenchController {
  private modelConnections:ModelConnections;
  private apiRunner:ApiRunner;
  private nativeProvider?:NativeProviderRunner;
  private providerBinding(binding:Session['binding']){return localModelBinding(binding)||binding.runtime==='claude'&&!!binding.hostId;}
  private claudeRemoteCapabilities=new Set<string>();
  private supportsRemoteClaude(session:Session){
    if(!this.nativeProvider||!session.binding.hostId)return false;
    const host=this.store.snapshot().hosts.find(h=>h.id===session.binding.hostId);
    if(!host||!this.actions.nativeClaude?.supports(host,session)||!this.claudeRemoteCapabilities.has(this.modelKey(session)))return false;
    const catalog=this.store.snapshot().accountCatalogs?.[host.id];
    return catalog?.availability==='ready'&&catalog.accounts.some(a=>a.provider==='claude'&&usableSharedAccount(a)&&sharedAccountRef(catalog,a)===session.binding.accountRef)||false;
  }
  private assertRemoteClaude(session:Session){
    if(!this.supportsRemoteClaude(session))throw Error('Claude SSH 官方工具连接尚未就绪，请刷新模型目录并核对远端服务版本。');
    const models=this.modelCatalogs.get(this.modelKey(session))??[];
    const selected=session.modelSelection?.model?models.find(m=>m.model===session.modelSelection!.model):models.find(m=>m.isDefault)??models[0];
    if(!selected||session.modelSelection?.effort&&!selected.efforts.includes(session.modelSelection.effort)||session.modelSelection?.serviceTier&&!selected.serviceTiers.some(t=>t.id===session.modelSelection!.serviceTier))throw Error('远端 Claude 模型、思考或速度档位已变化，请重新选择。');
    return {id:selected.model,model:selected.model,name:selected.name,enabled:true,efforts:selected.efforts,contextWindow:selected.contextWindow};
  }
  private providerRunner(session:Session){return session.binding.runtime==='api'?this.apiRunner:this.nativeProvider!;}
  private async prepareRuntime(id:string):Promise<{ready:boolean}>{
    const session=this.session(id);
    if(this.disposing||this.modelSwitching.has(id)||this.permissionChanges.has(id)||this.forking.has(id)||session.archived||!['idle','blocked'].includes(session.status))return {ready:false};
    this.assertDraftRuntime(session);
    if(this.providerBinding(session.binding)&&session.binding.runtime!=='api')return this.nativeProvider!.prepare(id);
    if(session.binding.runtime==='codex')return this.nativeCodex!.prepare(id);
    return {ready:false};
  }
  readonly localAccounts: LocalModelAccounts;
  readonly accountNames: AccountNames;
  readonly accountExport: LocalAccountExport;
  private modelSwitching=new Set<string>();
  private agentSpawns=new Map<string,Promise<unknown>>();
  readonly annotations=createAnnotationService({snapshot:()=>this.store.snapshot(),update:change=>this.update(change),translate:async (values,sessionId)=>{
    this.translationModule.assertEnabled();const policy=this.translationModule.captureConfiguration();
    const result=await this.translationModule.segments(values,'output',`annotations:reading:${randomUUID()}`,undefined,sessionId);
    return {value:result.value,assertCurrent:()=>{this.translationModule.assertConfiguration(policy);this.translationModule.assertEnabled();}};
  }});
  private gate=new InputGate();private translationModule:TranslationModule;private translationTargets!:WorkbenchTranslationTargets;private translationNative!:NativeTranslationRunner;private requests=new Map<string,string>();
  private interactionFlow:NativeInteractionFlow;
  private planFlow:NativePlanFlow;
  private settingsQueue:Promise<void>=Promise.resolve();
  private leases=new SessionLeaseRegistry();private ledger=new SubmissionLedger(this.leases);
  private activeTranslations=new Map<string,Promise<void>>();
  private activeTurns=new Map<string,AbortController>();
  private sessionOperations=new Map<string,number>();
  private steeringPreviews=new Map<string,FollowUpIntent>();
  readonly followUps=new FollowUpService({snapshot:()=>this.store.snapshot(),update:change=>this.update(change),blocked:id=>this.disposing||this.sessionOperations.has(id)||this.permissionChanges.has(id)||this.modelSwitching.has(id)||this.forking.has(id),canSteer:session=>this.canSteer(session),dispatch:(id,preview,action,turnId,beforeDispatch)=>this.withSessionOperation<unknown>(id,()=>this.dispatchDraft(this.session(id),preview,action==='steer'?turnId:undefined,beforeDispatch))});
  private canSteer(session:Session){return ['codex','api'].includes(session.binding.runtime)||session.binding.runtime==='claude'&&this.providerBinding(session.binding)||isPluginRuntime(session.binding.runtime)&&!!this.pluginRuntimes.entry(session).catalog.capabilities.steer;}
  private async dispatchDraft(session:Session,preview:DraftPreview,steering?:string,beforeDispatch?:()=>void){
    this.assertDraftRuntime(session);
    if(preview.skills?.length)await this.resolveComposerSkills(session,preview.skills.map(({id,hash})=>({id,hash})));
    if(preview.attachments?.length)await this.actions.attachments!.payloads(preview.attachments.map(a=>a.id));
    if(!steering&&session.binding.runtime==='api')await this.apiRunner.settleCompleted(session.id);
    beforeDispatch?.();
    const result=await (isPluginRuntime(session.binding.runtime)?(steering?this.pluginRuntimes.steer(session.id,preview):this.pluginRuntimes.submit(session.id,preview)):steering?(this.providerBinding(session.binding)?this.providerRunner(session).steer(session.id,preview,steering):this.nativeCodex!.steer(session.id,preview,steering)):session.binding.runtime==='demo'?this.runDemo(session.id,preview):this.providerBinding(session.binding)?this.providerRunner(session).submit(session.id,preview):this.nativeCodex!.submit(session.id,preview));
    if(!steering&&!preview.demo&&['codex','claude'].includes(session.binding.runtime)){
      const current=this.session(session.id);
      // One bounded receiving batch, using this submission's actual binding.
      // Never resolve or dispatch the other runtime's saved default here.
      void this.shared?.native?.memory?.background.start({binding:structuredClone(current.binding),modelSelection:current.modelSelection?structuredClone(current.modelSelection):undefined,permissionMode:current.permissionMode,projectPath:current.projectPath},preview.id,{maxEntries:6}).catch(()=>{});
    }
    return result;
  }
  private questionPreviews=new Map<string,{sessionId:string;reference:AsyncQuestionReference}>();
  private permissionChanges=new Set<string>();
  readonly remoteConfigurations=new RemoteConfigurationRegistry();
  private remoteModelEpoch=0;
  private configurationMaintenance=new Set<string>();
  private configurationReceipts=new Set<Promise<void>>();
  private modelCatalogs=new Map<string,NativeModelOption[]>();
  private modelRequests=new Map<string,Promise<NativeModelOption[]>>();
  private modelAccountRefresh?:Promise<void>;
  private targetCatalog:ModelTargetCatalog={list:refresh=>this.modelTargetList(refresh)};
  private skillDiscovery=new Map<string,SharedContextSnapshot>();
  private skillDiscoveryPending=new Map<string,Promise<SharedContextSnapshot>>();
  private accountCatalog:Pick<RemoteAccountCatalogService,'list'|'select'|'start'|'status'|'cancel'|'dispose'> & Partial<Pick<RemoteAccountCatalogService,'setEnabled'>>;
  private codexAuthJobs=new Map<string,{host:SshHost;jobId:string;value:CodexAuthJob;requestEpoch:number;cancelRequested:boolean}>();
  private remoteMaintenance=new Set<string>();
  private remoteStorageMaintenance=new Set<string>();
  private maintenanceKey(host:SshHost,provider:string){return host.hostname.toLowerCase()+':'+host.port+':'+provider;}
  private hostMaintenanceActive(host:SshHost){return !!this.shared?.native?.memory?.background.busy(host.id)||['codex','claude'].some(provider=>this.remoteMaintenance.has(this.maintenanceKey(host,provider))||this.remoteStorageMaintenance.has(this.maintenanceKey(host,provider)));}
  private assertRemoteMaintenance(host:SshHost,provider:string){if(this.remoteMaintenance.has(this.maintenanceKey(host,provider)))throw Error('此远端运行时正在维护，请等待状态回读。');}
  private accountOperations=new Set<string>();
  private catalogEpochs=new Map<string,number>();
  private workspaceSelectionEpoch=0;
  private viewedImages?:ActivityImageReader;
  private observations=new Map<string,ReturnType<typeof attachNativeObservation>>();
  private nativeCodex?:NativeCodexRunner;
  private forking=new Set<string>();
  private peerInbox=new PeerInbox({
    snapshot:()=>this.store.snapshot().collaboration??initialCollaborationState(),
    update:async change=>{await this.update(state=>{state.collaboration??=initialCollaborationState();change(state.collaboration);});},
    identity:id=>this.collaborationIdentities().find(item=>item.session.id===id),
    identities:()=>this.collaborationIdentities(),
  });
  /** Trusted native bootstrap only. Never expose identity binding or receipts through IPC. */
  nativePeerContext(sessionId:string){this.session(sessionId);return new NativePeerContextSession(this.peerInbox,sessionId);}
  nativePeerTools(sessionId:string){this.session(sessionId);return createPeerTools(this.peerInbox,sessionId,{definitions:[...modelAgentTools,...chatSessionToolDefinitions],call:async(name,input,signal)=>{try{return await (chatSessionToolDefinitions.some(tool=>tool.name===name)?this.chatSessions.call(sessionId,name,object(input),signal):this.modelAgentCall(sessionId,name,object(input),signal));}catch(error){const message=(error as Error)?.message??'';if(/^[A-Z_]{3,}(: [\x20-\x7e]+)?$/.test(message))throw error;throw Error('MODEL_AGENT_REQUEST_REJECTED: Check the target, arguments, authorization and current session state.');}}});}
  nativePeerMcpSession(sessionId:string){return new PeerMcpSession(this.nativePeerTools(sessionId));}
  private chatSessions=new ChatSessionTools({
    snapshot:()=>this.store.snapshot(),update:change=>this.update(change),assertSource:id=>{if(this.disposing)throw Error('CHAT_TOOLS_DISPOSED');this.peerInbox.read(id);},
    owner:session=>session.binding.hostId?this.host(session.binding.hostId).ownerId:'local-owner',targets:()=>this.targetCatalog.list(false),
    validateSelection:(target,selection)=>{
      try{
        if(target.binding.localAccountId)return this.localAccounts.selection(target.binding.localAccountId,selection);
        if(target.binding.modelConnectionId){const connection=this.modelConnections.connection(target.binding.modelConnectionId),model=connection.models.find(m=>m.id===target.binding.modelMappingId&&m.enabled);if(!connection.enabled||!model||selection.model!==model.model||selection.serviceTier!==undefined||selection.effort!==undefined&&!availableReasoningEfforts(model).includes(selection.effort))throw Error('Unsupported model selection');return {...selection};}
        if(isPluginRuntime(target.runtime))return this.pluginRuntimes.selection(target.runtime,selection)!;
        if(target.runtime==='codex'||target.runtime==='claude')return validateModelSelection(selection,this.modelCatalogs.get(this.modelKey({binding:target.binding} as Session))??[]);
      }catch{throw Error('CHAT_MODEL_SELECTION_INVALID: The selected model or reasoning effort is unavailable; no fallback was used.');}
      throw Error('CHAT_MODEL_SELECTION_UNAVAILABLE: This target does not expose model settings.');
    },
    create:input=>this.createModelSession(input),submit:(session,preview)=>this.withSessionOperation<unknown>(session.id,()=>isPluginRuntime(session.binding.runtime)?this.pluginRuntimes.submit(session.id,preview):this.providerBinding(session.binding)?this.providerRunner(session).submit(session.id,preview):this.nativeCodex!.submit(session.id,preview)),
  });
  private collaborationIdentities(){const state=this.store.snapshot();return state.sessions.flatMap(session=>{const host=state.hosts.find(item=>item.id===session.binding.hostId);if(session.binding.runtime!=='demo'&&!localModelBinding(session.binding)&&!host)return [];return [{session,ownerId:host?.ownerId??'local-owner',authorityKey:host?hostIdentity(host):'local'}];});}
  nativeAgentPolicy(sessionId:string){return validateNativeAgentPolicy(this.session(sessionId).nativeAgentPolicy);}
  async observeNativeSession(sessionId:string,source:Pick<EventEmitter,'on'|'off'>){
    if(this.disposing)throw new Error('The workbench is closing.');
    await this.retireNativeObservation(sessionId);
    const observation=attachNativeObservation(sessionId,source,()=>this.store.snapshot(),change=>this.update(change),this.generatedImages?{service:this.generatedImages,acknowledge:source instanceof CodexRpcClient?receipt=>source.request('workbench/generatedImage/acknowledge',receipt):undefined}:undefined,this.shared?.native?.plugins?.nativeEvents);
    this.observations.set(sessionId,observation);await observation.flush();return observation;
  }
  private async retireNativeObservation(sessionId:string){
    const previous=this.observations.get(sessionId);this.observations.delete(sessionId);
    // dispose always detaches listeners before flushing. An earlier rejected
    // observation must not poison a newly authorized connection or model lane.
    await previous?.dispose().catch(()=>{});
  }
  constructor(private store:StateStore,private secrets:SecretStore,private actions:HostActions,private changed:(state:AppState)=>void,private shared?:SharedServices){this.translationModule=new TranslationModule(()=>this.store.snapshot(),scope=>this.secrets.get(scope),actions.translationFetcher??fetch,async receipt=>{await this.update(state=>{state.translationUsage=recordTranslationUsage(state.translationUsage,receipt);});},async(sessionId,limit)=>{if(sessionId==='runtime')return;await this.update(state=>{const session=state.sessions.find(item=>item.id===sessionId);if(!session)throw Error('TRANSLATION_SESSION_MISSING');const calls=session.translationCalls??0;if(limit>0&&calls>=limit)throw Error('本会话翻译调用预算已用完。');session.translationCalls=calls+1;});});this.accountCatalog=actions.accountCatalog??new RemoteAccountCatalogService();
    if(actions.attachments)this.viewedImages=new ActivityImageReader(()=>this.store.snapshot(),change=>this.update(change),actions.attachments);
    if(actions.attachments)this.generatedImages=new WorkspaceGeneratedImages(actions.attachments,actions.modelControlPaths??[],async(id,root)=>{const s=this.session(id);if(!s.projectPath||!samePath(await realpath(s.projectPath),root))return false;const managed=actions.nativeCodex&&/^[a-f0-9-]{36}$/.test(id)?actions.nativeCodex.defaultDirectory(id):undefined;return !!managed&&samePath(await realpath(managed).catch(()=>''),root)||!!s.worktree&&samePath(await realpath(s.worktree.path).catch(()=>''),root);});
    this.pluginRuntimes=new PluginRuntimeHost(actions.runtimeExtensions??shared?.native?.plugins?.runtimes??new RuntimeExtensionRegistry(),{snapshot:()=>store.snapshot(),update:fn=>this.update(fn),translate:(id,message)=>{if(this.translationModule.enabled())void this.translateMessage(id,message);}});
    this.interactionFlow=new NativeInteractionFlow(this.translationModule,{snapshot:()=>store.snapshot(),update:fn=>this.update(fn),send:(session,id,reply)=>this.sendInteraction(session,id,reply)});
    this.planFlow=new NativePlanFlow(this.translationModule,{snapshot:()=>store.snapshot(),update:fn=>this.update(fn)});
    this.modelConnections=new ModelConnections({snapshot:()=>store.snapshot(),update:fn=>this.update(fn),busy:id=>this.translationModule.busy(id)||this.translationTargets?.busy(id)||!!shared?.native?.memory?.background.busy(id)||store.snapshot().sessions.some(s=>s.binding.modelConnectionId===id&&(s.status==='running'||s.status==='uncertain'||this.gate.hasPending(s.id)||this.sessionOperations.has(s.id)||this.apiRunner?.busy(s.id)||this.nativeProvider?.busy(s.id)))},secrets,actions.modelFetcher);
    this.accountExport=new LocalAccountExport(store.directory,{account:id=>this.localAccounts.account(id),copy:content=>actions.copy(content),pickSave:actions.pickAccountExport});
    this.accountNames=new AccountNames(()=>store.snapshot(),change=>this.update(change));
    this.localAccounts=new LocalModelAccounts(store.directory,shared?.native?.cli,{snapshot:()=>store.snapshot(),update:fn=>this.update(fn),busy:id=>this.translationModule.busy(id)||this.translationTargets?.busy(id)||!!shared?.native?.memory?.background.busy(id)||store.snapshot().sessions.some(s=>s.binding.localAccountId===id&&(s.status==='running'||s.status==='uncertain'||this.gate.hasPending(s.id)||this.sessionOperations.has(s.id)||this.nativeProvider?.busy(s.id))),open:async url=>{if(!actions.openExternal)throw Error('LOCAL_ACCOUNT_BROWSER_UNAVAILABLE');await actions.openExternal(url);}});
    this.translationNative=new NativeTranslationRunner(store.directory);
    this.translationTargets=new WorkbenchTranslationTargets(()=>store.snapshot(),this.modelConnections,this.localAccounts,this.translationNative,shared?.native?.cli);
    this.translationModule.targets.register('core',this.translationTargets);
    this.apiRunner=new ApiRunner(this.modelConnections,{attachments:actions.attachments,snapshot:()=>store.snapshot(),update:fn=>this.update(fn),peers:id=>this.nativePeerTools(id),peerContext:id=>this.nativePeerContext(id),context:async id=>this.shared?composeSharedContextInput('',await this.contextSnapshot(this.session(id))).input:'',translate:(id,message)=>{if(this.translationModule.enabled()&&(message.phase!=='commentary'||store.snapshot().translateIntermediate!==false))void this.translateMessage(id,message);}},new ApiLocalTools(actions.modelControlPaths??[]),actions.modelFetcher);
    if(shared?.native)this.nativeProvider=new NativeProviderRunner(this.modelConnections,shared.native.cli,{managedDirectory:store.directory,quota:actions.quotaAccounting,attachments:actions.attachments,snapshot:()=>store.snapshot(),update:fn=>this.update(fn),peers:id=>this.nativePeerTools(id),observe:(id,source)=>this.observeNativeSession(id,source),remoteClaude:actions.nativeClaude,assertRemoteClaude:session=>this.assertRemoteClaude(session),beforeRemoteClaude:async(session,signal)=>{signal.throwIfAborted();const host=this.host(session.binding.hostId);await this.readAccountCatalog(host);signal.throwIfAborted();this.assertRemoteClaude(session);const admin=this.store.snapshot().hosts.find(h=>h.role==='admin'&&h.username==='root'&&this.maintenanceKey(h,'claude')===this.maintenanceKey(host,'claude'));await actions.sessionStorage?.restoreFor(admin,session,{signal});},context:async id=>composeSharedContextInput('',await this.contextSnapshot(this.session(id))).input,translate:(id,message)=>{if(this.translationModule.enabled()&&(message.phase!=='commentary'||store.snapshot().translateIntermediate!==false))void this.translateMessage(id,message);}},actions.modelFetcher,this.localAccounts);
    this.followUps.modes.subscribe(()=>{if(!this.disposing)this.changed(this.publicState(this.store.snapshot()));});
    this.followUps.subscribe(()=>{if(!this.disposing)this.changed(this.publicState(this.store.snapshot()));});
    if(actions.nativeCodex)this.nativeCodex=new NativeCodexRunner(actions.nativeCodex,{beforeConnect:async(session,host,signal)=>{const admin=this.store.snapshot().hosts.find(h=>h.role==='admin'&&h.username==='root'&&this.maintenanceKey(h,session.binding.runtime)===this.maintenanceKey(host,session.binding.runtime));await actions.sessionStorage?.restoreFor(admin,session,{signal});},attachments:actions.attachments,quota:actions.quotaAccounting,snapshot:()=>this.store.snapshot(),update:change=>this.update(change),context:async id=>({snapshot:await this.contextSnapshot(this.session(id))}),peers:id=>({peerContext:this.nativePeerContext(id),peerTools:this.nativePeerTools(id)}),observe:(id,handle)=>this.observeNativeSession(id,handle.connection.rpc),translate:(id,message)=>{if(this.translationModule.enabled()&&(message.phase!=='commentary'||this.store.snapshot().translateIntermediate!==false))void this.translateMessage(id,message);}});
    if(shared?.native?.memory)shared.native.memory.background.registerExecutor(new NativeMemoryTaskExecutor(this.modelConnections,shared.native.cli,actions.modelFetcher,this.localAccounts,{remote:{
      host:id=>this.host(id),codex:actions.nativeCodex,claude:actions.nativeClaude,quota:actions.quotaAccounting,
      assert:session=>{
        const host=this.host(session.binding.hostId);this.assertRemoteMaintenance(host,session.binding.runtime);
        if(this.disposing||this.configurationMaintenance.size||this.remoteStorageMaintenance.has(this.maintenanceKey(host,session.binding.runtime)))throw Error('MEMORY_BACKGROUND_UNAVAILABLE');
        if(session.binding.runtime==='claude')this.assertRemoteClaude(session);else this.nativeCodex!.assertAllowed(session);
        const catalog=this.store.snapshot().accountCatalogs?.[host.id];
        if(catalog?.availability!=='ready'||!catalog.accounts.some(a=>a.provider===session.binding.runtime&&usableSharedAccount(a)&&sharedAccountRef(catalog,a)===session.binding.accountRef))throw Error('MEMORY_BACKGROUND_BINDING_CHANGED');
      },
      claudeModel:session=>this.assertRemoteClaude(session),
      before:async(session,signal)=>{signal.throwIfAborted();await this.readAccountCatalog(this.host(session.binding.hostId));signal.throwIfAborted();},
    },usage:async entries=>{await this.update(state=>{const rows=new Map((state.modelUsage??[]).map(row=>[row.key,row]));for(const entry of entries){const previous=rows.get(entry.key);if(!previous||previous.updatedAt<=entry.updatedAt)rows.set(entry.key,entry);}state.modelUsage=[...rows.values()];});}}));
  }
  /** Explicit full-trust plugin handles; mutate state through the notifying facade. */
  developmentServices(): Record<string, object | undefined> {
    const services: Record<string, object | undefined> = {
      'workbench.controller': this,
      'sidebar.order': this.store.sidebarOrdering,
      'sessions.presentation': sessionPresentation,
      'models.context-state': nativeContextState,
      'sessions.follow-ups': this.followUps,
      'composer.annotations': this.annotations,
      'sessions.follow-up-modes': this.followUps.modes,
      'files.navigation': this.fileNavigation,
      'native.event-semantics': nativeEventSemantics,
      'sessions.native-titles': nativeSessionTitles,
      'workbench.state': { get: () => this.publicState(this.store.snapshot()), update: (change: (state: AppState) => void) => this.update(change) },
      'workbench.store': this.store, 'workbench.secrets': this.secrets, 'workbench.actions': this.actions,
      'models.account-export': this.accountExport, 'models.account-names': this.accountNames, 'models.accounts': this.localAccounts, 'models.account-access': this.localAccounts.access, 'model.connections': this.modelConnections, 'runtime.api': this.apiRunner, 'runtime.extensions': this.pluginRuntimes,
      'remote.configurations': this.remoteConfigurations,
      'models.targets': this.targetCatalog,
      'runtime.native-provider': this.nativeProvider, 'runtime.codex': this.nativeCodex,
      'runtime.native-completion': nativeCompletionCodec,
      'runtime.native-request': nativeRequestCodec,
      'runtime.mcp-sessions': nativeMcpSessionPolicy,
      'native.memory-background': this.shared?.native?.memory?.background,
      'native.memory-default': this.memoryDefaults,
      'native.memory-reference-writer': this.shared?.native?.memory?.referenceWriter,
      'translation.targets': this.translationModule.targets, 'translation.workbench-targets': this.translationTargets, 'runtime.translation-native': this.translationNative, 'translation': this.translationModule, 'interactions': this.interactionFlow,
      'collaboration': this.peerInbox, 'submission.gate': this.gate, 'composer.recovery': draftRecovery,
      'sessions.agent-tools': this.chatSessions,
      'images.generated': this.generatedImages,
      'images.viewed': this.viewedImages,
      'submission.leases': this.leases, 'submission.ledger': this.ledger,
      'accounts.catalog': this.accountCatalog,
    };
    for (const [name, value] of Object.entries(this.actions)) if (value && typeof value === 'object') services['actions.' + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase())] = value;
    return services;
  }
  readonly pluginRuntimes: PluginRuntimeHost;
  readonly fileNavigation = new FileNavigationService();
  readonly generatedImages?: WorkspaceGeneratedImages;
  private disposing=false;
  private worktreeMaintenance=false;
  private remoteMaintenanceCycle=false;
  private async settleRemoteInterruptions(host:SshHost,receipts:{sessionId:string;threadId?:string;turnId?:string}[],observed:Session[]){
    const targets=observed.filter(s=>s.binding.accountRuntime==='native-owner'&&s.status==='uncertain'&&receipts.some(r=>r.sessionId===s.id&&r.threadId===s.binding.nativeSessionId&&r.turnId===s.nativeTurnId)&&this.store.snapshot().hosts.some(h=>h.id===s.binding.hostId&&this.maintenanceKey(h,s.binding.runtime)===this.maintenanceKey(host,s.binding.runtime)));
    if(targets.length)await this.update(state=>{for(const session of state.sessions)if(targets.some(s=>s.id===session.id&&s.nativeTurnId===session.nativeTurnId&&s.binding.nativeSessionId===session.binding.nativeSessionId&&s.messages.filter(m=>m.role==='user').at(-1)?.id===session.messages.filter(m=>m.role==='user').at(-1)?.id)&&session.status==='uncertain'){session.status='idle';session.nativeTurnStatus='interrupted';session.nativeApprovals=[];expireInteractions(session);session.nativeError='远端任务已中断，所属进程已回收；未确认的输出保留，没有自动重发。';}});
  }
  private assertConfigurationIdle(host:SshHost){
    if(this.disposing)throw Error('工作台正在退出，无法开始配置维护。');
    const snapshot=this.store.snapshot(),sameHost=(h:SshHost)=>this.maintenanceKey(h,'codex')===this.maintenanceKey(host,'codex');
    if(this.hostMaintenanceActive(host))throw Error('此 VPS 仍在维护或归档，请等待回执。');
    if(snapshot.hosts.some(h=>sameHost(h)&&(this.codexLoginActive(h)||this.actions.remoteBrowser?.busy(h)||this.actions.workspaceManagement?.busy(h))))throw Error('此 VPS 仍有账号登录或操作，请先结束。');
    if(snapshot.sessions.some(s=>snapshot.hosts.some(h=>h.id===s.binding.hostId&&sameHost(h))&&(s.status==='running'||s.status==='uncertain'||this.gate.hasPending(s.id)||this.sessionOperations.has(s.id)||this.activeTurns.has(s.id)||this.forking.has(s.id)||this.modelSwitching.has(s.id))))throw Error('此 VPS 有运行中、待发送或结果未知的会话，请先处理。');
  }
  private async maintainConfiguration(host:SshHost,operation:()=>Promise<RemoteConfigurationRow|undefined>){
    if(hostIdentity(this.host(host.id))!==hostIdentity(host))throw Error('连接已变化，请重新核对远端状态。');
    this.assertConfigurationIdle(host);
    const identity=hostIdentity(host),sameHost=(h:SshHost)=>this.maintenanceKey(h,'codex')===this.maintenanceKey(host,'codex'),keys=['codex','claude'].map(provider=>this.maintenanceKey(host,provider));
    keys.forEach(key=>this.remoteMaintenance.add(key));this.configurationMaintenance.add(keys[0]!);
    let finish!:()=>void;const receipt=new Promise<void>(resolve=>finish=resolve);this.configurationReceipts.add(receipt);
    this.remoteModelEpoch++;this.modelCatalogs.clear();this.modelRequests.clear();this.claudeRemoteCapabilities.clear();
    try{
      const result=await operation();
      if(hostIdentity(this.host(host.id))!==identity)throw Error('连接已变化，请重新核对远端状态。');
      if(!result)return undefined;
      await this.update(state=>{for(const h of state.hosts.filter(sameHost))delete state.accountCatalogs?.[h.id];});
      // Catalog reads carry no model input. Selectors discover models afresh.
      if(result.running)for(const h of this.store.snapshot().hosts.filter(sameHost))try{await this.readAccountCatalog(h);}catch{/* Keep unavailable state visible; never resend a model task. */}
      return result;
    }finally{keys.forEach(key=>this.remoteMaintenance.delete(key));this.configurationMaintenance.delete(keys[0]!);this.configurationReceipts.delete(receipt);finish();}
  }
  async maintainRemote(){
    if(this.disposing||this.remoteMaintenanceCycle)return;
    this.remoteMaintenanceCycle=true;
    try{for(const host of this.store.snapshot().hosts.filter(h=>h.role==='admin'&&h.username==='root')){
      if(this.disposing)break;
      if(this.configurationMaintenance.has(this.maintenanceKey(host,'codex')))continue;
      try{const observed=this.store.snapshot().sessions,resources=await this.actions.remoteResources?.read(host);if(resources)await this.settleRemoteInterruptions(host,resources.runtime.interrupted??[],observed);}catch{/* Failed observations do not authorize cleanup or a model retry. */}
      for(const provider of ['codex','claude'] as const){
        if(this.disposing)break;
        const key=this.maintenanceKey(host,provider);
        if(this.remoteMaintenance.has(key)||this.remoteStorageMaintenance.has(key))continue;
        this.remoteStorageMaintenance.add(key);
        try{await this.actions.sessionStorage?.reclaim(host,provider);}catch{/* Failed archives keep remote originals. */}finally{this.remoteStorageMaintenance.delete(key);}
        if(this.disposing)break;
        if(this.remoteMaintenance.has(key))continue;
        const snapshot=this.store.snapshot();
        if(snapshot.hosts.some(h=>this.maintenanceKey(h,provider)===key&&this.codexLoginActive(h))||provider==='claude'&&this.actions.remoteBrowser?.busy(host)||snapshot.sessions.some(s=>snapshot.hosts.some(h=>h.id===s.binding.hostId&&this.maintenanceKey(h,provider)===key)&&s.binding.runtime===provider&&(s.status==='running'||s.status==='uncertain'||this.gate.hasPending(s.id)||this.sessionOperations.has(s.id))))continue;
        this.remoteMaintenance.add(key);
        try{
          try{await this.actions.remoteCliPolicies?.autoUpdate(host,provider);}catch{/* Remote attempt receipts rate-limit automatic updates. */}
        }finally{this.remoteMaintenance.delete(key);}
      }
      if(this.disposing)break;
      try{
        this.assertConfigurationIdle(host);
        const rows=await this.remoteConfigurations.list(host);
        for(const row of rows.filter(configurationAutoUpdateEligible))await this.maintainConfiguration(host,()=>this.remoteConfigurations.autoUpdate(host,row.id));
      }catch{/* Busy hosts defer. Persisted attempt receipts prevent target replay. */}
    }}finally{this.remoteMaintenanceCycle=false;}
  }
  private worktreeCompletion?:Promise<void>;
  private viewedSessionId:string|null=null;
  async maintainWorktrees(restoreId?:string){
    if(!this.actions.worktrees)throw Error('WORKTREES_UNAVAILABLE');
    if(this.disposing||this.worktreeMaintenance||this.hasActiveSessionWork()||this.store.snapshot().sessions.some(s=>s.status==='running'||s.status==='uncertain'||this.gate.hasPending(s.id)||this.permissionChanges.has(s.id)||this.nativeCodex?.busy(s.id)))throw Error('WORKTREE_BUSY');
    this.worktreeMaintenance=true;
    let finish!:()=>void;this.worktreeCompletion=new Promise<void>(resolve=>finish=resolve);
    try{
      if(restoreId){const record=await this.actions.worktrees.restore(restoreId);await this.update(s=>{for(const session of s.sessions)if(session.worktree?.id===record.id)session.worktree=record;});return record;}
      const protectedIds=this.store.snapshot().sessions.filter(s=>s.pinned||s.id===(this.viewedSessionId??this.actions.getNavigation?.())).map(s=>s.worktree?.id).filter((id):id is string=>!!id);
      if((await this.actions.worktrees.list()).autoDelete)for(const session of this.store.snapshot().sessions)if(session.worktree&&!protectedIds.includes(session.worktree.id))await this.nativeCodex?.close(session.id);
      const result=await this.actions.worktrees.cleanup(protectedIds,id=>this.store.snapshot().sessions.some(s=>s.worktree?.id===id&&(s.pinned||s.id===this.viewedSessionId)));
      if(result.archived.length)await this.update(s=>{for(const session of s.sessions)if(session.worktree&&result.archived.includes(session.worktree.id))session.worktree.status='archived';});
      return result;
    }finally{this.worktreeMaintenance=false;finish();}
  }
  private disposal?:Promise<void>;
  dispose(){this.disposing=true;this.followUps.dispose();this.accountExport.dispose();this.actions.sessionStorage?.dispose();this.modelConnections.dispose();this.interactionFlow.dispose();this.planFlow.dispose();const translationShutdown=this.translationModule.dispose();this.gate.invalidatePending();return this.disposal??=(async()=>{await Promise.allSettled([...this.configurationReceipts]);await this.translationNative.dispose();await translationShutdown;await Promise.allSettled([...this.activeTranslations.values()]);await this.worktreeCompletion;await this.shared?.native?.memory?.background.dispose();await this.pluginRuntimes.dispose();await this.localAccounts.dispose();await this.apiRunner.dispose();await this.nativeProvider?.dispose();this.peerInbox.dispose();await this.nativeCodex?.dispose();await this.shared?.native?.dispose();await Promise.allSettled([this.accountCatalog.dispose(),this.actions.accountUsage?.dispose(),this.actions.quotaAccounting?.dispose(),this.actions.workspaceManagement?.dispose(),this.actions.remoteBrowser?.dispose(),...[...this.observations.values()].map(item=>item.dispose())]);})();}
  private codexLoginHost(id:unknown):SshHost {const host=this.host(id);if(host.role!=='admin'&&host.username.toLowerCase()==='root')throw new Error('管理员 SSH 不能标为普通工作空间身份。');return host;}
  private async codexJob(host:SshHost,id:unknown):Promise<CodexAuthJob> {const jobId=required(id,'登录任务ID');const saved=this.codexAuthJobs.get(host.id);if(!saved||saved.jobId!==jobId||hostIdentity(saved.host)!==hostIdentity(host))throw new Error('登录任务与当前连接不一致。');const epoch=++saved.requestEpoch;const value=await this.accountCatalog.status(host,jobId);if(hostIdentity(this.host(host.id))!==hostIdentity(host)||this.codexAuthJobs.get(host.id)!==saved)throw new Error('读取期间连接身份已变更，旧登录结果已丢弃。');if(saved.requestEpoch!==epoch)return structuredClone(saved.value);if(saved.value.cleanup==='confirmed'&&!['preparing','awaiting-code','verifying'].includes(saved.value.state))return structuredClone(saved.value);if(saved.cancelRequested&&(['preparing','awaiting-code','verifying'].includes(value.state)||value.cleanup!=='confirmed'))return structuredClone(saved.value);saved.value=value;return value;}
  private codexLoginActive(host:SshHost):boolean {if(this.accountOperations.has(host.id))return true;const job=this.codexAuthJobs.get(host.id)?.value;return !!job&&(job.cleanup!=='confirmed'||['preparing','awaiting-code','verifying'].includes(job.state));}
  private async readAccountCatalog(host:SshHost):Promise<AccountCatalog> {
    const identity=hostIdentity(host),epoch=(this.catalogEpochs.get(host.id)??0)+1;this.catalogEpochs.set(host.id,epoch);
    const catalog=await this.accountCatalog.list(host);
    if(catalog.availability==='ready'&&host.authorityId&&(catalog.authorityId!==host.authorityId||catalog.generation!==host.authorityGeneration||catalog.workspaceId!==host.remoteWorkspaceId))throw new Error('共享账号服务身份与导入工作空间不一致，请重新核实连接。');
    await this.update(s=>{const current=s.hosts.find(item=>item.id===host.id);if(!current||hostIdentity(current)!==identity)throw new Error('读取期间连接身份已变更，旧账号目录已丢弃。');if(this.catalogEpochs.get(host.id)!==epoch)throw new Error('账号目录已有更新请求，请读取最新结果。');s.accountCatalogs??={};this.accountNames.apply(catalog,s);s.accountCatalogs[host.id]=catalog;});
    return catalog;
  }
  private workspacePreparations=new Map<string,Promise<WorkspacePreparation>>();
  private prepareWorkspace(host:SshHost):Promise<WorkspacePreparation> {
    const key=host.id+':'+hostIdentity(host),existing=this.workspacePreparations.get(key);if(existing)return existing;
    const pending=this.prepareWorkspaceOnce(host).finally(()=>{if(this.workspacePreparations.get(key)===pending)this.workspacePreparations.delete(key);});
    this.workspacePreparations.set(key,pending);return pending;
  }
  private async prepareWorkspaceOnce(host:SshHost):Promise<WorkspacePreparation> {
    const identity=hostIdentity(host);
    const current=()=>!this.disposing&&this.store.snapshot().hosts.some(item=>item.id===host.id&&hostIdentity(item)===identity);
    let reason:WorkspacePreparation['reason']='catalog';
    try {
      const catalog=await this.readAccountCatalog(host);
      if(!current())return {ready:false,reason:'changed'};
      if(catalog.availability!=='ready'||catalog.source!=='native-owner')return {ready:false,reason:'catalog'};
      if(!selectedSharedAccount(catalog,'claude'))return {ready:false,reason:'account'};
      // Explicit import/prepare confirmation includes the official local tool
      // dependency. Authentication and account configuration stay on the VPS.
      reason='runtime';
      const cli=this.shared?.native?.cli;if(!cli)return {ready:false,reason};
      if(!await cli.locate('claude')){
        if(!current())return {ready:false,reason:'changed'};
        await cli.install('claude',false,false,'native');
      }
      if(!current())return {ready:false,reason:'changed'};
      reason='bridge';
      const sample=this.modelTarget({hostId:host.id,runtime:'claude'});
      const models=await this.nativeModelList(sample,true);
      if(!current())return {ready:false,reason:'changed'};
      return models.length&&this.supportsRemoteClaude(sample)?{ready:true}:{ready:false,reason};
    }catch{return {ready:false,reason:current()?reason:'changed'};}
  }
  private publicState(s:AppState){for(const session of s.sessions){session.messages.push(...draftRecovery.pendingMessages(session,new Date().toISOString()));session.nativeContextUsage??=nativeContextState.recover(session);}s.followUpModes=this.followUps.modes.list();s.runtimeExtensions=this.pluginRuntimes.registry.list();s.nativeCodexBindings=[];for(const host of s.hosts){const ref=selectedSharedAccountRef(s.accountCatalogs?.[host.id]);if(ref&&this.actions.nativeCodex?.supports(host,{binding:{runtime:'codex',provider:'openai',hostId:host.id,executionId:'local-device',egress:'vps',accountRef:ref,accountRuntime:s.accountCatalogs?.[host.id]?.source}} as Session))s.nativeCodexBindings.push({hostId:host.id,accountRef:ref});}for(const session of s.sessions)session.followUpError=this.followUps.status(session.id).error;for(const session of s.sessions)session.nativeReady=isPluginRuntime(session.binding.runtime)?!!s.runtimeExtensions.find(r=>r.id===session.binding.runtime&&r.owner===session.pluginRuntime?.owner&&r.ready):this.supportsRemoteClaude(session)||!!this.nativeCodex?.supports(session);return s;}
  private async update(fn:(state:AppState)=>void){const s=this.publicState(await this.store.update(state=>{rememberMemoryDefault(state);rememberRuntimeModel(state);fn(state);rememberMemoryDefault(state);rememberRuntimeModel(state);}));this.changed(s);this.interactionFlow?.observe(s);this.planFlow?.observe(s);this.followUps.observe();return s;}
  private sendInteraction(session:Session,id:RequestId,reply:InteractionReply){this.assertDraftRuntime(session);if(isPluginRuntime(session.binding.runtime))return this.pluginRuntimes.interaction(session.id,id,reply);if(this.providerBinding(session.binding)){if(!this.nativeProvider||session.binding.runtime==='api')throw Error('此会话未连接原生交互。');return this.nativeProvider.interaction(session.id,id,reply);}return this.nativeCodex!.interaction(session.id,id,reply);}
  private assertDraftRuntime(session:Session){if(isPluginRuntime(session.binding.runtime)){this.pluginRuntimes.entry(session);return;}if(session.binding.hostId)this.assertRemoteMaintenance(this.host(session.binding.hostId),session.binding.runtime);if(this.modelSwitching.has(session.id))throw Error('模型正在切换。');if(session.binding.runtime==='demo')return;if(this.providerBinding(session.binding)){if(session.binding.runtime==='claude'&&!this.nativeProvider)throw Error('Claude SSH 工具连接尚未就绪。');if(this.nativeProvider&&session.binding.runtime==='api')throw Error('请选择 Codex 或 Claude Code，再选择此模型来源；旧会话历史保留。');this.providerRunner(session).assertAllowed(session);return;}if(!this.nativeCodex)throw new Error('H 原生桥尚未完成该连接的工具/文件视图验收，提交已阻止。');this.nativeCodex.assertAllowed(session);}
  private assertModelIdle(session:Session){if(this.pluginRuntimes.busy(session.id)||session.archived||!['idle','blocked'].includes(session.status)||this.gate.hasPending(session.id)||this.sessionOperations.has(session.id)||this.permissionChanges.has(session.id)||this.forking.has(session.id)||this.apiRunner.busy(session.id)||this.nativeProvider?.busy(session.id)||this.nativeCodex?.busy(session.id)||this.modelSwitching.has(session.id))throw Error('请等待当前任务完成并关闭发送预览，再切换模型。');}
  private async modelTargetList(refresh:boolean):Promise<ModelTarget[]>{
    if(refresh){
      await this.pluginRuntimes.registry.discover();
      if(!this.modelAccountRefresh){
        const pending=Promise.all(this.store.snapshot().hosts.filter(item=>item.role==='workspace'&&item.username.toLowerCase()!=='root').map(async host=>{
          if(this.codexLoginActive(host)||this.hostMaintenanceActive(host))throw Error('工作空间账号正在维护，请稍后刷新模型。');
          await this.readAccountCatalog(host);
        })).then(()=>{}).finally(()=>{if(this.modelAccountRefresh===pending)this.modelAccountRefresh=undefined;});
        this.modelAccountRefresh=pending;
      }
      await this.modelAccountRefresh;
    }
    const state=this.store.snapshot(),targets=modelTargets(state,s=>this.supportsRemoteClaude(s)||!!this.nativeCodex?.supports(s)),extra:ModelTarget[]=[];
    for(const runtime of this.pluginRuntimes.registry.list()){const models=runtime.models?.length?runtime.models:[undefined];for(const model of models)extra.push({id:'runtime/'+encodeURIComponent(runtime.id)+(model?'/'+encodeURIComponent(model.model):''),name:model?runtime.name+' · '+model.name:runtime.name,description:runtime.description,runtime:runtime.id,ready:runtime.ready,binding:{runtime:runtime.id,provider:'runtime-managed',accountRef:'plugin-managed',executionId:'local-device',egress:'runtime-managed'},selection:model?{model:model.model,...(model.defaultEffort?{effort:model.defaultEffort}:{})}:undefined,contextWindow:model?.contextWindow});}
    for(const target of targets.filter(item=>item.binding.hostId&&item.binding.accountRef!=='unselected'&&(item.runtime==='claude'||item.runtime==='codex'&&item.ready))){
      const sample={id:randomUUID(),binding:target.binding} as Session,key=this.modelKey(sample);let models=this.modelCatalogs.get(key);
      if(refresh||models===undefined){try{models=await this.nativeModelList(sample,refresh);}catch(error){if(target.runtime==='claude')target.unavailableReason=(error as Error).message;/* Keep the last verified catalog when a refresh fails. */}}
      if(target.runtime==='claude'&&this.actions.nativeClaude){target.ready=this.supportsRemoteClaude(sample);target.description+=' · 官方 MCP 工具';if(target.ready)delete target.unavailableReason;else target.unavailableReason??='请安装本机 Claude CLI，并核对 SSH 账号与远端官方 MCP 服务能力。';}
      for(const model of models??[])extra.push({...target,id:target.id+'/model/'+encodeURIComponent(model.model),name:model.name,selection:{model:model.model,...(model.defaultEffort?{effort:model.defaultEffort}:{})},contextWindow:model.contextWindow});
    }
    if(this.nativeProvider){
      const installed=await this.nativeProvider.runtimes();
      extra.push(...this.localAccounts.targets().map(t=>({...t,ready:t.ready&&installed.includes(t.runtime as 'codex'|'claude')})));
      return [...targets.filter(target=>!target.binding.modelConnectionId),...extra,...targets.filter(target=>target.binding.modelConnectionId).flatMap(target=>(['codex','claude'] as const).map(runtime=>({...target,id:target.id+'/'+runtime,runtime,description:target.description+' · '+(runtime==='codex'?'Codex':'Claude Code'),ready:target.ready&&installed.includes(runtime),binding:{...target.binding,runtime}})))];
    }
    return [...targets,...extra];
  }
  private memoryDefaults:MemoryDefaultService={resolve:async(context,recipient)=>defaultMemoryTarget(this.store.snapshot(),await this.targetCatalog.list(false),context,recipient)};
  private async startMemoryMaintenance(submissionId:string,context?:Pick<Session,'projectId'|'projectPath'|'permissionMode'>,retry=false,recipient?:'codex'|'claude'){
    const background=this.shared?.native?.memory?.background;
    if(!background)throw Error('MEMORY_BACKGROUND_UNAVAILABLE');
    const targets=[];
    for(const runtime of recipient?[recipient]:['codex','claude'] as const)try{
      const target=await this.memoryDefaults.resolve(context,runtime);
      if(target.binding.runtime!==runtime)throw Error('MEMORY_BACKGROUND_RECIPIENT_MISMATCH');
      targets.push(target);
    }catch(error){background.decline(error instanceof Error?error.message:'MEMORY_BACKGROUND_DEFAULT_UNAVAILABLE',runtime);}
    return targets.length?background.startReceivers(targets,submissionId,{retry}):background.decline('MEMORY_BACKGROUND_DEFAULT_UNAVAILABLE');
  }
  private async createModelSession(p:Record<string,unknown>):Promise<Session>{
    const target=(await this.targetCatalog.list(false)).find(item=>item.id===p.modelTargetId);
    if(!target||!target.ready)throw Error('所选模型已停用、移除或尚未完成执行验收。');
    if(!localModelBinding(target.binding)){
      const created=await this.call('session/create',{...p,modelTargetId:undefined,runtime:target.runtime,hostId:target.binding.hostId,accountRef:target.binding.accountRef,modelSelection:p.modelSelection??target.selection}) as Session;
      await this.update(s=>{s.sessions.find(item=>item.id===created.id)!.modelTargetId=target.id;});return this.session(created.id);
    }
    const projectId=p.projectId===undefined||p.projectId===null||p.projectId===''?null:required(p.projectId,'项目ID'),project=this.store.snapshot().projects.find(item=>item.id===projectId);
    if(projectId&&!project)throw Error('项目不存在。');
    const projectPath=p.projectPath?absolutePath(p.projectPath):project?.path??'';
    if(project&&projectPath&&!(project.paths??[project.path]).some(folder=>samePath(folder,projectPath)))throw Error('请选择项目内的工作目录。');
    if(projectPath&&!(await stat(projectPath)).isDirectory())throw Error('工作目录不存在。');
    const selection=p.modelSelection===undefined?target.selection:object(p.modelSelection);
    const connection=target.binding.modelConnectionId?this.modelConnections.connection(target.binding.modelConnectionId):undefined,model=connection?connection.models.find(item=>item.id===target.binding.modelMappingId)!:this.localAccounts.execution({binding:target.binding,modelSelection:selection} as Session).model;
    if(selection?.model!==model.model||selection?.effort!==undefined&&!availableReasoningEfforts(model).includes(String(selection.effort)))throw Error('模型选择与映射不匹配。');
    const session:Session={id:randomUUID(),projectId,projectPath,titleSource:'fallback',title:'新的模型任务',pinned:false,archived:false,group:'',status:'idle',createdAt:new Date().toISOString(),messages:[],binding:structuredClone(target.binding),modelTargetId:target.id,modelSelection:{model:model.model,...(selection?.effort?{effort:String(selection.effort)}:{}),...(target.binding.localAccountId&&selection?.serviceTier?{serviceTier:String(selection.serviceTier)}:{})},permissionMode:resolvePermissionMode(target.runtime,p.permissionMode??rememberedPermission(this.store.snapshot(),projectId,target.runtime)),...(target.runtime==='codex'?{collaborationMode:resolveCollaborationMode(target.runtime,p.collaborationMode)}:{})};
    freezeSessionBinding(session.binding);await this.update(s=>{s.sessions.unshift(session);if(!projectId&&s.recentProject)s.recentProject.hidden=false;});return session;
  }
  private async switchModelTarget(id:string,targetId:string,requestedSelection?:unknown){
    await this.nativeProvider?.settleCompleted(id,false);
    const source=this.session(id);this.assertModelIdle(source);this.modelSwitching.add(id);
    try{
      const targets=await this.targetCatalog.list(false),target=targets.find(item=>item.id===targetId);
      if(!target||!target.ready)throw Error('所选模型不可用或尚未完成原生执行验收。');
      let explicitSelection:Session['modelSelection'];
      if(requestedSelection!==undefined){
        if(target.binding.localAccountId){
          explicitSelection=this.localAccounts.selection(target.binding.localAccountId,requestedSelection);
          if(explicitSelection.model!==target.selection?.model)throw Error('LOCAL_ACCOUNT_MODEL_UNAVAILABLE');
        }else if(target.binding.modelConnectionId){
          const model=this.modelConnections.connection(target.binding.modelConnectionId).models.find(item=>item.id===target.binding.modelMappingId)!,value=object(requestedSelection);
          if(value.model!==model.model||value.serviceTier!==undefined||value.effort!==undefined&&!availableReasoningEfforts(model).includes(String(value.effort)))throw Error('模型或思考档位已变化，请重新选择。');
          explicitSelection={model:model.model,...(value.effort?{effort:String(value.effort)}:{})};
        }else if(target.binding.hostId&&(target.runtime==='codex'||target.runtime==='claude')){
          explicitSelection=validateModelSelection(requestedSelection,this.modelCatalogs.get(this.modelKey({binding:target.binding} as Session))??[]);
          if(target.selection&&explicitSelection.model!==target.selection.model)throw Error('模型选择与目标不匹配。');
        }else if(isPluginRuntime(target.runtime)){
          explicitSelection=this.pluginRuntimes.selection(target.runtime,requestedSelection);
        }
      }
      const sourceOwner=source.binding.hostId?this.host(source.binding.hostId).ownerId:'local-owner',targetOwner=target.binding.hostId?this.host(target.binding.hostId).ownerId:'local-owner';
      if(sourceOwner!==targetOwner)throw Error('模型切换不能将会话交给其他所有者。');
      const sameSshSource=!!source.binding.hostId&&!source.binding.modelConnectionId&&!target.binding.modelConnectionId&&['codex','claude'].includes(source.binding.runtime)&&(['runtime','hostId','accountRef','accountRuntime','executionId','egress'] as const).every(key=>source.binding[key]===target.binding[key]);
      if(sameSshSource&&target.selection){
        const selection=explicitSelection??validateModelSelection(target.selection,this.modelCatalogs.get(this.modelKey(source))??[]);
        await this.update(s=>{const current=s.sessions.find(item=>item.id===id)!;nativeContextState.select(current,selection,target.contextWindow);current.modelSelection=selection;current.modelTargetId=target.id;s.lastSelectedRuntime=target.runtime;s.lastModelTargetId=target.id;s.lastModelSelection=selection;s.lastModelHostId=target.binding.hostId;});
        return this.session(id);
      }
      if(source.modelTargetId===target.id){
        if(explicitSelection){await this.update(s=>{s.sessions.find(session=>session.id===id)!.modelSelection=explicitSelection;s.lastSelectedRuntime=target.runtime;s.lastModelTargetId=target.id;s.lastModelSelection=explicitSelection;s.lastModelHostId=target.binding.hostId;});return this.session(id);}
        if(target.binding.modelConnectionId){const model=this.modelConnections.connection(target.binding.modelConnectionId).models.find(model=>model.id===target.binding.modelMappingId)!;if(source.modelSelection?.model!==model.model||source.modelSelection.effort&&!availableReasoningEfforts(model).includes(source.modelSelection.effort)){await this.update(s=>{s.sessions.find(session=>session.id===id)!.modelSelection=target.selection;});return this.session(id);}}
        return source;
      }
      if(!localModelBinding(target.binding)&&!isPluginRuntime(target.runtime)){
        const catalog=await this.readAccountCatalog(this.host(target.binding.hostId));
        if(selectedSharedAccountRef(catalog,target.runtime==='claude'?'claude':'codex')!==target.binding.accountRef)throw Error('SSH 所选账号已变化，请重新读取模型列表。');
      }
      await this.nativeProvider?.close(id);await this.nativeCodex?.close(id);await this.retireNativeObservation(id);
      const oldTarget=source.modelTargetId??targets.find(t=>t.runtime===source.binding.runtime&&t.binding.hostId===source.binding.hostId&&t.binding.accountRef===source.binding.accountRef&&!t.selection)?.id??`${source.binding.runtime}:${source.id}`;
      const lane:ModelLane={permissionMode:source.permissionMode,collaborationMode:source.collaborationMode,pluginRuntime:source.pluginRuntime?structuredClone(source.pluginRuntime):undefined,targetId:oldTarget,binding:structuredClone(source.binding),modelSelection:source.modelSelection,nativeEnvironmentReceipt:source.nativeEnvironmentReceipt,nativeFork:source.branch?.native,nativeContextUsage:source.nativeContextUsage,messageCursor:source.messages.length};
      const restored=source.modelLanes?.find(item=>item.targetId===target.id);
      const nextBinding=restored?.binding??{...target.binding,...(target.runtime!=='api'?{executionSessionId:randomUUID()}:{})};
      const requestedPermission=resolvePermissionMode(target.runtime,restored?.permissionMode??(target.runtime===source.binding.runtime?source.permissionMode:this.store.snapshot().permissionPreferences?.[permissionScope(source.projectId)]?.[target.runtime]??'default'));
      let pluginSession:Session|undefined;if(isPluginRuntime(target.runtime)){pluginSession={...structuredClone(source),binding:structuredClone(nextBinding),modelSelection:restored?.modelSelection??target.selection,permissionMode:this.pluginRuntimes.mode(target.runtime,requestedPermission)};if(restored?.pluginRuntime){pluginSession.pluginRuntime=structuredClone(restored.pluginRuntime);this.pluginRuntimes.entry(pluginSession);}else await this.pluginRuntimes.initialize(pluginSession);}
      freezeSessionBinding(nextBinding);
      await this.update(s=>{
        const current=s.sessions.find(item=>item.id===id);if(!current||JSON.stringify(current.binding)!==JSON.stringify(source.binding)||current.messages.length!==source.messages.length)throw Error('切换期间会话已变化。');
        const provenance=sourceLabel(source,s);for(const message of current.messages)message.modelSource??=provenance;
        current.modelLanes=[...(current.modelLanes??[]).filter(item=>item.targetId!==oldTarget),lane];current.binding=structuredClone(nextBinding);current.modelTargetId=target.id;
        current.pluginRuntime=pluginSession?.pluginRuntime;current.modelSelection=explicitSelection??restored?.modelSelection??target.selection;current.nativeEnvironmentReceipt=restored?.nativeEnvironmentReceipt;
        if(current.branch)current.branch.native=restored?.nativeFork;
        current.handoffFromMessage=target.runtime==='api'?undefined:restored?.messageCursor??0;
        current.permissionMode=requestedPermission;
        current.collaborationMode=target.runtime==='codex'?(restored?.collaborationMode??(source.binding.runtime==='codex'?source.collaborationMode:'default')):undefined;
        for(const message of current.messages)if(message.planReview?.status==='pending')message.planReview.status='expired';
        current.nativeContextUsage=nativeContextState.handoff(source,restored?.nativeContextUsage,target.contextWindow);current.nativeEffectiveModel=undefined;current.nativeActiveSettings=undefined;current.nativeApprovals=[];expireInteractions(current);current.nativePlan=undefined;current.nativeTurnId=undefined;current.nativeTurnStatus=undefined;current.nativeError=undefined;current.status='idle';delete current.apiSummary;
        current.modelSwitches??=[];current.modelSwitches.push({at:new Date().toISOString(),afterMessage:current.messages.length,from:oldTarget,to:target.id,name:target.name});
        s.lastSelectedRuntime=target.runtime;s.lastModelTargetId=target.id;s.lastModelSelection=current.modelSelection;s.lastModelHostId=target.binding.hostId;
      });
      const changed=this.session(id);if(target.runtime==='claude'&&target.binding.hostId&&!changed.projectPath){const directory=this.actions.nativeClaude!.defaultDirectory(id);await mkdir(directory,{recursive:true});await this.update(s=>{s.sessions.find(item=>item.id===id)!.projectPath=directory;});}if(!localModelBinding(target.binding)&&target.runtime==='codex'&&!changed.projectPath){changed.projectPath=this.actions.nativeCodex!.defaultDirectory(id);await mkdir(changed.projectPath,{recursive:true});await this.update(s=>{s.sessions.find(item=>item.id===id)!.projectPath=changed.projectPath;});}
      return this.session(id);
    }finally{this.modelSwitching.delete(id);}
  }
  private async modelAgentCall(sourceId:string,name:string,p:Record<string,unknown>,signal?:AbortSignal):Promise<unknown>{
    const definition=modelAgentTools.find(item=>item.name===name);if(!definition||Object.keys(p).some(key=>!Object.hasOwn(definition.inputSchema.properties as object,key)))throw Error('INVALID_AGENT_TOOL_ARGUMENTS');
    if(name==='workbench_list_model_targets')return {targets:(await this.targetCatalog.list(true)).map(({id,name,description,ready})=>({id,name,description,ready}))};
    if(name==='workbench_read_agent'){
      const child=this.session(p.sessionId);if(child.agentParent?.sessionId!==sourceId)throw Error('CHILD_SESSION_MISMATCH');
      const wait=p.waitMs===undefined?0:integer(p.waitMs,0,60000,'Wait milliseconds'),until=Date.now()+wait;
      while(this.session(child.id).status==='running'&&Date.now()<until){signal?.throwIfAborted();await delay(Math.min(250,until-Date.now()),undefined,{signal});}
      const current=this.session(child.id);return {sessionId:child.id,status:current.status,model:current.modelTargetId,result:current.messages.filter(item=>item.role==='assistant').map(item=>item.original).join('\n').slice(-64000)};
    }
    const source=this.session(sourceId);if(source.status!=='running')throw Error('CHILD_REQUIRES_ACTIVE_USER_TASK');
    const original=source.messages.filter(item=>item.role==='user').at(-1)?.original??'';assertDelegation(original,p.authorizationQuote);
    const operationId=required(p.operationId,'Operation ID',256),task=required(p.task,'Task',100000),targetId=required(p.targetId,'Model target',2048),key=sourceId+':'+operationId;
    const existing=this.store.snapshot().sessions.find(item=>item.agentParent?.sessionId===sourceId&&item.agentParent.operationId===operationId);
    if(existing){if(existing.modelTargetId!==targetId||existing.agentParent?.taskHash!==hashText(task))throw Error('CHILD_OPERATION_CONFLICT');return {sessionId:existing.id,status:existing.status,reused:true};}
    const pending=this.agentSpawns.get(key);if(pending)return pending;
    const run=(async()=>{
      signal?.throwIfAborted();const target=(await this.targetCatalog.list(false)).find(item=>item.id===targetId);if(!target?.ready)throw Error('MODEL_TARGET_UNAVAILABLE');
      const sourceOwner=source.binding.hostId?this.host(source.binding.hostId).ownerId:'local-owner',targetOwner=target.binding.hostId?this.host(target.binding.hostId).ownerId:'local-owner';if(sourceOwner!==targetOwner)throw Error('OWNER_MISMATCH');
      const child=await this.createModelSession({modelTargetId:targetId,projectId:source.projectId,projectPath:source.projectPath,permissionMode:['read-only','plan'].includes(source.permissionMode??'default')?(target.runtime==='claude'?'plan':'read-only'):'default'});
      await this.update(s=>{const current=s.sessions.find(item=>item.id===child.id)!;current.agentParent={sessionId:sourceId,operationId,authorizationQuote:String(p.authorizationQuote),taskHash:hashText(task)};current.title=task.slice(0,28)+' · 子任务';});
      const preview:DraftPreview={id:randomUUID(),revision:1,original:task,translated:task,sourceHash:hashText(task),demo:false,bypass:true};
      try{signal?.throwIfAborted();await this.withSessionOperation<unknown>(child.id,()=>isPluginRuntime(target.runtime)?this.pluginRuntimes.submit(child.id,preview):this.providerBinding(target.binding)?this.providerRunner(child).submit(child.id,preview):this.nativeCodex!.submit(child.id,preview));}
      catch(error){await this.update(s=>{const current=s.sessions.find(item=>item.id===child.id)!;if(current.status==='idle'){current.status='blocked';current.nativeError='子任务未启动；不会自动重试。';}});throw Error('CHILD_START_FAILED: Check the child session; it will not be replayed.');}
      return {sessionId:child.id,status:this.session(child.id).status,model:target.name};
    })();this.agentSpawns.set(key,run);try{return await run;}finally{this.agentSpawns.delete(key);}
  }
  private session(id:unknown):Session{const key=required(id,'会话ID');const session=this.store.snapshot().sessions.find(s=>s.id===key);if(!session)throw new Error('会话不存在。');return session;}
  private forkBusy(source:Session,messageId?:string){
    const historical=source.status==='running'&&!!messageId&&!forkUnavailable(source,messageId);
    return !!(this.forking.has(source.id)||this.modelSwitching.has(source.id)||this.permissionChanges.has(source.id)||
      !historical&&(this.gate.hasPending(source.id)||this.sessionOperations.has(source.id)||this.nativeCodex?.busy(source.id)||this.nativeProvider?.busy(source.id)||this.apiRunner.busy(source.id)||this.pluginRuntimes.busy(source.id)));
  }
  private async sessionWorkspace(session:Session){
    if(!session.projectPath)throw new Error('此会话尚未关联本机工作区。');
    const target=absolutePath(session.projectPath);
    try {
      if(!(await stat(target)).isDirectory())throw new Error('会话工作区路径不是文件夹。');
    } catch(error) {
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      // Only initialize our own never-started workspace. Do not replace a lost
      // project directory or conceal missing files from a previously used one.
      const unstarted=!session.binding.nativeSessionId&&!session.nativeEnvironmentReceipt&&!session.messages.length;
      const service=session.binding.runtime==='claude'&&session.binding.hostId?this.actions.nativeClaude:this.actions.nativeCodex;
      const managed=service&&/^[a-f0-9-]{36}$/.test(session.id)?service.defaultDirectory(session.id):undefined;
      if(!unstarted||!managed||!samePath(target,managed))throw new Error(`会话工作区已不存在：${target}。请恢复该目录后重试。`);
      await mkdir(target,{recursive:true});
      if(!(await stat(target)).isDirectory())throw new Error('会话工作区路径不是文件夹。');
    }
    return target;
  }
  private async openSessionWorkspace(session:Session,requested?:unknown){
    if(requested!==undefined&&(!session.projectPath||!samePath(absolutePath(requested),session.projectPath)))throw new Error('此路径不是该会话绑定的工作区。');
    await this.actions.openPath(await this.sessionWorkspace(session));
    return null;
  }
  private modelKey(session:Session){return JSON.stringify([hostIdentity(this.host(session.binding.hostId)),session.binding.runtime,session.binding.accountRef,session.binding.accountRuntime]);}
  private async nativeModelList(session:Session,refresh:boolean):Promise<NativeModelOption[]>{
    const epoch=this.remoteModelEpoch,key=this.modelKey(session),host=this.host(session.binding.hostId),runtime=session.binding.runtime;
    this.assertRemoteMaintenance(host,runtime);
    const catalog=this.store.snapshot().accountCatalogs?.[host.id],account=selectedSharedAccount(catalog,'claude');
    if(runtime==='claude'){
      if(!catalog||!account||selectedSharedAccountRef(catalog,'claude')!==session.binding.accountRef)throw Error('SSH 所选账号已变化，请重新读取模型列表。');
      if(!this.actions.nativeAccounts?.models)throw Error('此版本尚未接入远端 Claude 模型目录。');
    }else if(runtime!=='codex'||!this.actions.nativeCodex?.supports(host,session)||!this.actions.nativeCodex.models)throw Error('该原生运行时尚未提供可用模型目录。');
    if(!refresh&&this.modelCatalogs.has(key))return this.modelCatalogs.get(key)!;
    let pending=this.modelRequests.get(key);
    if(!pending){
      const read=async()=>{
        let models:NativeModelOption[];
        if(runtime==='claude'){
          models=await this.actions.nativeAccounts!.models!(host,catalog!,account!.id);
          if(this.actions.nativeClaude&&this.nativeProvider){
            try{
              const status=await this.actions.nativeAccounts!.status(host,catalog!,account!.id);
              const installed=await this.nativeProvider.runtimes();
              if(status.authenticated&&status.installed&&status.execution==='local-mcp-required'&&!status.block&&installed.includes('claude'))this.claudeRemoteCapabilities.add(key);else this.claudeRemoteCapabilities.delete(key);
            }catch{/* Model discovery remains usable while local execution status is rechecked. */}
          }
          if(selectedSharedAccountRef(this.store.snapshot().accountCatalogs?.[host.id],'claude')!==session.binding.accountRef)throw Error('读取期间远端账号已变化。');
        }else{
          if(runtime!=='codex'||!this.actions.nativeCodex?.supports(host,session)||!this.actions.nativeCodex.models)throw Error('该原生运行时尚未提供可用模型目录。');
          models=await this.actions.nativeCodex.models(host,session);
        }
        if(this.disposing||epoch!==this.remoteModelEpoch||this.modelKey(session)!==key){this.claudeRemoteCapabilities.delete(key);throw Error('读取期间连接身份已变化。');}
        this.modelCatalogs.set(key,models);return models;
      };
      pending=read().finally(()=>{if(this.modelRequests.get(key)===pending)this.modelRequests.delete(key);});this.modelRequests.set(key,pending);
    }
    try{return await pending;}catch(error){
      const cached=this.modelCatalogs.get(key);
      if(cached!==undefined&&!this.disposing&&epoch===this.remoteModelEpoch&&this.modelKey(session)===key&&(runtime!=='claude'||selectedSharedAccountRef(this.store.snapshot().accountCatalogs?.[host.id],'claude')===session.binding.accountRef))return cached;
      throw error;
    }
  }
  private modelTarget(p:Record<string,unknown>):Session{
    if(p.sessionId!==undefined)return this.session(p.sessionId);
    const host=this.host(p.hostId??this.store.snapshot().activeWorkspaceId);
    const runtime=p.runtime==='claude'?'claude':'codex',accountRef=selectedSharedAccountRef(this.store.snapshot().accountCatalogs?.[host.id],runtime);
    if(!accountRef)throw Error('请先选择已核实的 '+(runtime==='claude'?'Claude':'Codex')+' 账号。');
    return {id:randomUUID(),binding:{runtime,provider:runtime==='claude'?'anthropic':'openai',hostId:host.id,accountRef,executionId:'local-device',egress:'vps',accountRuntime:this.store.snapshot().accountCatalogs?.[host.id]?.source}} as Session;
  }
  async call(method:string,payload:unknown={}):Promise<unknown>{
    if(this.disposing)throw new Error('工作台正在退出，无法接受新操作。');
    const p=object(payload??{});
    if(method==='extensions/asset'){if(!this.shared?.native)throw Error('PLUGIN_HOST_UNAVAILABLE');return this.shared.native.plugins.asset(required(p.id,'Plugin ID'),required(p.hash,'Plugin hash'),required(p.path,'Asset path'));}
    if(['models/accounts/export-formats','models/accounts/export-preview','models/accounts/export-copy','models/accounts/export-save'].includes(method))return this.accountExport.call(method,p);
    if(['models/accounts/list','models/accounts/prepare','models/accounts/draft-discard','models/accounts/rename','models/accounts/create','models/accounts/set-enabled','models/accounts/remove','models/accounts/refresh','models/accounts/login-methods','models/accounts/login-start','models/accounts/login-status','models/accounts/login-cancel','models/accounts/login-open','models/accounts/login-code','models/accounts/login-callback','models/accounts/import-formats','models/accounts/import','models/accounts/reset-preview','models/accounts/reset-redeem','models/accounts/reset-status','models/usage','models/pricing/save'].includes(method))return this.localAccounts.call(method,p);
    if(method.startsWith('model-api/'))return this.modelConnections.call(method,p);
    if(p.id!==undefined&&typeof p.id==='string'&&['remote-cli/','accounts/','native-accounts/','codex-auth/','browser/','remote-browser/','remote-storage/'].some(prefix=>method.startsWith(prefix))){
      const h=this.store.snapshot().hosts.find(item=>item.id===p.id);
      if(h&&this.configurationMaintenance.has(this.maintenanceKey(h,'codex')))throw Error('工作台远端配置正在维护，请等待回执。');
    }
    if(method==='model-targets/list')return this.targetCatalog.list(p.refresh===true);
    if(method==='runtime/choice'){
      const state=this.store.snapshot(),runtime=required(p.runtime,'Runtime') as RuntimeKind;
      const session=p.sessionId?this.session(p.sessionId):{binding:{hostId:p.hostId}} as Session;
      const targets=await this.targetCatalog.list(false),preferred=state.runtimeModelPreferences?.version===1?state.runtimeModelPreferences.entries[runtime]:undefined;
      const owner=session.binding.hostId?this.host(session.binding.hostId).ownerId:'local-owner';
      const available=targets.filter(t=>(t.binding.hostId?this.host(t.binding.hostId).ownerId:'local-owner')===owner);
      const target=runtimeTarget(available,runtime,session,preferred);
      if(!target)throw Error('RUNTIME_MODEL_UNAVAILABLE: No available model for the destination runtime.');
      const lane=session.modelLanes?.find(l=>l.targetId===target.id);
      const selection=lane?.modelSelection??(preferred?.targetId===target.id?preferred.selection:undefined)??target.selection;
      return {target,selection};
    }
    if(method==='native-memory/process'){if(Object.keys(p).some(k=>k!=='runtime')||p.runtime!==undefined&&p.runtime!=='codex'&&p.runtime!=='claude')throw Error('MEMORY_CONSOLIDATION_ARGUMENT_INVALID');return this.startMemoryMaintenance(randomUUID(),undefined,true,p.runtime as 'codex'|'claude'|undefined);}
    if(method==='session/model-target')return this.switchModelTarget(required(p.sessionId,'会话ID'),required(p.targetId,'模型标识'),p.selection);
    if(this.shared?.native?.handles(method))return this.shared.native.call(method,p);
    if(this.shared?.native&&['memory/settings','memory/save','memory/delete','skills/import','skills/delete'].includes(method))throw Error('旧共享库写入已停用，请使用原生记忆和技能设置。');
    if(method.startsWith('studio/'))return this.callStudio(method,p);
    switch(method){
      case 'state/get':{const state=this.publicState(this.store.snapshot());state.profiles=state.profiles.map(profile=>projectEnvironment(profile,{hostId:profile.hostId,ownerId:profile.ownerId}));return state;}
      case 'session/metrics':return sessionMetrics(this.session(required(p.sessionId,'会话ID')));
      case 'session/catalog':return this.peerInbox.list(required(p.sourceSessionId,'来源会话ID'),object(p.options??{}));
      case 'session/public-history':return this.peerInbox.readSession(required(p.sourceSessionId,'来源会话ID'),object(p.options??{}));
      case 'demo.sample/get':return {input:DEMO_INPUT,translated:DEMO_TRANSLATED};
      case 'shortcuts/get': return resolveShortcuts(this.store.snapshot().shortcuts);
      case 'shortcuts/set': {
        if(p.reset!==undefined&&typeof p.reset!=='boolean')throw Error('SHORTCUT_INVALID_PATCH');
        const next=await this.update(s=>{s.shortcuts=updateShortcuts(s.shortcuts,p.revision,p.id,p.bindings,p.reset===true,process.platform==='darwin');});
        return resolveShortcuts(next.shortcuts);
      }
      case 'appearance/get': return resolveAppearance(this.store.snapshot().appearance);
      case 'appearance/fonts': return (this.actions.listFonts ?? listInstalledFonts)();
      case 'appearance/set': {
        if (p.reset !== undefined && typeof p.reset !== 'boolean') throw Error('APPEARANCE_INVALID_PATCH');
        const next=await this.update(s=>{s.appearance=updateAppearance(s.appearance,p.revision,p.patch??{},p.reset===true);});
        return resolveAppearance(next.appearance);
      }
      case 'theme/set':{const theme=p.theme;if(theme!=='light'&&theme!=='dark'&&theme!=='system')throw new Error('无效主题。');return this.update(s=>{s.theme=theme;});}
      case 'runtime/catalog':{const entries=await this.pluginRuntimes.registry.discover();this.changed(this.publicState(this.store.snapshot()));return entries;}
      case 'runtime/select':{
        if(isPluginRuntime(p.runtime)){await this.pluginRuntimes.registry.discover(p.runtime);const entry=this.pluginRuntimes.registry.get(p.runtime);if(!entry.catalog.ready)throw Error('RUNTIME_UNAVAILABLE');const target=p.targetId?(await this.targetCatalog.list(false)).find(t=>t.id===p.targetId&&t.runtime===p.runtime&&t.ready):undefined;if(p.targetId&&!target)throw Error('RUNTIME_MODEL_UNSUPPORTED');const selection=this.pluginRuntimes.selection(p.runtime,p.selection??target?.selection);return this.update(s=>{s.lastSelectedRuntime=p.runtime as RuntimeKind;s.lastModelSelection=selection;s.lastModelTargetId=target?.id;s.lastModelHostId=undefined;});}
        const runtime=p.runtime;if(runtime!=='demo'&&runtime!=='claude'&&runtime!=='codex'&&runtime!=='api')throw new Error('不支持的运行时。');
        const target=p.targetId?(await this.targetCatalog.list(false)).find(t=>t.id===p.targetId):undefined;
        if(p.targetId&&(!target?.ready||target.runtime!==runtime)||runtime==='api'&&target?.runtime!=='api')throw Error('请选择当前运行时可用的模型。');
        let selection:Session['modelSelection'];
        if(p.selection!==undefined){
          if(target?.binding.localAccountId){selection=this.localAccounts.selection(target.binding.localAccountId,p.selection);}
          else if(target?.binding.modelConnectionId){const connection=this.modelConnections.connection(target.binding.modelConnectionId),model=connection.models.find(model=>model.id===target.binding.modelMappingId)!,value=object(p.selection);if(value.model!==model.model||value.serviceTier!==undefined||value.effort!==undefined&&!availableReasoningEfforts(model).includes(String(value.effort)))throw Error('模型或思考档位已变化，请重新选择。');selection={model:model.model,...(value.effort?{effort:String(value.effort)}:{})};}
          else {if(!['codex','claude'].includes(runtime))throw Error('该运行时尚未提供模型目录。');const session=this.modelTarget({runtime,hostId:target?.binding.hostId??p.hostId});selection=validateModelSelection(p.selection,this.modelCatalogs.get(this.modelKey(session))??[]);}
        }else selection=target?.selection;
        return this.update(s=>{s.lastSelectedRuntime=runtime;s.lastModelTargetId=target?.id;s.lastModelSelection=selection;s.lastModelHostId=target?.binding.hostId??(p.hostId?this.host(p.hostId).id:undefined);});
      }
      case 'attachments/import':{if(!this.actions.attachments)throw Error('附件存储不可用。');return this.actions.attachments.import(p.files as import('../../../packages/attachments/types').AttachmentInput[]);}
      case 'attachments/pick':{if(!this.actions.attachments||!this.actions.pickAttachments)throw Error('附件选择不可用。');const paths=await this.actions.pickAttachments();return paths.length?this.actions.attachments.import(paths.map(filePath=>({filePath}))):[];}
      case 'attachments/image':{if(!this.actions.attachments)throw Error('附件存储不可用。');const item=(await this.actions.attachments.payloads([p.id]))[0]!;if(!item.attachment.mime.startsWith('image/'))throw Error('此附件不是图片。');return `data:${item.attachment.mime};base64,${Buffer.from(item.data).toString('base64')}`;}
      case 'attachments/views':{if(!this.actions.attachments)throw Error('附件存储不可用。');return this.actions.attachments.views(p.ids);}
      case 'attachments/activity-images':{if(!this.viewedImages)throw Error('ATTACHMENT_STORE_UNAVAILABLE');return this.viewedImages.read({sessionId:required(p.sessionId,'Session ID',256),activityId:required(p.activityId,'Activity ID',1024)});}
      case 'attachments/copy-image':{if(!this.actions.attachments)throw Error('ATTACHMENT_STORE_UNAVAILABLE');return this.actions.attachments.copyImage(required(p.id,'Attachment ID',36));}
      case 'attachments/open':{if(!this.actions.attachments)throw Error('ATTACHMENT_STORE_UNAVAILABLE');const item=(await this.actions.attachments.payloads([required(p.id,'Attachment ID',36)]))[0]!;await this.actions.openPath(item.attachment.path);return {opened:true};}
      case 'attachments/save-as':{if(!this.actions.attachments)throw Error('ATTACHMENT_STORE_UNAVAILABLE');return this.actions.attachments.saveAs(required(p.id,'Attachment ID',36),p.png);}
      case 'attachments/storage':{if(!this.actions.attachments)throw Error('ATTACHMENT_STORE_UNAVAILABLE');return this.actions.attachments.locations();}
      case 'attachments/reveal':{if(!this.actions.attachments||!this.actions.revealPath)throw Error('ATTACHMENT_REVEAL_UNAVAILABLE');const item=(await this.actions.attachments.payloads([p.id]))[0]!;await this.actions.revealPath(item.attachment.path);return {revealed:true};}
      case 'attachments/open-storage':{if(!this.actions.attachments)throw Error('ATTACHMENT_STORE_UNAVAILABLE');const locations=this.actions.attachments.locations();if(p.kind!=='managed'&&p.kind!=='clipboard')throw Error('ATTACHMENT_STORAGE_INVALID');await mkdir(locations[p.kind],{recursive:true});await this.actions.openPath(locations[p.kind]);return {opened:true};}
      case 'attachments/cleanup':{if(!this.actions.attachments)throw Error('ATTACHMENT_STORE_UNAVAILABLE');const ids=this.store.snapshot().sessions.flatMap(s=>[...(s.forkAttachments??[]),...s.messages.flatMap(m=>m.attachments??[]),...(s.draftRecoveries??[]).flatMap(r=>r.preview.attachments??[]),...(s.followUps??[]).flatMap(r=>r.preview.attachments??[]),...(s.activities??[]).flatMap(a=>[...(a.imageDelivery?.attachment?[a.imageDelivery.attachment]:[]),...(a.viewedAttachments??[])])]).map(a=>a.id);return this.actions.attachments.cleanup([...new Set(ids)]);}
      case 'sidebar/collapse-all':{const collapsed=flag(p.collapsed,'折叠项目');return this.update(s=>{s.sidebarCollapsedProjectIds=collapsed?orderedProjects(s).map(p=>p.id):[];});}
      case 'sidebar/project-visibility':{const id=required(p.id,'项目ID');return this.update(s=>{if(id!==RECENT_PROJECT_ID&&!s.projects.some(v=>v.id===id))throw Error('项目不存在。');for(const [input,key] of [['collapsed','sidebarCollapsedProjectIds'],['expanded','sidebarExpandedProjectIds']] as const){if(p[input]===undefined)continue;const enabled=flag(p[input],'展开状态');const ids=new Set(s[key]??[]);if(enabled)ids.add(id);else ids.delete(id);s[key]=[...ids];}});}
      case 'project/reorder':{const id=required(p.id,'项目ID'),targetId=required(p.targetId,'目标项目ID');if(p.edge!=='before'&&p.edge!=='after')throw Error('排序位置无效。');return this.update(s=>reorderProject(s,id,targetId,p.edge as 'before'|'after'));}
      case 'session/move-project':{const id=required(p.id,'会话ID'),projectId=required(p.projectId,'项目ID');return this.update(s=>moveSessionProject(s,id,projectId));}
      case 'session/reorder':{
        const id=required(p.id,'Session ID'),targetId=required(p.targetId,'Target session ID'),scope=required(p.scope,'Sidebar scope',200);
        if(p.edge!=='before'&&p.edge!=='after')throw Error('SIDEBAR_REORDER_EDGE_INVALID');
        return this.update(s=>this.store.sidebarOrdering.reorder(s,{id,targetId,scope,edge:p.edge as 'before'|'after'},new Date().toISOString()));
      }
      case 'project/pick':return this.actions.pickDirectory();
      case 'project/pick-many':return this.actions.pickDirectories?this.actions.pickDirectories():[await this.actions.pickDirectory()].filter(Boolean);
      case 'project/create':{
        const paths=await projectPaths(p.paths??[p.path]);
        const project:Project={id:randomUUID(),name:required(p.name,'项目名称',100),path:paths[0]!,paths,authority:'local',group:p.group===undefined?'':text(p.group,'分组',100)};
        await this.update(s=>{s.projects.push(project);});return project;
      }
      case 'project/update':{
        if(p.id===RECENT_PROJECT_ID){
          const old=recentProject(this.store.snapshot());
          const paths=p.paths===undefined?old.paths!:await projectPaths(p.paths,true);
          const name=p.name===undefined?old.name:required(p.name,'项目名称',100);
          const pinned=p.pinned===undefined?!!old.pinned:flag(p.pinned,'项目置顶');
          const hidden=p.hidden===undefined?this.store.snapshot().recentProject?.hidden:flag(p.hidden,'项目显示');
          return this.update(s=>{s.recentProject={name,paths,pinned,hidden};});
        }
        const id=required(p.id,'项目ID');const old=this.store.snapshot().projects.find(x=>x.id===id);if(!old)throw new Error('项目不存在。');
        const paths=p.paths===undefined?old.paths??(old.path?[old.path]:[]):await projectPaths(p.paths);
        const name=p.name===undefined?old.name:required(p.name,'项目名称',100);const group=p.group===undefined?old.group:text(p.group,'分组',100);
        const pinned=p.pinned===undefined?undefined:flag(p.pinned,'项目置顶');
        return this.update(s=>{const target=s.projects.find(x=>x.id===id);if(!target)throw new Error('项目不存在。');Object.assign(target,{name,paths,path:paths[0]??'',group,...(pinned===undefined?{}:{pinned})});});
      }
      case 'project/archive-sessions':{
        const id=required(p.id,'项目ID');if(p.confirm!==true)throw new Error('请确认归档该项目中的会话。');
        return this.update(s=>{if(id!==RECENT_PROJECT_ID&&!s.projects.some(project=>project.id===id))throw new Error('项目不存在。');const sessions=s.sessions.filter(session=>session.projectId===projectSessionId(id)&&!session.archived);for(const session of sessions)this.assertSidebarMutationBoundary(session);for(const session of sessions)session.archived=true;});
      }
      case 'project/remove':{
        const id=required(p.id,'项目ID');if(p.confirm!==true)throw new Error('请确认移除本机项目记录。');
        if(id===RECENT_PROJECT_ID)return this.update(s=>{const project=recentProject(s);s.recentProject={name:project.name,paths:project.paths!,pinned:!!project.pinned,hidden:true};});
        return this.update(s=>{const project=s.projects.find(item=>item.id===id);if(!project)throw new Error('项目不存在。');for(const session of s.sessions)if(session.projectId===id){session.projectPath??=project.path;session.projectId=null;}s.projects=s.projects.filter(item=>item.id!==id);});
      }
      case 'session/create':{
        if(p.modelTargetId!==undefined)return this.createModelSession(p);
        const projectId=p.projectId===undefined||p.projectId===null||p.projectId===''?null:required(p.projectId,'项目ID');const project=projectId===null?undefined:this.store.snapshot().projects.find(x=>x.id===projectId);if(projectId!==null&&!project)throw new Error('项目不存在。');
        const projectPath=p.projectPath===undefined||p.projectPath===''?project?.path??'':absolutePath(p.projectPath);
        const folders=project?.paths??(project?.path?[project.path]:[]);if(project&&projectPath&&!folders.some(folder=>samePath(folder,projectPath)))throw new Error('请从项目关联的目录选择工作目录；这是会话位置，不是跨目录文件权限围栏。');
        if(!project&&projectPath&&!(await stat(projectPath)).isDirectory())throw new Error('临时工作路径不是目录。');
        const runtime=p.runtime as RuntimeKind;
        if(isPluginRuntime(runtime)){const session:Session={id:randomUUID(),projectId,projectPath,titleSource:'fallback',title:'新的任务',pinned:false,archived:false,group:'',status:'idle',createdAt:new Date().toISOString(),messages:[],binding:{runtime,provider:'runtime-managed',accountRef:'plugin-managed',executionId:'local-device',egress:'runtime-managed'},permissionMode:resolvePermissionMode(runtime,p.permissionMode??rememberedPermission(this.store.snapshot(),projectId,runtime)),modelSelection:p.modelSelection as Session['modelSelection']};await this.pluginRuntimes.initialize(session);freezeSessionBinding(session.binding);await this.update(s=>{s.sessions.unshift(session);if(!projectId&&s.recentProject)s.recentProject.hidden=false;});return session;}
        if(!['demo','claude','codex'].includes(runtime))throw new Error('不支持的运行时。');
        if(runtime==='api')throw Error('请选择具体的 API 模型。');
        if(runtime!=='demo'&&this.shared?.native&&!await this.shared.native.cli.locate(runtime))throw new Error('LOCAL_RUNTIME_NOT_INSTALLED');
        const permissionMode=resolvePermissionMode(runtime,p.permissionMode??rememberedPermission(this.store.snapshot(),projectId,runtime));
        const hostId=runtime==='demo'?undefined:p.hostId===undefined?this.store.snapshot().activeWorkspaceId:required(p.hostId,'连接ID');
        if(runtime!=='demo'&&(!hostId||!this.store.snapshot().hosts.some(h=>h.id===hostId&&h.role==='workspace'&&h.username.toLowerCase()!=='root')))throw new Error('原生会话需选择独立工作空间 SSH；管理员连接只用于管理面。');
        const boundHost=runtime!=='demo'&&hostId?this.host(hostId):undefined;
        if(runtime==='codex'&&boundHost&&this.codexLoginActive(boundHost))throw new Error('账号操作尚未结束，请稍后创建原生会话。');
        let accountRef=runtime==='demo'?'none':'native-vps-profile-unverified';
        const cachedRef=runtime!=='demo'&&hostId?selectedSharedAccountRef(this.store.snapshot().accountCatalogs?.[hostId],runtime):undefined;
        if(runtime!=='demo'&&boundHost&&cachedRef){
          const currentRef=selectedSharedAccountRef(await this.readAccountCatalog(boundHost),runtime);
          const expected=p.accountRef===undefined?cachedRef:required(p.accountRef,'账号引用',2048);
          if(!currentRef||currentRef!==expected)throw new Error('该工作空间的所选账号已变更或不可用，请核对后重新创建会话。');
          accountRef=currentRef;
        }else if(p.accountRef!==undefined&&p.accountRef!=='')throw new Error('账号引用未经该工作空间的共享目录核实。');
        const session:Session={id:randomUUID(),projectId,titleSource:'fallback',title:runtime==='demo'?'新的双语任务':`${runtime==='claude'?'Claude':'Codex'} · 待验证连接`,pinned:false,archived:false,group:'',status:runtime==='demo'?'idle':'blocked',messages:[],createdAt:new Date().toISOString(),binding:{runtime,provider:runtime==='demo'?'offline':runtime==='claude'?'anthropic':'openai',accountRef,executionId:'local-device',egress:runtime==='demo'?'demo':'vps',hostId}};
        if(hostId&&this.store.snapshot().accountCatalogs?.[hostId]?.source==='native-owner'&&accountRef.startsWith('vps-account:'))session.binding.accountRuntime='native-owner';
        session.projectPath=projectPath;session.permissionMode=permissionMode;if(runtime==='codex')session.collaborationMode=resolveCollaborationMode(runtime,p.collaborationMode);session.nativeAgentPolicy=validateNativeAgentPolicy(this.store.snapshot().nativeAgentDefaults);freezeSessionBinding(session.binding);
        if(p.modelSelection!==undefined){if(!['codex','claude'].includes(runtime))throw Error('该运行时尚未提供模型目录。');session.modelSelection=validateModelSelection(p.modelSelection,this.modelCatalogs.get(this.modelKey(session))??[]);}
        if(this.supportsRemoteClaude(session)){session.status='idle';session.nativeReady=true;session.title='新的 Claude 任务';session.projectPath||=this.actions.nativeClaude!.defaultDirectory(session.id);await mkdir(session.projectPath,{recursive:true});}
        if(this.nativeCodex?.supports(session)){session.status='idle';session.nativeReady=true;session.title='新的 Codex 任务';session.projectPath||=this.actions.nativeCodex!.defaultDirectory(session.id);await this.sessionWorkspace(session);}
        await this.update(s=>{if(boundHost){const current=s.hosts.find(host=>host.id===boundHost.id);if(!current||hostIdentity(current)!==hostIdentity(boundHost))throw new Error('创建期间连接身份已变更。');if(accountRef.startsWith('vps-account:')&&selectedSharedAccountRef(s.accountCatalogs?.[boundHost.id],runtime==='claude'?'claude':'codex')!==accountRef)throw new Error('创建期间所选账号已变更，请重新核对。');}if(projectId===null&&s.recentProject)s.recentProject.hidden=false;s.sessions.unshift(session);});return session;
      }
      case 'worktrees/list':return this.actions.worktrees?.list()??{root:'',defaultRoot:'',records:[]};
      case 'worktrees/configure':{
        if(!this.actions.worktrees)throw Error('WORKTREES_UNAVAILABLE');
        const result=await this.actions.worktrees.configure(p.root===undefined||p.root===''?undefined:absolutePath(p.root),{autoDelete:p.autoDelete as boolean|undefined,limit:p.limit as number|undefined});return result;
      }
      case 'worktrees/cleanup':return this.maintainWorktrees();
      case 'worktrees/restore':return this.maintainWorktrees(required(p.id,'Worktree ID'));
      case 'worktrees/open':{
        if(!this.actions.worktrees)throw Error('WORKTREES_UNAVAILABLE');
        const record=(await this.actions.worktrees.list()).records.find(item=>item.id===p.id);
        if(!record||record.status==='missing'||record.status==='archived')throw Error('WORKTREE_NOT_FOUND');await this.actions.openPath(record.path);return {opened:true};
      }
      case 'session/fork-options':{
        const source=this.session(p.sessionId),messageId=typeof p.messageId==='string'?p.messageId:undefined,busy=this.forkBusy(source,messageId);
        let reason=forkUnavailable(source,messageId)??(busy?'会话正在收尾，请稍候…':undefined);
        if(!reason&&source.worktree){try{if(!this.actions.worktrees)throw Error('WORKTREES_UNAVAILABLE');await this.actions.worktrees.validate(source.worktree);}catch{reason='原工作树不可用，请先恢复目录或选择其他会话。';}}
        const info=reason?{available:false,reason}:await this.actions.worktrees?.inspect(source.projectPath??'')??{available:false,reason:'本机工作树服务不可用。'};
        return {busy,workspace:{available:!reason,reason},worktree:info};
      }
      case 'session/fork':{
        if(this.worktreeMaintenance)throw Error('WORKTREE_BUSY');
        if(this.shared?.native?.cli.isMaintaining())throw Error('CLI 正在安装、更新或卸载，请完成后再开始任务。');
        const source=this.session(p.sessionId),messageId=p.messageId===undefined?undefined:required(p.messageId,'消息ID');
        const reason=forkUnavailable(source,messageId);if(reason)throw Error(reason);
        if(this.forkBusy(source,messageId))throw Error('会话正在处理，请稍后创建分支。');
        const location=p.location??'workspace';if(location!=='workspace'&&location!=='worktree')throw Error('FORK_LOCATION_INVALID');
        if(location==='worktree'&&!this.actions.worktrees)throw Error('WORKTREES_UNAVAILABLE');
        const host=source.binding.hostId?this.host(source.binding.hostId):undefined;
        const originalKey=forkSourceKey(source,messageId);
        this.forking.add(source.id);
        let worktree:WorktreeRecord|undefined,persisted=false;
        try{
          if(source.worktree){if(!this.actions.worktrees)throw Error('WORKTREES_UNAVAILABLE');await this.actions.worktrees.validate(source.worktree);}
          const native=['codex','claude'].includes(source.binding.runtime)?localModelBinding(source.binding)||source.binding.runtime==='claude'?this.nativeProvider?.forkSource(source.id,messageId):source.binding.runtime==='codex'?await this.nativeCodex?.forkSource(source.id,messageId):undefined:undefined;
          if(['codex','claude'].includes(source.binding.runtime)&&source.messages.length&&!native)throw Error('该连接无法核对原生历史，未创建分支。');
          if(location==='worktree')worktree=await this.actions.worktrees!.create(source.projectPath??'');
          const prepared=createSessionFork(source,randomUUID(),new Date().toISOString(),messageId,native);if(worktree){prepared.worktree=worktree;prepared.projectPath=worktree.cwd;}if(isPluginRuntime(source.binding.runtime))await this.pluginRuntimes.fork(source,prepared);
          let created:Session|undefined;
          await this.update(s=>{
            const current=s.sessions.find(item=>item.id===source.id);
            if(!current||forkUnavailable(current,messageId)||forkSourceKey(current,messageId)!==originalKey)throw Error('分支创建期间起点或连接身份已变化，请重试。');
            if(host){const now=s.hosts.find(item=>item.id===host.id);if(!now||hostIdentity(now)!==hostIdentity(host))throw Error('创建期间连接身份已变化。');}
            created=prepared;
            const naming=nextForkTitle(current,s.sessions);created.title=naming.title;
            Object.assign(created.branch!,{location,titleBase:naming.titleBase,number:naming.number});
            if(worktree){created.worktree=worktree;created.projectPath=worktree.cwd;}
            if(!created.projectId&&s.recentProject)s.recentProject.hidden=false;
            s.sessions.unshift(created);
          });persisted=true;return created!;
        }finally{try{if(worktree&&!persisted)await this.actions.worktrees!.abandon(worktree);}finally{this.forking.delete(source.id);}}
      }
      case 'session/native-title/refresh':return this.nativeProvider?.refreshTitle(this.session(p.sessionId).id)??{status:'unavailable'};
      case 'session/preview':await this.nativeProvider?.refreshTitle(this.session(p.sessionId).id);return sessionPresentation.preview(this.session(p.sessionId));
      case 'session/update':{
        if(this.worktreeMaintenance&&p.pinned!==undefined)throw Error('WORKTREE_BUSY');
        const current=this.session(p.id);
        const changes:Partial<Session>={};if(p.title!==undefined){changes.title=required(p.title,'title',150);changes.titleSource='manual';}if(p.group!==undefined)changes.group=text(p.group,'group',150).trim();
        for(const key of ['pinned','archived','unread'] as const)if(p[key]!==undefined)changes[key]=flag(p[key],key);
        if(changes.archived&&(current.status==='running'||this.forking.has(current.id)))throw new Error('运行中的任务不能归档。');
        return this.update(s=>{const target=s.sessions.find(x=>x.id===current.id);if(!target)throw new Error('会话不存在。');Object.assign(target,changes);});
      }
      case 'session/delete':{
        const current=this.session(p.id);if(p.confirm!==true)throw new Error('请确认永久删除本机会话记录。');
        const discardUncertain=p.discardUncertain===undefined?false:flag(p.discardUncertain,'删除结果未知的本地记录');
        const allowUncertain=current.status==='uncertain'&&discardUncertain;
        this.assertSidebarMutationBoundary(current,allowUncertain);await this.nativeCodex?.close(current.id);
        return this.update(s=>{const session=s.sessions.find(item=>item.id===current.id);if(!session)throw new Error('会话不存在。');this.assertSidebarMutationBoundary(session,allowUncertain);s.sessions=s.sessions.filter(item=>item.id!==current.id);});
      }
      case 'session/migration-manifest':{
        const session=this.session(p.sessionId),host=this.host(session.binding.hostId);
        if(this.sessionOperations.has(session.id)||this.nativeCodex?.busy(session.id))throw Error('请先停止当前会话。');
        const value=migrationManifest(session,host);this.actions.copy(JSON.stringify(value,null,2));return value;
      }
      case 'session/migrate-native':{
        const session=this.session(p.sessionId),host=structuredClone(this.host(session.binding.hostId));
        return this.withSessionOperation(session.id,async()=>{
          if(this.nativeCodex?.busy(session.id))throw Error('请先停止当前会话。');
          migrationManifest(session,host);
          await this.nativeCodex?.close(session.id);
          const value=await (this.actions.accountMigration??new LegacyMigrationClient()).resolve(host,session);
          if(hostIdentity(this.host(host.id))!==hostIdentity(host))throw Error('迁移核对期间 SSH 身份已变化。');
          this.gate.invalidatePending();
          await this.update(s=>{
            const current=s.sessions.find(item=>item.id===session.id),currentHost=s.hosts.find(item=>item.id===host.id);
            if(!current||!currentHost||hostIdentity(currentHost)!==hostIdentity(host))throw Error('会话或连接已变化。');
            adoptMigration(current,currentHost,value);
          });
          return value;
        });
      }
      case 'session/copy':{
        const session=this.session(p.id);let value:string;
        if(p.format==='directory'){value=session.projectPath??'';if(!value)throw new Error('此会话尚未关联本机工作区。');}
        else if(p.format==='markdown'){value=`# ${session.title}\n\n`+session.messages.map(message=>`## ${message.role==='user'?'用户':'助手'}\n\n${message.submitted??message.original}${message.submitted&&message.submitted!==message.original?`\n\n### 原始输入\n\n${message.original}`:''}${message.translation?`\n\n### 中文译文\n\n${message.translation}`:''}`).join('\n\n');}
        else throw new Error('不支持的会话复制格式。');
        this.actions.copy(value);return value;
      }
      case 'permissions/remember':{
        const runtime=p.runtime as RuntimeKind,projectId=p.projectId==null?null:required(p.projectId,'项目ID');
        if(projectId&&!this.store.snapshot().projects.some(project=>project.id===projectId))throw Error('项目不存在。');
        const mode=isPluginRuntime(runtime)?this.pluginRuntimes.mode(runtime,p.permissionMode):resolvePermissionMode(runtime,p.permissionMode);return this.update(s=>rememberPermission(s,projectId,runtime,mode));
      }
      case 'translation/intermediate':return this.update(s=>{s.translateIntermediate=flag(p.enabled,'中途消息翻译');});
      case 'translation/layout':{
        if(p.layout!=='panel'&&p.layout!=='inline')throw Error('请选择有效的翻译样式。');
        const layout=p.layout;return this.update(s=>{s.translationLayout=layout;});
      }
      case 'session/plan':return this.planFlow.read(this.session(p.sessionId).id,parsePlanReference(p.reference));
      case 'plan/translate':return this.planFlow.translate(this.session(p.sessionId).id,parsePlanReference(p.reference),p.blockIndex);
      case 'session/plan/respond':{
        await this.nativeProvider?.settleCompleted(this.session(p.sessionId).id);
        const session=this.session(p.sessionId),reference=parsePlanReference(p.reference);this.assertModelIdle(session);
        const plan=pendingCodexPlan(session);
        if(reference.kind!=='message'||!plan||plan.planReview!.receipt!==reference.receipt||!['implement','revise'].includes(String(p.action)))throw Error('PLAN_EXPIRED');
        return this.withSessionOperation(session.id,async()=>{
          await this.update(s=>{const current=s.sessions.find(item=>item.id===session.id)!;const live=pendingCodexPlan(current);if(live?.planReview?.receipt!==reference.receipt)throw Error('PLAN_EXPIRED');live.planReview.status=p.action==='implement'?'accepted':'revise';current.collaborationMode=p.action==='implement'?'default':'plan';});
          if(p.action==='revise')return {action:'revise'};
          // One explicit user click starts one default-mode turn with unchanged permissions.
          const preview:DraftPreview={id:randomUUID(),revision:1,original:'按计划执行。',translated:'Implement the plan.',sourceHash:hashText('按计划执行。'),demo:false,bypass:true};
          if(localModelBinding(session.binding))await this.nativeProvider!.submit(session.id,preview);else await this.nativeCodex!.submit(session.id,preview);
          return {action:'implement'};
        });
      }
      case 'session/collaboration':{
        const current=this.session(p.sessionId);
        const mode=resolveCollaborationMode(current.binding.runtime,p.mode);
        if(current.binding.runtime!=='codex'||p.mode===undefined)throw Error('COLLABORATION_MODE_INVALID');
        if(current.archived||!['idle','blocked'].includes(current.status)||this.permissionChanges.has(current.id)||this.modelSwitching.has(current.id))throw Error('COLLABORATION_MODE_BUSY');
        return this.withSessionOperation(current.id,()=>this.update(s=>{s.sessions.find(item=>item.id===current.id)!.collaborationMode=mode;}));
      }
      case 'session/permissions':{
        const current=this.session(p.sessionId);
        if(current.binding.runtime!=='demo'&&(current.status==='uncertain'||this.sessionOperations.has(current.id)||this.modelSwitching.has(current.id)))throw Error('会话正在准备或结果未确认，请稍后切换权限。');
        if(p.permissionMode===undefined)throw new Error('请选择权限模式。');
        const mode=resolvePermissionMode(current.binding.runtime,p.permissionMode);
        if(current.status==='running'&&((current.binding.runtime==='codex'&&!(localModelBinding(current.binding)?this.nativeProvider:this.nativeCodex))||current.binding.runtime==='claude'&&!this.nativeProvider))throw Error('当前原生连接尚未接通实时权限更新；本次没有更改或延后应用权限。');
        if(this.permissionChanges.has(current.id))throw new Error('权限模式正在保存，请稍后再试。');
        this.permissionChanges.add(current.id);
        try{if(isPluginRuntime(current.binding.runtime))await this.pluginRuntimes.permissions(current.id,mode);else if(this.providerBinding(current.binding)&&current.binding.runtime!=='api')await this.nativeProvider?.permissions(current.id,mode);else if(current.binding.runtime==='codex')await this.nativeCodex?.permissions(current.id,mode);return await this.update(s=>{const session=s.sessions.find(item=>item.id===current.id);if(!session)throw new Error('会话不存在。');session.permissionMode=resolvePermissionMode(session.binding.runtime,mode);rememberPermission(s,session.projectId,session.binding.runtime,mode);});}
        finally{this.permissionChanges.delete(current.id);}
      }
      case 'runtime/models':{
        const local=p.sessionId?this.session(p.sessionId).binding.localAccountId:typeof p.localAccountId==='string'?p.localAccountId:undefined;
        if(local){if(p.refresh===true)await this.localAccounts.refresh(local);return this.localAccounts.account(local).models;}
        const runtime=p.sessionId?this.session(p.sessionId).binding.runtime:p.runtime;if(isPluginRuntime(runtime)){await this.pluginRuntimes.registry.discover(runtime);return this.pluginRuntimes.registry.get(runtime).catalog.models??[];}
        return this.nativeModelList(this.modelTarget(p),p.refresh===true);
      }
      case 'session/model':{
        await this.nativeProvider?.settleCompleted(required(p.sessionId,'会话ID'),false);
        const local=this.session(p.sessionId);if(local.binding.localAccountId){this.assertModelIdle(local);const selection=this.localAccounts.selection(local.binding.localAccountId,p.selection);return this.update(s=>{const current=s.sessions.find(s=>s.id===local.id)!;nativeContextState.select(current,selection,this.localAccounts.account(local.binding.localAccountId!).models.find(m=>m.model===selection.model)?.contextWindow);current.modelSelection=selection;current.modelTargetId='account/'+current.binding.localAccountId+'/'+encodeURIComponent(selection.model);});}
        const pluginSession=this.session(p.sessionId);if(isPluginRuntime(pluginSession.binding.runtime)){this.assertModelIdle(pluginSession);const selection=this.pluginRuntimes.selection(pluginSession.binding.runtime,p.selection);return this.update(s=>{s.sessions.find(s=>s.id===pluginSession.id)!.modelSelection=selection;});}
        if(this.session(p.sessionId).binding.modelConnectionId){
          const session=this.session(p.sessionId);this.assertModelIdle(session);
          const connection=this.modelConnections.connection(session.binding.modelConnectionId),model=connection.models.find(model=>model.id===session.binding.modelMappingId&&model.enabled),selection=object(p.selection);if(!connection.enabled||!model)throw Error('模型来源已停用或移除。');
          if(selection.model!==model.model||selection.serviceTier!==undefined||selection.effort!==undefined&&!availableReasoningEfforts(model).includes(String(selection.effort)))throw Error('模型或思考档位不适用于此映射。');
          return this.update(s=>{s.sessions.find(item=>item.id===session.id)!.modelSelection={model:model.model,...(selection.effort?{effort:String(selection.effort)}:{})};});
        }
        const session=this.session(p.sessionId);if(session.binding.runtime==='claude')this.assertModelIdle(session);if(!['codex','claude'].includes(session.binding.runtime))throw Error('该运行时尚未提供模型设置。');
        const selection=validateModelSelection(p.selection,this.modelCatalogs.get(this.modelKey(session))??[]);
        return this.update(s=>{const current=s.sessions.find(item=>item.id===session.id);if(!current)throw Error('会话不存在。');nativeContextState.select(current,selection,this.modelCatalogs.get(this.modelKey(session))?.find(m=>m.model===selection.model)?.contextWindow);current.modelSelection=selection;if(current.modelTargetId?.startsWith('ssh/'))current.modelTargetId=current.modelTargetId.split('/model/')[0]+'/model/'+encodeURIComponent(selection.model);});
      }
      case 'translation/settings':{
        const previous=this.store.snapshot().translation,raw=object(p.profile);
        const profile=translationProfile((raw.source as {kind?:string}|undefined)?.kind==='model'?{...previous,source:raw.source,revision:raw.revision,maxCharacters:raw.maxCharacters,maxCalls:raw.maxCalls,timeoutMs:raw.timeoutMs}:raw);
        const key=p.key===undefined?'':text(p.key,'翻译密钥',4096).trim();
        const toggles={translateInput:true,translateProgress:false,translateFinal:true};
        const endChange=this.translationModule.beginConfigurationChange();this.gate.invalidatePending();
        const operation=this.settingsQueue.then(async()=>{
          const current=this.store.snapshot().translation;
          if(current.revision&&profile.revision!==current.revision)throw Error('TRANSLATION_SETTINGS_CHANGED');
          if(profile.source?.kind!=='model'){if(key)await this.secrets.set(profile.baseUrl,key);profile.hasKey=!!(await this.secrets.get(profile.baseUrl));}
          else {if(key)throw Error('TRANSLATION_MODEL_SOURCE_KEY_FORBIDDEN');profile.hasKey=current.hasKey;}
          profile.revision=randomUUID();
          if(previous.baseUrl!==profile.baseUrl&&!profile.consent)profile.consent=false;
          return this.update(s=>{s.translation=profile;Object.assign(s,toggles);});
        });this.settingsQueue=operation.then(()=>{},()=>{});
        try{return await operation;}finally{endChange();}
      }
      case 'plugins/list':return [this.translationModule.describe()];
      case 'plugins/set-enabled':{
        if(required(p.id,'模块ID')!=='translation')throw new Error('此功能属于工作台基座，不能作为附加模块关闭。');
        const enabled=flag(p.enabled,'翻译模块开关');
        const endChange=this.translationModule.beginConfigurationChange();this.gate.invalidatePending();
        const operation=this.settingsQueue.then(()=>this.update(s=>{s.plugins??={};s.plugins.translation={enabled};
          if(!enabled)for(const session of s.sessions)for(const message of [...session.messages,...(session.nativeChildren??[]).flatMap(child=>[...(child.messages??[]),...(child.taskTranslation?[child.taskTranslation]:[])])])if(message.translationStatus==='pending'){message.translationStatus='off';message.translationError=undefined;}
        }));this.settingsQueue=operation.then(()=>{},()=>{});
        try{return await operation;}finally{endChange();}
      }
      case 'translation/candidates':return protocolCandidates(required(p.baseUrl,'翻译端点',2048));
      case 'translation/quick-toggle':{
        const show=p.show===undefined?undefined:flag(p.show,'显示临时翻译开关');
        const paused=p.paused===undefined?undefined:flag(p.paused,'临时暂停翻译');
        if(show===undefined&&paused===undefined)throw new Error('请提供临时翻译开关设置。');
        const endChange=this.translationModule.beginConfigurationChange();this.gate.invalidatePending();
        const operation=this.settingsQueue.then(()=>this.update(s=>{
          const next={show:show??s.translationQuickToggle?.show??true,paused:paused??s.translationQuickToggle?.paused??false};
          if(paused!==undefined&&!translationQuickToggleVisible({...s,translationQuickToggle:next}))throw new Error('临时翻译开关不可用；请先在插件设置中启用翻译模块和该开关。');
          s.translationQuickToggle=next;
          if(!translationEnabled(s))for(const session of s.sessions)for(const message of [...session.messages,...(session.nativeChildren??[]).flatMap(child=>[...(child.messages??[]),...(child.taskTranslation?[child.taskTranslation]:[])])])if(message.translationStatus==='pending'){message.translationStatus='off';message.translationError=undefined;}
        }));this.settingsQueue=operation.then(()=>{},()=>{});
        try{return await operation;}finally{endChange();}
      }
      case 'translation/models':return this.translationModule.models();
      case 'translation/targets':return this.translationModule.targets.list();
      case 'translation/usage':return this.translationModule.usage(p.sessionId===undefined?undefined:required(p.sessionId,'Session ID'));
      case 'translation/auto-submit':this.translationModule.assertEnabled();return this.update(s=>{s.autoSubmitTranslated=flag(p.enabled,'翻译后直接发送');});
      case 'follow-up/cancel':return this.followUps.cancel(this.session(p.sessionId).id,required(p.id,'消息ID'));
      case 'follow-up/send':return this.followUps.send(this.session(p.sessionId).id,required(p.id,'消息ID'));
      case 'annotations/get':return this.annotations.read(required(p.sessionId,'Session ID'));
      case 'annotations/update':return this.annotations.update(p as unknown as import('../../../packages/context-annotations').AnnotationChange);
      case 'annotations/translate':return this.annotations.translate(p as unknown as import('../../../packages/context-annotations').AnnotationTranslationRequest);
      case 'session/prepare-runtime':return this.prepareRuntime(required(p.sessionId,'Session ID'));
      case 'draft/prepare':{
        const session=this.session(p.sessionId);this.assertDraftRuntime(session);if(session.status==='blocked'){session.status='idle';await this.update(s=>{s.sessions.find(x=>x.id===session.id)!.status='idle';});}
        if(session.status!=='idle'&&!(session.status==='running'&&session.nativeTurnId))throw new Error('当前会话尚不能接收输入，请确认运行状态。');
        return this.withSessionOperation(session.id,async()=>{
        const policy=this.translationModule.captureConfiguration();
        const question=p.questionReply===undefined?undefined:prepareAsyncQuestion(session,p.questionReply);
        if(question&&(p.attachmentIds!==undefined||p.skills!==undefined||p.demo===true||p.bypass===true||p.text!==undefined))throw Error('ASYNC_QUESTION_INVALID');
        const attachments=p.attachmentIds===undefined?[]:await this.actions.attachments?.resolve(p.attachmentIds);if(!attachments)throw Error('附件存储不可用。');if(session.binding.runtime==='codex'&&attachments.filter(a=>a.mime.startsWith('image/')).reduce((sum,a)=>sum+a.size,0)>5*1024*1024)throw Error('当前原生连接每条消息最多发送 5 MB 图片，请减少图片或压缩后重新添加。');const input=question?.original??text(p.text,'输入',100000);const annotations=p.annotationRevision===undefined?undefined:this.annotations.read(session.id);if(annotations&&annotations.revision!==p.annotationRevision)throw Error('ANNOTATION_CONFLICT');if(!input.trim()&&!annotations?.items.length&&!attachments.length&&!(Array.isArray(p.skills)&&p.skills.length))throw new Error('输入不能为空。');const moduleDisabled=!this.translationModule.enabled(),demo=!moduleDisabled&&p.demo===true,bypass=moduleDisabled||p.bypass===true;
        if(!moduleDisabled&&p.bypass===true&&/[\p{Script=Han}]/u.test(input))throw Error('翻译开启时必须先完成英文输入翻译；原稿未发送。');
        if(demo&&input!==DEMO_INPUT)throw new Error('离线翻译只提供明确的固定样例；其他中文请配置真实翻译服务或本次直接发送原文。');
        if(!demo&&session.status==='idle')void this.prepareRuntime(session.id).catch(()=>{});
        const skills=await this.resolveComposerSkills(session,p.skills);
        const modeId=p.questionReply?'steer':p.followUpMode===undefined?'steer':required(p.followUpMode,'跟进方式',180);const invert=p.invertFollowUp===undefined?false:flag(p.invertFollowUp,'反向跟进');
        const intent:FollowUpIntent|undefined=session.status==='running'?{modeId,action:this.followUps.modes.resolve(modeId,this.canSteer(session),invert),expectedTurnId:session.nativeTurnId!}:undefined;
        const id=this.gate.create(session.id,input,attachments,skills,annotations?.items,annotations?.revision);if(intent)this.steeringPreviews.set(id,intent);const requestId=p.requestId===undefined?id:required(String(p.requestId),'请求ID',200);
        this.requests.set(requestId,id);
        if(question){for(const [oldId,meta]of this.questionPreviews)if(meta.sessionId===session.id)this.questionPreviews.delete(oldId);this.questionPreviews.set(id,{sessionId:session.id,reference:question.reference});}
        try{const result=await this.gate.prepare(id,async(source,signal)=>{
          this.translationModule.assertConfiguration(policy);
          if(question){
            const records=structuredClone(question.answers);
            const custom=question.message.questions!.flatMap((q,i)=>records[q.id]!.flatMap((value,j)=>q.options.some(option=>option.label===value)||!/[\p{Script=Han}]/u.test(value)?[]:[{key:`a${i}.${j}`,questionId:q.id,index:j,value}]));
            if(!bypass&&custom.length){const translated=await this.translationModule.segments(Object.fromEntries(custom.map(a=>[a.key,a.value])),'input',id,signal,session.id);for(const a of custom)records[a.questionId]![a.index]=translated.value[a.key]!;}
            currentAsyncQuestion(this.session(session.id),question.reference.messageId,question.reference);this.translationModule.assertConfiguration(policy);
            return question.serialize(records);
          }
          if(!moduleDisabled&&annotationsNeedInputTranslation(annotations?.items)&&(bypass||demo))throw Error('中文注释需要翻译并预览，请使用生成发送预览。');
          if(bypass)return source;
          if(demo)return DEMO_TRANSLATED;
          if(annotations?.items.length&&/[\p{Script=Han}]/u.test(source+annotations.items.map(item=>item.text).join(''))){
            const segments:Record<string,string>={};if(source.trim())segments.body=source;annotations.items.forEach((item,index)=>{segments['annotation_'+index]=item.text;});
            const translated=(await this.translationModule.segments(segments,'input',`${session.id}:${id}:annotations`,signal,session.id)).value;
            this.translationModule.assertConfiguration(policy);
            if(Object.keys(segments).some(key=>typeof translated[key]!=='string'||!translated[key]!.trim()))throw Error('注释翻译不完整，草稿已保留，请重试。');
            return {text:source.trim()?translated.body!:source,annotations:annotations.items.map((item,index)=>({...item,translatedText:translated['annotation_'+index]!}))};
          }
          if(!/[\p{Script=Han}]/u.test(source))return source;
          return (await this.translationModule.translate(source,'input',`${session.id}:${id}:input`,'input',signal,session.id)).value.text;
        },demo,bypass,moduleDisabled);return {...result,...(intent?{followUp:intent}:{})};}catch(error){this.questionPreviews.delete(id);this.steeringPreviews.delete(id);throw error;}finally{this.requests.delete(requestId);}
        });
      }
      case 'draft/cancel':{const id=p.id!==undefined?required(p.id,'输入ID'):this.requests.get(required(String(p.requestId),'请求ID'));if(id){this.gate.cancel(id);this.steeringPreviews.delete(id);this.questionPreviews.delete(id);}return null;}
      case 'draft/refine':{
        this.translationModule.assertEnabled();
        if(this.questionPreviews.has(String(p.id)))throw Error('ASYNC_QUESTION_EDIT_IN_CARD');
        const session=this.session(p.sessionId);this.assertDraftRuntime(session);const expectedTurn=this.steeringPreviews.get(String(p.id));if(expectedTurn?(session.nativeTurnId!==expectedTurn.expectedTurnId||!(session.status==='running'||expectedTurn.action==='queue'&&session.status==='idle')):session.status!=='idle')throw new Error('当前会话不允许修订待发送请求。');
        return this.withSessionOperation(session.id,async()=>{
        const instruction=required(p.instruction,'补充要求',16000);const oldId=required(p.id,'预览ID');const revision=this.gate.beginRevision(oldId,session.id,required(p.sourceHash,'原稿摘要'));if(expectedTurn){this.steeringPreviews.delete(oldId);this.steeringPreviews.set(revision.id,expectedTurn);}
        const requestId=p.requestId===undefined?revision.id:required(String(p.requestId),'修订请求ID',200);this.requests.set(requestId,revision.id);
        try{const result=await this.gate.prepareRevision(revision.id,revision.previous,instruction,async(original,signal)=>{
          return this.translationModule.refine(original,instruction,`${session.id}:${revision.id}:refine`,signal,session.id);
        });return {...result,...(expectedTurn?{followUp:expectedTurn}:{})};}finally{this.requests.delete(requestId);}
        });
      }
      case 'draft/submit':{
        const session=this.session(p.sessionId);const id=required(p.id,'输入ID');this.assertDraftRuntime(session);const steering=this.steeringPreviews.get(id);if(steering?(session.nativeTurnId!==steering.expectedTurnId||!(session.status==='running'||steering.action==='queue'&&session.status==='idle')):session.status!=='idle')throw new Error('回合已结束或变化，请重新检查草稿；没有自动发送新任务。');
        if(p.automatic===true&&(!this.translationModule.enabled()||!this.store.snapshot().autoSubmitTranslated))throw new Error('直接发送已关闭，请检查预览后确认。');
        const preview=this.gate.getPreview(id,session.id);
        if(p.automatic===true&&!preview.moduleDisabled&&annotationsNeedInputTranslation(preview.annotations))throw Error('中文注释需要确认发送预览。');
        if(preview.annotationRevision!==undefined&&this.annotations.read(session.id).revision!==preview.annotationRevision)throw Error('ANNOTATION_CONFLICT');
        const question=this.questionPreviews.get(id);if(question)currentAsyncQuestion(session,question.reference.messageId,question.reference);
        if(preview.skills?.length)await this.resolveComposerSkills(session,preview.skills.map(({id,hash})=>({id,hash})));
        if(preview.attachments?.length)await this.actions.attachments!.payloads(preview.attachments.map(a=>a.id));
        if(!!preview.moduleDisabled===this.translationModule.enabled())throw new Error('翻译模块状态已改变，请重新准备当前原稿。');
        const result=await this.withSessionOperation(session.id,()=>this.gate.submit(id,session.id,required(p.sourceHash,'输入摘要'),async()=>{
          if(steering)return steering.action==='queue'?this.followUps.enqueue(session.id,preview,steering.expectedTurnId):this.dispatchDraft(session,preview,steering.expectedTurnId);
          await this.update(state=>draftRecovery.capture(state.sessions.find(item=>item.id===session.id)!,preview));
          try{return await this.dispatchDraft(session,preview);}
          catch(error){await this.update(state=>draftRecovery.fail(state.sessions.find(item=>item.id===session.id)!,id));throw error;}
        }));
        if(question)await this.update(state=>{const current=state.sessions.find(item=>item.id===session.id),message=current?.messages.find(item=>item.id===question.reference.messageId);if(current&&message)message.questionPresentation={state:'answered',context:questionContext(current)};});
        this.steeringPreviews.delete(id);this.questionPreviews.delete(id);
        return result;
      }
      case 'draft/recovery-dismiss':{
        const session=this.session(p.sessionId),id=required(p.id,'输入ID');
        return this.update(state=>draftRecovery.dismiss(state.sessions.find(item=>item.id===session.id)!,id));
      }
      case 'message/retranslate':{
        this.translationModule.assertEnabled();
        const session=this.session(p.sessionId);const id=required(p.messageId,'消息ID');const message=session.messages.find(m=>m.id===id&&(m.role==='assistant'||session.agentParent));if(!message)throw new Error('原文消息不存在。');await this.translateMessage(session.id,message,true);return null;
      }
      case 'child-message/translate':{
        this.translationModule.assertEnabled();
        const session=this.session(p.sessionId),childId=required(p.childId,'子会话ID'),messageId=p.messageId===undefined?undefined:required(p.messageId,'消息ID');
        const child=session.nativeChildren?.find(child=>child.nativeChildId===childId);if(!child)throw Error('子会话不存在。');
        const message=messageId?child.messages?.find(message=>message.id===messageId):undefined;
        if(messageId&&(!message||!message.complete))throw Error('请等待这条消息完成后再翻译。');
        const source=messageId?message!.text:child.task;if(!source?.trim())throw Error('尚无可翻译的公开消息。');
        const key=session.id+':'+JSON.stringify(['native-child',childId,messageId??'task']);if(this.activeTranslations.has(key))return this.activeTranslations.get(key);
        const resolve=(state:AppState)=>{const current=state.sessions.find(item=>item.id===session.id)?.nativeChildren?.find(item=>item.nativeChildId===childId||!!child.toolCallId&&item.toolCallId===child.toolCallId);if(!current)return;const target=messageId?current.messages?.find(item=>item.id===messageId):(current.taskTranslation??={});const currentText=messageId?current.messages?.find(item=>item.id===messageId)?.text:current.task;return target&&source===currentText?target:undefined;};
        const operation=(async()=>{
          await this.update(state=>{const target=resolve(state);if(target){target.translationStatus='pending';delete target.translationError;}});
          try{const result=await this.translationModule.translate(source,'output',key,'final',undefined,session.id);await this.update(state=>{this.translationModule.assertCurrent(result.policy);const target=resolve(state);if(target){target.translation=result.value.text;target.translationStatus='complete';target.translationSource=state.translation.name+' / '+result.value.model;}});}
          catch(error){await this.update(state=>{const target=resolve(state);if(target){target.translationStatus=translationEnabled(state)?'failed':'off';target.translationError=translationEnabled(state)?safeError(error):undefined;}});}
        })();this.activeTranslations.set(key,operation);try{await operation;}finally{this.activeTranslations.delete(key);}return null;
      }
      case 'session/stop':{const session=this.session(p.sessionId);await this.followUps.pause(session.id).catch(()=>{/* Queue storage errors remain visible; Stop must still reach the runtime. */});if(isPluginRuntime(session.binding.runtime))return this.pluginRuntimes.stop(session.id);if(this.providerBinding(session.binding))return this.providerRunner(session).stop(session.id);if(session.binding.runtime!=='demo'){this.assertDraftRuntime(session);return this.nativeCodex!.stop(session.id);}const running=this.activeTurns.get(session.id);if(!running)return {stopped:false,reason:session.status==='running'?'回合已进入完成阶段，不能再取消。':'当前没有运行中的回合。'};running.abort();return {stopped:true,scope:'offline-demo'};}
      case 'session/reconcile':{const session=this.session(p.sessionId);this.assertDraftRuntime(session);if(session.binding.runtime==='claude'&&session.binding.hostId)throw Error('Claude 远端结果尚未核实；请保留记录并刷新远端资源回执，不会自动重发。');return this.withSessionOperation<unknown>(session.id,()=>isPluginRuntime(session.binding.runtime)?this.pluginRuntimes.resume(session.id):this.nativeCodex!.reconcile(session.id));}
      case 'session/approval':{const session=this.session(p.sessionId);this.assertDraftRuntime(session);if(!isRequestId(p.requestId))throw Error('APPROVAL_REPLY_INVALID');const reply=parseApprovalReply(p);if(isPluginRuntime(session.binding.runtime))return this.pluginRuntimes.approval(session.id,p.requestId,reply);if(this.providerBinding(session.binding)){if(session.binding.runtime==='api'){if(!reply.decision||reply.optionId)throw Error('APPROVAL_OPTION_NOT_OFFERED');return this.apiRunner!.approval(session.id,p.requestId,reply.decision);}return this.nativeProvider!.approval(session.id,p.requestId,reply);}return this.nativeCodex!.approval(session.id,p.requestId,reply);}
      case 'session/interaction':{
        const session=this.session(p.sessionId);this.assertDraftRuntime(session);
        if(!isRequestId(p.requestId)||!p.reply||typeof p.reply!=='object')throw Error('无效的问题回应。');
        const {item}=this.interactionFlow.current(session.id,p.requestId,required(p.receipt,'提问回执'));
        if(item.kind==='questions'&&(p.reply as InteractionReply).action==='submit')throw Error('请先准备回答，按当前翻译设置检查后发送。');
        return this.sendInteraction(session,p.requestId,p.reply as InteractionReply);
      }
      case 'interaction/presentation':{
        const session=this.session(p.sessionId),action=p.action;
        if(!['defer','show','dismiss'].includes(String(action))||(p.messageId===undefined)===(p.receipt===undefined))throw Error('QUESTION_PRESENTATION_INVALID');
        if(p.messageId!==undefined){
          const messageId=required(p.messageId,'消息标识');
          await this.update(state=>{const current=state.sessions.find(item=>item.id===session.id)!;const message=current.messages.find(item=>item.id===messageId);if(!message||['answered','dismissed'].includes(asyncQuestionState(current,message)))throw Error('ASYNC_QUESTION_STALE');message.questionPresentation={state:action==='defer'?'deferred':action==='dismiss'?'dismissed':'open',context:questionContext(current)};});
          for(const [id,meta]of this.questionPreviews)if(meta.sessionId===session.id&&meta.reference.messageId===messageId){try{this.gate.cancel(id);}catch{/* A dispatched reply keeps its acknowledgement lifecycle. */}this.questionPreviews.delete(id);}
        }else{
          const receipt=required(p.receipt,'提问回执'),item=session.nativeInteractions?.find(item=>item.receipt===receipt&&item.status==='pending'&&item.kind==='questions');
          if(!item)throw Error('NATIVE_QUESTION_STALE');
          if(action==='dismiss'){this.assertDraftRuntime(session);await this.sendInteraction(session,item.id,{action:'decline'});}
          else await this.update(state=>{const target=state.sessions.find(item=>item.id===session.id)?.nativeInteractions?.find(item=>item.receipt===receipt&&item.status==='pending');if(!target)throw Error('NATIVE_QUESTION_STALE');target.deferred=action==='defer';});
        }
        return this.store.snapshot();
      }
      case 'interaction/prepare':{
        const session=this.session(p.sessionId);this.assertDraftRuntime(session);if(!isRequestId(p.requestId))throw Error('无效的提问标识。');
        return this.interactionFlow.prepare(session.id,p.requestId,required(p.receipt,'提问回执'),p.answers,required(p.clientRequest,'回答请求标识'));
      }
      case 'interaction/submit':return this.interactionFlow.submit(this.session(p.sessionId).id,required(p.id,'回答预览'),required(p.sourceHash,'回答摘要'),p.automatic===true);
      case 'interaction/cancel':return this.interactionFlow.cancel(p.id===undefined?undefined:required(p.id,'回答预览'),p.clientRequest===undefined?undefined:required(p.clientRequest,'回答请求标识'));
      case 'interaction/translate':return this.interactionFlow.translate(this.session(p.sessionId).id,p.receipt===undefined?undefined:required(p.receipt,'提问回执'),p.messageId===undefined?undefined:required(p.messageId,'消息标识'));
      case 'session/interaction/open-url':{
        const session=this.session(p.sessionId);if(!isRequestId(p.requestId))throw Error('无效的提问标识。');const {item}=this.interactionFlow.current(session.id,p.requestId,required(p.receipt,'提问回执'));
        if(!item?.url||!this.actions.openWeb)throw Error('此确认链接已失效或当前无法打开。');
        await this.actions.openWeb(safeInteractionUrl(item.url));return null;
      }
      case 'session/api-acknowledge':{const session=this.session(p.sessionId);if(!localModelBinding(session.binding)||session.status!=='uncertain'||p.confirm!==true||this.apiRunner.busy(session.id)||this.nativeProvider?.busy(session.id))throw Error('请确认结束等待当前 API 结果。');return this.update(s=>{const current=s.sessions.find(item=>item.id===session.id)!;current.status='idle';current.nativeError='已由你结束等待；上游结果仍未知，没有重发旧请求。';});}
      case 'ssh/pick-file':{const service=this.actions.sshOnboarding;if(!service)throw Error('SSH 文件选择不可用。');return service.pick(required(p.kind,'文件类型') as 'key'|'config'|'known-hosts');}
      case 'ssh/import-file':{const service=this.actions.sshOnboarding;if(!service)throw Error('SSH 文件导入不可用。');return service.importFile(required(p.filePath,'文件路径'));}
      case 'ssh/scan-host-key':{const service=this.actions.sshOnboarding;if(!service)throw Error('SSH 身份读取不可用。');return service.scan(p.hostname,p.port);}
      case 'ssh/trust-host-key':{const service=this.actions.sshOnboarding;if(!service)throw Error('SSH 身份保存不可用。');return service.trust(required(p.previewId,'身份预览'),p.confirm===true,p.hostname,p.port);}
      case 'ssh/install-key':{if(p.confirm!==true||!this.actions.sshOnboarding)throw Error('请确认添加此密钥到本机 SSH 目录。');return this.actions.sshOnboarding.installKey(required(p.selectionId,'密钥选择'));}
      case 'ssh/verify':{if(!this.actions.sshOnboarding)throw Error('SSH 连接核实不可用。');const h=object(p.host);const host:SshHost={id:typeof h.id==='string'&&h.id?h.id:'connection-preview',name:required(h.name,'连接名称',100),hostname:required(h.hostname,'服务器',253),port:integer(h.port,1,65535,'端口'),username:required(h.username,'用户名',64),role:h.role==='admin'?'admin':'workspace',identityFile:absolutePath(h.identityFile),knownHostsFile:absolutePath(h.knownHostsFile),ownerId:'local-owner',workspaceGeneration:'connection-preview'};return this.actions.sshOnboarding.verify(host);}
      case 'host/save':{
        const h=object(p.host);const host:SshHost={id:typeof h.id==='string'&&h.id?required(h.id,'连接ID'):randomUUID(),name:required(h.name,'连接名称',100),hostname:required(h.hostname,'主机',255),port:integer(h.port,1,65535,'端口'),username:required(h.username,'SSH用户名',100),role:h.role==='admin'?'admin':'workspace',identityFile:absolutePath(h.identityFile),knownHostsFile:absolutePath(h.knownHostsFile),ownerId:'local-owner',workspaceGeneration:typeof h.workspaceGeneration==='string'&&h.workspaceGeneration?h.workspaceGeneration:randomUUID()};
        host.workspaceGeneration=this.store.snapshot().hosts.find(x=>x.id===host.id)?.workspaceGeneration??randomUUID();
        validateSshHost(host);await this.update(s=>{
          const i=s.hosts.findIndex(x=>x.id===host.id);const old=s.hosts[i];
          const identityChanged=old&&['hostname','port','username','role','identityFile','knownHostsFile','workspaceGeneration'].some(key=>old[key as keyof SshHost]!==host[key as keyof SshHost]);
          if(identityChanged&&this.codexLoginActive(old))throw new Error('请先取消当前 Codex 授权等待，再更改连接身份。');
          if(identityChanged&&(this.actions.remoteBrowser?.busy(old)||this.hostMaintenanceActive(old)))throw Error('远端登录或维护仍在进行，请等待清理回执后更改连接身份。');
          if(identityChanged&&this.actions.workspaceManagement?.busy(old))throw new Error('管理操作正在等待远端回执，暂不能修改连接身份。');
          if(identityChanged&&s.sessions.some(session=>session.binding.hostId===host.id))throw new Error('已有会话绑定该连接身份；请新建连接，不能让旧会话静默改用另一主机或账户。');
          if(identityChanged){s.profiles=s.profiles.filter(profile=>profile.hostId!==host.id);if(s.accountCatalogs)delete s.accountCatalogs[host.id];if(s.activeWorkspaceId===host.id){delete s.activeWorkspaceId;this.workspaceSelectionEpoch++;}}
          if(old&&!identityChanged){for(const key of ['authorityId','authorityGeneration','remoteWorkspaceId','deviceId'] as const)if(old[key])host[key]=old[key];}
          if(i<0)s.hosts.push(host);else s.hosts[i]=host;
        });return host;
      }
      case 'host/remove':{
        const host=this.host(p.id);if(p.confirm!==true)throw Error('请确认移除本机连接。');
        const assertRemovable=()=>{if(this.codexLoginActive(host)||this.actions.workspaceManagement?.busy(host)||this.actions.remoteBrowser?.busy(host)||this.hostMaintenanceActive(host)||this.accountOperations.has(host.id))throw Error('此连接有操作正在等待回执，请完成后再移除。');for(const session of this.store.snapshot().sessions.filter(item=>item.binding.hostId===host.id))this.assertSidebarMutationBoundary(session);};
        assertRemovable();
        for(const session of this.store.snapshot().sessions.filter(item=>item.binding.hostId===host.id))await this.nativeCodex?.close(session.id);
        return this.update(s=>{assertRemovable();s.hosts=s.hosts.filter(item=>item.id!==host.id);s.profiles=s.profiles.filter(item=>item.hostId!==host.id);if(s.accountCatalogs)delete s.accountCatalogs[host.id];if(s.activeWorkspaceId===host.id){delete s.activeWorkspaceId;this.workspaceSelectionEpoch++;}});
      }
      case 'workspace/select':{
        const host=this.host(p.id);
        if(host.role!=='workspace'||host.username.toLowerCase()==='root')throw new Error('管理员仅用于管理，请选择成员工作空间。');
        const identity=hostIdentity(host),epoch=++this.workspaceSelectionEpoch;
        await (this.actions.verifyWorkspaceMember??verifyWorkspaceMember)(host);
        await this.update(s=>{const current=s.hosts.find(item=>item.id===host.id);if(epoch!==this.workspaceSelectionEpoch||!current||hostIdentity(current)!==identity)throw new Error('工作空间选择已变化，旧连接结果已丢弃。');s.activeWorkspaceId=host.id;});
        // Reading the public catalog never starts login, refreshes a token or runs a model.
        await this.readAccountCatalog(host);
        return this.store.snapshot();
      }
      case 'host/discover':{
        const host=this.host(p.id);const identity=hostIdentity(host);
        const result=await (this.actions.discoverWorkspaces??discoverWorkspaces)(host);
        const current=this.store.snapshot().hosts.find(item=>item.id===host.id);
        if(!current||hostIdentity(current)!==identity)throw new Error('发现期间连接身份已变更，旧工作空间结果已丢弃。');
        return result;
      }
      case 'remote-browser/setup-plan':case 'remote-browser/setup-apply':
      case 'remote-browser/launch':case 'remote-browser/reconnect':case 'remote-browser/stop':
      case 'remote-browser/profiles':case 'remote-browser/create':case 'remote-browser/rename':case 'remote-browser/delete':case 'remote-browser/start':case 'remote-browser/status':case 'remote-browser/open':case 'remote-browser/code':case 'remote-browser/cancel':{
        const host=this.codexLoginHost(p.id),identity=hostIdentity(host),service=this.actions.remoteBrowser;
        if(host.role!=='admin'||host.username!=='root'||!service)throw Error('请从 root 管理员入口管理远端浏览器。');
        let result:unknown;
        if(method==='remote-browser/setup-plan'||method==='remote-browser/setup-apply'){if(method==='remote-browser/setup-apply'&&p.confirm!==true)throw Error('请先核对并确认浏览器配置计划。');result=await service.setup(host,method==='remote-browser/setup-apply'?required(p.planId,'配置计划'):undefined);}
        else if(['remote-browser/profiles','remote-browser/create','remote-browser/rename','remote-browser/delete'].includes(method)){
          const action=method==='remote-browser/profiles'?'list':method.slice('remote-browser/'.length) as 'create'|'rename'|'delete';
          result=await service.profiles(host,action,{key:typeof p.key==='string'?p.key:undefined,label:typeof p.label==='string'?p.label:undefined,confirm:p.confirm===true});
        }else if(['remote-browser/launch','remote-browser/reconnect','remote-browser/stop'].includes(method)){
          if(!service.control)throw Error('当前浏览器管理服务尚未提供独立操控接口。');
          if(method==='remote-browser/stop'&&p.confirm!==true)throw Error('请确认关闭远端浏览器，用户配置与登录状态将保留。');
          result=await service.control(host,method.slice('remote-browser/'.length) as 'launch'|'reconnect'|'stop',{...(method==='remote-browser/launch'?{profileKey:required(p.profileKey,'浏览器用户')}:{confirm:p.confirm===true})});
        }else if(method==='remote-browser/start'){
          this.assertRemoteMaintenance(host,'claude');
          const catalog=this.store.snapshot().accountCatalogs?.[host.id];if(!catalog)throw Error('请先刷新原生账号。');
          const accountId=required(p.accountId,'账号'),draft=this.actions.nativeAccounts?.draft?.(host,catalog,accountId);
          result=await service.start(host,draft?{...catalog,accounts:[...catalog.accounts,draft]}:catalog,accountId,required(p.profileKey,'浏览器用户'),!!draft);
        }else{
          const id=required(p.jobId,'登录任务');
          if(method==='remote-browser/open')result=await service.openViewer(host,id);
          else if(method==='remote-browser/code')result=service.code(host,id,required(p.code,'临时授权码',2048));
          else if(method==='remote-browser/cancel')result=await service.cancel(host,id);
          else {const job=service.status(host,id);result=job;if(job.state==='authenticated'&&job.cleanup==='confirmed')await this.readAccountCatalog(host);}
        }
        if(hostIdentity(this.host(host.id))!==identity)throw Error('连接已变化，请重新核实状态。');
        if(['remote-browser/status','remote-browser/cancel'].includes(method)){
          const job=result as import('../../../packages/remote-account-catalog/browser').BrowserLogin,catalog=this.store.snapshot().accountCatalogs?.[host.id],native=this.actions.nativeAccounts;
          if(catalog&&job.cleanup==='confirmed'&&['failed','expired','cancelled'].includes(job.state)&&native?.draft?.(host,catalog,job.accountId))await native.discardClaude?.(host,catalog,job.accountId);
        }
        return result;
      }
      case 'native-accounts/prepare-claude':case 'native-accounts/discard-claude':{
        const host=this.codexLoginHost(p.id),identity=hostIdentity(host),catalog=this.store.snapshot().accountCatalogs?.[host.id],service=this.actions.nativeAccounts;
        if(host.role!=='admin'||host.username!=='root'||catalog?.source!=='native-owner'||catalog.availability!=='ready'||!service?.prepareClaude||!service.discardClaude)throw Error('请从 root 管理员入口刷新原生账号服务。');
        this.assertRemoteMaintenance(host,'claude');
        if(this.codexLoginActive(host)||this.actions.remoteBrowser?.busy(host))throw Error('此服务器仍有账号操作进行中。');
        this.accountOperations.add(host.id);
        try{
          const result=method==='native-accounts/prepare-claude'?await service.prepareClaude(host,catalog):await service.discardClaude(host,catalog,required(p.accountId,'账号'));
          if(hostIdentity(this.host(host.id))!==identity)throw Error('连接身份已变化，请重新读取。');
          return result;
        }finally{this.accountOperations.delete(host.id);}
      }
      case 'native-accounts/remove':{
        const host=this.codexLoginHost(p.id),service=this.actions.nativeAccounts,catalog=this.store.snapshot().accountCatalogs?.[host.id];
        if(host.role!=='admin'||host.username!=='root'||!service?.remove||!catalog||p.confirm!==true)throw Error('请从管理员入口确认移除账号。');
        if(this.codexLoginActive(host)||this.actions.remoteBrowser?.busy(host))throw Error('此服务器仍有账号操作进行中。');
        const account=catalog.accounts.find(a=>a.id===p.accountId);if(!account)throw Error('账号已变化，请刷新。');
        this.assertRemoteMaintenance(host,account.provider);
        const key=this.maintenanceKey(host,account.provider);
        if(this.store.snapshot().sessions.some(s=>{const h=this.store.snapshot().hosts.find(h=>h.id===s.binding.hostId);return h&&this.maintenanceKey(h,account.provider)===key&&s.binding.runtime===account.provider&&(s.status==='running'||s.status==='uncertain'||this.gate.hasPending(s.id)||this.sessionOperations.has(s.id));}))throw Error('请先处理该运行时的会话与待发送内容。');
        this.accountOperations.add(host.id);this.remoteMaintenance.add(key);
        try{await service.remove(host,catalog,account.id);await this.readAccountCatalog(host);return {removed:account.id};}finally{this.accountOperations.delete(host.id);this.remoteMaintenance.delete(key);}
      }
      case 'remote-resources/read':case 'remote-resources/configure':case 'remote-resources/reclaim':
      case 'remote-files/browse':case 'remote-files/mutate':case 'remote-files/upload':case 'remote-files/download':{
        const host=this.codexLoginHost(p.id),service=this.actions.remoteResources;
        if(!service||host.role!=='admin'||host.username!=='root')throw Error('请从 SSH 管理员连接管理远端资源。');
        if(method==='remote-resources/read'){const observed=this.store.snapshot().sessions,result=await service.read(host);await this.settleRemoteInterruptions(host,result.runtime.interrupted??[],observed);return result;}
        if(method==='remote-resources/configure')return service.configure(host,integer(p.revision,0,Number.MAX_SAFE_INTEGER,'修订'),flag(p.autoMemory,'自动回收'));
        if(method==='remote-resources/reclaim')return service.reclaim(host);
        const target=required(p.path,'远端路径',4096);
        if(method==='remote-files/browse')return service.browse(host,target);
        if(method==='remote-files/upload')return service.upload(host,target);
        if(method==='remote-files/download')return service.download(host,target,required(p.revision,'文件修订'));
        return service.mutate(host,required(p.operation,'文件操作'),{path:target,...(p.revision!==undefined?{revision:required(p.revision,'文件修订')}:{}),...(p.destination!==undefined?{destination:required(p.destination,'目标路径',4096)}:{}),...(p.content!==undefined?{content:text(p.content,'文件内容',1024*1024)}:{}),...(p.confirm!==undefined?{confirm:flag(p.confirm,'删除确认')}:{})});
      }
      case 'remote-configuration/list':case 'remote-configuration/plan':case 'remote-configuration/apply':case 'remote-configuration/configure':{
        const host=this.codexLoginHost(p.id),identity=hostIdentity(host),service=this.remoteConfigurations;
        if(host.role!=='admin'||host.username!=='root')throw Error('请从 root 管理员入口管理远端配置。');
        if(method==='remote-configuration/list')return service.list(host);
        const configurationId=required(p.configurationId,'配置标识');
        if(method==='remote-configuration/configure'){
          if(this.hostMaintenanceActive(host))throw Error('远端配置正在维护，请等待回执。');
          const keys=['codex','claude'].map(provider=>this.maintenanceKey(host,provider));keys.forEach(key=>this.remoteStorageMaintenance.add(key));
          let finish!:()=>void;const receipt=new Promise<void>(resolve=>finish=resolve);this.configurationReceipts.add(receipt);
          try{
            const result=await service.configure(host,configurationId,integer(p.revision,0,Number.MAX_SAFE_INTEGER,'策略修订'),flag(p.autoUpdate,'自动更新'));
            if(hostIdentity(this.host(host.id))!==identity)throw Error('连接已变化，请重新核对远端状态。');
            return result;
          }finally{keys.forEach(key=>this.remoteStorageMaintenance.delete(key));this.configurationReceipts.delete(receipt);finish();}
        }
        if(method==='remote-configuration/plan'){
          if(p.operation!=='install'&&p.operation!=='update'&&p.operation!=='uninstall')throw Error('无效的配置维护操作。');
          return service.plan(host,configurationId,p.operation);
        }
        if(p.confirm!==true)throw Error('请先预览并确认本次远端配置维护。');
        return this.maintainConfiguration(host,()=>service.apply(host,configurationId,required(p.planId,'配置维护计划')));
      }
      case 'remote-cli/configure':{
        const host=this.codexLoginHost(p.id),service=this.actions.remoteCliPolicies;
        if(!service||host.role!=='admin'||host.username!=='root'||p.provider!=='codex'&&p.provider!=='claude')throw Error('远端 CLI 策略入口不可用。');
        const changes=object(p.changes);
        if(changes.reclaimIdle===false||changes.idleHours!==undefined)this.actions.sessionStorage?.cancel(host,p.provider);
        const policy=await service.configure(host,p.provider,integer(p.revision,0,Number.MAX_SAFE_INTEGER,'修订'),changes);
        if(changes.reclaimIdle!==undefined||changes.idleHours!==undefined)await this.actions.sessionStorage?.recordPolicy(host,p.provider,policy);
        return policy;
      }
      case 'remote-storage/inspect':case 'remote-storage/logs':{
        const host=this.codexLoginHost(p.id),service=this.actions.sessionStorage;
        if(host.role!=='admin'||host.username!=='root'||!service||p.provider!=='codex'&&p.provider!=='claude')throw Error('请从 root 管理员入口查看原生会话清理。');
        const provider=p.provider;
        const limit=p.limit===undefined?50:integer(p.limit,1,100,'分页数量');
        if(method==='remote-storage/logs')return service.logs(host,p.provider,{limit,...(p.before!==undefined?{before:required(p.before,'日志位置',80)}:{})});
        const value=await service.inspect(host,p.provider,{limit,...(p.after!==undefined?{after:text(p.after,'会话位置',256)}:{})});
        const state=this.store.snapshot();
        return {...value,sessions:value.sessions.map(row=>{const local=state.sessions.find(s=>s.id===row.sessionId&&s.binding.runtime===provider&&state.hosts.some(h=>h.id===s.binding.hostId&&this.maintenanceKey(h,provider)===this.maintenanceKey(host,provider)));return {...row,...(local?{title:local.title}:{})};})};
      }
      case 'remote-storage/status':{
        const host=this.codexLoginHost(p.id);if(host.role!=='admin'||host.username!=='root'||!this.actions.sessionStorage)throw Error('原生会话归档入口不可用。');return this.actions.sessionStorage.status(host);
      }
      case 'remote-cli/list':case 'remote-cli/plan':case 'remote-cli/apply':{
        const host=this.codexLoginHost(p.id),identity=hostIdentity(host),service=this.actions.remoteCli;
        if(host.role!=='admin'||host.username!=='root'||!service)throw Error('请从 root 管理员入口管理远端 CLI。');
        if(method==='remote-cli/list')return service.list(host);
        if(p.provider!=='codex'&&p.provider!=='claude')throw Error('运行时无效。');
        const provider=p.provider,key=this.maintenanceKey(host,provider);
        if(method==='remote-cli/plan'){if(p.operation!=='install'&&p.operation!=='update'&&p.operation!=='uninstall')throw Error('Invalid CLI operation.');return service.plan(host,provider,p.operation);}
        if(p.confirm!==true)throw Error('请先预览并确认本次 CLI 维护。');
        this.assertRemoteMaintenance(host,provider);
        if(provider==='claude'&&this.actions.remoteBrowser?.busy(host))throw Error('此 VPS 仍有 Claude 浏览器登录在进行。');
        if(this.store.snapshot().hosts.some(h=>this.maintenanceKey(h,provider)===key&&this.codexLoginActive(h)))throw Error('此服务器还有账号操作，请先结束。');
        if(this.store.snapshot().hosts.some(h=>this.maintenanceKey(h,provider)===key&&this.shared?.native?.memory?.background.busy(h.id))||this.store.snapshot().sessions.some(s=>{const h=this.store.snapshot().hosts.find(h=>h.id===s.binding.hostId);return h&&this.maintenanceKey(h,provider)===key&&s.binding.runtime===provider&&(s.status==='running'||s.status==='uncertain'||this.gate.hasPending(s.id)||this.sessionOperations.has(s.id));}))throw Error('此运行时有运行中、待发送或结果未知的会话，请先处理。');
        this.remoteMaintenance.add(key);
        try{const result=await service.apply(host,required(p.planId,'维护计划'),provider);if(hostIdentity(this.host(host.id))!==identity)throw Error('连接已变化，请重新检查远端状态。');return result;}
        finally{this.remoteMaintenance.delete(key);}
      }
      case 'accounts/rename':return this.accountNames.rename(p.id,p.accountId,p.generation,p.name,p.revision);
      case 'accounts/list':case 'codex-auth/account':{const host=this.codexLoginHost(p.id);if(this.accountOperations.has(host.id))throw new Error('该工作空间的账号操作正在进行，请等待回执。');return this.readAccountCatalog(host);}
      case 'accounts/setup-plan':case 'accounts/setup-apply':{
        const host=this.codexLoginHost(p.id),identity=hostIdentity(host),service=this.actions.accountSetup;
        if(host.role!=='admin'||host.username!=='root')throw Error('请从 root 管理入口准备统一账号服务。');
        if(!service)throw Error('统一账号服务准备工具不可用。');
        if(this.codexLoginActive(host))throw Error('此连接有账号操作正在进行，请等待完成。');
        if(method==='accounts/setup-apply'&&p.confirm!==true)throw Error('请先预览并确认统一账号服务接入计划。');
        this.accountOperations.add(host.id);
        try{
          const result=method==='accounts/setup-plan'?await service.plan(host):await service.apply(host,required(p.planId,'接入计划'));
          if(hostIdentity(this.host(host.id))!==identity)throw Error('连接身份已变化，请在原连接重新核实服务状态。');
          if(result.status==='ready')await this.readAccountCatalog(host);
          return result;
        }finally{this.accountOperations.delete(host.id);}
      }
      case 'accounts/enroll-legacy':{
        const host=this.codexLoginHost(p.id),identity=hostIdentity(host),service=this.actions.nativeAccounts;
        if(host.role!=='admin'||host.username!=='root'||!service?.enrollLegacy)throw Error('请从管理员入口接入原账号。');
        if(p.confirm!==true)throw Error('请先核对原账号并确认集中接入。');
        if(this.codexLoginActive(host))throw Error('此连接有账号操作正在进行，请等待完成。');
        const accountId=required(p.accountId,'原账号'),expected=this.store.snapshot().accountCatalogs?.[host.id];
        const previous=expected?.legacy?.accounts.find(a=>a.id===accountId);
        if(expected?.source!=='native-owner'||expected.availability!=='ready'||!previous?.email)throw Error('请先准备统一服务并重新读取原账号。');
        this.accountOperations.add(host.id);
        try{
          const old=await this.accountCatalog.list(host,'existing-codex');
          const fresh=old.accounts.find(a=>a.id===accountId);
          if(hostIdentity(this.host(host.id))!==identity||old.source!=='existing-codex'||old.availability!=='ready'||old.authorityId!==expected.legacy?.authorityId||old.generation!==expected.legacy.generation||!fresh||fresh.generation!==previous.generation||fresh.email!==previous.email)throw Error('原账号身份已变化，请重新读取。');
          const result=await service.enrollLegacy(host,expected,old,accountId);
          if(hostIdentity(this.host(host.id))!==identity)throw Error('连接身份已变化，请重新核实账号接入结果。');
          await this.readAccountCatalog(host);return result;
        }finally{this.accountOperations.delete(host.id);}
      }
      case 'native-accounts/status':case 'native-accounts/review':case 'native-accounts/create-claude':case 'native-accounts/login-command':{
        const host=this.codexLoginHost(p.id),identity=hostIdentity(host),catalog=this.store.snapshot().accountCatalogs?.[host.id],service=this.actions.nativeAccounts;
        if(!service||catalog?.source!=='native-owner'||catalog.availability!=='ready')throw Error('请先准备并读取统一原生账号服务。');
        if(method!=='native-accounts/status'&&host.role!=='admin')throw Error('请从管理员入口管理原生登录。');
        const accountId=method==='native-accounts/create-claude'?undefined:required(p.accountId,'账号标识');
        const generation=accountId?catalog.accounts.find(a=>a.id===accountId)?.generation:undefined;
        if(accountId&&!generation)throw Error('此账号不在当前授权目录中。');
        const result=method==='native-accounts/create-claude'?await service.createClaude(host,catalog):method==='native-accounts/login-command'?await service.loginCommand(host,catalog,accountId!):await service.status(host,catalog,accountId!,method==='native-accounts/review');
        const assertIdentity=()=>{const latest=this.store.snapshot().accountCatalogs?.[host.id];
        if(hostIdentity(this.host(host.id))!==identity||latest?.source!=='native-owner'||latest.availability!=='ready'||latest.authorityId!==catalog.authorityId||latest.generation!==catalog.generation||accountId&&latest.accounts.find(a=>a.id===accountId)?.generation!==generation)throw Error('连接或账号身份已变化，请重新读取。');};
        assertIdentity();
        if(method!=='native-accounts/login-command')await this.readAccountCatalog(host);
        assertIdentity();
        return result;
      }
      case 'accounts/usage':case 'accounts/reset-preview':case 'accounts/reset-redeem':{
        const host=this.codexLoginHost(p.id),identity=hostIdentity(host),service=this.actions.accountUsage;
        if(!service)throw Error('额度管理服务不可用。');
        const catalog=this.store.snapshot().accountCatalogs?.[host.id];if(!catalog)throw Error('请先刷新账号目录。');
        let result:unknown;
        if(method==='accounts/usage'){const usage=await service.read(host,catalog,required(p.accountId,'账号标识'),{refresh:p.refresh===true,cacheOnly:p.cacheOnly===true,revision:hashText(modelUsageRevision(this.store.snapshot(),{kind:'account',id:catalog.accounts.find(a=>a.id===p.accountId)?sharedAccountRef(catalog,catalog.accounts.find(a=>a.id===p.accountId)!):String(p.accountId)}))});if(p.cacheOnly!==true&&this.actions.quotaAccounting)try{usage.ledger=await this.actions.quotaAccounting.read(host,catalog,usage,p.refresh===true);}catch{usage.ledgerReason='配给账本暂未同步；原生账号额度仍按本次读取显示。';}result=usage;}
        else if(method==='accounts/reset-preview')result=await service.prepare(host,catalog,required(p.accountId,'账号标识'),required(p.cardKey,'重置卡标识'));
        else {if(p.confirm!==true)throw Error('请确认本次重置卡兑换。');result=await service.redeem(host,catalog,required(p.planId,'兑换标识'));}
        if(hostIdentity(this.host(host.id))!==identity)throw Error('连接已变化，请重新读取账号。');
        return result;
      }
      case 'accounts/set-enabled':{
        const host=this.codexLoginHost(p.id),identity=hostIdentity(host),catalog=this.store.snapshot().accountCatalogs?.[host.id],service=this.accountCatalog;
        if(!catalog||catalog.source!=='native-owner'||catalog.availability!=='ready'||!service?.setEnabled||typeof p.enabled!=='boolean'||!Number.isSafeInteger(p.expectedRevision))throw Error('账号启停服务不可用，请刷新。');
        const account=catalog.accounts.find(a=>a.id===p.accountId&&a.generation===p.accountGeneration);if(!account)throw Error('账号身份已变化，请刷新。');
        await service.setEnabled(host,{authorityId:catalog.authorityId,generation:catalog.generation,accountId:account.id,accountGeneration:account.generation,expectedRevision:p.expectedRevision as number,enabled:p.enabled});
        if(hostIdentity(this.host(host.id))!==identity)throw Error('连接已变化，请刷新。');
        // Read each sibling through its own SSH membership; never copy an admin catalog into a workspace.
        for(const other of this.store.snapshot().hosts){const c=this.store.snapshot().accountCatalogs?.[other.id];if(c?.authorityId===catalog.authorityId&&c?.generation===catalog.generation)await this.readAccountCatalog(other);}
        return this.store.snapshot().accountCatalogs?.[host.id];
      }
      case 'accounts/assign':throw Error('账号使用权已统一到工作空间管理，请在那里保存分配。');
      case 'accounts/select':{
        const host=this.codexLoginHost(p.id);if(host.role!=='workspace')throw new Error('管理员可管理共享账号，请进入具体工作空间选择账号。');
        const provider=p.provider===undefined?'codex':p.provider;if(provider!=='codex'&&provider!=='claude')throw Error('不支持的账号厂商。');
        if(this.codexLoginActive(host))throw new Error('请先结束当前账号操作或确认取消清理。');
        const catalog=this.store.snapshot().accountCatalogs?.[host.id];
        const accountId=required(p.accountId,'共享账号ID',256),expectedRevision=integer(p.expectedRevision,0,Number.MAX_SAFE_INTEGER,'选择版本');
        if(!catalog||catalog.availability!=='ready')throw new Error('请先读取可用的 VPS 共享账号目录。');
        if((provider==='claude'?catalog.claudeSelectionRevision??0:catalog.selectionRevision)!==expectedRevision)throw new Error('该工作空间的账号选择版本已变化，请刷新后再选择。');
        if(!catalog.accounts.some(account=>account.id===accountId&&account.provider===provider&&usableSharedAccount(account)))throw new Error('所选账号不可用，不能自动换用其他账号。');
        this.accountOperations.add(host.id);this.catalogEpochs.set(host.id,(this.catalogEpochs.get(host.id)??0)+1);
        try{
          const result=await this.accountCatalog.select(host,{accountId,expectedRevision,authorityId:catalog.authorityId,generation:catalog.generation});
          if(result.availability!=='ready'||result.authorityId!==catalog.authorityId||result.generation!==catalog.generation||result.workspaceId!==catalog.workspaceId||(provider==='claude'?result.selectedClaudeAccountId:result.selectedAccountId)!==accountId)throw new Error('远端账号选择回执与请求不一致，请重新读取实际选择。');
          await this.update(s=>{const current=s.hosts.find(item=>item.id===host.id);if(!current||hostIdentity(current)!==hostIdentity(host))throw new Error('选择期间连接身份已变更，旧结果已丢弃。');s.accountCatalogs??={};s.accountCatalogs[host.id]=result;});return result;
        }catch(error){await this.update(s=>{const current=s.hosts.find(item=>item.id===host.id);if(current&&hostIdentity(current)===hostIdentity(host)&&s.accountCatalogs?.[host.id])s.accountCatalogs[host.id]={...s.accountCatalogs[host.id]!,availability:'unavailable',reason:'selection-unconfirmed'};});throw error;}
        finally{this.accountOperations.delete(host.id);}
      }
      case 'codex-auth/start':{
        this.assertRemoteMaintenance(this.host(p.id),'codex');
        const host=this.codexLoginHost(p.id);if(this.codexLoginActive(host))throw new Error('请先结束当前账号操作或确认取消清理。');
        if(host.role!=='admin')throw new Error('账号由 VPS 管理员统一授权，请在此工作空间选择已分配的账号。');
        if(this.store.snapshot().sessions.some(session=>session.binding.hostId===host.id&&session.binding.runtime==='codex'&&(session.status==='running'||session.status==='uncertain')))throw new Error('该工作空间有运行中或结果未知的 Codex 会话，请先确认其状态。');
        this.accountOperations.add(host.id);
        try{const catalog=await this.readAccountCatalog(host);if(catalog.availability!=='ready')throw new Error('VPS 共享账号服务尚不可用，不会退回各工作空间重复授权。');const job=await this.accountCatalog.start(host);this.codexAuthJobs.set(host.id,{host:structuredClone(host),jobId:job.jobId,value:job,requestEpoch:0,cancelRequested:false});return job;}
        finally{this.accountOperations.delete(host.id);}
      }
      case 'codex-auth/status':{const host=this.codexLoginHost(p.id);return this.codexJob(host,p.jobId);}
      case 'codex-auth/current':{const host=this.codexLoginHost(p.id);const saved=this.codexAuthJobs.get(host.id);return saved&&hostIdentity(saved.host)===hostIdentity(host)&&this.codexLoginActive(host)?structuredClone(saved.value):null;}
      case 'codex-auth/cancel':{
        const host=this.codexLoginHost(p.id),jobId=required(p.jobId,'登录任务ID'),saved=this.codexAuthJobs.get(host.id);
        if(!saved||saved.jobId!==jobId||hostIdentity(saved.host)!==hostIdentity(host))throw new Error('登录任务与当前连接不一致。');
        if(saved.value.cleanup==='confirmed'&&!['preparing','awaiting-code','verifying'].includes(saved.value.state))return structuredClone(saved.value);
        saved.requestEpoch++;saved.cancelRequested=true;
        if(['preparing','awaiting-code','verifying'].includes(saved.value.state))saved.value={...saved.value,state:'cancelled',cleanup:'unconfirmed'};
        delete saved.value.userCode;delete saved.value.verificationUrl;
        const value=await this.accountCatalog.cancel(host,jobId);
        if(this.codexAuthJobs.get(host.id)===saved){if(value.cleanup==='confirmed'||saved.value.cleanup!=='confirmed')saved.value=value;}
        return structuredClone(saved.value);
      }
      case 'codex-auth/open':{
        const host=this.codexLoginHost(p.id);const job=await this.codexJob(host,p.jobId);
        if(job.state!=='awaiting-code'||job.verificationUrl!=='https://auth.openai.com/codex/device'||!job.userCode||Date.parse(job.expiresAt)<=Date.now())throw new Error('当前没有可打开的有效 Codex 设备授权。');
        if(!this.actions.openExternal)throw new Error('当前环境不支持打开外部浏览器。');
        await this.actions.openExternal('https://auth.openai.com/codex/device');return null;
      }
      case 'navigation/open':{const session=this.session(p.sessionId);if(!this.actions.openSession)throw Error('SESSION_NAVIGATION_UNAVAILABLE');this.actions.openSession(session.id);return {sessionId:session.id};}
      case 'navigation/get':return {sessionId:this.actions.getNavigation?.()??null};
      case 'navigation/view':{const id=p.sessionId===null?null:this.session(p.sessionId).id;this.viewedSessionId=id;if(id){const worktree=this.session(id).worktree;if(worktree)await this.actions.worktrees?.touch(worktree.id);}return {sessionId:id};}
      case 'deep-link/copy':{const session=this.session(p.sessionId);const link=threadDeepLink(session.id);this.actions.copy(link);return link;}
      case 'memory/get':return this.sharedStores().memory.status();
      case 'memory/settings':return this.sharedStores().memory.setEnabled(flag(p.enabled,'记忆开关'));
      case 'memory/list':return this.sharedStores().memory.list();
      case 'memory/save':return this.sharedStores().memory.saveNote({id:p.id===undefined?undefined:required(p.id,'记忆ID'),title:required(p.title,'记忆标题',200),content:text(p.content,'记忆正文',64000),summary:p.summary===undefined?undefined:text(p.summary,'摘要',4000),tags:p.tags===undefined?undefined:stringArray(p.tags,'标签',30,100),sessionId:p.sessionId===undefined?undefined:this.session(p.sessionId).id,expectedHash:p.expectedHash===undefined?undefined:required(p.expectedHash,'版本摘要',64)});
      case 'memory/delete':await this.sharedStores().memory.removeNote(required(p.id,'记忆ID'),required(p.expectedHash,'版本摘要',64));return null;
      case 'skills/list':return this.sharedStores().skills.listMetadata();
      case 'skills/read':return this.sharedStores().skills.readMarkdown(required(p.id,'技能ID'),required(p.expectedHash,'技能版本',64));
      case 'skills/import':{const file=await this.actions.pickSkill?.();return file?this.sharedStores().skills.importFile(file):null;}
      case 'skills/delete':await this.sharedStores().skills.remove(required(p.id,'技能ID'),required(p.expectedHash,'版本摘要',64));return null;
      case 'session/skills':throw new Error('技能属于全局共享库，无需也不再支持在创建会话时逐项绑定。');
      case 'composer/catalog': {
        const session=p.sessionId===undefined?undefined:this.session(p.sessionId);
        const runtime=session?.binding.runtime??p.runtime;
        if(typeof runtime!=='string'||!['codex','claude','api','demo'].includes(runtime)&&!isPluginRuntime(runtime))throw Error('COMPOSER_RUNTIME_INVALID');
        if(p.runtime!==undefined&&p.runtime!==runtime)throw Error('COMPOSER_SCOPE_CHANGED');
        const directory=session?session.projectPath:(typeof p.projectPath==='string'?p.projectPath:undefined),targetId=session?session.modelTargetId:(typeof p.targetId==='string'?p.targetId:undefined);
        const scope=composerScopeKey({runtime,sessionId:session?.id,directory,targetId});
        if(p.scope!==undefined&&p.scope!==scope)throw Error('COMPOSER_SCOPE_CHANGED');
        const extension=isPluginRuntime(runtime)?this.pluginRuntimes.registry.get(runtime).catalog:undefined;
        const skills=this.shared?.native&&['codex','claude'].includes(runtime)?composerSkills(await this.shared.native.skills.scan(),runtime,directory):[];
        if(session){const current=this.session(session.id);if(scope!==composerScopeKey({runtime:current.binding.runtime,sessionId:current.id,directory:current.projectPath,targetId:current.modelTargetId}))throw Error('COMPOSER_SCOPE_CHANGED');}
        const compact=!!session&&localModelBinding(session.binding)&&['codex','claude'].includes(runtime)&&!!this.nativeProvider;
        let compactDisabledReason:string|undefined;
        if(compact){try{this.assertModelIdle(this.session(session!.id));this.nativeProvider!.assertCompactAllowed(this.session(session!.id));}catch{compactDisabledReason=!session?.binding.nativeSessionId?'先发送一条消息，建立原生会话':session?.handoffFromMessage!==undefined?'先发送新消息，让当前运行时接收交接历史':'当前任务、预览或运行时尚未就绪';}}
        return {runtime,scope,commands:composerCommands(runtime,{compact,compactDisabledReason,model:!!extension?.models?.length,permissions:!!extension?.permissions.length}),skills,nativeDiscovery:['codex','claude'].includes(runtime)};
      }
      case 'composer/execute': {
        const session=this.session(p.sessionId),scope=composerScopeKey({runtime:session.binding.runtime,sessionId:session.id,directory:session.projectPath,targetId:session.modelTargetId});
        if(p.scope!==scope)throw Error('COMPOSER_SCOPE_CHANGED');
        if(p.commandId!=='compact')throw Error('COMPOSER_COMMAND_UNSUPPORTED');
        if(!this.nativeProvider||!localModelBinding(session.binding))throw Error('COMPOSER_COMMAND_UNAVAILABLE');
        this.assertModelIdle(session);this.assertDraftRuntime(session);this.nativeProvider.assertCompactAllowed(session);
        return this.withSessionOperation(session.id,()=>this.nativeProvider!.compact(session.id));
      }
      case 'session/memory-handoff/read': return this.readMemoryHandoff(this.session(p.sessionId),object(p.query??{}));
      case 'session/context':return this.contextSnapshot(this.session(p.sessionId));
      case 'session/skills/read':{
        const session=this.session(p.sessionId);const snapshot=this.skillDiscovery.get(session.id);if(!snapshot)throw new Error('先读取此会话的共享技能目录，再按需加载完整说明。');
        if(!isFrameworkSnapshot(snapshot))throw new Error('此共享技能目录已失效，请重新建立可用上下文后再读取。');
        const id=required(p.id,'技能ID'),expectedHash=required(p.expectedHash,'技能版本',64);
        const entry=snapshot.items.find(item=>item.kind==='skill-catalog');const catalog=entry?JSON.parse(entry.content) as {entries:{id:string;hash:string}[]}:null;
        if(!catalog?.entries.some(skill=>skill.id===id&&skill.hash===expectedHash))throw new Error('技能或版本不在此会话已发现的目录中。');
        const result=await (this.shared?.native?.skills??this.sharedStores().skills).readMarkdown(id,expectedHash);
        if(!isFrameworkSnapshot(snapshot)||this.skillDiscovery.get(session.id)!==snapshot)throw new Error('读取期间共享技能目录发生变更；旧结果已丢弃。');
        return result;
      }
      case 'capabilities/get':return [
        {id:'translation',label:'独立翻译与双栏',status:'implemented',detail:'三协议适配、受保护片段、输入预览、明确提交；真实服务质量须使用你的独立配置验收。'},
        {id:'credentials',label:'凭据隔离',status:'implemented',detail:'翻译密钥由系统加密保存；不读取原生 CLI token。'},
        {id:'environment',label:'原生执行环境',status:'implemented',detail:'核实 SSH 成员与本机执行器绑定，不再采集或注入远端环境投影。'},
        ...this.actions.nativeCapabilities(),
        {id:'isolation',label:'强隔离 / 自动 VM 物化',status:'unverified',detail:'仅有计划生成，尚未部署和防旁路验收；不能宣称 isolated。'},
        {id:'quota',label:'账号额度 / 重置卡',status:'implemented',detail:'Codex 原生额度与卡片明细已只读验证；兑换明确确认并复用持久化幂等标识，未知值不显示为零。'},
        {id:'generic',label:'通用 Agent / 多 Agent 讨论组',status:'unsupported',detail:'按原需求保留为 P2 / P3，不以第三方翻译器冒充 Agent。'}
      ] satisfies Capability[];
      case 'links/open':{const url=webReference(required(p.url,'网站地址',8192));if(!url||!this.actions.openWeb)throw Error('只能打开有效的 HTTP 或 HTTPS 网站。');await this.actions.openWeb(url);return null;}
      case 'files/resolve':{
        const session=p.sessionId===undefined?undefined:this.session(p.sessionId),requested=p.path===undefined?undefined:required(p.path,'文件路径',4096);
        let cwd=session?.projectPath??'';
        if(session&&cwd&&(!requested||samePath(path.resolve(cwd,requested),cwd)))cwd=await this.sessionWorkspace(session);
        const project=session?.projectId?this.store.snapshot().projects.find(item=>item.id===session.projectId):undefined;
        return this.fileNavigation.locate({...fileResolutionContext(session,project),cwd,requested});
      }
      case 'files/browse':{
        const session=p.sessionId===undefined?undefined:this.session(p.sessionId),requested=p.path===undefined?undefined:required(p.path,'文件路径',4096);
        let cwd=session?.projectPath??'';
        if(session&&cwd&&(!requested||samePath(path.resolve(cwd,requested),cwd)))cwd=await this.sessionWorkspace(session);
        return browseFile(cwd,await this.fileTarget(session,requested,cwd));
      }
      case 'files/reveal':{const session=p.sessionId===undefined?undefined:this.session(p.sessionId);const target=await this.fileTarget(session,required(p.path,'文件路径',4096));if(!this.actions.revealPath)throw Error('文件定位不可用。');return this.actions.revealPath(await resolveBrowsePath('',target));}
      case 'files/info': case 'files/open': case 'files/copy-content': case 'files/save-as': {
        const session=p.sessionId===undefined?undefined:this.session(p.sessionId), service=this.actions.fileActions;
        if(!service)throw Error('当前宿主没有文件操作服务。');
        const cwd=session?.projectPath??'', target=await this.fileTarget(session,required(p.path,'文件路径',4096));
        if(method==='files/info')return service.info(cwd,target);
        if(method==='files/open')return service.open(cwd,target,required(p.target,'打开方式',32));
        if(method==='files/copy-content')return service.copyContent(cwd,target);
        return service.saveAs(cwd,target);
      }
      case 'session/open-workspace':return this.openSessionWorkspace(this.session(p.sessionId),p.path);
      case 'path/open':{
        if(p.sessionId!==undefined)return this.openSessionWorkspace(this.session(p.sessionId),p.path);
        const id=required(p.projectId,'项目ID');const state=this.store.snapshot();const project=id===RECENT_PROJECT_ID?recentProject(state):state.projects.find(x=>x.id===id);if(!project?.path)throw new Error('此项目没有本机目录。');const target=absolutePath(p.path??project.path);const allowed=[...(project.paths??[project.path]),...state.sessions.filter(session=>session.projectId===projectSessionId(id)).map(session=>session.projectPath??'')];if(!allowed.some(folder=>folder&&samePath(folder,target)))throw new Error('该路径没有关联到此项目或会话。');if(!(await stat(target)).isDirectory())throw new Error('项目目录已不可用；不会执行文件。');await this.actions.openPath(target);return null;
      }
      case 'clipboard/write':await this.actions.copy(text(p.text,'复制内容',1000000));return null;
      default:throw new Error('不允许的 IPC 方法。');
    }
  }
  private async fileTarget(session:Session|undefined,requested?:string,cwd=session?.projectPath??''):Promise<string>{
    const state=this.store.snapshot(),project=session?.projectId?state.projects.find(item=>item.id===session.projectId):undefined;
    const target=await this.fileNavigation.resolve({...fileResolutionContext(session,project),cwd,requested});
    const line=requested?fileReference(requested)?.line:undefined;
    return target+(line?':'+line:'');
  }
  private async callStudio(method:string,p:Record<string,unknown>):Promise<unknown>{
    const service=this.actions.workspaceManagement;if(!service)throw new Error('当前主进程没有工作空间管理服务。');
    if(method==='studio/import-preview')return service.importPreview();
    if(method==='studio/prepare'){
      if(p.confirm!==true)throw Error('请确认准备此成员工作空间及缺失的本机官方工具。');
      const member=this.host(p.id);if(member.role!=='workspace'||member.username.toLowerCase()==='root')throw Error('管理员身份不能准备成员工作会话。');
      return {...member,preparation:await this.prepareWorkspace(member)};
    }
    if(method==='studio/import'){
      if(p.confirm!==true)throw new Error('请先确认邀请中的 VPS 和工作空间。');
      const imported=await service.import(required(p.previewId,'邀请预览ID'),p.deviceLabel===undefined?'本机设备':required(p.deviceLabel,'设备名称',100));
      if(this.disposing)throw new Error('工作台正在退出；本机设备导入记录已保留，请重开后再次导入。');
      validateSshHost(imported);if(imported.role!=='workspace'||imported.username.toLowerCase()==='root')throw new Error('邀请不能导入管理员工作身份。');
      await this.update(s=>{const existing=s.hosts.find(h=>h.id===imported.id);if(existing&&hostIdentity(existing)!==hostIdentity(imported))throw new Error('已有连接与导入身份不一致；未覆盖现有会话绑定。');if(!existing)s.hosts.push(imported);s.activeWorkspaceId=imported.id;this.workspaceSelectionEpoch++;});
      // The remote administrator owns account selection and runtime setup. Read
      // the public catalog immediately so an imported device has the same
      // managed Claude target without a second account/configuration step.
      return {...imported,preparation:await this.prepareWorkspace(imported)};
    }
    const host=this.host(p.id);if(host.role!=='admin')throw new Error('请从 VPS 管理员入口管理工作空间。');
    const identity=hostIdentity(host);
    const unchanged=()=>{const current=this.store.snapshot().hosts.find(h=>h.id===host.id);if(!current||hostIdentity(current)!==identity)throw new Error('管理员连接已变更；请重新读取远端状态。');};
    if(method==='studio/export-connection'){
      const member=this.host(p.memberId);if(member.role!=='workspace'||member.username==='root'||member.hostname!==host.hostname||member.port!==host.port||member.ownerId!==host.ownerId||!service.exportConnection)throw new Error('请选择此管理员下的成员工作空间。');
      const result=await service.exportConnection(host,member,workspaceExportTtl(p.ttlSeconds));unchanged();return result;
    }
    if(method==='studio/list'){const result=await service.list(host);unchanged();if(result.availability==='ready'&&result.sshOnlyMembers?.length)await this.update(s=>retireSshOnlyConnections(s,host,result.sshOnlyMembers!));return result;}
    if(method==='studio/export-managed'){
      if(!service.exportManaged)throw Error('邀请导出服务不可用。');
      const result=await service.exportManaged(host,required(p.workspaceId,'工作空间ID'),workspaceExportTtl(p.ttlSeconds));unchanged();return result;
    }
    if(method==='studio/connect'){
      if(p.confirm!==true||!service.connect)throw Error('请确认将工作空间连接到本机。');
      const workspaceId=required(p.workspaceId,'工作空间ID'),snapshot=await service.list(host);unchanged();
      const workspace=snapshot.workspaces.find(item=>item.id===workspaceId&&item.status==='active'&&item.controlState!=='recovery-required');if(!workspace)throw Error('工作空间当前不可连接。');
      const existing=this.store.snapshot().hosts.find(item=>item.role==='workspace'&&item.hostname===host.hostname&&item.port===host.port&&item.ownerId===host.ownerId&&item.username===workspace.username);
      if(existing){await (this.actions.verifyWorkspaceMember??verifyWorkspaceMember)(existing);unchanged();await this.update(s=>{s.activeWorkspaceId=existing.id;this.workspaceSelectionEpoch++;});await this.readAccountCatalog(existing);return existing;}
      const member=await service.connect(host,workspaceId);unchanged();validateSshHost(member);
      if(member.role!=='workspace'||member.username==='root')throw Error('无效成员身份。');
      await this.update(s=>{if(!s.hosts.some(item=>item.id===member.id))s.hosts.push(member);s.activeWorkspaceId=member.id;this.workspaceSelectionEpoch++;});await this.readAccountCatalog(member);return member;
    }
    if(method==='studio/plan'){
      const result=await service.plan(host,{expectedRevision:integer(p.expectedRevision,0,Number.MAX_SAFE_INTEGER,'管理版本'),operation:required(p.operation,'管理操作') as StudioOperation,...(p.workspaceId===undefined?{}:{workspaceId:required(p.workspaceId,'工作空间ID')}),...(p.values===undefined?{}:{values:object(p.values)})});unchanged();return result;
    }
    if(method==='studio/apply'){
      if(p.confirm!==true)throw new Error('请确认具体变更预览后再执行。');
      const result=await service.apply(host,required(p.planId,'计划ID'),required(p.planHash,'计划摘要'));
      unchanged();await this.update(s=>{for(const item of s.hosts)if(item.hostname.toLowerCase()===host.hostname.toLowerCase()&&item.port===host.port&&item.ownerId===host.ownerId&&s.accountCatalogs)delete s.accountCatalogs[item.id];retireDeletedWorkspace(s,host,result);});return result;
    }
    if(method==='studio/operation'){
      const result=await service.operation(host,required(p.operationId,'操作ID'));unchanged();
      if(result.state==='applied'&&result.workspace?.status==='deleted'){
        const current=await service.list(host);unchanged();const removed=result.workspace;
        if(current.availability==='ready'&&current.workspaces.some(w=>w.id===removed.id&&w.generation===removed.generation&&w.status==='deleted')&&!current.workspaces.some(w=>w.username===removed.username&&w.status!=='deleted'))await this.update(s=>retireDeletedWorkspace(s,host,result));
      }
      return result;
    }
    if(method==='studio/invite-export'){const result=await service.exportInvite(host,required(p.inviteExportId,'邀请导出ID'));unchanged();return result;}
    throw new Error('不允许的工作空间管理方法。');
  }
  private assertSidebarMutationBoundary(session:Session,allowUncertain=false){
    if((session.status!=='idle'&&session.status!=='blocked'&&!(allowUncertain&&session.status==='uncertain'))||this.forking.has(session.id)||this.sessionOperations.has(session.id)||this.activeTurns.has(session.id)||this.permissionChanges.has(session.id)||this.modelSwitching.has(session.id)||this.gate.hasPending(session.id)||this.nativeCodex?.busy(session.id)||this.apiRunner.busy(session.id)||this.nativeProvider?.busy(session.id)||this.pluginRuntimes.busy(session.id)||[...this.activeTranslations.keys()].some(key=>key.startsWith(session.id+':')))throw new Error('该会话仍在处理或结果未知，请完成当前操作后再归档或删除。');
  }
  hasActiveSessionWork(){return this.configurationMaintenance.size>0||this.translationModule.busy()||this.translationTargets.busy()||this.translationNative.busy()||this.localAccounts.busy()||!!this.shared?.native?.memory?.background.busy()||this.worktreeMaintenance||this.sessionOperations.size>0||this.activeTurns.size>0||this.forking.size>0||this.modelSwitching.size>0||this.store.snapshot().sessions.some(s=>this.pluginRuntimes.busy(s.id)||this.apiRunner.busy(s.id)||!!this.nativeProvider?.hasTransport(s.id));}
  private async withSessionOperation<T>(sessionId:string,operation:()=>Promise<T>):Promise<T>{
    if(this.worktreeMaintenance)throw Error('WORKTREE_BUSY');
    if(this.modelSwitching.has(sessionId))throw Error('模型正在切换。');
    if(!isPluginRuntime(this.session(sessionId).binding.runtime)&&this.session(sessionId).binding.runtime!=='api'&&this.shared?.native?.cli.isMaintaining())throw Error('CLI 正在安装、更新或卸载，请完成后再开始任务。');
    if(this.forking.has(sessionId))throw new Error('分支正在创建，请稍后继续。');
    if(this.permissionChanges.has(sessionId))throw new Error('权限模式正在保存，请稍后再发送。');
    this.sessionOperations.set(sessionId,(this.sessionOperations.get(sessionId)??0)+1);
    try{const worktree=this.session(sessionId).worktree;if(worktree){if(!this.actions.worktrees)throw Error('WORKTREES_UNAVAILABLE');await this.actions.worktrees.validate(worktree);await this.actions.worktrees.touch(worktree.id);}return await operation();}finally{const remaining=(this.sessionOperations.get(sessionId)??1)-1;if(remaining)this.sessionOperations.set(sessionId,remaining);else this.sessionOperations.delete(sessionId);this.followUps.observe();}
  }
  private host(id:unknown){const key=required(id,'连接ID');const host=this.store.snapshot().hosts.find(x=>x.id===key);if(!host)throw new Error('连接不存在。');return host;}
  private async readMemoryHandoff(session:Session,query:Record<string,unknown>){
    const runtime=session.binding.runtime;if(!this.shared?.native||runtime!=='codex'&&runtime!=='claude')throw Error('MEMORY_HANDOFF_UNAVAILABLE');
    throw Error('MEMORY_HANDOFF_BACKGROUND_ONLY');
  }
  private async resolveComposerSkills(session:Session,value:unknown){
    if(value===undefined||Array.isArray(value)&&!value.length)return [];
    if(!this.shared?.native)throw Error('SKILL_SELECTION_UNAVAILABLE');
    return resolveSkills(composerSkills(await this.shared.native.skills.scan(),session.binding.runtime,session.projectPath),value);
  }
  private async contextSnapshot(session:Session){if(this.shared?.native){const snapshot=await this.shared.native.context(session);this.skillDiscovery.set(session.id,snapshot);return snapshot;}return combineSharedContextSnapshots(await this.sharedStores().memory.createSnapshot({sessionId:session.id}),await this.discoverSkills(session));}
  private sharedStores(){if(!this.shared)throw new Error('共享记忆与技能存储尚未初始化。');return this.shared;}
  private async discoverSkills(session:Session){
    const existing=this.skillDiscovery.get(session.id);if(existing&&(isFrameworkSnapshot(existing)||session.messages.length>0))return existing;
    const pending=this.skillDiscoveryPending.get(session.id);if(pending)return pending;
    const operation=this.sharedStores().skills.createDiscoverySnapshot({sessionId:session.id}).then(snapshot=>{this.skillDiscovery.set(session.id,snapshot);return snapshot;}).finally(()=>{this.skillDiscoveryPending.delete(session.id);});
    this.skillDiscoveryPending.set(session.id,operation);return operation;
  }
  private async runDemo(sessionId:string,preview:DraftPreview){
    const lease=this.leases.acquire(sessionId,'desktop-main');
    this.ledger.begin(preview.id,{sourceHash:preview.sourceHash,submitted:preview.translated},lease);
    const abort=new AbortController();this.activeTurns.set(sessionId,abort);
    const user:Message={id:preview.id,role:'user',original:preview.original,submitted:preview.translated,annotations:preview.annotations,attachments:preview.attachments,draftRevisions:preview.revisions,demo:true,timestamp:new Date().toISOString()};
    const assistant:Message={id:randomUUID(),role:'assistant',original:DEMO_FINAL,progress:DEMO_PROGRESS,demo:true,timestamp:new Date().toISOString(),translationStatus:'off'};
    const state=this.store.snapshot();const translateFinal=translationEnabled(state)&&!this.session(sessionId).agentParent,translateProgress=translateFinal&&state.translateIntermediate!==false;
    if(preview.demo){if(translateFinal){assistant.translation=DEMO_FINAL_ZH;assistant.translationStatus='complete';assistant.translationSource='离线固定译文 · 无模型调用';}if(translateProgress)assistant.progressTranslation=DEMO_PROGRESS_ZH;}
    try{
      await this.update(s=>{const session=s.sessions.find(x=>x.id===sessionId)!;session.status='running';session.messages.push(user);delete session.forkDraft;delete session.forkAttachments;if(session.messages.length===1&&session.title==='新的双语任务')sessionPresentation.fallback(session,(preview.original||preview.attachments?.[0]?.name||'附件').slice(0,28));});
      try{await delay(450,undefined,{signal:abort.signal});}catch(error){if(!abort.signal.aborted)throw error;assistant.original='Offline demonstration stopped. No files or tools were executed.';assistant.translation='离线演示已停止。没有执行文件操作或工具。';assistant.translationStatus='complete';assistant.translationSource='离线停止状态 · 无模型调用';assistant.progress=undefined;assistant.progressTranslation=undefined;}
      this.activeTurns.delete(sessionId);
      await this.update(s=>{const session=s.sessions.find(x=>x.id===sessionId)!;if(!translationEnabled(s)){assistant.translation=undefined;assistant.progressTranslation=undefined;assistant.translationSource=undefined;assistant.translationStatus='off';}session.messages.push(assistant);session.status='idle';});
      this.ledger.acknowledge(preview.id,assistant.id,lease);
    }catch(error){this.ledger.uncertain(preview.id);await this.update(s=>{const session=s.sessions.find(x=>x.id===sessionId);if(session)session.status='uncertain';}).catch(()=>{});throw error;}
    finally{this.activeTurns.delete(sessionId);this.leases.release(lease);}
    if(!preview.demo&&!abort.signal.aborted&&this.translationModule.enabled()){
      const jobs:Promise<unknown>[]=[];
      if(translateFinal)jobs.push(this.translateMessage(sessionId,assistant));
      if(translateProgress)jobs.push(this.translateProgress(sessionId,assistant));
      void Promise.allSettled(jobs);
    }
  }
  private async translateProgress(sessionId:string,message:Message){
    if(this.session(sessionId).agentParent||!message.progress||this.store.snapshot().translateIntermediate===false)return;
    const delivery=await this.translationModule.translate(message.progress,'output',`${sessionId}:${message.id}:progress`,'progress',undefined,sessionId);
    await this.update(state=>{this.translationModule.assertCurrent(delivery.policy);const m=state.sessions.find(x=>x.id===sessionId)?.messages.find(x=>x.id===message.id);if(state.translateIntermediate!==false&&m&&m.progress===message.progress)m.progressTranslation=delivery.value.text;});
  }
  private async translateMessage(sessionId:string,message:Message,manual=false){
    if(!manual&&this.session(sessionId).agentParent)return;
    this.translationModule.assertEnabled();
    if(message.planReview){const reference={kind:'message' as const,receipt:message.planReview.receipt},current=this.planFlow.read(sessionId,reference);if(manual||current.translationStatus!=='complete'||!current.planTranslationBlocks)await this.planFlow.translate(sessionId,reference);return;}
    const operationKey=sessionId+':'+message.id;if(this.activeTranslations.has(operationKey))return this.activeTranslations.get(operationKey);
    const promise=(async()=>{
      await this.update(s=>{const m=s.sessions.find(x=>x.id===sessionId)?.messages.find(x=>x.id===message.id);if(m){m.translationStatus='pending';m.translationError=undefined;}});
      try{
        let translated:string,source:string;const policy=this.translationModule.captureConfiguration();
        if(message.translationSource?.startsWith('离线固定')){translated=DEMO_FINAL_ZH;source=message.translationSource;}
        else {const result=(await this.translationModule.translate(message.role==='user'?message.submitted??message.original:visibleReply(message.original),'output',`${sessionId}:${message.id}:final`,manual?'final':message.phase==='commentary'?'progress':'final',undefined,sessionId)).value;translated=result.text;source=(result.providerName??result.providerId)+' / '+result.model;}
        await this.update(s=>{this.translationModule.assertCurrent(policy);const m=s.sessions.find(x=>x.id===sessionId)?.messages.find(x=>x.id===message.id);if(!m)return;if(hashText(m.original)===hashText(message.original)){m.translation=translated;m.translationStatus='complete';m.translationSource=source;}else{m.translationStatus='off';delete m.translationError;}});
      }catch(error){await this.update(s=>{const m=s.sessions.find(x=>x.id===sessionId)?.messages.find(x=>x.id===message.id);if(m){m.translationStatus=translationEnabled(s)?'failed':'off';m.translationError=translationEnabled(s)?safeError(error):undefined;}});}
    })();this.activeTranslations.set(operationKey,promise);try{await promise;}finally{this.activeTranslations.delete(operationKey);}
  }
}
export const hostIdentity=(h:SshHost)=>JSON.stringify([h.id,h.hostname,h.port,h.username,h.identityFile,h.knownHostsFile,h.ownerId,h.workspaceGeneration,h.role,h.authorityId,h.authorityGeneration,h.remoteWorkspaceId,h.deviceId]);
const samePath=(a:string,b:string)=>process.platform==='win32'?path.normalize(a).toLowerCase()===path.normalize(b).toLowerCase():path.normalize(a)===path.normalize(b);
function stringArray(value:unknown,name:string,max:number,maxLength:number){if(!Array.isArray(value)||value.length>max)throw new Error(`${name}列表不正确。`);return [...new Set(value.map(item=>required(item,name,maxLength)))];}
async function projectPaths(value:unknown,allowEmpty=false){const paths=stringArray(value,'项目目录',32,4096).map(absolutePath);const unique=paths.filter((item,index)=>!paths.slice(0,index).some(other=>samePath(item,other)));if(!unique.length&&!allowEmpty)throw new Error('请至少关联一个文件夹。');for(const p of unique)if(!(await stat(p)).isDirectory())throw new Error('项目路径不是目录。');return unique;}
export function safeError(error:unknown){
  if(error instanceof Error){if(error.name==='TimeoutError'||error.name==='AbortError')return '翻译已取消或超时；未自动提交原文。';
    const message=error.message;if(message.length<400&&!/Bearer |sk-[A-Za-z0-9]|BEGIN .*PRIVATE|authorization|x-api-key/i.test(message))return message;
  }return '操作失败；没有自动重试原生任务。';
}
