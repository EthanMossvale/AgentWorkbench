import type { TranslationProfile } from '../contracts';
import type { TranslationTarget, TranslationTargetProvider } from './types';

/** Production catalog and executor share these registrations. Disposal revokes late results. */
export class TranslationTargetRegistry {
  private providers = new Map<string, { provider: TranslationTargetProvider; abort: AbortController }>();
  register(owner: string, provider: TranslationTargetProvider): () => void {
    if (!/^(core|[a-z][a-z0-9.-]+)$/.test(owner) || !provider || typeof provider.list !== 'function' || typeof provider.resolve !== 'function' || this.providers.has(owner)) throw Error('TRANSLATION_PROVIDER_INVALID');
    const entry = { provider, abort: new AbortController() }; this.providers.set(owner, entry);
    return () => { if (this.providers.get(owner) === entry) { this.providers.delete(owner); entry.abort.abort(Error('TRANSLATION_TARGET_UNAVAILABLE')); } };
  }
  private async entries() {
    const result: { target: TranslationTarget; entry: { provider: TranslationTargetProvider; abort: AbortController } }[] = [];
    for (const [owner, entry] of this.providers) {
      const targets = await entry.provider.list();
      if (entry.abort.signal.aborted) continue;
      if (!Array.isArray(targets) || targets.length > 10000) throw Error('TRANSLATION_CATALOG_INVALID');
      for (const target of targets) {
        if (!target || typeof target.id !== 'string' || !target.id || target.id.length > 512 || owner !== 'core' && !target.id.startsWith(`plugin:${owner}/`) || typeof target.name !== 'string' || typeof target.model !== 'string' || typeof target.ready !== 'boolean' || !Array.isArray(target.efforts) || target.efforts.some(e => typeof e !== 'string') || result.some(row => row.target.id === target.id)) throw Error('TRANSLATION_CATALOG_INVALID');
        result.push({ target: structuredClone(target), entry });
      }
    }
    return result;
  }
  async list() { return (await this.entries()).map(row => row.target); }
  async resolve(id: string, profile: TranslationProfile, effort?: string) {
    const row = (await this.entries()).find(row => row.target.id === id);
    if (!row?.target.ready) throw Error('TRANSLATION_TARGET_UNAVAILABLE');
    if (effort !== undefined && !row.target.efforts.includes(effort)) throw Error('TRANSLATION_EFFORT_UNAVAILABLE');
    const backend = await row.entry.provider.resolve(id, profile, effort);
    row.entry.abort.signal.throwIfAborted();
    return { backend, signal: row.entry.abort.signal };
  }
  dispose() { for (const value of this.providers.values()) value.abort.abort(); this.providers.clear(); }
}
