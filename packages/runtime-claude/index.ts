import { EventEmitter } from 'node:events';
import { isRuntimeNotice } from '../collaboration-core/runtime-notices';
import type { Capability, NativeEvent, PermissionMode, SessionBinding, SshHost } from '../contracts/index.js';
import { resolvePermissionMode } from '../session-core/permissions.js';
import { assertBridgeReady, freezeSessionBinding, NativeSharedContextSession, type SharedContextOptions, type BridgeEvidence, type SubmissionLedger, type WriterLease } from '../session-core/index.js';
import { getCodexCapabilities } from '../runtime-codex/index.js';
import { buildSshEnvironment } from '../ssh-transport/index.js';
import { createRemoteSupervisor, deepFreeze, type NativeFrame, type ProcessSupervisor, type ProcessSpec } from '../../services/remote-supervisor/index.js';
import { buildNativeAgentPolicyPlan, type NativeAgentPolicy } from '../collaboration-core/native-policy.js';
import { ClaudeNativeChildTracker, hasClaudeChildMarker } from '../collaboration-core/events.js';
import { NativePeerContextSession, type PreparedPeerInput } from '../collaboration-core/native-inbox.js';
import { claudeRetryNotice, claudeRetryText, type ClaudeRetryNotice } from './retry.js';
import { claudeResultOutcome } from './result';

export const CLAUDE_RESEARCH_BASELINE = '2.1.281' as const;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === 'string' ? value : '';

export interface ClaudeInvocation { version: string; model?: string; resumeSessionId?: string; permissionMode?:PermissionMode; nativeAgentPolicy?: NativeAgentPolicy }
export function claudePermissionMode(value:PermissionMode='default'){
  const mode=resolvePermissionMode('claude',value);
  return mode==='accept-edits'?'acceptEdits':mode==='full-access'?'bypassPermissions':mode;
}
export function buildClaudeArgs(invocation: ClaudeInvocation): string[] {
  if (invocation.version !== CLAUDE_RESEARCH_BASELINE) throw new Error('Claude target version must be explicitly verified before changing the pinned CLI contract');
  const args = ['--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--replay-user-messages', '--permission-prompts', 'none', '--settings', '{"autoMemoryEnabled":false}'];
  // Native mode is explicit, including default, so persisted CLI settings cannot silently grant more.
  args.push(...buildNativeAgentPolicyPlan('claude', invocation.version, invocation.nativeAgentPolicy).args);
  args.push('--permission-mode',claudePermissionMode(invocation.permissionMode));
  // No --bare, SDK login, API key, or MCP replacement tools. Bypass requires an explicit full-access choice.
  if (invocation.model) {
    if (/[\0\r\n]/.test(invocation.model)) throw new Error('Invalid model');
    args.push('--model', invocation.model);
  }
  if (invocation.resumeSessionId) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(invocation.resumeSessionId)) throw new Error('Resume requires an exact native UUID; no latest-session fallback');
    args.push('--resume', invocation.resumeSessionId);
  }
  return args;
}

export function createClaudeRemoteTransport(host: SshHost, executable: string, invocation: ClaudeInvocation, remoteCwd: string): ProcessSupervisor {
  return createRemoteSupervisor(host, executable, buildClaudeArgs(invocation), remoteCwd);
}

