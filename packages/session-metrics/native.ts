import type { Session } from '../contracts';
import { metricsCursor, metricsModel, metricsSource, metricsState, parseTokenCounts, recordSessionUsage, tokenCount, tokenFields, type TokenCounts } from './index';

interface Frame { value: Record<string, any>; receivedAt: string }
const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const sum = (records: TokenCounts[], field: keyof TokenCounts) => records.reduce((n, row) => n + (row[field] ?? 0), 0);

/** Accept only counters/lifecycle metadata from the already-bound root stream. */
export function isMetricsFrame(runtime: string, frame: Frame): boolean {
  const v = frame.value;
  return runtime === 'codex' ? ['thread/tokenUsage/updated', 'turn/started', 'turn/completed'].includes(v.method)
    : runtime === 'claude' && ['assistant', 'result', 'user'].includes(v.type);
}
export function observeNativeMetrics(session: Session, frame: Frame): void {
  const v = frame.value, p = obj(v.params), at = frame.receivedAt, runtime = session.binding.runtime;
  if (!isMetricsFrame(runtime, frame) || !Number.isFinite(Date.parse(at))) return;
  // Direct-provider traffic is metered at the gateway, before protocol conversion.
  if (session.binding.modelConnectionId && session.binding.egress === 'direct-api') return;
  if (runtime === 'codex') {
    if (!session.binding.nativeSessionId || p.threadId !== session.binding.nativeSessionId) return;
    const source = metricsSource(session, p.threadId), cursor = metricsCursor(session, source);
    if (cursor.updatedAt && at < cursor.updatedAt) return;
    const turnId = String(p.turnId ?? p.turn?.id ?? session.nativeTurnId ?? '');
    if (v.method === 'turn/started') {
      if (cursor.turnId !== turnId) { cursor.turnId = turnId; cursor.startedAt = at; }
      return;
    }
    if (v.method === 'thread/tokenUsage/updated') {
      const usage = obj(p.tokenUsage), total = parseTokenCounts(usage.total, 'codex'), last = parseTokenCounts(usage.last, 'codex');
      if (total.totalTokens === null) return;
      const fingerprint = JSON.stringify([turnId, total]);
      if (cursor.fingerprint === fingerprint) return;
      if (metricsState(session).records.some(r => r.source === source && r.id === fingerprint)) return;
      const reset = cursor.total && tokenFields.some(field => total[field] !== null && cursor.total![field] !== null && total[field]! < cursor.total![field]!);
      const counts = { ...last };
      if (cursor.total && !reset) for (const field of tokenFields) counts[field] = total[field] === null || cursor.total[field] === null ? last[field] : total[field]! - cursor.total[field]!;
      else if ((total.totalTokens ?? 0) > (last.totalTokens ?? 0) || reset) metricsState(session).partialHistory = true;
      if ((counts.cacheReadTokens ?? 0) > (counts.inputTokens ?? Infinity)) counts.cacheReadTokens = null;
      recordSessionUsage(session, { id: fingerprint, ...counts, model: metricsModel(session, turnId) }, { source, turnId, at });
      cursor.total = total; cursor.fingerprint = fingerprint; cursor.updatedAt = at;
    }
    const startedAt = cursor.turnId === turnId ? cursor.startedAt : session.messages.find(m => m.role === 'user' && m.nativeTurnId === turnId)?.timestamp;
    const elapsed = startedAt ? Date.parse(at) - Date.parse(startedAt) : 0;
    const rows = metricsState(session).records.filter(r => r.source === source && r.turnId === turnId);
    if (elapsed > 0 && rows.some(r => r.outputTokens !== null)) metricsState(session).rate = { outputTokens: sum(rows, 'outputTokens'), elapsedMs: elapsed, basis: 'turn', turnId, updatedAt: at };
    return;
  }
  // Native child usage is represented by its own session/stream; never add it twice here.
  if (v.parent_tool_use_id || v.parentToolUseId || v.type === 'user' && Array.isArray(v.message?.content)) return;
  if (v.session_id && session.binding.nativeSessionId && v.session_id !== session.binding.nativeSessionId) return;
  const source = metricsSource(session, v.session_id), cursor = metricsCursor(session, source);
  if (v.type === 'result' && typeof v.uuid === 'string' && cursor.resultIds?.includes(v.uuid)) return;
  const user = session.messages.filter(m => m.role === 'user' && m.delivery !== 'not-sent').at(-1);
  const turnId = user?.nativeTurnId ?? session.nativeTurnId ?? user?.id ?? '';
  if (!turnId || cursor.completed === turnId) return;
  if (v.type === 'assistant') {
    const message = obj(v.message), id = message.id ?? v.uuid;
    if (typeof id !== 'string' || !message.usage) return;
    if (metricsState(session).records.some(r => r.source === source && r.id === id && r.turnId !== turnId)) return;
    const counts = parseTokenCounts(message.usage, 'anthropic-messages');
    if (Object.values(counts).every(n => n === null)) return;
    recordSessionUsage(session, { id, ...counts, model: typeof message.model === 'string' ? message.model : metricsModel(session) }, { source, turnId, at });
    const elapsed = user ? Date.parse(at) - Date.parse(user.timestamp) : 0;
    const rows = metricsState(session).records.filter(r => r.source === source && r.turnId === turnId);
    if (elapsed > 0) metricsState(session).rate = { outputTokens: sum(rows, 'outputTokens'), elapsedMs: elapsed, basis: 'turn', turnId, updatedAt: at };
  } else if (v.type === 'result') {
    const state = metricsState(session), rows = state.records.filter(r => r.source === source && r.turnId === turnId);
    const reported = parseTokenCounts(v.usage, 'anthropic-messages');
    const residual = Object.fromEntries(tokenFields.map(field => [field, reported[field] === null ? null : Math.max(0, reported[field]! - sum(rows, field))])) as TokenCounts;
    const steps = Math.max(0, (tokenCount(v.num_turns) ?? (rows.length ? rows.length : 1)) - rows.reduce((n, r) => n + r.steps, 0));
    const models = [...new Set(rows.map(r => r.model))], reportedModels = Object.keys(obj(v.modelUsage));
    const model = models.length === 1 ? models[0]! : models.length ? '' : reportedModels.length === 1 ? reportedModels[0]! : metricsModel(session);
    if (!rows.length || steps || tokenFields.some(field => (residual[field] ?? 0) > 0)) {
      // Aggregate residuals cannot safely be assigned to one of multiple observed models.
      if ((residual.cacheReadTokens ?? 0) + (residual.cacheWriteTokens ?? 0) > (residual.inputTokens ?? Infinity)) { residual.cacheReadTokens = null; residual.cacheWriteTokens = null; state.partialHistory = true; }
      recordSessionUsage(session, { id: 'result:' + turnId, ...residual, model, steps }, { source, turnId, at });
    }
    const elapsedMs = typeof v.duration_api_ms === 'number' && v.duration_api_ms > 0 ? v.duration_api_ms : 0;
    const outputTokens = reported.outputTokens ?? (rows.some(r => r.outputTokens !== null) ? sum(rows, 'outputTokens') : null);
    if (elapsedMs && outputTokens !== null) state.rate = { outputTokens, elapsedMs, basis: 'api', turnId, updatedAt: at };
    cursor.completed = turnId;
    if (typeof v.uuid === 'string') (cursor.resultIds ??= []).push(v.uuid);
  }
}
