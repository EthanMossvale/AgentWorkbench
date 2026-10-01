import type { NativeModelOption } from '../contracts';
import { isPluginRuntime, type RuntimeAdapter, type RuntimeCatalogEntry, type RuntimeDefinition, type JsonValue } from './types';
export * from './types';

export function jsonState(value: unknown): JsonValue {
  const json = JSON.stringify(value);
  if (json === undefined || json.length > 1_000_000) throw Error('RUNTIME_STATE_INVALID');
  return JSON.parse(json) as JsonValue;
}
export function validateModels(models: NativeModelOption[]): NativeModelOption[] {
  if (!Array.isArray(models) || models.length > 1000 || models.some(m => !m || typeof m.model !== 'string' || !m.model || typeof m.name !== 'string' || !Array.isArray(m.efforts) || m.efforts.some(e=>typeof e!=='string') || !Array.isArray(m.serviceTiers)) || new Set(models.map(m=>m.model)).size !== models.length) throw Error('RUNTIME_MODELS_INVALID');
  return structuredClone(models);
}
export interface RuntimeRegistration { owner: string; definition: RuntimeDefinition; adapter: RuntimeAdapter; catalog: RuntimeCatalogEntry; active: boolean; discovery: number; signal: AbortController }
export class RuntimeExtensionRegistry {
  private entries = new Map<string, RuntimeRegistration>();
  private listeners = new Set<(entry: RuntimeRegistration) => void | Promise<void>>();
  constructor(private changed: () => void = () => {}) {}
  onRemove(listener: (entry: RuntimeRegistration) => void | Promise<void>) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  register(owner: string, definition: RuntimeDefinition, adapter: RuntimeAdapter) {
    if (!owner || !definition || definition.apiVersion !== 1 || !isPluginRuntime(definition.id) || typeof definition.name !== 'string' || !definition.name.trim() || definition.name.length > 120 || typeof definition.description !== 'string' || !Array.isArray(definition.permissions) || !definition.permissions.length || !definition.permissions.some(p=>p?.value==='default') || definition.permissions.some(p=>!p || !/^(default|read-only|full-access|accept-edits|plan|plugin:[a-z][a-z0-9./-]{0,119})$/.test(p.value) || !p.label || typeof p.description!=='string') || new Set(definition.permissions.map(p=>p.value)).size!==definition.permissions.length || typeof adapter?.run !== 'function' || typeof adapter.stop !== 'function') throw Error('RUNTIME_REGISTRATION_INVALID');
    if (['discover','create','resume','steer','fork','approval','interaction','permissions','dispose'].some(key => (adapter as unknown as Record<string,unknown>)[key] !== undefined && typeof (adapter as unknown as Record<string,unknown>)[key] !== 'function')) throw Error('RUNTIME_REGISTRATION_INVALID');
    if (this.entries.has(definition.id)) throw Error('RUNTIME_ALREADY_REGISTERED');
    const saved = structuredClone(definition); saved.models = validateModels(saved.models ?? []);
    const entry: RuntimeRegistration = { owner, definition: saved, adapter, active: true, discovery: 0, signal: new AbortController(), catalog: { ...saved, owner, ready: !adapter.discover, capabilities: { fork: !!adapter.fork, resume: !!adapter.resume, steer: !!adapter.steer, approvals: !!adapter.approval, interactions: !!adapter.interaction, permissions: !!adapter.permissions } } };
    this.entries.set(saved.id, entry); this.changed();
    return async () => {
      if (!entry.active) return;
      entry.active = false; entry.signal.abort(); this.entries.delete(saved.id); this.changed();
      await Promise.allSettled([...this.listeners].map(listener=>Promise.resolve().then(()=>listener(entry))));
      await adapter.dispose?.();
    };
  }
  get(id: string) { const entry=this.entries.get(id); if(!entry?.active)throw Error('RUNTIME_PLUGIN_UNAVAILABLE'); return entry; }
  current(entry: RuntimeRegistration) { return entry.active && this.entries.get(entry.definition.id) === entry; }
  list() { return [...this.entries.values()].map(entry=>structuredClone(entry.catalog)); }
  async discover(id?: string) {
    const entries=id?[this.get(id)]:[...this.entries.values()];
    await Promise.all(entries.map(async entry=>{
      if(!entry.adapter.discover)return;
      const revision=++entry.discovery;
      try { const value=await entry.adapter.discover(); if(!value||typeof value.ready!=='boolean')throw Error('RUNTIME_DISCOVERY_INVALID');
        if(this.current(entry)&&entry.discovery===revision)entry.catalog={...entry.catalog,ready:value.ready,reason:value.reason,models:validateModels(value.models??entry.definition.models??[])};
      } catch { if(this.current(entry)&&entry.discovery===revision)entry.catalog={...entry.catalog,ready:false,reason:'RUNTIME_DISCOVERY_FAILED'}; }
    }));
    return this.list();
  }
}
