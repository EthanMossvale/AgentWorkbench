import { coreShortcutActions, effectiveBindings, normalizeShortcut, resolveShortcuts, shortcutConflicts, shortcutFromEvent, shortcutIdentity, updateShortcuts, validateBindings, type ShortcutAction, type ShortcutKeyEvent, type ShortcutScope, type ShortcutSettings } from '../../../packages/shortcuts';

export interface ShortcutRunContext { signal: AbortSignal; invokeDefault(): Promise<void> }
export type ShortcutHandler = (context: ShortcutRunContext) => void | Promise<void>;
export interface ShortcutDefinition { id: string; label: string; description?: string; defaultBindings?: string[]; run: ShortcutHandler }
export interface ShortcutEntry extends ShortcutAction { owner?: string; bindings: readonly string[]; customized: boolean; conflicts: readonly string[] }
export interface ShortcutHandle { id: string; dispose(): void }
export interface ShortcutsPluginApi {
  list(): readonly ShortcutEntry[];
  subscribe(listener: () => void): () => void;
  getSettings(): ShortcutSettings;
  setBindings(id: string, bindings: string[], revision: number): Promise<void>;
  reset(id: string | undefined, revision: number): Promise<void>;
  register(definition: ShortcutDefinition): ShortcutHandle;
  override(id: string, run: ShortcutHandler): ShortcutHandle;
  invoke(id: string): Promise<void>;
}
interface Registration { owner: string; action: ShortcutAction; run: ShortcutHandler; abort: AbortController }
interface Replacement { owner: string; id: string; run: ShortcutHandler; abort: AbortController }
type Call = <T>(method: string, payload?: unknown) => Promise<T>;
export class ShortcutRegistry {
  private settings = resolveShortcuts();
  private entries: Registration[] = [];
  private replacements: Replacement[] = [];
  private listeners = new Set<() => void>();
  private executors = new Map<ShortcutScope,(id: string) => void | Promise<void>>();
  private snapshot: readonly ShortcutEntry[] = [];
  private call?: Call;
  constructor(readonly mac = false) { this.publish(); }
  configure(call: Call) { this.call=call;return ()=>{if(this.call===call)this.call=undefined;}; }
  getSettings = () => structuredClone(this.settings);
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
  receive(value?: ShortcutSettings) { const next=resolveShortcuts(value);if(next.revision<this.settings.revision||JSON.stringify(next)===JSON.stringify(this.settings))return;this.settings=next;this.publish(); }
  bind(scope: ShortcutScope, run: (id: string) => void | Promise<void>) {this.executors.set(scope,run);return ()=>{if(this.executors.get(scope)===run)this.executors.delete(scope);};}
  private actions() {return [...coreShortcutActions,...this.entries.map(entry=>entry.action)];}
  private publish() {
    const actions=this.actions(),conflicts=shortcutConflicts(actions,this.settings,this.mac);
    this.snapshot=Object.freeze(actions.map(action=>Object.freeze({...action,owner:this.entries.find(entry=>entry.action.id===action.id)?.owner,bindings:Object.freeze([...effectiveBindings(action,this.settings)]),customized:Object.hasOwn(this.settings.overrides,action.id),conflicts:Object.freeze(conflicts.filter(c=>c.id===action.id||c.other===action.id).map(c=>c.id===action.id?c.other:c.id))})));
    for(const listener of this.listeners)listener();
  }
  async save(id: string | undefined, bindings: string[] | undefined, revision: number, reset = false) {
    if(!this.call)throw Error('SHORTCUT_UNAVAILABLE');
    if(id!==undefined&&!this.snapshot.some(entry=>entry.id===id))throw Error('SHORTCUT_UNKNOWN_ACTION');
    const next=updateShortcuts(this.settings,revision,id,bindings,reset,this.mac);
    const conflict=shortcutConflicts(this.actions(),next,this.mac).find(c=>id===undefined||c.id===id||c.other===id);
    if(conflict)throw Error('SHORTCUT_CONFLICT');
    this.receive(await this.call<ShortcutSettings>('shortcuts/set',{id,bindings,revision,reset}));
  }
  register(owner: string, definition: ShortcutDefinition): ShortcutHandle {
    if(!/^[a-z][a-z0-9.-]{0,79}$/.test(owner)||!/^[a-z][a-z0-9.-]{0,79}$/.test(definition?.id)||typeof definition.label!=='string'||!definition.label.trim()||definition.label.length>120||definition.description!==undefined&&(typeof definition.description!=='string'||definition.description.length>500)||typeof definition.run!=='function')throw Error('SHORTCUT_INVALID_ACTION');
    const id=`plugin:${owner}/${definition.id}`;
    if(this.entries.some(entry=>entry.action.id===id))throw Error('SHORTCUT_DUPLICATE_ACTION');
    const entry:Registration={owner,action:Object.freeze({id,label:definition.label,description:definition.description??'',scope:'global',defaultBindings:Object.freeze(validateBindings(definition.defaultBindings??[],id))}),run:definition.run,abort:new AbortController()};
    this.entries.push(entry);this.publish();return {id,dispose:()=>{if(entry.abort.signal.aborted)return;entry.abort.abort();this.entries=this.entries.filter(item=>item!==entry);this.publish();}};
  }
  override(owner: string, id: string, run: ShortcutHandler): ShortcutHandle {
    if(!this.snapshot.some(entry=>entry.id===id))throw Error('SHORTCUT_UNKNOWN_ACTION');
    if(typeof run!=='function')throw Error('SHORTCUT_INVALID_ACTION');
    const entry={owner,id,run,abort:new AbortController()};this.replacements.push(entry);this.publish();
    return {id,dispose:()=>{if(entry.abort.signal.aborted)return;entry.abort.abort();this.replacements=this.replacements.filter(item=>item!==entry);this.publish();}};
  }
  async invoke(id: string): Promise<void> {
    const action=this.snapshot.find(entry=>entry.id===id);if(!action)throw Error('SHORTCUT_UNKNOWN_ACTION');
    const registration=this.entries.find(entry=>entry.action.id===id),executor=this.executors.get(action.scope);
    const base=async()=>{if(registration){if(registration.abort.signal.aborted)throw Error('SHORTCUT_DISPOSED');await registration.run({signal:registration.abort.signal,invokeDefault:async()=>{throw Error('SHORTCUT_NO_DEFAULT');}});}else {if(!executor)throw Error('SHORTCUT_UNAVAILABLE');await executor(id);}};
    let run=base;
    for(const replacement of this.replacements.filter(entry=>entry.id===id)) {
      const next=run;run=async()=>{if(replacement.abort.signal.aborted)throw Error('SHORTCUT_DISPOSED');await replacement.run({signal:replacement.abort.signal,invokeDefault:async()=>{if(replacement.abort.signal.aborted)throw Error('SHORTCUT_DISPOSED');await next();}});};
    }
    await run();
  }
  match(event: ShortcutKeyEvent, scope: ShortcutScope = 'global') {
    const binding=shortcutFromEvent(event,this.mac);if(!binding)return undefined;
    // Core actions win over newly loaded conflicting plugin defaults. Never fire twice.
    const winner=this.snapshot.find(entry=>entry.bindings.some(key=>shortcutIdentity(normalizeShortcut(key),this.mac)===shortcutIdentity(binding,this.mac)));
    return winner && (winner.scope==='global'||winner.scope===scope)?winner.id:undefined;
  }
}
export const shortcuts = new ShortcutRegistry(typeof navigator!=='undefined' && /Mac/.test(navigator.platform));
