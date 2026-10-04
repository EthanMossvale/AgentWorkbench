import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LocalClaudeContext} from '../services/claude-bridge/local-context';
import {buildClaudeSessionContext,importTargets,rulePaths} from '../services/claude-bridge/session-context';
import {withClaudeModelSurface,claudeFilePath} from '../services/claude-bridge/model-surface';
import {presentClaudeToolResult,ClaudeToolPresenters} from '../services/claude-bridge/presentation';
import {localTaskProgress} from '../services/claude-bridge/local-tasks';
import {localHookPlan,localHookDecision,runLocalHook} from '../services/claude-bridge/local-hooks';
const text=(value:any)=>({content:[{type:'text',text:JSON.stringify(value)}]});
async function fixture(t:test.TestContext){const home=await mkdtemp(path.join(os.tmpdir(),'awb-native-surface-'));t.after(()=>rm(home,{recursive:true,force:true}));await mkdir(path.join(home,'.claude'),{recursive:true});return {home,options:{cwd:home,directory:home,env:{...process.env,HOME:home,USERPROFILE:home},executable:'synthetic',signal:new AbortController().signal,sessionId:'test',permission:()=> 'full-access'}};}
test('local context loads imports once, memory index only, and scopes rules',async t=>{
 const {home,options}=await fixture(t);const instructions=path.join(home,'CLAUDE.md'),imported=path.join(home,'shared.md'),memory=path.join(home,'memory'),rule=path.join(home,'.claude/rules/scoped.md');
 await mkdir(path.dirname(rule),{recursive:true});await mkdir(memory);
 await writeFile(instructions,'Root rules\n@shared.md\n`@skip.md`\n```\n@skip2.md\n```');await writeFile(imported,'Imported rules\n@CLAUDE.md');
 await writeFile(rule,'---\npaths:\n  - "src/**/*.ts"\n---\nSCOPED_ONLY');await writeFile(path.join(memory,'MEMORY.md'),Array.from({length:210},(_,i)=>'line-'+i).join('\n'));await writeFile(path.join(memory,'topic.md'),'DO_NOT_INLINE');
 await writeFile(path.join(home,'.claude/settings.json'),JSON.stringify({autoMemoryDirectory:memory}));
 const ctx=new LocalClaudeContext(options),loaded=await ctx.sessionContext();
 assert.match(loaded.text,/Imported rules/);assert.equal(loaded.files.filter(f=>f.path===instructions).length,1);assert.match(loaded.text,/line-199/);assert.doesNotMatch(loaded.text,/line-200|DO_NOT_INLINE|SCOPED_ONLY/);assert.deepEqual(loaded.pathRules[0]?.paths,['src/**/*.ts']);
 assert.deepEqual(importTargets('See @shared.md',instructions,home),[imported]);assert.deepEqual(rulePaths('---\npaths: ["a/**", "b/**"]\n---\nx'),['a/**','b/**']);await ctx.close();
});
test('presentation removes JSON duplication while preserving images, errors and unknown result shapes',()=>{
 assert.equal((presentClaudeToolResult('Bash',{},text({stdout:'a\nb\n',stderr:'warning',exitCode:7})) as any).content[0].text,'a\nb\nwarning\nexitCode: 7');
 const image={content:[{type:'image',data:'abc',mimeType:'image/png'}]},error={isError:true,content:[{type:'text',text:'failed'}]};assert.equal(presentClaudeToolResult('Read',{},image),image);assert.equal(presentClaudeToolResult('Read',{},error),error);
 const value:any=presentClaudeToolResult('Edit',{},text({filePath:'x',oldString:'old',originalFile:'large contents'}));assert.doesNotMatch(value.content[0].text,/large contents/);
});
test('model surface preserves load metadata, normalizes paths, warns on stale edits and uses registered presenters',async t=>{
 const {home,options}=await fixture(t),file=path.join(home,'test.txt');await writeFile(file,'old');const calls:any[]=[];
 const raw={definitions:[{name:'Read',_meta:{existing:true}},{name:'Edit'}],call:async(name:string,args:any)=>{calls.push({name,args});return name==='Edit'?text({filePath:file,oldString:'old'}):text({type:'text',file:{filePath:file,content:'old',startLine:1}});},close:async()=>{}};
 await mkdir(path.join(home,'.claude/rules'),{recursive:true});await writeFile(path.join(home,'.claude/rules/text.md'),'---\npaths: ["*.txt"]\n---\nAPPLICABLE_TEXT_RULE');
 const presenters=new ClaudeToolPresenters(),surface=await withClaudeModelSurface(raw,options,presenters);
 assert.equal((surface.definitions[0]?._meta as any).existing,true);assert.equal((surface.definitions[0]?._meta as any)['anthropic/alwaysLoad'],true);
 assert.match(JSON.stringify(await surface.call('Read',{file_path:file})),/APPLICABLE_TEXT_RULE/);await writeFile(file,'changed length');const edited:any=await surface.call('Edit',{file_path:file,old_string:'old',new_string:'new'});assert.match(JSON.stringify(edited),/changed on disk/);assert.equal(calls.length,2,'warning does not introduce a new edit blocker');
 const release=presenters.register({id:'plugin:qa/presenter',present:()=>({content:[{type:'text',text:'OVERRIDE'}]})});assert.match(JSON.stringify(await surface.call('Read',{file_path:file})),/OVERRIDE/);release();assert.doesNotMatch(JSON.stringify(await surface.call('Read',{file_path:file})),/OVERRIDE/);
 assert.equal(claudeFilePath('/d/test/file.txt','D:\\repo','win32'),'D:\\test\\file.txt');await surface.close();
});
test('configured command hooks modify input and pass actual executed input to post hook',async t=>{
 const {home,options}=await fixture(t),script=path.join(home,'hook.cjs'),record=path.join(home,'record.json');
 await writeFile(script,`let data='';process.stdin.on('data',v=>data+=v);process.stdin.on('end',()=>{const v=JSON.parse(data);if(v.hook_event_name==='PreToolUse')console.log(JSON.stringify({hookSpecificOutput:{updatedInput:{command:'updated'},additionalContext:'hook context'}}));else require('fs').writeFileSync(${JSON.stringify(record)},JSON.stringify(v));});`);
 const command='"'+process.execPath.replaceAll('\\','/')+'" "'+script.replaceAll('\\','/')+'"';await writeFile(path.join(home,'.claude/settings.json'),JSON.stringify({hooks:Object.fromEntries(['PreToolUse','PostToolUse'].map(event=>[event,[{matcher:'Bash',hooks:[{type:'command',command}]}]]))}));
 let executed:any;const surface=await withClaudeModelSurface({definitions:[{name:'Bash'}],call:async(_n,args)=>{executed=args;return text({stdout:'done'});},close:async()=>{}},options);
 const result:any=await surface.call('Bash',{command:'original'});assert.equal(executed.command,'updated');assert.match(JSON.stringify(result),/hook context/);assert.equal(JSON.parse(await readFile(record,'utf8')).tool_input.command,'updated');await surface.close();
 const plan=localHookPlan([{file:'fixture',source:'user',value:{hooks:{SessionStart:[{hooks:[{type:'prompt'}]}]}}}]);assert.match(plan.unsupported[0]!,/SessionStart/);
 assert.match(localHookDecision('PreToolUse',[{command:'policy',code:2,stdout:'',stderr:'denied',timedOut:false}]).block!,/denied/);
});
test('partial logs retain arbitrarily long UTF-8 lines and correct tail boundaries',async t=>{
 const {home}=await fixture(t),file=path.join(home,'log'),long='abc界'.repeat(40000);await writeFile(file,long);assert.equal((await localTaskProgress(file,1)).tail,long);
 await writeFile(file,'first\n'+long+'\nlast\n');const result=await localTaskProgress(file,2);assert.equal(result.tail,long+'\nlast');assert.equal(result.truncated,true);
});

test('hook timeout terminates its owned shell and command descendants',async t=>{
 const {home,options}=await fixture(t),script=path.join(home,'wait.cjs');await writeFile(script,'setInterval(()=>{},1000)');
 const command='"'+process.execPath.replaceAll('\\','/')+'" "'+script.replaceAll('\\','/')+'"',start=Date.now();
 const result=await runLocalHook({event:'PreToolUse',matcher:'',command,source:'fixture',timeoutMs:200},{},home,options.env);
 assert.ok(result.timedOut);assert.ok(Date.now()-start<5000);
});
