import type { Session } from '../contracts';

export interface TurnTiming {
  id: string;
  startedAt: string;
  endedAt?: string;
  /** Public failure explanation retained with this turn, never cleared by the next send. */
  error?: string;
  userMessageId?: string;
  nativeTurnId?: string;
  status: 'running' | 'completed' | 'stopped' | 'failed' | 'uncertain';
}

/** Local execution admission to terminal receipt, including CLI startup, tools and waits. */
export function observeTurnTiming(previous: Session | undefined, session: Session, at: string): void {
  if (!Number.isFinite(Date.parse(at))) throw Error('TURN_TIMING_INVALID_TIMESTAMP');
  let timing = session.turnTimings?.findLast(item => item.status === 'running');
  if (session.status === 'running' && previous?.status !== 'running') {
    const last = session.turnTimings?.at(-1);
    if (last && previous?.nativeError && last.id === previous.turnTimings?.at(-1)?.id) last.error ??= previous.nativeError;
    if (timing) timing.status = 'uncertain';
    timing = { id: `${session.id}:${at}:${session.turnTimings?.length ?? 0}`, startedAt: at, status: 'running' };
    (session.turnTimings ??= []).push(timing);
  }
  if (!timing) {
    const last = session.turnTimings?.at(-1);
    if (last && session.status !== 'running' && last.nativeTurnId === session.nativeTurnId && session.nativeError && session.nativeError !== previous?.nativeError) last.error ??= session.nativeError;
    return;
  }
  if (!timing.userMessageId) {
    const old = new Set(previous?.messages.map(message => message.id));
    timing.userMessageId = session.messages.find(message => message.role === 'user' && !old.has(message.id) && !['pending', 'not-sent', 'uncertain'].includes(message.delivery ?? ''))?.id;
  }
  const user = session.messages.find(message => message.id === timing.userMessageId);
  if (user?.nativeTurnId) timing.nativeTurnId = user.nativeTurnId;
  else if (session.nativeTurnId && (previous?.status !== 'running' || session.nativeTurnId !== previous?.nativeTurnId)) timing.nativeTurnId = session.nativeTurnId;
  if (session.status === 'running') return;
  const nativeStatus = session.nativeTurnStatus?.toLowerCase();
  timing.status = session.status === 'uncertain' ? 'uncertain'
    : ['interrupted', 'cancelled', 'canceled', 'stopped', 'budget-exhausted'].includes(nativeStatus ?? '') ? 'stopped'
    : session.status === 'blocked' || !!session.nativeError || nativeStatus === 'failed' ? 'failed' : 'completed';
  if (timing.status !== 'uncertain') timing.endedAt = at;
  if (session.nativeError) timing.error = session.nativeError;
}

/** Unknown completion stays unknown, including recovery after an application exit. */
export function turnElapsedMs(timing: TurnTiming, now = Date.now()): number | null {
  const end = timing.status === 'running' ? now : timing.endedAt ? Date.parse(timing.endedAt) : NaN;
  const start = Date.parse(timing.startedAt);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

export function formatTurnDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分 ${seconds % 60} 秒`;
}
