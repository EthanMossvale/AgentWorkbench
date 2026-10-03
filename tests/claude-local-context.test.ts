import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import {claudeSkillAdapters} from '../services/claude-bridge/skill-adapters';
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,writeFile,rm,readFile,symlink} from 'node:fs/promises';
import {LocalClaudeContext,withClaudeLocalContext} from '../services/claude-bridge/local-context';
import {ClaudeToolMcpSession,type ClaudeToolServer} from '../services/claude-bridge/tools';
import {normalizeClaudeToolResult} from '../services/claude-bridge/results';
import type {PermissionMode} from '../packages/contracts';

async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-local-context-')),home=root,cwd=path.join(root,'project'),claude=path.join(home,'.claude');
 const put=async(file:string,text:string)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);return file;};
 await mkdir(path.join(cwd,'.git'),{recursive:true});await mkdir(home,{recursive:true});
 const options={cwd,env:{HOME:home,USERPROFILE:home},executable:'never-spawn',directory:root,signal:new AbortController().signal};
 const context=new LocalClaudeContext(options);let calls:any[]=[],closed=0;
 const native:ClaudeToolServer={definitions:['Read','Write','Bash','PowerShell'].map(name=>({name,inputSchema:{type:'object'}})),async call(name,args){calls.push({name,args});return {content:[{type:'text',text:JSON.stringify({stdout:'DYNAMIC_FIXTURE',exitCode:0})}]};},async close(){closed++;}};
 const tools=withClaudeLocalContext(native,context);
 const skill=async(name:string,body:string,front='description: Fixture')=>put(path.join(cwd,'.claude','skills',name,'SKILL.md'),'---\n'+front+'\n---\n'+body);
 const get=async(name:string)=>{const s=(await context.discover()).skills.find(s=>s.name===name);assert.ok(s);return {id:s.id,hash:s.hash};};
 return {root,home,cwd,claude,put,skill,get,options,context,tools,native,calls,get closed(){return closed;},async close(){await tools.close();await rm(root,{recursive:true,force:true});}};
}
const parsed=(result:any)=>JSON.parse(result.content[0].text);

test('official image envelope becomes MCP image, preserving metadata and unrelated text',()=>{
 for(const [mime,hex] of [['image/png','89504e470d0a1a0a'],['image/jpeg','ffd8ffe0'],['image/gif','474946383961'],['image/webp','524946460000000057454250']] as const){
  const data=Buffer.from(hex,'hex').toString('base64'),block={type:'text',text:JSON.stringify({type:'image',file:{base64:data,type:mime,dimensions:{originalWidth:32,originalHeight:32}}})},input={content:[{type:'text',text:'prefix'},block]};
  const out:any=normalizeClaudeToolResult('Read',input);assert.deepEqual(out.content[1],{type:'image',data,mimeType:mime});assert.equal(out.content[0].text,'prefix');assert.equal(input.content[1],block);assert.equal(out.content[2].type,'text');
  assert.equal(normalizeClaudeToolResult('Bash',input),input);assert.equal(normalizeClaudeToolResult('Read',{...input,isError:true}) instanceof Object,true);
 }
 for(const file of [{type:'image/png',base64:'invalid'}, {type:'image/png',base64:Buffer.from('not an image').toString('base64')},{type:'image/svg+xml',base64:'AAAA'},{type:'image/png',base64:'A'.repeat(8*1024*1024)}]){const block={type:'text',text:JSON.stringify({type:'image',file})},out:any=normalizeClaudeToolResult('Read',{content:[block],structuredContent:{type:'image',file}});assert.equal(out.isError,true);assert.ok(JSON.stringify(out).length<300);assert.equal(out.structuredContent,undefined);}
 const image={type:'image',data:'native',mimeType:'image/png'};assert.deepEqual((normalizeClaudeToolResult('Read',{content:[image]}) as any).content,[image]);
});

