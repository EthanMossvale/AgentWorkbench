import path from 'node:path';
import {readDataLocation,saveDataLocation,validateDataDestination} from './relocation';

export interface DataDirectoryState {directory:string;defaultWorktreeRoot:string;defaultDirectory:string;canMigrate:boolean;testOverride:boolean;preferred:string}
export interface DataDirectoryApi {
  get():DataDirectoryState;
  choose(kind?:'codex'):Promise<string|null>;
  migrate(target:string):Promise<{restarting:true}>;
}
export interface DataDirectoryOptions {
  directory:string;defaultDirectory:string;locator?:string;testOverride:boolean;
  busy():boolean;pick(kind?:'codex'):Promise<string|null>;
  flush():Promise<void>;restart():void;
}
/** One production instance is shared by IPC, approved plugins and admission gates. */
export class DataDirectoryService implements DataDirectoryApi {
  private changing=false;
  constructor(private options:DataDirectoryOptions){}
  isChanging(){return this.changing;}
  get():DataDirectoryState {
    const o=this.options;
    return {directory:o.directory,defaultWorktreeRoot:path.join(o.directory,'worktrees'),defaultDirectory:o.defaultDirectory,canMigrate:!!o.locator,testOverride:o.testOverride,preferred:o.locator?readDataLocation(o.locator)?.pending??o.directory:o.directory};
  }
  async choose(kind?:'codex'){
    if(!this.options.locator)throw Error('APP_DATA_RELOCATION_UNAVAILABLE');
    if(kind!==undefined&&kind!=='codex')throw Error('APP_DATA_PATH_INVALID');
    return this.options.pick(kind);
  }
  async migrate(target:string):Promise<{restarting:true}>{
    const o=this.options;
    if(!o.locator)throw Error('APP_DATA_RELOCATION_UNAVAILABLE');
    if(this.changing||o.busy())throw Error('APP_DATA_TASKS_ACTIVE');
    if(typeof target!=='string')throw Error('APP_DATA_PATH_INVALID');
    validateDataDestination(o.directory,target);this.changing=true;
    try{
      await o.flush();
      if(o.busy())throw Error('APP_DATA_TASKS_ACTIVE');
      validateDataDestination(o.directory,target);
      saveDataLocation(o.locator,{version:1,directory:o.directory,pending:target});
      o.restart();return {restarting:true};
    }catch(error){this.changing=false;throw error;}
  }
}
