import { EventEmitter } from 'node:events';
import { isRuntimeNotice } from '../collaboration-core/runtime-notices';
import type { Capability, NativeEvent, PermissionMode, SessionBinding, SshHost } from '../contracts/index.js';
import { resolvePermissionMode } from '../session-core/permissions.js';
import { codexCollaborationParams, type CollaborationMode } from '../session-core/planning.js';
import { assertBridgeReady, freezeSessionBinding, NativeSharedContextSession, type SharedContextOptions, type BridgeEvidence, type SessionLeaseRegistry, type SubmissionLedger, type WriterLease } from '../session-core/index.js';
import { createRemoteSupervisor, deepFreeze, type NativeFrame, type ProcessSupervisor, type NativeProcessTransport } from '../../services/remote-supervisor/index.js';
import { buildNativeAgentPolicyPlan, type NativeAgentPolicy } from '../collaboration-core/native-policy.js';
import { parseCodexNativeChildEvents } from '../collaboration-core/events.js';
import { NativePeerContextSession, type PreparedPeerInput } from '../collaboration-core/native-inbox.js';
import type { createPeerTools } from '../collaboration-core/tools.js';
import { codexInteraction, interactionResult, type InteractionReply } from '../native-interactions/index.js';

export const CODEX_DEFERRED_BASELINE = '0.155.1' as const;
export type RpcId = string | number;
export type ApprovalDecision = import('../native-approvals').CodexApprovalDecision;
import { assertCodexApprovalDecision } from '../native-approvals';
interface PendingRequest {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
export class NativeRequestUncertainError extends Error {
  constructor(readonly method: string, reason: string) { super(`${method}: ${reason}; do not replay without native reconciliation`); this.name = 'NativeRequestUncertainError'; }
}
export class NativeRpcError extends Error {
  constructor(readonly code: number | undefined, message: string) { super(message); this.name = 'NativeRpcError'; }
}
/** Only the trusted gateway can confirm rejection before the native model write. */
export class NativeAdmissionRejectedError extends NativeRpcError {}
const idKey = (id: RpcId) => `${typeof id}:${id}`;
const isId = (value: unknown): value is RpcId => typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';

/** Version-neutral JSONL RPC mechanics. No credentials, network proxy or agent loop. */
export class CodexRpcClient extends EventEmitter {
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly approvals = new Map<string, NativeFrame>();
  private initialized = false;
  private initializationAttempted = false;
  private disconnected = false;
  private sequence = 0;
  private nativeRootThreadId?: string;
  private readonly nativeChildThreadIds = new Set<string>();

  constructor(readonly transport: NativeProcessTransport, readonly sessionId: string, readonly requestTimeoutMs = 30_000) {
    super();
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error('RPC timeout must be a positive integer');
    transport.on('frame', (frame: NativeFrame) => this.receive(frame));
    transport.on('disconnect', () => this.failPending('transport disconnected'));
    transport.on('fault', (error: Error) => this.emit('fault', error));
  }

  async initialize(client = { name: 'agent_workbench', title: 'Agent Workbench', version: '0.1.0' }): Promise<unknown> {
    if (this.initializationAttempted) throw new Error('Initialize is only permitted once per connection');
    this.initializationAttempted = true;
    const result = await this.sendRequest('initialize', { clientInfo: client, capabilities: { experimentalApi: true } });
    await this.transport.write({ method: 'initialized', params: {} });
    this.initialized = true;
    return result;
  }

  request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (!this.initialized || this.disconnected) return Promise.reject(new Error('Native RPC is not initialized and connected'));
    if (method === 'initialize') return Promise.reject(new Error('Use initialize once'));
    return this.sendRequest(method, params) as Promise<T>;
  }

