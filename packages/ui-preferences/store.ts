import {mkdir,readFile,writeFile,rename,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {UiPreferenceRegistry,preferenceKey,assertUiValue,type UiPreferenceSnapshot,type UiPreferenceChange,type UiValue} from './index';

/** A separate device profile file, never a packaged default or chat database. */
export class UiPreferenceStore {
  readonly registry=new UiPreferenceRegistry();
  private state:UiPreferenceSnapshot={schemaVersion:1,revision:0,entries:{}};
  private queue:Promise<unknown>=Promise.resolve();
  private listeners=new Set<(snapshot:UiPreferenceSnapshot)=>void>();
  constructor(readonly directory:string){}
  private get file(){return path.join(this.directory,'ui-preferences.json');}
  snapshot(){return structuredClone(this.state);}
  subscribe(listener:(snapshot:UiPreferenceSnapshot)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private publish(){for(const listener of this.listeners)try{listener(this.snapshot());}catch{/* Observers do not own the write. */}}
  async load(){
    try{
      const info=await lstat(this.file);if(!info.isFile()||info.isSymbolicLink())throw Error('UI_PREFERENCE_FILE_INVALID');
      const value=JSON.parse(await readFile(this.file,'utf8')) as UiPreferenceSnapshot;
      if(value?.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<0||!value.entries||Array.isArray(value.entries))throw Error('UI_PREFERENCE_FILE_INVALID');
      for(const [key,entry] of Object.entries(value.entries)){
        const decoded=JSON.parse(key);if(!Array.isArray(decoded)||decoded.length!==2||preferenceKey(decoded[0],decoded[1])!==key||!entry||!Number.isSafeInteger(entry.revision)||entry.revision<1||entry.revision>value.revision)throw Error('UI_PREFERENCE_FILE_INVALID');
        if(entry.value!==undefined)assertUiValue(entry.value);
      }
      this.state={schemaVersion:1,revision:value.revision,entries:value.entries};
    }catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')this.state={schemaVersion:1,revision:0,entries:{}};
      else this.state={...this.state,error:'UI_PREFERENCE_READ_FAILED'};
    }
    return this.snapshot();
  }
  get(id:string,scope?:string){const entry=this.state.entries[preferenceKey(id,scope)];return {value:this.registry.resolve(id,entry?.value,scope),revision:entry?.revision??0,saved:entry?.value!==undefined};}
  update(change:UiPreferenceChange):Promise<UiPreferenceSnapshot>{
    const operation=this.queue.then(async()=>{
      const key=preferenceKey(change?.id,change?.scope);
      if(!Number.isSafeInteger(change.revision)||change.revision<0||change.reset!==undefined&&typeof change.reset!=='boolean')throw Error('UI_PREFERENCE_REVISION_INVALID');
      // Refresh the file so another settings writer cannot be silently overwritten.
      await this.load();if(this.state.error)throw Error(this.state.error);
      if((this.state.entries[key]?.revision??0)!==change.revision){this.publish();throw Error('UI_PREFERENCE_CONFLICT');}
      let value:UiValue|undefined;
      if(!change.reset){assertUiValue(change.value);value=change.id.startsWith('plugin:')?structuredClone(change.value):this.registry.validate(change.id,change.value);}
      const next=this.snapshot();next.revision++;next.entries[key]={revision:next.revision,...(value!==undefined?{value}:{})};
      const contents=JSON.stringify(next);
      await mkdir(this.directory,{recursive:true});const temp=this.file+'.'+randomUUID()+'.tmp';
      try{await writeFile(temp,contents,{flag:'wx',mode:0o600});await rename(temp,this.file);}catch{throw Error('UI_PREFERENCE_WRITE_FAILED');}finally{await rm(temp,{force:true}).catch(()=>{});}
      this.state=next;this.publish();return this.snapshot();
    });this.queue=operation.catch(error=>{for(const listener of this.listeners)try{listener({...this.snapshot(),error:(error as Error).message});}catch{}});return operation;
  }
  async set(id:string,value:UiValue,scope?:string){return this.update({id,scope,value,revision:this.state.entries[preferenceKey(id,scope)]?.revision??0});}
  async flush(){await this.queue;}
}
