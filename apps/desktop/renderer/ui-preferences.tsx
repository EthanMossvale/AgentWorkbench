import {useRef,useSyncExternalStore,type Dispatch,type SetStateAction} from 'react';
import type {WorkbenchApi} from '../../../packages/contracts';
import {UiPreferenceRegistry,preferenceKey,type UiValue,type UiPreferenceSnapshot,type UiPreferenceChange,type UiPreferenceRead} from '../../../packages/ui-preferences';

export class UiPreferenceClient {
  readonly registry=new UiPreferenceRegistry();
  private snapshot:UiPreferenceSnapshot={schemaVersion:1,revision:0,entries:{}};
  private pending=new Map<string,{value:UiValue|undefined;sequence:number}>();
  private ownRevisions=new Map<string,Map<number,number>>();
  private queue:Promise<unknown>=Promise.resolve();
  private sequence=0;private version=0;private listeners=new Set<()=>void>();
  private bridge?:WorkbenchApi;
  error='';
  constructor(){this.registry.subscribe(()=>this.changed());}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  getVersion=()=>this.version;
  private changed(){this.version++;for(const listener of this.listeners)listener();}
  private receive(snapshot:UiPreferenceSnapshot){if(snapshot.revision>=this.snapshot.revision){this.snapshot=snapshot;this.error=snapshot.error??'';this.changed();}}
  async initialize(bridge:WorkbenchApi|undefined){
    this.bridge=bridge;if(!bridge)return;
    bridge.onPluginEvent?.(event=>{if(event.type!=='plugin'||event.id!=='workbench.ui-preferences')return;if(event.topic==='changed')this.receive(event.payload as UiPreferenceSnapshot);if(event.topic==='flush')void this.flush().then(()=>bridge.call('ui-preferences/flush-ready',event.payload)).catch(()=>{});});
    try{this.receive(await bridge.call<UiPreferenceSnapshot>('ui-preferences/get'));await this.migrate();}catch{this.error='UI_PREFERENCE_READ_FAILED';this.changed();}
  }
  private async migrate(){
    // Import legacy values only when no central preference (including a reset) exists.
    const migrate=async(id:string,value:UiValue)=>{if(!this.snapshot.entries[preferenceKey(id)])await this.set(id,value,0);};
    try{const raw=localStorage.getItem('workbench.sidebar-layout.v1');if(raw){const old=JSON.parse(raw);if(typeof old.width==='number')await migrate('sidebar.width',Math.max(240,Math.min(600,old.width)));if(typeof old.compact==='boolean')await migrate('sidebar.compact',old.compact);}}catch{/* A malformed legacy record is not a central write failure. */}
    try{const raw=localStorage.getItem('workbench-hide-connection-addresses');if(raw!==null)await migrate('connections.mask-address',raw==='true');}catch{/* Legacy storage may be unavailable. */}
  }
  get(id:string,scope?:string):UiPreferenceRead {
    const key=preferenceKey(id,scope),entry=this.snapshot.entries[key],pending=this.pending.get(key);
    return {value:this.registry.resolve(id,pending?pending.value:entry?.value,scope),revision:entry?.revision??0,saved:pending?pending.value!==undefined:entry?.value!==undefined};
  }
  set(id:string,value:UiValue,revision:number,scope?:string){this.registry.validate(id,value);return this.write({id,scope,value,revision});}
  reset(id:string,revision:number,scope?:string){this.registry.definition(id);return this.write({id,scope,revision,reset:true});}
  private write(change:UiPreferenceChange,optimistic=false):Promise<UiPreferenceRead>{
    const key=preferenceKey(change.id,change.scope),sequence=++this.sequence;
    if(optimistic){this.pending.set(key,{value:change.value,sequence});this.changed();}
    const operation=this.queue.then(async()=>{
      if(optimistic && (this.pending.get(key)?.sequence??0)>sequence)return this.get(change.id,change.scope);
      if(!this.bridge)throw Error('UI_PREFERENCE_STORAGE_UNAVAILABLE');
      if(optimistic){
        const latest=this.snapshot.entries[key]?.revision??0,parents=this.ownRevisions.get(key);let ancestor=latest;
        while(ancestor!==change.revision&&parents?.has(ancestor))ancestor=parents.get(ancestor)!;
        // Rebase only over this client's own acknowledged writes, never a newer external choice.
        if(ancestor===change.revision)change.revision=latest;
      }
      const next=await this.bridge.call<UiPreferenceSnapshot>('ui-preferences/update',change),revision=next.entries[key]?.revision;
      if(revision!==undefined){const parents=this.ownRevisions.get(key)??new Map<number,number>();parents.set(revision,change.revision);while(parents.size>64)parents.delete(parents.keys().next().value!);this.ownRevisions.set(key,parents);}
      this.receive(next);
      return this.get(change.id,change.scope);
    }).catch(error=>{this.error=String((error as Error).message);this.changed();throw error;}).finally(()=>{if(this.pending.get(key)?.sequence===sequence){this.pending.delete(key);this.changed();}});
    this.queue=operation.catch(()=>{});return operation;
  }
  change(id:string,value:UiValue,scope?:string){this.registry.validate(id,value);void this.write({id,scope,value,revision:this.snapshot.entries[preferenceKey(id,scope)]?.revision??0},true).catch(()=>{});}
  async flush(){await this.queue;}
}
export const uiPreferences=new UiPreferenceClient();
/** React observes this key's effective value, not every write to the profile. */
export function useUiPreferenceRead(id:string,scope?:string):UiPreferenceRead {
  const cache=useRef<{id:string;scope?:string;version:number;read:UiPreferenceRead}|undefined>(undefined);
  const snapshot=()=>{
    const version=uiPreferences.getVersion(),previous=cache.current;
    if(previous?.id===id&&previous.scope===scope&&previous.version===version)return previous.read;
    const next=uiPreferences.get(id,scope);
    const same=previous?.id===id&&previous.scope===scope&&previous.read.saved===next.saved&&previous.read.revision===next.revision&&JSON.stringify(previous.read.value)===JSON.stringify(next.value);
    const read=same?previous.read:next;cache.current={id,scope,version,read};return read;
  };
  return useSyncExternalStore(uiPreferences.subscribe,snapshot);
}
/** Only call the setter for a deliberate user preference, never for responsive fitting. */
export function useUiPreference<T>(id:string,scope?:string):[T,Dispatch<SetStateAction<T>>] {
  const read=useUiPreferenceRead(id,scope);
  return [read.value as T,next=>{const value=typeof next==='function'?(next as (previous:T)=>T)(uiPreferences.get(id,scope).value as T):next;uiPreferences.change(id,value as UiValue,scope);}];
}
export function UiPreferenceStatus(){
  useSyncExternalStore(uiPreferences.subscribe,uiPreferences.getVersion);
  return <div data-workbench-ui-preferences-status>{uiPreferences.error&&<div className="global-error" role="alert" data-testid="ui-preference-error">界面偏好未能保存或读取，原文件已保留。{uiPreferences.error==='UI_PREFERENCE_CONFLICT'?'其他位置已修改此项，请重新调整。':'请检查本机数据目录后重新启动。'}</div>}</div>;
}