  bindRootThread(threadId: string): void {
    if (!threadId || (this.nativeRootThreadId && this.nativeRootThreadId !== threadId)) throw new Error('Native root thread identity cannot change on this connection');
    this.nativeRootThreadId = threadId;
    this.nativeChildThreadIds.delete(threadId);
  }
  isBoundThread(threadId: string): boolean { return !!threadId && (threadId === this.nativeRootThreadId || this.nativeChildThreadIds.has(threadId)); }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    if (this.disconnected) return Promise.reject(new Error('Native RPC disconnected'));
    if (!method || /[\0\r\n]/.test(method)) return Promise.reject(new Error('Invalid RPC method'));
    if (this.pending.size >= 256) return Promise.reject(new Error('Too many pending native requests'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(idKey(id));
        const error = new NativeRequestUncertainError(method, 'response timed out');
        this.emit('uncertain', { id, method }); reject(error);
      }, this.requestTimeoutMs);
      this.pending.set(idKey(id), { method, timer, resolve, reject });
      void this.transport.write({ id, method, params }).catch(() => {
        const pending = this.pending.get(idKey(id));
        if (!pending) return;
        this.pending.delete(idKey(id)); clearTimeout(timer);
        reject(new NativeRequestUncertainError(method, 'write failed'));
      });
    });
  }

  private receive(frame: NativeFrame): void {
    this.emit('raw', frame);
    const msg = frame.value;
    for (const event of parseCodexNativeChildEvents(frame)) {
      if (event.nativeChildId === this.nativeRootThreadId) continue;
      if (this.nativeRootThreadId && event.nativeParentId !== this.nativeRootThreadId && !this.nativeChildThreadIds.has(event.nativeParentId ?? '')) continue;
      this.nativeChildThreadIds.add(event.nativeChildId);
      this.emit('childAgent', event);
    }
    if (typeof msg.method === 'string') {
      if (isId(msg.id)) {
        if (this.approvals.size >= 128 || this.approvals.has(idKey(msg.id))) {
          this.emit('fault', new Error('Duplicate or excessive native server requests'));
          void this.transport.stop('server-request-protocol-failure'); return;
        }
        this.approvals.set(idKey(msg.id), frame);
        this.emit('serverRequest', frame);
      } else if (msg.id !== undefined) {
        this.emit('fault', new Error('Invalid native server request ID'));
        void this.transport.stop('invalid-request-id'); return;
      }
      if (msg.method === 'serverRequest/resolved') {
        const requestId = object(msg.params).requestId;
        if (isId(requestId)) this.approvals.delete(idKey(requestId));
      }
      if (msg.method === 'turn/completed' || msg.method === 'turn/started') {
        const p = object(msg.params), turnId = object(p.turn).id;
        for (const [key, pending] of this.approvals) {
          const scope = object(pending.value.params);
          if (scope.threadId === p.threadId && (msg.method === 'turn/completed' ? !scope.turnId || scope.turnId === turnId : scope.turnId && scope.turnId !== turnId)) this.approvals.delete(key);
        }
      }
      const params=object(msg.params);
      const threadId = text(params.threadId) || (msg.method==='thread/started'?text(object(params.thread).id):'');
      const child = !!threadId && ((!!this.nativeRootThreadId && threadId !== this.nativeRootThreadId) || this.nativeChildThreadIds.has(threadId));
      if(child&&this.nativeChildThreadIds.has(threadId)&&msg.method==='turn/completed'){
        const status=text(object(object(msg.params).turn).status);
        if(['completed','failed','interrupted'].includes(status))this.emit('childAgent',{runtime:'codex',nativeChildId:threadId,operation:status==='completed'?'completed':status==='failed'?'failed':'closed',status});
      }
      if (child && this.nativeChildThreadIds.has(threadId)) this.emit('childEvent', { nativeThreadId: threadId, frame });
      this.emit('event', normalizeCodexEvent(frame, this.sessionId, ++this.sequence, child));
      return;
    }
    if (!isId(msg.id)) { this.emit('fault', new Error('Native response is missing an ID')); void this.transport.stop('invalid-response'); return; }
    const pending = this.pending.get(idKey(msg.id));
    if (!pending) { this.emit('lateResponse', frame); return; }
    this.pending.delete(idKey(msg.id)); clearTimeout(pending.timer);
    if (Object.hasOwn(msg, 'error')) {
      const error = object(msg.error);
      const admission=pending.method==='turn/start'&&error.code===-32071&&object(error.data).errorSource==='workbench-account-gate'&&object(error.data).notSubmitted===true;
      pending.reject(new (admission?NativeAdmissionRejectedError:NativeRpcError)(typeof error.code === 'number' ? error.code : undefined, text(error.message) || 'Native RPC error'));
    } else if (Object.hasOwn(msg, 'result')) pending.resolve(msg.result);
    else pending.reject(new NativeRequestUncertainError(pending.method, 'malformed response'));
  }

  pendingApprovals(): ReadonlyArray<NativeFrame> { return [...this.approvals.values()]; }

  async replyInteraction(id: RpcId, reply: InteractionReply): Promise<void> {
    const frame = this.approvals.get(idKey(id));
    if (!frame) throw Error('Native interaction is unknown or already resolved.');
    const item = codexInteraction(String(frame.value.method), frame.value.params, id, frame.receivedAt);
    if (!item || !this.isBoundThread(item.threadId)) throw Error('Native interaction does not belong to this connection.');
    const result = interactionResult(item, reply, frame.value.params);
    this.approvals.delete(idKey(id));
    await this.transport.write({ id, result });
  }

  async rejectServerRequest(id: RpcId, code = -32601, message = 'This native client request is not supported by Agent Workbench.'): Promise<void> {
    if (!this.approvals.has(idKey(id))) throw Error('Native request is unknown or already resolved.');
    this.approvals.delete(idKey(id));
    await this.transport.write({ id, error: { code, message } });
  }

  async replyCurrentTime(id: RpcId): Promise<void> {
    const frame = this.approvals.get(idKey(id));
    if (frame?.value.method !== 'currentTime/read' || !this.isBoundThread(text(object(frame.value.params).threadId))) throw Error('Native time request does not belong to this connection.');
    this.approvals.delete(idKey(id));
    await this.transport.write({ id, result: { currentTimeAt: Math.floor(Date.now() / 1000) } });
  }

  async replyDynamicTool(id: RpcId, text: string, success: boolean): Promise<void> {
    const frame = this.approvals.get(idKey(id));
    if (!frame || frame.value.method !== 'item/tool/call') throw new Error('Dynamic tool request is unknown or already resolved.');
    this.approvals.delete(idKey(id));
    await this.transport.write({ id, result: { contentItems: [{ type: 'inputText', text }], success } });
  }

  async replyApproval(id: RpcId, decision: ApprovalDecision): Promise<void> {
    const frame = this.approvals.get(idKey(id));
    if (!frame) throw new Error('Approval is unknown or already resolved');
    if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(String(frame.value.method))) throw new Error('This server request needs a version-specific response; generic approval is forbidden');
    assertCodexApprovalDecision(object(frame.value.params), frame.value.method === 'item/fileChange/requestApproval' ? 'file' : 'command', decision);
    // Do not retry an ambiguous reply. A native resolved notification or fresh state is required.
    this.approvals.delete(idKey(id));
    await this.transport.write({ id, result: { decision } });
  }

  private failPending(reason: string): void {
    this.disconnected = true; this.initialized = false; this.approvals.clear();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new NativeRequestUncertainError(pending.method, reason)); }
    this.pending.clear(); this.emit('disconnect', reason);
  }
}

