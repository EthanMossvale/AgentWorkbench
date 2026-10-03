import type { Protocol, RuntimeKind, Session } from '../contracts';

export const tokenFields = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens'] as const;
export type TokenField = typeof tokenFields[number];
export type TokenCounts = Record<TokenField, number | null>;
/** Presentation only. Raw input counters retain their inclusive wire semantics. */
export function uncachedInput(counts: TokenCounts & {incomplete?: TokenField[]}): {value:number|null;upperBound:boolean} {
  if(counts.inputTokens===null||counts.incomplete?.includes('inputTokens'))return {value:null,upperBound:false};
  const value=Math.max(0,counts.inputTokens-(counts.cacheReadTokens??0)-(counts.cacheWriteTokens??0));
  return {value,upperBound:value>0&&(counts.cacheReadTokens===null||counts.cacheWriteTokens===null||!!counts.incomplete?.some(f=>f==='cacheReadTokens'||f==='cacheWriteTokens'))};
}
export interface UsageSample extends TokenCounts {
  /** Stable request identity; updates replace the same request, never add it twice. */
  id: string; model?: string; steps?: number; elapsedMs?: number;
}
export interface UsageRecord extends TokenCounts {
  scope?: import('../model-management/types').UsageScope;
  recordedAt?: string;
  id: string; source: string; turnId: string; runtime: RuntimeKind; model: string;
  steps: number; updatedAt: string;
}
export interface UsageRate {
  outputTokens: number; elapsedMs: number; basis: 'api' | 'turn'; turnId: string; updatedAt: string;
}
export interface UsageCursor {
  source: string; total?: TokenCounts; fingerprint?: string; updatedAt?: string;
  turnId?: string; startedAt?: string; completed?: string; resultIds?: string[];
}
export interface SessionMetrics {
  version: 1; records: UsageRecord[]; cursors: UsageCursor[]; rate?: UsageRate; partialHistory?: boolean;
}
export interface MetricsGroup extends TokenCounts {
  runtime: RuntimeKind; model: string; steps: number; incomplete: TokenField[];
  cacheHitRate: number | null;
}
export interface MetricsSnapshot extends TokenCounts {
  version: 1; rounds: number; steps: number | null; tokensPerSecond: number | null;
  rateBasis: UsageRate['basis'] | null; cacheHitRate: number | null;
  groups: MetricsGroup[]; incomplete: TokenField[]; partialHistory: boolean;
  /** Selected configuration, not attribution evidence for historical receipts. */
  selection?: { runtime: RuntimeKind; model: string };
}
const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
export const tokenCount = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const empty = (): TokenCounts => ({ inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, totalTokens: null });
const plus = (a: number | null, b: number | null) => a === null || b === null ? null : tokenCount(a + b);
function sanitized(counts: TokenCounts): TokenCounts {
  if (counts.inputTokens !== null && (counts.cacheReadTokens ?? 0) + (counts.cacheWriteTokens ?? 0) > counts.inputTokens) { counts.cacheReadTokens = null; counts.cacheWriteTokens = null; }
  return counts;
}

/** Input includes cached tokens; cache reads/writes are subsets, not extra total tokens. */
export function parseTokenCounts(value: unknown, protocol: Protocol | 'codex'): TokenCounts {
  const v = object(value);
  if (protocol === 'codex') return sanitized({
    inputTokens: tokenCount(v.inputTokens), outputTokens: tokenCount(v.outputTokens),
    cacheReadTokens: tokenCount(v.cachedInputTokens), cacheWriteTokens: null,
    totalTokens: tokenCount(v.totalTokens) ?? plus(tokenCount(v.inputTokens), tokenCount(v.outputTokens)),
  });
  const read = tokenCount(v.cache_read_input_tokens ?? v.prompt_cache_hit_tokens ?? object(v.input_tokens_details).cached_tokens ?? object(v.prompt_tokens_details).cached_tokens);
  const write = tokenCount(v.cache_creation_input_tokens ?? object(v.input_tokens_details).cache_write_tokens ?? object(v.prompt_tokens_details).cache_write_tokens);
  const input = tokenCount(v.input_tokens ?? v.prompt_tokens), output = tokenCount(v.output_tokens ?? v.completion_tokens);
  const allInput = input === null ? null : tokenCount(input + (protocol === 'anthropic-messages' ? (read ?? 0) + (write ?? 0) : 0));
  return sanitized({ inputTokens: allInput, outputTokens: output, cacheReadTokens: read, cacheWriteTokens: write, totalTokens: tokenCount(v.total_tokens) ?? plus(allInput, output) });
}

