import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,lstatSync,mkdirSync,openSync,readFileSync,readSync,closeSync,readdirSync,renameSync,rmdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';

interface LocationFile {version:1;directory:string;pending?:string}
const same=(a:string,b:string)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
const inside=(root:string,target:string)=>{const relative=path.relative(root,target);return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const present=(value:string)=>{try{lstatSync(value);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}};
const fileHash=(file:string)=>{const fd=openSync(file,'r'),hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);try{let count:number;while((count=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));return hash.digest('hex');}finally{closeSync(fd);}};
const verifyCopy=(source:string,target:string)=>{
  const origin=lstatSync(source),copy=lstatSync(target);
  if(origin.isSymbolicLink()||copy.isSymbolicLink())throw Error('APP_DATA_SOURCE_LINK_UNSUPPORTED');
  if(origin.isDirectory()){
    if(!copy.isDirectory())throw Error('APP_DATA_COPY_INVALID');
    const before=readdirSync(source).sort(),after=readdirSync(target).sort();
    if(JSON.stringify(before)!==JSON.stringify(after))throw Error('APP_DATA_COPY_INVALID');
    for(const name of before)verifyCopy(path.join(source,name),path.join(target,name));
  }else if(origin.isFile()){
    if(!copy.isFile()||origin.size!==copy.size||fileHash(source)!==fileHash(target))throw Error('APP_DATA_COPY_INVALID');
  }else throw Error('APP_DATA_SOURCE_INVALID');
};

export function installedDataDirectory(executable:string,home:string){
  const owner=createHash('sha256').update(process.platform==='win32'?home.toLowerCase():home).digest('hex').slice(0,16);
  return path.join(path.dirname(path.dirname(executable)),'AgentWorkbenchData',owner);
}
export function validateDataDestination(source:string,target:string){
  if(!path.isAbsolute(target)||target.includes('\0')||same(target,path.parse(target).root)||inside(source,target)||inside(target,source)||process.platform==='win32'&&!/^[A-Za-z]:\\/.test(target))throw Error('APP_DATA_PATH_INVALID');
  if(present(target))throw Error('APP_DATA_DESTINATION_CONFLICT');
  let parent=path.dirname(target);
  while(parent!==path.dirname(parent)){if(present(parent)&&lstatSync(parent).isSymbolicLink())throw Error('APP_DATA_PATH_LINK');parent=path.dirname(parent);}
  if(!present(path.dirname(target)))mkdirSync(path.dirname(target),{recursive:true});
  const probe=path.join(path.dirname(target),'.awb-probe-'+randomUUID());writeFileSync(probe,'',{flag:'wx'});rmSync(probe);
}
export function readDataLocation(file:string):LocationFile|undefined{
  if(!existsSync(file))return;
  const value=JSON.parse(readFileSync(file,'utf8')) as LocationFile;
  if(!value||value.version!==1||typeof value.directory!=='string'||!path.isAbsolute(value.directory)||value.directory.includes('\0')||same(value.directory,path.parse(value.directory).root)||value.pending!==undefined&&(typeof value.pending!=='string'||!path.isAbsolute(value.pending)||value.pending.includes('\0')))throw Error('APP_DATA_LOCATION_INVALID');
  return value;
}
export function saveDataLocation(file:string,value:LocationFile){
  mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';
  writeFileSync(temporary,JSON.stringify(value));renameSync(temporary,file);
}
const pathKeys=new Set(['path','paths','projectPath','cwd','root','repositoryRoot','sourceDirectory','directory','file','receipt','generatedRoot','pending','codexInstallDirectory']);
const remapPath=(value:string,source:string,target:string)=>{
    const prefix=value.slice(0,source.length);
    return same(prefix,source)&&(value.length===source.length||['/','\\'].includes(value[source.length]!))?target+value.slice(source.length):value;
};
const rewrite=(value:unknown,source:string,target:string,key=''):unknown=>{
  if(typeof value==='string')return pathKeys.has(key)?remapPath(value,source,target):value;
  if(Array.isArray(value))return value.map(item=>rewrite(item,source,target,key));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rewrite(item,source,target,key)]));
  return value;
};
const rewriteJson=(file:string,source:string,target:string)=>{
  if(!existsSync(file))return;
  const original=readFileSync(file,'utf8'),changed=JSON.stringify(rewrite(JSON.parse(original),source,target),null,2);
  if(changed!==original){const temporary=file+'.relocate-'+randomUUID()+'.tmp';writeFileSync(temporary,changed);renameSync(temporary,file);}
};

