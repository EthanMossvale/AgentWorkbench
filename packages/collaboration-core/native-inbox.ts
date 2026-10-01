import type { InboxClaim } from './types';
import { CollaborationError } from './types';
import { PeerInbox } from './inbox';

export interface PreparedPeerInput { readonly input: string; readonly claim: InboxClaim }
/** Trusted adapter only: accepting a peer message never starts a model turn by itself. */
export class NativePeerContextSession {
  private prepared = new WeakSet<PreparedPeerInput>();
  constructor(private inbox: PeerInbox, readonly sessionId: string) {}
  async prepare(userInput: string): Promise<PreparedPeerInput> {
    const claim = await this.inbox.claim(this.sessionId);
    const prepared = Object.freeze({ input: userInput + claim.envelope, claim });
    this.prepared.add(prepared); return prepared;
  }
  private assert(prepared: PreparedPeerInput) { if (!this.prepared.has(prepared) || prepared.claim.sessionId !== this.sessionId) throw new CollaborationError('INVALID_CLAIM', 'Peer context was not prepared by this native session.'); }
  async acknowledge(prepared: PreparedPeerInput, nativeReceipt: string) { this.assert(prepared); await this.inbox.acknowledge(prepared.claim, nativeReceipt); this.prepared.delete(prepared); }
  async releaseBeforeWrite(prepared: PreparedPeerInput) { this.assert(prepared); await this.inbox.releaseBeforeWrite(prepared.claim); this.prepared.delete(prepared); }
  async uncertain(prepared: PreparedPeerInput) { this.assert(prepared); await this.inbox.uncertain(prepared.claim); this.prepared.delete(prepared); }
}
