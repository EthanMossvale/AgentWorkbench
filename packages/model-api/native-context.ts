import type { NativeContextUsage, Session } from '../contracts';
import { metricsSource } from '../session-metrics';
import type { ApiModel } from './types';

/** Requested budget; native safety limits may compact earlier (Codex 0.155.1 caps at 90%). */
export function nativeContextSettings(model: ApiModel) {
  if (!Number.isSafeInteger(model.contextWindow) || !model.contextWindow || model.contextWindow < 1) return undefined;
  return { window: model.contextWindow, compactAt: Math.max(1, Math.floor(model.contextWindow * 90 / 100)) };
}
/** Claude's recognized-family/[1m] heuristics otherwise ignore explicit gateway capacity. */
export function claudeContextModel(model: ApiModel): string {
  if (!model.contextWindow || !/claude|opus|sonnet|haiku|fable|\[1m\]/i.test(model.model)) return model.model;
  // A transparent gateway-local alias; never used as the upstream model ID.
  // Encode Unicode code points to avoid dependencies in this shared renderer module.
  return 'awb-model-' + Array.from(model.model, character => character.codePointAt(0)!.toString(16)).join('-');
}
/** Runtime defaults are execution budgets, not evidence of a custom upstream model limit. */
export function providerContextUsage(model: ApiModel, usage: NativeContextUsage): NativeContextUsage {
  return { ...usage, capacity: model.contextWindow ?? null, runtimeCapacity: usage.runtimeCapacity ?? usage.capacity };
}
export function displayedContext(model: ApiModel | undefined, usage?: NativeContextUsage, nativeWindow?: number) {
  const capacity = model ? model.contextWindow ?? null : usage?.capacity ?? nativeWindow ?? null;
  const runtimeCapacity = model ? usage?.runtimeCapacity ?? usage?.capacity : undefined;
  return { capacity, runtimeCapacity, percent: usage && capacity ? Math.min(100, Math.round(usage.used / capacity * 100)) : null };
}

/** Recover only the latest request in this exact native lane, never lifetime totals. */
export function currentProviderContext(session:Session|undefined,model:ApiModel|undefined):NativeContextUsage|undefined {
  const native=session?.nativeContextUsage;
  // Old Claude adapters saved pre-delta zero snapshots without a turn identity.
  const legacyZero=native?.used===0&&native.total===0&&!native.turnId&&session?.binding.runtime==='claude';
  if(native&&!legacyZero)return native;
  if(!session||!model||session.binding.egress!=='direct-api'||!session.binding.nativeSessionId)return native;
  const source=metricsSource(session);
  const latest=session.metrics?.records.filter(row=>row.source===source&&row.runtime===session.binding.runtime&&row.model===model.model).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  if(!latest||latest.inputTokens===null||latest.outputTokens===null)return native;
  if(legacyZero&&latest.turnId!==session.nativeTurnId)return native;
  // A later reset/compaction invalidates earlier provider receipts, including zero.
  if(session.nativeProtocol?.resetAt&&session.nativeProtocol.resetAt>=latest.updatedAt||session.activities?.some(activity=>activity.category==='compaction'&&!activity.nativeChildId&&activity.updatedAt>=latest.updatedAt))return native;
  const used=latest.inputTokens+latest.outputTokens;
  return {used,total:used,capacity:model.contextWindow??null,...(native?.runtimeCapacity!==undefined?{runtimeCapacity:native.runtimeCapacity}:{}),updatedAt:latest.updatedAt,turnId:latest.turnId};
}
