import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd(),output=path.resolve(process.env.AWB_MEMORY_UI_QA??'build/qa/memory-receipt-20260930/ui');await mkdir(output,{recursive:true});
const entry=`import React from 'react';import{createRoot}from'react-dom/client';
import NativeMemorySettings from '${root.replaceAll('\\','/')}/apps/desktop/renderer/NativeMemorySettings';
import '${root.replaceAll('\\','/')}/apps/desktop/renderer/styles.css';
const task={id:'fixture',runtime:'claude',model:'fixture-model',permissionMode:'full-access',submissionKey:'a'.repeat(64),state:'blocked',createdAt:'2026-09-28T05:00:00Z',processed:10,total:120,reason:'MEMORY_BACKGROUND_RECEIPT_UNVERIFIED',receiptIssues:['MEMORY_RECEIPT_INDEX_PROVENANCE','MEMORY_RECEIPT_ALREADY_PRESENT_MISMATCH']};
window.qaCalls=[];window.qaStatus={enabled:true,running:false,sourceCount:125,uniqueCount:125,needsInitialImport:false,pendingCodex:11,pendingClaude:115,acknowledgedCount:10,handoffError:'Existing evidence does not contain the archived knowledge; semantic deduplication needs a native reference.',backgroundTasks:[task]};
window.__qaCall=async method=>{window.qaCalls.push(method);if(method==='native-memory/get')return structuredClone(window.qaStatus);if(method==='native-memory/settings/get')return ['codex','claude'].map(runtime=>({runtime,installed:true,enabled:true,allowToolChats:true,canWrite:true,canWriteToolChats:true}));throw Error('Unexpected call '+method);};
createRoot(document.getElementById('root')).render(<div className="qa-settings"><NativeMemorySettings report={error=>{throw error}} notify={()=>{}}/></div>);
`;
await writeFile(path.join(output,'fixture.tsx'),entry);
await build({entryPoints:[path.join(output,'fixture.tsx')],outfile:path.join(output,'fixture.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'isolated-api',setup(builder){builder.onResolve({filter:/^\.\/App$/},()=>({path:'fixture-api',namespace:'qa'}));builder.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:'export const api=(method,payload)=>window.__qaCall(method,payload);',loader:'js'}));}}]});
await writeFile(path.join(output,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>.qa-settings{max-width:1000px;margin:auto;padding:32px 28px;min-height:100vh}body{overflow:auto}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
await writeFile(path.join(output,'main.cjs'),'const{app,BrowserWindow}=require("electron");app.setPath("userData",'+JSON.stringify(path.join(output,'isolated-data'))+');app.whenReady().then(()=>{const window=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});window.loadFile('+JSON.stringify(path.join(output,'index.html'))+');});app.on("window-all-closed",()=>app.quit());');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let app;const checks=[],errors=[];const record=name=>{checks.push(name);console.log('PASS '+name);};
try{
  app=await electron.launch({executablePath:electronPath,args:[path.join(output,'main.cjs')],cwd:root,env});const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  const issues=page.getByTestId('memory-receipt-issues');await issues.waitFor();
  assert.match(await issues.innerText(),/索引链接缺少来源标记/);assert.match(await issues.innerText(),/误报为「原文已存在」/);
  assert.match(await page.getByTestId('memory-background-tasks').innerText(),/已核验 10\/120/);record('partial progress and both receipt failures are explained separately');
  assert.match(await page.getByRole('alert').innerText(),/误报为「原文已存在」/);record('historical error text receives a specific localized explanation');
  await page.screenshot({path:path.join(output,'receipt-light.png'),fullPage:true});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));await page.evaluate(()=>document.documentElement.dataset.theme='dark');await issues.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'receipt-dark-narrow.png'),fullPage:true});record('light and dark narrow layouts retain readable wrapped diagnostics');
  await page.evaluate(()=>{delete window.qaStatus.backgroundTasks[0].receiptIssues;window.qaStatus.handoffError=undefined;window.dispatchEvent(new Event('focus'));});await issues.waitFor({state:'detached'});
  assert.match(await page.getByTestId('memory-background-tasks').innerText(),/文件或索引回执未通过核验/);record('legacy task journals without typed issues keep their original fallback');
  await page.evaluate(()=>{Object.assign(window.qaStatus.backgroundTasks[0],{state:'completed',processed:120,receiptIssues:[],reason:undefined});window.dispatchEvent(new Event('focus'));});
  await page.getByText('已核验完成',{exact:true}).waitFor();assert.equal(await issues.count(),0);assert.equal(await page.getByRole('alert').count(),0);
  assert.ok((await page.evaluate(()=>window.qaCalls)).every(name=>['native-memory/get','native-memory/settings/get'].includes(name)));record('completion clears diagnostics and viewing never submits a model task');
  assert.deepEqual(errors,[]);
}finally{await app?.close();await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,scope:'Hidden isolated Electron with synthetic task metadata; no active client or real model calls.'},null,2));}