test('MCP images never duplicate Base64 in structured results or image metadata',()=>{
 const data=Buffer.from('89504e470d0a1a0a','hex').toString('base64'),envelope={type:'image',file:{type:'image/png',base64:data,dimensions:{originalWidth:16,originalHeight:32,other:data},originalSize:data}};
 const input={content:[{type:'text',text:JSON.stringify(envelope)}],structuredContent:envelope},out:any=normalizeClaudeToolResult('Read',input);
 assert.equal(out.content[0].data,data);assert.equal(out.structuredContent,undefined);assert.ok(out.content.filter((c:any)=>c.type==='text').every((c:any)=>!c.text.includes(data)));assert.equal(input.structuredContent.file.base64,data);
 const native:any=normalizeClaudeToolResult('Read',{content:[out.content[0]],structuredContent:envelope});assert.deepEqual(native.content,[out.content[0]]);assert.equal(native.structuredContent,undefined);
 const ordinary={content:[{type:'text',text:'Ordinary local file text'}],structuredContent:{text:'Ordinary local file text'}};assert.deepEqual(normalizeClaudeToolResult('Read',ordinary),ordinary);
});

test('discovery uses local instruction hierarchy and only the bound repository memory',async()=>{
 const f=await fixture();try{
  await f.put(path.join(f.claude,'CLAUDE.md'),'User instructions');await f.put(path.join(f.cwd,'CLAUDE.md'),'Project instructions');await f.put(path.join(f.cwd,'.claude/rules/scoped.md'),'---\npaths: [src/**]\n---\nScoped rule');
  const memory=path.join(f.claude,'projects',f.cwd.replace(/[^a-zA-Z0-9]/g,'-'),'memory');await f.put(path.join(memory,'MEMORY.md'),'[Topic](topic.md)');await f.put(path.join(memory,'topic.md'),'Scoped topic');await f.put(path.join(f.claude,'projects','unrelated','memory','secret.md'),'Must not be discovered');
  const catalog=await f.context.discover();assert.equal(catalog.memory.directory,memory);assert.equal(catalog.memory.files.length,2);assert.equal(catalog.instructions.length,3);assert.ok(!JSON.stringify(catalog).includes('secret.md'));assert.equal(f.calls.length,0);
  await f.put(path.join(f.cwd,'src','CLAUDE.md'),'Nested instruction');assert.ok((await f.context.discover(path.join(f.cwd,'src'))).instructions.some(i=>i.path===path.join(f.cwd,'src','CLAUDE.md')));
  await f.put(path.join(f.claude,'settings.json'),JSON.stringify({autoMemoryEnabled:false}));assert.equal((await f.context.discover()).memory.enabled,false);assert.deepEqual((await f.context.discover()).memory.files,[]);
  await f.put(path.join(f.claude,'settings.json'),'{broken');await assert.rejects(f.context.discover());
 }finally{await f.close();}
});

test('custom native memory directories and project policy are reread without changing settings',async()=>{
 const f=await fixture();try{
  const file=path.join(f.claude,'settings.json'),value=JSON.stringify({autoMemoryDirectory:'~/shared-memory'});await f.put(file,value);await f.put(path.join(f.home,'shared-memory','MEMORY.md'),'Custom memory');
  assert.equal((await f.context.discover()).memory.files.length,1);assert.equal(await readFile(file,'utf8'),value);
  await f.put(path.join(f.cwd,'.claude/settings.json'),JSON.stringify({autoMemoryDirectory:path.join(f.root,'project-memory'),permissions:{blockReadsOutsideWorkingDirectories:true}}));
  const state=await f.context.discover();assert.equal(state.memory.enabled,false);assert.ok(state.warnings.some(w=>w.includes('blocked')));
  await f.put(file,JSON.stringify({autoMemoryDirectory:'relative'}));await assert.rejects(f.context.discover(),/MEMORY_PATH_INVALID/);
 }finally{await f.close();}
});

test('git worktree memory resolves the common repository without reading transcripts',async()=>{
 const f=await fixture();try{
  const worktree=path.join(f.root,'worktree'),meta=path.join(f.cwd,'.git','worktrees','fixture');await f.put(path.join(worktree,'.git'),'gitdir: '+meta);await f.put(path.join(meta,'commondir'),'../..');
  const context=new LocalClaudeContext({...f.options,cwd:worktree});assert.equal((await context.discover()).memory.directory,path.join(f.claude,'projects',f.cwd.replace(/[^a-zA-Z0-9]/g,'-'),'memory'));await context.close();
 }finally{await f.close();}
});

