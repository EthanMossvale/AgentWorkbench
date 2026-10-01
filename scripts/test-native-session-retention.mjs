import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,readdir,readFile,writeFile,open,unlink,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {zstdDecompressSync,gunzipSync} from 'node:zlib';
import path from 'node:path';
import {NativeSessionStorage} from '../packages/remote-account-catalog/session-storage.ts';
import {ProcessSupervisor} from '../services/remote-supervisor/index.ts';
import {CodexRpcClient} from '../packages/runtime-codex/index.ts';
import {LocalCliService} from '../packages/native-runtime/cli.ts';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider.ts';

const output=path.resolve(process.env.AWB_RETENTION_NATIVE_QA??'build/qa/session-idle/native-'+Date.now());
await mkdir(output,{recursive:true});
const checks=[],errors=[],versions={};
const pass=text=>{checks.push(text);console.log('PASS '+text);};
const host={id:'fixture',name:'Fixture',hostname:'retention.example.invalid',port:22,username:'root',role:'admin',identityFile:path.join(output,'synthetic-identity'),knownHostsFile:path.join(output,'synthetic-hosts'),ownerId:'fixture',workspaceGeneration:'generation'};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const confined=value=>{assert.ok(value.startsWith(output+path.sep),'Fixture operations must stay inside the disposable output.');return value;};
const categories={codex:['sessions','archived_sessions','generated_images'],claude:['projects','file-history','todos','tasks','session-env']};
async function files(root){const items=[];for(const e of await readdir(root,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){assert.ok(!e.isSymbolicLink());const p=path.join(root,e.name);if(e.isDirectory())items.push(...await files(p));else if(e.isFile())items.push(p);}return items;}
async function runFixture(script,extra){
 const env={...process.env,...extra};delete env.AWB_FORK_LIVE_CONFIG;
 const child=spawn(process.execPath,['--import','tsx',script],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';
 child.stdout.on('data',b=>{log=(log+b).slice(-20000);});child.stderr.on('data',b=>{log=(log+b).slice(-20000);});
 const timeout=setTimeout(()=>child.kill(),180000);try{const code=await new Promise(resolve=>child.on('exit',resolve));assert.equal(code,0,log);}finally{clearTimeout(timeout);}
}
async function cycle(provider,home,nativeId){
 const manifest=[];for(const category of categories[provider])for(const p of await files(path.join(home,category))){const b=await readFile(p),s=await stat(p);manifest.push({path:path.relative(home,p).replaceAll('\\','/'),size:b.length,sha256:hash(b),mode:384,mtime:s.mtimeMs/1000,delete:true});}
 assert.ok(manifest.some(e=>e.path.endsWith('.jsonl')));const total=manifest.reduce((n,e)=>n+e.size,0);let reclaimed=false;
 const runner=async(_host,_command,options)=>{
  const r=JSON.parse(Buffer.from(options.stdin.match(/b64decode\('([^']+)'\)/)[1],'base64').toString()).request;let value={};
  if(r.method==='retention/candidates')value={authorityId:'fixture',generation:'generation',candidates:[{accountId:'account',accountGeneration:'ag',sessions:[nativeId]}]};
  else if(r.method==='retention/begin')value={files:manifest};
  else if(r.method==='retention/read'){const h=await open(confined(path.join(home,r.entry.path)),'r');try{const b=Buffer.alloc(Math.min(256*1024,r.entry.size-r.offset));await h.read(b,0,b.length,r.offset);value={offset:r.offset,data:b.toString('base64')};}finally{await h.close();}}
  else if(r.method==='retention/commit'){for(const entry of manifest){const p=confined(path.join(home,entry.path));assert.equal(hash(await readFile(p)),entry.sha256);await unlink(p);}reclaimed=true;value={reclaimedBytes:total};}
  else if(r.method==='retention/write'){const p=confined(path.join(home,r.entry.path));await mkdir(path.dirname(p),{recursive:true});const h=await open(p,r.offset===0?'w':'r+');try{const b=Buffer.from(r.data,'base64');await h.write(b,0,b.length,r.offset);await h.sync();value={complete:r.offset+b.length===r.entry.size};}finally{await h.close();}}
  else if(r.method==='retention/restored'){for(const entry of manifest)assert.equal(hash(await readFile(confined(path.join(home,entry.path)))),entry.sha256);}
  else assert.equal(r.method,'retention/release');
  return {exitCode:0,signal:null,stdout:JSON.stringify({ok:true,value}),stderr:''};
 };
 const storage=new NativeSessionStorage(path.join(output,'archives-'+provider),runner);
 await storage.reclaim(host,provider);assert.ok(reclaimed);for(const category of categories[provider])assert.equal((await files(path.join(home,category))).length,0);
 const restarted=new NativeSessionStorage(path.join(output,'archives-'+provider),runner);
 await restarted.restoreFor(host,{id:nativeId,binding:{accountRef:`vps-account:fixture/generation/${provider}/account/ag`}});
 for(const entry of manifest)assert.equal(hash(await readFile(confined(path.join(home,entry.path)))),entry.sha256);
 pass(provider+' native files are reclaimed only after local archive verification and restored after host-service restart');
 return {files:manifest.length,bytes:total};
}
async function codex(){
 assert.ok(process.env.AWB_QA_CODEX,'Set AWB_QA_CODEX to the installed executable.');const base=path.join(output,'codex');
 await runFixture('scripts/test-native-image-delivery.mjs',{AWB_IMAGE_NATIVE_QA:base});
 const dirs=await readdir(base),home=path.join(base,dirs.find(d=>d.startsWith('native-'))),workspace=path.join(base,dirs.find(d=>d.startsWith('workspace-')));
 versions.codex=JSON.parse(await readFile(path.join(base,'report.json'),'utf8')).version;
 const rollouts=(await files(path.join(home,'sessions'))).filter(p=>p.endsWith('.jsonl'));assert.ok(rollouts.length);
 const nativeId=JSON.parse((await readFile(rollouts[0],'utf8')).split('\n')[0]).payload.id;
 await cycle('codex',home,nativeId);let context=false,done=false;
 const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);let raw=Buffer.concat(chunks);if(req.headers['content-encoding']==='zstd')raw=zstdDecompressSync(raw);else if(req.headers['content-encoding']==='gzip')raw=gunzipSync(raw);const body=raw.length?JSON.parse(raw.toString()):{};
  if(req.url.endsWith('/responses')){const text=JSON.stringify(body.input);assert.ok(text.includes('Generate an image of a blue circle.'));assert.ok(text.includes('iVBORw0KGgo'),'Generated image history must survive remote PNG and rollout retirement.');context=true;
   const item={type:'message',id:'restored-answer',role:'assistant',status:'completed',content:[{type:'output_text',text:'RESTORED_NATIVE_HISTORY'}]};res.writeHead(200,{'content-type':'text/event-stream'});for(const e of [{type:'response.created',response:{id:'restored'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'restored',status:'completed',output:[item],usage:{input_tokens:100,output_tokens:10,total_tokens:110}}}])res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);res.end();
  }else if(req.url.includes('/models'))res.end(JSON.stringify({models:[]}));else res.writeHead(404).end('{}');
 }catch(e){errors.push(String(e));res.writeHead(500).end('{}');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 const config=path.join(home,'config.toml');await writeFile(config,(await readFile(config,'utf8')).replaceAll(/http:\/\/127\.0\.0\.1:\d+/g,url));
 const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:home,TMP:home,HOME:home,USERPROFILE:home,CODEX_HOME:home,NO_PROXY:'127.0.0.1,localhost'};
 const transport=new ProcessSupervisor({executable:process.env.AWB_QA_CODEX,args:['app-server','--listen','stdio://'],env,cwd:workspace,lifetimeMs:90000}),rpc=new CodexRpcClient(transport,'retention-fixture',30000);
 rpc.on('raw',f=>{if(f.value.method==='turn/completed')done=true;});
 try{await transport.start();await rpc.initialize();const resumed=await rpc.request('thread/resume',{threadId:nativeId,cwd:workspace});assert.equal(resumed.thread.id,nativeId);rpc.bindRootThread(nativeId);await rpc.request('turn/start',{threadId:nativeId,input:[{type:'text',text:'Continue this restored conversation.'}]});const until=Date.now()+60000;while(!done&&Date.now()<until)await new Promise(r=>setTimeout(r,40));assert.ok(done&&context);pass('Codex cold native resume retains original thread identity and generated image model context');}
 finally{await transport.stop('retention-fixture-complete');server.closeAllConnections();await new Promise(r=>server.close(r));}
}
async function claude(){
 assert.ok(process.env.AWB_QA_CLAUDE,'Set AWB_QA_CLAUDE to the installed executable.');const base=path.join(output,'claude');
 await runFixture('scripts/test-claude-fork.mjs',{AWB_FORK_QA:base});
 const home=path.join(base,(await readdir(base)).find(d=>d.startsWith('home-'))),cwd=path.join(home,'project'),word=await readFile(path.join(cwd,'marker.txt'),'utf8');
 versions.claude=JSON.parse(await readFile(path.join(base,'report.json'),'utf8')).version;
 const transcripts=(await files(path.join(home,'.claude','projects'))).filter(p=>p.endsWith('.jsonl'));let nativeId;
 for(const file of transcripts)if((await readFile(file,'utf8')).includes('Remember the later word')){nativeId=path.basename(file,'.jsonl');break;}assert.ok(nativeId);
 await cycle('claude',path.join(home,'.claude'),nativeId);let sawNativeContext=false;
 const server=createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);assert.ok(JSON.stringify(body.messages).includes(word));assert.ok(body.messages.some(m=>m.role==='tool'),'Native Read result must survive cold restoration.');sawNativeContext=true;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:word}}],usage:{prompt_tokens:100,completion_tokens:10}}));}catch(e){errors.push(String(e));res.writeHead(500).end('{}');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const model={id:'fixture',model:'fixture-model',name:'Fixture',enabled:true,contextWindow:128000},connection={id:'fixture',name:'Fixture',protocol:'chat-completions',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,enabled:true,hasKey:true,auth:'key',models:[model],timeoutMs:45000,maxOutputTokens:2048};
 const session={id:randomUUID(),projectId:null,projectPath:cwd,title:'Cold restore',pinned:false,archived:false,group:'',createdAt:new Date().toISOString(),status:'idle',permissionMode:'default',binding:{runtime:'claude',provider:'fixture',accountRef:'model-api:fixture',executionId:'local-device',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'fixture',nativeSessionId:nativeId},modelSelection:{model:model.model},messages:[]};
 const state={hosts:[],sessions:[session],modelConnections:[connection]},cli=new LocalCliService(base,{home,isolated:true,executables:{claude:process.env.AWB_QA_CLAUDE}});await cli.initialize();
 const runner=new NativeProviderRunner({connection:()=>connection,key:async()=> 'synthetic'},cli,{snapshot:()=>structuredClone(state),update:async fn=>fn(state),context:async()=>'',translate:()=>{},observe:async()=>{},peers:id=>({sourceSessionId:id,definitions:[],call:async()=>{throw Error('Unexpected fixture tool.');}})},fetch);
 try{await runner.submit(session.id,{id:randomUUID(),original:'Repeat the previously read token without reading any files.',translated:'Repeat the previously read token without reading any files.',sourceHash:'fixture',revision:1,bypass:true,demo:false});const until=Date.now()+90000;while(runner.busy(session.id)&&Date.now()<until)await new Promise(r=>setTimeout(r,50));assert.equal(runner.busy(session.id),false);assert.equal(session.status,'idle',session.nativeError);assert.ok(sawNativeContext);assert.equal(session.binding.nativeSessionId,nativeId);assert.ok(session.messages.at(-1).original.includes(word));pass('Claude cold native resume retains tool context and session identity without replaying visible chat text');}
 finally{await runner.dispose();await cli.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
try{await codex();await claude();assert.deepEqual(errors,[]);}catch(error){errors.push(String(error));console.error(error);process.exitCode=1;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,versions,scope:'Actual installed native CLIs, disposable synthetic histories, local archive service and injected file transport. No real credentials, commercial inference, SSH or VPS changes.'},null,2));console.log('REPORT '+path.join(output,'report.json'));}
