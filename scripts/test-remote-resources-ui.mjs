import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {navigateWorkbench} from './ui-control-helpers.mjs';
const root=process.env.AWB_QA_APPLICATION,output=process.env.AWB_QA_OUTPUT;
if(!root||!output)throw Error('An isolated application and output are required.');
await mkdir(output,{recursive:true});const directory=await mkdtemp(path.join(os.tmpdir(),'awb-resource-ui-'));
let app,page,failure;const checks=[],errors=[];const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
try{
 app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env:{...process.env,AGENT_WORKBENCH_TEST_DATA:directory,AGENT_WORKBENCH_TEST_HIDDEN:'1',ELECTRON_RUN_AS_NODE:undefined}});
 page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
 const state=await page.evaluate(()=>window.workbench.call('state/get'));
 const branding=await page.evaluate(()=>window.workbench.call('branding/get'));
 await app.evaluate(({ipcMain,BrowserWindow,session},{state,branding})=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,cb)=>cb({cancel:true}));
  state.hosts=[{id:'admin',name:'资源管理 · 隔离测试',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:'C:/fixture/key',knownHostsFile:'C:/fixture/known',ownerId:'fixture',workspaceGeneration:'g'}];state.theme='light';
  const h=globalThis.__resourceQA={state,requests:[],unexpected:[],policy:{revision:0,autoMemory:false},hold:{},pending:{},fail:{},revisions:{},files:{'/notes.txt':'remote fixture','/cached':null,'/cached/child.txt':'nested fixture','/retry':null},rows:['codex','claude'].map(provider=>({provider,installed:false,managed:false,canUninstall:false,busy:false,executable:'',revision:'a'.repeat(64),latest:'9.8.7',installations:[],detected:[],policy:{revision:0,autoUpdate:false,reclaimIdle:false,idleHours:24}}))};
  const publish=()=>BrowserWindow.getAllWindows()[0].webContents.send('workbench:state',state);
  const parent=target=>target.slice(0,target.lastIndexOf('/'))||'/';
  const view=target=>target==='/'||h.files[target]===null?{path:target,parent:parent(target),kind:'directory',entries:Object.keys(h.files).filter(p=>parent(p)===target).map(p=>({path:p,name:p.split('/').at(-1),directory:h.files[p]===null})),revision:'a'.repeat(64)}:{path:target,parent:parent(target),kind:'text',content:h.files[target],revision:h.revisions[target]??'b'.repeat(64),size:14,mode:'-rw-------',modified:1700000000};
  const preferences={schemaVersion:1,revision:0,entries:{}};
  ipcMain.removeHandler('workbench:call');ipcMain.handle('workbench:call',async(_e,method,p={})=>{
   h.requests.push({method,p});const ok=value=>({ok:true,value});
   if(method==='ui-preferences/get')return ok(preferences);
   if(method==='ui-preferences/update'){const key=JSON.stringify([p.id,p.scope??'']);if((preferences.entries[key]?.revision??0)!==p.revision)throw Error('Fixture preference conflict');preferences.entries[key]={revision:++preferences.revision,...(p.reset?{}:{value:p.value})};return ok(preferences);}
   if(method==='branding/get')return ok(branding);
   if(method==='plugin-recovery/status')return ok({safeMode:false});
   if(['desktop/titlebar','plugin-recovery/repair-draft','plugin-recovery/pulse','plugin-recovery/ui-language','plugin-recovery/core-ready','ui-preferences/flush-ready'].includes(method))return ok(null);
   if(method==='state/get')return ok(state);if(method==='navigation/get')return ok({sessionId:null});if(method==='translation/usage')return ok({calls:0,cost:null});if(method==='codex-auth/current')return ok(null);
   if(method==='navigation/view')return ok({sessionId:null});
   if(['extensions/renderers','local-cli/list','model-targets/list','runtime/catalog'].includes(method))return ok([]);if(method==='extensions/appearance')return ok({variables:{}});
   if(method==='host/discover')return ok({hostId:'admin',ownerId:'fixture',generation:'g',observedAt:new Date().toISOString(),effectiveUid:0,privilege:'root',accounts:[],registry:'recognized',publicKeyFingerprints:[],workspaces:[],warnings:[],stateHash:'fixture'});
   if(method==='studio/list')return ok({availability:'ready',authorityId:'fixture',generation:'g',revision:1,workspaces:[],connection:{hostname:'fixture.invalid',port:22,hostPublicKeys:[]},enrollmentUrl:'',transport:'ssh'});
   if(method==='theme/set'){state.theme=p.theme;publish();return ok(state);}
   if(method==='remote-configuration/list')return ok([]);
   if(method==='remote-cli/list')return ok(h.rows);
   if(method==='remote-cli/configure'){const row=h.rows.find(r=>r.provider===p.provider);if(row.policy.revision!==p.revision)throw Error('Revision conflict');row.policy={...row.policy,...p.changes,revision:p.revision+1};return ok(row.policy);}
   if(method==='remote-storage/status')return ok({archives:0,bytes:0,providers:{codex:null,claude:null}});
   if(method==='remote-resources/read'&&h.failResources)return {ok:false,error:'资源读取暂不可用。'};
   if(method==='remote-resources/read')return ok({observedAt:Date.now()/1000,memory:{total:2147483648,used:805306368,available:1342177280,swapTotal:0,swapUsed:0},storage:{path:'/',total:21474836480,used:12884901888,available:8589934592},policy:h.policy,runtime:{available:true,sessions:[],interrupted:[]}});
   if(method==='remote-resources/configure'){if(p.revision!==h.policy.revision)throw Error('Revision conflict');h.policy={revision:p.revision+1,autoMemory:p.autoMemory};return ok(h.policy);}
   if(method==='remote-resources/reclaim')return ok({result:{available:true,closed:['idle-fixture'],protected:1,pending:0}});
   if(method==='remote-files/browse'){if(h.hold[p.path])await new Promise(resolve=>(h.pending[p.path]??=[]).push(resolve));if(h.fail[p.path])return {ok:false,error:h.fail[p.path]};return ok(view(p.path));}
   if(method==='remote-files/mutate'){if(p.revision&&p.revision!==(h.revisions[p.path]??(h.files[p.path]===null?'a':'b').repeat(64)))return {ok:false,error:'文件已变化，请重新读取后再操作。'};if(p.operation==='mkdir')h.files[p.path]=null;if(p.operation==='write')h.files[p.path]=p.content;if(p.operation==='remove'){if(!p.confirm)throw Error('Confirmation required');delete h.files[p.path];}if(p.operation==='move'||p.operation==='copy'){h.files[p.destination]=h.files[p.path];if(p.operation==='move')delete h.files[p.path];}return ok({completed:true});}
   if(['remote-files/upload','remote-files/download','clipboard/write'].includes(method))return ok({completed:true});
   h.unexpected.push(method);return {ok:false,error:'Unmocked operation blocked: '+method};
  });
 },{state,branding});
 await page.reload();await navigateWorkbench(page,'connections');
 await check('CLI owns only independent update switches; retention controls stay in their own tab',async()=>{
  await page.getByTestId('connection-tab-cli').click();const codex=page.getByTestId('remote-cli-codex'),claude=page.getByTestId('remote-cli-claude');
  await codex.getByRole('checkbox',{name:'自动更新',exact:true}).click();assert.equal(await page.getByRole('checkbox',{name:/闲置.*回收/}).count(),0);assert.equal(await app.evaluate(()=>globalThis.__resourceQA.requests.filter(r=>r.method==='remote-storage/status').length),0);
  assert.equal(await claude.getByRole('checkbox',{name:'自动更新',exact:true}).isChecked(),false);
  await page.getByRole('button',{name:'刷新配置管理',exact:true}).click();assert.equal(await codex.getByRole('checkbox',{name:'自动更新',exact:true}).isChecked(),true);
  assert.equal(await app.evaluate(()=>globalThis.__resourceQA.requests.filter(r=>r.method==='remote-cli/apply').length),0);
 });
 await page.screenshot({path:path.join(output,'cli-switches-light.png')});
 await page.getByTestId('connection-tab-details').click();await page.getByRole('region',{name:'VPS 资源'}).waitFor();await page.getByTestId('file-dock').waitFor();
 await check('connection details display metrics and an actual remote right-side file dock',async()=>{
  await page.getByRole('progressbar',{name:'内存占用',exact:true}).waitFor();assert.ok(await page.getByText('12.0 GB / 20.0 GB',{exact:true}).isVisible());
  const dock=await page.getByTestId('file-dock').boundingBox(),panel=await page.getByRole('region',{name:'VPS 资源'}).boundingBox();assert.ok(dock.x>panel.x+panel.width-2,'File browser must be to the right on a wide viewport.');
 });
 await check('both separators drag and support keyboard; window growth goes to the file pane',async()=>{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1540,960));await page.waitForTimeout(150);
  const bounds=async()=>({details:await page.locator('.host-detail').boundingBox(),files:await page.getByTestId('file-dock').boundingBox(),navigation:await page.locator('.connection-host-tree').boundingBox()});
  const initial=await bounds();
  for(const [name,delta] of [['navigation',25],['files',45]]){
    const divider=page.getByTestId('connection-divider-'+name),box=await divider.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+80);await page.mouse.down();await page.mouse.move(box.x+box.width/2+delta,box.y+80,{steps:5});await page.mouse.up();
  }
  const dragged=await bounds();assert.ok(dragged.navigation.width>initial.navigation.width+20);assert.ok(dragged.details.width>initial.details.width+15);
  await page.getByTestId('connection-divider-files').focus();await page.keyboard.press('ArrowRight');const keyboard=await bounds();assert.ok(keyboard.details.width>dragged.details.width+14);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1860,960));await page.waitForTimeout(150);const wide=await bounds();
  assert.ok(Math.abs(wide.details.width-keyboard.details.width)<2);assert.ok(Math.abs(wide.navigation.width-keyboard.navigation.width)<2);assert.ok(wide.files.width-keyboard.files.width>300);
  await page.locator('.settings-content').evaluate(node=>node.scrollTop=0);await page.screenshot({path:path.join(output,'panes-wide.png')});
 });
 await check('directory prefetch is silent and repeated expansion and toggle reuse the listing',async()=>{
  await page.locator('.file-tree-row[title="/cached"]').waitFor();
  await page.waitForTimeout(100);
  const count=()=>app.evaluate(()=>globalThis.__resourceQA.requests.filter(r=>r.method==='remote-files/browse'&&r.p.path==='/cached').length);
  const before=await count();assert.equal(before,1);
  const folder=page.locator('.file-tree-row[title="/cached"]');await folder.click();await page.locator('.file-tree-row[title="/cached/child.txt"]').waitFor();await folder.click();await folder.click();assert.equal(await count(),before);
  assert.equal(await page.getByTestId('file-dock').getByText('读取中…',{exact:true}).count(),0);
  const toggle=page.getByRole('button',{name:'远端文件',exact:true});await toggle.click();assert.equal(await toggle.getAttribute('aria-pressed'),'false');await page.getByTestId('file-dock').waitFor({state:'hidden'});
  await toggle.click();await page.locator('.file-tree-row[title="/cached/child.txt"]').waitFor();assert.equal(await count(),before);assert.equal(await toggle.getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'关闭文件面板',exact:true}).click();assert.equal(await toggle.getAttribute('aria-pressed'),'false');
  await page.waitForFunction(()=>!document.querySelector('.connection-panes.has-remote-files'));await page.waitForTimeout(150);const beforeClosed=await page.locator('.host-detail').boundingBox();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1220,900));await page.waitForTimeout(150);const afterClosed=await page.locator('.host-detail').boundingBox();assert.ok(afterClosed.width<beforeClosed.width-40);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1540,960));await toggle.click();await page.locator('.file-tree-row[title="/cached/child.txt"]').waitFor();
  assert.equal(await app.evaluate(()=>globalThis.__resourceQA.requests.filter(r=>r.method==='remote-files/browse'&&r.p.path.endsWith('.txt')).length),0);
 });
 await check('right-click and copy-path are immediate with SSH blocked; actions wait for a verified revision',async()=>{
  await app.evaluate(()=>{globalThis.__resourceQA.hold['/notes.txt']=true;});
  const row=page.locator('.file-tree-row[title="/notes.txt"]');await row.click({button:'right'});
  await page.getByRole('menuitem',{name:'复制远端路径',exact:true}).waitFor({timeout:600});await page.screenshot({path:path.join(output,'menu-with-ssh-blocked.png')});
  assert.equal(await app.evaluate(()=>globalThis.__resourceQA.requests.filter(r=>r.method==='remote-files/browse'&&r.p.path==='/notes.txt').length),0);
  await page.getByRole('menuitem',{name:'复制远端路径',exact:true}).click();
  assert.equal(await app.evaluate(()=>globalThis.__resourceQA.requests.filter(r=>r.method==='clipboard/write'&&r.p.text==='/notes.txt').length),1);
  await row.click({button:'right'});await page.getByRole('menuitem',{name:'删除…',exact:true}).click();
  await page.getByRole('dialog').waitFor({timeout:600});assert.equal(await page.getByRole('button',{name:'确认永久删除',exact:true}).isEnabled(),false);
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  await app.evaluate(()=>{const h=globalThis.__resourceQA;delete h.hold['/notes.txt'];for(const resolve of h.pending['/notes.txt']??[])resolve();});await page.waitForTimeout(100);
  assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await app.evaluate(()=>globalThis.__resourceQA.requests.filter(r=>r.method==='remote-files/mutate').length),0);
 });
 await check('directory errors explain the failure and retry can recover',async()=>{
  await app.evaluate(()=>{globalThis.__resourceQA.fail['/retry']='远端系统权限不足。';});
  await page.getByRole('button',{name:'刷新文件',exact:true}).click();await page.waitForTimeout(100);await page.locator('.file-tree-row[title="/retry"]').click();
  await page.getByRole('alert').filter({hasText:'远端系统权限不足。'}).waitFor();
  await app.evaluate(()=>{delete globalThis.__resourceQA.fail['/retry'];});await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByRole('alert').filter({hasText:'远端系统权限不足。'}).waitFor({state:'hidden'});
 });
 await check('memory switch persists and manual reclamation reaches its real dispatcher',async()=>{
  await page.getByRole('checkbox',{name:'自动回收空闲内存',exact:true}).click();await page.getByRole('button',{name:'回收空闲内存',exact:true}).click();assert.equal(await app.evaluate(()=>globalThis.__resourceQA.policy.autoMemory),true);assert.equal(await app.evaluate(()=>globalThis.__resourceQA.requests.filter(r=>r.method==='remote-resources/reclaim').length),1);
 });
 await check('remote text edit and creation do not call local filesystem endpoints',async()=>{
  await page.locator('.file-tree-row').filter({hasText:'notes.txt'}).click();await page.getByTestId('file-dock').getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('textbox',{name:'远端文本内容',exact:true}).fill('edited remote');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await app.evaluate(()=>globalThis.__resourceQA.files['/notes.txt']),'edited remote');
  await page.getByRole('button',{name:'新建文件夹',exact:true}).click();await page.getByRole('textbox',{name:'名称',exact:true}).fill('new-folder');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await app.evaluate(()=>globalThis.__resourceQA.requests.filter(r=>r.method==='files/open'||r.method==='files/browse'||r.method==='project/pick').length),0);
 });
 await check('revision conflicts keep edits recoverable and do not overwrite newer remote content',async()=>{
  await page.locator('.file-tree-row[title="/notes.txt"]').click();await page.getByTestId('file-dock').getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByRole('textbox',{name:'远端文本内容',exact:true}).fill('unsaved conflict draft');
  await app.evaluate(()=>{globalThis.__resourceQA.revisions['/notes.txt']='c'.repeat(64);});
  await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'文件已变化，请重新读取后再操作。'}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'远端文本内容',exact:true}).inputValue(),'unsaved conflict draft');
  assert.equal(await app.evaluate(()=>globalThis.__resourceQA.files['/notes.txt']),'edited remote');
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'刷新文件',exact:true}).click();await page.waitForTimeout(100);
 });
 await check('remote context menu copies, moves and requires confirmation before deletion',async()=>{
  const menu=async(name,action)=>{await page.locator('.file-tree-row').filter({hasText:name}).click({button:'right'});await page.getByRole('menuitem',{name:action,exact:true}).click();};
  await menu('notes.txt','复制到…');await page.getByRole('textbox',{name:'目标绝对路径',exact:true}).fill('/copy.txt');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await menu('copy.txt','重命名 / 移动');await page.getByRole('textbox',{name:'目标绝对路径',exact:true}).fill('/moved.txt');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await menu('moved.txt','删除…');await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();assert.equal(await app.evaluate(()=>globalThis.__resourceQA.files['/moved.txt']),'edited remote');
  await menu('moved.txt','删除…');await page.getByRole('dialog').getByRole('button',{name:'确认永久删除',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await app.evaluate(()=>globalThis.__resourceQA.files['/moved.txt']),undefined);
 });
 await check('changing a connection identity isolates pending replies and disposes its cache',async()=>{
  await app.evaluate(()=>{const h=globalThis.__resourceQA;h.files['/identity.txt']='old identity';h.hold['/identity.txt']=true;});
  await page.getByRole('button',{name:'刷新文件',exact:true}).click();await page.locator('.file-tree-row[title="/identity.txt"]').click();
  await app.evaluate(({BrowserWindow})=>{const h=globalThis.__resourceQA;h.state.hosts[0]={...h.state.hosts[0],hostname:'replacement.invalid',workspaceGeneration:'replacement'};BrowserWindow.getAllWindows()[0].webContents.send('workbench:state',h.state);});
  await page.locator('.file-tree-row[title="/notes.txt"]').waitFor();
  await app.evaluate(()=>{const h=globalThis.__resourceQA;delete h.hold['/identity.txt'];for(const resolve of h.pending['/identity.txt']??[])resolve();});await page.waitForTimeout(100);
  assert.equal(await page.getByRole('textbox',{name:'文件路径',exact:true}).inputValue(),'/');assert.equal(await page.getByRole('tab',{name:'identity.txt',exact:true}).count(),0);
 });
 await check('resource-metric failures do not prevent closing and reopening remote files',async()=>{
  await app.evaluate(({BrowserWindow})=>{const h=globalThis.__resourceQA;h.failResources=true;h.state.hosts[0]={...h.state.hosts[0],workspaceGeneration:'resource-failure'};BrowserWindow.getAllWindows()[0].webContents.send('workbench:state',h.state);});
  await page.getByRole('alert').filter({hasText:'资源读取暂不可用。'}).waitFor();
  const toggle=page.getByRole('button',{name:'远端文件',exact:true});await toggle.click();await page.getByTestId('file-dock').waitFor({state:'hidden'});await toggle.click();await page.getByTestId('file-dock').waitFor();
  await app.evaluate(()=>{globalThis.__resourceQA.failResources=false;});await page.getByRole('button',{name:'刷新远端资源',exact:true}).click();await page.getByRole('progressbar',{name:'内存占用',exact:true}).waitFor();
 });
 await page.locator('.settings-content').evaluate(node=>node.scrollTop=0);await page.screenshot({path:path.join(output,'resources-light.png')});
 await page.evaluate(()=>window.workbench.call('theme/set',{theme:'dark'}));await page.screenshot({path:path.join(output,'resources-dark.png')});
 await check('narrow layout keeps resource controls and remote browser reachable',async()=>{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(860,720));await page.waitForTimeout(150);assert.ok(await page.getByRole('checkbox',{name:'自动回收空闲内存',exact:true}).isVisible());await page.screenshot({path:path.join(output,'resources-narrow.png')});await page.getByTestId('file-dock').scrollIntoViewIfNeeded();assert.ok(await page.getByRole('textbox',{name:'文件路径',exact:true}).isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:path.join(output,'resources-narrow-files.png')});});
 assert.deepEqual(errors,[]);assert.deepEqual(await app.evaluate(()=>globalThis.__resourceQA.unexpected),[]);
}catch(error){failure=error;console.error(error);if(page){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'failure.txt'),await page.locator('body').innerText().catch(()=>''));}process.exitCode=1;}finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({passed:checks.length,checks,errors,failure:failure?String(failure):null},null,2));}