test('native explicit project directory names apply only beside an explicit config directory',async()=>{
 const f=await fixture();try{
  const implicit=new LocalClaudeContext({...f.options,env:{...f.options.env,CLAUDE_CODE_PROJECT_DIR_NAME:'fixture-name'}});assert.ok((await implicit.discover()).memory.directory!.includes(f.cwd.replace(/[^a-zA-Z0-9]/g,'-')));await implicit.close();
  const explicit=new LocalClaudeContext({...f.options,env:{...f.options.env,CLAUDE_CONFIG_DIR:f.claude,CLAUDE_CODE_PROJECT_DIR_NAME:'fixture-name'}});assert.equal((await explicit.discover()).memory.directory,path.join(f.claude,'projects','fixture-name','memory'));await explicit.close();
 }finally{await f.close();}
});

test('skills deliver full instructions, arguments, support paths and VPS fork metadata',async()=>{
 const f=await fixture();try{
  await f.skill('fixture','BODY\n$ARGUMENTS / $ARGUMENTS[1] / $0\n${CLAUDE_SKILL_DIR}\n${CLAUDE_PROJECT_DIR}','description: Fixture\ncontext: fork\nagent: Explore\nmodel: haiku\nallowed-tools: Read');
  const request={...await f.get('fixture'),arguments:'alpha "beta gamma"'};const plan=await f.context.loadSkill(request);assert.match(plan.instructions,/BODY/);assert.match(plan.instructions,/alpha "beta gamma" \/ beta gamma \/ alpha/);assert.ok(plan.instructions.includes(path.join(f.cwd,'.claude','skills','fixture')));assert.deepEqual(plan.execution,{location:'vps',context:'fork',agent:'Explore',model:'haiku',allowedTools:'Read'});assert.equal(f.calls.length,0);
  await f.skill('fixture','UPDATED');await assert.rejects(f.context.loadSkill(request),/CHANGED/);const latest=await f.context.loadSkill(await f.get('fixture'));assert.equal(latest.instructions,'UPDATED');
  await f.put(path.join(f.cwd,'.claude/commands/review/check.md'),'Legacy command $ARGUMENTS');const legacy=await f.context.loadSkill({...await f.get('review:check'),arguments:'one'});assert.equal(legacy.instructions,'Legacy command one');
 }finally{await f.close();}
});

test('skill effort substitution uses the bound selection and preserves unavailable values for native handling',async()=>{
 const f=await fixture();try{
  await f.skill('effort','Current effort: ${CLAUDE_EFFORT}','description: Effort');
  const context=new LocalClaudeContext({...f.options,env:{...f.options.env,CLAUDE_EFFORT:'high'}});const request={...await (async()=>{const s=(await context.discover()).skills.find(s=>s.name==='effort');assert.ok(s);return {id:s.id,hash:s.hash};})()};assert.equal((await context.loadSkill(request)).instructions,'Current effort: high');await context.close();
  await f.put(path.join(f.cwd,'.claude/skills/effort/SKILL.md'),'---\ndescription: Effort\n---\nCurrent effort: ${CLAUDE_EFFORT}');assert.deepEqual((await f.context.loadSkill(await f.get('effort'))).execution.nativeRequirements,['${CLAUDE_EFFORT}']);
 }finally{await f.close();}
});

test('skill and plugin toggles apply on refresh, with actual installed support files',async()=>{
 const f=await fixture();try{
  await f.skill('off','Should not load');await f.put(path.join(f.claude,'settings.json'),JSON.stringify({skillOverrides:{off:'off'}}));assert.equal((await f.context.discover()).skills.length,0);
  const install=path.join(f.root,'plugin');await f.put(path.join(install,'.claude-plugin/plugin.json'),JSON.stringify({name:'plug'}));await f.put(path.join(install,'skills/check/SKILL.md'),'---\ndescription: Plugin\n---\n${CLAUDE_PLUGIN_ROOT}/scripts/check.js');
  await f.put(path.join(f.claude,'plugins/installed_plugins.json'),JSON.stringify({version:2,plugins:{'plug@fixture':[{installPath:install,scope:'user'}]}}));
  assert.ok((await f.context.loadSkill(await f.get('plug:check'))).instructions.includes(install));await f.put(path.join(f.claude,'settings.json'),JSON.stringify({enabledPlugins:{'plug@fixture':false}}));assert.ok(!(await f.context.discover()).skills.some(s=>s.name==='plug:check'));
 }finally{await f.close();}
});

