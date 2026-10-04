import type {NativeQuotaAccounting} from './quota-accounting';
import {nativeEventSemantics} from '../../../packages/native-events/semantics';
import { sessionPresentation } from '../../../packages/session-core/presentation';
import {nativeContextState} from '../../../packages/model-api/context-state';
import { nativeSessionTitles, type NativeTitleRefreshResult } from '../../../packages/session-core/native-titles';
import { recordAsyncQuestions } from '../../../packages/native-interactions/inbox';
import { recordedNativeFork } from '../../../packages/session-core/native-fork';
import { memoryCitations } from '../../../packages/session-core/memory-citations';
import { officialAccountLaunch, codexUsage, claudeUsage } from '../../../packages/model-management/native';
import type { LocalModelAccounts } from './local-model-accounts';
import { codexSkillInputs } from '../../../packages/native-skills/invocation';
import { EventEmitter } from 'node:events';
import { AsyncLocalStorage } from 'node:async_hooks';
import { claudeResultOutcome } from '../../../packages/runtime-claude/result';
import { nativeTurnFailure } from '../../../packages/native-events/turn-failure';
import {nativeResponseRecovered} from '../../../packages/collaboration-core/runtime-notices';
import { approvalFields, codexApprovalChoices, claudeApprovalChoices, resolveApprovalChoice, claudeApprovalResult, type ApprovalReply, type BasicApprovalDecision } from '../../../packages/native-approvals';
import { randomUUID } from 'node:crypto';
import { metricsSource, recordSessionUsage, parseTokenCounts } from '../../../packages/session-metrics';
import { ClaudeContextUsageTracker, claudeContextCapacity } from '../../../packages/runtime-claude/context-usage';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { AppState, DraftPreview, Message, NativeModelSelection, PermissionMode, Session } from '../../../packages/contracts';
import type { LocalCliService } from '../../../packages/native-runtime/cli';
import { createNativeProcess, ProcessSupervisor, type NativeFrame, type ProcessSpec, type NativeProcessTransport } from '../../../services/remote-supervisor';
import type {NativeClaudeService} from '../../../services/claude-bridge';
import type {ApiModel} from '../../../packages/model-api/types';
import {claudeToolSemanticName} from '../../../packages/runtime-claude/tool-names';
import { CodexRpcClient, codexTurnPermissionParams, type RpcId } from '../../../packages/runtime-codex';
import { normalizeClaudeEvent } from '../../../packages/runtime-claude';
import { parseContextUsage } from '../../../packages/runtime-codex/models';
import { ClaudeNativeChildTracker } from '../../../packages/collaboration-core/events';
import type { createPeerTools } from '../../../packages/collaboration-core/tools';
import { PeerMcpSession } from '../../../packages/collaboration-core/mcp';
import { NativeChildLifecycle, NativeChildConversationTracker } from '../../../packages/collaboration-core/child-conversation';
import { attachmentPrompt, apiAttachmentContent, nativeAttachmentImages } from '../../../packages/attachments/input';
import {availableReasoningEfforts,defaultVerifiedEffort} from '../../../packages/model-api/reasoning-info';
import { openNativeGateway, type NativeGatewayOptions } from '../../../packages/model-api/native-gateway';
import { diagnosticLabel, type NativeProviderDiagnostic } from '../../../packages/model-api/native-diagnostics';
import { providerContextUsage } from '../../../packages/model-api/native-context';
import { prepareCodexModelCatalog } from '../../../packages/model-api/native-catalog';
import { nativeProviderLaunch } from '../../../packages/model-api/native-launch';
import { ClaudeControlClient, claudeReportedPermission } from '../../../packages/runtime-claude/control';
import { codexCollaborationParams } from '../../../packages/session-core/planning';
import { sourceLabel, visibleHandoff } from '../../../packages/model-api/targets';
import type { ModelConnections } from './model-connections';
import type { AttachmentStore } from './attachments';
import { codexInteraction, claudeInteraction, interactionResult, putInteraction, expireInteractions, planUpdate, questions, isRequestId, type InteractionReply } from '../../../packages/native-interactions';

