// Explicit local executable; synthetic files, official MCP tools and control metadata only.
// No user/model message, SSH, real credential read or production profile modification.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ClaudeBridgeService} from '../services/claude-bridge/index.ts';
import {ClaudeToolMcpSession} from '../services/claude-bridge/tools.ts';
import {openNativeGateway} from '../packages/model-api/native-gateway.ts';
const executable=process.env.AWB_QA_CLAUDE;
if(!executable||!path.isAbsolute(executable))throw Error('Set AWB_QA_CLAUDE to the explicit official local executable.');
const root=path.resolve('build/qa/claude-capabilities/native-'+Date.now()),home=path.join(root,'home'),cwd=path.join(home,'project');
const put=async(file,text)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);return file;};
await mkdir(path.join(cwd,'.git'),{recursive:true});
await put(path.join(home,'.claude/settings.json'),JSON.stringify({autoMemoryDirectory:'~/fixture-memory'}));
await put(path.join(cwd,'CLAUDE.md'),'Synthetic fixture instructions. Work only in this fixture.');
const memory=path.join(home,'fixture-memory');await put(path.join(memory,'MEMORY.md'),'[Fixture](fixture.md)\n');await put(path.join(memory,'fixture.md'),'Initial synthetic memory.\n');
const skill=path.join(cwd,'.claude/skills/fixture'),script=await put(path.join(skill,'scripts','fixture.mjs'),"console.log('DYNAMIC_LOCAL_OK');\n");
const quote=value=>"'"+value.replaceAll('\\','/').replaceAll("'","'\\''")+"'";
const command=quote(process.execPath)+' '+quote(script),powershellCommand="Write-Output 'DYNAMIC_LOCAL_OK'";
await put(path.join(skill,'SKILL.md'),'---\nname: fixture\ndescription: Synthetic local skill\narguments: [topic]\nshell: powershell\n---\nFull local instructions for $topic.\nSupport: ${CLAUDE_SKILL_DIR}/scripts/fixture.mjs\nDynamic: !`'+powershellCommand+'`\n');
await put(path.join(cwd,'.claude/commands/check.md'),'---\ndescription: Fixture legacy command\n---\nLegacy command $ARGUMENTS\n');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIREAAAACMfqXhhDYCeRzS5M+O/PeDwAAAAAAAAAAAAAAAAAAAC9gV9H4aud2m8EAAAAASUVORK5CYII=','base64'),imageFile=await put(path.join(cwd,'fixture.png'),png);
const env={...process.env,HOME:home,USERPROFILE:home,CLAUDE_CONFIG_DIR:path.join(home,'.claude'),APPDATA:path.join(home,'AppData/Roaming'),LOCALAPPDATA:path.join(home,'AppData/Local'),CLAUDE_CODE_USE_POWERSHELL_TOOL:'1',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1'};
for(const key of ['CLAUDE_CODE_DISABLE_AUTO_MEMORY','CLAUDE_CODE_PROJECT_DIR_NAME'])delete env[key];
const report={scope:'Actual official local tools through the production ClaudeBridgeService and HTTP gateway; synthetic home/files only. No model turns, SSH or deployment.',success:false,checks:[]};
let tools,gateway;let mode='default';
try{
 tools=await new ClaudeBridgeService(root).openTools({executable,cwd,directory:path.join(root,'profiles'),env,signal:new AbortController().signal});
 gateway=await openNativeGateway({runtime:'claude',model:{id:'unused',name:'Unused',model:'unused',enabled:true},mcpOnly:true,credentials:async()=>{throw Error('Model requests forbidden');},mcp:()=>new ClaudeToolMcpSession(tools,()=>mode,()=>{})});
 let session,id=0;const post=async(method,params,notification=false)=>{const r=await fetch(gateway.baseUrl+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+gateway.token,'Content-Type':'application/json',...(session?{'Mcp-Session-Id':session}:{})},body:JSON.stringify({jsonrpc:'2.0',...(!notification?{id:++id}:{}),method,params})});assert.ok(r.ok);session??=r.headers.get('Mcp-Session-Id');if(r.status===202)return;const value=await r.json();assert.ok(!value.error,JSON.stringify(value));return value.result;};
 const call=async(name,args)=>{const result=await post('tools/call',{name,arguments:args});assert.notEqual(result.isError,true,JSON.stringify(result));return result;};
 const json=result=>JSON.parse(result.content[0].text);
 const initialized=await post('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'synthetic-context-audit',version:'1'}});assert.ok(initialized.capabilities.prompts);await post('notifications/initialized',{},true);
 const image=await call('Read',{file_path:imageFile});assert.ok(image.content.some(c=>c.type==='image'&&c.mimeType==='image/png'&&Buffer.from(c.data,'base64').equals(png)));report.checks.push('actual-image-content');
 const catalog=json(await call('LocalContext',{}));assert.equal(catalog.memory.directory,memory);assert.equal(catalog.memory.files.length,2);assert.ok(catalog.instructions.some(i=>i.path===path.join(cwd,'CLAUDE.md')));report.checks.push('scoped-native-memory-discovery');
 const memoryFile=path.join(memory,'fixture.md');await call('Read',{file_path:memoryFile});await call('Edit',{file_path:memoryFile,old_string:'Initial synthetic memory.',new_string:'Updated synthetic memory.'});assert.match(await readFile(memoryFile,'utf8'),/Updated synthetic/);await call('Read',{file_path:memoryFile});
 const newFile=path.join(memory,'new-topic.md');await call('Write',{file_path:newFile,content:'New synthetic topic.\n'});await call('Read',{file_path:newFile});await call('Read',{file_path:path.join(memory,'MEMORY.md')});await call('Edit',{file_path:path.join(memory,'MEMORY.md'),old_string:'[Fixture](fixture.md)',new_string:'[Fixture](fixture.md)\n[New topic](new-topic.md)'});await call('Read',{file_path:path.join(memory,'MEMORY.md')});assert.equal(json(await call('LocalContext',{})).memory.files.length,3);report.checks.push('official-memory-read-edit-write-readback');
 const entry=catalog.skills.find(s=>s.name==='fixture'),request={id:entry.id,hash:entry.hash,arguments:'topic'};let plan=json(await call('LoadLocalSkill',request));assert.match(plan.instructions,/Full local instructions for topic/);assert.ok(plan.instructions.includes(skill));assert.equal(plan.commands[0].completed,false);
 mode='plan';const denied=await post('tools/call',{name:'RunLocalSkillCommand',arguments:{...request,index:0,command:powershellCommand}});assert.equal(denied.isError,true);mode='default';
 await call('RunLocalSkillCommand',{...request,index:0,command:powershellCommand});plan=json(await call('LoadLocalSkill',request));assert.equal(plan.commands[0].completed,true);assert.equal(plan.commands[0].shell,'powershell');assert.match(plan.instructions,/DYNAMIC_LOCAL_OK/);report.checks.push('full-skill-arguments-support-script-and-powershell-output');
 const prompts=await post('prompts/list');assert.equal(prompts.prompts.length,2);const legacy=catalog.skills.find(s=>s.name==='check');const prompt=await post('prompts/get',{name:'skill_'+legacy.id,arguments:{arguments:'value'}});assert.match(prompt.messages[0].content.text,/Legacy command value/);report.checks.push('native-mcp-prompts-and-legacy-command');
 const names=(await post('tools/list')).tools.map(t=>t.name);assert.ok(!names.includes('Agent')&&!names.includes('Skill'));assert.ok(names.includes('StartLocalCommand')&&names.includes('LocalTaskOutput')&&names.includes('StopLocalTask'));
 report.commands={};for(const name of ['Bash','PowerShell'])if(names.includes(name))report.commands[name]=await call(name,{command:name==='Bash'?'printf "LOCAL_SHELL_OK\\n"; pwd':"Write-Output 'LOCAL_SHELL_OK'; (Get-Location).Path",timeout:600000,description:'Verify the synthetic local shell'});report.checks.push('foreground-local-shells');
 if(names.includes('PowerShell')){const started=json(await call('StartLocalCommand',{requestId:'synthetic-async',shell:'PowerShell',command:"Start-Sleep -Milliseconds 100; Write-Output 'LOCAL_ASYNC_OK'",timeout:600000,description:'Verify owned asynchronous local task'}));assert.equal(started.state,'running');const finished=json(await call('LocalTaskOutput',{taskId:started.id,waitMs:2000}));assert.equal(finished.state,'completed');assert.match(JSON.stringify(finished.result),/LOCAL_ASYNC_OK/);report.checks.push('owned-asynchronous-local-task-output');}
 const failure=await post('tools/call',{name:'Bash',arguments:{command:'exit 7',description:'Synthetic nonzero exit'}});assert.equal(failure.isError,true);report.checks.push('nonzero-command-failure-preserved');
 const modelEndpoint=await fetch(gateway.baseUrl+'/v1/messages',{method:'POST',headers:{Authorization:'Bearer '+gateway.token,'Content-Type':'application/json'},body:'{}'});assert.equal(modelEndpoint.status,404);report.checks.push('no-local-model-route');report.success=true;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{await gateway?.close();await tools?.close().catch(error=>{report.cleanupError=error.message;report.success=false;process.exitCode=1;});await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:path.join(root,'report.json'),success:report.success,checks:report.checks,error:report.error}));}