export function normalizeCodexEvent(frame: NativeFrame, sessionId: string, sequence: number, child = false): NativeEvent {
  const method = text(frame.value.method);
  const params = object(frame.value.params);
  const item = object(params.item);
  let eventType: NativeEvent['type'] = 'progress';
  let display = '';
  let isPublic = false;
  if (child) { /* Child output retains native identity on childEvent, not the parent stream. */ }
  else if (method === 'item/agentMessage/delta') { display = text(params.delta); isPublic = true; }
  else if (method === 'item/completed' && item.type === 'agentMessage') {
    display = text(item.text); isPublic = true; eventType = item.phase === 'final_answer' ? 'final' : 'progress';
  } else if (method === 'turn/completed') {
    eventType = ['completed','interrupted'].includes(String(object(params.turn).status)) ? 'final' : 'error'; isPublic = true;
  } else if (method === 'error') { eventType = 'error'; display = text(object(params.error).message); isPublic = true; }
  else if (method.endsWith('/requestApproval')) { eventType = 'approval'; isPublic = true; }
  else if (isRuntimeNotice('codex',frame)||['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall', 'webSearch', 'imageView', 'subAgentActivity','contextCompaction','imageGeneration','reasoning','sleep','enteredReviewMode','exitedReviewMode','hookPrompt','functionCallOutput'].includes(text(item.type)) || ['item/commandExecution/outputDelta','item/fileChange/outputDelta','item/fileChange/patchUpdated'].includes(method)) { eventType = 'tool'; isPublic = true; }
  // Reasoning/signatures/opaque native state are archived, never translated or exposed as public text.
  return { id: `codex:${sessionId}:${sequence}`, sessionId, sequence, revision: 1, type: eventType, text: display, timestamp: frame.receivedAt, public: isPublic, raw: frame };
}