test('dynamic skill commands require separate mutation approval, exact command and no replay',async()=>{
 const f=await fixture();try{
  await f.skill('dynamic','Before !`printf fixture` After');const request=await f.get('dynamic');let mode:PermissionMode='plan';const mcp=new ClaudeToolMcpSession(f.tools,()=>mode,()=>{});const rpc=async(id:number,method:string,params?:any)=>await mcp.handle({jsonrpc:'2.0',id,method,params}) as any;
  await rpc(1,'initialize');await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const load=await rpc(2,'tools/call',{name:'LoadLocalSkill',arguments:request});assert.equal(parsed(load.result).commands[0].completed,false);assert.equal(load.result.structuredContent.instructions,parsed(load.result).instructions);assert.deepEqual(load.result.structuredContent.commands,parsed(load.result).commands);assert.equal(f.calls.length,0);
  const command={...request,index:0,command:'printf fixture'};assert.equal((await rpc(3,'tools/call',{name:'RunLocalSkillCommand',arguments:command})).result.isError,true);assert.equal(f.calls.length,0);
  mode='full-access';assert.ok(!(await rpc(4,'tools/call',{name:'RunLocalSkillCommand',arguments:command})).result.isError);assert.equal(f.calls[0].name,'Bash');assert.equal(f.calls[0].args.command,'printf fixture');
  const plan=await f.context.loadSkill(request);assert.equal(plan.commands[0]!.completed,true);assert.match(plan.instructions,/DYNAMIC_FIXTURE/);
  assert.equal((await rpc(5,'tools/call',{name:'RunLocalSkillCommand',arguments:command})).result.isError,true);await assert.rejects(f.context.runSkillCommand({...command,command:'different'},f.native),/MISMATCH/);assert.equal(f.calls.length,1);mcp.dispose();
 }finally{await f.close();}
});

test('skill shell metadata routes dynamic commands through the matching official local tool',async()=>{
 const f=await fixture();try{
  await f.skill('powershell','Before !`Write-Output fixture` After','description: Fixture\nshell: powershell');
  const request=await f.get('powershell');const plan=await f.context.loadSkill(request);assert.deepEqual(plan.commands,[{index:0,command:'Write-Output fixture',shell:'powershell',completed:false}]);
  const result=await f.context.runSkillCommand({...request,index:0,command:'Write-Output fixture'},f.native);assert.equal((result as any).isError,undefined);assert.equal(f.calls.at(-1)?.name,'PowerShell');assert.equal(f.calls.at(-1)?.args.command,'Write-Output fixture');
  const rendered=await f.context.loadSkill(request);assert.match(rendered.instructions,/DYNAMIC_FIXTURE/);
 }finally{await f.close();}
});

test('MCP prompts preserve user-only/model-only skill policy and do not execute scripts',async()=>{
 const f=await fixture();try{
  await f.skill('manual','Manual $ARGUMENTS','description: Manual\ndisable-model-invocation: true');await f.skill('automatic','Automatic','description: Automatic\nuser-invocable: false');
  const request=await f.get('manual');await assert.rejects(f.context.loadSkill(request),/INVOCATION_DISABLED/);const catalog=parsed(await f.tools.call('LocalContext',{}));assert.ok(!catalog.skills.some((s:any)=>s.name==='manual'));
  const mcp=new ClaudeToolMcpSession(f.tools,()=> 'default',()=>{}),rpc=async(method:string,params?:any)=>await mcp.handle({jsonrpc:'2.0',id:1,method,params}) as any;
  assert.deepEqual((await rpc('initialize')).result.capabilities.prompts,{listChanged:false});await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const prompts=(await rpc('prompts/list')).result.prompts;assert.equal(prompts.length,1);const plan=JSON.parse((await rpc('prompts/get',{name:prompts[0].name,arguments:{arguments:'example'}})).result.messages[0].content.text);assert.equal(plan.instructions,'Manual example');assert.equal(f.calls.length,0);mcp.dispose();
 }finally{await f.close();}
});

