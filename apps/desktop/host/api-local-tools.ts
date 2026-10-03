import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Session } from '../../../packages/contracts';
import type { ApiToolDefinition } from '../../../packages/model-api/types';
import { OwnerFileService, type FileContext, type FileReadOptions, type FileReadPage } from '../../../services/owner-file-service';
import { verifyCurrentWindowsOwner } from '../../../services/owner-file-service/windows-owner';
import {runApiCommand,type ApiCommandOptions,type ApiCommandExecutor} from './api-command';
export {runApiCommand} from './api-command';

const text={type:'string'};
export const apiLocalToolDefinitions:ApiToolDefinition[]=[
  {name:'read_file',description:'Read an ordinary file in pages. UTF-8 offsets/limits count characters; base64 offsets/limits count bytes. Use nextOffset and the returned version to continue a consistent read. There is no total size or fixed page-length cap. Owner-wide access is not confined to the working directory. OS ownership and device grants apply regardless of directory names. The returned version is required for edits; a truncated slice is not the complete file.',inputSchema:{type:'object',properties:{path:text,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1},encoding:{type:'string',enum:['utf8','base64']},version:text},required:['path'],additionalProperties:false}},
  {name:'list_directory',description:'List an ordinary directory belonging to this OS user. This is file browsing, not device or system inventory.',inputSchema:{type:'object',properties:{path:text,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1}},required:['path'],additionalProperties:false}},
  {name:'write_file',description:'Replace an existing file using the exact version from read_file. Content is UTF-8 by default, or canonical base64 for binary bytes. Never overwrite concurrent edits. Default permissions require approval; read-only forbids edits.',inputSchema:{type:'object',properties:{path:text,version:text,content:text,encoding:{type:'string',enum:['utf8','base64']}},required:['path','version','content'],additionalProperties:false}},
  {name:'run_command',description:'Execute a local shell command. No timeout by default; timeoutMs explicitly sets one (0 means none). maxOutputBytes controls each inline stream preview (default 16000), not execution or disk output. Complete stdout/stderr paths are returned; use read_file to continue reading them without rerunning the command. Default permissions require approval; full-access uses the permission already selected by the user. Read-only and plan modes forbid this tool. It runs on the real local device with no API credentials in its environment. Do not request access to new devices, other owners, credentials or administrator controls.',inputSchema:{type:'object',properties:{command:text,timeoutMs:{type:'integer',minimum:0},maxOutputBytes:{type:'integer',minimum:0}},required:['command'],additionalProperties:false}},
];
export interface ApiFileReader { id:`plugin:${string}`; read(path:string,options:FileReadOptions,next:()=>Promise<FileReadPage>):FileReadPage|undefined|Promise<FileReadPage|undefined> }
type Approve=(kind:'command'|'file',details:string,signal:AbortSignal)=>Promise<boolean>;
export class ApiLocalTools {
  private service?:Promise<OwnerFileService>;
  private generation=randomUUID();
  private readers=new Map<string,ApiFileReader>();
  registerFileReader(reader:ApiFileReader):()=>void{
    if(!/^plugin:[a-z\d][a-z\d._-]*\/[a-z\d][a-z\d._-]*$/i.test(reader.id)||typeof reader.read!=='function')throw Error('FILE_READER_INVALID');
    if(this.readers.has(reader.id))throw Error('FILE_READER_DUPLICATE');
    const entry={...reader};this.readers.set(entry.id,entry);return()=>{if(this.readers.get(entry.id)===entry)this.readers.delete(entry.id);};
  }
  async readFile(context:FileContext,file:string,options:FileReadOptions):Promise<FileReadPage>{
    const files=await this.files(),next=()=>files.readRange(context,file,options);
    for(const reader of [...this.readers.values()].reverse()){
      try{const result=await reader.read(file,options,next);if(result&&this.readers.get(reader.id)===reader)return result;}
      catch(error){if(this.readers.get(reader.id)===reader)throw error;}
    }
    return next();
  }
  constructor(private controlPaths:string[],private commandDirectory?:string){}
  private executors=new Map<string,ApiCommandExecutor>();
  registerCommandExecutor(executor:ApiCommandExecutor):()=>void{
    if(!/^plugin:[a-z\d][a-z\d._-]*\/[a-z\d][a-z\d._-]*$/i.test(executor.id)||typeof executor.execute!=='function')throw Error('COMMAND_EXECUTOR_INVALID');
    if(this.executors.has(executor.id))throw Error('COMMAND_EXECUTOR_DUPLICATE');const entry={...executor};this.executors.set(entry.id,entry);return()=>{if(this.executors.get(entry.id)===entry)this.executors.delete(entry.id);};
  }
  async executeCommand(command:string,cwd:string,signal:AbortSignal,options:ApiCommandOptions={}):Promise<unknown>{
    // A selected executor owns this operation through completion, even if disabled. Never replay an executed command.
    for(const executor of [...this.executors.values()].reverse()){const result=executor.execute(command,cwd,signal,options);if(result!==undefined)return result;}
    return runApiCommand(command,cwd,signal,options,this.commandDirectory);
  }
  private files(){return this.service??=OwnerFileService.create({ownerId:'local-owner',deviceId:'local-device',generation:this.generation,controlPaths:this.controlPaths,verifyOwner:process.platform==='win32'?verifyCurrentWindowsOwner:undefined,expectedUid:process.getuid?.()});}
  async call(session:Session,name:string,args:Record<string,unknown>,signal:AbortSignal,approve:Approve,current:()=>Session=()=>session):Promise<unknown>{
    signal.throwIfAborted();
    const writing=name==='write_file'||name==='run_command';
    if(writing&&['read-only','plan'].includes(session.permissionMode??'default'))throw Error('READ_ONLY: This session does not permit modifications or commands.');
    const definition=apiLocalToolDefinitions.find(item=>item.name===name);if(!definition)throw Error('UNKNOWN_TOOL');
    const props=definition.inputSchema.properties as Record<string,unknown>;
    if(Object.keys(args).some(key=>!Object.hasOwn(props,key)))throw Error('INVALID_ARGUMENT: Unexpected fields.');
    for(const key of definition.inputSchema.required as string[])if(typeof args[key]!=='string')throw Error('INVALID_ARGUMENT: Required string is missing.');
    if(name==='run_command'){
      if(!String(args.command).trim())throw Error('INVALID_COMMAND');
      for(const key of ['timeoutMs','maxOutputBytes'])if(args[key]!==undefined&&(!Number.isSafeInteger(args[key])||(args[key] as number)<0))throw Error('INVALID_COMMAND_OPTIONS');
      if(current().permissionMode!=='full-access'&&!await approve('command',JSON.stringify({cwd:session.projectPath||os.homedir(),command:args.command,timeoutMs:args.timeoutMs??0,maxOutputBytes:args.maxOutputBytes??16000},null,2),signal))return {status:'declined',executed:false};
      signal.throwIfAborted();if(['read-only','plan'].includes(current().permissionMode??'default'))throw Error('READ_ONLY: Permissions changed before command execution.');return this.executeCommand(String(args.command),session.projectPath||os.homedir(),signal,{timeoutMs:args.timeoutMs as number|undefined,maxOutputBytes:args.maxOutputBytes as number|undefined});
    }
    const files=await this.files(),grant=files.issueGrant({expiresAt:new Date(Date.now()+10*60_000).toISOString(),operations:writing?['read','write']:['read']});
    const context:FileContext={grantId:grant.id,ownerId:grant.ownerId,deviceId:grant.deviceId,generation:grant.generation,sessionId:session.id,workspaceId:session.projectId??'projectless',operationId:randomUUID(),os:process.platform};
    const target=String(args.path);if(!target||target.includes('\0'))throw Error('INVALID_PATH');
    const absolute=path.isAbsolute(target)?target:path.resolve(session.projectPath||os.homedir(),target);
    if(name==='read_file')return this.readFile(context,absolute,{offset:(args.offset??0) as number,limit:(args.limit??16000) as number,encoding:(args.encoding??'utf8') as 'utf8'|'base64',version:args.version as string|undefined,signal});
    if(name==='list_directory')return files.list(context,absolute,{offset:args.offset as number|undefined,limit:args.limit as number|undefined});
    const preview=await files.prepareWrite(context,absolute,String(args.version),String(args.content),(args.encoding??'utf8') as 'utf8'|'base64');
    if(current().permissionMode!=='full-access'&&!await approve('file',JSON.stringify({path:absolute,expectedVersion:args.version,content:args.content},null,2),signal))return {status:'declined',written:false};
    signal.throwIfAborted();if(['read-only','plan'].includes(current().permissionMode??'default'))throw Error('READ_ONLY: Permissions changed before file execution.');files.confirmWrite(preview.id,preview.bindingHash);
    try{return await files.write(context,preview.id,preview.bindingHash);}catch(error){if(typeof (error as any)?.code==='string'&&/^(ACCESS_DENIED|INVALID_APPROVAL|VERSION_CONFLICT|WRITE_BUSY|PATH_CHANGED|OTHER_OWNER|CONTROL_PLANE_DENIED|UNSUPPORTED_FILE|FILE_TOO_LARGE)$/.test((error as any).code))throw error;throw Object.assign(Error('FILE_WRITE_OUTCOME_UNCERTAIN'),{code:'RESULT_UNCERTAIN'});}
  }
}