export interface CodexEnvironment { environmentId: string; cwd: string }
/** Exact spellings come from the official rust-v0.155.1 protocol schema, not current-doc examples. */
export function codexThreadPermissionParams(value:PermissionMode='default'){
  const mode=resolvePermissionMode('codex',value);
  return {approvalPolicy:mode==='default'?'on-request' as const:'never' as const,sandbox:mode==='full-access'?'danger-full-access' as const:'read-only' as const};
}
export function codexTurnPermissionParams(value:PermissionMode='default'){
  const mode=resolvePermissionMode('codex',value);
  return {approvalPolicy:mode==='default'?'on-request' as const:'never' as const,sandboxPolicy:mode==='full-access'?{type:'dangerFullAccess' as const}:{type:'readOnly' as const,networkAccess:false}};
}
export function buildDeferredAppServerArgs(version: string, nativeAgentPolicy?: NativeAgentPolicy): string[] {
  if (version !== CODEX_DEFERRED_BASELINE) throw new Error('Deferred executor is pinned to 0.155.1; regenerate and verify the target schema before upgrading');
  // Keep native CLI auth storage. The old plugin broker/ephemeral-auth override is intentionally not migrated.
  return ['-c', 'features.deferred_executor=true', '-c', 'features.default_mode_request_user_input=true', '-c', 'features.memories=false', '-c', 'memories.generate_memories=false', '-c', 'memories.use_memories=false', ...buildNativeAgentPolicyPlan('codex', version, nativeAgentPolicy).args, 'app-server', '--listen', 'stdio://'];
}

export function environmentRegistration(environmentId: string, execServerUrl: string): Record<string, unknown> {
  if (!environmentId || /[\0\r\n]/.test(environmentId)) throw new Error('Invalid environment ID');
  const endpoint = new URL(execServerUrl);
  if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^\/[a-f0-9]{64}$/.test(endpoint.pathname)) throw new Error('Executor endpoint must be an authenticated loopback URL');
  return { environmentId, execServerUrl, connectTimeoutMs: 3000 };
}

export function executionEnvironment(environment: CodexEnvironment): CodexEnvironment {
  if (!environment.environmentId || /[\0\r\n]/.test(environment.environmentId) || /[\0\r\n]/.test(environment.cwd) || !(/^[A-Za-z]:[\\/]/.test(environment.cwd) || environment.cwd.startsWith('/') || /^\\\\[^\\]+\\[^\\]+/.test(environment.cwd))) throw new Error('Explicit absolute execution cwd is required');
  // No current-workspace-only root is appended: owner-wide policy belongs to the approved executor boundary.
  return Object.freeze({ ...environment });
}

