import type { AppState, Session } from '../contracts';
import { compareSidebarSessions, sessionNeedsAttention } from './sidebar-order';
import { RECENT_PROJECT_ID } from './projects';

export const SIDEBAR_IDLE_MS = 60 * 60 * 1000;
export interface SessionReorderRequest {
  id: string;
  targetId: string;
  edge: 'before' | 'after';
  /** The visible section at drag start; stale requests cannot cross sections. */
  scope: string;
}
export const sidebarSessionScope = (session: Session): string => session.pinned ? 'pinned'
  : session.group ? `group:${session.group}` : `project:${session.projectId ?? RECENT_PROJECT_ID}`;

const timestamp = (value?: string) => Date.parse(value ?? '') || 0;
export function sidebarActivityTime(session: Session): number {
  if (session.sidebarActivityAt && timestamp(session.sidebarActivityAt)) return timestamp(session.sidebarActivityAt);
  let latest = timestamp(session.createdAt);
  for (const item of session.messages) latest = Math.max(latest, timestamp(item.timestamp));
  for (const item of [...(session.activities ?? []), ...(session.nativeChildren ?? [])]) latest = Math.max(latest, timestamp(item.updatedAt));
  for (const item of session.nativeInteractions ?? []) latest = Math.max(latest, timestamp(item.receivedAt));
  return latest;
}

/** The renderer consumes the saved order, never live priority or wall-clock sorting. */
export function orderedSidebarSessions(state: Pick<AppState, 'sessions' | 'sidebarSessionOrder'>): Session[] {
  if (!state.sidebarSessionOrder) return [...state.sessions].sort(compareSidebarSessions);
  const remaining = new Map(state.sessions.map(session => [session.id, session]));
  const result: Session[] = [];
  for (const id of state.sidebarSessionOrder) {
    const session = remaining.get(id);
    if (session) { result.push(session); remaining.delete(id); }
  }
  return [...result, ...remaining.values()];
}

export function initializeSidebarSessions(state: AppState): void {
  state.sidebarSessionOrder = orderedSidebarSessions(state).map(session => session.id);
  for (const session of state.sessions) session.sidebarActivityAt ??= new Date(sidebarActivityTime(session)).toISOString();
}

function changed<T>(before: T[] | undefined, after: T[] | undefined, equal: (a: T, b: T) => boolean): boolean {
  return (before?.length ?? 0) !== (after?.length ?? 0) || !!after?.some((item, index) => !equal(before![index]!, item));
}

/** Native content/lifecycle activity only. Read flags, translations and layout are not activity. */
function hasActivity(before: Session, after: Session): boolean {
  return before.status !== after.status || before.nativeTurnId !== after.nativeTurnId || before.nativeTurnStatus !== after.nativeTurnStatus
    || changed(before.messages, after.messages, (a, b) => a.id === b.id && a.original === b.original && a.submitted === b.submitted && a.progress === b.progress && a.delivery === b.delivery)
    || changed(before.activities, after.activities, (a, b) => a.id === b.id && a.updatedAt === b.updatedAt && a.status === b.status && a.output === b.output)
    || changed(before.nativeChildren, after.nativeChildren, (a, b) => a.nativeChildId === b.nativeChildId && a.updatedAt === b.updatedAt && a.status === b.status)
    || changed(before.nativeApprovals, after.nativeApprovals, (a, b) => a.id === b.id && a.receipt === b.receipt && a.details === b.details)
    || changed(before.nativeInteractions, after.nativeInteractions, (a, b) => a.id === b.id && a.receipt === b.receipt && a.status === b.status);
}

function placeByPriority(state: AppState, session: Session): void {
  const order = orderedSidebarSessions(state).filter(item => item.id !== session.id);
  const peers = order.filter(item => !item.archived && sidebarSessionScope(item) === sidebarSessionScope(session));
  // Only the reactivated row moves; every other row retains its relative position.
  const priority = (item: Session) => sessionNeedsAttention(item) ? 0 : item.status === 'running' ? 1 : item.unread ? 2 : 3;
  const target = peers.find(item => (priority(session) - priority(item) || sidebarActivityTime(item) - sidebarActivityTime(session) || session.id.localeCompare(item.id)) < 0);
  const index = target ? order.indexOf(target) : peers.length ? order.indexOf(peers.at(-1)!) + 1 : order.length;
  order.splice(index, 0, session);
  state.sidebarSessionOrder = order.map(item => item.id);
}

/** Called inside the store's serialized mutation, before persistence and state broadcast. */
export function observeSidebarSessions(previous: AppState, next: AppState, at: string): void {
  const now = timestamp(at);
  if (!now) throw Error('SIDEBAR_ACTIVITY_TIMESTAMP_INVALID');
  const old = new Map(previous.sessions.map(session => [session.id, session]));
  next.sidebarSessionOrder = orderedSidebarSessions({ sessions: next.sessions, sidebarSessionOrder: next.sidebarSessionOrder ?? orderedSidebarSessions(previous).map(session => session.id) }).map(session => session.id);
  for (const session of next.sessions) {
    const before = old.get(session.id);
    if (!before) {
      session.sidebarActivityAt = at;
      if (!session.archived) placeByPriority(next, session);
      continue;
    }
    const activityAt = sidebarActivityTime(before);
    session.sidebarActivityAt ??= new Date(activityAt).toISOString();
    // Manual moves protect the entire section, including the target, from an immediate jump.
    const manuallyProtected = sidebarActivityTime(session) > activityAt;
    if (!hasActivity(before, session)) continue;
    session.sidebarActivityAt = new Date(Math.max(now, sidebarActivityTime(session))).toISOString();
    if (!session.archived && !before.archived && !manuallyProtected && before.status !== 'running'
      && sidebarSessionScope(before) === sidebarSessionScope(session) && now - activityAt > SIDEBAR_IDLE_MS) placeByPriority(next, session);
  }
}

export function reorderSidebarSession(state: AppState, request: SessionReorderRequest, at: string): void {
  const { id, targetId, edge, scope } = request;
  if (edge !== 'before' && edge !== 'after') throw Error('SIDEBAR_REORDER_EDGE_INVALID');
  const ordered = orderedSidebarSessions(state), source = ordered.find(item => item.id === id), target = ordered.find(item => item.id === targetId);
  if (!source || !target) throw Error('SIDEBAR_SESSION_NOT_FOUND');
  if (source.archived || target.archived) throw Error('SIDEBAR_SESSION_ARCHIVED');
  if (!scope || sidebarSessionScope(source) !== scope || sidebarSessionScope(target) !== scope) throw Error('SIDEBAR_REORDER_SCOPE_CHANGED');
  if (!timestamp(at)) throw Error('SIDEBAR_ACTIVITY_TIMESTAMP_INVALID');
  if (id === targetId) return;
  const order = ordered.filter(item => item.id !== id), index = order.findIndex(item => item.id === targetId);
  order.splice(index + (edge === 'after' ? 1 : 0), 0, source);
  state.sidebarSessionOrder = order.map(item => item.id);
  for (const session of ordered) if (!session.archived && sidebarSessionScope(session) === scope) {
    session.sidebarActivityAt = new Date(Math.max(timestamp(at), sidebarActivityTime(session))).toISOString();
  }
}

export interface SidebarOrderingService {
  initialize(state: AppState): void;
  observe(previous: AppState, next: AppState, at: string): void;
  reorder(state: AppState, request: SessionReorderRequest, at: string): void;
}
export const createSidebarOrderingService = (): SidebarOrderingService => ({
  initialize: initializeSidebarSessions, observe: observeSidebarSessions, reorder: reorderSidebarSession,
});
