import { isPluginRuntime } from '../runtime-extensions/types';
import { officialAccountBinding } from '../model-management/types';
import { createHash } from 'node:crypto';
import type { SessionBinding } from '../contracts/index.js';
import { deepFreeze } from '../../services/remote-supervisor/index.js';
export { NativeSharedContextSession, composeSharedContextInput, type SharedContextOptions, type SharedContextReceipt } from './shared-context.js';
export { permissionModesForRuntime, resolvePermissionMode } from './permissions.js';

export function freezeSessionBinding(binding: SessionBinding): Readonly<SessionBinding> {
  for (const value of [binding.runtime, binding.provider, binding.accountRef, binding.executionId, binding.egress]) {
    if (!value || typeof value !== 'string') throw new Error('Session binding must be complete');
  }
  if(binding.localAccountId){if(!officialAccountBinding(binding))throw Error('Official accounts require an independent native binding');return deepFreeze(structuredClone(binding));}
  if (binding.runtime === 'api' && (binding.egress !== 'direct-api' || !binding.modelConnectionId || !binding.modelMappingId || binding.hostId)) throw new Error('API sessions require an independent API binding');
  if (isPluginRuntime(binding.runtime)) { if(binding.egress!=='runtime-managed'||binding.modelConnectionId)throw Error('Plugin runtime requires its own binding'); return deepFreeze(structuredClone(binding)); }
  const nativeProvider = ['codex', 'claude'].includes(binding.runtime) && binding.egress === 'direct-api' && !!binding.modelConnectionId && !!binding.modelMappingId && !binding.hostId;
  if (binding.runtime !== 'demo' && binding.runtime !== 'api' && !nativeProvider && (binding.egress !== 'vps' || !binding.hostId)) throw new Error('Native session requires an explicit provider or VPS binding');
  return deepFreeze(structuredClone(binding));
}

export function assertSameBinding(frozen: Readonly<SessionBinding>, proposed: SessionBinding): void {
  const fields = ['runtime', 'provider', 'accountRef', 'accountRuntime', 'executionId', 'egress', 'hostId', 'localAccountId'] as const;
  if (fields.some(field => frozen[field] !== proposed[field])) throw new Error('Session binding is immutable; create a new session for runtime/provider/account/execution/egress changes');
  if (frozen.nativeSessionId && frozen.nativeSessionId !== proposed.nativeSessionId) throw new Error('Native session identity is immutable');
}

export interface WriterLease { readonly sessionId: string; readonly ownerId: string; readonly fence: number; readonly expiresAt: number }
/** In-process authority. A future multi-host service must persist fences atomically. */
export class SessionLeaseRegistry {
  private readonly active = new Map<string, WriterLease>();
  private readonly generations = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  acquire(sessionId: string, ownerId: string, ttlMs = 30_000): WriterLease {
    if (!sessionId || !ownerId || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Invalid writer lease');
    const current = this.active.get(sessionId);
    if (current && current.expiresAt > this.now()) throw new Error('Session already has an active writer');
    const fence = (this.generations.get(sessionId) ?? 0) + 1;
    this.generations.set(sessionId, fence);
    const lease = Object.freeze({ sessionId, ownerId, fence, expiresAt: this.now() + ttlMs });
    this.active.set(sessionId, lease);
    return lease;
  }

  assert(lease: WriterLease): void {
    const current = this.active.get(lease.sessionId);
    if (!current || current.ownerId !== lease.ownerId || current.fence !== lease.fence || current.expiresAt <= this.now()) throw new Error('Writer lease expired or fenced');
  }

  renew(lease: WriterLease, ttlMs = 30_000): WriterLease {
    this.assert(lease);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Invalid lease duration');
    const refreshed = Object.freeze({ ...lease, expiresAt: this.now() + ttlMs });
    this.active.set(lease.sessionId, refreshed);
    return refreshed;
  }

  release(lease: WriterLease): void { this.assert(lease); this.active.delete(lease.sessionId); }
  revoke(sessionId: string): void { this.active.delete(sessionId); this.generations.set(sessionId, (this.generations.get(sessionId) ?? 0) + 1); }
}

export type SubmissionState = 'pending' | 'acknowledged' | 'uncertain' | 'reconciled' | 'rejected';
export interface SubmissionContextMetadata { contextSnapshotId: string; contextSourceHash: string }
export interface SubmissionRecord { id: string; sessionId: string; fence: number; payloadHash: string; state: SubmissionState; nativeId?: string; contextSnapshotId?: string; contextSourceHash?: string }
/** In-memory journal for a live supervisor. Persist before enabling crash recovery. */
export class SubmissionLedger {
  private readonly records = new Map<string, SubmissionRecord>();
  constructor(private readonly leases: SessionLeaseRegistry) {}

