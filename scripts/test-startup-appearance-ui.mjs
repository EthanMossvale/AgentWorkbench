import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as bundle} from 'esbuild';
import {build} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {StateStore} from '../apps/desktop/host/store.ts';
import {resolveAppearance} from '../packages/appearance/index.ts';
import {UiPreferenceStore} from '../packages/ui-preferences/store.ts';
import {PluginRegistry} from '../packages/plugins-core/index.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';

// Production entry points; intercept OS reveal operations to leave the user's desktop alone.
const root=process.cwd(),output=path.resolve('build/qa/startup-appearance-'+Date.now()),appRoot=path.join(output,'app');
await mkdir(appRoot,{recursive:true});
await build({build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const name of ['main','preload'])await bundle({entryPoints:[`apps/desktop/host/${name}.ts`],outfile:path.join(appRoot,`host/${name}.cjs`),bundle:true,platform:'node',format:'cjs',external:['electron']});
await writeFile(path.join(appRoot,'probe.cjs'),`
const{BrowserWindow,ipcMain,nativeTheme}=require('electron');
global.qaPresentations=[];
global.qaGeometryPresentations=[];
const geometry=function(){global.qaGeometryPresentations.push(this.webContents.executeJavaScript('({mode:document.documentElement.dataset.theme,bg:getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()})'));};
BrowserWindow.prototype.maximize=geometry;
const fullscreen=BrowserWindow.prototype.setFullScreen;
BrowserWindow.prototype.setFullScreen=function(value){if(value)geometry.call(this);else fullscreen.call(this,value);};
BrowserWindow.prototype.show=function(){
 if(!this.webContents.getURL().endsWith('index.html'))return;
 global.qaPresentations.push(this.webContents.executeJavaScript('({mode:document.documentElement.dataset.theme,bg:getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),appearance:document.documentElement.dataset.appearance,plugin:window.qaPaletteReady===true})'));
};
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>handle(channel,async(...args)=>{if(channel==='workbench:call'&&['state/get','extensions/renderers'].includes(args[1]))await new Promise(r=>setTimeout(r,args[1]==='state/get'?650:1100));return listener(...args);});
require('./host/main.cjs');
`);
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'startup-appearance-qa',version:'0.1.0',main:'probe.cjs'}));
const data=path.join(output,'profile');await mkdir(data,{recursive:true});
let app;
const checks=[];
async function launch(expected){
 const env={...process.env,AGENT_WORKBENCH_TEST_DATA:data,AGENT_WORKBENCH_TEST_HIDDEN:'0'};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:root,env,timeout:45000});
 const page=await app.firstWindow();
 await page.waitForFunction(()=>document.documentElement.dataset.appearance==='enabled');
 await page.waitForFunction(async()=>(await window.workbench.call('plugin-recovery/status')).boot==='ready');
 // Wait on the actual first-show decision, never a fixed startup duration.
 for(let attempt=0;attempt<200;attempt++){
  if(await app.evaluate(()=>global.qaPresentations.length>0))break;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 const frames=await app.evaluate(async()=>Promise.all(global.qaPresentations));
 assert.equal(frames.length,1,'Exactly one initial presentation');assert.deepEqual(frames[0],expected);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);
 checks.push(expected);console.log('PASS first presentation '+JSON.stringify(expected));
 return page;
}
async function stop(){await app?.close();app=null;}
async function seed(theme,preset){const state=new StateStore(data);await state.load();await state.update(value=>{value.theme=theme;if(preset)value.appearance={...resolveAppearance(value.appearance),darkPreset:preset};});}
try{
 await launch({mode:'light',bg:'#faf9f6',appearance:'enabled',plugin:false});await stop();
 await seed('dark','builtin.abyss');
 await launch({mode:'dark',bg:'#17242e',appearance:'enabled',plugin:false});await stop();
 const prefs=new UiPreferenceStore(data);await prefs.load();
 for(const id of ['window.maximized','window.fullscreen'])await prefs.update({id,revision:prefs.get(id).revision,value:true});
 await launch({mode:'dark',bg:'#17242e',appearance:'enabled',plugin:false});
 assert.deepEqual(await app.evaluate(async()=>Promise.all(global.qaGeometryPresentations)),[{mode:'dark',bg:'#17242e'},{mode:'dark',bg:'#17242e'}]);
 console.log('PASS maximize/fullscreen cannot reveal the unrestored palette');await stop();
 for(const id of ['window.maximized','window.fullscreen'])await prefs.update({id,revision:prefs.get(id).revision,value:false});
 // Complete process restart with unchanged persisted preferences.
 await launch({mode:'dark',bg:'#17242e',appearance:'enabled',plugin:false});await stop();
 const registry=new PluginRegistry(data);await registry.initialize();
 const manifest={schemaVersion:1,apiVersion:1,id:'qa.startup',name:'Startup palette fixture',version:'1.0.0',description:'Synthetic isolated startup palette',capabilities:['host'],renderer:'renderer.mjs'};
 const zip=path.join(output,'palette.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'renderer.mjs',data:Buffer.from("export async function activate(api){await new Promise(r=>setTimeout(r,900));const h=api.themes.register({id:'night',label:'Night fixture',mode:'dark',base:'builtin.abyss',colors:{bg:'#192837'}});window.qaPaletteReady=true;return()=>{window.qaPaletteReady=false;h.dispose();};}")}]));
 await registry.importZip(zip);const record=(await registry.list()).find(r=>r.manifest.id===manifest.id);await registry.setEnabled(manifest.id,record.hash,true,true);await registry.dispose();
 await seed('dark','plugin:qa.startup/night');
 let page=await launch({mode:'dark',bg:'#192837',appearance:'enabled',plugin:true});
 const toggle=enabled=>page.evaluate(({id,hash,enabled})=>window.workbench.call('extensions/toggle',{id,hash,enabled,approveHost:true}),{id:manifest.id,hash:record.hash,enabled});
 await toggle(false);await page.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()==='#242424');
 assert.equal((await page.evaluate(()=>window.workbench.call('appearance/get'))).darkPreset,'plugin:qa.startup/night');
 await toggle(true);await page.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()==='#192837');
 assert.equal(await app.evaluate(()=>global.qaPresentations.length),1,'Reactivation must not show/focus again');
 await toggle(false);await stop();
 await launch({mode:'dark',bg:'#242424',appearance:'enabled',plugin:false});await stop();
 await seed('system','builtin.abyss');
 // Native system policy is asserted against the current OS, without changing it.
 const env={...process.env,AGENT_WORKBENCH_TEST_DATA:data,AGENT_WORKBENCH_TEST_HIDDEN:'0'};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:root,env});page=await app.firstWindow();
 await page.waitForFunction(async()=>(await window.workbench.call('plugin-recovery/status')).boot==='ready');
 await page.waitForFunction(()=>document.documentElement.dataset.appearance==='enabled');
 const mode=await app.evaluate(({nativeTheme})=>nativeTheme.shouldUseDarkColors?'dark':'light');
 await page.waitForFunction(mode=>document.documentElement.dataset.theme===mode,mode);
 const systemFrame=await app.evaluate(async()=>{while(!global.qaPresentations.length)await new Promise(r=>setTimeout(r,25));return Promise.all(global.qaPresentations);});
 assert.equal(systemFrame[0].mode,mode);assert.equal(systemFrame[0].bg,mode==='dark'?'#17242e':'#faf9f6');
 checks.push({system:mode});console.log('PASS system policy first presentation');
 await writeFile(path.join(output,'result.json'),JSON.stringify({checks},null,2));
}finally{await stop();}
console.log('PASS startup appearance; isolated evidence: '+output);
