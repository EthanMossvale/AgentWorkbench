import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {initialState} from '../apps/desktop/host/store.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';

// Production application with disposable state and approved synthetic plugins only.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'build/qa/translation-footer-'+Date.now()),profile=path.join(output,'profile');await mkdir(profile,{recursive:true});
const seed=initialState(),at='2026-09-30T00:00:00Z';
seed.sessions=['one','two'].map(id=>({id,projectId:null,title:'合成会话 '+id,pinned:false,archived:false,group:'',status:'idle',createdAt:at,binding:{runtime:'demo',provider:'demo',accountRef:'demo',executionId:'local-device',egress:'demo'},messages:[{id:'u-'+id,role:'user',original:'请检查布局。',submitted:'Please check the layout.',demo:true,timestamp:at},{id:'a-'+id,role:'assistant',original:'A saved synthetic reply.',translation:'已保存的合成译文。',translationStatus:'complete',demo:true,nativeTurnEnd:true,timestamp:at}]}));
await writeFile(path.join(profile,'state.json'),JSON.stringify(seed));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.execPath,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;
const checks=[],errors=[];let app,page;
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const state=()=>call('state/get');
const wait=async(predicate,label)=>{const deadline=Date.now()+12000;while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Timed out: '+label);};
const check=async(name,run)=>{await run();checks.push(name);console.log('PASS '+name);};
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));await page.getByTestId('sidebar').waitFor();assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);};
const open=async id=>{await page.getByTestId('sidebar-session-'+id).locator('.session-select').click();await page.getByTestId('composer-input').waitFor();};
const layout=async(value,width)=>{
 await call('translation/layout',{layout:value});await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,900),width);
 await page.waitForFunction(width=>innerWidth===width,width);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await wait(async()=>await page.getByTestId('composer-input').isVisible()||await page.getByTestId('translation-chinese').isVisible(),'reading layout');
 if(value==='panel'&&width===1440&&!await page.getByTestId('translation-chinese').isVisible()){await page.getByTestId('toggle-translation-pane').click();await page.getByTestId('translation-chinese').waitFor();}
 if(!await page.getByTestId('composer-input').isVisible())await page.getByTestId('toggle-translation-pane').click();
 await page.getByTestId('translate-intermediate').waitFor();
};
const footer=async()=>{
 assert.deepEqual(await page.locator('.composer-translation-controls > label').allTextContents(),['关闭翻译','翻译后直接发送','翻译中途消息']);
 assert.equal(await page.locator('.workspace-header [data-testid="translate-intermediate"]').count(),0);
 assert.equal(await page.locator('.composer-translation-controls [data-workbench-translation-intermediate] [data-testid="translate-intermediate"]').count(),1);
 const geometry=await page.locator('.composer-translation-controls').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,labels:[...el.querySelectorAll(':scope > label')].map(label=>{const b=label.getBoundingClientRect(),i=label.querySelector('i').getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,width:i.width,height:i.height};}),overflow:document.documentElement.scrollWidth>innerWidth};});
 assert.equal(geometry.overflow,false);for(const label of geometry.labels){assert.ok(label.left>=geometry.left-1&&label.right<=geometry.right+1,JSON.stringify(geometry));assert.equal(label.width,geometry.labels[0].width);assert.equal(label.height,geometry.labels[0].height);}
 const [quick,auto,intermediate]=geometry.labels;assert.ok(auto.left>=quick.right&&intermediate.left>=auto.right&&Math.abs(auto.top-intermediate.top)<2,JSON.stringify(geometry));
};
try{
 await launch();await open('one');
 await check('sidebar keeps the wordmark without a logo; native connected-W icons remain',async()=>{
  assert.equal(await page.locator('.sidebar-top [data-workbench-brand-mark]').count(),0);assert.equal(await page.locator('.sidebar-wordmark').innerText(),'Workbench');
  assert.equal((await app.evaluate(({app})=>app.__workbenchTrayTest.branding())).id,'workbench.connected-w');
 });
 await check('both reading layouts place all three switches in order below the composer at wide and narrow sizes',async()=>{
  for(const theme of ['light','dark'])for(const mode of ['inline','panel'])for(const width of [1440,860]){
   await call('theme/set',{theme});await layout(mode,width);await footer();await page.screenshot({path:path.join(output,`${theme}-${mode}-${width}.png`)});
  }
 });
 await check('intermediate preference updates globally and preserves saved translations',async()=>{
  await page.getByTestId('translate-intermediate').click();await wait(async()=>(await state()).translateIntermediate===false,'intermediate false');await open('two');assert.equal(await page.getByTestId('translate-intermediate').isChecked(),false);
  assert.equal((await state()).sessions[0].messages[1].translation,'已保存的合成译文。');await layout('inline',1440);await footer();
 });
 await check('shortened pause keeps resume behavior and optional-control/module visibility rules',async()=>{
  await page.getByTestId('translation-quick-toggle').click();await page.getByText('恢复翻译',{exact:true}).waitFor();assert.equal(await page.getByTestId('auto-submit-toggle').count(),0);assert.equal(await page.getByTestId('translate-intermediate').count(),0);assert.equal((await state()).plugins.translation.enabled,true);
  await page.getByTestId('translation-quick-toggle').click();await page.getByText('关闭翻译',{exact:true}).waitFor();assert.equal(await page.getByTestId('translate-intermediate').isChecked(),false);
  await call('translation/quick-toggle',{show:false});await page.getByTestId('translation-quick-toggle').waitFor({state:'detached'});assert.equal(await page.getByTestId('translate-intermediate').isVisible(),true);await call('translation/quick-toggle',{show:true});
  await call('plugins/set-enabled',{id:'translation',enabled:false});await page.locator('.composer-translation-controls').waitFor({state:'detached'});await call('plugins/set-enabled',{id:'translation',enabled:true});await page.getByTestId('translate-intermediate').waitFor();await footer();
 });
 await check('approved plugin calls and replaces the relocated current/later surface, then restores it on disable and reenable',async()=>{
  const id='qa.translation-footer',manifest={schemaVersion:1,apiVersion:1,id,name:'Footer fixture',description:'Isolated footer acceptance',version:'1.0.0',capabilities:['host'],main:'host.mjs',renderer:'renderer.mjs'};
  const host=`export function activate(api){api.registerCommand('set',payload=>api.call('translation/intermediate',payload));}`;
  const renderer=`export function activate(api){window.__footerFixture??={mounts:0,cleaned:0};api.observeSurfaces('translation-intermediate','replace',({root})=>{window.__footerFixture.mounts++;const button=document.createElement('button');button.dataset.testid='footer-plugin';button.textContent='合成中途开关';button.onclick=async()=>{const state=await api.call('state/get');await api.call('translation/intermediate',{enabled:state.translateIntermediate===false});};root.append(button);return()=>{window.__footerFixture.cleaned++;button.remove();};});}`;
  const file=path.join(output,'fixture.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'host.mjs',data:Buffer.from(host)},{name:'renderer.mjs',data:Buffer.from(renderer)}]));await call('extensions/import',{filePath:file});const record=(await call('extensions/list')).find(p=>p.manifest.id===id);
  await assert.rejects(call('extensions/toggle',{id,hash:record.hash,enabled:true}));await call('extensions/toggle',{id,hash:record.hash,enabled:true,approveHost:true});await page.locator('.composer-translation-controls [data-testid="footer-plugin"]').waitFor();assert.equal(await page.getByTestId('translate-intermediate').isVisible(),false);
  await page.getByTestId('footer-plugin').click();await wait(async()=>(await state()).translateIntermediate===true,'plugin switch');await call('extensions/command',{id,name:'set',payload:{enabled:false}});await wait(async()=>(await state()).translateIntermediate===false,'plugin command');
  const before=await page.evaluate(()=>window.__footerFixture.mounts);await open('one');await page.getByTestId('footer-plugin').waitFor();await page.waitForFunction(before=>window.__footerFixture.mounts>before,before);
  await call('extensions/toggle',{id,hash:record.hash,enabled:false});await page.getByTestId('footer-plugin').waitFor({state:'detached'});await page.getByTestId('translate-intermediate').waitFor();assert.equal(await page.getByTestId('translate-intermediate').isChecked(),false);assert.ok(await page.evaluate(()=>window.__footerFixture.cleaned>0));
  await call('extensions/toggle',{id,hash:record.hash,enabled:true});await page.getByTestId('footer-plugin').waitFor();await call('extensions/toggle',{id,hash:record.hash,enabled:false});await page.getByTestId('translate-intermediate').waitFor();await footer();
 });
 await check('complete process restart retains intermediate, auto-send and quick-pause choices',async()=>{
  await call('translation/auto-submit',{enabled:true});await call('translation/quick-toggle',{paused:true});await page.getByText('恢复翻译',{exact:true}).waitFor();await app.close();app=undefined;await launch();await open('one');
  const current=await state();assert.equal(current.translateIntermediate,false);assert.equal(current.autoSubmitTranslated,true);assert.equal(current.translationQuickToggle.paused,true);assert.equal(current.plugins.translation.enabled,true);
  await page.getByTestId('translation-quick-toggle').click();await page.getByTestId('translate-intermediate').waitFor();assert.equal(await page.getByTestId('translate-intermediate').isChecked(),false);assert.equal(await page.getByTestId('auto-submit-toggle').isChecked(),true);await footer();
  const disk=JSON.parse(await readFile(path.join(profile,'state.json'),'utf8'));assert.equal(disk.translateIntermediate,false);assert.equal(disk.autoSubmitTranslated,true);
 });
 assert.deepEqual(errors,[]);
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,realModelCalls:0,boundary:'Hidden isolated production Electron; synthetic history and exact approved plugin; no active user desktop or release package.'},null,2));console.log('Evidence: '+output);}