const rewrittenFiles=new Set(['state.json','worktree-state.json',path.join('memory-exchange','ledger.json'),'memory-background.json']);
/** Resume only when the copied tree is still byte-for-byte equivalent to the source. */
export function finishPendingRelocation(source:string,target:string){
  if(!path.isAbsolute(source)||!path.isAbsolute(target)||inside(source,target)||inside(target,source)||same(source,path.parse(source).root)||same(target,path.parse(target).root))throw Error('APP_DATA_PATH_INVALID');
  if(!present(target))throw Error('APP_DATA_DESTINATION_MISSING');
  if(!lstatSync(target).isDirectory()||lstatSync(target).isSymbolicLink())throw Error('APP_DATA_DESTINATION_INVALID');
  const journalFile=target+'.migration.json';
  if(!present(journalFile))throw Error('APP_DATA_MIGRATION_RECOVERY_REQUIRED');
  const journal=JSON.parse(readFileSync(journalFile,'utf8')) as MigrationJournal;
  if(journal.version!==1||!same(journal.source,source)||!same(journal.target,target)||journal.phase!=='cleanup')throw Error('APP_DATA_MIGRATION_RECOVERY_REQUIRED');
  verifyInventory(target,journal.targetFiles);
  for(const entry of journal.external??[]){
    if(!path.isAbsolute(entry.source)||inside(source,entry.source)||inside(entry.source,source)||same(entry.source,path.parse(entry.source).root)||!inside(target,entry.target))throw Error('APP_DATA_MIGRATION_RECOVERY_REQUIRED');
    if(present(entry.source))verifyInventory(entry.source,entry.files,true);
  }
  if(present(source)){
    // A previous cleanup may have deleted some entries. Every surviving entry
    // must still match the frozen source before any further removal.
    verifyInventory(source,journal.sourceFiles,true);
    rmSync(source,{recursive:true});
  }
  for(const entry of journal.external??[])if(present(entry.source))rmSync(entry.source,{recursive:true});
}
/** Remove recovery evidence only after the startup locator has been saved. */
export function completeRelocation(target:string){rmSync(target+'.migration.json',{force:true});}

type Inventory=Record<string,{kind:'directory'}|{kind:'file';hash:string;size:number}>;
interface MigrationJournal {version:1;source:string;target:string;phase:'prepared'|'cleanup';sourceFiles:Inventory;targetFiles:Inventory;external?:{source:string;target:string;files:Inventory}[]}
function inventory(root:string):Inventory {
  const result:Inventory={};
  const walk=(file:string)=>{const info=lstatSync(file),relative=path.relative(root,file);
    if(info.isSymbolicLink())throw Error('APP_DATA_SOURCE_LINK_UNSUPPORTED');
    if(info.isDirectory()){result[relative]={kind:'directory'};for(const name of readdirSync(file))walk(path.join(file,name));}
    else if(info.isFile())result[relative]={kind:'file',hash:fileHash(file),size:info.size};
    else throw Error('APP_DATA_SOURCE_INVALID');
  };walk(root);return result;
}
function verifyInventory(root:string,expected:Inventory,partial=false){
  const actual=inventory(root);
  if(!partial&&Object.keys(actual).length!==Object.keys(expected).length)throw Error('APP_DATA_COPY_INVALID');
  for(const [name,value] of Object.entries(actual))if(JSON.stringify(value)!==JSON.stringify(expected[name]))throw Error('APP_DATA_COPY_INVALID');
}

