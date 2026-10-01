import {BrandingRegistry,type BrandingApi} from '../branding';
import { RuntimeExtensionRegistry, type PluginRuntimes, type RuntimeDefinition, type RuntimeAdapter } from '../runtime-extensions';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { atomicWrite, childPath, digest, missing, noLinks, optionalText, SerialQueue, textFile } from '../native-resources/files';
import { collectDirectory, encodeZip, exportArchive, installArchive, readArchive, unwrapArchive } from '../native-resources/archive';
import { HostServiceRegistry, type PluginServices } from './services';
import { NativeEventRegistry, type PluginNativeEvents } from '../native-events';
import { PluginStorageStore } from './storage';
import type { PluginStorage, PluginJson } from './storage-types';
import { checkCompatibility, validateRequirements, type PluginRequirements, type PluginCompatibility, type CompatibilityIssue } from './compatibility';
import { bounded, PluginRecoveryStore } from './recovery';
export type { PluginStorage, PluginDataSnapshot, PluginJson } from './storage-types';
export type { PluginServices, PluginServiceInfo } from './services';

export type PluginCapability = 'context' | 'theme' | 'host';
export interface PluginManifest {
  schemaVersion: 1; id: string; name: string; version: string; description: string; apiVersion: 1;
  capabilities: PluginCapability[]; main?: string; renderer?: string;
  requires?: PluginRequirements;
  contributes?: { context?: string; theme?: { variables?: Record<string, string>; background?: string; opacity?: number } };
}
export interface PluginRecord { manifest: PluginManifest; hash: string; enabled: boolean; approved: boolean; directory: string; error?: string; origin: 'third-party'; requestedEnabled: boolean; compatibility: PluginCompatibility }
export interface PluginAppearance { variables: Record<string, string>; background?: string; opacity?: number }
export interface PluginRequest { method: string; payload: unknown }
export interface PluginRendererEntry { id: string; hash: string; source: string }
export type PluginHostEvent = { type: 'state'; payload: unknown } | { type: 'plugin'; id: string; topic: string; payload: unknown };
export interface PluginApi {
  branding: BrandingApi;
  version: 1; id: string;
  call<T = unknown>(method: string, payload?: unknown): Promise<T>;
  invoke<T = unknown>(method: string, payload?: unknown): Promise<T>;
  services: PluginServices;
  runtimes: PluginRuntimes;
  nativeEvents: PluginNativeEvents;
  storage: PluginStorage;
  registerMethod(method: string, handler: (payload: unknown) => unknown | Promise<unknown>): () => void;
  emit(topic: string, payload?: unknown): void;
  onEvent(handler: (event: PluginHostEvent) => void | Promise<void>): () => void;
  onContext(handler: (input: { sessionId: string; projectPath?: string; runtime: string }) => string | Promise<string>): () => void;
  useHost(handler: (request: PluginRequest, next: (request?: PluginRequest) => Promise<unknown>) => Promise<unknown>): () => void;
  registerCommand(name: string, handler: (payload: unknown) => unknown | Promise<unknown>): () => void;
  onDispose(handler: () => void | Promise<void>): void;
}
interface RuntimePlugin { hash: string; events: ((event: PluginHostEvent) => void | Promise<void>)[]; contexts: ((input: {sessionId:string;projectPath?:string;runtime:string}) => string | Promise<string>)[]; middleware: ((request: PluginRequest, next: (request?: PluginRequest) => Promise<unknown>) => Promise<unknown>)[]; commands: Map<string, (payload: unknown) => unknown | Promise<unknown>>; methods: Map<string, (payload: unknown) => unknown | Promise<unknown>>; disposers: (() => void | Promise<void>)[] }
interface PluginPreferences { version: 1; entries: Record<string, { enabled: boolean; hash: string; approval?: string; adapters?: Record<string,string> }> }
export interface PluginRegistryOptions { recovery?: PluginRecoveryStore; activationTimeoutMs?: number; cleanupTimeoutMs?: number }
const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<{ activate?: (api: PluginApi) => unknown }>;
const THEME = /^--(?:bg|panel|panel-2|panel-raised|text|muted|faint|border|accent|accent-hover|accent-soft|danger|success|surface|surface-hover|line|raised|tint|hover|accent-contrast)$/;
const compatibilityKey=(issues:CompatibilityIssue[]|undefined)=>JSON.stringify((issues??[]).slice(0,20).map(i=>[i.code,i.service??null,i.member??null,i.expected??null,i.actual??null,i.repairable]));
export function parseManifest(value: unknown): PluginManifest {
  const m = value as PluginManifest;
  if(m&&m.apiVersion!==1)throw Error('PLUGIN_API_VERSION_UNSUPPORTED');
  if (!m || m.schemaVersion !== 1 || m.apiVersion !== 1 || !/^[a-z][a-z0-9.-]{1,79}$/.test(m.id) || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 120 || typeof m.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(m.version) || typeof m.description !== 'string' || m.description.length > 4000 || !Array.isArray(m.capabilities) || m.capabilities.some(c => !['context', 'theme', 'host'].includes(c))) throw Error('Invalid workbench plugin manifest or unsupported API version.');
  for (const entry of [m.main, m.renderer]) if (entry !== undefined) { if (typeof entry !== 'string' || !/\.m?js$/i.test(entry) || !m.capabilities.includes('host')) throw Error('Executable plugins must declare host access.'); childPath(path.resolve('plugin'), entry); }
  if (m.contributes?.context !== undefined && (typeof m.contributes.context !== 'string' || m.contributes.context.length > 24000 || !m.capabilities.includes('context'))) throw Error('Invalid context contribution.');
  if (m.contributes?.theme) {
    if (!m.capabilities.includes('theme')) throw Error('Theme contribution needs theme capability.');
    for (const [key, value] of Object.entries(m.contributes.theme.variables ?? {})) if (!THEME.test(key) || typeof value !== 'string' || !/^(#[\da-f]{3,8}|rgba?\([\d.,% /]+\)|hsla?\([\d.,% /]+\))$/i.test(value)) throw Error('Invalid theme color variable.');
    if (m.contributes.theme.background) childPath(path.resolve('plugin'), m.contributes.theme.background);
    if (m.contributes.theme.opacity !== undefined && (!Number.isFinite(m.contributes.theme.opacity) || m.contributes.theme.opacity < 0 || m.contributes.theme.opacity > 1)) throw Error('Background opacity must be between 0 and 1.');
  }
  validateRequirements(m.requires);return structuredClone(m);
}
export class PluginRegistry {
  readonly branding = new BrandingRegistry();
  readonly services = new HostServiceRegistry();
  readonly runtimes = new RuntimeExtensionRegistry(() => this.notify());
  readonly nativeEvents = new NativeEventRegistry();
  revision = 0;
  readonly root: string; private prefs: PluginPreferences = { version: 1, entries: {} }; private queue = new SerialQueue(); private runtime = new Map<string, RuntimePlugin>(); private errors = new Map<string, string>();
  private readonly data: PluginStorageStore;
  readonly recovery: PluginRecoveryStore;
  private prefsValid=true; private prefsRevision:string|null=null;
  constructor(private directory: string, private notify: () => void = () => {}, private options:PluginRegistryOptions={}) { this.root = path.join(directory, 'plugins'); this.data = new PluginStorageStore(directory);this.recovery=options.recovery??new PluginRecoveryStore(directory,'0.1.0'); }
  private storageFor(id: string, hash: string, active: () => void = () => {}) {
    return this.data.scope(id, async () => {
      active();
      if (!(await this.list()).some(record => record.manifest.id === id && record.hash === hash && record.enabled && record.approved && (record.manifest.main || record.manifest.renderer))) throw Error('PLUGIN_STORAGE_UNAVAILABLE');
      active();
    }, snapshot => this.publish({type:'plugin',id,topic:'storage.changed',payload:{revision:snapshot.revision}}));
  }
  readStorage(id: string, hash: string) { return this.storageFor(id,hash).read(); }
  writeStorage(id: string, hash: string, revision: string | null, values: Record<string, PluginJson>) { return this.storageFor(id,hash).write(revision,values); }
  private host?: (request: PluginRequest) => Promise<unknown>;
  private eventSink?: (event: PluginHostEvent) => void;
  connectEvents(sink: (event: PluginHostEvent) => void) { this.eventSink = sink; }
  connectHost(call: (request: PluginRequest) => Promise<unknown>) { this.host = call; }
  publish(event: PluginHostEvent) {
    try { this.eventSink?.(structuredClone(event)); } catch { /* A closed renderer must not fail the originating service operation. */ }
    for (const [id, plugin] of this.runtime) for (const handler of plugin.events) {
      // Queue observers after the originating write; a faulty observer cannot fail it.
      void Promise.resolve().then(() => this.runtime.get(id) === plugin && handler(structuredClone(event))).catch(error => { this.errors.set(id, (error as Error).message); });
    }
  }
  private async loadPreferences(){
    const file=path.join(this.directory,'plugins.json');await noLinks(file);const source=await optionalText(file,1024*1024);
    const prefs:PluginPreferences=source===undefined?{version:1,entries:{}}:JSON.parse(source) as PluginPreferences;
    if(prefs?.version!==1||!prefs.entries||typeof prefs.entries!=='object'||Array.isArray(prefs.entries)||Object.entries(prefs.entries).some(([id,e])=>!/^[a-z][a-z0-9.-]{1,79}$/.test(id)||!e||typeof e.enabled!=='boolean'||typeof e.hash!=='string'||!/^[a-f0-9]{64}$/.test(e.hash)||e.approval!==undefined&&e.approval!==e.hash||e.adapters!==undefined&&(!e.adapters||typeof e.adapters!=='object'||Array.isArray(e.adapters)||Object.values(e.adapters).some(value=>typeof value!=='string'))))throw Error('PLUGIN_PREFERENCES_INVALID');
    this.prefs=prefs;this.prefsRevision=source===undefined?null:digest(source);this.prefsValid=true;
  }
  async initialize() {
    await this.recovery.initialize();
    for(const incident of this.recovery.snapshot().incidents)this.errors.set(incident.id,incident.code);
    try{await this.loadPreferences();}catch{this.prefsValid=false;await this.recovery.incident({id:'workbench.preferences'},'PLUGIN_PREFERENCES_INVALID','scan');}
    await this.refresh();
  }
  private async save() {
    if(!this.prefsValid)throw Error('PLUGIN_PREFERENCES_INVALID');
    const file=path.join(this.directory,'plugins.json'),next=JSON.stringify(this.prefs,null,2);
    try {await atomicWrite(file,next,async()=>{const current=await optionalText(file,1024*1024);if((current===undefined?null:digest(current))!==this.prefsRevision)throw Error('PLUGIN_PREFERENCES_CONFLICT');});this.prefsRevision=digest(next);}
    catch(error){try{await this.loadPreferences();}catch{this.prefsValid=false;}throw error;}
  }
  private compatibility(manifest:PluginManifest,hash:string){
    const result=checkCompatibility(manifest.requires,this.recovery.hostVersion,this.services.list()),saved=this.prefs.entries[manifest.id];
    if(saved?.hash===hash&&saved.approval===hash)result.issues=result.issues.filter(issue=>!issue.repairable||!issue.service||saved.adapters?.[issue.service]!==this.services.adapterKey(issue.service,issue.expected!));
    if(result.status==='blocked'&&!result.issues.length)result.status='compatible';return result;
  }
  private adapters(record:PluginRecord){const selected:Record<string,number>={};for(const required of record.manifest.requires?.services??[])if(this.prefs.entries[record.manifest.id]?.adapters?.[required.id]===this.services.adapterKey(required.id,required.version)&&this.services.adapterKey(required.id,required.version))selected[required.id]=required.version;return selected;}
  async repairCompatibility(id:string,hash:string){
    return this.queue.run(async()=>{
      if(this.recovery.snapshot().safeMode)throw Error('PLUGIN_SAFE_MODE_ACTIVE');
      const record=(await this.list()).find(r=>r.manifest.id===id&&r.hash===hash),saved=this.prefs.entries[id];
      if(!record||!saved?.enabled||saved.hash!==hash||saved.approval!==hash||record.compatibility.status!=='blocked'||!record.compatibility.issues.length||record.compatibility.issues.some(i=>!i.repairable))throw Error('PLUGIN_REPAIR_UNAVAILABLE');
      const adapters:Record<string,string>={};for(const issue of record.compatibility.issues)adapters[issue.service!]=this.services.adapterKey(issue.service!,issue.expected!)!;
      saved.adapters={...saved.adapters,...adapters};await this.save();await this.recovery.clearCompatibility(id,hash);this.errors.delete(id);await this.refresh();this.revision++;this.notify();
      const after=(await this.list()).find(r=>r.manifest.id===id&&r.hash===hash);return {id,applied:!!after?.enabled,compatibility:after?.compatibility};
    });
  }
  async list(): Promise<PluginRecord[]> {
    const result: PluginRecord[] = [];
    try { for (const item of await readdir(this.root, { withFileTypes: true })) {
      if (!item.isDirectory() || item.name.includes('.import-')) continue;
      const directory = path.join(this.root, item.name);
      try { await noLinks(directory);const manifest = parseManifest(JSON.parse(await textFile(path.join(directory, 'workbench.plugin.json'), 64 * 1024))); if (manifest.id !== item.name) throw Error('Plugin folder and manifest identity differ.'); const files = await collectDirectory(directory), hash = digest(encodeZip(files.sort((a,b) => a.name.localeCompare(b.name)))); const saved = this.prefs.entries[manifest.id],compatibility=this.compatibility(manifest,hash);
        result.push({ manifest, hash, directory,origin:'third-party',requestedEnabled:saved?.enabled===true,compatibility, enabled: this.prefsValid&&!this.recovery.snapshot().safeMode&&compatibility.status!=='blocked'&&saved?.enabled === true && saved.hash === hash && (!(manifest.main || manifest.renderer) || saved.approval === hash), approved: saved?.approval === hash, error: saved?.enabled && saved.hash !== hash ? '插件文件已变化，需重新审阅并启用。' : compatibility.status==='blocked'?compatibility.issues[0]?.code:this.errors.get(manifest.id) });
      }
      catch (error) { const code=(error as Error).message==='PLUGIN_API_VERSION_UNSUPPORTED'?'PLUGIN_API_VERSION_UNSUPPORTED':'PLUGIN_PACKAGE_INVALID';if(this.errors.get(item.name)!==code){this.errors.set(item.name,code);await this.recovery.incident({id:item.name},code,'scan');} }
    } } catch (error) { if (!missing(error)&&this.errors.get('workbench.plugins')!=='PLUGIN_DIRECTORY_UNAVAILABLE'){this.errors.set('workbench.plugins','PLUGIN_DIRECTORY_UNAVAILABLE');await this.recovery.incident({id:'workbench.plugins'},'PLUGIN_DIRECTORY_UNAVAILABLE','scan');} }
    return result.sort((a,b) => a.manifest.name.localeCompare(b.manifest.name));
  }
  async importZip(file: string) { return this.queue.run(async () => { const files = unwrapArchive(await readArchive(file), 'workbench.plugin.json'), manifest = parseManifest(JSON.parse(files.find(f => f.name === 'workbench.plugin.json')!.data.toString('utf8'))); for (const entry of [manifest.main, manifest.renderer]) if (entry && !files.some(f => f.name === entry)) throw Error('Plugin entry point is missing.'); if (manifest.contributes?.theme?.background && !files.some(f => f.name === manifest.contributes!.theme!.background)) throw Error('Plugin background asset is missing.'); await installArchive(path.join(this.root, manifest.id), files); this.notify(); return this.list(); }); }
  async exportZip(id: string, hash: string, destination: string) { const record = (await this.list()).find(r => r.manifest.id === id && r.hash === hash); if (!record) throw Error('Plugin changed; refresh first.'); return exportArchive(record.directory, destination); }
  async setEnabled(id: string, hash: string, enabled: boolean, approveHost = false) {
    return this.queue.run(async () => {
      const record = (await this.list()).find(r => r.manifest.id === id && r.hash === hash); if (!record || typeof enabled !== 'boolean') throw Error('Plugin changed; refresh first.');
      if(enabled&&this.recovery.snapshot().safeMode)throw Error('PLUGIN_SAFE_MODE_ACTIVE');
      if (enabled && (record.manifest.main || record.manifest.renderer) && !approveHost && !record.approved) throw Error('This plugin executes local host code. Explicit approval of this exact package is required.');
      const adapters=this.prefs.entries[id]?.hash===hash?this.prefs.entries[id]?.adapters:undefined;
      this.prefs.entries[id] = { enabled, hash, ...(record.approved || approveHost ? { approval: hash } : {}),...(adapters?{adapters}:{}) }; if (enabled) {this.errors.delete(id);await this.recovery.clear(id);} this.revision++; await this.save(); await this.refresh(); this.notify(); return this.list();
    });
  }
  private async unload(id: string) { const active = this.runtime.get(id); this.runtime.delete(id); if (active) {
    await this.recovery.begin({id,hash:active.hash},'cleanup').catch(()=>{});
    for (const dispose of active.disposers.reverse()) try { await bounded(Promise.resolve().then(dispose),this.options.cleanupTimeoutMs??1000,'PLUGIN_CLEANUP_TIMEOUT'); } catch { this.errors.set(id,'PLUGIN_CLEANUP_FAILED');await this.recovery.incident({id,hash:active.hash},'PLUGIN_CLEANUP_FAILED','cleanup'); }
    await this.recovery.finish(id,'cleanup');
  } }
  async refresh() {
    if(this.recovery.snapshot().safeMode){for(const id of [...this.runtime.keys()])await this.unload(id);return;}
    const records = await this.list();
    for (const [id, active] of this.runtime) if (!records.some(r => r.manifest.id === id && r.enabled && r.hash === active.hash)) await this.unload(id);
    for (const record of records) if (record.enabled && record.manifest.main && !this.runtime.has(record.manifest.id)) {
      const id = record.manifest.id, active: RuntimePlugin = { hash: record.hash, events: [], contexts: [], middleware: [], commands: new Map(), methods: new Map(), disposers: [] };
      const assertActive = () => { if (this.runtime.get(id) !== active) throw Error('Plugin is no longer active.'); };
      const own = (release: () => void) => { let live = true; const once = () => { if (live) { live = false; release(); } }; active.disposers.push(once); return once; };
      const add = <T>(list: T[], value: T) => { assertActive(); if (typeof value !== 'function') throw Error('Plugin hook must be a function.'); list.push(value); return () => { const index = list.indexOf(value); if (index >= 0) list.splice(index, 1); }; };
      const api: PluginApi = Object.freeze({ version: 1 as const, id,
        branding: this.branding.scope(id,assertActive,own),
        storage: this.storageFor(id, record.hash, assertActive),
        nativeEvents: this.nativeEvents.scope(id, assertActive, own),
        services: this.services.scope(assertActive, own, this.adapters(record)),
        runtimes: Object.freeze({ list: () => { assertActive(); return this.runtimes.list(); }, register: (definition: RuntimeDefinition, adapter: RuntimeAdapter) => { assertActive(); const release = this.runtimes.register(id, definition, adapter); active.disposers.push(release); return release; } }),
        invoke: async <T = unknown>(method: string, payload: unknown = {}) => { assertActive(); if (!this.host) throw Error('Plugin host services are unavailable.'); if (typeof method !== 'string' || method.length > 100) throw Error('Invalid plugin host method.'); return await this.dispatch({method,payload},this.host) as T; },
        registerMethod: (method: string, handler: (payload: unknown) => unknown) => { assertActive(); if (!/^[a-z][a-z0-9./-]{0,99}$/.test(method) || active.methods.has(method) || typeof handler !== 'function') throw Error('Invalid or duplicate plugin host method.'); active.methods.set(method, handler); return () => { active.methods.delete(method); }; },
        emit: (topic: string, payload: unknown = null) => { assertActive(); if (typeof topic !== 'string' || !topic || topic.length > 120) throw Error('Invalid plugin event topic.'); this.publish({type:'plugin',id,topic,payload:structuredClone(payload)}); },
        call: async <T = unknown>(method: string, payload: unknown = {}) => { if (this.runtime.get(id) !== active) throw Error('Plugin is no longer active.'); if (!this.host) throw Error('Plugin host services are unavailable.'); if (typeof method !== 'string' || method.length > 100) throw Error('Invalid plugin host method.'); return await this.host({ method, payload }) as T; },
        onEvent: (handler: RuntimePlugin['events'][number]) => add(active.events, handler),
        onContext: (handler: RuntimePlugin['contexts'][number]) => { if (!record.manifest.capabilities.includes('context')) throw Error('Plugin did not declare context access.'); return add(active.contexts, handler); },
        useHost: (handler: RuntimePlugin['middleware'][number]) => add(active.middleware, handler),
        registerCommand: (name: string, handler: (payload: unknown) => unknown) => { assertActive(); if (!/^[a-z][a-z0-9.-]{0,79}$/.test(name) || active.commands.has(name) || typeof handler !== 'function') throw Error('Invalid or duplicate plugin command.'); active.commands.set(name, handler); return () => { active.commands.delete(name); }; },
        onDispose: (handler: () => void | Promise<void>) => { add(active.disposers, handler); },
      });
      this.runtime.set(id, active);
      try {
        await this.recovery.begin({...record.manifest,hash:record.hash},'host');
        await bounded((async()=>{const module = await nativeImport(`${pathToFileURL(childPath(record.directory, record.manifest.main!)).href}?revision=${record.hash}`);assertActive();if (typeof module.activate !== 'function') throw Error('Plugin must export activate(api).');const cleanup=await module.activate(api);if(typeof cleanup==='function'){if(this.runtime.get(id)===active)active.disposers.push(cleanup as ()=>void);else await bounded(Promise.resolve().then(()=>cleanup()),this.options.cleanupTimeoutMs??1000,'PLUGIN_CLEANUP_TIMEOUT');}assertActive();})(),this.options.activationTimeoutMs??10000,'PLUGIN_ACTIVATION_TIMEOUT');
        this.errors.delete(id);
      }
      catch (error) { const code=(error as Error).message==='PLUGIN_ACTIVATION_TIMEOUT'?'PLUGIN_ACTIVATION_TIMEOUT':'PLUGIN_HOST_ACTIVATION_FAILED';await this.recovery.incident({...record.manifest,hash:record.hash},code,'host');await this.unload(id);this.errors.set(id,code);this.prefs.entries[id]!.enabled = false;await this.save(); }
      finally{await this.recovery.finish(id,'host');}
    }
    // Providers may register services during this pass. Diagnose the current
    // contract, rather than persisting an already-resolved startup-order error.
    for(const record of records)if(record.requestedEnabled){
      const compatibility=this.compatibility(record.manifest,record.hash);
      if(compatibility.status==='blocked'){
        const code=compatibility.issues[0]!.code,repairable=compatibility.issues.every(issue=>issue.repairable);
        const previous=this.recovery.snapshot().incidents.find(i=>i.id===record.manifest.id&&i.hash===record.hash&&i.phase==='compatibility');
        if(!previous||previous.code!==code||previous.repairable!==repairable||compatibilityKey(previous.issues)!==compatibilityKey(compatibility.issues)){
          await this.recovery.clearCompatibility(record.manifest.id,record.hash);
          await this.recovery.incident({...record.manifest,hash:record.hash},code,'compatibility','confirmed',repairable,compatibility.issues);
        }
      }else await this.recovery.clearCompatibility(record.manifest.id,record.hash);
    }
  }
  async context(input: { sessionId: string; projectPath?: string; runtime: string }) {
    await this.refresh(); const values: { id: string; content: string }[] = [];
    for (const record of await this.list()) if (record.enabled) {
      const contributions = [record.manifest.contributes?.context, ...await Promise.all((this.runtime.get(record.manifest.id)?.contexts ?? []).map(fn => fn(Object.freeze({ ...input }))))].filter(value => value !== undefined && value !== '');
      for (const value of contributions) { if (typeof value !== 'string' || value.length > 24000) throw Error(`Invalid plugin context (${record.manifest.id}).`); values.push({ id: record.manifest.id, content: value }); }
    }
    if (values.reduce((total, entry) => total + entry.content.length, 0) > 64000) throw Error('Combined plugin context is too large.'); return values;
  }
  async appearance(): Promise<PluginAppearance> {
    const result: PluginAppearance = { variables: {} };
    for (const record of await this.list()) if (record.enabled && record.manifest.contributes?.theme) {
      const theme = record.manifest.contributes.theme; Object.assign(result.variables, theme.variables);
      if (theme.background) { const file = childPath(record.directory, theme.background); await noLinks(file); const info = await lstat(file); if (!info.isFile() || info.size > 4 * 1024 * 1024 || !/\.(png|jpe?g|webp)$/i.test(file)) throw Error('Plugin background must be a local PNG, JPEG or WebP up to 4 MiB.'); const mime = /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg'; result.background = `data:${mime};base64,${(await readFile(file)).toString('base64')}`; result.opacity = theme.opacity ?? 0.15; }
    }
    return result;
  }
  /** Full-trust, explicitly approved extension seam around the desktop's existing host dispatcher. */
  async dispatch(request: PluginRequest, core: (request: PluginRequest) => Promise<unknown>) {
    await this.refresh();
    const middleware = [...this.runtime].flatMap(([id,p])=>p.middleware.map(handler=>({id,hash:p.hash,handler})));
    const invoke = async (index: number, current: PluginRequest): Promise<unknown> => {
      const hook = middleware[index]; if (!hook) { const entry=[...this.runtime].reverse().find(([,plugin])=>plugin.methods.has(current.method));if(!entry)return core(current);const [id,plugin]=entry,done=this.recovery.activity({id,hash:plugin.hash},'host');try{return await plugin.methods.get(current.method)!(current.payload);}finally{done();} } let called = false;
      const done=this.recovery.activity(hook,'host');
      try{return await hook.handler(current, async (next = current) => { if (called) throw Error('Plugin middleware may invoke next only once.'); called = true; if (!next || typeof next.method !== 'string') throw Error('Invalid plugin host request.'); return invoke(index + 1, next); });}finally{done();}
    };
    return invoke(0, request);
  }
  async command(id: string, name: string, payload: unknown) { await this.refresh(); const handler = this.runtime.get(id)?.commands.get(name); if (!handler) throw Error('Enabled plugin command was not found.'); return handler(payload); }
  async renderers(): Promise<PluginRendererEntry[]> {
    await this.refresh();
    const entries: PluginRendererEntry[] = [];
    for (const record of await this.list()) if (record.enabled && record.approved && record.manifest.renderer) {
      const files = (await collectDirectory(record.directory)).sort((a, b) => a.name.localeCompare(b.name));
      if (digest(encodeZip(files)) !== record.hash) continue;
      const source = files.find(file => file.name === record.manifest.renderer)?.data;
      if (!source || source.length > 2 * 1024 * 1024) throw Error('Plugin renderer must be a bundle up to 2 MiB.');
      entries.push({ id: record.manifest.id, hash: record.hash, source: source.toString('utf8') });
    }
    return entries;
  }
  async asset(id: string, hash: string, assetPath: string) {
    await this.refresh();
    const record=(await this.list()).find(r=>r.manifest.id===id&&r.hash===hash&&r.enabled&&r.approved&&r.manifest.renderer);
    if(!record)throw Error('PLUGIN_ASSET_UNAVAILABLE');
    childPath(record.directory,assetPath);
    const files=(await collectDirectory(record.directory)).sort((a,b)=>a.name.localeCompare(b.name));
    if(digest(encodeZip(files))!==hash)throw Error('PLUGIN_ASSET_REVISION_CHANGED');
    const file=files.find(f=>f.name===assetPath),mime:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf'};
    const type=mime[path.extname(assetPath).toLowerCase()];
    if(!file||!type||file.data.length>4*1024*1024)throw Error('PLUGIN_ASSET_INVALID');
    return `data:${type};base64,${file.data.toString('base64')}`;
  }
  async disableAll() {
    return this.queue.run(async () => { for (const entry of Object.values(this.prefs.entries)) entry.enabled = false; this.revision++; await this.save(); for (const id of [...this.runtime.keys()]) await this.unload(id); this.notify(); });
  }
  async rendererFailed(id: string, hash: string) {
    if ((await this.list()).some(record => record.manifest.id === id && record.hash === hash && record.enabled && record.manifest.renderer)) { this.errors.set(id, 'PLUGIN_RENDERER_ACTIVATION_FAILED');await this.recovery.incident({id,hash},'PLUGIN_RENDERER_ACTIVATION_FAILED','renderer'); await this.setEnabled(id,hash,false); }
    await this.recovery.finish(id,'renderer');
  }
  async dispose() { await this.queue.idle(); for (const id of this.runtime.keys()) await this.unload(id); }
}
