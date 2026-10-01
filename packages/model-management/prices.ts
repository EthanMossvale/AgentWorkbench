import type { ModelPrice } from './types';

/** Public standard API reference rates, checked 2026-09-29 UTC. Not a bill.
 * No fuzzy aliases: unknown or provider-renamed IDs require a user price.
 * OpenAI: short-context standard. Claude: standard global, 5-minute cache writes.
 * Sources are recorded in docs/07-research-sources.md; user rates take precedence.
 */
const prices: Record<string, ModelPrice> = {
  'gpt-6-astra': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'gpt-6.1-sol': { input: 2, output: 10, cacheRead: .1, cacheWrite: 2.5 },
  'gpt-6-luna': { input: .1, output: .5, cacheRead: .01, cacheWrite: .125 },
  'gpt-5.6-sol': { input: 4, output: 20, cacheRead: .4, cacheWrite: 5 },
  'gpt-5.3-codex': { input: 1.75, output: 14, cacheRead: .175 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: .5, cacheWrite: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: .5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: .5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: .5, cacheWrite: 6.25 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: .5, cacheWrite: 6.25 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: .3, cacheWrite: 3.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: .3, cacheWrite: 3.75 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: .2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: .1, cacheWrite: 1.25 },
};
export function referencePrice(model: string): ModelPrice | undefined { const value = prices[model]; return value ? { ...value } : undefined; }