/** Called before stores open, after the previous process has exited. No external project is moved. */
export function relocateAppData(source:string,target:string,commit:()=>void=()=>{},aliases:Record<string,string>={}){
  validateDataDestination(source,target);
  if(!present(source))throw Error('APP_DATA_SOURCE_MISSING');
  if(!lstatSync(source).isDirectory()||lstatSync(source).isSymbolicLink())throw Error('APP_DATA_SOURCE_INVALID');
  const staging=target+'.staging-'+randomUUID(),journalFile=target+'.migration.json',planned:{repositoryRoot:string;oldPath:string;newPath:string}[]=[],moved:typeof planned=[];
  if(present(journalFile))throw Error('APP_DATA_MIGRATION_RECOVERY_REQUIRED');
  let published=false,committed=false;
  const external:NonNullable<MigrationJournal['external']>=[];
  try{
    const sourceFiles=inventory(source);
    cpSync(source,staging,{recursive:true,errorOnExist:true,force:false,dereference:false});
    verifyCopy(source,staging);
    const worktreeFile=path.join(staging,'worktree-state.json');
    if(existsSync(worktreeFile)){
      const saved=JSON.parse(readFileSync(worktreeFile,'utf8')) as {root?:string;records?:{id?:string;path:string;repositoryRoot:string;status:string}[]};
      for(const record of saved.records??[]){
        for(const [alias,origin] of Object.entries(aliases)){record.path=remapPath(record.path,alias,origin);record.repositoryRoot=remapPath(record.repositoryRoot,alias,origin);}
        if(record.status==='archived'||record.status==='missing'||record.status==='failed')continue;
        if(inside(source,record.repositoryRoot))throw Error('APP_DATA_MANAGED_REPOSITORY_UNSUPPORTED');
        const outside=!inside(source,record.path),newPath=outside?path.join(target,'worktrees','relocated-'+createHash('sha256').update(record.path).digest('hex').slice(0,24)):target+record.path.slice(source.length);
        const common=(directory:string)=>execFileSync('git',['-C',directory,'rev-parse','--path-format=absolute','--git-common-dir'],{windowsHide:true,timeout:120000,encoding:'utf8'}).trim();
        if(!same(common(record.path),common(record.repositoryRoot)))throw Error('APP_DATA_MANAGED_REPOSITORY_UNSUPPORTED');
        if(outside){
          if(inside(record.path,source)||same(record.path,record.repositoryRoot)||inside(record.path,target)||external.some(entry=>inside(entry.source,record.path)||inside(record.path,entry.source)))throw Error('APP_DATA_PATH_INVALID');
          const top=execFileSync('git',['-C',record.path,'rev-parse','--show-toplevel'],{windowsHide:true,timeout:120000,encoding:'utf8'}).trim();
          if(!same(top,record.path)||!lstatSync(path.join(record.path,'.git')).isFile())throw Error('APP_DATA_MANAGED_REPOSITORY_UNSUPPORTED');
          const destination=path.join(staging,path.relative(target,newPath));if(present(destination))throw Error('APP_DATA_DESTINATION_CONFLICT');
          const files=inventory(record.path);cpSync(record.path,destination,{recursive:true,errorOnExist:true,force:false,dereference:false});verifyCopy(record.path,destination);
          external.push({source:record.path,target:newPath,files});
        }
        planned.push({repositoryRoot:record.repositoryRoot,oldPath:record.path,newPath});
      }
      if(saved.root&&!inside(source,saved.root)){saved.root=path.join(target,'worktrees');writeFileSync(worktreeFile,JSON.stringify(saved,null,2));}
    }
    // Reject edits made by another process while the copy and validation ran.
    verifyInventory(source,sourceFiles);
    const mappings=[[source,target],...external.map(entry=>[entry.source,entry.target]),...Object.entries(aliases).map(([alias,origin])=>[alias,remapPath(origin,source,target)])];
    for(const [before,after] of mappings)for(const file of rewrittenFiles)rewriteJson(path.join(staging,file),before!,after!);
    const attachments=path.join(staging,'attachments');
    if(existsSync(attachments))for(const entry of readdirSync(attachments)){const metadata=path.join(attachments,entry,'metadata.json');if(existsSync(metadata))for(const [before,after] of mappings)rewriteJson(metadata,before!,after!);}
    const journal:MigrationJournal={version:1,source,target,phase:'prepared',sourceFiles,targetFiles:inventory(staging),external};
    writeFileSync(journalFile,JSON.stringify(journal),{flag:'wx'});
    renameSync(staging,target);published=true;
    for(const record of planned){
      moved.push(record);
      execFileSync('git',['-C',remapPath(record.repositoryRoot,source,target),'worktree','repair',record.newPath],{windowsHide:true,timeout:120000});
      execFileSync('git',['-C',record.newPath,'rev-parse','--git-common-dir'],{windowsHide:true,timeout:120000,stdio:'pipe'});
    }
    verifyInventory(source,sourceFiles);
    for(const entry of external)verifyInventory(entry.source,entry.files);
    journal.phase='cleanup';journal.targetFiles=inventory(target);
    const temporary=journalFile+'.tmp';writeFileSync(temporary,JSON.stringify(journal));renameSync(temporary,journalFile);
    commit();
    committed=true;
  }catch(error){
    let rollbackFailed=false;
    for(const record of moved.reverse())try{execFileSync('git',['-C',record.repositoryRoot,'worktree','repair',record.oldPath],{windowsHide:true,timeout:120000});}catch{rollbackFailed=true;}
    if(!rollbackFailed&&!committed){rmSync(staging,{recursive:true,force:true});if(published)rmSync(target,{recursive:true,force:true});rmSync(journalFile,{force:true});}
    throw new Error(rollbackFailed?'APP_DATA_MIGRATION_RECOVERY_REQUIRED':'APP_DATA_MIGRATION_FAILED',{cause:error});
  }
  try{finishPendingRelocation(source,target);}
  catch(error){throw new Error('APP_DATA_MIGRATION_CLEANUP_REQUIRED',{cause:error});}
  return {directory:target,migrated:true};
}