export function normalizeClaudeEvent(frame: NativeFrame, sessionId: string, sequence: number): NativeEvent {
  const msg = frame.value;
  let type: NativeEvent['type'] = 'progress';
  let display = '';
  let isPublic = false;
  if (hasClaudeChildMarker(frame)) { /* Child payloads are attributed separately, including defensive child results. */ }
  else if (msg.type === 'stream_event') {
    const event = record(msg.event);
    const delta = record(event.delta);
    if (event.type === 'content_block_delta' && delta.type === 'text_delta') { display = string(delta.text); isPublic = true; }
    if (event.type === 'content_block_start' && record(event.content_block).type === 'tool_use') { type = 'tool'; isPublic = true; }
    if(isRuntimeNotice('claude',frame)){type='tool';isPublic=true;}
    // thinking_delta and signature_delta intentionally have no public display text.
  } else if (msg.type === 'assistant') {
    const content = record(msg.message).content;
    if (Array.isArray(content)) {
      const texts = content.map(record).filter(item => item.type === 'text').map(item => string(item.text));
      display = texts.join('\n');
      isPublic = texts.length > 0;
      if (!isPublic && content.some(item => record(item).type === 'tool_use')) { type = 'tool'; isPublic = true; }
    }
  } else if (msg.type === 'user' && Array.isArray(record(msg.message).content) && (record(msg.message).content as unknown[]).some(item => record(item).type === 'tool_result')) {
    type = 'tool'; isPublic = true;
  } else if (msg.type === 'system' && msg.subtype === 'api_retry') {
    const notice = claudeRetryNotice(msg);
    if (notice) { display = claudeRetryText(notice); isPublic = true; }
  } else if (msg.type === 'system' && ['task_started', 'task_progress', 'task_notification','task_updated'].includes(String(msg.subtype))) {
    type = 'tool'; isPublic = true;
  } else if (msg.type === 'result') {
    type = claudeResultOutcome(msg)==='completed' ? 'final' : 'error'; display = string(msg.result); isPublic = true;
  } else if(isRuntimeNotice('claude',frame)){type='tool';isPublic=true;
  }
  return { id: `claude:${sessionId}:${sequence}`, sessionId, sequence, revision: 1, type, text: display, timestamp: frame.receivedAt, public: isPublic, raw: frame };
}

/** Public stream-json adapter; CLI owns authentication, tools and the model loop. */
export class ClaudeStreamAdapter extends EventEmitter {
  readonly binding: Readonly<SessionBinding>;
  readonly evidence?: BridgeEvidence;
  readonly sharedContext: NativeSharedContextSession;
  private readonly memoryHandoff?: SharedContextOptions['memoryHandoff'];
  private sequence = 0;
  private nativeSessionId?: string;
  private pendingUserId?: string;
  private uncertain = false;
  private submitting = false;
  private receiving = Promise.resolve();
  private lastRetry?: Readonly<ClaudeRetryNotice>;
  private terminalFailure?: Readonly<{ reason: string; status: number | null }>;
  /** A terminal error never grants the framework permission to send another turn. */
  get submissionBlock() { return this.terminalFailure; }
  private readonly children = new ClaudeNativeChildTracker();
  private submission?: { id: string; lease: WriterLease; ledger: SubmissionLedger; peer?: PreparedPeerInput };

  constructor(readonly transport: ProcessSupervisor, readonly sessionId: string, binding: SessionBinding, evidence?: BridgeEvidence, readonly version = CLAUDE_RESEARCH_BASELINE, sharedContext: SharedContextOptions = {}, readonly peerContext?: NativePeerContextSession) {
    super();
    if (binding.runtime !== 'claude') throw new Error('Claude adapter requires Claude runtime');
    this.binding = freezeSessionBinding(binding);
    this.evidence = evidence ? deepFreeze(structuredClone(evidence)) : undefined;
    this.sharedContext = new NativeSharedContextSession(sessionId, sharedContext);
    this.memoryHandoff = sharedContext.memoryHandoff;
    if (this.memoryHandoff && (this.memoryHandoff.runtime !== 'claude' || this.memoryHandoff.sessionId !== sessionId)) throw Error('Memory handoff belongs to another runtime or session.');
    if (binding.nativeSessionId) this.sharedContext.assertResumeSafe();
    this.nativeSessionId = binding.nativeSessionId;
    if (peerContext && peerContext.sessionId !== sessionId) throw new Error('Peer context belongs to another session');
    transport.on('frame', (frame: NativeFrame) => this.enqueue(() => this.receive(frame)));
    transport.on('disconnect', () => {
      this.enqueue(async () => {
        if (this.pendingUserId) { this.uncertain = true; this.submission?.ledger.uncertain(this.pendingUserId); await this.markPeerUncertain(); }
        await this.finishMemory();
        this.emit('disconnect', { uncertain: this.uncertain, pendingUserId: this.pendingUserId });
      });
    });
    transport.on('fault', (error: Error) => this.emit('fault', error));
  }