test('native lifecycle source remains readable and cleanup revokes context handles',async()=>{
 const f=await fixture();try{
  for(const metadata of ['hooks:\n  PreToolUse: []','background: true']){await f.skill('unsupported','Body',metadata);const plan=await f.context.loadSkill(await f.get('unsupported'));assert.equal(plan.instructions,'Body');assert.ok(plan.source?.includes(metadata));assert.ok(plan.execution.nativeRequirements?.length);}
  await f.tools.close();await f.tools.close();assert.equal(f.closed,1);await assert.rejects(f.context.discover(),/CLOSED/);assert.equal(f.calls.length,0);
 }finally{await f.close();}
});

test('sequence arguments and pwsh alias reach native commands while original lifecycle declarations remain visible',async()=>{
 const f=await fixture();try{
  await f.skill('sequence','$topic / $detail !`Write-Output fixture`','description: Sequence\narguments:\n  - topic\n  - detail\nshell: pwsh\nmodel: custom-model\nisolation: worktree\nbackground: true');
  const request={...await f.get('sequence'),arguments:'one "two three"'},plan=await f.context.loadSkill(request);
  assert.match(plan.instructions,/one \/ two three/);assert.equal(plan.commands[0]!.shell,'powershell');assert.deepEqual(plan.execution.nativeRequirements,['isolation','background','inline-model']);
  await f.context.runSkillCommand({...request,index:0,command:'Write-Output fixture'},f.native);assert.equal(f.calls[0].args.timeout,undefined);
  await f.skill('effort','${CLAUDE_EFFORT}','description: Custom effort');const context=new LocalClaudeContext({...f.options,env:{...f.options.env,CLAUDE_EFFORT:'future-effort'}});assert.equal((await context.loadSkill(await f.get('effort'))).instructions,'future-effort');await context.close();
 }finally{await f.close();}
});

