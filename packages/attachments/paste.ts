import { MAX_INLINE_TEXT_BYTES } from './input';

export interface TextPastePolicy {
  id: string;
  /** A plugin may promote text earlier, but cannot raise the core inline ceiling. */
  thresholdBytes: number;
}
export interface TextPastePolicyHandle { id: string; dispose(): void }
export interface TextPasteDecision { attachment: boolean; byteLength: number; thresholdBytes: number; policyId: string }

/** Shared production policy, read at every paste by existing and later composers. */
export function createTextPastePolicies() {
  const entries: { id: string; thresholdBytes: number }[] = [];
  return {
    decide(text: string): TextPasteDecision {
      if (typeof text !== 'string') throw Error('TEXT_PASTE_INVALID');
      const policy = entries.at(-1) ?? { id: 'core.large-text', thresholdBytes: MAX_INLINE_TEXT_BYTES };
      const byteLength = new TextEncoder().encode(text).byteLength;
      return { attachment: byteLength > policy.thresholdBytes, byteLength, thresholdBytes: policy.thresholdBytes, policyId: policy.id };
    },
    register(owner: string, definition: TextPastePolicy): TextPastePolicyHandle {
      if (!owner || !definition || !/^[a-z][a-z0-9-]{0,63}$/.test(definition.id) || !Number.isSafeInteger(definition.thresholdBytes) || definition.thresholdBytes < 1 || definition.thresholdBytes > MAX_INLINE_TEXT_BYTES) throw Error('TEXT_PASTE_POLICY_INVALID');
      const id = `plugin:${owner}/${definition.id}`;
      if (entries.some(entry => entry.id === id)) throw Error('TEXT_PASTE_POLICY_DUPLICATE');
      if (entries.length >= 128) throw Error('TEXT_PASTE_POLICY_LIMIT');
      const entry = { id, thresholdBytes: definition.thresholdBytes };
      entries.push(entry);
      return { id, dispose() { const index = entries.indexOf(entry); if (index >= 0) entries.splice(index, 1); } };
    },
  };
}
export const textPastePolicies = createTextPastePolicies();