export class CodexNativeAdapter {
  readonly binding: Readonly<SessionBinding>;
  readonly environment: Readonly<CodexEnvironment>;
  readonly evidence?: BridgeEvidence;
  sharedContext: NativeSharedContextSession;
  private readonly memoryHandoff?: SharedContextOptions['memoryHandoff'];
  private threadId?: string;
  private threadModel?: string;
  private registered = false;
  private requestedPermissionMode:PermissionMode;
  private pendingThreadOperation=false;
  private activeTurnId?:string;
  private turnRequestPending=false;
  private completedDuringStart?:string;
  private turnUncertain=false;
  get permissionMode(){return this.requestedPermissionMode;}
  constructor(readonly rpc: CodexRpcClient, binding: SessionBinding, environment: CodexEnvironment, evidence?: BridgeEvidence, readonly version = CODEX_DEFERRED_BASELINE, sharedContext: SharedContextOptions = {}, permissionMode:PermissionMode='default', readonly peerContext?: NativePeerContextSession, readonly peerTools?: ReturnType<typeof createPeerTools>, readonly developerInstructions?:string) {
    if (binding.runtime !== 'codex') throw new Error('Codex adapter requires Codex runtime');
    this.binding = freezeSessionBinding(binding);
    this.environment = executionEnvironment(environment);
    this.evidence = evidence ? deepFreeze(structuredClone(evidence)) : undefined;
    this.sharedContext = new NativeSharedContextSession(rpc.sessionId, sharedContext);
    this.memoryHandoff = sharedContext.memoryHandoff;
    if (this.memoryHandoff && (this.memoryHandoff.runtime !== 'codex' || this.memoryHandoff.sessionId !== rpc.sessionId)) throw Error('Memory handoff belongs to another runtime or session.');
    if (binding.nativeSessionId) this.sharedContext.assertResumeSafe();
    if (environment.environmentId !== binding.executionId) throw new Error('Execution environment does not match frozen session');
    this.threadId = binding.nativeSessionId;
    if (this.threadId) rpc.bindRootThread(this.threadId);
    if (peerContext && peerContext.sessionId !== rpc.sessionId) throw new Error('Peer context belongs to another session');
    if (peerTools && peerTools.sourceSessionId !== rpc.sessionId) throw new Error('Peer tools belong to another session');
    if (peerTools) {
      const pending = new Set<AbortController>(), calls = new Set<string>();
      rpc.on('disconnect', () => { for (const abort of pending) abort.abort(new Error('Native peer transport disconnected.')); });
      rpc.on('serverRequest', (frame: NativeFrame) => {
        if (frame.value.method !== 'item/tool/call') return;
        const params = object(frame.value.params), id = frame.value.id as RpcId;
        if (!text(params.tool).startsWith('workbench_')) return;
        const callId = text(params.callId), abort = new AbortController();
        const valid = !!this.threadId && rpc.isBoundThread(text(params.threadId)) && !!text(params.turnId) && (params.threadId !== this.threadId || this.turnRequestPending || params.turnId === this.activeTurnId) && !params.namespace && !!callId && !calls.has(callId) && calls.size < 10000;
        if (valid) { calls.add(callId); pending.add(abort); }
        void (async () => {
          let result: string, success = false;
          try {
            if (!valid) throw new Error('Peer tool call identity is invalid, duplicated, or at capacity.');
            result = JSON.stringify(await peerTools.call(text(params.tool), params.arguments, abort.signal)); success = true;
          } catch (cause) { result = cause instanceof Error ? cause.message : 'Peer tool call failed.'; }
          finally { pending.delete(abort); }
          await rpc.replyDynamicTool(id, result, success);
        })().catch(() => { this.turnUncertain = true; void rpc.transport.stop('peer-tool-response-uncertain'); });
      });
    }
    this.requestedPermissionMode=resolvePermissionMode('codex',permissionMode);
    rpc.on('raw',(frame:NativeFrame)=>{
      if(frame.value.method!=='turn/completed')return;
      const params=object(frame.value.params),id=object(params.turn).id;
      if(typeof id!=='string'||(params.threadId!==undefined&&params.threadId!==this.threadId))return;
      if(this.activeTurnId===id||this.turnRequestPending)void this.finishMemory();
      if(this.turnRequestPending)this.completedDuringStart=id;
      if(this.activeTurnId===id)this.activeTurnId=undefined;
    });
    rpc.on('disconnect',()=>{if(this.activeTurnId||this.turnRequestPending)this.turnUncertain=true;void this.finishMemory();});
  }

  private async finishMemory(){try{await this.memoryHandoff?.finish();}catch{/* Receipt failures must not replay a native task. */}}

  setPermissionMode(mode:PermissionMode):void{
    const next=resolvePermissionMode('codex',mode);
    if(this.pendingThreadOperation||this.activeTurnId||this.turnRequestPending||this.turnUncertain)throw new Error('Permission mode can change only between confirmed native turns');
    this.requestedPermissionMode=next;
  }

