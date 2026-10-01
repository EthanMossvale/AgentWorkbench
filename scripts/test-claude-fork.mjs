import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { LocalCliService } from '../packages/native-runtime/cli.ts';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider.ts';
import { SecretStore } from '../apps/desktop/host/store.ts';
import { modelCredentialScope } from '../apps/desktop/host/model-connections.ts';
import { createSessionFork } from '../packages/session-core/fork.ts';
import { sessionMetrics } from '../packages/session-metrics/index.ts';

async function main(){
 const output=path.resolve(process.env.AWB_FORK_QA??'build/qa/claude-fork-20260928/native'),home=path.join(output,'home-'+Date.now());
 if(process.env.AWB_FORK_LIVE_CONFIG&&!process.versions.electron){
   const config=JSON.parse(await readFile(process.env.AWB_FORK_LIVE_CONFIG,'utf8'));
   const profile=path.join(output,'electron');await mkdir(profile,{recursive:true});
   // Only the OS-encrypted profile key is projected into the disposable profile.
   // Credential ciphertext stays in the existing store; plaintext keys never leave safeStorage.
   const local=JSON.parse(await readFile(path.join(config.directory,'Local State'),'utf8'));
   await writeFile(path.join(profile,'Local State'),JSON.stringify({os_crypt:local.os_crypt}),{mode:0o600});
   const {build}=await import('esbuild'),electronPath=(await import('electron')).default;
   const entry=path.resolve('scripts/test-claude-fork.mjs'),target=path.join(output,'run.cjs');
   await build({entryPoints:[entry],outfile:target,bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron','esbuild']});
   const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
   const child=spawn(electronPath,['--user-data-dir='+profile,target],{env,stdio:'inherit',windowsHide:true});
   process.exitCode=await new Promise(resolve=>child.on('exit',code=>resolve(code??1)));return;
 }
 await mkdir(home,{recursive:true});
 assert.ok(process.env.AWB_QA_CLAUDE,'Supply the installed Claude executable explicitly.');
 const live=!!process.env.AWB_FORK_LIVE_CONFIG,checks=[],errors=[],requests=[];
 const firstWord='ALPHA_'+randomUUID().replaceAll('-',''),laterWord='LATER_'+randomUUID().replaceAll('-','');
 const cwd=path.join(home,'project');await mkdir(cwd);await writeFile(path.join(cwd,'marker.txt'),firstWord);
 let electron,server,connection,model,key;
 if(live){
   assert.ok(process.versions.electron,'Saved credentials are used inside Electron safeStorage only.');
   electron=await import('electron');electron.app.setPath('userData',path.join(output,'electron'));await electron.app.whenReady();
   const config=JSON.parse(await readFile(process.env.AWB_FORK_LIVE_CONFIG,'utf8'));
   connection=config.connections.find(c=>c.enabled&&c.models.some(m=>m.enabled&&m.model==='deepseek-flash'));
   assert.ok(connection,'The configured deepseek-flash mapping must exist.');
   model=connection.models.find(m=>m.enabled&&m.model==='deepseek-flash');
   const secrets=new SecretStore(path.join(config.directory,'secrets'),{encrypt:s=>electron.safeStorage.encryptString(s),decrypt:b=>electron.safeStorage.decryptString(b)});
   key=()=>secrets.getModel(connection.credentialRef,modelCredentialScope(connection));
   await key();
 }else{
   server=createServer(async(req,res)=>{
     try{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw),last=body.messages.at(-1),task=body.messages.findLast(m=>m.role==='user');
       let message={role:'assistant',content:JSON.stringify(task).includes('Read marker.txt')?'READY':JSON.stringify(task).includes('Remember the later word')?'LATER_READY':firstWord};
       if(JSON.stringify(task).includes('Read marker.txt')&&last.role!=='tool')message={role:'assistant',content:null,tool_calls:[{id:'read_marker',type:'function',function:{name:'Read',arguments:JSON.stringify({file_path:path.join(cwd,'marker.txt')})}}]};
       res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}],usage:{prompt_tokens:150,completion_tokens:12,prompt_cache_hit_tokens:100,prompt_cache_miss_tokens:50}}));
     }catch(e){errors.push(e.message);res.writeHead(500).end('{}');}
   });await new Promise(r=>server.listen(0,'127.0.0.1',r));
   model={id:'fixture',model:'fixture-model',name:'Fixture',enabled:true,contextWindow:128000};
   connection={id:'fixture',name:'Fixture',protocol:'chat-completions',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,enabled:true,hasKey:true,auth:'key',models:[model],timeoutMs:45000,maxOutputTokens:2048};key=async()=> 'synthetic';
 }
 const cli=new LocalCliService(output,{home,isolated:true,executables:{claude:process.env.AWB_QA_CLAUDE}});await cli.initialize();
 const version=(await cli.list()).find(c=>c.runtime==='claude')?.version;
 const state={hosts:[],sessions:[],modelConnections:[connection]};
 const hooks={snapshot:()=>structuredClone(state),update:async fn=>fn(state),context:async()=>'',translate:()=>{},observe:async()=>{},peers:id=>({sourceSessionId:id,definitions:[],call:async()=>{throw Error('Unexpected workbench tool.');}}),failure:e=>errors.push(e.message)};
 const fetcher=async(url,init)=>{const b=JSON.parse(init.body);requests.push({model:b.model,hasFirst:JSON.stringify(b).includes(firstWord),hasLater:JSON.stringify(b).includes(laterWord),hasPastedHistory:JSON.stringify(b).includes('workbench-conversation-handoff'),toolResults:b.messages?.filter(m=>m.role==='tool').length??0});return fetch(url,init);};
 let runner=new NativeProviderRunner({connection:()=>connection,key},cli,hooks,fetcher),passed=false;
 const send=async(session,text)=>{await runner.submit(session.id,{id:randomUUID(),original:text,translated:text,sourceHash:'fixture',revision:1,bypass:true,demo:false});const until=Date.now()+120000;while(runner.busy(session.id)&&Date.now()<until)await new Promise(r=>setTimeout(r,50));if(runner.busy(session.id)){await runner.stop(session.id);throw Error('Native task timeout');}assert.equal(session.status,'idle',session.nativeError);assert.equal(session.nativeTurnStatus,'completed',session.nativeError);return session.messages.at(-1);};
 const record=text=>{checks.push(text);console.log('PASS '+text);};
 const digest=async id=>{const files=await readdir(path.join(home,'.claude','projects'),{recursive:true});const file=files.find(f=>path.basename(f)===id+'.jsonl');assert.ok(file,'Synthetic transcript exists');return createHash('sha256').update(await readFile(path.join(home,'.claude','projects',file))).digest('hex');};
 try{
   const parent={id:randomUUID(),projectId:null,projectPath:cwd,title:'Fork fixture',pinned:false,archived:false,group:'',createdAt:new Date().toISOString(),status:'idle',permissionMode:'default',binding:{runtime:'claude',provider:connection.id,accountRef:'model-api:'+connection.id,executionId:'local-device',egress:'direct-api',modelConnectionId:connection.id,modelMappingId:model.id},modelSelection:{model:model.model},messages:[]};state.sessions.push(parent);
   const first=await send(parent,'Read marker.txt using the native Read tool with file_path '+JSON.stringify(path.join(cwd,'marker.txt'))+'. Its token is random and is not in this request. You must call Read and receive its tool result before answering. Then reply with the exact token from that result; do not guess.');
   assert.ok(requests.some(r=>r.toolResults>0&&r.hasFirst),'Native Read result reaches the model');assert.ok(first.nativeItemId);assert.equal(first.nativeTurnEnd,true);record('native tool result and completed assistant UUID are recorded');
   await send(parent,'Remember the later word '+laterWord+'. Reply only LATER_READY and use no tools.');
   const original=structuredClone(parent),hash=await digest(parent.binding.nativeSessionId),before=requests.length;
   const fork=createSessionFork(parent,randomUUID(),new Date().toISOString(),first.id,runner.forkSource(parent.id,first.id));state.sessions.push(fork);
   assert.equal(requests.length,before);assert.equal(fork.binding.nativeSessionId,undefined);record('creating an assistant branch does not start a model call');
   const answer=await send(fork,'What exact token did you read from marker.txt earlier? Reply with that token only. Use no tools and do not read the file again.');
   assert.ok(answer.original.includes(firstWord));assert.ok(!answer.original.includes(laterWord));assert.ok(requests.slice(before).every(r=>r.hasFirst&&!r.hasLater&&!r.hasPastedHistory));assert.notEqual(fork.binding.nativeSessionId,parent.binding.nativeSessionId);assert.deepEqual(parent,original);assert.equal(await digest(parent.binding.nativeSessionId),hash);record('fork retains native tool history through the selected reply, excludes later turns and preserves the source');
   const childId=fork.binding.nativeSessionId;await runner.dispose();runner=new NativeProviderRunner({connection:()=>connection,key},cli,hooks,fetcher);
   const next=await send(fork,'Repeat the previously read token only. Use no tools.');assert.ok(next.original.includes(firstWord));assert.equal(fork.binding.nativeSessionId,childId);record('independent branch resumes after runner and CLI process restart');
   const sibling=createSessionFork(parent,randomUUID(),new Date().toISOString(),first.id,runner.forkSource(parent.id,first.id));sibling.projectPath=path.join(home,'other-checkout');await mkdir(sibling.projectPath);state.sessions.push(sibling);
   assert.ok((await send(sibling,'Repeat the token read in the original directory. Use no tools.')).original.includes(firstWord));assert.notEqual(sibling.binding.nativeSessionId,childId);assert.equal(await digest(parent.binding.nativeSessionId),hash);record('native branch resumes from another checkout without copying or modifying source transcripts');
   assert.ok(fork.nativeContextUsage?.used>0);const metrics=sessionMetrics(fork);assert.ok(metrics.inputTokens>0);if(!live){assert.ok(metrics.cacheReadTokens>0);assert.equal(metrics.cacheWriteTokens,null);}record('context and request usage remain available with real native receipts');
   assert.deepEqual(errors,[]);passed=true;
 }finally{await runner.dispose();await cli.dispose();if(server)await new Promise(r=>server.close(r));await writeFile(path.join(output,'report.json'),JSON.stringify({passed,checks,errors,version,model:model.model,requests,usage:state.sessions.map(s=>({metrics:sessionMetrics(s),context:s.nativeContextUsage})),scope:live?'Configured independent model API, actual Claude CLI, disposable native home and synthetic task data. No SSH acceptance.':'Actual Claude CLI with synthetic loopback provider and disposable native home.'},null,2));electron?.app.quit();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;if(process.versions.electron)void import('electron').then(e=>e.app.exit(1));});
