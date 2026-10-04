import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as buildHost} from 'esbuild';
import {build as buildRenderer} from 'vite';
import {mkdir,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {StateStore} from '../apps/desktop/host/store.ts';

// Input latency while a real native CLI streams: hidden Electron, the owned
// Codex/Claude executables, an isolated profile and a synthetic loopback
// provider. Measures the window's input handling and the main process event
// loop, which also pumps the window's input messages on Windows.
const root=process.cwd(),label=process.env.AWB_NATIVE_INPUT_LABEL??'candidate',runtime=process.env.AWB_NATIVE_INPUT_RUNTIME??'codex';
assert.ok(['codex','claude'].includes(runtime));
assert.ok(process.env.AWB_QA_CODEX&&process.env.AWB_QA_CLAUDE,'Both QA CLI paths must be explicitly supplied');
const chunks=Number(process.env.AWB_NATIVE_INPUT_CHUNKS??3000),interval=Number(process.env.AWB_NATIVE_INPUT_INTERVAL_MS??6);
const output=path.resolve('build/qa/native-input-'+label+'-'+runtime+'-'+Date.now()),appRoot=path.join(output,'app'),data=path.join(output,'data');
await mkdir(path.join(data,'native-home','.codex'),{recursive:true});await mkdir(path.join(data,'native-home','.claude'),{recursive:true});await mkdir(appRoot,{recursive:true});
const pieces=['Streaming ','words ','with **emphasis**, ','`code` ','and ','$a+b$ ','math. ','\n\n','- a bullet\n','```ts\nconst live = 1;\n```\n'];
let streams=0;
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
 if(req.url.endsWith('/models')){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'fixture-model',display_name:'Fixture',context_length:200000}]}));}
 const usage={prompt_tokens:400,completion_tokens:chunks};
 if(!body.stream){res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'Synthetic reply.'}}],usage}));}
 streams++;res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
 const send=value=>res.write('data: '+JSON.stringify(value)+'\n\n');
 for(let i=0;i<chunks&&!res.destroyed;i++){send({id:'synthetic',choices:[{index:0,delta:i?{content:pieces[i%pieces.length]}:{role:'assistant',content:pieces[0]}}]});await new Promise(r=>setTimeout(r,interval));}
 send({id:'synthetic',choices:[{index:0,delta:{},finish_reason:'stop'}],usage});res.end('data: [DONE]\n\n');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
