import type { NativeModelOption, SessionBinding } from '../contracts';
import type { AccountUsage } from '../account-usage/types';
import type { TokenCounts, TokenField, UsageRecord } from '../session-metrics';

export type AccountProvider = 'codex' | 'claude';
export type LoginMethod = 'desktop' | 'browser' | 'device' | 'sso' | 'console' | `${string}:${string}`;
export interface AccountLoginMethod { id: LoginMethod; label: string; description: string; available: boolean; reason?: string }
export interface AccountImportFormat { id: string; label: string; description: string }
export interface LocalModelAccount {
  id: string; revision: string; provider: AccountProvider; name: string; enabled: boolean;
  status: 'signed-out' | 'authenticated' | 'unknown'; email?: string; plan?: string;
  models: NativeModelOption[]; observedAt?: string; usage?: AccountUsage;
  cycle?: { start: string; end: string; windowMinutes: number };
}
export interface AccountLogin {
  id: string; accountId: string; method: LoginMethod;
  status: 'waiting' | 'verifying' | 'complete' | 'cancelled' | 'failed';
  expiresAt: string; url?: string; userCode?: string; codeRequested?: boolean; callbackSupported?: boolean; browserError?: string; error?: string;
}
export type UsageScope = { kind: 'api' | 'account' | 'translation'; id: string };
export type UsagePeriod = '1day' | '7day' | 'cycle' | 'month';
/** USD per million tokens. Input includes cache; rates apply to disjoint categories. */
export interface ModelPrice { input: number; output: number; cacheRead?: number; cacheWrite?: number }
export interface SavedModelPrice { scope: UsageScope; model: string; price: ModelPrice; revision: string; updatedAt: string }
export interface ModelUsageEntry extends UsageRecord { key: string; scope: UsageScope; recordedAt: string }
export interface ModelUsageGroup extends TokenCounts {
  model: string; requests: number; incomplete: TokenField[]; estimatedUsd: number | null;
  /** Conservative cost of known usage; null/absent means no priced evidence. */
  lowerBoundUsd?: number | null;
  price?: ModelPrice; priceRevision?: string; priceSource?: 'manual' | 'reference'; cacheHitRate: number | null;
}
export interface ModelUsageSummary extends TokenCounts {
  scope: UsageScope; period: UsagePeriod; from: string | null; until: string;
  groups: ModelUsageGroup[]; incomplete: TokenField[]; estimatedUsd: number | null;
  /** Includes priced parts of incomplete groups; never a complete bill. */
  lowerBoundUsd?: number | null;
  pricedUsd: number; unpricedModels: number; partialHistory: boolean; cycleUnavailable: boolean;
}
export const localModelBinding = (binding: SessionBinding) => !!(binding.modelConnectionId || binding.localAccountId);
export const localAccountRef = (id: string) => 'local-account:' + id;
export const officialAccountBinding = (binding: SessionBinding) => !!binding.localAccountId && /^[a-f0-9-]{36}$/.test(binding.localAccountId) && ['codex','claude'].includes(binding.runtime) && binding.provider === (binding.runtime==='codex'?'openai':'anthropic') && binding.accountRef===localAccountRef(binding.localAccountId) && binding.executionId==='local-device' && binding.egress==='runtime-managed' && !binding.hostId && !binding.modelConnectionId && !binding.modelMappingId;
