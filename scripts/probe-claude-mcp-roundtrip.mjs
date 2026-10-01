// Installed official CLI, synthetic model endpoint and synthetic local files only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ClaudeBridgeService} from '../services/claude-bridge/index.ts';
import {ClaudeToolMcpSession} from '../services/claude-bridge/tools.ts';
import {openNativeGateway} from '../packages/model-api/native-gateway.ts';
import {nativeWireEvents} from '../packages/model-api/native-wire.ts';
import {ProcessSupervisor} from '../services/remote-supervisor/index.ts';

const executable=process.env.AWB_QA_CLAUDE;
assert.ok(executable&&path.isAbsolute(executable),'An explicit official CLI executable is required.');
const root=path.resolve('build/qa/claude-mcp-hardening-20261001/roundtrip-'+Date.now()),home=path.join(root,'home'),cwd=path.join(home,'project');
await mkdir(cwd,{recursive:true});
const marker='MCP_FIXTURE_'+randomUUID();
const fixtures=['json','ini','log'].map(extension=>({path:path.join(cwd,'fixture.'+extension),text:(extension==='json'?JSON.stringify({marker,data:'fixture data '.repeat(300)}):marker+'\n'+'fixture data\n'.repeat(300))}));
for(const file of fixtures)await writeFile(file.path,file.text);
const png=path.join(cwd,'fixture.png');await writeFile(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64'));
const report={scope:'Installed official CLI and local MCP, synthetic upstream only; no SSH, credentials or real model request.',success:false,realModelRequests:0,requests:0,checks:[],toolResultBytes:[]};
let tools,gateway,child,completed,fail;
const outcome=new Promise((resolve,reject)=>{completed=resolve;fail=reject;});outcome.catch(()=>{});
const server=createServer(async(req,res)=>{
 try{
  if(!req.url?.split('?')[0].endsWith('/v1/messages')){res.writeHead(404).end();return;}
  let raw='';for await(const bytes of req)raw+=bytes;const body=JSON.parse(raw);report.requests++;
  assert.ok(report.requests<=3,'Unexpected synthetic model continuation');
  const names=body.tools.map(t=>t.name),read=names.find(n=>n==='mcp__local_device__Read'),range=names.find(n=>n==='mcp__local_device__ReadLocalToolResult');assert.ok(read&&range,'Actual MCP tool names must reach the native model request');
  let calls=[],text='';
  const results=body.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(c=>c.type==='tool_result'):[]);
  if(report.requests===1){
   calls=[...fixtures.map((file,i)=>({id:'read_'+i,name:read,arguments:JSON.stringify({file_path:file.path})})),{id:'image',name:read,arguments:JSON.stringify({file_path:png})}];
  }else if(report.requests===2){
   for(let i=0;i<fixtures.length;i++){
    const result=results.find(r=>r.tool_use_id==='read_'+i);assert.ok(result&&!result.is_error,'File tool result must succeed');const text=typeof result.content==='string'?result.content:result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
    // Observe the native CLI representation instead of assuming structuredContent is duplicated.
    report.toolResultBytes.push(Buffer.byteLength(text));const descriptor=JSON.parse(text);assert.ok(descriptor.output?.id);calls.push({id:'page_'+i,name:range,arguments:JSON.stringify({id:descriptor.output.id,maxBytes:65536})});
   }
   const image=results.find(r=>r.tool_use_id==='image');assert.ok(Array.isArray(image?.content)&&image.content.some(c=>c.type==='image'));
   assert.ok(image.content.filter(c=>c.type==='text').every(c=>!c.text.includes('iVBOR')));report.checks.push('native-image-content','large-result-handles');
  }else{
   for(let i=0;i<fixtures.length;i++){const result=results.find(r=>r.tool_use_id==='page_'+i);assert.ok(result&&!result.is_error);assert.ok(JSON.stringify(result.content).includes(marker));}
   report.checks.push('json-ini-log-range-results','native-tool-result-roundtrip');text='SYNTHETIC_MCP_ROUNDTRIP_OK';
  }
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  for(const event of nativeWireEvents({text,calls,usage:{inputTokens:10,outputTokens:10},raw:{}},'anthropic-messages',body))res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
 }catch(error){report.error=error.message;res.writeHead(500).end();fail(error);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:process.env.PATH,TEMP:root,TMP:root,HOME:home,USERPROFILE:home,APPDATA:path.join(home,'appdata'),LOCALAPPDATA:path.join(home,'localappdata'),CLAUDE_CONFIG_DIR:path.join(home,'claude'),ANTHROPIC_CONFIG_DIR:path.join(home,'anthropic'),ANTHROPIC_API_KEY:'synthetic-no-inference',ANTHROPIC_BASE_URL:'http://127.0.0.1:'+server.address().port,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL:'1',CLAUDE_CODE_DISABLE_AUTO_MEMORY:'1',DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_USE_POWERSHELL_TOOL:'1'};
let timer;
try{
 tools=await new ClaudeBridgeService(root).openTools({executable,directory:path.join(root,'profiles'),cwd,env,signal:new AbortController().signal,policy:{inlineBytes:1024}});
 gateway=await openNativeGateway({runtime:'claude',model:{id:'fixture',name:'Fixture',model:'fixture',enabled:true},mcpOnly:true,credentials:async()=>{throw Error('Model proxy forbidden');},mcp:()=>new ClaudeToolMcpSession(tools,()=> 'plan',()=>{})});
 const config={mcpServers:{local_device:{type:'http',url:gateway.baseUrl+'/mcp',headers:{Authorization:'Bearer '+gateway.token}}}};
 child=new ProcessSupervisor({executable,args:['--print','--verbose','--input-format','stream-json','--output-format','stream-json','--model','fixture-mcp','--tools','','--allowedTools','mcp__local_device__Read,mcp__local_device__ReadLocalToolResult','--strict-mcp-config','--mcp-config',JSON.stringify(config),'--setting-sources','','--settings','{"autoMemoryEnabled":false}','--disable-slash-commands'],cwd,env});
 child.on('fault',fail);child.on('frame',({value})=>{if(value.type==='result'){if(value.is_error)fail(Error('Native synthetic roundtrip failed'));else completed(value);}});
 child.on('disconnect',()=>fail(Error('Native CLI disconnected before its final receipt')));
 timer=setTimeout(()=>fail(Error('Synthetic roundtrip timed out')),45000);
 await child.start();await child.write({type:'user',uuid:randomUUID(),session_id:'',parent_tool_use_id:null,message:{role:'user',content:'Read only the synthetic fixture files using the registered local_device MCP tools, then report completion in English.'}});
 const result=await outcome;assert.match(result.result,/SYNTHETIC_MCP_ROUNDTRIP_OK/);assert.equal(report.requests,3);
 const pidFile=path.join(cwd,'owned.pid'),script=path.join(cwd,'owned.cjs');
 await writeFile(script,`require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setTimeout(()=>{},60000);`);
 const shell=tools.definitions.some(t=>t.name==='Bash')?'Bash':'PowerShell';
 const quote=value=>"'"+value.replaceAll('\\','/').replaceAll("'",shell==='Bash'?"'\\''":"''")+"'";
 const cancel=new AbortController(),pending=tools.call(shell,{command:(shell==='PowerShell'?'& ':'')+quote(process.execPath)+' '+quote(script),timeout:120000},cancel.signal);pending.catch(()=>{});
 for(let i=0;;i++){try{await access(pidFile);break;}catch{if(i>200)throw Error('Owned command did not start');await delay(50);}}
 const pid=Number(await readFile(pidFile,'utf8'));assert.ok(Number.isSafeInteger(pid)&&pid>0);
 const parallel=tools.call('Read',{file_path:fixtures[0].path});cancel.abort();await assert.rejects(pending,/CANCELLED|DISCONNECTED/);assert.notEqual((await parallel).isError,true);assert.throws(()=>process.kill(pid,0));
 assert.notEqual((await tools.call('Read',{file_path:fixtures[0].path})).isError,true);report.checks.push('owned-native-command-terminated','parallel-file-lane-survives-cancellation');report.success=true;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{clearTimeout(timer);await child?.stop('fixture-complete');await gateway?.close();await tools?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,report:path.join(root,'report.json')}));}
