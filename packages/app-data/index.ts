import {existsSync,lstatSync,realpathSync,mkdirSync,renameSync,symlinkSync,unlinkSync,rmdirSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export interface AppDataLocation {directory:string;legacyDirectory:string;defaultDirectory:string;migrated:boolean;compatibilityLinks:string[]}
export interface AppDataHost {getPath(name:'home'|'userData'|'temp'):string;setPath(name:'userData',value:string):void;requestSingleInstanceLock():boolean;releaseSingleInstanceLock():void}
/** Electron holds a Windows file handle in the lock directory. Keep it outside the profile being moved. */
export function initializeAppData(host:AppDataHost,override?:string):AppDataLocation|null{
  const home=host.getPath('home'),legacy=host.getPath('userData');
  // An older running build still locks the legacy profile; let it handle the second launch.
  if(!host.requestSingleInstanceLock())return null;
  host.releaseSingleInstanceLock();
  const identity=createHash('sha256').update(process.platform==='win32'?path.resolve(legacy).toLowerCase():path.resolve(legacy)).digest('hex').slice(0,24);
  const lockDirectory=path.join(host.getPath('temp'),'agentworkbench-startup',identity);mkdirSync(lockDirectory,{recursive:true});host.setPath('userData',lockDirectory);
  if(!host.requestSingleInstanceLock())return null;
  try{const result=prepareAppData(home,legacy,override);host.setPath('userData',result.directory);return result;}
  catch(error){host.releaseSingleInstanceLock();throw error;}
}
const same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const present=(file:string)=>{try{lstatSync(file);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}};
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