  async updatePermissions(mode:PermissionMode):Promise<void>{
    this.assertReady();const next=resolvePermissionMode('codex',mode);
    if(!this.threadId||this.pendingThreadOperation||this.turnRequestPending||this.turnUncertain)throw Error('Native settings are not ready for a confirmed update.');
    await this.rpc.request('thread/settings/update',{threadId:this.threadId,...codexTurnPermissionParams(next)});
    this.requestedPermissionMode=next;
  }

  async steer(input:string,submissionId:string,expectedTurnId:string,lease:WriterLease,ledger:SubmissionLedger,images:({type:'image';url:string}|{type:'skill';name:string;path:string})[]=[]):Promise<void>{
    this.assertReady();
    if(!this.threadId||!input.trim()||this.turnUncertain||this.activeTurnId!==expectedTurnId||lease.sessionId!==this.rpc.sessionId)throw Error('The expected native turn is no longer active.');
    const params={threadId:this.threadId,expectedTurnId,clientUserMessageId:submissionId,input:[{type:'text',text:input},...images]};
    ledger.begin(submissionId,{nativeRequest:params},lease);
    try{const result=await this.rpc.request<{turnId:string}>('turn/steer',params);if(result.turnId!==expectedTurnId)throw Error('Native steering receipt does not match the expected turn.');ledger.acknowledge(submissionId,result.turnId,lease);}
    catch(error){ledger.uncertain(submissionId);throw error;}
  }

  async registerEnvironment(execServerUrl: string): Promise<unknown> {
    buildDeferredAppServerArgs(this.version);
    await this.rpc.request('environment/add', environmentRegistration(this.environment.environmentId, execServerUrl));
    const info = await this.rpc.request('environment/info', { environmentId: this.environment.environmentId });
    this.registered = true;
    return info;
  }

  private assertReady(): void {
    assertBridgeReady(this.binding, this.version, this.evidence);
    if (!this.registered) throw new Error('Selected executor has not been registered on this connection');
  }

  /** Central account services can pre-create a thread before the local context is known. */
  async attachContextToEmptyThread(options: SharedContextOptions): Promise<void> {
    this.assertReady();
    if (!options.snapshot?.enabled) return;
    if (!this.threadId || this.activeTurnId || this.turnRequestPending || this.turnUncertain || this.sharedContext.receipt || this.sharedContext.snapshot?.enabled) throw Error('Native context can only attach once before the first turn.');
    const result = await this.rpc.request<{data:unknown[];nextCursor?:string|null}>('thread/turns/list', {threadId:this.threadId,limit:1,sortDirection:'desc'});
    if (!Array.isArray(result.data) || result.data.length || result.nextCursor) throw Error('The native thread is not empty; context cannot be silently replaced.');
    this.sharedContext = new NativeSharedContextSession(this.rpc.sessionId, options);
  }

  async startThread(model?: string): Promise<unknown> {
    this.assertReady();
    if (this.threadId) throw new Error('Thread identity already exists; resume explicitly');
    if(this.pendingThreadOperation)throw new Error('Native thread operation is already pending');
    this.pendingThreadOperation=true;
    try{
    const result = await this.rpc.request<Record<string, unknown>>('thread/start', {
      ...(model ? { model } : {}), environments: [this.environment], ...codexThreadPermissionParams(this.permissionMode),
      ...(this.developerInstructions ? {developerInstructions:this.developerInstructions}:{}),
      ...(this.peerTools ? { dynamicTools: this.peerTools.definitions.map(tool => ({ type: 'function', ...tool, deferLoading: false })) } : {}),
    });
    const id = object(result.thread).id;
    if (typeof id !== 'string') throw new NativeRequestUncertainError('thread/start', 'native thread ID missing');
    this.rpc.bindRootThread(id); this.threadId = id; this.threadModel = typeof result.model === 'string' ? result.model : model; return result;
    }finally{this.pendingThreadOperation=false;}
  }