export function relocateLegacyRuntimeData(home:string,dataDirectory:string){
  const oldRoot=path.join(home,'.agent-workbench');
  for(const name of ['workspaces','claude-tool-profiles']){
    const source=path.join(oldRoot,name),target=path.join(dataDirectory,name);
    if(!present(source)&&!present(target+'.migration.json'))continue;
    try{
      if(!present(target))relocateAppData(source,target);
      else if(present(target+'.migration.json'))finishPendingRelocation(source,target);
      else throw Error('APP_DATA_DESTINATION_CONFLICT');
      for(const file of ['state.json','worktree-state.json'])rewriteJson(path.join(dataDirectory,file),source,target);
      completeRelocation(target);
    }catch(error){
      throw new Error('APP_DATA_LEGACY_MIGRATION_FAILED',{cause:error});
    }
  }
  if(present(oldRoot)&&lstatSync(oldRoot).isDirectory()&&!lstatSync(oldRoot).isSymbolicLink()&&readdirSync(oldRoot).length===0)rmdirSync(oldRoot);
}

/** Import only clipboard folders proven by this profile's immutable attachment metadata. */
export function relocateClipboardData(dataDirectory:string,temporaryDirectory:string){
  const attachments=path.join(dataDirectory,'attachments');if(!present(attachments))return;
  for(const id of readdirSync(attachments)){
    if(!/^[a-f\d-]{36}$/i.test(id))continue;
    const metadata=path.join(attachments,id,'metadata.json');if(!present(metadata))continue;
    const item=JSON.parse(readFileSync(metadata,'utf8')) as {storage?:string;path?:string;sha256?:string;size?:number};
    if(item.storage!=='clipboard'||typeof item.path!=='string')continue;
    const source=path.join(temporaryDirectory,id),target=path.join(dataDirectory,'clipboard-temp',id);
    if(!same(path.dirname(item.path),source))continue;
    if(!present(item.path)&&!present(target+'.migration.json'))continue; // Already missing OS cache is not fabricated.
    if(present(item.path)&&(lstatSync(item.path).size!==item.size||fileHash(item.path)!==item.sha256))throw Error('APP_DATA_COPY_INVALID');
    if(!present(target))relocateAppData(source,target);
    else finishPendingRelocation(source,target);
    rewriteJson(path.join(dataDirectory,'state.json'),source,target);
    rewriteJson(metadata,source,target);
    completeRelocation(target);
  }
  if(present(temporaryDirectory)&&lstatSync(temporaryDirectory).isDirectory()&&!lstatSync(temporaryDirectory).isSymbolicLink()&&!readdirSync(temporaryDirectory).length)rmdirSync(temporaryDirectory);
}
