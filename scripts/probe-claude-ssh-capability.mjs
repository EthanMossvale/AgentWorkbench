// Capability probe only. Never sends user messages or changes a real CLI profile.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const output=path.resolve(process.env.AWB_QA_OUTPUT??'build/qa/claude-ssh-capability'),home=path.join(output,'probe-home-'+Date.now());
await mkdir(home,{recursive:true});
const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:process.env.PATH,TEMP:home,TMP:home,HOME:home,USERPROFILE:home,APPDATA:path.join(home,'appdata'),LOCALAPPDATA:path.join(home,'localappdata'),CLAUDE_CONFIG_DIR:path.join(home,'claude'),ANTHROPIC_CONFIG_DIR:path.join(home,'anthropic'),ANTHROPIC_API_KEY:'synthetic-no-inference',ANTHROPIC_BASE_URL:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL:'1',CLAUDE_CODE_DISABLE_AUTO_MEMORY:'1',DISABLE_AUTOUPDATER:'1'};
const exe=process.env.AWB_QA_CLAUDE;if(!exe)throw Error('Explicit isolated-probe CLI path is required.');
const version=await new Promise((resolve,reject)=>{const p=spawn(exe,['--version'],{env,cwd:home,windowsHide:true});let out='';p.stdout.on('data',d=>out+=d);p.on('error',reject);p.on('close',()=>resolve(out.trim()));});
const p=spawn(exe,['--print','--verbose','--input-format','stream-json','--output-format','stream-json','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands','--setting-sources','','--settings','{"autoMemoryEnabled":false}'],{env,cwd:home,windowsHide:true,stdio:['pipe','pipe','pipe']});
let buffer='',initialized=false;const messages=[],ids=[randomUUID(),randomUUID()];
const send=v=>{messages.push({direction:'in',type:v.type,subtype:v.request?.subtype});p.stdin.write(JSON.stringify(v)+'\n');};
const timer=setTimeout(()=>p.kill(),20000);
p.stdout.on('data',d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let v;try{v=JSON.parse(line);}catch{continue;}if(v.type!=='control_response')continue;const r=v.response;messages.push({direction:'out',type:v.type,subtype:r?.subtype,error:r?.error,keys:Object.keys(r?.response??{}),models:r?.response?.models?.map(m=>({value:m.value,displayName:m.displayName}))});if(r?.request_id===ids[0]&&!initialized){initialized=true;send({type:'control_request',request_id:ids[1],request:{subtype:'remote_tools_announce',instance_id:'fixture',host:{name:'fixture',kind:'local',platform:'windows',working_dir:home},tools:[]}});}else if(r?.request_id===ids[1])p.kill();}});
p.stderr.resume();send({type:'control_request',request_id:ids[0],request:{subtype:'initialize'}});
await new Promise(resolve=>p.once('close',resolve));clearTimeout(timer);
const report={version,scope:'Isolated local CLI; only initialize and remote_tools_announce control messages; no user messages or real account access; upstream and proxy restricted to closed loopback port',messages};await writeFile(path.join(output,'capability-probe.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
