import type { RuntimeKind, TranslationProfile } from '../contracts';
import type { SessionMetrics, TokenCounts } from '../session-metrics';

export type TranslationSource = { kind: 'custom'; targetId?: string; effort?: string } | { kind: 'model'; targetId: string; effort?: string };
export interface TranslationTarget {
  id: string; name: string; description: string; model: string; runtime: RuntimeKind;
  ready: boolean; reason?: string; efforts: string[]; defaultEffort?: string;
}
export interface TranslationCompletion { incomplete?:boolean; text: string; counts: TokenCounts; model?: string; reasoningTokens?: number | null }
export interface TranslationExecutionRequest { instructions: string; input: string; profile: TranslationProfile; signal: AbortSignal }
export interface TranslationBackend {
  profile: TranslationProfile; key?: string; auth?: 'key' | 'none'; runtime: RuntimeKind; sourceId: string;
  execute?(request: TranslationExecutionRequest): Promise<TranslationCompletion>;
  /** Provider request headers for direct HTTP backends; credential headers stay core-owned. */
  requestHeaders?(sessionId: string): Record<string, string>;
}
export interface TranslationTargetProvider {
  list(): TranslationTarget[] | Promise<TranslationTarget[]>;
  resolve(targetId: string, profile: TranslationProfile, effort?: string): Promise<TranslationBackend>;
}
export interface TranslationUsageReceipt extends TokenCounts {
  id: string; sourceId: string; runtime: RuntimeKind; model: string; at: string; elapsedMs: number;
  operation: 'translation' | 'refine' | 'segments'; direction: 'input' | 'output';
  status: 'complete' | 'failed'; reasoningTokens: number | null;
}
export interface TranslationUsageState extends SessionMetrics { attempts: TranslationUsageReceipt[] }
/** Numeric usage survives a failed native turn; never carries native diagnostics or text. */
export class TranslationExecutionError extends Error {
  constructor(code:string, readonly counts:TokenCounts, readonly model:string, readonly reasoningTokens:number|null=null){super(code);}
}
