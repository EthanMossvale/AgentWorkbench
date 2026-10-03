import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as buildHost} from 'esbuild';
import {build as buildRenderer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {StateStore} from '../apps/desktop/host/store.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';

// Input responsiveness while a model streams, measured inside the page:
// time from the OS input timestamp until the renderer handles the event,
// Event Timing (input delay + handler time), wheel-to-next-frame delay and
// Long Animation Frames. Isolated synthetic profile, hidden production window,
// approved fixture plugin streaming through the session-scoped runner path.
const root=path.resolve(process.env.AWB_INPUT_UI_SOURCE??process.cwd()),label=process.env.AWB_INPUT_UI_LABEL??'candidate';
const runtime=process.env.AWB_INPUT_UI_RUNTIME??'codex',turns=Number(process.env.AWB_INPUT_UI_TURNS??200),sessionsCount=Number(process.env.AWB_INPUT_UI_SESSIONS??30);
const streamMs=Number(process.env.AWB_INPUT_UI_STREAM_MS??15000),sections=Number(process.env.AWB_INPUT_UI_REPLY_SECTIONS??60);
assert.ok(['codex','claude'].includes(runtime));
const output=path.resolve('build/qa/input-responsiveness-'+label+'-'+Date.now()),appRoot=path.join(output,'app'),profile=path.join(output,'.agent-workbench'),workspace=path.join(profile,'workspaces','fixture');
await mkdir(workspace,{recursive:true});await mkdir(appRoot,{recursive:true});
await buildRenderer({root:path.join(root,'apps/desktop/renderer'),configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true,...(process.env.AWB_INPUT_UI_PROFILE?{minify:false}:{})},logLevel:'error'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-input-ui-qa',version:'0.1.0',main:'host/main.cjs'}));

const base=Date.parse('2026-10-01T00:00:00Z');
const section=i=>`## Section ${i}\n\nExplanation with **bold**, \`inline code\`, a [link](https://example.com) and math $x_${i}^2+y^2$.\n\n- item one\n- item two\n\n\`\`\`ts\nfunction f${i}(value: number) {\n  return value * ${i};\n}\n\`\`\`\n`;
const prose=Array.from({length:3},(_,i)=>section(i)).join('\n');
const longReply=Array.from({length:sections},(_,i)=>section(i)).join('\n');
const chunks=['Streaming words arrive ','with **emphasis** and ','`code` ','continuing the sentence. ','\n\n','- a new bullet\n','```ts\nconst live = 1;\n```\n','and $a+b$ math. '];
const session=(id,title,count,shift=0)=>{const at=n=>new Date(base+(n-shift)*1000).toISOString(),messages=[],activities=[];
 for(let i=0;i<count;i++){messages.push({id:id+'-user-'+i,role:'user',original:'Historical task '+i,timestamp:at(i*10),demo:false});
  for(let j=0;j<3;j++)activities.push({id:id+'-tool-'+i+'-'+j,runtime,kind:'command',status:'completed',startedAt:at(i*10+j+1),updatedAt:at(i*10+j+2),input:'Synthetic public command',output:'Bounded output\n'.repeat(200)});
  messages.push({id:id+'-reply-'+i,role:'assistant',phase:'final',original:prose,timestamp:at(i*10+7),demo:false});}
 messages.push({id:id+'-current',role:'user',original:'Current task',timestamp:at(count*10+1),demo:false});
 return {id,projectId:null,projectPath:workspace,title,createdAt:at(0),status:'idle',messages,activities,pinned:false,archived:false,group:'',binding:{runtime,provider:'native',accountRef:'fixture',executionId:'local-device',egress:'runtime-managed'}};};
const store=new StateStore(profile);await store.load();
await store.update(s=>{s.plugins={translation:{enabled:false}};s.sessions=[{...session('live','Live session',turns),pinned:true},...Array.from({length:sessionsCount},(_,i)=>session('idle'+i,'Idle session '+i,8,86400*(i+1)))];});
await store.flush();

// Like the native runners: a text batch every 32 ms into a long Markdown reply,
// a running tool whose output grows, and a new tool every 8th batch.
const source=`const LONG=${JSON.stringify(longReply)},CHUNKS=${JSON.stringify(chunks)},RUNTIME=${JSON.stringify(runtime)},LIMIT=${streamMs};
export function activate(api){const state=api.services.get('workbench.state');let stop=false;
api.registerCommand('stream',async()=>{stop=false;let n=0;const started=Date.now();
 while(!stop&&Date.now()-started<LIMIT){const i=n++;
  await state.updateSession('live',s=>{s.status='running';
   let m=s.messages.at(-1);if(m.id!=='live-stream'){m={id:'live-stream',role:'assistant',phase:'commentary',original:LONG,timestamp:new Date().toISOString(),demo:false};s.messages.push(m);}
   m.original+=CHUNKS[i%CHUNKS.length];
   const running=s.activities.findLast(a=>a.status==='running');
   if(running){running.output+='more output line '+i+'\\n';running.updatedAt=new Date().toISOString();if(i%8===6)running.status='completed';}
   if(i%8===0)s.activities.push({id:'live-tool-'+i,runtime:RUNTIME,kind:'command',status:'running',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),input:'Synthetic command '+i,output:'line\\n'.repeat(20)});
  },{persist:'deferred'});
  await new Promise(r=>setTimeout(r,32));}
 return n;});
api.registerCommand('stop',()=>{stop=true;return state.updateSession('live',s=>{s.status='idle';});});}`;
const manifest={schemaVersion:1,apiVersion:1,id:'qa.input-responsiveness',name:'Input QA',description:'Synthetic public data only',version:'1.0.0',capabilities:['host'],main:'main.mjs'},zip=path.join(output,'fixture.zip');
await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.execPath,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;

const stats=values=>{if(!values.length)return {n:0};const s=values.toSorted((a,b)=>a-b),pick=p=>Math.round(s[Math.min(s.length-1,Math.ceil(s.length*p)-1)]*10)/10;return {n:s.length,p50:pick(.5),p95:pick(.95),max:pick(1)};};
let app;const report={label,runtime,turns,sessions:sessionsCount+1,replyChars:longReply.length,errors:[]};
try{
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:60000});const page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
 const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
 await call('extensions/import',{filePath:zip});const plugin=(await call('extensions/list')).find(p=>p.manifest.id===manifest.id);await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:true,approveHost:true});
 const command=name=>call('extensions/command',{id:manifest.id,name});
 await page.getByTestId('sidebar-session-live').click();await page.locator('[data-sync-key^="live-reply-"]').first().waitFor();await page.waitForTimeout(1500);
 const input=page.getByTestId('composer-input'),pane=page.getByTestId('original-pane');
 const measure=async phase=>{
  await page.evaluate(()=>{const q=window.qaInput={events:[],received:[],wheel:[],frames:[]};
   q.eventObserver=new PerformanceObserver(list=>{for(const e of list.getEntries())q.events.push({name:e.name,delay:e.processingStart-e.startTime,handler:e.processingEnd-e.processingStart,duration:e.duration});});
   q.eventObserver.observe({type:'event',durationThreshold:16,buffered:false});
   q.listener=e=>{const t=e.timeStamp,received=performance.now()-t;q.received.push({type:e.type,received});if(e.type==='wheel')requestAnimationFrame(()=>q.wheel.push(performance.now()-t));};
   for(const type of ['keydown','input','wheel'])window.addEventListener(type,q.listener,{capture:true,passive:true});
   q.frameObserver=new PerformanceObserver(list=>{for(const e of list.getEntries())q.frames.push({duration:e.duration,blocking:e.blockingDuration,scripts:(e.scripts??[]).map(s=>({invoker:s.invoker,duration:Math.round(s.duration),source:(s.sourceFunctionName||'?')+' '+(s.sourceURL||'').split('/').pop()+':'+s.sourceCharPosition}))});});
   try{q.frameObserver.observe({type:'long-animation-frame',buffered:false});}catch{q.frames=null;}});
  const box=await pane.boundingBox();
  for(let round=0;round<3;round++){
   await input.click();await page.keyboard.type('Typing while the model streams, round '+round+'. ',{delay:20});
   await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
   for(let i=0;i<15;i++){await page.mouse.wheel(0,(i%2?1:-1)*240);await page.waitForTimeout(25);}
  }
  await input.click();await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');await page.waitForTimeout(300);
  const raw=await page.evaluate(()=>{const q=window.qaInput;q.eventObserver.disconnect();q.frameObserver.disconnect();for(const type of ['keydown','input','wheel'])window.removeEventListener(type,q.listener,{capture:true});return {events:q.events,received:q.received,wheel:q.wheel,frames:q.frames};});
  const received=type=>stats(raw.received.filter(e=>e.type===type).map(e=>e.received));
  report[phase]={keydownReceived:received('keydown'),wheelReceived:received('wheel'),wheelToFrame:stats(raw.wheel),
   slowEvents:{n:raw.events.length,delay:stats(raw.events.map(e=>e.delay)),handler:stats(raw.events.map(e=>e.handler)),duration:stats(raw.events.map(e=>e.duration))},
   longFrames:raw.frames&&{n:raw.frames.length,duration:stats(raw.frames.map(f=>f.duration)),blocking:stats(raw.frames.map(f=>f.blocking)),
    top:Object.entries(raw.frames.flatMap(f=>f.scripts).reduce((a,s)=>{const k=s.invoker+' | '+s.source;a[k]=(a[k]??0)+s.duration;return a;},{})).sort((a,b)=>b[1]-a[1]).slice(0,8)}};
 };
 await measure('idle');
 const stream=command('stream');await page.waitForTimeout(1000);
 const cdp=process.env.AWB_INPUT_UI_PROFILE?await page.context().newCDPSession(page):undefined;if(cdp){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:200});await cdp.send('Profiler.start');}
 await measure('streaming');
 if(cdp){await writeFile(path.join(output,'streaming.cpuprofile'),JSON.stringify((await cdp.send('Profiler.stop')).profile));report.profile=path.join(output,'streaming.cpuprofile');}
 await command('stop');report.batches=await stream;
 assert.ok(report.batches>100,'stream ran: '+report.batches);
 assert.deepEqual(report.errors,[]);
 console.log(JSON.stringify(report));
}finally{await app?.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
