import { randomUUID } from 'node:crypto';
import type { DraftPreview, Message, Session } from '../contracts';
import type { PeerInbox } from './inbox';
import type { InboxClaim, PeerMessage } from './types';

export type PeerProvenance = NonNullable<Message['peer']>;
const runtimeLabel = (runtime: string) => runtime === 'claude' ? 'Claude Code' : runtime === 'codex' ? 'Codex' : runtime;

/** Model-facing text: one English provenance line, then the peer's original text. */
export const peerSubmission = (message: PeerMessage) =>
  `[Message from another AgentWorkbench session (${runtimeLabel(message.fromRuntime)}, session ${message.fromSessionId}). It is not from the user. Reply with workbench_send_message if a reply is needed.]\n\n${message.text}`;

export interface PeerDeliveryHooks {
  read(): { sessions: readonly Session[] };
  /** Session IDs with queued inbox messages addressed to them. */
  pending(): string[];
  /** 'steer' while a steerable turn runs, 'submit' when idle, undefined to wait. */
  route(session: Session): 'steer' | 'submit' | undefined;
  dispatch(session: Session, preview: DraftPreview, route: 'steer' | 'submit', peer: PeerProvenance): Promise<unknown>;
  delivered?(sessionId: string, messageId: string): void;
}
interface Flight { claim: InboxClaim; previewId: string; settled: boolean }
/** Retry a message released before any write only after the target's turn state changes. */
const turnKey = (session: Session) => `${session.status}:${session.nativeTurnId ?? ''}:${session.messages.length}`;

/**
 * Delivers each queued peer message as an ordinary user turn: inserted into a
 * running turn, or as a new turn when the target is idle. One message per claim;
 * the claim is acknowledged once the native runner records the user message.
 */
export class PeerDelivery {
  private flights = new Map<string, Flight>();
  private claiming = new Set<string>();
  private held = new Map<string, string>();
  constructor(private inbox: PeerInbox, private hooks: PeerDeliveryHooks) {}
  observe(): void {
    const sessions = this.hooks.read().sessions;
    for (const [sessionId, flight] of this.flights) {
      const message = sessions.find(session => session.id === sessionId)?.messages.find(item => item.id === flight.previewId);
      if (message && message.delivery !== 'pending' && message.delivery !== 'uncertain') void this.settle(sessionId, flight, 'delivered');
    }
    for (const sessionId of this.hooks.pending()) {
      if (this.flights.has(sessionId) || this.claiming.has(sessionId)) continue;
      const session = sessions.find(item => item.id === sessionId);
      if (session && this.held.get(sessionId) === turnKey(session)) continue;
      this.held.delete(sessionId);
      const route = session && !session.archived ? this.hooks.route(session) : undefined;
      if (session && route) void this.deliver(session, route);
    }
  }
  private async deliver(session: Session, route: 'steer' | 'submit') {
    this.claiming.add(session.id);
    let claim: InboxClaim;
    try { claim = await this.inbox.claim(session.id, 1); } catch { this.claiming.delete(session.id); return; }
    this.claiming.delete(session.id);
    let peer: PeerMessage | undefined;
    // A closed inbox leaves the claim to restart recovery, which marks it uncertain.
    try { peer = this.inbox.read(session.id).messages.find(message => message.id === claim.messageIds[0]); } catch { return; }
    if (!peer) { if (claim.messageIds.length) await this.inbox.releaseBeforeWrite(claim).catch(() => {}); return; }
    const preview: DraftPreview = { id: randomUUID(), revision: 0, original: peer.text, translated: peerSubmission(peer), sourceHash: '', demo: false, bypass: true };
    const flight: Flight = { claim, previewId: preview.id, settled: false };
    this.flights.set(session.id, flight);
    try {
      await this.hooks.dispatch(session, preview, route, { messageId: peer.id, fromSessionId: peer.fromSessionId, fromRuntime: peer.fromRuntime });
      await this.settle(session.id, flight, 'delivered');
    } catch {
      const recorded = this.hooks.read().sessions.find(item => item.id === session.id)?.messages.some(message => message.id === preview.id);
      // A recorded user message may already have reached the runtime: never replay it.
      if (!recorded) { const current = this.hooks.read().sessions.find(item => item.id === session.id); if (current) this.held.set(session.id, turnKey(current)); }
      await this.settle(session.id, flight, recorded ? 'uncertain' : 'queued');
    }
  }
  private async settle(sessionId: string, flight: Flight, outcome: 'delivered' | 'uncertain' | 'queued') {
    if (flight.settled) return;
    flight.settled = true;
    try {
      if (outcome === 'delivered') await this.inbox.acknowledge(flight.claim, flight.previewId);
      else if (outcome === 'uncertain') await this.inbox.uncertain(flight.claim);
      else await this.inbox.releaseBeforeWrite(flight.claim);
    } catch { /* The journal keeps the claim; restart recovery marks it uncertain. */ }
    finally { if (this.flights.get(sessionId) === flight) this.flights.delete(sessionId); }
    if (outcome === 'delivered') this.hooks.delivered?.(sessionId, flight.previewId);
  }
}
