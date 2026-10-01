import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, missing, noLinks, SerialQueue, textFile } from '../native-resources/files';
import type { PluginDataSnapshot, PluginJson, PluginStorage } from './storage-types';

const MAX_BYTES = 1024 * 1024;
function validate(values: unknown): asserts values is Record<string, PluginJson> {
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 64) throw Error('PLUGIN_STORAGE_INVALID');
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || seen.has(value) || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw Error('PLUGIN_STORAGE_INVALID');
    seen.add(value);
    for (const item of Array.isArray(value) ? value : Object.values(value)) visit(item, depth + 1);
    seen.delete(value);
  };
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw Error('PLUGIN_STORAGE_INVALID');
  visit(values, 0);
  if (Buffer.byteLength(JSON.stringify(values)) > MAX_BYTES) throw Error('PLUGIN_STORAGE_TOO_LARGE');
}

export class PluginStorageStore {
  private queues = new Map<string, SerialQueue>();
  constructor(private directory: string) {}
  scope(id: string, guard: () => void | Promise<void>, changed: (snapshot: PluginDataSnapshot) => void): PluginStorage {
    if (!/^[a-z][a-z0-9.-]{1,79}$/.test(id)) throw Error('PLUGIN_STORAGE_INVALID_ID');
    const file = path.join(this.directory, 'plugin-data', 'plugin-' + id + '.json');
    let queue = this.queues.get(id);
    if (!queue) { queue = new SerialQueue(); this.queues.set(id, queue); }
    const read = async (): Promise<PluginDataSnapshot> => {
      await guard(); await noLinks(file);
      try {
        const value = JSON.parse(await textFile(file, MAX_BYTES + 1024));
        if (value.version !== 1 || typeof value.revision !== 'string' || !value.revision) throw Error('PLUGIN_STORAGE_INVALID');
        validate(value.values); await guard();
        return {revision: value.revision, values: value.values};
      } catch (error) { if (missing(error)) { await guard(); return {revision: null, values: {}}; } throw error; }
    };
    return Object.freeze({
      read: () => queue!.run(read),
      write: (expectedRevision: string | null, values: Record<string, PluginJson>) => {
        // Clone before queuing so the caller cannot alter an in-flight write.
        if (expectedRevision !== null && (typeof expectedRevision !== 'string' || !expectedRevision)) throw Error('PLUGIN_STORAGE_INVALID');
        validate(values); const copied = JSON.parse(JSON.stringify(values)) as Record<string, PluginJson>;
        return queue!.run(async () => {
          const current = await read();
          if (current.revision !== expectedRevision) throw Error('PLUGIN_STORAGE_CONFLICT');
          const next = {revision: randomUUID(), values: copied};
          await atomicWrite(file, JSON.stringify({version: 1, ...next}), async () => {
            await guard();
            if ((await read()).revision !== expectedRevision) throw Error('PLUGIN_STORAGE_CONFLICT');
          });
          // The committed value must remain successful even if an observer fails.
          try { changed(structuredClone(next)); } catch { /* Observers do not own the write. */ }
          return structuredClone(next);
        });
      },
    });
  }
}