  private enqueue(work: () => Promise<void>): void {
    this.receiving = this.receiving.then(work).catch(async error => {
      this.uncertain = true;
      if (this.submission) this.submission.ledger.uncertain(this.submission.id);
      try { await this.markPeerUncertain(); } catch { /* A durable claim failure stays uncertain; never replay. */ }
      this.emit('fault', error instanceof Error ? error : new Error('Native Claude event processing failed'));
      void this.transport.stop('native-event-processing-failure');
    });
  }

  private async markPeerUncertain(): Promise<void> {
    const peer = this.submission?.peer;
    if (peer) { await this.peerContext!.uncertain(peer); delete this.submission!.peer; }
  }

  private async finishMemory(){try{await this.memoryHandoff?.finish();}catch{/* Receipt failures must not replay a native task. */}}

  private async receive(frame: NativeFrame): Promise<void> {
    this.emit('raw', frame);
    const msg = frame.value;
    if(!hasClaudeChildMarker(frame)&&typeof msg.session_id==='string'&&this.nativeSessionId&&msg.session_id!==this.nativeSessionId){
      this.emit('fault',new Error('Native Claude session identity changed.'));
      void this.transport.stop('native-session-mismatch');return;
    }
    const child = this.children.observe(frame, this.nativeSessionId);
    for (const event of child.events) this.emit('childAgent', event);
    if (child.child) {
      this.emit('childEvent', { nativeChildId: child.nativeChildId, frame });
      if(msg.type==='control_request'){
        this.emit('fault',new Error('Claude host control protocol is unverified; request was not approved'));
        void this.transport.stop('unsupported-native-control-request');
      }
      // Child text/thinking, task notifications and child results cannot confirm or
      // complete the parent submission or replace its immutable session identity.
      return;
    }
    if (typeof msg.session_id === 'string' && msg.session_id) {
      if (this.nativeSessionId && this.nativeSessionId !== msg.session_id) {
        this.uncertain = !!this.pendingUserId;
        if (this.submission) this.submission.ledger.uncertain(this.submission.id);
        await this.markPeerUncertain();
        this.emit('fault', new Error('Native Claude session changed unexpectedly'));
        void this.transport.stop('native-session-mismatch'); return;
      }
      this.nativeSessionId = msg.session_id;
    }
    if (msg.type === 'control_request') {
      this.emit('event', normalizeClaudeEvent(frame, this.sessionId, ++this.sequence));
      // Host approval control schemas are not asserted from SDK/private internals.
      this.emit('fault', new Error('Claude host control protocol is unverified; request was not approved'));
      void this.transport.stop('unsupported-native-control-request'); return;
    }
    const retry = claudeRetryNotice(msg);
    if (retry) this.lastRetry = retry; // Observe the native policy; do not schedule or interrupt retries.
    if (msg.type === 'user' && this.pendingUserId && msg.uuid === this.pendingUserId && this.submission) {
      if (this.submission.ledger.get(this.submission.id).state === 'pending') {
        try {
          this.submission.ledger.acknowledge(this.submission.id, this.nativeSessionId ?? this.submission.id, this.submission.lease);
          if (this.submission.peer) { await this.peerContext!.acknowledge(this.submission.peer, this.pendingUserId); delete this.submission.peer; }
        }
        catch { this.uncertain = true; this.submission.ledger.uncertain(this.submission.id); await this.markPeerUncertain(); void this.transport.stop('writer-fenced'); return; }
        this.emit('acknowledged', { submissionId: this.pendingUserId });
      }
    }
    if (msg.type === 'result') {
      const outcome=claudeResultOutcome(msg);
      if(!outcome){
        this.emit('event', normalizeClaudeEvent(frame, this.sessionId, ++this.sequence));
        this.uncertain=true;if(this.submission)this.submission.ledger.uncertain(this.submission.id);
        this.emit('fault',new Error('CLAUDE_RESULT_UNSUPPORTED: Native outcome is unknown; do not replay.'));
        void this.transport.stop('unknown-native-result');return;
      }
      if (outcome === 'failed') this.terminalFailure = Object.freeze({ reason: this.lastRetry?.error ?? 'native_error', status: this.lastRetry?.status ?? null });
      if (this.submission && this.submission.ledger.get(this.submission.id).state === 'pending') {
        this.submission.ledger.uncertain(this.submission.id); this.uncertain = true;
      }
      await this.markPeerUncertain();
      await this.finishMemory();
      this.emit('completed', { submissionId: this.pendingUserId, nativeSessionId: this.nativeSessionId, isError: outcome === 'failed', uncertain: this.uncertain, submissionBlock: this.terminalFailure });
      this.pendingUserId = undefined;
      this.submission = undefined;
    }
    this.emit('event', normalizeClaudeEvent(frame, this.sessionId, ++this.sequence));
  }