test('approved syntax adapter reaches real MCP loads and restores original native requirements on disable',async()=>{
 const f=await fixture(),plugins=new PluginRegistry(path.join(f.root,'plugins'));await plugins.initialize();plugins.services.register('runtime.claude-skill-adapters',claudeSkillAdapters,{version:1});
 const id='qa.skill-adapter',manifest={schemaVersion:1,apiVersion:1,id,name:'Skill syntax fixture',version:'1.0.0',description:'Synthetic only',capabilities:['host'],main:'main.mjs'};
 const code=`export function activate(api){api.onDispose(api.services.get('runtime.claude-skill-adapters').register({id:'plugin:'+api.id+'/syntax',load:(input,core)=>input.skill.name==='adapted'?core().then(plan=>({...plan,instructions:plan.instructions.replaceAll('$'+'{CLAUDE_EXAMPLE}','adapted'),execution:{...plan.execution,nativeRequirements:[]}})):undefined}));}`;
 try{
  await f.skill('adapted','Value: ${CLAUDE_EXAMPLE}');const request=await f.get('adapted');const file=path.join(f.root,'fixture.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(code)}]));await plugins.importZip(file);const hash=(await plugins.list())[0]!.hash;
  await plugins.setEnabled(id,hash,true,true);assert.equal(parsed(await f.tools.call('LoadLocalSkill',request)).instructions,'Value: adapted');
  await plugins.setEnabled(id,hash,false);assert.deepEqual(parsed(await f.tools.call('LoadLocalSkill',request)).execution.nativeRequirements,['${CLAUDE_EXAMPLE}']);
  await plugins.setEnabled(id,hash,true);assert.equal(parsed(await f.tools.call('LoadLocalSkill',request)).instructions,'Value: adapted');
  await f.skill('adapted','Changed');await assert.rejects(f.tools.call('LoadLocalSkill',request),/CHANGED/);
 }finally{await plugins.dispose();await f.close();}
});

test('native skill names, named arguments, literal tokens and shell policy remain authoritative',async()=>{
 const f=await fixture();try{
  await f.skill('folder',String.raw`$topic / $1 / $7 / \$0 / KEY=!`+'`never-run`','name: actual-name\ndescription: Named arguments\narguments: [topic]');
  const request={...await f.get('actual-name'),arguments:'"literal $ARGUMENTS" second'};const plan=await f.context.loadSkill(request);assert.equal(plan.instructions,'literal $ARGUMENTS / second / $7 / $0 / KEY=!`never-run`');assert.deepEqual(plan.commands,[]);
  await f.skill('policy','```!\nprintf first\nprintf second\n```\n !`printf third`');let pending=await f.context.loadSkill(await f.get('policy'));assert.equal(pending.commands.length,2);assert.match(pending.commands[0]!.command,/printf first\nprintf second/);
  await f.put(path.join(f.claude,'settings.json'),JSON.stringify({disableSkillShellExecution:true,skillOverrides:{'actual-name':'user-invocable-only'}}));pending=await f.context.loadSkill(await f.get('policy'));assert.equal(pending.commands.length,0);assert.match(pending.instructions,/disabled by policy/);await assert.rejects(f.context.loadSkill(request),/INVOCATION_DISABLED/);
  await f.put(path.join(f.claude,'settings.json'),JSON.stringify({permissions:{deny:['Skill(actual-*)']}}));assert.ok(!(await f.context.discover()).skills.some(s=>s.name==='actual-name'));
 }finally{await f.close();}
});

test('nested and symlinked skills remain loadable at their actual support paths',async()=>{
 const f=await fixture();try{
  const nested=path.join(f.cwd,'packages','one');await f.put(path.join(nested,'.claude','skills','nested','SKILL.md'),'---\ndescription: Nested\n---\nNested body');const entry=(await f.context.discover(nested)).skills.find(s=>s.name==='nested')!;assert.ok(entry);assert.match((await f.context.loadSkill({id:entry.id,hash:entry.hash,directory:nested})).instructions,/Nested body/);
  const outside=path.join(f.home,'linked-skill');await f.put(path.join(outside,'SKILL.md'),'---\nname: linked\ndescription: Linked\n---\n${CLAUDE_SKILL_DIR}/support.txt');await mkdir(path.join(f.cwd,'.claude','skills'),{recursive:true});await symlink(outside,path.join(f.cwd,'.claude','skills','linked'),process.platform==='win32'?'junction':'dir');const plan=await f.context.loadSkill(await f.get('linked'));assert.ok(plan.instructions.includes('linked'));
 }finally{await f.close();}
});

test('an uncertain dynamic command is never replayed and stale configuration cannot reuse its output',async()=>{
 const f=await fixture();try{
  await f.skill('command',' !`fixture-command`');const request={...await f.get('command'),index:0,command:'fixture-command'};let calls=0;
  const uncertain={...f.native,call:async()=>{calls++;throw Error('transport lost');}};await assert.rejects(f.context.runSkillCommand(request,uncertain));await assert.rejects(f.context.runSkillCommand(request,uncertain),/ALREADY_ATTEMPTED/);assert.equal(calls,1);
  await f.put(path.join(f.claude,'settings.json'),JSON.stringify({skillOverrides:{command:'off'}}));await assert.rejects(f.context.loadSkill(request),/UNAVAILABLE/);
 }finally{await f.close();}
});

test('deep skill trees return usable instructions and siblings with explicit partial-discovery warnings',async()=>{
 const f=await fixture();try{
  await f.put(path.join(f.cwd,'AGENTS.md'),'Fixture instructions');await f.skill('visible','Visible skill');
  await f.put(path.join(f.claude,'skills','a','b','c','d','e','f','g','SKILL.md'),'---\nname: deep\ndescription: fixture\n---\nDeep skill');
  const result=parsed(await f.tools.call('LocalContext',{}));
  assert.ok(result.instructions.some((i:any)=>i.path.endsWith('AGENTS.md')));
  assert.ok(result.skills.some((s:any)=>s.name==='visible'));
  assert.ok(result.warnings.some((s:string)=>s.includes('LOCAL_CONTEXT_DISCOVERY_LIMIT')));
 }finally{await f.close();}
});
