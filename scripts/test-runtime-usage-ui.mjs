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
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),output=path.resolve(process.env.AWB_EVENT_QA??path.join(root,'build/qa/usage/ui-'+Date.now())),appRoot=path.join(output,'app'),dataDir=path.join(output,'data');
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
api.registerCommand('view',async({runtime,mode})=>api.services.get('workbench.state').update(state=>{const s=state.sessions.find(s=>s.id==='event-'+runtime),at=new Date().toISOString();if(mode==='start'){s.status='running';s.activities=[];s.nativeChildren=[];s.messages.push({id:'run-'+runtime,role:'user',original:'Grouping fixture',timestamp:at,demo:false});}else if(mode==='finish'){s.status='idle';s.nativeTurnStatus='completed';s.messages.push({id:'reply-'+runtime,role:'assistant',original:'Synthetic final response',timestamp:at,demo:false,phase:'final',nativeTurnEnd:true});s.turnTimings=[{id:'timing',userMessageId:'run-'+runtime,startedAt:new Date(Date.now()-654000).toISOString(),endedAt:at,status:'completed'}];}else if(mode==='boundary'){s.messages.push({id:'boundary-'+runtime,role:'assistant',original:'A new batch follows this commentary.',phase:'commentary',nativeTurnEnd:false,timestamp:at,demo:false});}else if(mode==='background-stop'){s.nativeTurnStatus='interrupted';s.nativeBackground={tasks:[],updatedAt:at,observing:false};}}));
api.onDispose(async()=>{for(const observation of observations.values())await observation.dispose();});}
`;

try {
  app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
  const source=await fixture('qa.usage-source',harness);await toggle(source,true);await command(source.manifest.id,'seed');
  await page.getByTestId('sidebar-session-event-claude').locator('.session-select').click();
  const emit=uuid=>command(source.manifest.id,'emit',{runtime:'claude',value:{type:'result',subtype:'success',is_error:false,uuid,duration_ms:26791,duration_api_ms:14731,num_turns:5,usage:{input_tokens:10,output_tokens:859,cache_read_input_tokens:45431,cache_creation_input_tokens:6284}}});
  await emit('first');await openRecords();const usage=page.locator('[data-workbench-runtime-usage]');await usage.first().waitFor({state:'attached'});await openRecords();
  const details=page.locator('[data-workbench-runtime-usage]').first().locator('xpath=ancestor::details[1]');if(!await details.evaluate(n=>n.open))await details.locator('summary').click();await openRecords();await usage.first().waitFor();
  assert.match(await usage.first().innerText(),/26.8 秒/);assert.match(await usage.first().innerText(),/45,431 tokens/);assert.doesNotMatch(await usage.first().innerText(),/durationMs|inputTokens|\{/);
  await shot('usage-readable-light');record('native result is readable in the production renderer; counters retain native semantics');
  const plugin=await fixture('qa.usage-display',undefined,
    "export function activate(api){window.__usage={late:[],cleaned:0};api.observeSurfaces('runtime-usage','replace',({root,target})=>{root.dataset.qaUsage='true';root.textContent='Custom stats '+target.dataset.activityId;return()=>window.__usage.cleaned++;});api.observeSurfaces('runtime-usage','after',async()=>{await new Promise(r=>window.__usage.late.push(r));return()=>window.__usage.cleaned++;});}");
  await toggle(plugin,true);await until(async()=>await page.locator('[data-qa-usage]').count()===1);assert.equal(await usage.first().evaluate(n=>n.hidden),true);
  await emit('second');await until(async()=>await page.locator('[data-qa-usage]').count()===2);await toggle(plugin,false);await until(async()=>await page.locator('[data-qa-usage]').count()===0);await page.evaluate(()=>window.__usage.late.splice(0).forEach(r=>r()));await until(async()=>await page.evaluate(()=>window.__usage.cleaned===4));assert.equal(await usage.evaluateAll(nodes=>nodes.every(n=>!n.hidden)),true);
  await toggle(plugin,true);await until(async()=>await page.locator('[data-qa-usage]').count()===2);await toggle(plugin,false);await until(async()=>await page.locator('[data-qa-usage]').count()===0);record('approved plugin replaces existing/later instances and disable/reenable restores core; late mounts clean up');
  await call('theme/set',{theme:'dark'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,740));await page.locator('.workspace-split.compact-split').waitFor();const paneToggle=page.getByTestId('toggle-translation-pane');if(await paneToggle.getAttribute('aria-pressed')==='true')await paneToggle.click();await openRecords();await usage.first().scrollIntoViewIfNeeded();await shot('usage-readable-dark-narrow');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // Stored activity JSON and the existing disclosure preference survive full process exit.
  await app.close();app=undefined;
  app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(10000);await page.waitForFunction(()=>!!window.workbench);
  await page.getByTestId('sidebar-session-event-claude').locator('.session-select').click();await openRecords();await page.locator('[data-workbench-runtime-usage]').first().waitFor({state:'attached'});
  await until(()=>page.locator('[data-workbench-runtime-usage]').first().locator('xpath=ancestor::details[1]').evaluate(n=>n.open));assert.match(await page.locator('[data-workbench-runtime-usage]').first().innerText(),/26.8 秒/);record('saved JSON history and existing disclosure state survive full exit/restart');
  await page.getByTestId('sidebar-session-event-codex').locator('.session-select').click();assert.equal(await page.locator('[data-workbench-runtime-usage]').count(),0);record('Codex does not acquire synthetic completion statistics');
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'result.json'),JSON.stringify({checks},null,2));console.log('QA_OUTPUT='+output);
} catch(error) {console.log(await page.locator('[data-workbench-runtime-usage]').first().evaluate(n=>{const a=[];for(let p=n;p;p=p.parentElement)a.push([p.tagName,p.className,p.hidden,p.open,getComputedStyle(p).display]);return a}));throw error;} finally {await app?.close();}