await buildRenderer({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'error'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[`apps/desktop/host/${entry}.ts`],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await cp('services/vps-workspace-control',path.join(appRoot,'host/workspace-control'),{recursive:true});await cp('services/vps-account-broker',path.join(appRoot,'host/account-runtime'),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-native-input-qa',version:'1.0.0',main:'host/main.cjs'}));
// Realistic stored history in other sessions (size of state, sidebar).
const store=new StateStore(data);await store.load();
const prose='A public reply with **formatting**, `src/example.ts` and math $x^2$.\n\n- item\n- item\n\n```ts\nconst a = 1;\n```\n'.repeat(4);
await store.update(s=>{s.sessions=Array.from({length:30},(_,k)=>({id:'history-'+k,projectId:null,projectPath:data,title:'History '+k,createdAt:new Date(Date.now()-86400000*(k+1)).toISOString(),status:'idle',pinned:false,archived:false,group:'',binding:{runtime:'demo',provider:'offline',accountRef:'none',executionId:'local',egress:'demo'},
 messages:Array.from({length:120},(_,i)=>({id:k+'-'+i,role:i%2?'assistant':'user',original:i%2?prose:'Question '+i,timestamp:new Date(Date.now()-86400000*(k+1)+i*1000).toISOString(),demo:false,...(i%2?{phase:'final'}:{})}))}));});
await store.flush();
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:data,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.env.AWB_QA_CODEX,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.env.AWB_QA_CLAUDE};delete env.ELECTRON_RUN_AS_NODE;
const stats=values=>{if(!values.length)return {n:0};const s=values.toSorted((a,b)=>a-b),pick=p=>Math.round(s[Math.min(s.length-1,Math.ceil(s.length*p)-1)]*10)/10;return {n:s.length,p50:pick(.5),p95:pick(.95),max:pick(1)};};
let app;const report={label,runtime,chunks,interval,errors:[]};
try{
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:root,env,timeout:60000});const page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,860));
 const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
 await call('plugins/set-enabled',{id:'translation',enabled:false});
 const connection=await call('model-api/save',{connection:{name:'Synthetic',baseUrl:`http://127.0.0.1:${port}/v1`,protocol:'chat-completions',models:[{id:'fixture-model',model:'fixture-model',name:'Fixture',enabled:true,contextWindow:200000}]},key:'synthetic-key'});
 await call('permissions/remember',{projectId:null,runtime,permissionMode:'full-access'});
 const created=await call('session/create',{modelTargetId:`api/${connection.id}/fixture-model/${runtime}`});
 await page.getByTestId('sidebar-session-'+created.id).click();
 const input=page.getByTestId('composer-input');
 await input.fill('Please write a long answer.');await page.getByTestId('prepare-draft').click();
 const start=Date.now();while(!(await call('state/get')).sessions.find(s=>s.id===created.id)?.messages.some(m=>m.role==='assistant'&&m.original.length>400)){if(Date.now()-start>90000)throw Error('No streamed reply');await page.waitForTimeout(200);}
 // Main process: event loop delay and CPU profile while the window is used.
 await app.evaluate(async()=>{const perf=process.getBuiltinModule('node:perf_hooks'),inspector=process.getBuiltinModule('node:inspector');const h=perf.monitorEventLoopDelay({resolution:1});h.enable();const session=new inspector.Session();session.connect();const post=(m,p)=>new Promise((ok,no)=>session.post(m,p??{},(e,r)=>e?no(e):ok(r)));await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:250});await post('Profiler.start');globalThis.__qaMain={h,session,post,stalls:[],last:performance.now(),timer:setInterval(()=>{const now=performance.now();if(now-globalThis.__qaMain.last>30)globalThis.__qaMain.stalls.push(Math.round(now-globalThis.__qaMain.last));globalThis.__qaMain.last=now;},10)};});
 await page.evaluate(()=>{const q=window.qaInput={received:[],wheel:[],frames:[]};q.listener=e=>{const received=performance.now()-e.timeStamp;q.received.push({type:e.type,received});if(e.type==='wheel'){const t=e.timeStamp;requestAnimationFrame(()=>q.wheel.push(performance.now()-t));}};
  for(const type of ['keydown','wheel'])window.addEventListener(type,q.listener,{capture:true,passive:true});
  q.frameObserver=new PerformanceObserver(list=>{for(const e of list.getEntries())q.frames.push({duration:Math.round(e.duration),blocking:Math.round(e.blockingDuration),scripts:(e.scripts??[]).map(s=>(s.sourceFunctionName||'?')+' '+(s.sourceURL||'').split('/').pop()+' '+Math.round(s.duration))});});
  q.frameObserver.observe({type:'long-animation-frame'});});
 const box=await page.getByTestId('original-pane').boundingBox();
 for(let round=0;round<4;round++){
  await input.click();await page.keyboard.type('Typing while the native model streams '+round+'. ',{delay:20});
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  for(let i=0;i<15;i++){await page.mouse.wheel(0,(i%2?1:-1)*240);await page.waitForTimeout(25);}
 }
 const stillRunning=(await call('state/get')).sessions.find(s=>s.id===created.id)?.status==='running';
 const renderer=await page.evaluate(()=>{const q=window.qaInput;q.frameObserver.disconnect();for(const type of ['keydown','wheel'])window.removeEventListener(type,q.listener,{capture:true});return q;});
 const main=await app.evaluate(async()=>{const q=globalThis.__qaMain;clearInterval(q.timer);q.h.disable();const {profile}=await q.post('Profiler.stop');q.session.disconnect();
  const idx=new Map(profile.nodes.map(n=>[n.id,n])),self=new Map();let total=0;for(let i=0;i<profile.samples.length;i++){const n=idx.get(profile.samples[i]),dt=profile.timeDeltas[i]??0;total+=dt;const k=n.callFrame.functionName+' '+n.callFrame.url.split(/[\\/]/).pop()+':'+n.callFrame.lineNumber;self.set(k,(self.get(k)??0)+dt);}
  const parent=new Map();for(const n of profile.nodes)for(const c of n.children??[])parent.set(c,n.id);const chains=new Map();for(let i=0;i<profile.samples.length;i++){const n=idx.get(profile.samples[i]);if(!/structuredClone|stringify|parse/.test(n.callFrame.functionName))continue;const chain=[];for(let id=parent.get(n.id),d=0;id&&d<6;id=parent.get(id),d++){const m=idx.get(id);chain.push(m.callFrame.functionName+':'+m.callFrame.lineNumber);}const k=n.callFrame.functionName+' <- '+chain.join(' <- ');chains.set(k,(chains.get(k)??0)+(profile.timeDeltas[i]??0));}
  return {chains:[...chains].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>[Math.round(v/1000),k]),loop:{p50:q.h.percentile(50)/1e6,p99:q.h.percentile(99)/1e6,max:q.h.max/1e6},stalls:q.stalls,totalMs:total/1000,top:[...self].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([k,v])=>[Math.round(v/1000),k])};});
 report.stillRunningDuringInput=stillRunning;
 report.renderer={keydown:stats(renderer.received.filter(e=>e.type==='keydown').map(e=>e.received)),wheel:stats(renderer.received.filter(e=>e.type==='wheel').map(e=>e.received)),wheelToFrame:stats(renderer.wheel),longFrames:renderer.frames.length,longFrameMax:Math.max(0,...renderer.frames.map(f=>f.duration)),longFrameScripts:renderer.frames.flatMap(f=>f.scripts).slice(0,12)};
 report.main={chains:main.chains,loopP50:Math.round(main.loop.p50*10)/10,loopP99:Math.round(main.loop.p99*10)/10,loopMax:Math.round(main.loop.max*10)/10,stalls:stats(main.stalls),stallCount:main.stalls.length,profiledMs:Math.round(main.totalMs),top:main.top};
 report.streams=streams;
 assert.deepEqual(report.errors,[]);
 console.log(JSON.stringify(report));
}finally{await app?.close();server.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
