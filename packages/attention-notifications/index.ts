import type {AppState,Session} from '../contracts';

/** A session event that needs the user while they are looking elsewhere. */
export type AttentionKind = 'completed' | 'permission' | 'question';
/** `error` is set when a finished turn failed, was blocked or has an unknown result. */
export interface AttentionAlert { id: string; sessionId: string; kind: AttentionKind; title: string; body: string; error?: string }
export interface AttentionDelivery { shown: boolean; sound: boolean }
/** Payload of the `workbench.notifications` / `attention` plugin event. */
export interface AttentionEvent extends AttentionAlert, AttentionDelivery { focused: boolean }
/**
 * `workbench.notifications` host service. Overriding `deliver` replaces the system
 * notification; overriding `focused` replaces the background-session rule.
 */
export interface AttentionNotificationsApi {
  focused(sessionId: string): Promise<boolean>;
  deliver(alert: AttentionAlert): Promise<AttentionDelivery>;
}

const bodies: Record<string, string> = {completed:'任务已完成', failed:'任务出错停止', permission:'正在请求权限', plan:'计划等待确认', question:'提出了一个问题，等待回答'};
const requestKey = (prefix: string, value: {receipt?: string; id: string | number}) => prefix + ':' + (value.receipt ?? String(value.id));

/**
 * Compares published states. The first observation is a baseline, so restored
 * sessions and requests that already existed at startup never notify.
 */
export class AttentionDetector {
  private known?: Map<string, {status: Session['status']; requests: Set<string>}>;
  observe(state: AppState): AttentionAlert[] {
    const next = new Map<string, {status: Session['status']; requests: Set<string>}>(), alerts: AttentionAlert[] = [];
    for (const session of state.sessions) {
      if (session.archived) continue;
      const requests = new Map<string, AttentionAlert['kind'] | 'plan'>();
      for (const approval of session.nativeApprovals ?? []) requests.set(requestKey('approval', approval), approval.kind === 'plan' ? 'plan' : 'permission');
      for (const item of session.nativeInteractions ?? []) if (item.status === 'pending') requests.set(requestKey('interaction', item), item.kind === 'permissions' ? 'permission' : 'question');
      next.set(session.id, {status: session.status, requests: new Set(requests.keys())});
      if (!this.known) continue;
      const previous = this.known.get(session.id), title = session.title || 'Agent Workbench';
      const alert = (id: string, kind: AttentionKind, body: string, error?: string) => alerts.push({id: session.id + ':' + id, sessionId: session.id, kind, title, body, ...(error !== undefined ? {error} : {})});
      // Native child agents end inside their parent's turn; the parent's completion is the task.
      if (previous?.status === 'running' && session.status !== 'running' && !session.agentParent) {
        const failed = session.status !== 'idle' || session.nativeTurnStatus === 'failed';
        alert('completed:' + (session.messages.at(-1)?.id ?? session.messages.length), 'completed', failed ? bodies.failed! : bodies.completed!, failed ? (session.nativeError ?? '').slice(0, 300) : undefined);
      }
      for (const [key, kind] of requests) if (!previous?.requests.has(key)) alert(key, kind === 'plan' ? 'permission' : kind, bodies[kind]!);
    }
    this.known = next;
    return alerts;
  }
}
