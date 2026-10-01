// Explicit native executable only. Tool calls and metadata only; no user/model input.
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {openOfficialClaudeTools} from '../services/claude-bridge/tools.ts';
const executable=process.env.AWB_QA_CLAUDE;
if(!executable||!path.isAbsolute(executable))throw Error('Set AWB_QA_CLAUDE to the explicit official local executable.');
const root=path.resolve('build/qa/claude-mcp/native-tools-'+Date.now());await mkdir(root,{recursive:true});
const controller=new AbortController(),env={...process.env,CLAUDE_CODE_USE_POWERSHELL_TOOL:'1',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1'};
const report={scope:'Official local file/command tools; isolated Claude configuration and synthetic closed-loopback model endpoint. No SSH or model turn.',checks:[],success:false};
let tools;
try{
 tools=await openOfficialClaudeTools({executable,directory:path.join(root,'profiles'),cwd:root,env,signal:controller.signal});
 report.tools=tools.definitions.map(t=>t.name);assert.ok(!report.tools.includes('Agent'));assert.ok(!report.tools.includes('WebFetch'));
 const file=path.join(root,'fixture.txt');
 const call=async(name,args)=>{const value=await tools.call(name,args);assert.notEqual(value?.isError,true,JSON.stringify(value));report.checks.push(name);return value;};
 await call('Write',{file_path:file,content:'BEFORE\n'});assert.equal(await readFile(file,'utf8'),'BEFORE\n');
 await call('Read',{file_path:file});await call('Edit',{file_path:file,old_string:'BEFORE',new_string:'AFTER'});assert.equal(await readFile(file,'utf8'),'AFTER\n');
 await call('Glob',{path:root,pattern:'fixture.txt'});await call('Grep',{path:file,pattern:'AFTER',output_mode:'content'});
 report.commands={};
 if(report.tools.includes('Bash'))report.commands.Bash=await call('Bash',{command:'printf "AWB_LOCAL_CWD\\n"; pwd',description:'Verify the actual local working directory'});
 if(report.tools.includes('PowerShell'))report.commands.PowerShell=await call('PowerShell',{command:"Write-Output 'AWB_LOCAL_CWD'; (Get-Location).Path",description:'Verify the actual local PowerShell working directory'});
 await assert.rejects(tools.call('Agent',{}),/FORBIDDEN/);report.checks.push('no-local-model-tools');
 // A real foreground command writes its PID before waiting; cancellation must terminate it.
 const pidFile=path.join(root,'command.pid').replaceAll('\\','/'),doneFile=path.join(root,'must-not-finish.txt').replaceAll('\\','/');
 const js=`require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(doneFile)},'unexpected'),60000)`;
 const commandTool=report.tools.includes('Bash')?'Bash':'PowerShell',script=path.join(root,'waiting-command.cjs').replaceAll('\\','/');await writeFile(script,js);
 const quote=s=>"'"+s.replaceAll("'",commandTool==='Bash'?"'\\''":"''")+"'";
 const abort=new AbortController();
 const pending=tools.call(commandTool,{command:(commandTool==='PowerShell'?'& ':'')+quote(process.execPath.replaceAll('\\','/'))+' '+quote(script),timeout:120000,description:'Isolated cancellation fixture'},abort.signal);pending.catch(()=>{});
 for(let i=0;;i++){try{await access(pidFile);break;}catch{if(i>200)throw Error('Command did not start');await delay(50);}}
 const pid=Number(await readFile(pidFile,'utf8'));assert.ok(Number.isSafeInteger(pid)&&pid>0);abort.abort();await assert.rejects(pending,/CANCELLED|DISCONNECTED/);await tools.close();
 assert.throws(()=>process.kill(pid,0));await assert.rejects(access(doneFile));report.checks.push('owned-command-process-terminated');report.success=true;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{await tools?.close().catch(error=>{report.cleanupError=error.message;report.success=false;process.exitCode=1;});await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:path.join(root,'report.json'),success:report.success,checks:report.checks,error:report.error}));}
