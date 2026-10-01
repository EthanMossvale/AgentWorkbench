import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd(),base=root.replaceAll('\\','/'),output=path.resolve('build/qa/session-feedback-following');
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'fixture.tsx'),`
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import Workspace from '${base}/apps/desktop/renderer/Workspace';
import{startPluginRenderers}from'${base}/apps/desktop/renderer/plugin-renderer';
import{recordSessionUsage,sessionMetrics}from'${base}/packages/session-metrics';
import{observeTurnTiming}from'${base}/packages/session-core/turn-timing';
import '${base}/apps/desktop/renderer/styles.css';import '${base}/apps/desktop/renderer/WorkspaceChrome.css';
import '${base}/apps/desktop/renderer/Appearance.css';import '${base}/apps/desktop/renderer/LightTheme.css';
const root=createRoot(document.getElementById('root')),state={version:1,theme:'light',sessions:[],projects:[],hosts:[],profiles:[],plugins:{translation:{enabled:false}},translation:{},collaboration:{sessions:[],messages:[],outbox:[],pending:[]},modelConnections:[],runtimeExtensions:[]};
window.workbench={call:async(m,p)=>m==='state/get'?state:m==='session/metrics'?sessionMetrics(state.sessions.find(s=>s.id===p.sessionId)):m.startsWith('extensions/')||m.startsWith('plugin-recovery/')?window.qaBridge.call(m,p):[],onExtensions:window.qaBridge.onExtensions,onState:()=>()=>{},onNavigate:()=>()=>{},onCommand:()=>()=>{}};
window.__qaCall=window.workbench.call;
function render(){flushSync(()=>root.render(<div className="qa-workspace">{state.sessions.map(s=><Workspace key={s.id} state={{...state}} session={s} draft={{runtime:s.binding.runtime,projectId:null,projectPath:''}} active={false} onDraftChange={()=>{}} onSwitchDraft={()=>{}} onCreateProject={()=>{}} ensureSession={async()=>s} report={e=>{throw e}} notify={()=>{}} refresh={async()=>state} onFork={async()=>{}} forkingId="" onOpenSource={()=>{}}/>)}</div>));}
window.qaShow=(runtime='codex')=>{
 const start=new Date(Date.now()-344000).toISOString(),s={id:'following',title:'长回合进度',binding:{runtime,egress:'vps',provider:'fixture',accountRef:'fixture',executionId:'local'},status:'running',nativeTurnId:'first',messages:[{id:'u',role:'user',original:'检查这些文件。',nativeTurnId:'first',timestamp:start}],activities:[],createdAt:start,projectId:null,pinned:false,archived:false,group:'',turnTimings:[{id:'timing-first',startedAt:start,userMessageId:'u',nativeTurnId:'first',status:'running'}]};
 for(let n=0;n<55;n++)s.messages.push({id:'p'+n,role:'assistant',original:'正在核对第 '+(n+1)+' 项文件，读取结果并检查关联内容。',nativeTurnId:'first',phase:'commentary',nativeTurnEnd:false,timestamp:new Date(Date.parse(start)+n*1000+1).toISOString()});
 recordSessionUsage(s,{id:'paired',model:'fixture-model',inputTokens:2011238,outputTokens:14994,totalTokens:2026232,cacheReadTokens:1817370,cacheWriteTokens:null},{source:'fixture',turnId:'first',at:start});
 recordSessionUsage(s,{id:'missing',model:'fixture-model',inputTokens:null,outputTokens:null,totalTokens:null,cacheReadTokens:null,cacheWriteTokens:null},{source:'fixture',turnId:'first',at:start});
 s.fileChangeRecords=[{activityId:'edit',userMessageId:'u',turnId:'first',at:start,changes:[{path:'src/example.ts',kind:'modify',additions:1,deletions:1,diff:['@@','-old','+new'].join(String.fromCharCode(10))}]}];
 state.sessions=[s];render();
};
window.qaAppend=()=>{const s=state.sessions[0];s.messages.push({id:'later'+s.messages.length,role:'assistant',original:'新的过程输出。',phase:'commentary',nativeTurnEnd:false,nativeTurnId:s.nativeTurnId,timestamp:new Date().toISOString()});render();};
window.qaFinish=(outcome='completed')=>{const s=state.sessions[0],previous=structuredClone(s);s.status=outcome==='uncertain'?'uncertain':'idle';s.nativeTurnStatus=outcome;if(outcome==='failed'||outcome==='uncertain')s.nativeError='Synthetic upstream interruption.';
 if(outcome==='completed'){const m=s.messages.findLast(m=>m.role==='assistant');m.original='检查完成，这是最终结果。';m.phase='final';m.nativeTurnEnd=true;}
 observeTurnTiming(previous,s,new Date().toISOString());render();};
window.qaNext=()=>{const s=state.sessions[0],previous=structuredClone(s);s.status='running';s.nativeTurnId='second';s.nativeTurnStatus='inProgress';s.nativeError=undefined;s.messages.push({id:'u2',role:'user',original:'开始下一轮。',nativeTurnId:'second',timestamp:new Date().toISOString()});observeTurnTiming(previous,s,new Date().toISOString());render();};
window.qaSecond=()=>{const s=structuredClone(state.sessions[0]);s.id='other';state.sessions.push(s);render();};
window.qaRemoveSecond=()=>{state.sessions.splice(1);render();};
window.qaUnfinishedFinal=()=>{const s=state.sessions[0],m=s.messages.at(-1);m.phase='final';m.nativeTurnEnd=false;render();};
window.qaReady=true;window.qaDispose=startPluginRenderers(window.workbench,document.getElementById('root'));
`);
await build({entryPoints:[path.join(output,'fixture.tsx')],outfile:path.join(output,'fixture.js'),bundle:true,format:'esm',external:['awb-font://*'],platform:'browser',jsx:'automatic',loader:{'.ttf':'file'},alias:{'monaco-codicons':path.join(root,'node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css')},plugins:[{name:'isolated-api',setup(b){b.onResolve({filter:/^\.\/CodePreview$/},()=>({path:'unused',namespace:'preview'}));b.onLoad({filter:/.*/,namespace:'preview'},()=>({contents:'export default function Preview(){return null}',loader:'js'}));b.onResolve({filter:/^\.\/App$/},()=>({path:'fixture-api',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:'export const api=(method,payload)=>window.__qaCall(method,payload);',loader:'js'}));}}]});
await writeFile(path.join(output,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>.qa-workspace{height:100vh;width:100vw;display:flex}.qa-workspace>.workspace{min-width:0;flex:1}</style></head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>');
await writeFile(path.join(output,'preload.cjs'),`const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('qaBridge',{call:(m,p)=>ipcRenderer.invoke('qa:call',m,p),onExtensions:fn=>{const listener=()=>fn();ipcRenderer.on('qa:extensions',listener);return()=>ipcRenderer.removeListener('qa:extensions',listener);}});`);
await writeFile(path.join(output,'host.ts'),`
import{app,BrowserWindow,ipcMain}from'electron';import path from'node:path';import{writeFile}from'node:fs/promises';
import{PluginRegistry}from'${base}/packages/plugins-core';import{encodeZip}from'${base}/packages/native-resources/archive';
const dir=${JSON.stringify(path.join(output,'isolated-'+Date.now()))};app.setPath('userData',dir);
app.whenReady().then(async()=>{let window;const registry=new PluginRegistry(path.join(dir,'plugins'),()=>window?.webContents.send('qa:extensions'));await registry.initialize();
ipcMain.handle('qa:call',async(_e,m,p)=>{if(m==='extensions/renderers')return registry.renderers();if(m==='plugin-recovery/renderer-failed')return registry.rendererFailed(p.id,p.hash);if(m.startsWith('plugin-recovery/renderer-'))return null;
if(m==='qa/import'){const manifest={schemaVersion:1,apiVersion:1,id:p.id,name:p.id,version:'1.0.0',description:'Synthetic session feedback',capabilities:['host'],renderer:'renderer.mjs'};const zip=path.join(dir,p.id+'.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'renderer.mjs',data:Buffer.from(p.source)}]));await registry.importZip(zip);return;}
if(m==='qa/toggle'){const r=(await registry.list()).find(r=>r.manifest.id===p.id);await registry.setEnabled(p.id,r.hash,p.enabled,p.approve===true);return;}
if(m==='qa/list')return registry.list();throw Error('Unexpected test bridge method: '+m);});
window=new BrowserWindow({show:false,width:1100,height:780,webPreferences:{preload:${JSON.stringify(path.join(output,'preload.cjs'))},contextIsolation:true,offscreen:true,backgroundThrottling:false}});await window.loadFile(${JSON.stringify(path.join(output,'index.html'))});app.on('before-quit',()=>{void registry.dispose()});});app.on('window-all-closed',()=>app.quit());
`);
await build({entryPoints:[path.join(output,'host.ts')],outfile:path.join(output,'host.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron']});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let app;const checks=[],errors=[];
const pass=name=>{checks.push(name);console.log('PASS '+name);};
try{
 app=await electron.launch({executablePath:electronPath,args:[path.join(output,'host.cjs')],env,cwd:root});const page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>window.qaReady);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 const dock=page.locator('[data-active-turn-progress]'),pane=page.getByTestId('original-pane');
 const geometry=()=>dock.boundingBox();
 for(const runtime of ['codex','claude']){
  await page.evaluate(runtime=>window.qaShow(runtime),runtime);await dock.locator('[data-turn-progress]').waitFor();
  const initial=await geometry();assert.ok(initial&&initial.y>=0);
  assert.equal(await pane.locator('[data-turn-progress].is-active').count(),0);
  await pane.evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll',{bubbles:true}));});await page.evaluate(()=>window.qaAppend());
  assert.ok(Math.abs((await geometry()).y-initial.y)<2);assert.equal(await pane.evaluate(e=>e.scrollTop),0);
  await pane.hover();await page.mouse.wheel(0,500);await page.waitForTimeout(100);const userPosition=await pane.evaluate(e=>e.scrollTop);assert.ok(userPosition>0);
  await page.evaluate(()=>window.qaAppend());assert.ok(Math.abs((await pane.evaluate(e=>e.scrollTop))-userPosition)<2);assert.ok(Math.abs((await geometry()).y-initial.y)<2);
  pass(runtime+' long output and manual wheel scrolling preserve the active timer and reading position');
  await page.evaluate(()=>window.qaUnfinishedFinal());assert.equal(await page.getByTestId('turn-process').evaluate(n=>n.open),true);assert.equal(await dock.count(),1);await page.getByTestId('turn-process').evaluate(n=>window.qaProcessNode=n);
  await page.evaluate(()=>window.qaFinish());await page.getByTestId('turn-process').waitFor();assert.equal(await dock.count(),0);assert.equal(await page.getByTestId('turn-process').evaluate(n=>n.open&&n===window.qaProcessNode),true);
  assert.equal(await pane.getByText('检查完成，这是最终结果。',{exact:true}).isVisible(),true);assert.equal(await page.getByTestId('file-change-card').isVisible(),true);await page.screenshot({path:path.join(output,'completed-'+runtime+'.png')});await page.getByTestId('turn-process').locator(':scope > summary').click();assert.equal(await pane.getByText('新的过程输出。',{exact:true}).isVisible(),false);await page.getByTestId('turn-process').locator(':scope > summary').click();assert.ok(await pane.getByText('新的过程输出。',{exact:true}).count());
  pass(runtime+' final reply preserves the live process node and expansion; users can still fold and reopen history');
 }
 await page.evaluate(()=>window.qaShow());await page.getByRole('button',{name:'会话用量明细',exact:true}).click();await page.getByTestId('session-metrics-details').waitFor();
 assert.match(await page.getByTestId('session-metrics').innerText(),/缓存命中 90.4%/);assert.match(await page.locator('.session-metrics-cache').innerText(),/90.4%/);
 await page.screenshot({path:path.join(output,'cache-light.png')});await page.keyboard.press('Escape');pass('partial history reports a normal token-weighted 90.4% in both footer and detail');
 for(const outcome of ['interrupted','uncertain','failed']){
  await page.evaluate(()=>window.qaShow());await page.evaluate(outcome=>window.qaFinish(outcome),outcome);
  assert.equal(await dock.count(),0);assert.equal(await page.getByTestId('turn-process').evaluate(n=>n.open),true);
  assert.equal(await page.getByTestId('turn-process').locator(':scope > summary [data-turn-progress]').count(),1);
  assert.equal(await page.getByTestId('file-change-card').getAttribute('data-turn-id'),'u');
  if(outcome!=='interrupted')assert.equal(await page.getByText('Synthetic upstream interruption.',{exact:true}).count(),1);
  await pane.evaluate(e=>{e.scrollTop=e.scrollHeight;});await page.screenshot({path:path.join(output,'ended-'+outcome+'.png')});
  await page.evaluate(()=>window.qaNext());await dock.locator('[data-turn-progress]').waitFor();
  assert.equal(await page.getByTestId('file-change-card').count(),1);assert.equal(await page.getByTestId('file-change-card').getAttribute('data-turn-id'),'u');
  if(outcome!=='interrupted')assert.equal(await page.locator('[data-turn-error][data-turn-id="u"]').innerText(),'Synthetic upstream interruption.');
  assert.equal(await dock.count(),1);assert.equal(await dock.locator('[data-turn-progress]').getAttribute('data-turn-id'),'u2');assert.match(await dock.innerText(),/已处理 [0-3] 秒/);assert.doesNotMatch(await dock.innerText(),/5 分/);pass(outcome+' then a new message replaces the old dock and starts a fresh clock');
 }
 await page.evaluate(()=>{window.qaShow();document.documentElement.dataset.theme='dark';});await page.screenshot({path:path.join(output,'running-dark.png')});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(420,680));await page.waitForTimeout(100);const box=await geometry();assert.ok(box.x>=0&&box.x+box.width<=420);assert.ok(box.y+box.height<680);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'running-narrow.png')});pass('running timer fits dark and narrow layouts above the composer');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,780));
 const call=(m,p)=>page.evaluate(([m,p])=>window.qaBridge.call(m,p),[m,p]);
 const source=`export function activate(api){for(const surface of ['turn-progress','turn-process','session-metrics'])api.observeSurfaces(surface,'replace',async({root,target,signal})=>{root.textContent='Extension '+surface;root.dataset.qaFeedback=surface;await new Promise(r=>setTimeout(r,50));return()=>{window.qaCleanup=(window.qaCleanup||0)+1;};});}`;
 await call('qa/import',{id:'test.feedback',source});assert.equal(await page.locator('[data-qa-feedback]').count(),0);
 await call('qa/toggle',{id:'test.feedback',enabled:true,approve:true});await page.locator('[data-qa-feedback="turn-progress"]').waitFor();assert.equal(await dock.locator('[data-turn-progress]').isVisible(),false);
 await call('qa/import',{id:'test.feedback-overlay',source:`export function activate(api){api.observeSurfaces('active-turn-progress','replace',({root})=>{root.textContent='Overlay clock'});api.observeSurfaces('turn-error','after',({root})=>{root.textContent='Error extension'});}`});
 await call('qa/toggle',{id:'test.feedback-overlay',enabled:true,approve:true});await page.getByText('Overlay clock',{exact:true}).waitFor();assert.equal(await dock.isVisible(),false);
 await call('qa/toggle',{id:'test.feedback-overlay',enabled:false});await page.locator('[data-qa-feedback="turn-progress"]').waitFor();
 pass('a second approved plugin replaces the active dock and disabling it reveals the existing timer extension');
 await page.evaluate(()=>window.qaSecond());await page.waitForFunction(()=>document.querySelectorAll('[data-qa-feedback="turn-progress"]').length===2);await page.evaluate(()=>window.qaRemoveSecond());await page.waitForFunction(()=>document.querySelectorAll('[data-qa-feedback="turn-progress"]').length===1);
 await page.evaluate(()=>window.qaFinish());await page.locator('[data-qa-feedback="turn-process"]').waitFor();await call('qa/toggle',{id:'test.feedback',enabled:false});await page.waitForFunction(()=>!document.querySelector('[data-qa-feedback]'));assert.equal(await page.getByTestId('turn-process').isVisible(),true);assert.ok(await page.evaluate(()=>window.qaCleanup)>0);
 await call('qa/toggle',{id:'test.feedback',enabled:true});await page.locator('[data-qa-feedback="turn-process"]').waitFor();await call('qa/toggle',{id:'test.feedback',enabled:false});await page.waitForFunction(()=>!document.querySelector('[data-qa-feedback]'));
 pass('approved ZIP activates actual named surfaces, handles added/removed instances, and restores after disable/re-enable');
 await call('qa/toggle',{id:'test.feedback-overlay',enabled:true});await page.evaluate(()=>{window.qaShow();window.qaFinish('failed')});await page.getByText('Error extension',{exact:true}).waitFor();assert.equal(await page.locator('[data-turn-error]').innerText(),'Synthetic upstream interruption.');await call('qa/toggle',{id:'test.feedback-overlay',enabled:false});await page.getByText('Error extension',{exact:true}).waitFor({state:'detached'});
 pass('later terminal errors expose their named surface without changing the saved explanation');
 await call('qa/import',{id:'test.feedback-failed',source:`export function activate(api){api.observeSurfaces('turn-progress','replace',({root})=>{root.textContent='Failed replacement'});throw Error('Synthetic registration failure')}`});await call('qa/toggle',{id:'test.feedback-failed',enabled:true,approve:true});await page.waitForFunction(async()=>!(await window.qaBridge.call('qa/list')).find(p=>p.manifest.id==='test.feedback-failed').enabled);assert.equal(await page.getByText('Failed replacement',{exact:true}).count(),0);assert.equal(await page.locator('[data-turn-progress]').isVisible(),true);pass('failed plugin activation releases the timer replacement');
 assert.deepEqual(errors,[]);pass('zero renderer errors');
}finally{await app?.close();await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,realModelCalls:0},null,2));}