  async resumeThread(threadId: string, receipt?:{threadId:string;environmentId:string;cwd:string;runtimeVersion:string;accountRef:string}): Promise<unknown> {
    this.assertReady();
    this.sharedContext.assertResumeSafe();
    if (!threadId || (this.threadId && this.threadId !== threadId)) throw new Error('Cannot replace frozen native thread');
    if(this.pendingThreadOperation||this.activeTurnId||this.turnRequestPending||this.turnUncertain)throw new Error('Native thread operation requires a confirmed turn boundary');
    this.pendingThreadOperation=true;
    try{
    const read = await this.rpc.request<Record<string, unknown>>('thread/read', { threadId, includeTurns: false });
    const saved = object(read.thread);
    const environments = saved.environments;
    const persistedMatch=saved.id===threadId&&receipt?.threadId===threadId&&receipt.environmentId===this.environment.environmentId&&receipt.cwd===this.environment.cwd&&receipt.runtimeVersion===this.version&&receipt.accountRef===this.binding.accountRef;
    // A cold 0.155.1 read can omit the live environment. Only our previously observed,
    // persisted receipt can restore it; an explicitly mismatched native environment still fails.
    if(environments===null||environments===undefined){if(!persistedMatch)throw new Error('Native thread environment is missing or mismatched; no default-directory fallback');}
    else if (!Array.isArray(environments) || environments.length !== 1 || object(environments[0]).environmentId !== this.environment.environmentId || object(environments[0]).cwd !== this.environment.cwd) throw new Error('Native thread environment is missing or mismatched; no default-directory fallback');
    const result = await this.rpc.request('thread/resume', { threadId, deferGoalContinuation:true, environments: [this.environment], ...codexThreadPermissionParams(this.permissionMode), ...(this.developerInstructions?{developerInstructions:this.developerInstructions}:{}) });
    this.rpc.bindRootThread(threadId); this.threadId = threadId; this.threadModel = typeof object(result).model === 'string' ? object(result).model as string : undefined; return result;
    }finally{this.pendingThreadOperation=false;}
  }

  async forkThread(source:import('../contracts').NativeForkSource):Promise<unknown>{
    this.assertReady();this.sharedContext.assertResumeSafe();
    if(this.threadId||this.pendingThreadOperation)throw Error('Native fork requires an unbound target session');
    if(!source.threadId||!!source.lastTurnId===!!source.beforeTurnId)throw Error('An exact native fork boundary is required');
    this.pendingThreadOperation=true;
    try{
      const result=await this.rpc.request<Record<string,unknown>>('thread/fork',{
        threadId:source.threadId,...(source.lastTurnId?{lastTurnId:source.lastTurnId}:{beforeTurnId:source.beforeTurnId}),
        ...codexThreadPermissionParams(this.permissionMode),excludeTurns:true,deferGoalContinuation:true,
        ...(this.developerInstructions?{developerInstructions:this.developerInstructions}:{}),
      });
      const thread=object(result.thread),id=thread.id;
      if(typeof id!=='string'||!id||id===source.threadId||thread.forkedFromId!==source.threadId)throw new NativeRequestUncertainError('thread/fork','independent native fork identity missing');
      this.rpc.bindRootThread(id);this.threadId=id;this.threadModel=typeof result.model==='string'?result.model:undefined;return result;
    }finally{this.pendingThreadOperation=false;}
  }

