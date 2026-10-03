import type { SessionTitleMetadata } from '../session-core/presentation';
import type { CollaborationState } from '../collaboration-core/types';
import type { NativeAgentPolicy } from '../collaboration-core/native-policy';
import type { RuntimeActivity, NativeChildSnapshot } from '../collaboration-core/activity';
import type { FileChangeRecord } from '../collaboration-core/file-changes';
export type RuntimeKind = 'demo' | 'claude' | 'codex' | 'api' | import('../runtime-extensions/types').PluginRuntimeId;
export type PermissionMode = 'default' | 'read-only' | 'full-access' | 'accept-edits' | 'plan' | `plugin:${string}`;
export interface NativeModelSelection { model: string; effort?: string; serviceTier?: string }
export interface NativeModelOption { id: string; model: string; name: string; isDefault: boolean; efforts: string[]; defaultEffort?: string; serviceTiers: { id: string; name: string; description: string }[]; defaultServiceTier?: string;contextWindow?:number }
export interface NativeContextUsage { used: number; capacity: number | null; total: number; updatedAt: string; turnId?: string; runtimeCapacity?: number | null; estimated?:boolean; modelWindows?:Record<string,number> }
export type Protocol = 'chat-completions' | 'responses' | 'anthropic-messages';
export type Theme = 'light' | 'dark' | 'system';
export type TranslationDirection = 'input' | 'output';
/** Requested upstream configuration, never evidence that a provider applied it. */
export interface TranslationReasoning {
  mode: 'default' | 'effort' | 'adaptive' | 'budget';
  effort?: string; budgetTokens?: number; confirmed?: boolean;
}
export interface TranslationProfile {
  source?: import('../translation/types').TranslationSource;
  revision?: string;
  id: string; name: string; baseUrl: string; protocol: Protocol; model: string;
  effort?: string; verifiedEfforts: string[]; consent: boolean; hasKey?: boolean;
  maxCharacters: number; maxCalls: number; timeoutMs: number;
  reasoning?: TranslationReasoning; maxOutputTokens?: number;
}
export interface TranslationResult {
  incomplete?:boolean;
  text: string; sourceHash: string; providerId: string; providerName?: string; model: string; direction: TranslationDirection;
  elapsedMs: number; inputTokens: number | null; outputTokens: number | null;
  requestedEffort: string | null; effectiveEffort: string | null; protectionVersion: 1 | 2;
}
export interface Project { id: string; name: string; path: string; paths?: string[]; authority: 'local'; group: string; pinned?:boolean }
export interface NewSessionDraft { projectId:string|null;projectPath:string;runtime:RuntimeKind;hostId?:string;permissionMode?:PermissionMode;collaborationMode?:import('../session-core/planning').CollaborationMode;accountRef?:string;modelSelection?:NativeModelSelection;modelTargetId?:string }
export interface SessionBinding {
  /** An isolated, workbench-owned local native login; never an API credential. */
  localAccountId?: string;
  runtime: RuntimeKind; provider: string; accountRef: string; executionId: string; egress: 'demo' | 'vps' | 'direct-api' | 'runtime-managed';
  modelConnectionId?:string; modelMappingId?:string; executionSessionId?:string;
  hostId?: string; nativeSessionId?: string;
  /** Historical origin only; legacy execution is retired until verified adoption. */
  accountRuntime?: 'existing-codex' | 'native-owner';
}
export interface NativeEvent {
  id: string; sessionId: string; sequence: number; revision: number; type: 'progress' | 'final' | 'approval' | 'tool' | 'error';
  text: string; timestamp: string; public: boolean; raw?: unknown;
}
export interface Message {
  annotations?:import('../context-annotations').ContextAnnotation[];
  nativeCommandState?: import('../native-events/semantics').NativeCommandState['state'];
  planTranslationBlocks?:import('../session-core/plan-review').PlanBlockTranslation[];
  planReview?:{receipt:string;status:'pending'|'accepted'|'revise'|'expired'};
  skills?:import('../native-skills/invocation').SkillInvocation[];
  questionTranslation?: import('../native-interactions').QuestionTranslation;
  questions?: import('../native-interactions').NativeQuestion[];
  questionPresentation?: import('../native-interactions/inbox').QuestionPresentation;
  phase?:'commentary'|'final';
  delivery?:'pending'|'accepted'|'uncertain'|'not-sent';
  memoryReferences?:{title:string;path:string;source:'native-citation'|'native-read'}[];
  attachments?:import('../attachments/types').Attachment[];
  modelSource?:{targetId:string;name:string;runtime:RuntimeKind;model?:string};
  id: string; role: 'user' | 'assistant'; original: string; submitted?: string;
  translation?: string; translationStatus?: 'pending' | 'complete' | 'failed' | 'off';
  translationError?: string; translationSource?: string; progress?: string; progressTranslation?: string;
  demo: boolean; timestamp: string;
  draftRevisions?:{source:string;instruction?:string}[];
  nativeItemId?:string;
  nativeOrder?:number;
  nativeTurnId?:string;
  nativeTurnEnd?:boolean;
}
export interface NativeForkSource { sourceSessionId:string; threadId:string; lastTurnId?:string; beforeTurnId?:string; runtime?:'codex'|'claude'; lastMessageId?:string }
export type ForkLocation = 'workspace' | 'worktree';
export interface SessionBranch { sourceSessionId:string; sourceTitle:string; sourceMessageId?:string; createdAt:string; native?:NativeForkSource; location?:ForkLocation; titleBase?:string; number?:number; inheritedMessageCount?:number }
export interface NativeApproval {id:string|number;kind:'command'|'file'|'tool'|'plan';threadId?:string;turnId:string;details:string;decisions:import('../native-approvals').BasicApprovalDecision[];receipt?:string;options?:import('../native-approvals').ApprovalOption[];planTranslation?:import('../session-core/plan-review').PlanTranslation;}
export interface Session extends SessionTitleMetadata {
  translationCalls?: number;
  draftRecoveries?:import('../session-core/draft-recovery').DraftRecovery[];
  annotationDraft?:import('../context-annotations').AnnotationDraft;
  followUps?: import('../session-core/follow-ups').FollowUpEntry[];
  followUpError?: string;
  /** Local sidebar activity clock; independent of message timestamps and native identity. */
  sidebarActivityAt?: string;
  turnTimings?: import('../session-core/turn-timing').TurnTiming[];
  metrics?: import('../session-metrics').SessionMetrics;
  pluginRuntime?: import('../runtime-extensions/types').RuntimeSessionData;
  modelTargetId?:string;
  handoffFromMessage?:number;
  modelLanes?:import('../model-api/types').ModelLane[];
  modelSwitches?:{at:string;afterMessage:number;from:string;to:string;name:string}[];
  agentParent?:{sessionId:string;operationId:string;authorizationQuote:string;taskHash:string};
  /** Independent chat created at the user's request; not a native child lifecycle. */
  agentCreated?:{sourceSessionId:string;operationId:string;initialMessageId:string};
  apiCallBudget?:number;
  apiBudgetPause?:import('../model-api/turn-budget').ApiBudgetPause;
  apiSummary?:{text:string;throughMessageId:string;targetId:string;createdAt:string};
  id: string; projectId: string|null; title: string; pinned: boolean; archived: boolean; group: string;
  binding: SessionBinding; status: 'idle' | 'running' | 'blocked' | 'uncertain'; messages: Message[]; createdAt: string;
  projectPath?:string;
  branch?:SessionBranch;
  worktree?:import('../worktrees').WorktreeRecord;
  forkDraft?:string;
  forkSkills?:import('../native-skills/invocation').SkillInvocation[];
  forkAttachments?:import('../attachments/types').Attachment[];
  /** Requested native permission mode; a saved choice is not native execution evidence. */
  permissionMode?:PermissionMode;
  /** Codex planning preference; does not grant or revoke tool permissions. */
  collaborationMode?:import('../session-core/planning').CollaborationMode;
  modelSelection?:NativeModelSelection;
  nativeEffectiveModel?:NativeModelSelection;
  nativeContextUsage?:NativeContextUsage;
  nativeActiveSettings?:{permissionMode:PermissionMode;modelSelection?:NativeModelSelection};
  unread?:boolean;
  /** Legacy selection metadata; shared skill discovery no longer depends on this list. */
  skillIds?:string[];
  /** Requested native defaults frozen at session creation; not effective-limit evidence. */
  nativeAgentPolicy?: NativeAgentPolicy;
  activities?: RuntimeActivity[];
  fileChangeRecords?: FileChangeRecord[];
  nativeChildren?: NativeChildSnapshot[];
  nativeObservation?: 'observing' | 'disconnected';
  nativeEventAudit?: import('../native-events/types').NativeEventAudit;
  nativeBackground?: import('../native-events/semantics').NativeBackgroundState;
  nativeProtocol?: import('../native-events/semantics').NativeProtocolState;
  nativeReady?:boolean;
  nativeTurnId?:string;
  nativeTurnStatus?:string;
  nativeError?:string;
  /** Bounded structural cross-protocol receipts, without prompts, tool arguments or credentials. */
  nativeProviderReceipts?: (import('../model-api/native-completion').NativeCompletionReceipt & { at: string; turnId: string })[];
  accountMigration?:{id:string;previousAccountRef:string;migratedAt:string};
  nativeApprovals?:NativeApproval[];
  nativeInteractions?:import('../native-interactions').NativeInteraction[];
  nativePlan?:import('../native-interactions').NativePlan;
  nativeEnvironmentReceipt?:{threadId:string;environmentId:string;cwd:string;runtimeVersion:string;accountRef:string};
}
export interface SshHost {
  id: string; name: string; hostname: string; port: number; username: string; role: 'admin' | 'workspace';
  identityFile: string; knownHostsFile: string; ownerId: string; workspaceGeneration: string;
  /** Public remote binding obtained by device enrollment, never a local role grant. */
  authorityId?:string; authorityGeneration?:string; remoteWorkspaceId?:string; deviceId?:string;
}
/** Public metadata from one remote account authority. Never native credentials. */
export interface SharedAccount {
  id:string; generation:string; provider:'codex'|'claude';
  status:'authenticated'|'configured'|'unknown'|'unauthenticated';
  enabled?:boolean; accessRevision?:number; workspaceEnabled?:boolean; workspaceAccessRevision?:number;
  email?:string; displayName?:string; nameRevision?:string; plan?:string; authMethod?:string; observedAt:string;
}
export interface SharedAccountAlias { name:string; revision:string }
export interface AccountCatalog {
  authorityId:string; generation:string; revision:number; workspaceId:string;
  selectionRevision:number; selectedAccountId?:string; accounts:SharedAccount[];
  claudeSelectionRevision?:number; selectedClaudeAccountId?:string;
  availability:'ready'|'unavailable'; reason?:string;
  source?:'existing-codex'|'native-owner';policyRevision?:number;
  assignments?:{username:string;accountIds:string[]}[];
  /** Read-only discovery for migration; never an execution or authorization source. */
  legacy?: {authorityId:string;generation:string;revision:number;accounts:SharedAccount[];availability:'ready'|'unavailable';reason?:string};
}
export interface EnvironmentField { value: string | null; status: 'known' | 'unknown' | 'stale' | 'unsupported'; source: 'ssh-allowlist' }
export interface EnvironmentProfile {
  id: string; version: 1; hostId: string; ownerId: string; observedAt: string; validUntil: string;
  guarantee: 'projected'; fields: Record<string, EnvironmentField>;
}
export interface AppState {
  translationUsage?: import('../translation/types').TranslationUsageState;
  followUpModes?: import('../session-core/follow-ups').FollowUpMode[];
  shortcuts?: import('../shortcuts').ShortcutSettings;
  localModelAccounts?: import('../model-management/types').LocalModelAccount[];
  modelPrices?: import('../model-management/types').SavedModelPrice[];
  modelUsage?: import('../model-management/types').ModelUsageEntry[];
  chatCreations?:import('../collaboration-core/session-tools').ChatCreationOperation[];
  /** Live registrations; never authoritative when read from disk. */
  runtimeExtensions?: import('../runtime-extensions/types').RuntimeCatalogEntry[];
  permissionPreferences?:Record<string,Partial<Record<RuntimeKind,PermissionMode>>>;
  /** Global preference, default on; existing translations are retained. */
  translateIntermediate?:boolean;
  /** Display only; moving a reader into the side panel does not trigger translation. */
  translationLayout?:string;
  translationLayouts?:import('../translation/layouts').TranslationLayoutOption[];
  /** Global optional composer control; missing state defaults to shown and unpaused. */
  translationQuickToggle?:{show:boolean;paused:boolean};
  sidebarProjectOrder?:string[];
  sidebarSessionOrder?:string[];
  sidebarCollapsedProjectIds?:string[];
  sidebarExpandedProjectIds?:string[];
  modelConnections?:import('../model-api/types').ModelConnection[];
  runtimeModelPreferences?:import('../model-api/runtime-target').RuntimeModelPreferences;
  lastModelTargetId?:string;
  nativeMemoryDefaults?:Partial<Record<'codex'|'claude',import('../native-memory/default-target').MemoryDefaultChoice>>;
  lastModelSelection?:NativeModelSelection;
  lastModelHostId?:string;
  appearance?: import('../appearance').AppearanceSettings;
  version: 1; theme: Theme; projects: Project[]; sessions: Session[]; hosts: SshHost[];
  recentProject?: { name: string; paths: string[]; pinned: boolean; hidden?: boolean };
  /** Last explicit runtime choice for new chats; opening history does not change it. */
  lastSelectedRuntime?: RuntimeKind;
  translation: TranslationProfile; translateInput: boolean; translateProgress: boolean; translateFinal: boolean;
  profiles: EnvironmentProfile[];
  /** Selected in SSH settings; existing sessions keep their original binding. */
  activeWorkspaceId?: string;
  /** Cached public catalog and the remote default for each independently bound SSH workspace. */
  accountCatalogs?:Record<string,AccountCatalog>;
  accountAliases?:Record<string,SharedAccountAlias>;
  autoSubmitTranslated?:boolean;
  /** Missing entries inherit each registered plugin's default. */
  plugins?:Record<string,{enabled:boolean}>;
  collaboration?:CollaborationState;
  nativeAgentDefaults?: NativeAgentPolicy;
  /** Computed by the trusted host from local acceptance evidence, never a renderer grant. */
  nativeCodexBindings?:{hostId:string;accountRef:string}[];
}
export interface DraftPreview { incomplete?:boolean; annotations?:import('../context-annotations').ContextAnnotation[]; annotationRevision?:number; followUp?:import('../session-core/follow-ups').FollowUpIntent; skills?:import('../native-skills/invocation').SkillInvocation[]; attachments?:import('../attachments/types').Attachment[]; id: string; revision: number; original: string; translated: string; sourceHash: string; demo: boolean; bypass: boolean; moduleDisabled?:boolean; revisions?:{source:string;instruction?:string}[] }
export interface Capability { id: string; label: string; status: 'implemented' | 'contract-tested' | 'unverified' | 'unsupported'; detail: string }
export type ApiResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string };
export type DesktopCommand = 'new-session' | 'new-project' | 'settings' | 'search' | 'toggle-sidebar' | 'back' | 'forward' | 'shortcuts' | 'capabilities' | 'about' | 'archive-session' | 'delete-session' | 'pin-session' | 'unread-session' | 'focus-composer' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'fullscreen' | 'menu-file' | 'menu-edit' | 'menu-view' | 'menu-help' | 'close-window' | 'quit-app';
export interface WorkbenchApi { onPluginEvent?(listener:(event:import('../plugins-core').PluginHostEvent)=>void):()=>void; attachFiles(files:File[]):Promise<import('../attachments/types').AttachmentView[]>; onExtensions?(listener:()=>void):()=>void; call<T = unknown>(method: string, payload?: unknown): Promise<T>; importSkillFile(file:File,provider:'codex'|'claude'):Promise<unknown>; importPluginFile(file:File):Promise<unknown>; importSshFile(file:File):Promise<unknown>; onState(listener: (state: AppState) => void): () => void; onNavigate(listener:(sessionId:string)=>void):()=>void; onCommand(listener:(command:DesktopCommand)=>void):()=>void }
declare global { interface Window { workbench: WorkbenchApi } }
