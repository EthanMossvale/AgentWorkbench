// Installed official tool process only. No model turns or SSH; disposable native home.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ClaudeBridgeService} from '../services/claude-bridge/index.ts';
const executable=process.env.AWB_QA_CLAUDE;assert.ok(executable);
const root=path.resolve('build/qa/claude-model-surface/'+Date.now()),home=path.join(root,'home'),cwd=path.join(home,'project');await mkdir(cwd,{recursive:true});
const env={...process.env,HOME:home,USERPROFILE:home,CLAUDE_CONFIG_DIR:path.join(home,'.claude'),APPDATA:path.join(home,'AppData/Roaming'),LOCALAPPDATA:path.join(home,'AppData/Local'),HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1'};
await writeFile(path.join(cwd,'CLAUDE.md'),'Synthetic local instructions.');
const options={executable,cwd,directory:path.join(root,'profiles'),env,signal:new AbortController().signal,sessionId:'synthetic',permission:()=> 'full-access'},bridge=new ClaudeBridgeService(root),checks=[];let raw,tools;
try{
 raw=await bridge.openTools(options);tools=await bridge.openModelTools(raw,options);
 const definitions=await tools.listTools();assert.ok(definitions.find(t=>t.name==='PowerShell'),'Native foreground PowerShell');assert.ok(definitions.find(t=>t.name==='Read')._meta['anthropic/alwaysLoad']);
 const rendered=async(name,args)=>{const r=await tools.call(name,args);assert.ok(!r.isError,JSON.stringify(r));return r.content.filter(v=>v.type==='text').map(v=>v.text).join('\n');};
 const file=path.join(cwd,'fixture.txt');await writeFile(file,'old value\n');assert.match(await rendered('Read',{file_path:file}),/1\told value/);
 assert.doesNotMatch(await rendered('Edit',{file_path:file,old_string:'old value',new_string:'new value'}),/originalFile/);assert.equal(await readFile(file,'utf8'),'new value\n');checks.push('native Read and Edit rendered as text');
 for(const shell of ['Bash','PowerShell']){
  assert.match(await rendered(shell,{command:shell==='Bash'?'printf FOREGROUND_OK':"Write-Output 'FOREGROUND_OK'"}),/FOREGROUND_OK/);
  const command=shell==='Bash'?"printf 'EARLY\\n'; sleep 2; printf 'LATE\\n'":"Write-Output 'EARLY'; Start-Sleep -Seconds 2; Write-Output 'LATE'";
  const started=await raw.call('StartLocalCommand',{requestId:shell,command,shell,timeout:10000}),task=JSON.parse(started.content[0].text);let early=false,final;
  for(let n=0;n<100;n++){await delay(50);const value=await raw.call('LocalTaskOutput',{taskId:task.id,tailLines:10});final=JSON.parse(value.content[0].text);if(final.state==='running'&&final.progress?.tail.includes('EARLY'))early=true;if(['completed','failed','cancelled'].includes(final.state))break;}
  assert.ok(early,shell+' incremental output');assert.equal(final.state,'completed',JSON.stringify(final));assert.match(JSON.stringify(final.result),/LATE/);checks.push(shell+' foreground and incremental background output');
 }
 assert.match(await rendered('LocalContext',{includeContents:true}),/Synthetic local instructions/);checks.push('local instruction retrieval for subagents');
 console.log(JSON.stringify({checks,paidRequests:0,root}));
}finally{await tools?.close();if(!tools)await raw?.close();await writeFile(path.join(root,'report.json'),JSON.stringify({checks,scope:'Official local tool process; synthetic files/home; no model turn or live SSH'},null,2));}