  begin(id: string, payload: unknown, lease: WriterLease, context?: SubmissionContextMetadata): Readonly<SubmissionRecord> {
    this.leases.assert(lease);
    if (!id) throw new Error('Submission ID is required');
    if (this.records.has(id)) throw new Error('Submission already exists; uncertain requests must be reconciled, never replayed');
    if (context && (!context.contextSnapshotId || !/^[a-f0-9]{64}$/.test(context.contextSourceHash))) throw new Error('Invalid shared context provenance metadata');
    const record: SubmissionRecord = { id, sessionId: lease.sessionId, fence: lease.fence, payloadHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'), state: 'pending', ...(context ? { contextSnapshotId: context.contextSnapshotId, contextSourceHash: context.contextSourceHash } : {}) };
    this.records.set(id, record);
    return Object.freeze({ ...record });
  }

  acknowledge(id: string, nativeId: string, lease: WriterLease): void {
    this.leases.assert(lease);
    const record = this.require(id);
    if (!nativeId || record.sessionId !== lease.sessionId || record.fence !== lease.fence || record.state !== 'pending') throw new Error('Submission cannot be acknowledged by this lease');
    record.state = 'acknowledged'; record.nativeId = nativeId;
  }

  uncertain(id: string): void { const record = this.require(id); if (record.state === 'pending') record.state = 'uncertain'; }
  rejectBeforeNativeSubmission(id:string,lease:WriterLease):void {
    this.leases.assert(lease);const record=this.require(id);
    if(record.sessionId!==lease.sessionId||record.fence!==lease.fence||record.state!=='pending')throw Error('Only a pending submission can be rejected by this lease');
    record.state='rejected';
  }
  disconnect(sessionId: string): void { for (const record of this.records.values()) if (record.sessionId === sessionId && record.state === 'pending') record.state = 'uncertain'; }
  reconcile(id: string, nativeId: string, lease: WriterLease): void {
    this.leases.assert(lease);
    const record = this.require(id);
    if (record.sessionId !== lease.sessionId || record.state !== 'uncertain' || !nativeId) throw new Error('Only an uncertain submission with observed native identity can be reconciled');
    record.state = 'reconciled'; record.nativeId = nativeId;
  }
  get(id: string): Readonly<SubmissionRecord> { return Object.freeze({ ...this.require(id) }); }
  private require(id: string): SubmissionRecord { const record = this.records.get(id); if (!record) throw new Error('Unknown submission'); return record; }
}

export interface BridgeEvidence {
  runtime: 'codex' | 'claude'; runtimeVersion: string; hostId: string; executionId: string;
  /** Exact opaque account identity verified by native-auth; never a token or a current-selection alias. */
  accountRef: string;
  checks: Readonly<Record<string, 'verified' | 'contract-tested' | 'unverified'>>;
}
const checks = {
  codex: ['native-auth', 'remote-runtime', 'executor-link', 'environment-binding', 'owner-file-access', 'cancellation', 'model-egress'],
  claude: ['native-auth', 'remote-runtime', 'shell-wrapper', 'file-view', 'path-consistency', 'owner-file-access', 'cancellation', 'model-egress'],
} as const;

export function missingBridgeChecks(runtime: 'codex' | 'claude', evidence?: BridgeEvidence): string[] {
  if (!evidence || evidence.runtime !== runtime) return [...checks[runtime]];
  return checks[runtime].filter(check => evidence.checks[check] !== 'verified'
    || (check === 'native-auth' && (typeof evidence.accountRef !== 'string' || !evidence.accountRef.trim())));
}

export function assertBridgeReady(binding: Readonly<SessionBinding>, version: string, evidence?: BridgeEvidence): void {
  if (binding.runtime !== 'codex' && binding.runtime !== 'claude') throw new Error('Native runtime required');
  const missing = missingBridgeChecks(binding.runtime, evidence);
  if (!evidence || evidence.runtimeVersion !== version || evidence.hostId !== binding.hostId || evidence.executionId !== binding.executionId || evidence.accountRef !== binding.accountRef || missing.length) {
    throw new Error(`Native H execution is not verified for this binding/version: ${missing.join(', ') || 'evidence binding mismatch'}`);
  }
}