interface Hooks {
  managedDirectory?:string;
  quota?:Pick<NativeQuotaAccounting,'begin'|'observe'|'finish'>;
  snapshot(): AppState; update(fn: (state: AppState) => void): Promise<unknown>;
  /** Optional cheap paths; runners fall back to snapshot/update when absent. */
  updateSession?(id: string, change: (session: Session) => void, options?: { persist?: 'durable' | 'deferred' }): Promise<boolean>; read?(): Readonly<AppState>; session?(id: string): Session | undefined;
  peers(id: string): ReturnType<typeof createPeerTools>; observe(id: string, source: EventEmitter): Promise<unknown>;
  context(id: string): Promise<string>; translate(id: string, message: Message): void; attachments?: AttachmentStore;
  failure?(error: unknown): void;
  remoteClaude?:NativeClaudeService;
  assertRemoteClaude?(session:Session):ApiModel;
  beforeRemoteClaude?(session:Session,signal:AbortSignal):Promise<void>;
}
interface Active {
  detached?: boolean;
  quotaHandle?:{threadId:string}; quotaTokens?:number;
  warm?: boolean; readiness?: Promise<void>; ready?(): void; rejectReady?(error: unknown): void;
  launchKey?: string; expiry?: ReturnType<typeof setTimeout>;
  claudeInputs?: Set<string>;
  claudeControl?: ClaudeControlClient; userStopped?: boolean; stoppedActivityIds?: Set<string>;
  done: Promise<void>; finish(): void; abort: AbortController; process?: NativeProcessTransport; rpc?: CodexRpcClient;
  threadId?: string; turnId?: string; sent: boolean; completed: boolean; stopping: boolean; queue: Promise<void>;
  approvals: Map<RpcId, Record<string, any>>; gateway?: Awaited<ReturnType<typeof openNativeGateway>>;
  upstreamDiagnostic?:NativeProviderDiagnostic;
  textBatch?: Map<string, { chunks: string[]; phase?: 'commentary' | 'final' }>;
  drainText?:()=>void;
  modelCatalog?:Awaited<ReturnType<typeof prepareCodexModelCatalog>>;
  children:NativeChildLifecycle; previewId?:string; finishingTurn?:boolean; startTurn?:(preview:DraftPreview)=>Promise<void>;
  runtimeFailure?:string; retryNotice?:string; retryPending?:boolean;
}
const obj = (value: unknown): Record<string, any> => value && typeof value === 'object' ? value as Record<string, any> : {};
/** Native CLIs execute tools and compact context. This class only hosts their public transports. */
export class NativeProviderRunner {
  /** Approved host plugins may wrap this method; real launches use this entry. */
  openGateway(options: NativeGatewayOptions) { return openNativeGateway(options); }
  prepareCatalog(executable:string,model:ApiModel,env:NodeJS.ProcessEnv){return prepareCodexModelCatalog(executable,model,env);}
  forkSource(id:string,messageId?:string) { return recordedNativeFork(this.session(id),messageId); }
  private active = new Map<string, Active>();
  private attempt = new AsyncLocalStorage<Active>();
  private titleReads = new Map<string, { reader: unknown; work: Promise<NativeTitleRefreshResult> }>();
  private titleControllers = new Set<AbortController>();
  private titlesClosed = false;
  constructor(private connections: ModelConnections, private cli: LocalCliService, private hooks: Hooks, private fetcher?: typeof fetch, private accounts?: LocalModelAccounts, private processFactory: (spec: ProcessSpec) => ProcessSupervisor = spec => createNativeProcess(spec)) {}
  private session(id: string) { const session = this.hooks.session ? this.hooks.session(id) : this.hooks.snapshot().sessions.find(session => session.id === id); if (!session) throw Error('会话不存在。'); return session; }
  private read(): Readonly<AppState> { return this.hooks.read?.() ?? this.hooks.snapshot(); }
  private update(id: string, change: (session: Session) => void, persist?: 'deferred') { const attempt=this.attempt.getStore();if(this.hooks.updateSession)return this.hooks.updateSession(id, session => { if (!attempt?.detached) change(session); }, { persist });return this.hooks.update(state => { const session = state.sessions.find(session => session.id === id); if (session&&!attempt?.detached) change(session); }); }
  /** Read only the title metadata belonging to this session's native runtime environment. */
  refreshTitle(id:string):Promise<NativeTitleRefreshResult>{
    // A read started before the reader was overridden or restored discards its result; do not join it.
    const reader=nativeSessionTitles.read,previous=this.titleReads.get(id);if(previous?.reader===reader)return previous.work;
    const work=this.readTitle(id).finally(()=>{if(this.titleReads.get(id)?.work===work)this.titleReads.delete(id);});
    this.titleReads.set(id,{reader,work});return work;
  }
  private async readTitle(id:string):Promise<NativeTitleRefreshResult>{
    if(this.titlesClosed)return {status:'unavailable'};
    const session=this.session(id);
    if(session.titleSource==='manual'||!['fallback','native'].includes(session.titleSource??'')||session.branch||session.agentCreated||session.agentParent)return {status:'protected'};
    if(session.binding.runtime!=='claude'||session.binding.hostId||!session.binding.nativeSessionId||!session.projectPath)return {status:'unavailable'};
    const binding=JSON.stringify(session.binding),cwd=session.projectPath;
    const abort=new AbortController();this.titleControllers.add(abort);
    const timeout=setTimeout(()=>abort.abort(),1500);
    try {
      const env=session.binding.localAccountId?this.accounts?.execution(session).env:this.cli.env;
      if(!env)return {status:'unavailable'};
      const configDir=env.CLAUDE_CONFIG_DIR||path.join(this.cli.home,'.claude');
      const reader=nativeSessionTitles.read;
      const result=await Promise.race([
        reader.call(nativeSessionTitles,{runtime:'claude',nativeSessionId:session.binding.nativeSessionId,cwd,configDir,projectDirectoryName:env.CLAUDE_CONFIG_DIR?env.CLAUDE_CODE_PROJECT_DIR_NAME:undefined,signal:abort.signal}),
        new Promise<undefined>(resolve=>abort.signal.addEventListener('abort',()=>resolve(undefined),{once:true})),
      ]);
      if(abort.signal.aborted||this.titlesClosed||reader!==nativeSessionTitles.read)return {status:'unavailable'};
      if(!result||result.nativeSessionId!==session.binding.nativeSessionId)return {status:'unavailable'};
      let status:NativeTitleRefreshResult['status']='unavailable';
      await this.update(id,current=>{
        if(this.titlesClosed||reader!==nativeSessionTitles.read||JSON.stringify(current.binding)!==binding||current.projectPath!==cwd)return;
        if(current.titleSource==='manual'||!['fallback','native'].includes(current.titleSource??'')||current.branch||current.agentCreated||current.agentParent){status='protected';return;}
        if(current.title===result.title&&current.titleSource==='native'){status='unchanged';return;}
        if(sessionPresentation.nativeTitle(current,result.title))status='updated';
      });
      return {status};
    }catch{return {status:'unavailable'};}
    finally {clearTimeout(timeout);abort.abort();this.titleControllers.delete(abort);}
  }
  async runtimes() { return (await Promise.all((['codex', 'claude'] as const).map(async runtime => await this.cli.locate(runtime) ? runtime : undefined))).filter((runtime): runtime is 'codex' | 'claude' => !!runtime); }
  assertAllowed(session: Session) {
    if(session.binding.runtime==='claude'&&session.binding.hostId){
      if(!this.hooks.remoteClaude||!this.hooks.assertRemoteClaude)throw Error('CLAUDE_REMOTE_TRANSPORT_UNAVAILABLE');
      if(this.cli.isMaintaining())throw Error('CLI 正在维护，请稍后再发送。');
      return {connection:undefined,model:this.hooks.assertRemoteClaude(session)};
    }
    if (session.binding.localAccountId) {
      if (!this.accounts) throw Error('LOCAL_ACCOUNT_RUNTIME_MISSING');
      const value = this.accounts.execution(session);
      return { ...value, connection: undefined };
    }
    if (!['codex', 'claude'].includes(session.binding.runtime) || session.binding.hostId || session.binding.egress !== 'direct-api') throw Error('请先选择 Codex 或 Claude Code，再选择第三方模型。');
    const connection = this.connections.connection(session.binding.modelConnectionId), model = connection.models.find(model => model.id === session.binding.modelMappingId && model.enabled);
    if (!connection.enabled || !model || connection.auth === 'key' && !connection.hasKey) throw Error('模型来源已停用、移除或缺少密钥。');
    if (session.modelSelection?.model !== model.model || session.modelSelection.effort && !availableReasoningEfforts(model).includes(session.modelSelection.effort)) throw Error('模型映射或思考档位已变化，请重新选择。');
    if (this.cli.isMaintaining()) throw Error('CLI 正在维护，请稍后再发送。');
    return { connection, model };
  }
  busy(id: string) { const active=this.active.get(id);return !!active&&!active.warm; }
  hasTransport(id:string){return this.active.has(id);}
  private launchKey(session:Session) {
    const {nativeSessionId,...binding}=session.binding;
    const {model,connection}=this.assertAllowed(session);
    return JSON.stringify([binding,session.projectPath,session.modelSelection,session.permissionMode,session.branch?.native,model,connection,this.hooks.snapshot().hosts.find(h=>h.id===binding.hostId),this.hooks.snapshot().localModelAccounts?.find(a=>a.id===binding.localAccountId)?.revision]);
  }
  /** Prepare only the native transport. No user input, model turn, or memory task is submitted. */
  async prepare(id:string):Promise<{ready:boolean}> {
    const session=this.session(id);this.assertAllowed(session);
    if(this.titlesClosed||session.archived||!['idle','blocked'].includes(session.status))return {ready:false};
    let current=this.active.get(id);
    if(current&&!current.warm){if(current.completed&&!current.children.pending){await current.done;return this.prepare(id);}return {ready:false};}
    if(current&&current.launchKey!==this.launchKey(session)){await this.stop(id);current=undefined;}
    if(current){await current.readiness;return {ready:!current.stopping};}
    // Bound speculative work; active user turns are never evicted.
    for(const [other,value] of this.active)if(value.warm&&other!==id)await this.stop(other);
    await this.launch(id,undefined);
    current=this.active.get(id);if(!current)return {ready:false};
    await current.readiness;return {ready:!current.stopping};
  }
  async settleCompleted(id:string,closePrepared=true) {
    const active=this.active.get(id);
    // Final content can reach the UI before owned-process cleanup finishes.
    // Wait only for that existing cleanup, never stop or replay a live task.
    if(active?.warm){if(closePrepared)await this.stop(id);}
    else if(active?.completed&&!active.children.pending)await active.done;
  }
  async close(id: string) { if(this.active.get(id)?.warm)await this.stop(id);else if (this.active.has(id)) throw Error('请等待当前原生回合结束。'); }
  async closeForRecovery(id:string){
    const active=this.active.get(id);if(!active)return;
    active.detached=true;active.stopping=true;clearTimeout(active.expiry);
    this.active.delete(id);active.drainText?.();active.abort.abort();
    void active.process?.stop('manual-recovery').catch(()=>{});
  }
  async dispose() { this.titlesClosed=true;for(const controller of this.titleControllers)controller.abort();await Promise.allSettled([...this.active.keys()].map(id => this.stop(id))); }
  assertCompactAllowed(session: Session) {
    this.assertAllowed(session);
    if(!session.binding.nativeSessionId||session.handoffFromMessage!==undefined)throw Error('NATIVE_COMPACT_HISTORY_NOT_READY');
    if(this.busy(session.id)||!['idle','blocked'].includes(session.status)||session.archived)throw Error('NATIVE_COMPACT_BUSY');
  }
  async compact(id: string) {
    this.assertCompactAllowed(this.session(id));
    return this.submit(id,{id:randomUUID(),original:'/compact',translated:'/compact',revision:1,sourceHash:'native-command:compact',demo:false,bypass:true},'compact');
  }
  async submit(id: string, preview: DraftPreview, command?: 'compact'):Promise<{started:boolean;runtime:Session['binding']['runtime']}> {
    const session = this.session(id); this.assertAllowed(session);
    if (!['idle', 'blocked'].includes(session.status)) throw Error('当前原生任务正在处理或回执未知。');
    const existing=this.active.get(id);
    if(existing){
      if(existing.warm){
        if(existing.launchKey!==this.launchKey(session)||existing.threadId&&session.binding.nativeSessionId!==existing.threadId){await this.stop(id);return this.submit(id,preview,command);}
        existing.warm=false;clearTimeout(existing.expiry);
        try{await existing.readiness;}catch{await existing.done;return this.submit(id,preview,command);}
        if(command){await this.stop(id);return this.submit(id,preview,command);}
        if(existing.stopping){await existing.done;return this.submit(id,preview,command);}
        await this.attempt.run(existing,()=>existing.startTurn!(preview));return {started:true,runtime:session.binding.runtime};
      }
      if(existing.finishingTurn)await existing.queue;
      if(existing.stopping){await existing.done;return this.submit(id,preview);}
      if(!existing.completed||existing.finishingTurn||!existing.startTurn)throw Error('当前原生任务正在处理或回执未知。');
      await this.attempt.run(existing,()=>existing.startTurn!(preview));return {started:true,runtime:session.binding.runtime};
    }
    return this.launch(id,preview,command);
  }
  private async launch(id:string,preview?:DraftPreview,command?:'compact') {
    const session=this.session(id);this.assertAllowed(session);
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    let ready!:()=>void,rejectReady!:(error:unknown)=>void;
    const readiness=new Promise<void>((resolve,reject)=>{ready=resolve;rejectReady=reject;});readiness.catch(()=>{});
    const active: Active = { done, finish, readiness,ready,rejectReady,warm:!preview,launchKey:this.launchKey(session),abort: new AbortController(), sent: false, completed: !preview, stopping: false, queue: Promise.resolve(), approvals: new Map(),children:new NativeChildLifecycle() };
    if (this.active.has(id)) throw Error('当前会话正在准备。'); this.active.set(id, active);
    if(!preview){active.expiry=setTimeout(()=>{if(active.warm)void this.stop(id).catch(()=>{});},120000);active.expiry.unref();}
    try { if(preview)await this.update(id, session => { session.status = 'running'; session.nativeError = undefined; session.nativeApprovals = []; expireInteractions(session); session.nativePlan=undefined; session.nativeTurnId = undefined; }); }
    catch(error) { this.active.delete(id); active.finish(); throw error; }
    void this.attempt.run(active,()=> (async()=>{const found=await this.cli.locate(session.binding.runtime as 'codex'|'claude');if(!found)throw Error('请先安装所选原生运行时。');active.abort.signal.throwIfAborted();await this.run(id,preview,found.executable,active,command);})().catch(async error => {
      active.stopping=true;
      active.rejectReady?.(error);
      if(active.warm)return;
      if (!active.userStopped) this.hooks.failure?.(error);
      await active.queue.catch(() => {});
      if (!active.userStopped) await this.update(id, session => { session.status = active.sent && (!active.completed||active.children.pending) ? 'uncertain' : 'idle'; session.nativeError = active.sent ? (active.upstreamDiagnostic ? diagnosticLabel(active.upstreamDiagnostic) : active.runtimeFailure ?? '') + '原生回合未确认完成，请检查记录；工作台未额外重发。' : error instanceof Error && error.message==='NATIVE_MODEL_CATALOG_UNAVAILABLE' ? '当前 Codex 无法提供可验证的模型目录，声明的上下文窗口未应用，本次未提交模型任务。请检查原生版本支持情况。' : '原生运行时准备失败，本次未提交模型任务。'; session.nativeApprovals = []; expireInteractions(session,'uncertain'); }).catch(() => {});
    }).finally(async () => {
      clearTimeout(active.expiry);
      let cleaned = true;
      try { await active.process?.stop('native-provider-finished'); } catch { cleaned = false; }
      active.claudeControl?.dispose();
      if(active.quotaHandle)await this.hooks.quota?.finish(id,active.quotaHandle).catch(()=>{});
      await active.queue.catch(() => {});
      if(!active.detached&&active.sent&&!active.userStopped&&session.binding.runtime==='claude')await this.refreshTitle(id).catch(()=>{});
      await active.gateway?.close().catch(() => {});
      await active.modelCatalog?.dispose().catch(() => {});
      if(this.active.get(id)===active)this.active.delete(id);
      if(!active.warm||!cleaned)await this.update(id, session => {
        if (!cleaned) { session.status = 'uncertain'; session.nativeError = '原生进程清理尚未确认，请保留当前记录。'; }
        else if (active.userStopped) {
          session.status = 'idle'; if(!active.completed){session.nativeTurnStatus = 'interrupted';session.nativeError = undefined;}
          session.nativeApprovals = []; expireInteractions(session, 'expired'); session.nativeObservation = 'disconnected';
          for (const item of session.activities ?? []) if (active.stoppedActivityIds?.has(item.id) && ['running','uncertain'].includes(item.status)) item.status = 'cancelled';
          for (const child of session.nativeChildren ?? []) if (['spawn','progress'].includes(child.operation)) { child.operation = 'closed'; child.status = 'cancelled'; }
        } else if (session.status === 'running' && active.completed) session.status = 'idle';
        for(const message of session.messages)if(message.delivery==='pending')message.delivery='uncertain';
      }).catch(() => {});
      active.finish();
    }));
    return { started: true, runtime: session.binding.runtime };
  }
  private enqueue(active: Active, work: () => Promise<unknown>) { active.drainText?.();active.textBatch = undefined; active.queue = active.queue.then(()=>active.detached?undefined:this.attempt.run(active,work)).then(() => {}); active.queue.catch(() => active.abort.abort()); }
  private appendText(id: string, active: Active, itemId: string, text: string, phase?: 'commentary' | 'final') {
    if (!text) return;
    let batch = active.textBatch;
    if (!batch) {
      batch = new Map(); active.textBatch = batch;
      const current = batch;
      const windowMs=nativeEventSemantics.batchWindowMs();
      const ready=new Promise<void>(resolve=>{
        if(!Number.isFinite(windowMs)||windowMs<=0){resolve();return;}
        const drain=()=>{clearTimeout(timer);if(active.drainText===drain)active.drainText=undefined;resolve();};
        const timer=setTimeout(drain,Math.min(windowMs,100));active.drainText=drain;
      });
      active.queue = active.queue.then(()=>this.attempt.run(active,async () => {
        await ready;
        if (active.textBatch === current) active.textBatch = undefined;
        // Streamed text is rebuilt by the native completion event, so it is persisted lazily.
        await this.update(id, session => {
          for (const [key, value] of current) {
            let message = session.messages.find(m => m.nativeItemId === key);
            if (!message) { message = { id: randomUUID(), nativeItemId: key, nativeTurnId: session.nativeTurnId, role: 'assistant', original: '', demo: false, timestamp: new Date().toISOString(), translationStatus: 'off', modelSource: sourceLabel(session, this.read() as AppState) }; session.messages.push(message); }
            message.original += value.chunks.join('');
            if (value.phase) message.phase = value.phase;
          }
        }, 'deferred');
      }));
      active.queue.catch(() => active.abort.abort());
    }
    const value = batch.get(itemId) ?? { chunks: [], phase };
    value.chunks.push(text); if (phase) value.phase = phase; batch.set(itemId, value);
  }
  private async message(id: string, itemId: string, text: string, complete: boolean, phase?: 'commentary' | 'final', prompts?:unknown, previousItemId?:string, proposedPlan=false, nativeCitation?:unknown) {
    let saved: Message | undefined;
    await this.update(id, session => {
      let message = session.messages.find(message => message.nativeItemId === itemId || !!previousItemId && message.nativeItemId === previousItemId);
      if (!message) { message = { id: randomUUID(), nativeItemId: itemId, nativeTurnId: session.nativeTurnId, role: 'assistant', original: '', demo: false, timestamp: new Date().toISOString(), translationStatus: 'off', modelSource: sourceLabel(session, this.read() as AppState) }; session.messages.push(message); }
      if (complete) message.nativeItemId = itemId;
      message.original = complete ? text : message.original + text; if (phase) message.phase = phase;
      if(complete)message.memoryReferences=memoryCitations(text,nativeCitation);
      if(proposedPlan)message.planReview={receipt:randomUUID(),status:'pending'};
      if(Array.isArray(prompts)&&prompts.length){try{recordAsyncQuestions(session,message,questions(prompts,'async'));}catch{session.nativeError='原生异步问题格式尚不支持，请在输入框直接回复。';}}
      saved = structuredClone(message);
    });
    if (complete && saved) this.hooks.translate(id, saved);
  }
  private async run(id: string, preview: DraftPreview|undefined, executable: string, active: Active, command?: 'compact') {
    const session = this.session(id), runtime = session.binding.runtime as 'codex' | 'claude', { model, connection } = this.assertAllowed(session);
    // On a cold explicit send, discover context while the native transport starts.
    let initialContext=preview&&!command?this.hooks.context(id):undefined;initialContext?.catch(()=>{});
    if(!session.modelSelection?.effort&&defaultVerifiedEffort(model)){session.modelSelection={...session.modelSelection,model:model.model,effort:defaultVerifiedEffort(model)};await this.update(id,s=>{s.modelSelection=session.modelSelection;});}
    active.launchKey=this.launchKey(session);
    const cwd = session.projectPath || path.join(this.hooks.managedDirectory??path.join(this.cli.home,'.agent-workbench'), 'workspaces', id); await mkdir(cwd, { recursive: true });
    active.abort.signal.throwIfAborted();
    const remote=runtime==='claude'&&!!session.binding.hostId;
    const peers = this.hooks.peers(id), mcp = runtime === 'claude' ? () => new PeerMcpSession(peers) : undefined;
    if(remote){
      await this.hooks.beforeRemoteClaude?.(session,active.abort.signal);active.abort.signal.throwIfAborted();
    } else if (session.binding.localAccountId) {
      if (mcp) active.gateway = await this.openGateway({ runtime, model, mcp, mcpOnly: true, authorizeMcp: () => { this.assertAllowed(this.session(id)); }, credentials: async () => { throw Error('OFFICIAL_ACCOUNT_MODEL_PROXY_FORBIDDEN'); } });
    } else {
      active.gateway = await this.openGateway({ runtime, model, effort: session.modelSelection?.effort, fetcher: this.fetcher, failure:this.hooks.failure, diagnostic:value=>{active.upstreamDiagnostic=value;}, completionReceipt:value=>{const turnId=active.turnId??active.previewId??'',at=new Date().toISOString();this.enqueue(active,()=>this.update(id,s=>{s.nativeProviderReceipts=[...(s.nativeProviderReceipts??[]),{...value,turnId,at}].slice(-32);}));}, usage:async value=>{active.upstreamDiagnostic=undefined;const turnId=active.turnId??active.previewId??'',source=metricsSource(this.session(id)),at=new Date().toISOString();await this.update(id,s=>{recordSessionUsage(s,{id:randomUUID(),model:value.model,...value.counts,elapsedMs:value.elapsedMs},{source,turnId,at});});}, mcp, credentials: async () => { active.abort.signal.throwIfAborted(); const { connection } = this.assertAllowed(this.session(id)); if (!connection) throw Error('MODEL_SOURCE_CHANGED'); return { connection, key: await this.connections.key(connection) }; } });
    }
    if (!session.binding.localAccountId && runtime === 'codex' && model.contextWindow) active.modelCatalog = await this.prepareCatalog(executable, model, this.cli.env);
    const launch = remote ? {args:[],env:this.cli.env,thread:undefined,runtimeModel:model.model} : session.binding.localAccountId ? officialAccountLaunch(session, this.accounts!.execution(session).env, active.gateway) : nativeProviderLaunch(runtime, model, active.gateway!, session.permissionMode ?? 'default', session.modelSelection, this.cli.env, session.binding.nativeSessionId, connection!.protocol, active.modelCatalog?.file, runtime==='claude'?session.branch?.native:undefined,session.id);
    active.process = remote ? this.hooks.remoteClaude!.createTransport({workbenchTools:()=>this.hooks.peers(id),host:this.hooks.snapshot().hosts.find(h=>h.id===session.binding.hostId)!,session:structuredClone(session),executable,directory:path.join(this.hooks.managedDirectory??path.join(this.cli.home,'.agent-workbench'),'claude-tool-profiles'),cwd,env:this.cli.env,signal:active.abort.signal,authorize:()=>{this.assertAllowed(this.session(id));}}) : this.processFactory({ executable, args: launch.args, env: launch.env, cwd });
    let complete!: () => void, failed!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => { complete = resolve; failed = reject; }); completion.catch(() => {});
    const release=()=>{if(active.sent&&active.completed&&!active.finishingTurn&&!active.children.pending&&!active.claudeInputs?.size){active.stopping=true;complete();}};
    const finishRoot=(status='completed',error?:unknown)=>{
      if(active.finishingTurn)return;
      active.completed=true;active.finishingTurn=true;
      this.enqueue(active,async()=>{
        if(runtime==='claude'&&!active.userStopped)await this.refreshTitle(id);
        let final:Message|undefined;
        await this.update(id,session=>{
          session.nativeTurnStatus=status;
          if(status==='failed')session.nativeError=(active.upstreamDiagnostic?diagnosticLabel(active.upstreamDiagnostic):error?nativeTurnFailure(runtime,error):active.runtimeFailure??nativeTurnFailure(runtime,{}))+'可以手动发送新消息；不会自动重发旧请求。';
          else if(session.nativeError===active.retryNotice)session.nativeError=undefined;
          const last=session.messages.filter(message=>message.role==='assistant'&&message.nativeTurnId===session.nativeTurnId).at(-1);
          if(last){last.nativeTurnEnd=true;if(status==='completed'&&(runtime==='claude'||!last.phase))last.phase='final';final=structuredClone(last);}
          if(!active.stopping)session.status='idle';
        });
        if(final)this.hooks.translate(id,final);
        active.finishingTurn=false;release();
      });
    };
    const childEvent=(event:Parameters<NativeChildLifecycle['observe']>[0])=>{active.children.observe(event);release();};
    active.process.on('fault', failed); active.process.on('disconnect', () => { if (!active.sent||!active.completed||active.children.pending) failed(Error('NATIVE_PROCESS_DISCONNECTED')); });
    active.abort.signal.addEventListener('abort', () => { failed(Error('NATIVE_TURN_CANCELLED')); void active.process?.stop('native-provider-stop').catch(()=>{}); }, { once: true });
    if (runtime === 'codex') {
      const rpc = active.rpc = new CodexRpcClient(active.process, id); await this.hooks.observe(id, rpc);
      rpc.on('childAgent',childEvent);
      const calls = new Set<string>();
      rpc.on('serverRequest', (frame: NativeFrame) => {
        const p = obj(frame.value.params), requestId = frame.value.id as RpcId;
        if (!active.sent || !rpc.isBoundThread(p.threadId)) { void rpc.rejectServerRequest(requestId,-32602,'Native request is outside the active bound session.').catch(failed); return; }
        if (frame.value.method === 'item/tool/call') {
          const valid = typeof p.callId === 'string' && !calls.has(p.callId) && !p.namespace; if (valid) calls.add(p.callId);
          void (async () => { try { if (!valid) throw Error('INVALID_TOOL_CALL_ID'); await rpc.replyDynamicTool(requestId, JSON.stringify(await peers.call(p.tool, p.arguments, active.abort.signal)), true); } catch { await rpc.replyDynamicTool(requestId, 'WORKBENCH_TOOL_REJECTED', false); } })().catch(failed);
        } else if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(String(frame.value.method))) {
          const kind=frame.value.method==='item/fileChange/requestApproval'?'file':'command';
          active.approvals.set(requestId, p); this.enqueue(active, () => this.update(id, session => { session.nativeApprovals ??= []; session.nativeApprovals.push({ id: requestId, threadId:p.threadId, turnId: String(p.turnId), kind, ...approvalFields('codex',p,kind,randomUUID()) }); }));
        } else if(frame.value.method==='currentTime/read') {void rpc.replyCurrentTime(requestId).catch(failed);}
        else {
          const item=codexInteraction(String(frame.value.method),p,requestId,frame.receivedAt);
          if(item){active.approvals.set(requestId,p);this.enqueue(active,()=>this.update(id,session=>putInteraction(session,item)));}
          else {this.enqueue(active,()=>this.update(id,session=>putInteraction(session,{id:requestId,method:String(frame.value.method),threadId:p.threadId,turnId:p.turnId,kind:'unsupported',status:'unsupported',blocking:false,receivedAt:frame.receivedAt,title:String(frame.value.method)})));void rpc.rejectServerRequest(requestId).catch(failed);}
        }
      });
      rpc.on('raw', (frame: NativeFrame) => {
        if (active.userStopped) return;
        const p = obj(frame.value.params), item = obj(p.item);
        if (session.binding.localAccountId && frame.value.method === 'account/rateLimits/updated') this.enqueue(active, () => this.accounts!.observeQuota(session.binding.localAccountId!, codexUsage(p, session.binding.localAccountId!)));
        if(frame.value.method==='serverRequest/resolved'){
          active.approvals.delete(p.requestId);this.enqueue(active,()=>this.update(id,session=>{session.nativeApprovals=session.nativeApprovals?.filter(a=>a.id!==p.requestId);const i=session.nativeInteractions?.find(i=>i.id===p.requestId&&i.status==='pending');if(i)i.status='expired';}));return;
        }
        if(frame.value.method==='turn/completed'&&rpc.isBoundThread(p.threadId)){
          for(const [requestId,request] of active.approvals)if(request.threadId===p.threadId&&(!request.turnId||request.turnId===p.turn?.id))active.approvals.delete(requestId);
          this.enqueue(active,()=>this.update(id,session=>{expireInteractions(session,'expired',p.threadId,p.turn?.id);session.nativeApprovals=session.nativeApprovals?.filter(a=>a.threadId!==p.threadId||a.turnId!==p.turn?.id);}));
        }
        if (frame.value.method === 'thread/name/updated') {
          if (p.threadId === active.threadId) this.enqueue(active, () => this.update(id, session => { if (!active.userStopped && this.active.get(id) === active) sessionPresentation.codex(session, active.threadId, frame.value); }));
          return;
        }
        if (p.threadId && p.threadId !== active.threadId) return;
        if(active.retryPending&&p.turnId===active.turnId&&nativeResponseRecovered('codex',frame)){
          const notice=active.retryNotice;active.retryPending=false;active.retryNotice=undefined;active.runtimeFailure=undefined;active.upstreamDiagnostic=undefined;
          this.enqueue(active,()=>this.update(id,s=>{if(s.nativeError===notice)s.nativeError=undefined;}));
        }
        if (['item/agentMessage/delta','item/plan/delta'].includes(String(frame.value.method))) this.appendText(id, active, String(p.itemId), String(p.delta ?? ''));
        else if (frame.value.method === 'item/completed' && ['agentMessage','plan'].includes(item.type)) this.enqueue(active, () => this.message(id, String(item.id), String(item.text ?? ''), true, item.type==='plan'||item.phase === 'final_answer' ? 'final' : item.phase==='commentary'?'commentary':undefined,item.questions,undefined,item.type==='plan',item.type==='agentMessage'?item.memoryCitation:undefined));
        else if(frame.value.method==='turn/plan/updated'){const plan=planUpdate(p);if(plan)this.enqueue(active,()=>this.update(id,session=>{session.nativePlan=plan;}));}
        else if (frame.value.method === 'thread/tokenUsage/updated') { const usage = parseContextUsage(p.tokenUsage, frame.receivedAt, p.turnId); if (usage) this.enqueue(active, () => this.update(id, session => { nativeContextState.observe(session,connection?providerContextUsage(model,usage):usage); })); }
        else if (frame.value.method === 'turn/started') { active.turnId = p.turn?.id; this.enqueue(active, () => this.update(id, session => { session.nativeTurnId = active.turnId;if(command){const message=session.messages.find(m=>m.id===active.previewId);if(message)message.nativeTurnId=active.turnId;} })); }
        else if (frame.value.method === 'error' && (!p.turnId || !active.turnId || p.turnId===active.turnId)) {
          active.runtimeFailure=nativeTurnFailure('codex',p.error);
          const notice=(p.willRetry?'原生运行时正在重试：':'原生运行时报告错误，等待结束回执：')+(active.upstreamDiagnostic?diagnosticLabel(active.upstreamDiagnostic):active.runtimeFailure);
          active.retryNotice=notice;active.retryPending=p.willRetry===true;this.enqueue(active,()=>this.update(id,session=>{session.nativeError=notice;}));
        }
        else if (frame.value.method === 'turn/completed' && (!active.turnId || p.turn?.id===active.turnId)) { ['completed','interrupted','failed'].includes(p.turn?.status) ? finishRoot(p.turn.status,p.turn.error) : failed(Error('NATIVE_TURN_RESULT_UNKNOWN')); }
      });
      await active.process.start(); await rpc.initialize();
      const params = { ...launch.thread, cwd, deferGoalContinuation:true, dynamicTools: peers.definitions.map(tool => ({ type: 'function', ...tool, deferLoading: false })) };
      const fork=!session.binding.nativeSessionId?session.branch?.native:undefined;
      const result = await rpc.request<any>(session.binding.nativeSessionId ? 'thread/resume' : fork ? 'thread/fork' : 'thread/start', { ...params, ...(session.binding.nativeSessionId ? { threadId: session.binding.nativeSessionId } : fork ? {threadId:fork.threadId,...(fork.lastTurnId?{lastTurnId:fork.lastTurnId}:{beforeTurnId:fork.beforeTurnId}),excludeTurns:true,deferGoalContinuation:true} : {}) });
      if (!result.thread?.id || session.binding.nativeSessionId && result.thread.id !== session.binding.nativeSessionId) throw Error('NATIVE_THREAD_MISMATCH');
      if(fork&&(result.thread.id===fork.threadId||result.thread.forkedFromId!==fork.threadId))throw Error('NATIVE_FORK_IDENTITY_MISMATCH');
      active.threadId = result.thread.id; rpc.bindRootThread(result.thread.id);
      await this.update(id, current => { current.binding.nativeSessionId = active.threadId; if (!active.userStopped && this.active.get(id) === active) sessionPresentation.nativeTitle(current, result.thread.name); });
    } else {
      active.claudeControl = new ClaudeControlClient(active.process);
      const source = new EventEmitter(), children = new ClaudeNativeChildTracker(), publicText = new NativeChildConversationTracker(), contextUsage = new ClaudeContextUsageTracker(); let sequence = 0;
      await this.hooks.observe(id, source);
      source.on('childAgent',childEvent);
      active.process.on('disconnect', () => source.emit('disconnect'));
      active.process.on('frame', (frame: NativeFrame) => {
        if (active.userStopped) return;
        const value = obj(frame.value);
        if(value.type==='workbench_transport_error'){failed(Error('CLAUDE_REMOTE_STREAM_UNCONFIRMED'));return;}
        if(!value.parent_tool_use_id&&value.session_id&&active.threadId&&value.session_id!==active.threadId){failed(Error('NATIVE_THREAD_MISMATCH'));return;}
        const child = children.observe(frame, active.threadId);
        if (session.binding.localAccountId) {
          const usage = claudeUsage(value, session.binding.localAccountId, this.accounts!.account(session.binding.localAccountId).usage);
          if (usage) this.enqueue(active, () => this.accounts!.observeQuota(session.binding.localAccountId!, usage));
        }
        for (const event of child.events) source.emit('childAgent', event);
        if (child.child) { source.emit('childEvent', { nativeChildId: child.nativeChildId, frame }); if(!['control_request','control_cancel_request'].includes(value.type))return; }
        if (!child.child&&value.session_id) { if (active.threadId && active.threadId !== value.session_id) { failed(Error('NATIVE_THREAD_MISMATCH')); return; } const changed=active.threadId!==value.session_id; active.threadId = value.session_id; if(changed)this.enqueue(active, () => this.update(id, session => { session.binding.nativeSessionId = value.session_id; })); }
        if(!child.child)source.emit('event', normalizeClaudeEvent(frame, id, ++sequence));
        if(!child.child&&value.type==='user'&&active.claudeInputs?.has(value.uuid)){
          active.claudeInputs.delete(value.uuid);
          this.enqueue(active,()=>this.update(id,s=>{const message=s.messages.find(m=>m.id===value.uuid);if(message)message.delivery='accepted';}));
        }
        if(!child.child&&value.type==='system'&&['background_tasks_changed','session_state_changed'].includes(value.subtype)){active.children.observeFrame(frame);release();}
        if(value.type==='control_response')return;
        if (value.type === 'stream_event' && !active.completed) {
          const update = publicText.observe('claude', 'root', frame);
          if (update?.append && update.text) this.appendText(id, active, 'claude-stream:' + update.id, update.text, 'commentary');
        }
        if(!child.child&&value.type==='system'&&value.subtype==='init')this.enqueue(active,()=>this.refreshTitle(id));
        const reported = value.type === 'system' ? claudeReportedPermission(value.permissionMode) : undefined;
        if (!child.child && reported) this.enqueue(active, () => this.update(id, session => {
          session.permissionMode = reported;
          if (session.nativeActiveSettings) session.nativeActiveSettings.permissionMode = reported;
        }));
        const used = contextUsage.observe(value);
        if (used !== undefined) this.enqueue(active, () => this.update(id, session => { nativeContextState.observe(session,{ used, total: used, capacity: connection ? model.contextWindow ?? null : session.nativeContextUsage?.capacity ?? model.contextWindow ?? null, runtimeCapacity: session.nativeContextUsage?.runtimeCapacity, updatedAt: frame.receivedAt, turnId: active.previewId }); }));
        if (value.type === 'control_cancel_request') {
          active.approvals.delete(value.request_id);this.enqueue(active,()=>this.update(id,session=>{session.nativeApprovals=session.nativeApprovals?.filter(a=>a.id!==value.request_id);const i=session.nativeInteractions?.find(i=>i.id===value.request_id&&i.status==='pending');if(i)i.status='expired';}));
        } else if (value.type === 'control_request') {
          if(!active.sent||!isRequestId(value.request_id)||active.approvals.has(value.request_id)||active.approvals.size>=128){failed(Error('INVALID_NATIVE_CONTROL_REQUEST'));return;}
          const request=obj(value.request),item=claudeInteraction(request,value.request_id,child.nativeChildId??active.threadId??'',active.previewId!,frame.receivedAt);
          if(item){active.approvals.set(value.request_id,request);this.enqueue(active,()=>this.update(id,session=>putInteraction(session,item)));}
          else if(request.subtype==='can_use_tool'){
            const name=claudeToolSemanticName(request.tool_name??'');
            const kind=name==='ExitPlanMode'?'plan':['Bash','PowerShell'].includes(name)?'command':['Edit','Write','NotebookEdit'].includes(name)?'file':'tool';
            active.approvals.set(value.request_id,request);this.enqueue(active,()=>this.update(id,session=>{session.nativeApprovals??=[];session.nativeApprovals.push({id:value.request_id,threadId:child.nativeChildId??active.threadId,turnId:active.previewId!,kind,...approvalFields('claude',request,kind,randomUUID())});}));
          } else {this.enqueue(active,()=>this.update(id,session=>putInteraction(session,{id:value.request_id,method:'claude/'+String(request.subtype),threadId:active.threadId??'',turnId:active.previewId!,kind:'unsupported',status:'unsupported',blocking:false,receivedAt:frame.receivedAt,title:String(request.subtype)})));void active.process!.write({type:'control_response',response:{subtype:'error',request_id:value.request_id,error:'This native control request is not supported by Agent Workbench.'}}).catch(failed);}
        } else if (value.type === 'assistant') {
          for(const part of Array.isArray(value.message?.content)?value.message.content:[])if(part?.type==='tool_use'&&part.name==='TodoWrite'&&Array.isArray(part.input?.todos)){const plan=planUpdate({threadId:active.threadId,turnId:active.previewId!,plan:part.input.todos.map((todo:any)=>({step:todo.content,status:todo.status==='in_progress'?'inProgress':todo.status}))});if(plan)this.enqueue(active,()=>this.update(id,session=>{session.nativePlan=plan;}));}
          const text = (Array.isArray(value.message?.content) ? value.message.content : []).filter((part: any) => part?.type === 'text'&&typeof part.text==='string').map((part: any) => part.text).join('\n');
          if (text) this.enqueue(active, () => this.message(id, value.uuid ?? value.message.id, text, true, 'commentary', undefined, typeof value.message?.id === 'string' ? 'claude-stream:' + value.message.id : undefined));
        } else if (value.type === 'result') {
          const outcome=claudeResultOutcome(value);if(!outcome){failed(Error('CLAUDE_RESULT_UNSUPPORTED'));return;}
          if(remote&&active.quotaHandle){const tokens=parseTokenCounts(value.usage,'anthropic-messages').totalTokens;if(tokens!==null){active.quotaTokens=(active.quotaTokens??0)+tokens;this.hooks.quota?.observe(id,{total:{totalTokens:active.quotaTokens},last:{totalTokens:tokens}});}}
          const reported=claudeContextCapacity(value,launch.runtimeModel??model.model);
          if(reported!==undefined)this.enqueue(active,()=>this.update(id,session=>{if(session.nativeContextUsage){session.nativeContextUsage.runtimeCapacity=reported;if(!connection)nativeContextState.capacity(session,reported);}}));
          this.enqueue(active,()=>this.update(id,session=>{expireInteractions(session,'expired',active.threadId,active.previewId);session.nativeApprovals=session.nativeApprovals?.filter(a=>a.threadId!==active.threadId||a.turnId!==active.previewId);}));
          // A stream input can be consumed after this result. Keep the owned
          // process and logical operation alive until every explicit input has
          // a matching native echo; never terminate it at the earlier result.
          if(outcome==='completed'&&active.claudeInputs?.size)return;
          if(outcome==='failed'&&active.claudeInputs?.size){active.claudeInputs.clear();this.enqueue(active,()=>this.update(id,s=>{for(const message of s.messages)if(message.delivery==='pending')message.delivery='uncertain';}));}
          finishRoot(outcome,value);
        }
      });
      active.threadId = session.binding.nativeSessionId??(session.branch?.native?.runtime==='claude'?session.id:undefined); await active.process.start();
    }
    active.startTurn=async(preview:DraftPreview)=>{
      if(active.stopping||active.finishingTurn)throw Error('NATIVE_PROCESS_NOT_READY');
      const current=this.session(id);this.assertAllowed(current);
      active.completed=false;active.previewId=preview.id;active.turnId=undefined;active.upstreamDiagnostic=undefined;active.runtimeFailure=undefined;active.retryNotice=undefined;
      try {
        if(active.launchKey!==this.launchKey(current))throw Error('NATIVE_PREPARATION_CHANGED');
        active.abort.signal.throwIfAborted();
        if(remote&&this.hooks.quota&&!active.quotaHandle){const handle={threadId:preview.id};await this.hooks.quota.begin(current,handle);active.quotaHandle=handle;active.quotaTokens=0;active.abort.signal.throwIfAborted();}
        const files=preview.attachments?.length?await this.hooks.attachments?.payloads(preview.attachments.map(file=>file.id),{channel:this.session(id).binding.runtime==='claude'?'api':'native'}):[];if(!files)throw Error('ATTACHMENTS_UNAVAILABLE');
        const context=command?undefined:initialContext??this.hooks.context(id);initialContext=undefined;
        const input=command?'/compact':attachmentPrompt(preview.translated,files)+(!current.binding.nativeSessionId&&!current.branch?.native||current.handoffFromMessage!==undefined?visibleHandoff(current,current.handoffFromMessage??0):'')+await context;
        await this.update(id,session=>{
          session.status='running';session.nativeError=undefined;session.nativePlan=undefined;
          session.projectPath=cwd;if(active.threadId)session.binding.nativeSessionId=active.threadId;
          session.nativeTurnId=runtime==='claude'?preview.id:undefined;
          session.nativeTurnStatus=undefined;session.nativeActiveSettings={permissionMode:session.permissionMode??'default',modelSelection:session.modelSelection};
          session.messages.push({id:preview.id,role:'user',original:preview.original,submitted:preview.translated,annotations:preview.annotations,attachments:preview.attachments,skills:preview.skills,draftRevisions:preview.revisions,nativeTurnId:runtime==='claude'?preview.id:undefined,timestamp:new Date().toISOString(),demo:false,modelSource:sourceLabel(session,this.hooks.snapshot())});
          if(session.messages.length===1&&!session.branch&&!session.agentCreated)sessionPresentation.fallback(session,(preview.original||preview.skills?.[0]?.displayName||preview.attachments?.[0]?.name||'附件').slice(0,28));delete session.handoffFromMessage;delete session.forkDraft;delete session.forkSkills;delete session.forkAttachments;
        });
        active.sent=true;
        if(runtime==='codex'){
          if(command==='compact'){await active.rpc!.request('thread/compact/start',{threadId:active.threadId});return;}
          const effort=current.modelSelection?.effort;
          const result=await active.rpc!.request<any>('turn/start',{threadId:active.threadId,input:[{type:'text',text:input},...nativeAttachmentImages(files),...codexSkillInputs(preview.skills)],...codexTurnPermissionParams(current.permissionMode),...codexCollaborationParams(current.collaborationMode,{model:model.model,effort}),model:model.model,...(effort?{effort}:{})});
          active.turnId=result.turn?.id;
          await this.update(id,session=>{session.nativeTurnId=active.turnId;const message=session.messages.find(m=>m.id===preview.id);if(message)message.nativeTurnId=active.turnId;});
        }else await active.process!.write({type:'user',uuid:preview.id,session_id:active.threadId??'',parent_tool_use_id:null,message:{role:'user',content:files.length?[{type:'text',text:input},...(apiAttachmentContent('',files,'anthropic-messages') as Record<string,unknown>[]).slice(1)]:input}});
      }catch(error){failed(error);throw error;}
    };
    if(active.launchKey!==this.launchKey(this.session(id)))throw Error('NATIVE_PREPARATION_CHANGED');
    active.abort.signal.throwIfAborted();active.ready?.();
    if(preview)await active.startTurn(preview);await completion;await active.queue;
  }
  async approval(id: string, requestId: RpcId, reply: BasicApprovalDecision|ApprovalReply) {
    const active = this.active.get(id), request = active?.approvals.get(requestId),approval=this.session(id).nativeApprovals?.find(a=>a.id===requestId);
    if (!active || active.stopping || !request || !approval) throw Error('APPROVAL_EXPIRED');
    const codex=active.rpc?resolveApprovalChoice(approval,reply,codexApprovalChoices(request,approval.kind==='file'?'file':'command')):undefined;
    const claude=active.rpc?undefined:resolveApprovalChoice(approval,reply,claudeApprovalChoices(request));
    active.approvals.delete(requestId);
    try{
      if (active.rpc) await active.rpc.replyApproval(requestId, codex!);
      else await active.process!.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: claudeApprovalResult(request,claude!) } });
    }catch(error){await this.update(id,session=>{session.nativeError='审批回应未确认；不会自动重发。';});throw error;}
    finally{await this.update(id, session => { session.nativeApprovals = session.nativeApprovals?.filter(a => a.receipt !== approval.receipt); });}
  }
  async interaction(id:string,requestId:RpcId,reply:InteractionReply){
    const active=this.active.get(id),request=active?.approvals.get(requestId),item=this.session(id).nativeInteractions?.find(i=>i.id===requestId&&i.status==='pending');
    if(!active||active.stopping||!request||!item)throw Error('此问题已结束或失去连接，答案未发送。');
    const result=interactionResult(item,reply,request);
    active.approvals.delete(requestId);
    try{
      if(active.rpc)await active.rpc.replyInteraction(requestId,reply);
      else await active.process!.write({type:'control_response',response:{subtype:'success',request_id:requestId,response:result}});
      await active.queue;await this.update(id,session=>{const i=session.nativeInteractions?.find(i=>i.receipt===item.receipt);if(i)i.status=reply.action==='submit'?'answered':reply.action==='decline'?'declined':'cancelled';});
    }catch(error){await this.update(id,session=>{const i=session.nativeInteractions?.find(i=>i.receipt===item.receipt);if(i?.status==='pending')i.status='uncertain';session.nativeError='答案回执尚未确认；不会自动重发。';});throw error;}
  }
  async permissions(id: string, mode: PermissionMode) {
    const active = this.active.get(id); if (!active) return;
    if(active.warm){await this.stop(id);return;}
    if (active.stopping) throw Error('NATIVE_PROCESS_STOPPING');
    if (active.claudeControl) await active.claudeControl.permissions(mode);
    else {
      if (!active.rpc || !active.threadId) throw Error('此原生回合暂不支持实时权限切换。');
      await active.rpc.request('thread/settings/update', { threadId: active.threadId, ...codexTurnPermissionParams(mode) });
    }
    await active.queue;
    await this.update(id, session => { session.permissionMode = mode; if (session.nativeActiveSettings) session.nativeActiveSettings.permissionMode = mode; });
  }
  async steer(id: string, preview: DraftPreview, expectedTurnId: string) {
    const active = this.active.get(id),claude=this.session(id).binding.runtime==='claude';
    if (!active || active.stopping || active.completed || (claude?active.previewId:active.turnId) !== expectedTurnId || !(claude?active.process:active.rpc)) throw Error('此原生回合当前不可插入消息。');
    const files = preview.attachments?.length ? await this.hooks.attachments?.payloads(preview.attachments.map(file => file.id),{channel:claude?'api':'native'}) : []; if (!files) throw Error('ATTACHMENTS_UNAVAILABLE');
    if(active.stopping||active.completed)throw Error('此原生回合当前不可插入消息。');
    if(claude)(active.claudeInputs??=new Set()).add(preview.id);
    try {
      await this.update(id, session => { session.messages.push({ id: preview.id, role: 'user', original: preview.original, submitted: preview.translated, annotations: preview.annotations, attachments: preview.attachments, skills: preview.skills, draftRevisions: preview.revisions, timestamp: new Date().toISOString(), demo: false, nativeTurnId: expectedTurnId, delivery: 'pending', modelSource: sourceLabel(session,this.hooks.snapshot()) }); });
      if(active.stopping||active.completed)throw Error('FOLLOW_UP_TURN_ENDED');
      if(claude){const input=attachmentPrompt(preview.translated,files);await active.process!.write({type:'user',uuid:preview.id,session_id:active.threadId??'',parent_tool_use_id:null,message:{role:'user',content:files.length?[{type:'text',text:input},...(apiAttachmentContent('',files,'anthropic-messages') as Record<string,unknown>[]).slice(1)]:input}});}
      else {await active.rpc!.request('turn/steer', { threadId: active.threadId, expectedTurnId, input: [{ type: 'text', text: attachmentPrompt(preview.translated,files) }, ...nativeAttachmentImages(files),...codexSkillInputs(preview.skills)] });await this.update(id, session => { const message=session.messages.find(message=>message.id===preview.id);if(message)message.delivery='accepted'; });}
    }
    catch(error) {active.claudeInputs?.delete(preview.id); await this.update(id, session => { const message=session.messages.find(message=>message.id===preview.id);if(message)message.delivery='uncertain';session.nativeError='插入消息回执未确认；工作台没有自动重发。'; }); throw error; }
  }
  async stop(id: string) { const active = this.active.get(id); if (!active) return { stopped: false }; active.stoppedActivityIds ??= new Set(this.session(id).activities?.filter(item=>item.status==='running').map(item=>item.id)); active.userStopped = true; active.stopping = true; active.abort.abort(); await active.done; if(this.session(id).status==='uncertain')throw Error('NATIVE_STOP_UNCONFIRMED'); return { stopped: true, scope: 'owned-native-process' }; }
}
