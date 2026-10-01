import type { Session } from '../contracts';

export type PeerMessageStatus = 'queued' | 'claimed' | 'delivered' | 'uncertain';
export interface PeerMessage {
  id: string; operationId: string; fromSessionId: string; toSessionId: string;
  fromRuntime: Session['binding']['runtime']; toRuntime: Session['binding']['runtime'];
  /** Host-stamped labels at send time; model arguments cannot supply provenance. */
  fromTitle?: string; toTitle?: string; fromModel?: string;
  text: string; createdAt: string; status: PeerMessageStatus;
  claimId?: string; nativeReceipt?: string; deliveredAt?: string;
  sourceIdentityHash?: string; targetIdentityHash?: string;
  /** Monotonic journal revision of this message's last change; migrated for legacy rows. */
  revision?: number;
}
export interface CollaborationState { version: 1; revision: number; messages: PeerMessage[] }
export interface CollaborationIdentity { session: Session; ownerId: string; authorityKey?: string }
export interface CollaborationPersistence {
  snapshot(): CollaborationState;
  update(change: (state: CollaborationState) => void): Promise<void>;
  identity(sessionId: string): CollaborationIdentity | undefined;
  identities(): CollaborationIdentity[];
}
export interface InboxClaim { id: string; sessionId: string; messageIds: readonly string[]; envelope: string }
export const initialCollaborationState = (): CollaborationState => ({ version: 1, revision: 0, messages: [] });

export class CollaborationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'CollaborationError'; }
}
