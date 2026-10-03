import type { AppState, Session } from '../contracts';
import { cacheHitRate, tokenFields, type TokenCounts, type UsageRecord } from '../session-metrics';
import type { ModelPrice, ModelUsageEntry, ModelUsageSummary, UsagePeriod, UsageScope } from './types';
import { referencePrice } from './prices';

const same = (a: UsageScope, b: UsageScope) => a.kind === b.kind && a.id === b.id;
export function usageScope(session: Session): UsageScope | undefined {
  if (session.binding.localAccountId) return { kind: 'account', id: session.binding.localAccountId };
  if (session.binding.modelConnectionId) return { kind: 'api', id: session.binding.modelConnectionId };
  if (session.binding.accountRuntime==='native-owner'&&session.binding.accountRef.startsWith('vps-account:')) return {kind:'account',id:session.binding.accountRef};
}
function historicalScope(session: Session, row: UsageRecord): UsageScope | undefined {
  if (row.scope) return row.scope;
  try {
    const [, target] = JSON.parse(row.source);
    if (typeof target === 'string' && target.startsWith('api/')) return { kind: 'api', id: decodeURIComponent(target.split('/')[1]!) };
    if (typeof target === 'string' && target.startsWith('account/')) return { kind: 'account', id: decodeURIComponent(target.split('/')[1]!) };
    if (!session.modelLanes?.length && target === session.binding.modelConnectionId) return usageScope(session);
    if (!session.modelLanes?.length && session.binding.accountRuntime==='native-owner' && (target===session.binding.hostId||target===session.modelTargetId)) return usageScope(session);
  } catch { /* Unattributed legacy observations are not charged to a new source. */ }
}
/**
 * Keep numeric observations when a chat is removed. Repeated snapshots replace by identity.
 * `only` limits the scan to sessions replaced by a session-scoped update. Their
 * untouched peers were already captured by earlier commits, so the history and
 * its identity are kept unless a captured row actually changes.
 */