  async submitUser(input: string, submissionId: string, lease: WriterLease, ledger: SubmissionLedger): Promise<string> {
    assertBridgeReady(this.binding, this.version, this.evidence);
    if (typeof input !== 'string' || !input.trim()) throw new Error('An explicit nonempty task is required; peer messages alone cannot start a native turn');
    if (this.pendingUserId || this.submitting || this.uncertain) throw new Error('Previous native submission is active or uncertain; do not replay');
    if (!/^[a-f0-9-]{36}$/i.test(submissionId)) throw new Error('Submission UUID is required');
    if (lease.sessionId !== this.sessionId) throw new Error('Lease belongs to another session');
    this.submitting = true;
    let peer: PreparedPeerInput | undefined;
    let submitted = false;
    let journaled = false;
    try {
      // A received terminal error must be processed before an immediate next submission.
      await this.receiving;
      if (this.terminalFailure) throw new Error(`Native Claude ended with ${this.terminalFailure.reason}; further submissions on this transport are blocked. Review native status before opening a new explicitly verified session; do not retry or rotate accounts automatically.`);
      if (this.pendingUserId || this.uncertain) throw new Error('Previous native submission is active or uncertain; do not replay');
      peer = await this.peerContext?.prepare(input);
      const memoryInput = await this.memoryHandoff?.prepare(peer?.input ?? input, submissionId);
      const prepared = this.sharedContext.prepare(memoryInput ?? peer?.input ?? input);
      const payload = { type: 'user', uuid: submissionId, session_id: this.nativeSessionId ?? '', parent_tool_use_id: null, message: { role: 'user', content: prepared.input } };
      ledger.begin(submissionId, { nativeRequest: payload, sharedContext: prepared.context }, lease, prepared.context ? { contextSnapshotId: prepared.context.snapshotId, contextSourceHash: prepared.context.sourceHash } : undefined);
      journaled = true;
      this.sharedContext.markSubmitted(prepared, submissionId);
      this.submission = { id: submissionId, lease, ledger, ...(peer ? { peer } : {}) };
      this.pendingUserId = submissionId;
      this.lastRetry = undefined;
      submitted = true;
      await this.transport.write(payload);
      return submissionId;
    } catch (error) {
      if (submitted) this.uncertain = true;
      if (journaled) ledger.uncertain(submissionId);
      try {
        if (submitted) await this.markPeerUncertain();
        else if (peer) await this.peerContext!.releaseBeforeWrite(peer);
      } catch { this.uncertain = true; }
      await this.finishMemory();
      throw error;
    } finally { this.submitting = false; }
  }

  async cancel(): Promise<void> {
    // Stopping the transport is not claimed to cancel every remote/background child.
    // H gate includes separate verified cancellation evidence before any real task.
    if (this.pendingUserId) this.uncertain = true;
    await this.transport.stop('user-cancel');
  }
}

