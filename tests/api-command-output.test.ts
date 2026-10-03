import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ApiLocalTools} from '../apps/desktop/host/api-local-tools';
import {runApiCommand} from '../apps/desktop/host/api-command';
const large=process.platform==='win32'?"[Console]::Write(('x' * 1100000));[Console]::Error.Write('stderr');[Console]::Write('END')":"head -c 1100000 /dev/zero | tr '\\0' x; printf stderr >&2; printf END";
test('long command text and large output complete with exact disk output and a configurable preview',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-command-output-'));try{
  const command='#'+'long source '.repeat(6000)+'\n'+large,result=await runApiCommand(command,root,new AbortController().signal,{maxOutputBytes:113},root);
  assert.equal(result.exitCode,0);assert.equal(result.stdout,'x'.repeat(113));assert.equal(result.stdoutBytes,1100003);assert.equal(result.stderr,'stderr');assert.equal(result.truncated,true);assert.equal(await readFile(result.stdoutPath,'utf8'),'x'.repeat(1100000)+'END');assert.equal(await readFile(result.stderrPath,'utf8'),'stderr');assert.deepEqual((await readdir(path.dirname(result.stdoutPath))).sort(),['stderr.txt','stdout.txt']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('explicit timeout cleans up the owned command and leaves readable partial output',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-command-timeout-'));try{
  const command=process.platform==='win32'?"[Console]::Write('before-timeout');Start-Sleep -Seconds 30":"printf before-timeout; sleep 30";
  let stopped:any;try{await runApiCommand(command,root,new AbortController().signal,{timeoutMs:1500},root);assert.fail('should stop');}catch(error){stopped=error;}assert.match(stopped.message,/COMMAND_STOPPED|COMMAND_CLEANUP_UNCERTAIN/);assert.equal(await readFile(stopped.output.stdoutPath,'utf8'),'before-timeout');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('disabling an executor during a command never starts a second implementation',async()=>{
 const tools=new ApiLocalTools([]);let complete!:(value:unknown)=>void,executions=0;
 const dispose=tools.registerCommandExecutor({id:'plugin:fixture/executor',execute:()=>{executions++;return new Promise(resolve=>{complete=resolve;});}});
 const pending=tools.executeCommand('unused',os.tmpdir(),new AbortController().signal);dispose();complete({stdout:'owned-completion'});assert.deepEqual(await pending,{stdout:'owned-completion'});assert.equal(executions,1);
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-long-timeout-'));try{const result=await runApiCommand('echo completed',root,new AbortController().signal,{timeoutMs:3000000000},root);assert.equal(result.exitCode,0);assert.match(result.stdout,/completed/);}finally{await rm(root,{recursive:true,force:true});}
});