export function captureModelUsage(previous: AppState, next: AppState, only?: ReadonlySet<string>) {
  const entries = new Map((next.modelUsage ?? []).map(row => [row.key, row]));
  let changed = false;
  for (const state of [previous, next]) for (const session of state.sessions) {
    if (only && !only.has(session.id)) continue;
    for (const row of session.metrics?.records ?? []) {
      const scope = historicalScope(session, row);
      if (!scope) continue;
      const key = JSON.stringify([session.id, row.source, row.turnId, row.id]);
      const old = entries.get(key);
      if (old && old.updatedAt > row.updatedAt) continue;
      const entry = { ...row, scope, key, recordedAt: old?.recordedAt ?? row.recordedAt ?? row.updatedAt };
      if (only && old && JSON.stringify(old) === JSON.stringify(entry)) continue;
      entries.set(key, entry); changed = true;
    }
  }
  if (entries.size && (!only || changed)) next.modelUsage = [...entries.values()];
}
/** Refresh only this source, including corrected receipts with equal timestamps. */
export function modelUsageRevision(state: AppState, scope: UsageScope): string {
  return JSON.stringify([scope.kind==='translation'?state.translationUsage?.records:(state.modelUsage??[]).filter(row=>same(row.scope,scope)),(state.modelPrices??[]).filter(row=>same(row.scope,scope))]);
}
export function validatePrice(value: unknown): ModelPrice {
  const v = value as ModelPrice;
  if (!v || typeof v !== 'object' || !['input', 'output'].every(k => typeof v[k as keyof ModelPrice] === 'number') || Object.keys(v).some(k => !['input', 'output', 'cacheRead', 'cacheWrite'].includes(k)) || Object.values(v).some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1000000)) throw Error('MODEL_PRICE_INVALID');
  return { input: v.input, output: v.output, ...(v.cacheRead !== undefined ? { cacheRead: v.cacheRead } : {}), ...(v.cacheWrite !== undefined ? { cacheWrite: v.cacheWrite } : {}) };
}
export function estimateUsd(counts: TokenCounts, price?: ModelPrice): number | null {
  if (!price || counts.inputTokens === null || counts.outputTokens === null) return null;
  // Omitted cache rates mean the input rate; a discount requires known cache counts.
  if (price.cacheRead !== undefined && price.cacheRead !== price.input && counts.cacheReadTokens === null || price.cacheWrite !== undefined && price.cacheWrite !== price.input && counts.cacheWriteTokens === null) return null;
  const read = counts.cacheReadTokens ?? 0, write = counts.cacheWriteTokens ?? 0;
  return ((counts.inputTokens - read - write) * price.input + read * (price.cacheRead ?? price.input) + write * (price.cacheWrite ?? price.input) + counts.outputTokens * price.output) / 1e6;
}
/** Price each receipt before aggregation: missing partitions must not erase known costs. */
function minimumUsd(counts: TokenCounts, price?: ModelPrice): number | null {
  if (!price || [counts.inputTokens, counts.outputTokens, counts.cacheReadTokens, counts.cacheWriteTokens].every(n => n === null)) return null;
  const read = counts.cacheReadTokens ?? 0, write = counts.cacheWriteTokens ?? 0;
  const readRate = price.cacheRead ?? price.input, writeRate = price.cacheWrite ?? price.input;
  // An unclassified input token could belong to any unreported cache category.
  // Use its cheapest possible rate, not a guessed zero count or full input rate.
  const remainingRate = Math.min(price.input, counts.cacheReadTokens === null ? readRate : price.input, counts.cacheWriteTokens === null ? writeRate : price.input);
  const remaining = Math.max(0, (counts.inputTokens ?? read + write) - read - write);
  return (remaining * remainingRate + read * readRate + write * writeRate + (counts.outputTokens ?? 0) * price.output) / 1e6;
}
const sumKnown = (values: (number | null)[]): number | null => values.every(n => n === null) ? null : values.reduce<number>((sum, n) => sum + (n ?? 0), 0);
const totals = (rows: ModelUsageEntry[]) => {
  const counts = Object.fromEntries(tokenFields.map(field => [field, rows.length ? rows.every(row => row[field] === null) ? null : rows.reduce((sum, row) => sum + (row[field] ?? 0), 0) : 0])) as TokenCounts;
  return { ...counts, incomplete: tokenFields.filter(field => rows.some(row => row[field] === null)) };
};
export function modelUsageSummary(state: AppState, scope: UsageScope, period: UsagePeriod, now = Date.now()): ModelUsageSummary {
  if (!scope || !['api', 'account', 'translation'].includes(scope.kind) || typeof scope.id !== 'string' || !scope.id || scope.kind==='translation'&&(scope.id!=='translation'||period==='cycle') || !['1day', '7day', 'cycle', 'month'].includes(period)) throw Error('MODEL_USAGE_QUERY_INVALID');
  const cycle = scope.kind === 'account' ? state.localModelAccounts?.find(a => a.id === scope.id)?.cycle : undefined;
  const cycleUnavailable = period === 'cycle' && (!cycle || Date.parse(cycle.end) <= now);
  const start = period === '1day' ? now - 86400000 : period === '7day' ? now - 7 * 86400000 : period === 'month' ? new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime() : cycleUnavailable ? NaN : Date.parse(cycle!.start);
  const copy = { ...state }; captureModelUsage(state, copy);
  const ledger:ModelUsageEntry[]=scope.kind==='translation'?(state.translationUsage?.records??[]).map(row=>({...row,key:row.id,scope,recordedAt:row.recordedAt??row.updatedAt})):(copy.modelUsage??[]);
  const rows = ledger.filter(row => same(row.scope, scope) && Date.parse(row.recordedAt) >= start && Date.parse(row.recordedAt) <= now);
  const names = new Set(rows.map(row => row.model));
  // Include configured models even before the first receipt, with true zero usage.
  if (scope.kind === 'api') state.modelConnections?.find(c => c.id === scope.id)?.models.forEach(m => names.add(m.model));
  else if(scope.kind==='account') state.localModelAccounts?.find(a => a.id === scope.id)?.models.forEach(m => names.add(m.model));
  const groups = [...names].sort().map(model => {
    const selected = rows.filter(row => row.model === model), count = totals(selected), saved = state.modelPrices?.find(p => same(p.scope, scope) && p.model === model);
    const price = saved?.price ?? referencePrice(model), cost = selected.map(row => estimateUsd(row, price));
    return { model, ...count, requests: selected.reduce((n, row) => n + row.steps, 0), price, priceSource: saved ? 'manual' as const : price ? 'reference' as const : undefined, priceRevision: saved?.revision, estimatedUsd: !selected.length ? 0 : cost.some(v => v === null) ? null : cost.reduce<number>((a, b) => a + b!, 0), lowerBoundUsd: sumKnown(selected.map(row => minimumUsd(row, price))), cacheHitRate: cacheHitRate(selected) };
  });
  const unpricedModels = groups.filter(g => g.estimatedUsd === null).length, pricedUsd = groups.reduce((n, g) => n + (g.estimatedUsd ?? 0), 0);
  return { scope, period, from: Number.isFinite(start) ? new Date(start).toISOString() : null, until: new Date(now).toISOString(), ...totals(rows), groups, estimatedUsd: unpricedModels ? null : pricedUsd, lowerBoundUsd: sumKnown(groups.map(g => g.lowerBoundUsd)), pricedUsd, unpricedModels, cycleUnavailable, partialHistory: state.sessions.some(s => { const current = usageScope(s); return !!current && same(current, scope) && (!!s.metrics?.partialHistory || !s.metrics && s.messages.some(m => m.role === 'user')); }) };
}
