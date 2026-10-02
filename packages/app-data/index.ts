import {existsSync,lstatSync,statSync,realpathSync,readlinkSync,mkdirSync,renameSync,symlinkSync,unlinkSync,rmdirSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {completeRelocation,finishPendingRelocation,readDataLocation,relocateAppData,saveDataLocation,installedDataDirectory,legacyInstalledDataDirectory} from './relocation';

/** Source and installed launches share an existing selection; only an installed first launch creates one. */
export function resolveAppDataInstallation(options:{platform:NodeJS.Platform;packaged:boolean;executable:string;home:string;appData:string}){
  const {platform,packaged,executable,home,appData}=options;
  const locator=path.join(appData,'AgentWorkbench-location.json');
  if(platform!=='win32'||!packaged&&!existsSync(locator))return;
  return {directory:installedDataDirectory(executable,home,appData),legacyDirectory:legacyInstalledDataDirectory(executable,home),locator};
}

export interface AppDataLocation {directory:string;legacyDirectory:string;defaultDirectory:string;migrated:boolean;compatibilityLinks:string[]}
export interface AppDataHost {getPath(name:'home'|'userData'|'temp'):string;setPath(name:'userData',value:string):void;requestSingleInstanceLock():boolean;releaseSingleInstanceLock():void}
/** Electron holds a Windows file handle in the lock directory. Keep it outside the profile being moved. */
export function initializeAppData(host:AppDataHost,override?:string,installed?:{directory:string;locator:string;legacyDirectory?:string}):AppDataLocation|null{
  const home=host.getPath('home'),legacy=host.getPath('userData');
  // An older running build still locks the legacy profile; let it handle the second launch.
  if(!host.requestSingleInstanceLock())return null;
  host.releaseSingleInstanceLock();
  const identity=createHash('sha256').update(process.platform==='win32'?path.resolve(legacy).toLowerCase():path.resolve(legacy)).digest('hex').slice(0,24);
  const lockDirectory=path.join(host.getPath('temp'),'agentworkbench-startup',identity);mkdirSync(lockDirectory,{recursive:true});host.setPath('userData',lockDirectory);
  if(!host.requestSingleInstanceLock())return null;
  try{
    let result:AppDataLocation;
    if(!installed||override){
      const preferred=path.join(home,'.agentworkbench');
      const directory=override??(present(preferred)?preferred:populated(legacy)?legacy:preferred);
      result=openExistingOrCreate(home,legacy,directory,preferred);
    }
    else{
      const saved=readDataLocation(installed.locator),defaultDirectory=path.join(home,'.agentworkbench');
      const current=saved?.directory??(present(defaultDirectory)?defaultDirectory:present(installed.directory)?installed.directory:installed.legacyDirectory&&present(installed.legacyDirectory)?installed.legacyDirectory:populated(legacy)?legacy:undefined);
      if(!current){
        result=openExistingOrCreate(home,legacy,installed.directory,installed.directory);
        saveDataLocation(installed.locator,{version:1,directory:installed.directory,defaultDirectory:installed.directory});
      }else if(saved?.pending){
        const target=saved.pending;
        if(present(target))finishPendingRelocation(current,target);
        else if(!same(current,target))relocateAppData(current,target,undefined,legacyAliases(legacy,current));
        saveDataLocation(installed.locator,{version:1,directory:target,defaultDirectory:installed.directory});
        completeRelocation(target);removeLegacyAliases(legacy,current);
        result={directory:target,legacyDirectory:legacy,defaultDirectory:installed.directory,migrated:true,compatibilityLinks:[]};
      }else{
        if(!present(current))throw Error('APP_DATA_SOURCE_MISSING');
        result=openExistingOrCreate(home,legacy,current,installed.directory);
        if(!saved)saveDataLocation(installed.locator,{version:1,directory:current,defaultDirectory:installed.directory});
      }
    }
    host.setPath('userData',result.directory);return result;
  }
  catch(error){host.releaseSingleInstanceLock();throw error;}
}
function legacyAliases(legacy:string,previous:string){
  const aliases:Record<string,string>={};
  for(const [alias,expected] of [[legacy,previous],[legacy+'-attachments',path.join(previous,'attachments')],[legacy+'-worktrees',path.join(previous,'worktrees')]]){
    if(!alias||!expected||!present(alias)||!lstatSync(alias).isSymbolicLink())continue;
    const target=path.resolve(path.dirname(alias),readlinkSync(alias).replace(/^\\\\\?\\/,''));
    if(same(target,path.resolve(expected)))aliases[alias]=expected;
  }
  return aliases;
}
function removeLegacyAliases(legacy:string,previous:string){
  for(const alias of Object.keys(legacyAliases(legacy,previous)))unlinkSync(alias);
  // Probing an older Electron singleton creates an empty legacy directory.
  if(present(legacy)&&lstatSync(legacy).isDirectory()&&!lstatSync(legacy).isSymbolicLink()&&!readdirSync(legacy).length)rmdirSync(legacy);
}
const same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const present=(file:string)=>{try{lstatSync(file);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}};
const populated=(directory:string)=>present(directory)&&statSync(directory).isDirectory()&&readdirSync(directory).length>0;
/** Starting or upgrading the program never grants permission to relocate user data. */
function openExistingOrCreate(home:string,legacyDirectory:string,directory:string,defaultDirectory:string):AppDataLocation{
  if(!path.isAbsolute(directory)||directory.includes('\0')||same(path.resolve(directory),path.parse(directory).root)||same(path.resolve(directory),path.resolve(home)))throw Error('APP_DATA_PATH_INVALID');
  if(present(directory)){if(!statSync(directory).isDirectory())throw Error('APP_DATA_DESTINATION_INVALID');}
  else mkdirSync(directory,{recursive:true});
  return {directory,legacyDirectory,defaultDirectory,migrated:false,compatibilityLinks:[]};
}
/** Run once under the app single-instance lock, before Electron readiness or any store opens. Payload files stay opaque. */
export function prepareAppData(home:string,legacyDirectory:string,override?:string):AppDataLocation{
  const defaultDirectory=path.join(home,'.agentworkbench'),directory=override??defaultDirectory;
  for(const value of [directory,legacyDirectory])if(!path.isAbsolute(value)||value.includes('\0'))throw Error('APP_DATA_PATH_INVALID');
  if(same(path.resolve(directory),path.parse(directory).root)||same(path.resolve(directory),path.resolve(home)))throw Error('APP_DATA_PATH_INVALID');
  const contains=(a:string,b:string)=>{const rel=path.relative(a,b);return !rel||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
  for(const source of [legacyDirectory,legacyDirectory+'-attachments',legacyDirectory+'-worktrees'])if(!same(path.resolve(directory),path.resolve(source))&&(contains(source,directory)||contains(directory,source)))throw Error('APP_DATA_PATH_OVERLAP');
  if([legacyDirectory+'-attachments',legacyDirectory+'-worktrees'].some(source=>same(path.resolve(directory),path.resolve(source))))throw Error('APP_DATA_PATH_OVERLAP');
  const rollback:(()=>void)[]=[],compatibilityLinks:string[]=[];let migrated=false;
  const relocate=(oldPath:string,newPath:string)=>{
    if(same(path.resolve(oldPath),path.resolve(newPath)))return;
    if(present(oldPath)){
      const stat=lstatSync(oldPath);
      if(stat.isSymbolicLink()){
        if(existsSync(newPath)&&same(realpathSync(oldPath),realpathSync(newPath))){compatibilityLinks.push(oldPath);return;}
        throw Error('APP_DATA_LEGACY_LINK_CONFLICT');
      }
      if(!stat.isDirectory())throw Error('APP_DATA_SOURCE_INVALID');
      if(present(newPath)){
        if(!lstatSync(newPath).isDirectory()||lstatSync(newPath).isSymbolicLink())throw Error('APP_DATA_DESTINATION_INVALID');
        if(readdirSync(oldPath).length)throw Error('APP_DATA_DESTINATION_CONFLICT');
        rmdirSync(oldPath);rollback.push(()=>mkdirSync(oldPath));
      }else{
        mkdirSync(path.dirname(newPath),{recursive:true});renameSync(oldPath,newPath);migrated=true;rollback.push(()=>renameSync(newPath,oldPath));
      }
      symlinkSync(newPath,oldPath,process.platform==='win32'?'junction':'dir');compatibilityLinks.push(oldPath);rollback.push(()=>unlinkSync(oldPath));
    }
  };
  try{
    if(present(directory)&&(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink()))throw Error('APP_DATA_DESTINATION_INVALID');
    relocate(legacyDirectory,directory);
    if(!existsSync(directory)){mkdirSync(directory,{recursive:true});rollback.push(()=>rmdirSync(directory));}
    relocate(legacyDirectory+'-worktrees',path.join(directory,'worktrees'));
    relocate(legacyDirectory+'-attachments',path.join(directory,'attachments'));
    return {directory,legacyDirectory,defaultDirectory,migrated,compatibilityLinks};
  }catch(error){
    let failed=false;for(const undo of rollback.reverse())try{undo();}catch{failed=true;}
    const code=error instanceof Error&&/^APP_DATA_/.test(error.message)?error.message:'APP_DATA_MIGRATION_FAILED';
    throw new Error(failed?'APP_DATA_MIGRATION_RECOVERY_REQUIRED':code,{cause:error});
  }
}