  async startTurn(input: string, submissionId: string, lease: WriterLease, ledger: SubmissionLedger, selection?: import('../contracts').NativeModelSelection, images: ({type:'image';url:string}|{type:'skill';name:string;path:string})[] = [], collaborationMode?: CollaborationMode): Promise<unknown> {
    this.assertReady();
    if(!input.trim())throw Error('An explicit nonempty task is required for a native turn.');
    if (!this.threadId) throw new Error('Native thread must be started or resumed');
    if (lease.sessionId !== this.rpc.sessionId) throw new Error('Lease belongs to another session');
    if(this.pendingThreadOperation||this.activeTurnId||this.turnRequestPending||this.turnUncertain)throw new Error('Previous native turn is active or uncertain; do not replay');
    this.turnRequestPending=true;this.completedDuringStart=undefined;
    let peer: PreparedPeerInput | undefined;
    let submitted = false;
    let journaled = false;
    try {
      peer = await this.peerContext?.prepare(input);
      const memoryInput = await this.memoryHandoff?.prepare(peer?.input ?? input, submissionId, this.permissionMode);
      const prepared = this.sharedContext.prepare(memoryInput ?? peer?.input ?? input);
      const params = { threadId: this.threadId, input: [{ type: 'text', text: prepared.input }, ...images], environments: [this.environment], ...codexTurnPermissionParams(this.permissionMode), ...codexCollaborationParams(collaborationMode,selection??(this.threadModel?{model:this.threadModel}:undefined)), ...(selection ? {model:selection.model,effort:selection.effort??null,serviceTierForTurn:selection.serviceTier??"default"} : {}) };
      ledger.begin(submissionId, { nativeRequest: params, sharedContext: prepared.context }, lease, prepared.context ? { contextSnapshotId: prepared.context.snapshotId, contextSourceHash: prepared.context.sourceHash } : undefined);
      journaled = true;
      this.sharedContext.markSubmitted(prepared, submissionId);
      submitted = true;
      const result = await this.rpc.request<Record<string, unknown>>('turn/start', params);
      const id = object(result.turn).id;
      if (typeof id !== 'string') throw new NativeRequestUncertainError('turn/start', 'native turn ID missing');
      this.activeTurnId=this.completedDuringStart===id?undefined:id;
      ledger.acknowledge(submissionId, id, lease);
      if (peer) { await this.peerContext!.acknowledge(peer, id); peer = undefined; }
      return result;
    } catch (error) {
      const rejected=error instanceof NativeAdmissionRejectedError;
      if (submitted&&!rejected) this.turnUncertain=true;
      if (journaled) {if(rejected)ledger.rejectBeforeNativeSubmission(submissionId,lease);else ledger.uncertain(submissionId);}
      if(rejected)this.sharedContext.rejectBeforeNativeSubmission(submissionId);
      if (peer) {
        try { if (submitted&&!rejected) await this.peerContext!.uncertain(peer); else await this.peerContext!.releaseBeforeWrite(peer); }
        catch { this.turnUncertain = true; }
      }
      await this.finishMemory();
      throw error;
    }
    finally{this.turnRequestPending=false;this.completedDuringStart=undefined;}
  }

  interrupt(turnId: string): Promise<unknown> {
    if (!this.threadId || !turnId) return Promise.reject(new Error('Native thread and turn IDs are required'));
    return this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId });
  }

  replyApproval(id: RpcId, decision: ApprovalDecision, lease: WriterLease, leases: SessionLeaseRegistry): Promise<void> {
    this.assertReady();
    if (lease.sessionId !== this.rpc.sessionId) return Promise.reject(new Error('Approval lease belongs to another session'));
    leases.assert(lease);
    return this.rpc.replyApproval(id, decision);
  }
}

export function createCodexRemoteTransport(host: SshHost, executable: string, version: string, remoteCwd: string, nativeAgentPolicy?: NativeAgentPolicy): ProcessSupervisor {
  return createRemoteSupervisor(host, executable, buildDeferredAppServerArgs(version, nativeAgentPolicy), remoteCwd);
}

export function getCodexCapabilities(): Capability[] {
  return [
    { id: 'codex-jsonl', label: 'Codex JSONL 原生协议', status: 'contract-tested', detail: '合成子进程验证 initialize、请求关联、事件、审批和中断；不是实际模型回合验收。' },
    { id: 'codex-deferred-contract', label: 'Codex 0.155.1 执行器合同', status: 'contract-tested', detail: '按历史源核对 exec-server / environment/add / environments；未混用新版 Code Mode 或 dynamic tools。' },
    { id: 'codex-h-native', label: 'Codex H 真实执行', status: 'unverified', detail: '新客户端尚未完成 VPS 原生认证、隧道、本机工具、取消与出网验收；生产入口锁定。' },
    { id: 'codex-full-tools', label: 'Codex 全工具覆盖', status: 'unverified', detail: 'PTY、补丁、图像、Subagent、hooks 与断线后的进程树须分别实测。' },
  ];
}
