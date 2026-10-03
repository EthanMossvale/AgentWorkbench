import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,open,writeFile,rm} from 'node:fs/promises';
import {StringDecoder} from 'node:string_decoder';
import {finished} from 'node:stream/promises';
import {buildSshEnvironment} from '../../../packages/ssh-transport';

export interface ApiCommandOptions { timeoutMs?:number; maxOutputBytes?:number }
export interface ApiCommandResult { exitCode:number|null; stdout:string; stderr:string; stdoutPath:string; stderrPath:string; stdoutBytes:number; stderrBytes:number; truncated:boolean }
export interface ApiCommandExecutor { id:`plugin:${string}`; execute(command:string,cwd:string,signal:AbortSignal,options:ApiCommandOptions):Promise<unknown>|undefined }
/** Capture every output byte on disk. Inline capacity controls delivery, never process lifetime. */
export async function runApiCommand(command:string,cwd:string,signal:AbortSignal,options:ApiCommandOptions={},directory=path.join(os.tmpdir(),'agentworkbench-command-results')):Promise<ApiCommandResult>{
  signal.throwIfAborted();const timeout=options.timeoutMs??0,inline=options.maxOutputBytes??16000;
  if(!Number.isSafeInteger(timeout)||timeout<0||!Number.isSafeInteger(inline)||inline<0)throw Error('INVALID_COMMAND_OPTIONS');
  await mkdir(directory,{recursive:true});const root=await mkdtemp(path.join(directory,'command-')),script=path.join(root,process.platform==='win32'?'command.ps1':'command.sh'),stdoutPath=path.join(root,'stdout.txt'),stderrPath=path.join(root,'stderr.txt');
  await writeFile(script,(process.platform==='win32'?'\ufeff':'')+command,{mode:0o600});
  let outFile,errFile;
  try{outFile=await open(stdoutPath,'wx',0o600);errFile=await open(stderrPath,'wx',0o600);signal.throwIfAborted();}
  catch(error){await outFile?.close();await errFile?.close();await rm(script,{force:true});throw error;}
  const outStream=outFile.createWriteStream(),errStream=errFile.createWriteStream();
  try{return await new Promise<ApiCommandResult>((resolve,reject)=>{
    const executable=process.platform==='win32'?path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'):'/bin/sh';
    const args=process.platform==='win32'?['-NoLogo','-NonInteractive','-File',script]:[script];
    const child=spawn(executable,args,{cwd,env:buildSshEnvironment(),windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    const outDecoder=new StringDecoder('utf8'),errDecoder=new StringDecoder('utf8');
    let stdout='',stderr='',stdoutBytes=0,stderrBytes=0,settled=false,stopping=false,closed=false,killConfirmed=false,cleanupTimer:ReturnType<typeof setTimeout>|undefined,timer:ReturnType<typeof setTimeout>|undefined,deliveryError:unknown;
    const output=()=>({stdout:stdout+(stdoutBytes<=inline?outDecoder.end():''),stderr:stderr+(stderrBytes<=inline?errDecoder.end():''),stdoutPath,stderrPath,stdoutBytes,stderrBytes,truncated:stdoutBytes>inline||stderrBytes>inline});
    const drains=[finished(outStream),finished(errStream)];
    const finish=(error?:Error,code:number|null=null)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(cleanupTimer);signal.removeEventListener('abort',abort);void Promise.allSettled(drains).then(()=>{const result=output();const fault=error??(deliveryError?Object.assign(Error('COMMAND_OUTPUT_WRITE_FAILED'),{code:'RESULT_UNCERTAIN'}):undefined);fault?reject(Object.assign(fault,{output:result})):resolve({exitCode:code,...result});});};
    const stop=()=>{if(stopping||settled)return;stopping=true;if(!child.pid){outStream.end();errStream.end();finish(Error('COMMAND_CANCELLED'));return;}
      cleanupTimer=setTimeout(()=>{outStream.destroy();errStream.destroy();finish(Error('COMMAND_CLEANUP_UNCERTAIN'));},5000);
      if(process.platform==='win32'){const killer=spawn(path.join(process.env.SystemRoot??'C:\\Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',()=>{outStream.destroy();errStream.destroy();finish(Error('COMMAND_CLEANUP_UNCERTAIN'));});killer.once('close',code=>{if(code!==0){outStream.destroy();errStream.destroy();finish(Error('COMMAND_CLEANUP_UNCERTAIN'));}else{killConfirmed=true;if(closed)finish(Object.assign(Error('COMMAND_STOPPED'),{code:'RESULT_UNCERTAIN'}));}});}
      else {try{process.kill(-child.pid,'SIGKILL');killConfirmed=true;if(closed)finish(Object.assign(Error('COMMAND_STOPPED'),{code:'RESULT_UNCERTAIN'}));}catch{outStream.destroy();errStream.destroy();finish(Error('COMMAND_CLEANUP_UNCERTAIN'));}}
    };
    const abort=()=>stop(),deadline=Date.now()+timeout;const scheduleTimeout=()=>{const remaining=deadline-Date.now();if(remaining<=0)stop();else timer=setTimeout(scheduleTimeout,Math.min(remaining,2147483647));};if(timeout)scheduleTimeout();signal.addEventListener('abort',abort,{once:true});
    for(const drain of drains)void drain.catch(error=>{deliveryError=error;stop();});
    child.stdout.on('data',(value:Buffer)=>{const remaining=Math.max(0,inline-stdoutBytes);stdoutBytes+=value.length;if(remaining)stdout+=outDecoder.write(value.subarray(0,remaining));});
    child.stderr.on('data',(value:Buffer)=>{const remaining=Math.max(0,inline-stderrBytes);stderrBytes+=value.length;if(remaining)stderr+=errDecoder.write(value.subarray(0,remaining));});
    child.stdout.pipe(outStream);child.stderr.pipe(errStream);
    child.once('error',error=>{outStream.end();errStream.end();finish(Error('COMMAND_START_FAILED: '+error.message));});child.once('close',code=>{closed=true;if(!stopping)finish(undefined,code);else if(killConfirmed)finish(Object.assign(Error('COMMAND_STOPPED'),{code:'RESULT_UNCERTAIN'}));});
    if(signal.aborted)stop();
  });}finally{await rm(script,{force:true});}
}
