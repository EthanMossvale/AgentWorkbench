import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Real Workspace in hidden Electron; App-style keyed navigation and a scripted host. No model calls.
const root=process.cwd(),base=root.replaceAll('\\','/'),output=path.resolve(process.env.AWB_DRAFT_HANDOFF_QA??'build/qa/draft-handoff');
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'fixture.tsx'),`
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import Workspace from '${base}/apps/desktop/renderer/Workspace';
import '${base}/apps/desktop/renderer/styles.css';import '${base}/apps/desktop/renderer/WorkspaceChrome.css';
const state={version:1,theme:'light',sessions:[],projects:[],hosts:[],profiles:[],plugins:{translation:{enabled:false}},translation:{},collaboration:{sessions:[],messages:[],outbox:[],pending:[]},modelConnections:[],runtimeExtensions:[],activeWorkspaceId:'fixture-host'};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
window.qaCalls=[];window.qaPending={};
window.__qaCall=async(method,payload)=>{
  window.qaCalls.push({method,payload});
  if(method==='local-cli/list')return[{runtime:'claude',installed:true}];
  if(method==='draft/prepare'){const d=deferred();window.qaPending.prepare=d;return d.promise;}
  if(method==='draft/submit')return{accepted:true};
  return method==='state/get'?state:[];
};
window.workbench={call:window.__qaCall,onExtensions:()=>()=>{},onState:()=>()=>{},onNavigate:()=>()=>{},onCommand:()=>()=>{}};
const draft={runtime:'claude',projectId:null,projectPath:'',hostId:'fixture-host',permissionMode:'default'};
let created=0;
function Host(){
  const[view,setView]=useState({key:1,sessionId:''}),[,setTick]=useState(0);
  window.qaNavigate=sessionId=>setView(current=>({key:current.key+1,sessionId}));
  window.qaTranslation=enabled=>{state.plugins={translation:{enabled}};setTick(n=>n+1);};
  const ensureSession=()=>{
    const d=deferred(),key=view.key;window.qaPending.create=d;
    return d.promise.then(()=>{
      const id='created-'+(++created),now=new Date().toISOString();
      const session={id,title:'新的 Claude 任务',binding:{runtime:'claude',egress:'vps',provider:'fixture',accountRef:'fixture',executionId:'local',hostId:'fixture-host'},status:'idle',nativeReady:true,messages:[],activities:[],createdAt:now,projectId:null,projectPath:'',pinned:false,archived:false,group:''};
      state.sessions=[...state.sessions,session];
      // Same rule as App: creation selects its session only while that view is still shown.
      setView(current=>current.key===key?{...current,sessionId:id}:current);setTick(n=>n+1);
      return session;
    });
  };
  const session=state.sessions.find(item=>item.id===view.sessionId);
  return <div className="qa-workspace"><Workspace key={view.key} state={{...state}} session={session} draft={draft} active onDraftChange={()=>{}} onSwitchDraft={()=>{}} onCreateProject={()=>{}} ensureSession={ensureSession} report={e=>{window.qaReported=String(e?.message??e);}} notify={()=>{}} refresh={async()=>state} onFork={async()=>{}} forkingId="" onOpenSource={()=>{}}/></div>;
}
createRoot(document.getElementById('root')).render(<Host/>);
window.qaReady=true;
`);
await build({entryPoints:[path.join(output,'fixture.tsx')],outfile:path.join(output,'fixture.js'),bundle:true,format:'esm',external:['awb-font://*'],platform:'browser',jsx:'automatic',loader:{'.ttf':'file'},alias:{'monaco-codicons':path.join(root,'node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css')},plugins:[{name:'isolated-api',setup(b){b.onResolve({filter:/^\.\/CodePreview$/},()=>({path:'unused',namespace:'preview'}));b.onLoad({filter:/.*/,namespace:'preview'},()=>({contents:'export default function Preview(){return null}',loader:'js'}));b.onResolve({filter:/^\.\/App$/},()=>({path:'fixture-api',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:'export const api=(method,payload)=>window.__qaCall(method,payload);',loader:'js'}));}}]});
await writeFile(path.join(output,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>.qa-workspace{height:100vh;width:100vw;display:flex}.qa-workspace>.workspace{min-width:0;flex:1}</style></head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>');
await writeFile(path.join(output,'main.cjs'),'const{app,BrowserWindow}=require("electron");app.setPath("userData",'+JSON.stringify(path.join(output,'isolated-data'))+');app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1100,height:780,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});w.loadFile('+JSON.stringify(path.join(output,'index.html'))+');});app.on("window-all-closed",()=>app.quit());');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let app,passed=false;const checks=[],errors=[];const record=name=>{checks.push(name);console.log('PASS '+name);};
try{
  app=await electron.launch({executablePath:process.env.AWB_ELECTRON??electronPath,args:[path.join(output,'main.cjs')],env,cwd:root});
  const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>window.qaReady);
  const input=page.getByTestId('composer-input'),calls=method=>page.evaluate(method=>window.qaCalls.filter(call=>call.method===method).map(call=>call.payload),method);
  // Waits for the keyed remount to commit, like a click-driven navigation in App.
  const navigate=async id=>{await page.evaluate(id=>{document.querySelector('[data-testid=composer-input]').dataset.qaPrevious='1';window.qaNavigate(id);},id);await page.waitForFunction(()=>{const area=document.querySelector('[data-testid=composer-input]');return !!area&&!area.dataset.qaPrevious;});};

  // Direct send: leave while the session is still being created.
  await input.fill('第一条请求');await input.press('Enter');
  await page.waitForFunction(()=>!!window.qaPending.create);
  await navigate('');
  await page.evaluate(()=>window.qaPending.create.resolve());
  await page.waitForFunction(()=>window.qaCalls.some(call=>call.method==='draft/prepare'));
  assert.equal((await calls('draft/prepare'))[0].text,'第一条请求');
  await page.evaluate(()=>window.qaPending.prepare.resolve({id:'preview-1',original:'第一条请求',translated:'第一条请求',sourceHash:'hash-1',revision:0,bypass:true,moduleDisabled:true}));
  await page.waitForFunction(()=>window.qaCalls.some(call=>call.method==='draft/submit'));
  const [submitted]=await calls('draft/submit');assert.equal(submitted.sessionId,'created-1');assert.equal(submitted.id,'preview-1');
  assert.deepEqual(await calls('draft/cancel'),[]);assert.equal(await input.inputValue(),'');
  record('a direct send started before switching away still creates the session, prepares and submits in the background');

  // Reviewed send: the preview arrives after leaving and waits in the session for confirmation.
  await page.evaluate(()=>{window.qaCalls.length=0;window.qaPending={};window.qaTranslation(true);});
  await input.fill('第二条请求');await input.press('Enter');
  await page.waitForFunction(()=>!!window.qaPending.create);await page.evaluate(()=>window.qaPending.create.resolve());
  await page.waitForFunction(()=>!!window.qaPending.prepare);
  await navigate('created-1');
  await page.evaluate(()=>window.qaPending.prepare.resolve({id:'preview-2',original:'第二条请求',translated:'Second request',sourceHash:'hash-2',revision:0,bypass:false,moduleDisabled:false}));
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.draft-review-modal').count(),0);assert.deepEqual(await calls('draft/submit'),[]);
  record('a translated preview is never sent without confirmation and does not open over another session');
  await navigate('created-2');
  await page.locator('.draft-review-modal').waitFor();
  assert.equal(await input.inputValue(),'第二条请求');
  await page.getByTestId('submit-draft').click();
  await page.waitForFunction(()=>window.qaCalls.some(call=>call.method==='draft/submit'));
  const [reviewed]=await calls('draft/submit');assert.equal(reviewed.sessionId,'created-2');assert.equal(reviewed.id,'preview-2');assert.deepEqual(await calls('draft/cancel'),[]);
  record('returning to the new session restores the original text and the pending preview, which then submits on confirmation');

  // Failed preparation after leaving: the original text comes back with the error.
  await page.evaluate(()=>{window.qaCalls.length=0;window.qaPending={};window.qaTranslation(false);});await navigate('');
  await input.fill('第三条请求');await input.press('Enter');
  await page.waitForFunction(()=>!!window.qaPending.create);await page.evaluate(()=>window.qaPending.create.resolve());
  await page.waitForFunction(()=>!!window.qaPending.prepare);
  await navigate('');
  await page.evaluate(()=>window.qaPending.prepare.reject(Error('合成准备失败')));
  await page.waitForTimeout(100);
  await navigate('created-3');
  await page.getByText('合成准备失败').waitFor();assert.equal(await input.inputValue(),'第三条请求');assert.deepEqual(await calls('draft/submit'),[]);
  record('a failure after leaving restores the unsent text in its session with the error');

  assert.deepEqual(errors,[]);record('zero renderer errors');passed=true;
}finally{await app?.close();await writeFile(path.join(output,'report.json'),JSON.stringify({passed,checks,errors,realModelCalls:0,scope:'Real Workspace component, keyed navigation like App, scripted host responses.'},null,2));}
