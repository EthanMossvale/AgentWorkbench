// Isolated hidden Electron; production usage/controller/preferences, synthetic numeric receipts only.
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build} from 'vite';
import {build as bundle} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd().replaceAll('\\','/'),output=path.resolve('build/qa/model-cost-ui-'+Date.now()),data=path.join(output,'profile');
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'fixture.tsx'),`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import ModelUsageSummary from '${root}/apps/desktop/renderer/ModelUsageSummary';
import {uiPreferences} from '${root}/apps/desktop/renderer/ui-preferences';
import '${root}/apps/desktop/renderer/styles.css';import '${root}/apps/desktop/renderer/LightTheme.css';
const scopes=[{kind:'api',id:'fixture-api'},{kind:'account',id:'11111111-1111-4111-a111-111111111111'},{kind:'translation',id:'translation'}];
function Fixture(){const [version,setVersion]=useState(0),[later,setLater]=useState(false);window.qaRefresh=()=>setVersion(v=>v+1);window.qaLater=()=>setLater(true);return <main style={{padding:24,maxWidth:1300,margin:'auto'}}>{scopes.map(scope=><section key={scope.id}><h2>{scope.kind}</h2><ModelUsageSummary scope={scope} refreshKey={String(version)}/></section>)}{later&&<div data-testid="later"><ModelUsageSummary scope={scopes[0]} refreshKey={String(version)}/></div>}</main>;}
void uiPreferences.initialize(window.workbench).then(()=>{window.qaFlush=()=>uiPreferences.flush();createRoot(document.getElementById('root')).render(<Fixture/>);});
`);
await writeFile(path.join(output,'index.html'),'<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="UTF-8"/></head><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
await build({configFile:false,root:output,base:'./',resolve:{alias:{'monaco-codicons':root+'/node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css'}},build:{outDir:path.join(output,'renderer'),emptyOutDir:true},logLevel:'warn'});
await writeFile(path.join(output,'preload.cjs'),"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('workbench',{call:(method,payload)=>ipcRenderer.invoke('qa:call',method,payload),onExtensions:()=>()=>{},onPluginEvent:handler=>{const listener=(_e,event)=>handler(event);ipcRenderer.on('qa:event',listener);return()=>ipcRenderer.removeListener('qa:event',listener);}});");
await writeFile(path.join(output,'host.ts'),`
import {app,BrowserWindow,ipcMain} from 'electron';import path from 'node:path';
import {StateStore,SecretStore} from '${root}/apps/desktop/host/store';import {WorkbenchController} from '${root}/apps/desktop/host/controller';
import {UiPreferenceStore} from '${root}/packages/ui-preferences/store';
import {recordTranslationUsage} from '${root}/packages/translation/usage';
void(async()=>{app.setPath('userData',${JSON.stringify(data)});await app.whenReady();
const store=new StateStore(${JSON.stringify(data)});await store.load();const preferences=new UiPreferenceStore(${JSON.stringify(data)});await preferences.load();
if(!store.snapshot().modelConnections?.length)await store.update(s=>{
  const at=new Date().toISOString(),base={runtime:'codex',source:'fixture',turnId:'turn',steps:1,recordedAt:at,updatedAt:at};
  const scopes=[{kind:'api',id:'fixture-api'},{kind:'account',id:'11111111-1111-4111-a111-111111111111'},{kind:'translation',id:'translation'}];
  const receipt=(scope,id,extra)=>({...base,key:scope.id+id,id,scope,model:'gpt-6-astra',inputTokens:1000000,outputTokens:200000,cacheReadTokens:800000,cacheWriteTokens:null,totalTokens:1200000,...extra});
  s.modelConnections=[{id:'fixture-api',revision:'r',name:'Synthetic API',baseUrl:'https://fixture.invalid',protocol:'responses',auth:'none',enabled:true,hasKey:false,discoveredModels:[],models:[{id:'astra',name:'Astra',model:'gpt-6-astra',enabled:true},{id:'unknown',name:'Vendor',model:'vendor-model',enabled:true},{id:'unused',name:'Unused',model:'gpt-5.6-sol',enabled:true}]}];
  s.localModelAccounts=[{id:scopes[1].id,revision:'r',provider:'codex',name:'Synthetic account',enabled:true,status:'unknown',models:[]}];
  s.modelUsage=[receipt(scopes[0],'partial',{}),receipt(scopes[0],'no-price',{model:'vendor-model',inputTokens:1000,outputTokens:200,cacheReadTokens:null,totalTokens:1200}),receipt(scopes[1],'partial',{})];
  s.translationUsage=recordTranslationUsage(undefined,{...receipt(scopes[2],'partial',{}),sourceId:'fixture',at,operation:'translation',direction:'input',status:'complete',elapsedMs:100,reasoningTokens:null});
});
const controller=new WorkbenchController(store,new SecretStore(${JSON.stringify(data)},{encrypt:()=>{throw Error('No credentials');},decrypt:()=>{throw Error('No credentials');}}),{pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
ipcMain.handle('qa:call',async(_e,method,p={})=>{
  if(method==='ui-preferences/get')return preferences.snapshot();if(method==='ui-preferences/update')return preferences.update(p);
  if(method==='qa/complete'){await store.update(s=>{s.modelUsage.find(r=>r.scope.kind==='api'&&r.model==='gpt-6-astra').cacheWriteTokens=100000;});return;}
  return controller.call(method,p);
});
const window=new BrowserWindow({show:false,width:1250,height:1000,webPreferences:{preload:path.join(${JSON.stringify(output)},'preload.cjs'),contextIsolation:true,offscreen:true,backgroundThrottling:false}});
preferences.subscribe(payload=>window.webContents.send('qa:event',{type:'plugin',id:'workbench.ui-preferences',topic:'changed',payload}));
await window.loadFile(path.join(${JSON.stringify(output)},'renderer/index.html'));app.on('window-all-closed',()=>app.quit());app.on('before-quit',()=>{void controller.dispose();});
})().catch(e=>{console.error(e);app.exit(1);});
`);
await bundle({entryPoints:[path.join(output,'host.ts')],outfile:path.join(output,'host.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron']});
let app,page;const checks=[],errors=[],env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[path.join(output,'host.cjs')],env,timeout:30000});page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(String(e)));await page.getByTestId('model-usage-fixture-api').waitFor();};
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const record=name=>{checks.push(name);console.log('PASS '+name);};
const wait=async(fn)=>{const until=Date.now()+12000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out waiting for cost UI');};
try{
  await launch();let panel=page.getByTestId('model-usage-fixture-api').first();
  await wait(async()=>(await panel.locator('.model-usage-total').innerText()).includes('至少 $12.80'));
  assert.equal(await panel.locator('.model-usage-total').getAttribute('aria-expanded'),'false');
  assert.equal(await panel.getByRole('button',{name:'7 day',exact:true}).getAttribute('aria-pressed'),'true');
  for(const other of ['11111111-1111-4111-a111-111111111111','translation'])assert.match(await page.getByTestId('model-usage-'+other).innerText(),/至少 \$12.80/);
  record('fresh profile shows conservative amounts in API, account and translation summaries');
  await panel.locator('.model-usage-total').click();await panel.getByRole('button',{name:'1 day',exact:true}).click();
  let astra=panel.locator('.model-usage-model').filter({has:page.getByText('gpt-6-astra',{exact:true})});
  assert.match(await astra.locator('.model-usage-model-name').innerText(),/至少 \$12.80/);
  assert.equal(await astra.locator('dl>div').filter({has:page.getByText('缓存写入',{exact:true})}).locator('dd').innerText(),'—');
  assert.match(await astra.innerText(),/部分计费用量未上报/);assert.doesNotMatch(await astra.innerText(),/尚无单价/);
  await astra.locator('summary').click();await page.screenshot({path:path.join(output,'partial-light.png')});
  record('priced GPT model retains a lower bound and distinguishes missing counts from missing prices');
  let vendor=panel.locator('.model-usage-model').filter({has:page.getByText('vendor-model',{exact:true})});await vendor.locator('summary').click();
  await vendor.getByLabel('vendor-model 输入单价',{exact:true}).fill('1');await vendor.getByLabel('vendor-model 输出单价',{exact:true}).fill('2');await vendor.getByRole('button',{name:'保存',exact:true}).click();
  await wait(async()=>(await vendor.locator('.model-usage-model-name').innerText()).includes('$0.0014'));
  assert.match(await panel.locator('.model-usage-total').innerText(),/至少 \$12.8014/);assert.doesNotMatch(await panel.innerText(),/个模型缺少单价/);
  record('manual prices immediately recompute the partial total without a false zero subtotal');
  await page.evaluate(()=>window.qaFlush());await app.close();app=undefined;await launch();panel=page.getByTestId('model-usage-fixture-api').first();
  await wait(async()=>(await panel.locator('.model-usage-total').innerText()).includes('至少 $12.8014'));
  assert.equal(await panel.locator('.model-usage-total').getAttribute('aria-expanded'),'true');
  assert.equal(await panel.getByRole('button',{name:'1 day',exact:true}).getAttribute('aria-pressed'),'true');
  astra=panel.locator('.model-usage-model').filter({has:page.getByText('gpt-6-astra',{exact:true})});assert.equal(await astra.locator('details').getAttribute('open'),'');
  vendor=panel.locator('.model-usage-model').filter({has:page.getByText('vendor-model',{exact:true})});assert.equal(await vendor.getByLabel('vendor-model 输入单价',{exact:true}).inputValue(),'1');
  record('complete process restart restores period, expansion, price disclosure and saved manual rates');
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});await page.screenshot({path:path.join(output,'partial-dark.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(600,1000));await page.waitForFunction(()=>innerWidth===600);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,'partial-narrow.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1250,1000));await page.waitForFunction(()=>innerWidth===1250);
  await call('qa/complete');await page.evaluate(()=>window.qaRefresh());await wait(async()=>(await panel.locator('.model-usage-total').innerText()).includes('$13.0514'));
  assert.doesNotMatch(await panel.locator('.model-usage-total').innerText(),/至少/);assert.equal(await astra.locator('dl>div').filter({has:page.getByText('缓存写入',{exact:true})}).locator('dd').innerText(),'100,000');
  await page.evaluate(()=>window.qaLater());await wait(async()=>(await page.getByTestId('later').innerText()).includes('$13.0514'));
  assert.equal(await page.getByTestId('later').locator('.model-usage-total').getAttribute('aria-expanded'),'true');
  record('late complete receipts remove the bound label and newly mounted instances share saved choices');
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks,errors,scope:'Hidden synthetic desktop; no user profile, real model or remote access'},null,2));console.log('Evidence: '+output);
}catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'report.json'),JSON.stringify({passed:false,checks,errors,error:String(error)},null,2));throw error;}finally{if(app)await app.close();}