export interface ShellPrefixEnvelope {
  commandLine: string;
  purpose: 'bash-tool' | 'shell-hook' | 'statusline' | 'stdio-mcp' | 'unknown';
  sourceOs: 'linux' | 'darwin' | 'win32'; targetOs: 'linux' | 'darwin' | 'win32';
  sourceCwd: string; targetCwd: string;
}
export interface ShellInvocationEvidence {
  version: string;
  commandClassification: 'verified' | 'unverified';
  fileView: 'verified' | 'unverified';
  identicalPosixNamespace: 'verified' | 'unverified';
  helperAndTempResources: 'verified' | 'unverified';
}

/** Pure same-OS candidate builder; not a deployed/validated SSH tool bridge. */
export function planShellPrefixInvocation(envelope: ShellPrefixEnvelope, evidence: ShellInvocationEvidence): ProcessSpec {
  if (envelope.sourceOs !== envelope.targetOs || envelope.targetOs === 'win32') throw new Error('Cross-OS invocation translation is not supported; Linux Bash is never silently sent to PowerShell');
  if (envelope.purpose !== 'bash-tool') throw new Error('Only independently classified Bash tool calls may be forwarded; hooks/statusline/MCP stay unverified');
  if (evidence.version !== CLAUDE_RESEARCH_BASELINE || evidence.commandClassification !== 'verified' || evidence.fileView !== 'verified' || evidence.identicalPosixNamespace !== 'verified' || evidence.helperAndTempResources !== 'verified') throw new Error('Shell wrapper, file view, invocation resources and classification require verified evidence');
  if (!envelope.sourceCwd.startsWith('/') || envelope.sourceCwd !== envelope.targetCwd || /[\0\r\n]/.test(envelope.targetCwd) || !envelope.commandLine || envelope.commandLine.includes('\0')) throw new Error('A consistent absolute POSIX namespace and exact invocation are required');
  // Preserve the COMPLETE native shell invocation as ONE argument, never extract or rewrite model text.
  return { executable: '/bin/bash', args: ['-c', envelope.commandLine], cwd: envelope.targetCwd, outputMode: 'opaque', env: buildSshEnvironment() };
}

export function getClaudeCapabilities(): Capability[] {
  return [
    { id: 'claude-stream-json', label: 'Claude 原生公开事件', status: 'contract-tested', detail: '合成子进程验证公开 stream-json 事件、原文与签名保留；没有调用真实模型。' },
    { id: 'claude-shell-candidate', label: 'Claude shell prefix 候选', status: 'contract-tested', detail: '仅严格同 OS / 同 POSIX 文件视图的调用构造与拒绝测试；不是已部署 shell 或全工具桥。' },
    { id: 'claude-h-native', label: 'Claude H 原生执行', status: 'unverified', detail: '缺少已验证文件视图、shell 委派、生命周期和 VPS 出网证据，真实执行保持禁用。' },
    { id: 'claude-native-approval', label: 'Claude 主机审批协议', status: 'unverified', detail: '未把 SDK 私有控制协议当公开契约；当前 print 参数对无人处理审批按原生规则拒绝。' },
    { id: 'claude-cross-os', label: 'Linux→Windows 原生 shell 桥', status: 'unsupported', detail: '禁止把 Linux 完整 Bash invocation 机械改写为 PowerShell；专用 worker 需要独立合同。' },
  ];
}

export function getNativeCapabilities(): Capability[] {
  return [...getClaudeCapabilities(), ...getCodexCapabilities(), {
    id: 'native-shared-context', label: '原生记忆交接与 Skills 上下文', status: 'contract-tested',
    detail: '记忆按绑定运行时在明确任务前领取待收档案，核验原生文件与索引回执；Skills 保持首轮冻结快照。合成协议测试不代表真实模型已吸收记忆或 Claude H 已连通。',
  }];
}
