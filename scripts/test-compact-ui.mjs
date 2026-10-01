import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const dataDir=await mkdtemp(path.join(os.tmpdir(),'agent-workbench-ui-'));
const sampleFile=path.join(dataDir,'reference.txt'); await writeFile(sampleFile,'one\ntwo\nthree\n','utf8');
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:dataDir,ELECTRON_RUN_AS_NODE:undefined};
const checks=[];const record=name=>{checks.push(name);console.log('PASS '+name);};
const output=path.join(root,'build/qa');await mkdir(output,{recursive:true});await mkdir(path.join(output,'ui-polish'),{recursive:true});
const app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env,timeout:45000});
try{
 const page=await app.firstWindow(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 page.setDefaultTimeout(15000);await page.waitForFunction(()=>!!window.workbench); const chooseMenu=async(id,value)=>{await page.getByTestId(id).click();await page.locator(`[role=menuitemradio][data-value="${value}"]`).click();};
 const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
 await page.getByTestId('new-session').click(); await page.getByTestId('composer-input').waitFor();
 assert.equal(await page.getByTestId('composer-project').count(),1); assert.equal(await page.locator('.composer-footnote').count(),0); assert.equal(await page.getByTestId('model-selector').count(),1); assert.equal(await page.getByTestId('context-ring').count(),1); assert.equal(await page.getByTestId('auto-submit-toggle').count(),1);
 record('new task has project selection, model/context and the original visible translation switch');
 await page.getByTestId('composer-permission').click(); await page.getByTestId('permission-option-full-access').click();
 assert.equal((await call('state/get')).sessions.length,0); assert.equal(await page.getByTestId('composer-input').isVisible(),true);
 await page.getByTestId('load-demo').click(); await page.getByTestId('composer-input').press('Enter'); await page.getByTestId('submit-draft').waitFor(); await page.getByTestId('submit-draft').click(); await page.getByText('This is an offline workflow demonstration.',{exact:false}).waitFor();
 const state=await call('state/get'); const user=state.sessions[0].messages.find(m=>m.role==='user'); assert.ok(user);
 await page.getByTestId('composer-input').fill('Preserve my unsent draft');await page.getByTestId(`edit-message-${user.id}`).click(); assert.equal(await page.getByTestId('cancel-edit-message').count(),1); await page.getByTestId('cancel-edit-message').click(); assert.equal(await page.getByTestId('cancel-edit-message').count(),0);assert.equal(await page.getByTestId('composer-input').inputValue(),'Preserve my unsent draft');await page.getByTestId(`edit-message-${user.id}`).click();await page.getByTestId('composer-input').press('Escape');assert.equal(await page.getByTestId('composer-input').inputValue(),'Preserve my unsent draft');record('Cancel and Escape restore the draft without changing history');
 const browse=await call('files/browse',{path:sampleFile}); assert.equal(browse.kind,'text'); assert.match(browse.content,/two/);
 await page.getByTestId('context-ring').click(); assert.equal(await page.getByRole('tooltip').count(),1); await page.keyboard.press('Escape');

 const session=state.sessions[0];session.messages.push({id:'links',role:'assistant',original:`[File](<${sampleFile}:2>) and https://example.com/docs.`,translation:`[文件](<${sampleFile}:2>) 和 https://example.com/docs.`,translationStatus:'complete',timestamp:new Date().toISOString(),demo:false});
 await app.evaluate(({BrowserWindow},value)=>BrowserWindow.getAllWindows()[0].webContents.send('workbench:state',value),state);
 await page.getByRole('link',{name:'File',exact:true}).click();await page.getByTestId('code-preview').waitFor();await page.waitForFunction(()=>document.querySelector('[data-testid="code-preview"]').getAttribute('data-line')==='2');await page.getByRole('button',{name:'上一级目录'}).click();await page.getByRole('button',{name:'reference.txt',exact:true}).waitFor();
 await page.getByRole('button',{name:'reference.txt',exact:true}).click({button:'right'});await page.getByRole('menuitem',{name:'复制路径',exact:true}).click();assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),sampleFile);await page.getByRole('button',{name:'关闭文件面板'}).click();record('path link opens the built-in preview at its line; directory context menu copies the path');
 await page.getByRole('link',{name:'文件',exact:true}).press('Shift+F10');await page.getByRole('menuitem',{name:'在工作台预览'}).waitFor();await page.keyboard.press('Escape');record('translated links support keyboard context menus');
 await app.evaluate(({shell})=>{globalThis.__opened=[];shell.openExternal=async url=>{globalThis.__opened.push(url);};});
 await page.getByRole('link',{name:'https://example.com/docs',exact:true}).first().click();assert.deepEqual(await app.evaluate(()=>globalThis.__opened),['https://example.com/docs']);record('HTTP links go through the validated host action without navigating the renderer');
 const at=new Date().toISOString(),host={id:'fixture-host',name:'Fixture',hostname:'fixture.invalid',port:22,username:'member',role:'workspace',identityFile:'unused',knownHostsFile:'unused',ownerId:'owner',workspaceGeneration:'one'};
 state.hosts=[host];state.activeWorkspaceId=host.id;state.accountCatalogs={[host.id]:{authorityId:'authority',generation:'one',revision:1,workspaceId:host.id,selectionRevision:1,availability:'ready',selectedAccountId:'account-one',accounts:['account-one','account-two'].map(id=>({id,generation:'one',provider:'codex',status:'authenticated',displayName:id,observedAt:at}))}};
 Object.assign(session,{status:'running',binding:{runtime:'codex',provider:'openai',accountRef:'vps-account:authority/one/codex/account-one/one',hostId:host.id,executionId:'local-device',egress:'vps'},modelSelection:{model:'model-one',effort:'low'},nativeContextUsage:{used:12000,capacity:100000,total:550000,updatedAt:at},nativeActiveSettings:{permissionMode:'default',modelSelection:{model:'model-one',effort:'low'}}});
 const models=[{id:'one',model:'model-one',name:'Fixture One',isDefault:true,efforts:['low','medium','high'],defaultEffort:'medium',serviceTiers:[{id:'priority',name:'Fast',description:'Synthetic priority'}]},{id:'two',model:'model-two',name:'Fixture Two',isDefault:false,efforts:['low','high'],defaultEffort:'low',serviceTiers:[]}];
 await app.evaluate(({ipcMain,BrowserWindow},{state,models})=>{
  const h=globalThis.__compact={state,models,requests:[]};const publish=()=>BrowserWindow.getAllWindows()[0].webContents.send('workbench:state',h.state);
  ipcMain.removeHandler('workbench:call');ipcMain.handle('workbench:call',async(_event,method,p={})=>{h.requests.push({method,p});let value=null;
   if(method==='state/get')value=h.state;
   else if(method==='runtime/models')value=models;
   else if(method==='theme/set'){h.state.theme=p.theme;value=h.state;publish();}
   else if(method==='session/model'){h.state.sessions.find(s=>s.id===p.sessionId).modelSelection=p.selection;value=h.state;publish();}
   else if(method==='session/permissions'){h.state.sessions.find(s=>s.id===p.sessionId).permissionMode=p.permissionMode;value=h.state;publish();}
   else if(method==='accounts/select'){const catalog=h.state.accountCatalogs[p.id];catalog.selectedAccountId=p.accountId;catalog.selectionRevision++;value=catalog;publish();}
   else if(method==='accounts/list')value=h.state.accountCatalogs[p.id];
   else return {ok:false,error:'Unexpected synthetic call: '+method};
   return {ok:true,value};});publish();
 },{state,models});
 await page.getByTestId('context-ring').click();assert.match(await page.getByRole('tooltip').innerText(),/12%/);assert.match(await page.getByRole('tooltip').innerText(),/12,000 \/ 100,000/);await page.keyboard.press('Escape');record('context ring displays latest native usage instead of cumulative tokens');
 await page.getByTestId('model-selector').click();await page.getByTestId('native-effort').waitFor();await page.screenshot({path:path.join(output,'ui-polish/model-light.png')});await call('theme/set',{theme:'dark'});await page.screenshot({path:path.join(output,'ui-polish/model-dark.png')});assert.equal(await page.getByTestId('native-effort').getAttribute('max'),'2');await page.getByTestId('native-effort').focus();await page.getByTestId('native-effort').press('End');await page.waitForFunction(()=>document.querySelector('[data-testid="native-effort"]').getAttribute('aria-valuetext')==='高');
 await page.getByLabel('Fast',{exact:true}).check();await page.waitForFunction(()=>document.querySelector('[aria-label="Fast"]').checked);await page.getByTestId('show-model-list').click();await page.locator('[role=menuitemradio][data-value="model-two"]').click();await page.getByTestId('show-model-list').getByText('Fixture Two').waitFor();assert.equal(await page.getByLabel('Fast',{exact:true}).count(),0);await page.keyboard.press('Escape');
 assert.equal((await call('state/get')).sessions[0].nativeActiveSettings.modelSelection.effort,'low');record('model, discrete effort and independent Fast follow catalog capabilities and preserve active settings');
 await page.getByTestId('composer-permission').click();await page.getByTestId('permission-option-read-only').click();await page.waitForFunction(()=>document.querySelector('[data-testid="composer-permission"]').textContent.includes('只读'));assert.equal((await call('state/get')).sessions[0].nativeActiveSettings.permissionMode,'default');record('permission remains selectable during a running turn without rewriting active settings');
 await page.getByTestId('composer-input').fill('Switch identity without losing this draft');const binding=JSON.stringify((await call('state/get')).sessions[0].binding);
 await chooseMenu('composer-account','account-two');await page.waitForFunction(()=>document.querySelector('.breadcrumb strong').textContent==='新会话');assert.equal(await page.getByTestId('composer-input').inputValue(),'Switch identity without losing this draft');assert.equal(JSON.stringify((await call('state/get')).sessions[0].binding),binding);assert.equal((await call('state/get')).sessions.length,1);record('account switch preserves the draft and old running identity without creating an empty task');
 await chooseMenu('composer-runtime','claude');assert.equal(await page.getByTestId('composer-input').inputValue(),'Switch identity without losing this draft');assert.equal((await call('state/get')).sessions[0].status,'running');record('runtime switch preserves draft and does not stop the previous native task');
 await page.getByTestId('model-selector').click();assert.match(await page.getByRole('dialog',{name:'模型与思考设置'}).innerText(),/尚未接通/);await page.keyboard.press('Escape');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));await page.waitForFunction(()=>innerWidth===860);if(await page.getByTestId('toggle-translation-pane').count() && await page.getByTestId('toggle-translation-pane').getAttribute('aria-pressed')==='true')await page.getByTestId('toggle-translation-pane').click();
 const layout=await page.evaluate(()=>{const c=document.querySelector('.composer').getBoundingClientRect(),p=document.querySelector('[data-testid="composer-permission"]').getBoundingClientRect(),m=document.querySelector('[data-testid="model-selector"]').getBoundingClientRect(),r=document.querySelector('[data-testid="context-ring"]').getBoundingClientRect();return {fits:p.left>=c.left&&m.right<=c.right&&p.right<=r.left,footer:document.querySelector('.composer-options').textContent,titles:document.querySelectorAll('.composer-area [title]').length,overflow:document.documentElement.scrollWidth>innerWidth};});assert.equal(layout.fits,true);assert.equal(layout.footer.trim(),'翻译后直接发送');assert.equal(layout.titles,0);assert.equal(layout.overflow,false);record('860px window retains compact control geometry, one visible translation switch and no hover hints');
 assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'compact-ui-report.json'),JSON.stringify({passed:true,checks,errors,dataDir,evidence:'Isolated Electron profile; synthetic model/account event harness, real local file UI and model popup screenshot; no model/SSH calls.'},null,2));
 console.log(`Compact desktop QA: ${checks.length} checks passed`);
}finally{await app.close();}
