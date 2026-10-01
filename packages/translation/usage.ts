import type { Session } from '../contracts';
import { sessionMetrics, tokenFields, tokenCount, type MetricsSnapshot, type UsageRecord, type TokenCounts } from '../session-metrics';
import type { TranslationUsageReceipt, TranslationUsageState } from './types';

function validReceipt(receipt: TranslationUsageReceipt) {
  if (!receipt || typeof receipt.id !== 'string' || !receipt.id || receipt.id.length>256 || typeof receipt.sourceId!=='string' || !receipt.sourceId || receipt.sourceId.length>512 || typeof receipt.model!=='string' || receipt.model.length>256 || typeof receipt.runtime!=='string' || !receipt.runtime || !Number.isFinite(Date.parse(receipt.at)) || !['translation','refine','segments'].includes(receipt.operation) || !['input','output'].includes(receipt.direction) || !['complete','failed'].includes(receipt.status) || !Number.isFinite(receipt.elapsedMs) || receipt.elapsedMs<0 || receipt.reasoningTokens!==null&&tokenCount(receipt.reasoningTokens)===null || tokenFields.some(field => receipt[field] !== null && tokenCount(receipt[field]) === null)) throw Error('TRANSLATION_USAGE_INVALID');
}
export function validateTranslationUsage(state:TranslationUsageState) {
  if(!state||state.version!==1||!Array.isArray(state.records)||!Array.isArray(state.cursors)||!Array.isArray(state.attempts)||state.records.length!==state.attempts.length)throw Error('TRANSLATION_USAGE_STATE_INVALID');
  const ids=new Set<string>();
  for(const receipt of state.attempts){validReceipt(receipt);if(ids.has(receipt.id))throw Error('TRANSLATION_USAGE_STATE_INVALID');ids.add(receipt.id);}
  const receipts=new Map(state.attempts.map(receipt=>[receipt.id,receipt]));
  const records=new Set<string>();
  for(const row of state.records){const receipt=receipts.get(row.id);if(!receipt||records.has(row.id)||row.model!==receipt.model||row.source!==receipt.sourceId||row.runtime!==receipt.runtime||row.steps!==1||row.turnId!==receipt.id||row.recordedAt!==receipt.at||row.updatedAt!==receipt.at||tokenFields.some(field=>row[field]!==receipt[field]))throw Error('TRANSLATION_USAGE_STATE_INVALID');records.add(row.id);}
}
export function recordTranslationUsage(previous: TranslationUsageState | undefined, receipt: TranslationUsageReceipt): TranslationUsageState {
  validReceipt(receipt);
  const state: TranslationUsageState = structuredClone(previous ?? { version: 1, records: [], cursors: [], attempts: [] });
  const old = state.attempts.findIndex(row => row.id === receipt.id);
  if(old>=0&&Date.parse(state.attempts[old]!.at)>Date.parse(receipt.at))return state;
  if (old >= 0) state.attempts[old] = structuredClone(receipt); else state.attempts.push(structuredClone(receipt));
  const row: UsageRecord = { ...Object.fromEntries(tokenFields.map(key => [key, receipt[key]])) as TokenCounts, id: receipt.id, source: receipt.sourceId, turnId: receipt.id, runtime: receipt.runtime, model: receipt.model, steps: 1, updatedAt: receipt.at, recordedAt: receipt.at };
  const index = state.records.findIndex(record => record.id === row.id);
  if (index >= 0) state.records[index] = row; else state.records.push(row);
  if (receipt.outputTokens !== null && receipt.elapsedMs > 0) state.rate = { outputTokens: receipt.outputTokens, elapsedMs: receipt.elapsedMs, basis: 'api', turnId: receipt.id, updatedAt: receipt.at };
  return state;
}
export function translationMetrics(state?: TranslationUsageState): MetricsSnapshot {
  const value = sessionMetrics({ id: 'translation', projectId:null,title:'Translation',group:'',pinned:false,archived:false,status:'idle',createdAt:'',updatedAt:'',messages: [], binding: { runtime: 'api',provider:'translation',accountRef:'translation',executionId:'local-device',egress:'direct-api' }, metrics: state } as Session);
  return { ...value, rounds: state?.attempts.length ?? 0, steps: state?.attempts.length ?? 0, ...(!state?.records.length ? {inputTokens:0,outputTokens:0,totalTokens:0} : {}) };
}
