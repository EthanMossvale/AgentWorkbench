import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as hostBuild } from 'esbuild';
import { build as rendererBuild } from 'vite';
import { mkdir, writeFile, cp, rename } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { encodeZip } from '../packages/native-resources/archive.ts';

// Hidden production host/renderer with approved synthetic plugins and disposable state.
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),output=path.resolve(process.env.AWB_EVENT_QA??path.join(root,'build/qa/chat-events/ui-'+Date.now())),appRoot=path.join(output,'app'),dataDir=path.join(output,'data');
await mkdir(appRoot,{recursive:true});
await rendererBuild({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await hostBuild({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
for(const [source,target] of [['vps-workspace-control','workspace-control'],['vps-account-broker','account-runtime']])await cp(path.join(root,'services',source),path.join(appRoot,'host',target),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-native-events-qa',version:'1.0.0',main:'host/main.cjs'}));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:dataDir,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const checks=[],errors=[];
const record=name=>{checks.push(name);console.log('PASS '+name);};
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const until=async predicate=>{for(let n=0;n<240;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Native event QA did not settle');};
const shot=name=>page.screenshot({path:path.join(output,name+'.png')});
const openRecords=()=>page.locator('details.turn-process,details.activity-diagnostics').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
const toggle=(plugin,enabled)=>call('extensions/toggle',{id:plugin.manifest.id,hash:plugin.hash,enabled,...(enabled?{approveHost:true}:{})});
const command=(id,name,payload={})=>call('extensions/command',{id,name,payload});
async function fixture(id,main,renderer){const manifest={schemaVersion:1,apiVersion:1,id,name:id,description:'Synthetic event acceptance only',version:'1.0.0',capabilities:['host'],...(main?{main:'main.mjs'}:{}),...(renderer?{renderer:'renderer.mjs'}:{})};const file=path.join(output,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},...(main?[{name:'main.mjs',data:Buffer.from(main)}]:[]),...(renderer?[{name:'renderer.mjs',data:Buffer.from(renderer)}]:[])]));await call('extensions/import',{filePath:file});return(await call('extensions/list')).find(p=>p.manifest.id===id);}
const harness=`import {EventEmitter} from 'node:events';import {createHash} from 'node:crypto';
export function activate(api){const streams=new Map(),observations=new Map();let sequence=0;
api.registerCommand('seed',async()=>{const at=new Date().toISOString();await api.services.get('workbench.state').update(s=>{s.sessions=['codex','claude'].map(runtime=>({id:'event-'+runtime,projectId:null,projectPath:'',title:runtime+' 事件验收',status:'idle',pinned:false,archived:false,group:'',createdAt:at,binding:{runtime,provider:'fixture',accountRef:'fixture',modelConnectionId:'fixture',modelMappingId:'fixture',nativeSessionId:'root',executionId:'local',egress:'direct-api'},messages:[{id:'prompt-'+runtime,role:'user',original:'合成协议事件验收',timestamp:at,demo:false}]}));});for(const runtime of ['codex','claude']){const source=new EventEmitter();streams.set(runtime,source);observations.set(runtime,await api.services.get('workbench.controller').observeNativeSession('event-'+runtime,source));}});
api.registerCommand('emit',async({runtime,value})=>{const rawText=JSON.stringify(value)+'\\n',wire=Buffer.from(rawText),frame=Object.freeze({value,rawText,rawBase64:wire.toString('base64'),sha256:createHash('sha256').update(wire).digest('hex'),receivedAt:new Date().toISOString(),sequence:++sequence});streams.get(runtime).emit('event',{sessionId:'event-'+runtime,public:!String(value.method??value.subtype).includes('future'),raw:frame});await observations.get(runtime).flush();});
api.registerCommand('view',async({runtime,mode})=>api.services.get('workbench.state').update(state=>{const s=state.sessions.find(s=>s.id==='event-'+runtime),at=new Date().toISOString();if(mode==='start'){s.status='running';s.activities=[];s.nativeChildren=[];s.messages.push({id:'run-'+runtime,role:'user',original:'Grouping fixture',timestamp:at,demo:false});}else if(mode==='finish'){s.status='idle';s.nativeTurnStatus='completed';s.messages.push({id:'reply-'+runtime,role:'assistant',original:'Synthetic final response',timestamp:at,demo:false,phase:'final',nativeTurnEnd:true});s.turnTimings=[{id:'timing',userMessageId:'run-'+runtime,startedAt:new Date(Date.now()-654000).toISOString(),endedAt:at,status:'completed'}];}else if(mode==='boundary'){s.messages.push({id:'boundary-'+runtime+'-'+Date.now(),role:'assistant',original:'A new batch follows this commentary.',phase:'commentary',nativeTurnEnd:false,timestamp:at,demo:false});}else if(mode==='background-stop'){s.nativeTurnStatus='interrupted';s.nativeBackground={tasks:[],updatedAt:at,observing:false};}}));
api.onDispose(async()=>{for(const observation of observations.values())await observation.dispose();});}
`;
try{
  app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
  const source=await fixture('qa.chat-source',harness);await toggle(source,true);await command(source.manifest.id,'seed');
  const emit=(runtime,value)=>command(source.manifest.id,'emit',{runtime,value});
  const select=runtime=>page.getByTestId('sidebar-session-event-'+runtime).locator('.session-select').click();
  const tool=async(runtime,id,name,input,output)=>{
    if(runtime==='claude'){
      await emit(runtime,{type:'assistant',message:{content:[{type:'tool_use',id,name:'mcp__workbench__'+name,input}]}});
      await emit(runtime,{type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:JSON.stringify(output)}]}});
    }else await emit(runtime,{method:'item/completed',params:{threadId:'root',turnId:'turn',item:{id,type:'dynamicToolCall',tool:name,arguments:input,contentItems:[{type:'inputText',text:JSON.stringify(output)}],status:'completed'}}});
  };
  for(const runtime of ['codex','claude']){
    const other=runtime==='codex'?'claude':'codex';await select(runtime);await command(source.manifest.id,'view',{runtime,mode:'start'});
    await tool(runtime,'read','workbench_read_session',{sessionId:'event-'+other},{session:{id:'event-'+other,title:'Other chat'},messages:[]});
    let chat=page.locator('[data-workbench-chat-event]').last();await chat.waitFor();assert.equal(await chat.evaluate(n=>!!n.closest('[data-group-kind="tools"]')),false);assert.equal(await chat.locator('pre').count(),0);assert.match(await chat.innerText(),/已查看聊天/);
    await chat.locator('button').click();await until(async()=>(await page.locator('.workspace-header .breadcrumb strong').innerText())===other+' 事件验收');await select(runtime);
    await tool(runtime,'send','workbench_send_message',{targetSessionId:'event-'+other,text:'Synthetic message',operationId:'one'},{delivery:'queued-or-journaled'});
    await until(async()=>await page.locator('[data-workbench-chat-event]').count()===2);const group=page.locator('[data-group-kind="tools"]').last();assert.match(await group.locator('summary').first().innerText(),/2 次聊天交互/);await group.locator('summary').first().click();chat=page.locator('[data-workbench-chat-event]').last();await chat.locator('button').click();await until(async()=>(await page.locator('.workspace-header .breadcrumb strong').innerText())===other+' 事件验收');await select(runtime);
    await command(source.manifest.id,'view',{runtime,mode:'boundary'});await tool(runtime,'create','workbench_create_session',{task:'Synthetic task'},{sessionId:'event-'+other,state:'started'});chat=page.locator('[data-workbench-chat-event]').last();await chat.waitFor();assert.match(await chat.innerText(),/已创建聊天/);assert.equal(await chat.evaluate(n=>!!n.closest('[data-group-kind="tools"]')),false);
    await chat.locator('button').focus();await page.keyboard.press('Enter');await until(async()=>(await page.locator('.workspace-header .breadcrumb strong').innerText())===other+' 事件验收');await select(runtime);
    await command(source.manifest.id,'view',{runtime,mode:'boundary'});await tool(runtime,'missing','workbench_read_session',{sessionId:'deleted'},{error:'missing'});chat=page.locator('[data-workbench-chat-event]').last();await chat.locator('button').click();await chat.getByRole('alert').waitFor();assert.equal(await page.locator('.workspace-header .breadcrumb strong').innerText(),runtime+' 事件验收');
    record(runtime+': singleton, multiple chat interactions, read/send/create navigation, keyboard and missing target');
  }
  await select('claude');await emit('claude',{type:'user',message:{content:[{type:'tool_result',tool_use_id:'search',content:[{type:'tool_reference',tool_name:'workbench_read_session'}]}]}});
  const notice=page.locator('[data-event-key="content/tool_reference"]');await notice.waitFor({state:'attached'});await openRecords();await notice.locator('summary').click();assert.equal(await notice.getAttribute('data-event-disposition'),'observed');assert.match(await notice.innerText(),/原生工具引用已接收/);
  await notice.getByRole('button',{name:'复制适配诊断'}).click();await notice.getByRole('button',{name:'已复制',exact:true}).waitFor();const copied=await app.evaluate(({clipboard})=>clipboard.readText());assert.equal(JSON.parse(copied).event,'content/tool_reference');assert.ok(!copied.includes('tool_name'));
  const reject=await fixture('qa.copy-failure',`export function activate(api){api.useHost((request,next)=>{if(request.method==='clipboard/write')throw Error('Synthetic clipboard failure');return next(request);});}`);await toggle(reject,true);await notice.getByRole('button',{name:'已复制',exact:true}).click();await notice.getByRole('alert').waitFor();await toggle(reject,false);await notice.getByRole('button',{name:'复制适配诊断'}).click();await notice.getByRole('button',{name:'已复制',exact:true}).waitFor();record('tool_reference recognized; host clipboard readback, failure feedback and recovery');
  await command(source.manifest.id,'view',{runtime:'claude',mode:'boundary'});
  const custom=await fixture('qa.chat-extension',undefined,`export function activate(api){window.__chatApi=api.activities;api.activities.registerChat({id:'custom',present:a=>a.toolName?.endsWith('custom_chat')?{label:'插件聊天',targetSessionId:'event-codex'}:undefined});api.observeSurfaces('chat-event','after',({root})=>{root.dataset.qaChat='true';return()=>{};});}`);
  await toggle(custom,true);await tool('claude','custom','custom_chat',{},{});let customChat=page.locator('[data-workbench-chat-event]').filter({hasText:'插件聊天'});await customChat.waitFor();assert.equal(await customChat.evaluate(n=>!!n.closest('[data-group-kind="tools"]')),false);await customChat.locator('button').click();await until(async()=>(await page.locator('.workspace-header .breadcrumb strong').innerText())==='codex 事件验收');await select('claude');await openRecords();
  const failing=await fixture('qa.chat-bad',undefined,`export function activate(api){api.activities.registerChat({id:'bad',present:()=>{throw Error('fixture');}});}`);await toggle(failing,true);await customChat.waitFor();await toggle(failing,false);
  await toggle(custom,false);await until(async()=>await customChat.count()===0);assert.equal(await page.locator('[data-qa-chat]').count(),0);assert.equal(await page.evaluate(()=>{try{window.__chatApi.registerChat({id:'stale',present:()=>undefined});return false;}catch{return true;}}),true);
  await toggle(custom,true);await customChat.waitFor();await tool('claude','custom-later','custom_chat',{},{});await until(async()=>await page.locator('[data-workbench-chat-event]').filter({hasText:'插件聊天'}).count()===2);await toggle(custom,false);record('approved chat registry and named surfaces cover mounted/later instances, failed layer, disable/reenable and stale handles');
  await call('theme/set',{theme:'dark'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));const pane=page.getByTestId('toggle-translation-pane');if(await pane.getAttribute('aria-pressed')==='true')await pane.click();await openRecords();const visibleChat=page.locator('[data-workbench-chat-event]').last();await visibleChat.scrollIntoViewIfNeeded();const box=await visibleChat.boundingBox();assert.ok(box&&box.width>100&&box.x>=0&&box.x+box.width<=860);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await shot('chat-events-dark');
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,output}));
}catch(error){if(page)await shot('failure').catch(()=>{});await writeFile(path.join(output,'report.json'),JSON.stringify({passed:false,checks,rendererErrors:errors,error:String(error)},null,2));throw error;}finally{if(app)await app.close();}
