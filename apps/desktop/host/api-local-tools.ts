import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { Session } from '../../../packages/contracts';
import type { ApiToolDefinition } from '../../../packages/model-api/types';
import { OwnerFileService, type FileContext } from '../../../services/owner-file-service';
import { verifyCurrentWindowsOwner } from '../../../services/owner-file-service/windows-owner';
import { buildSshEnvironment } from '../../../packages/ssh-transport';

const text={type:'string'};
export const apiLocalToolDefinitions:ApiToolDefinition[]=[
  {name:'read_file',description:'Read a UTF-8 ordinary file owned by this OS user, in bounded character slices. Owner-wide access is not confined to the working directory. Credential, other-owner and control-plane paths are excluded. The returned version is required for edits; a truncated slice is not the complete file.',inputSchema:{type:'object',properties:{path:text,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:32000}},required:['path'],additionalProperties:false}},
  {name:'list_directory',description:'List an ordinary directory belonging to this OS user. This is file browsing, not device or system inventory.',inputSchema:{type:'object',properties:{path:text},required:['path'],additionalProperties:false}},
  {name:'write_file',description:'Replace an existing UTF-8 file using the exact version from read_file. Never overwrite concurrent edits. Default permissions require approval; read-only forbids edits.',inputSchema:{type:'object',properties:{path:text,version:text,content:text},required:['path','version','content'],additionalProperties:false}},
  {name:'run_command',description:'Request execution of a local shell command. Every command needs user approval, including in full-access mode. Read-only forbids this tool. It runs on the real local device with no API credentials in its environment. Do not request access to new devices, other owners, credentials or administrator controls.',inputSchema:{type:'object',properties:{command:{type:'string',maxLength:16000}},required:['command'],additionalProperties:false}},
];
type Approve=(kind:'command'|'file',details:string,signal:AbortSignal)=>Promise<boolean>;
export class ApiLocalTools {
  private service?:Promise<OwnerFileService>;
  private generation=randomUUID();
  constructor(private controlPaths:string[]){}
  private files(){return this.service??=OwnerFileService.create({ownerId:'local-owner',deviceId:'local-device',generation:this.generation,controlPaths:this.controlPaths,verifyOwner:process.platform==='win32'?verifyCurrentWindowsOwner:undefined,expectedUid:process.getuid?.(),maxBytes:1_000_000});}
  async call(session:Session,name:string,args:Record<string,unknown>,signal:AbortSignal,approve:Approve,current:()=>Session=()=>session):Promise<unknown>{
    signal.throwIfAborted();
    const writing=name==='write_file'||name==='run_command';
    if(writing&&['read-only','plan'].includes(session.permissionMode??'default'))throw Error('READ_ONLY: This session does not permit modifications or commands.');
    const definition=apiLocalToolDefinitions.find(item=>item.name===name);if(!definition)throw Error('UNKNOWN_TOOL');
    const props=definition.inputSchema.properties as Record<string,unknown>;
    if(Object.keys(args).some(key=>!Object.hasOwn(props,key)))throw Error('INVALID_ARGUMENT: Unexpected fields.');
    for(const key of definition.inputSchema.required as string[])if(typeof args[key]!=='string')throw Error('INVALID_ARGUMENT: Required string is missing.');
    if(name==='run_command'){
      if(!String(args.command).trim()||String(args.command).length>16000)throw Error('INVALID_COMMAND');
      if(!await approve('command',JSON.stringify({cwd:session.projectPath||os.homedir(),command:args.command},null,2),signal))return {status:'declined',executed:false};
      signal.throwIfAborted();if(['read-only','plan'].includes(current().permissionMode??'default'))throw Error('READ_ONLY: Permissions changed before command execution.');return runApiCommand(String(args.command),session.projectPath||os.homedir(),signal);
    }
    const files=await this.files(),grant=files.issueGrant({expiresAt:new Date(Date.now()+10*60_000).toISOString(),operations:writing?['read','write']:['read']});
    const context:FileContext={grantId:grant.id,ownerId:grant.ownerId,deviceId:grant.deviceId,generation:grant.generation,sessionId:session.id,workspaceId:session.projectId??'projectless',operationId:randomUUID(),os:process.platform};
    const target=String(args.path);if(!target||target.includes('\0'))throw Error('INVALID_PATH');
    const absolute=path.isAbsolute(target)?target:path.resolve(session.projectPath||os.homedir(),target);
    if(name==='read_file'){const offset=args.offset??0,limit=args.limit??16000;if(!Number.isSafeInteger(offset)||(offset as number)<0||!Number.isSafeInteger(limit)||(limit as number)<1||(limit as number)>32000)throw Error('INVALID_READ_RANGE');const result=await files.read(context,absolute);return {...result,content:result.content.slice(offset as number,(offset as number)+(limit as number)),offset,totalCharacters:result.content.length,truncated:(offset as number)>0||result.content.length>(limit as number)};}
    if(name==='list_directory')return files.list(context,absolute);
    const preview=await files.prepareWrite(context,absolute,String(args.version),String(args.content));
    if(current().permissionMode!=='full-access'&&!await approve('file',JSON.stringify({path:absolute,expectedVersion:args.version,content:args.content},null,2),signal))return {status:'declined',written:false};
    signal.throwIfAborted();if(['read-only','plan'].includes(current().permissionMode??'default'))throw Error('READ_ONLY: Permissions changed before file execution.');files.confirmWrite(preview.id,preview.bindingHash);
    try{return await files.write(context,preview.id,preview.bindingHash);}catch(error){if(typeof (error as any)?.code==='string'&&/^(ACCESS_DENIED|INVALID_APPROVAL|VERSION_CONFLICT|WRITE_BUSY|PATH_CHANGED|OTHER_OWNER|CONTROL_PLANE_DENIED|UNSUPPORTED_FILE|FILE_TOO_LARGE)$/.test((error as any).code))throw error;throw Object.assign(Error('FILE_WRITE_OUTCOME_UNCERTAIN'),{code:'RESULT_UNCERTAIN'});}
  }
}
/** User-approved, bounded child process; never inherits provider keys or authentication variables. */
export function runApiCommand(command:string,cwd:string,signal:AbortSignal):Promise<unknown>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const executable=process.platform==='win32'?path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'):'/bin/sh';
    const args=process.platform==='win32'?['-NoLogo','-NoProfile','-NonInteractive','-Command',command]:['-c',command];
    const child=spawn(executable,args,{cwd,env:buildSshEnvironment(),windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    const outDecoder=new StringDecoder('utf8'),errDecoder=new StringDecoder('utf8');
    let stdout='',stderr='',bytes=0,settled=false,stopping=false,closed=false,killConfirmed=false,cleanupTimer:ReturnType<typeof setTimeout>|undefined;
    const finish=(error?:Error,code?:number|null)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(cleanupTimer);signal.removeEventListener('abort',abort);error?reject(error):resolve({exitCode:code,stdout:stdout+outDecoder.end(),stderr:stderr+errDecoder.end()});};
    const stop=()=>{if(stopping||settled)return;stopping=true;if(!child.pid){finish(Error('COMMAND_CANCELLED'));return;}
      cleanupTimer=setTimeout(()=>finish(Error('COMMAND_CLEANUP_UNCERTAIN')),5000);
      if(process.platform==='win32'){const killer=spawn(path.join(process.env.SystemRoot??'C:\\Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',()=>finish(Error('COMMAND_CLEANUP_UNCERTAIN')));killer.once('close',code=>{if(code!==0)finish(Error('COMMAND_CLEANUP_UNCERTAIN'));else{killConfirmed=true;if(closed)finish(Object.assign(Error('COMMAND_STOPPED'),{code:'RESULT_UNCERTAIN'}));}});}
      else {try{process.kill(-child.pid,'SIGKILL');killConfirmed=true;if(closed)finish(Object.assign(Error('COMMAND_STOPPED'),{code:'RESULT_UNCERTAIN'}));}catch{finish(Error('COMMAND_CLEANUP_UNCERTAIN'));}}
    };
    const abort=()=>stop(),timer=setTimeout(stop,120000);signal.addEventListener('abort',abort,{once:true});
    const chunk=(value:Buffer,err:boolean)=>{bytes+=value.length;if(bytes>1_000_000){stop();return;}if(err)stderr+=errDecoder.write(value);else stdout+=outDecoder.write(value);};
    child.stdout.on('data',value=>chunk(value,false));child.stderr.on('data',value=>chunk(value,true));
    child.once('error',()=>finish(Error('COMMAND_START_FAILED')));child.once('close',code=>{closed=true;if(!stopping)finish(undefined,code);else if(killConfirmed)finish(Object.assign(Error('COMMAND_STOPPED'),{code:'RESULT_UNCERTAIN'}));});
    if(signal.aborted)stop();
  });
}
