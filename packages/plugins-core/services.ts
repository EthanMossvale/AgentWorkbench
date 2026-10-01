/** Full-trust development services. Discovery never returns service data. */
export interface ServiceContract { version: number; adapters?: { version: number; members: Record<string, string> }[] }
export interface PluginServiceInfo { id: string; members: string[]; contractVersion?: number; compatibility?: {version:number;members:string[]}[] }
export interface PluginServices {
  list(): PluginServiceInfo[];
  get<T extends object = Record<string, unknown>>(id: string): T;
  register(id: string, service: object, contract?: ServiceContract): () => void;
  override(id: string, members: Record<string, unknown>): () => void;
  intercept(id: string, member: string, handler: (next: (...args: unknown[]) => unknown, ...args: unknown[]) => unknown): () => void;
}
type Layer = { value: unknown } | { handler: (next: (...args: unknown[]) => unknown, ...args: unknown[]) => unknown };
interface Patch { original?: PropertyDescriptor; inherited: unknown; layers: Layer[]; applied: unknown }
const validId = (id: string) => typeof id === 'string' && /^[a-z][a-z0-9./-]{0,119}$/.test(id);
const validMember = (name: string) => typeof name === 'string' && !!name && !['__proto__', 'prototype', 'constructor'].includes(name);

