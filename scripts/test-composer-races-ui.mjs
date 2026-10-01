import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),output=path.resolve(process.env.AWB_COMPOSER_RACES_QA??'build/qa/runtime-commands/races');await mkdir(output,{recursive:true});
const entry=`
import React,{useState,useRef}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{useComposerMenu}from'${root.replaceAll('\\','/')}/apps/desktop/renderer/ComposerMenu';
import{composerCommands}from'${root.replaceAll('\\','/')}/packages/composer-core';
import'${root.replaceAll('\\','/')}/apps/desktop/renderer/styles.css';
window.workbench={};window.pending=[];window.chosen=[];
window.__qaCall=(method,payload)=>new Promise((resolve,reject)=>{window.pending.push({method,payload,resolve,reject});});
window.finish=(index,error,wrongScope=false)=>{const q=window.pending[index],runtime=q.payload.runtime;if(error){q.reject(Error(error));return;}q.resolve({scope:wrongScope?'wrong-scope':q.payload.scope,commands:composerCommands(runtime,{compact:true}),skills:[{id:runtime+'-fixture',hash:'fixture',runtime,name:runtime+'-fixture',displayName:runtime+'-fixture',description:'Synthetic skill',source:runtime}]});};
function Fixture(){const[runtime,setRuntime]=useState('codex'),[text,setText]=useState('');const input=useRef(null);
window.setRuntime=value=>flushSync(()=>setRuntime(value));
const menu=useComposerMenu({runtime,sessionId:'same-session',directory:'',text,input,disabled:false,selected:[],onText:setText,onSkill:skill=>window.chosen.push(skill),onAction:(command,scope)=>window.chosen.push({command,scope})});
return <main style={{padding:30,height:'100vh',display:'flex',alignItems:'end'}}><div className="composer" style={{width:600}}>{menu.menu}<textarea ref={input} data-testid="input" value={text} {...menu.inputProps} onChange={e=>{setText(e.target.value);menu.detect(e.target.value,e.target.selectionStart);}} onKeyDown={menu.keyDown}/>{menu.button}</div></main>;
}createRoot(document.getElementById('root')).render(<Fixture/>);`;
await writeFile(path.join(output,'fixture.tsx'),entry);
await build({entryPoints:[path.join(output,'fixture.tsx')],outfile:path.join(output,'fixture.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'isolated-api',setup(b){b.onResolve({filter:/^\.\/App$/},()=>({path:'fixture-api',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:'export const api=(method,payload)=>window.__qaCall(method,payload);',loader:'js'}));}}]});
await writeFile(path.join(output,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
await writeFile(path.join(output,'main.cjs'),`const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output,'isolated-data'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:980,height:720,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(output,'index.html'))});});app.on('window-all-closed',()=>app.quit());`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let app,passed=false;const checks=[],errors=[];const mark=name=>{checks.push(name);console.log('PASS '+name);};
try{
  app=await electron.launch({executablePath:electronPath,args:[path.join(output,'main.cjs')],cwd:root,env});const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));const input=page.getByTestId('input'),menu=page.getByTestId('composer-menu');
  await input.fill('/');await page.waitForFunction(()=>window.pending.length===1);await page.evaluate(()=>window.setRuntime('claude'));await page.waitForFunction(()=>window.pending.length===2);assert.equal(await menu.getByRole('option').count(),0);await input.press('Enter');assert.equal(await page.evaluate(()=>window.chosen.length),0);
  await page.evaluate(()=>window.finish(1));await menu.getByRole('option',{name:/claude-fixture/}).waitFor();await page.evaluate(()=>window.finish(0));await page.waitForTimeout(80);assert.equal(await menu.getByRole('option',{name:/codex-fixture/}).count(),0);assert.equal(await menu.locator('[data-command=plan]').count(),1);mark('late Codex success cannot overwrite the Claude catalog, and loading Enter cannot execute stale rows');
  await page.evaluate(()=>window.setRuntime('codex'));await page.waitForFunction(()=>window.pending.length===3);await page.evaluate(()=>window.setRuntime('claude'));await page.waitForFunction(()=>window.pending.length===4);await page.evaluate(()=>window.finish(3));await menu.getByRole('option',{name:/claude-fixture/}).waitFor();await page.evaluate(()=>window.finish(2,'stale rejection'));await page.waitForTimeout(80);assert.equal(await menu.getByRole('alert').count(),0);assert.equal(await menu.getByRole('option',{name:/claude-fixture/}).count(),1);mark('a late failure from the previous runtime cannot replace the current menu with an error');
  await page.evaluate(()=>window.setRuntime('codex'));await page.waitForFunction(()=>window.pending.length===5);await page.evaluate(()=>window.finish(4,undefined,true));await menu.getByRole('alert').waitFor();assert.equal(await menu.getByRole('option').count(),0);mark('mismatched response scope fails closed with no executable catalog');
  await input.press('Escape');await page.getByTestId('composer-add').click();await page.waitForFunction(()=>window.pending.length===6);await page.evaluate(()=>window.finish(5));await menu.locator('[data-command=model]').waitFor();await menu.locator('[data-command=model]').click();const chosen=await page.evaluate(()=>window.chosen);assert.equal(chosen.length,1);assert.equal(chosen[0].command.runtime,'codex');assert.deepEqual(JSON.parse(chosen[0].scope),['same-session','codex','',null]);mark('explicit retry reads the current scope and invokes only the current runtime action');
  assert.deepEqual(errors,[]);passed=true;
}finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({passed,checks,errors,scope:'Real menu component in hidden Electron with deliberately reordered and rejected catalog responses.'},null,2));}
