import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openWorkbenchSettings, navigateWorkbench } from './ui-control-helpers.mjs';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),output=path.join(root,'build/qa/assistance-20260926');await mkdir(output,{recursive:true});
const dataDir=await mkdtemp(path.join(os.tmpdir(),'awb-assistance-'));
const app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env:{...process.env,AGENT_WORKBENCH_TEST_DATA:dataDir,ELECTRON_RUN_AS_NODE:undefined}});
const checks=[],errors=[];const record=name=>{checks.push(name);console.log('PASS '+name);};let page;
try{
 page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));await page.getByTestId('composer-input').waitFor();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1360,940));
 const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
 await openWorkbenchSettings(page);assert.equal(await page.getByTestId('settings-agents').count(),0);assert.equal(await page.getByTestId('agent-concurrency').count(),0);await navigateWorkbench(page,'workspace');
 const session=await call('session/create',{runtime:'demo'});await page.getByTestId(`sidebar-session-${session.id}`).locator('.session-select').click();
 assert.equal(await page.getByTestId('open-collaboration').count(),0);await page.getByTestId('composer-input').fill('这里继续输入，悬浮提示不应该抢走焦点');
 record('agent collaboration has no user entry, manual message form or capacity controls');
 const state=await call('state/get'),at=n=>new Date(Date.UTC(2026,8,26,7,0,n)).toISOString();
 const host={id:'fixture-host',name:'Synthetic workspace',hostname:'fixture.invalid',port:22,username:'member',role:'workspace',identityFile:'unused',knownHostsFile:'unused',ownerId:'owner',workspaceGeneration:'one'};
 state.hosts=[host];state.activeWorkspaceId=host.id;state.plugins={translation:{enabled:false}};
 const s=state.sessions.find(s=>s.id===session.id);Object.assign(s,{status:'running',title:'检查和修复动画文件',binding:{runtime:'codex',provider:'openai',accountRef:'fixture-account',hostId:host.id,executionId:'local-device',egress:'vps'},nativeContextUsage:{used:30577,capacity:258400,total:900000,updatedAt:at(5)},messages:[{id:'user',role:'user',original:'检查动画的脚踏和翅膀运动，并修复节奏。',demo:false,timestamp:at(0)},{id:'before',role:'assistant',original:'我会先检查当前动画文件，再调整脚踏和翅膀的运动。',demo:false,timestamp:at(1)},{id:'between',role:'assistant',original:'已经找到速度不一致的位置，正在调整时间参数。',demo:false,timestamp:at(3)},{id:'after',role:'assistant',original:'文件已更新，接下来检查构建输出。',demo:false,timestamp:at(6)}],activities:[{id:'read',runtime:'codex',kind:'command',status:'completed',title:'rg -n "pedal|wing" index.html',input:'rg -n "pedal|wing" index.html',output:'42: pedal.rotation = time * 2\n78: wing.rotation = Math.sin(time)',cwd:'D:\\example',exitCode:0,startedAt:at(2),updatedAt:at(2)},{id:'edit',runtime:'codex',kind:'file-edit',status:'completed',title:'index.html',input:'index.html\n- wing.rotation = Math.sin(time)\n+ wing.rotation = Math.sin(time * 2)',startedAt:at(4),updatedAt:at(5)},{id:'build',runtime:'codex',kind:'command',status:'running',title:'npm run build',input:'npm run build',output:'Building animation…\n',startedAt:at(7),updatedAt:at(7)}]});
 const models=[{id:'a',model:'fixture-large',name:'6.6 Astra',isDefault:true,efforts:['low','medium','high','xhigh','max','ultra'],defaultEffort:'high',serviceTiers:[{id:'priority',name:'Fast',description:'Synthetic'}],defaultServiceTier:'priority'},{id:'b',model:'fixture-small',name:'6.6 Luna',isDefault:false,efforts:['low','high'],defaultEffort:'low',serviceTiers:[]}];
 await app.evaluate(({ipcMain,BrowserWindow},{state,models})=>{
  const h=globalThis.__assistance={state,models,requests:[]};const publish=()=>BrowserWindow.getAllWindows()[0].webContents.send('workbench:state',h.state);ipcMain.removeHandler('workbench:call');
  ipcMain.handle('workbench:call',async(_event,method,p={})=>{h.requests.push({method,p});let value;
   if(method==='state/get')value=h.state;
   else if(method==='runtime/models')value=h.models;
   else if(method==='session/model'){h.state.sessions.find(s=>s.id===p.sessionId).modelSelection=p.selection;value=h.state;publish();}
   else if(method==='theme/set'){h.state.theme=p.theme;value=h.state;publish();}
   else if(method==='clipboard/copy'){value=null;}
   else return {ok:false,error:'Unexpected synthetic call: '+method};
   return {ok:true,value};});publish();
 },{state,models});
 await page.waitForFunction(()=>document.querySelector('[data-testid="model-selector"]').textContent.includes('Astra'));
 assert.match(await page.getByTestId('model-selector').innerText(),/Astra.*高.*Fast/s);
 assert.equal(await page.getByRole('dialog',{name:'模型与思考设置'}).count(),0);
 record('remote default model, effort and Fast show before opening the picker');
 const order=await page.locator('.original-messages').evaluate(el=>[...el.children].map(x=>x.getAttribute('data-activity-id')??x.querySelector('[data-message-id]')?.getAttribute('data-message-id')));
 assert.deepEqual(order,['user','before','read','between','edit','after','build']);
 const textBox=await page.locator('[data-message-id="between"]').boundingBox(),rowBox=await page.locator('[data-activity-id="edit"]').boundingBox();assert.ok(Math.abs(textBox.x+6-rowBox.x)<2);
 await page.locator('[data-activity-id="build"] summary').click();assert.match(await page.locator('[data-activity-id="build"] pre').last().innerText(),/Building/);
 await app.evaluate(({BrowserWindow})=>{const s=globalThis.__assistance.state.sessions[0];s.activities[2].output+='Compiled 1 file.\n';s.activities[2].updatedAt=new Date().toISOString();BrowserWindow.getAllWindows()[0].webContents.send('workbench:state',globalThis.__assistance.state);});
 await page.locator('[data-testid="activity-output"]').getByText('Compiled 1 file.',{exact:false}).waitFor();
 assert.equal(await page.locator('[data-activity-id="build"]').getAttribute('open'),'');
 record('tool rows interleave with text, align with paragraphs and stream details in place');
 await page.screenshot({path:path.join(output,'timeline-light.png')});
 await page.locator('[data-activity-id="build"] summary').click();
 await page.getByTestId('composer-input').focus();await page.getByTestId('context-ring').hover();await page.getByRole('tooltip').waitFor();
 assert.match(await page.getByRole('tooltip').innerText(),/12% 已使用/);assert.match(await page.getByRole('tooltip').innerText(),/30,577 \/ 258,400/);
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-testid')),'composer-input');
 const box=await page.getByRole('tooltip').boundingBox();assert.ok(box.width<=226&&box.height<=125);
 await page.screenshot({path:path.join(output,'context-light.png')});
 await page.getByRole('tooltip').hover();await page.waitForTimeout(220);assert.equal(await page.getByRole('tooltip').isVisible(),true);
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('tooltip').count(),0);
 record('context opens on hover, remains reachable, keeps input focus and fits a compact card');
 await page.getByTestId('model-selector').click();await page.getByTestId('native-effort').waitFor();await page.screenshot({path:path.join(output,'model-light.png')});
 await page.getByTestId('native-effort').press('End');await page.waitForFunction(()=>document.querySelector('[data-testid="model-selector"]').textContent.includes('超高'));
 await page.getByLabel('Fast',{exact:true}).uncheck();await page.waitForFunction(()=>!document.querySelector('[data-testid="model-selector"]').textContent.includes('Fast'));
 const range=await page.getByTestId('native-effort').boundingBox();await page.mouse.move(range.x+range.width-8,range.y+14);await page.mouse.down();await page.mouse.move(range.x+8,range.y+14,{steps:12});await page.mouse.up();await page.waitForFunction(()=>document.querySelector('[data-testid="native-effort"]').getAttribute('aria-valuetext')==='低');
 assert.equal((await app.evaluate(()=>globalThis.__assistance.state.sessions[0].modelSelection)).effort,'low');
 await call('theme/set',{theme:'dark'});await page.screenshot({path:path.join(output,'model-dark.png')});await page.keyboard.press('Escape');
 record('effort supports keyboard and drag release; Fast can be explicitly disabled');
 await page.getByTestId(`sidebar-session-${session.id}`).click({button:'right'});await page.getByTestId('session-copy-submenu').hover();await page.getByTestId('session-copy-menu').waitFor();
 const from=await page.getByTestId('session-copy-submenu').boundingBox(),to=await page.getByTestId('copy-session-markdown').boundingBox();
 await page.mouse.move(from.x+from.width-2,from.y+from.height/2);await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:20});await page.waitForTimeout(350);
 assert.equal(await page.getByTestId('session-copy-menu').isVisible(),true);await page.screenshot({path:path.join(output,'submenu-dark.png')});
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await page.getByTestId(`sidebar-session-${session.id}`).click({button:'right'});await page.getByTestId('session-copy-submenu').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-testid')),'copy-session-link');await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-testid')),'session-copy-submenu');await page.keyboard.press('Escape');
 record('submenu survives a diagonal pointer crossing and keyboard navigation still works');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));await page.waitForFunction(()=>innerWidth===860);await page.getByTestId('model-selector').click();await page.screenshot({path:path.join(output,'compact-dark.png')});
 const layout=await page.evaluate(()=>{const p=document.querySelector('.model-popover').getBoundingClientRect();return {fits:p.left>=0&&p.right<=innerWidth&&p.top>=0&&p.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};});assert.equal(layout.fits,true);assert.equal(layout.overflow,false);await page.keyboard.press('Escape');
 assert.equal(await page.getByTestId('composer-input').inputValue(),'这里继续输入，悬浮提示不应该抢走焦点');assert.deepEqual(errors,[]);record('860px layout fits and the original input draft survives every interaction');
 await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks,errors,dataDir,evidence:'Real Electron UI; isolated synthetic native model/event harness; no real SSH or model calls.'},null,2));
}catch(error){if(page){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),checks,errors},null,2));}throw error;}
finally{await app.close();}