export class HostServiceRegistry {
  private services = new Map<string, object>();
  private contracts = new Map<string, ServiceContract>();
  private patches = new WeakMap<object, Map<string, Patch>>();
  register(id: string, service: object, contract?: ServiceContract) {
    if (!validId(id) || !service || !['object', 'function'].includes(typeof service)) throw Error('Invalid development service.');
    if (this.services.has(id)) throw Error(`Development service already exists: ${id}. Use override or intercept.`);
    if(contract){
      if(!Number.isSafeInteger(contract.version)||contract.version<1||contract.adapters?.some(a=>!Number.isSafeInteger(a.version)||a.version<1||a.version===contract.version||!a.members||Object.entries(a.members).some(([oldName,current])=>!validMember(oldName)||typeof current!=='string'||!validMember(current)||typeof Reflect.get(service,current)!=='function'))||new Set(contract.adapters?.map(a=>a.version)).size!==(contract.adapters?.length??0))throw Error('PLUGIN_SERVICE_CONTRACT_INVALID');
      this.contracts.set(id,structuredClone(contract));
    }
    this.services.set(id, service);
    return () => { if (this.services.get(id) === service) {this.services.delete(id);this.contracts.delete(id);} };
  }
  get<T extends object = Record<string, unknown>>(id: string): T {
    const service = this.services.get(id);
    if (!service) throw Error(`Development service is unavailable: ${id}.`);
    return service as T;
  }
  list(): PluginServiceInfo[] {
    return [...this.services].map(([id, service]) => {
      const members = new Set<string>();
      for (let value: object | null = service; value && value !== Object.prototype && value !== Function.prototype; value = Object.getPrototypeOf(value)) {
        for (const key of Object.getOwnPropertyNames(value)) if (validMember(key)) members.add(key);
      }
      const contract=this.contracts.get(id);
      return { id, members: [...members].sort(),...(contract?{contractVersion:contract.version,compatibility:(contract.adapters??[]).map(a=>({version:a.version,members:Object.keys(a.members).sort()}))}:{}) };
    }).sort((a, b) => a.id.localeCompare(b.id));
  }
  private install(target: object, key: string, layer: Layer): () => void {
    if (!validMember(key)) throw Error('Invalid service member.');
    let members = this.patches.get(target);
    if (!members) this.patches.set(target, members = new Map());
    let patch = members.get(key);
    if (patch && Object.getOwnPropertyDescriptor(target, key)?.value !== patch.applied) throw Error('Service member changed outside the registry; release its overrides before replacing it.');
    if (!patch) {
      const original = Object.getOwnPropertyDescriptor(target, key);
      if (original?.configurable === false || (!original && !Object.isExtensible(target))) throw Error('Service member cannot be overridden.');
      patch = { original, inherited: Reflect.get(target, key), layers: [], applied: undefined };
      members.set(key, patch);
    }
    if ('handler' in layer && typeof (patch.layers.length ? patch.applied : patch.inherited) !== 'function') {
      if (!patch.layers.length) members.delete(key);
      throw Error('Only callable service members can be intercepted.');
    }
    const apply = () => {
      let value = patch!.inherited;
      for (const entry of patch!.layers) {
        if ('value' in entry) value = entry.value;
        else {
          const previous = value as (...args: unknown[]) => unknown;
          value = function (this: unknown, ...args: unknown[]) {
            return entry.handler((...forwarded) => Reflect.apply(previous, this, forwarded), ...args);
          };
        }
      }
      Object.defineProperty(target, key, { configurable: true, enumerable: patch!.original?.enumerable ?? false, writable: true, value });
      patch!.applied = value;
    };
    patch.layers.push(layer);
    try { apply(); } catch (error) { patch.layers.pop(); if (!patch.layers.length) members.delete(key); throw error; }
    let live = true;
    return () => {
      if (!live) return; live = false;
      const index = patch!.layers.indexOf(layer); if (index >= 0) patch!.layers.splice(index, 1);
      // Preserve changes made independently of this registry.
      if (Object.getOwnPropertyDescriptor(target, key)?.value === patch!.applied) {
        if (patch!.layers.length) apply();
        else if (patch!.original) Object.defineProperty(target, key, patch!.original);
        else Reflect.deleteProperty(target, key);
      }
      if (!patch!.layers.length) members!.delete(key);
    };
  }
  override(id: string, values: Record<string, unknown>) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw Error('Expected service members.');
    const target = this.get(id), releases: (() => void)[] = [];
    try {
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(values))) {
        if (!('value' in descriptor)) throw Error('Service overrides must use values, not accessors.');
        releases.push(this.install(target, key, { value: descriptor.value }));
      }
    } catch (error) { for (const release of releases.reverse()) release(); throw error; }
    return () => { for (const release of releases.splice(0).reverse()) release(); };
  }
  intercept(id: string, key: string, handler: (next: (...args: unknown[]) => unknown, ...args: unknown[]) => unknown) {
    if (typeof handler !== 'function') throw Error('Expected a service interceptor.');
    return this.install(this.get(id), key, { handler });
  }
  /** Fingerprints pin repairs to exact host-owned rename adapters, not arbitrary shims. */
  adapterKey(id:string,version:number){const contract=this.contracts.get(id),adapter=contract?.adapters?.find(a=>a.version===version);return adapter?JSON.stringify({id,current:contract!.version,adapter}):undefined;}
  scope(assertActive: () => void, own: (release: () => void) => () => void, adapters: Record<string, number> = {}): PluginServices {
    const member=(id:string,key:string)=>{
      const version=adapters[id];if(version===undefined)return key;
      const adapter=this.contracts.get(id)?.adapters?.find(a=>a.version===version),mapped=adapter?.members[key];
      if(!mapped)throw Error('PLUGIN_COMPATIBILITY_ADAPTER_UNAVAILABLE');return mapped;
    };
    return Object.freeze({
      list: () => { assertActive(); return this.list(); },
      get: <T extends object>(id: string) => { assertActive();const target=this.get<T>(id);if(adapters[id]===undefined)return target;
        return new Proxy({} as T,{get:(_target,key)=>{assertActive();if(typeof key!=='string')return undefined;const current=member(id,key);return (...args:unknown[])=>{assertActive();const handler=Reflect.get(target,current);if(typeof handler!=='function')throw Error('PLUGIN_COMPATIBILITY_ADAPTER_UNAVAILABLE');return Reflect.apply(handler,target,args);};},set:()=>{throw Error('PLUGIN_COMPATIBILITY_USE_OVERRIDE');}});
      },
      register: (id: string, service: object, contract?:ServiceContract) => { assertActive(); return own(this.register(id, service, contract)); },
      override: (id: string, values: Record<string, unknown>) => { assertActive(); return own(this.override(id, adapters[id]===undefined?values:Object.fromEntries(Object.entries(values).map(([key,value])=>[member(id,key),value])))); },
      intercept: (id: string, key: string, handler: (next: (...args: unknown[]) => unknown, ...args: unknown[]) => unknown) => { assertActive(); return own(this.intercept(id, member(id,key), handler)); },
    });
  }
}