export function metricsSource(session: Session, thread?: string): string {
  return JSON.stringify([session.binding.runtime, session.modelTargetId ?? session.binding.modelConnectionId ?? session.binding.hostId ?? 'local', thread ?? session.binding.nativeSessionId ?? '']);
}
export function metricsModel(session: Session, turnId?: string): string {
  const user = session.messages.filter(m => m.role === 'user' && (!turnId || m.nativeTurnId === turnId)).at(-1);
  return user?.modelSource?.model ?? session.nativeActiveSettings?.modelSelection?.model ?? session.modelSelection?.model ?? session.nativeEffectiveModel?.model ?? '';
}
export function metricsState(session: Session): SessionMetrics {
  const users = session.messages.slice(session.branch?.inheritedMessageCount ?? 0).filter(m => m.role === 'user' && (!m.delivery || m.delivery === 'accepted'));
  return session.metrics ??= { version: 1, records: [], cursors: [], partialHistory: new Set(users.map(m => m.nativeTurnId ?? m.id)).size > 1 };
}
export function metricsCursor(session: Session, source: string): UsageCursor {
  const metrics = metricsState(session);
  let cursor = metrics.cursors.find(c => c.source === source);
  if (!cursor) { cursor = { source }; metrics.cursors.push(cursor); }
  return cursor;
}
export function validateUsageSample(sample: UsageSample): void {
  if (!sample || typeof sample.id !== 'string' || !sample.id || sample.id.length > 512 || sample.model !== undefined && (typeof sample.model !== 'string' || sample.model.length > 256)
    || tokenFields.some(field => sample[field] !== null && tokenCount(sample[field]) === null)
    || sample.steps !== undefined && tokenCount(sample.steps) === null
    || sample.elapsedMs !== undefined && (!Number.isFinite(sample.elapsedMs) || sample.elapsedMs <= 0)
    || sample.inputTokens !== null && ((sample.cacheReadTokens ?? 0) + (sample.cacheWriteTokens ?? 0) > sample.inputTokens)) throw Error('SESSION_USAGE_INVALID');
}
/** Trusted runner entry point. No text, credentials or raw frames are persisted. */
export function recordSessionUsage(session: Session, sample: UsageSample, options: { source: string; turnId: string; at: string; rateBasis?: UsageRate['basis'] }): void {
  validateUsageSample(sample);
  const state = metricsState(session), record: UsageRecord = {
    ...Object.fromEntries(tokenFields.map(key => [key, sample[key]])) as TokenCounts,
    id: sample.id, source: options.source, turnId: options.turnId, runtime: session.binding.runtime,
    model: sample.model ?? metricsModel(session, options.turnId), steps: sample.steps ?? 1, updatedAt: options.at,
    recordedAt: options.at,
    ...(session.binding.localAccountId ? {scope:{kind:'account' as const,id:session.binding.localAccountId}} : session.binding.modelConnectionId ? {scope:{kind:'api' as const,id:session.binding.modelConnectionId}} : session.binding.accountRuntime==='native-owner'&&session.binding.accountRef.startsWith('vps-account:')?{scope:{kind:'account' as const,id:session.binding.accountRef}}:{}),
  };
  const index = state.records.findIndex(r => r.source === record.source && r.turnId === record.turnId && r.id === record.id);
  if (index >= 0) {
    const previous = state.records[index]!;
    record.recordedAt = previous.recordedAt ?? previous.updatedAt;
    if (previous.updatedAt > record.updatedAt) return;
    // Later partial snapshots do not erase a field already reported for this request.
    for (const field of tokenFields) if (record[field] === null) record[field] = previous[field];
    state.records[index] = record;
  } else state.records.push(record);
  if (sample.elapsedMs && sample.outputTokens !== null) state.rate = { outputTokens: sample.outputTokens, elapsedMs: sample.elapsedMs, basis: options.rateBasis ?? 'api', turnId: options.turnId, updatedAt: options.at };
}

function totals(records: UsageRecord[]): TokenCounts & { incomplete: TokenField[] } {
  const result = { ...empty(), incomplete: [] as TokenField[] };
  for (const field of tokenFields) {
    const values = records.map(r => r[field]).filter((n): n is number => n !== null);
    result[field] = values.length ? values.reduce((a, b) => a + b, 0) : null;
    if (values.length < records.length) result.incomplete.push(field);
  }
  return result;
}
/** Token-weighted ratio over matching input/read receipts; missing counters are not zero. */
export function cacheHitRate(records: readonly Pick<TokenCounts, 'inputTokens' | 'cacheReadTokens'>[]): number | null {
  let input = 0, read = 0;
  for (const row of records) {
    if (row.inputTokens === null || row.cacheReadTokens === null || row.inputTokens <= 0 || row.cacheReadTokens > row.inputTokens) continue;
    input += row.inputTokens; read += row.cacheReadTokens;
  }
  return input > 0 ? read / input : null;
}

/** Read-only, renderer-safe selector; runtime/model switches keep all prior groups. */
export function sessionMetrics(session?: Session): MetricsSnapshot {
  const records = session?.metrics?.records ?? [], groups: MetricsGroup[] = [];
  const keys = new Set(records.map(r => JSON.stringify([r.runtime, r.model])));
  for (const key of keys) {
    const [runtime, model] = JSON.parse(key) as [RuntimeKind, string];
    const rows = records.filter(r => r.runtime === runtime && r.model === model), value = totals(rows);
    groups.push({ runtime, model, ...value, steps: rows.reduce((sum, r) => sum + r.steps, 0), cacheHitRate: cacheHitRate(rows) });
  }
  const inherited = session?.branch?.inheritedMessageCount ?? 0;
  const messages = session?.messages.slice(inherited).filter(m => m.role === 'user' && (!m.delivery || m.delivery === 'accepted')) ?? [];
  // Steering inside one native turn is not another round.
  const rounds = new Set(messages.map(m => m.nativeTurnId ?? m.id)).size;
  const value = totals(records), rate = session?.metrics?.rate;
  const activeRate = rate && !(session?.status === 'running' && session.nativeTurnId && rate.turnId !== session.nativeTurnId) ? rate : undefined;
  return { version: 1, ...value, rounds, steps: records.length ? records.reduce((sum, r) => sum + r.steps, 0) : rounds ? null : 0,
    tokensPerSecond: activeRate && activeRate.elapsedMs > 0 ? activeRate.outputTokens / activeRate.elapsedMs * 1000 : null,
    rateBasis: activeRate?.basis ?? null, cacheHitRate: cacheHitRate(records), groups,
    partialHistory: !!session?.metrics?.partialHistory || !!rounds && !records.length,
    ...(session ? { selection: { runtime: session.binding.runtime, model: session.modelSelection?.model ?? session.nativeEffectiveModel?.model ?? '' } } : {}) };
}
