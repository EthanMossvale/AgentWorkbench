import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {navigateWorkbench} from './ui-control-helpers.mjs';
const root=process.env.AWB_QA_APPLICATION,output=process.env.AWB_QA_OUTPUT;
if(!root||!output)throw Error('Explicit isolated QA application and output are required.');
await mkdir(output,{recursive:true});
const directory=await mkdtemp(path.join(os.tmpdir(),'awb-simulated-remote-ui-'));
let app,page,failure;const checks=[],errors=[];
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
try{
 app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env:{...process.env,AGENT_WORKBENCH_TEST_DATA:directory,AGENT_WORKBENCH_TEST_HIDDEN:'1',ELECTRON_RUN_AS_NODE:undefined}});
 page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
 const state=await page.evaluate(()=>window.workbench.call('state/get'));
 const branding=await page.evaluate(()=>window.workbench.call('branding/get'));
 await app.evaluate(({ipcMain,BrowserWindow,session},{state,branding})=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,cb)=>cb({cancel:true}));
  state.hosts=[{id:'admin',name:'远端管理 · 模拟环境',hostname:'fixture.invalid',port:2222,username:'root',role:'admin',identityFile:'C:/fixture/key',knownHostsFile:'C:/fixture/known',ownerId:'fixture',workspaceGeneration:'g'}];state.theme='light';
  const now=new Date().toISOString();const catalog={source:'native-owner',availability:'ready',authorityId:'fixture',generation:'g',workspaceId:'administrator',revision:1,selectionRevision:0,accounts:[{id:'claude-fixture',generation:'ag',provider:'claude',status:'unauthenticated',displayName:'测试 Claude 账号',observedAt:now}]};state.accountCatalogs={admin:catalog};
  const h=globalThis.__remoteQA={state,catalog,requests:[],unexpected:[],installed:true,profiles:[{key:'a'.repeat(32),label:'个人阅读',available:true},{key:'b'.repeat(32),label:'工作账号',available:true}],rows:['codex','claude'].map(provider=>({provider,installed:true,version:'9.8.6',latest:'9.8.7',managed:true,canUninstall:true,busy:false,executable:'/fixture/'+provider,revision:'a'.repeat(64),installations:[],detected:[],policy:{revision:0,autoUpdate:false,reclaimIdle:false,idleHours:24}})),job:null,complete:false};
  const publish=()=>BrowserWindow.getAllWindows()[0].webContents.send('workbench:state',state);
  const preferences={schemaVersion:1,revision:0,entries:{}};
  ipcMain.removeHandler('workbench:call');ipcMain.handle('workbench:call',async(_e,method,p={})=>{
   h.requests.push({method,p});const ok=value=>({ok:true,value});
   if(method==='ui-preferences/get')return ok(preferences);
   if(method==='ui-preferences/update'){
    const key=JSON.stringify([p.id,p.scope??'']);if((preferences.entries[key]?.revision??0)!==p.revision)throw Error('Fixture preference conflict');
    preferences.entries[key]={revision:++preferences.revision,...(p.reset?{}:{value:p.value})};return ok(preferences);
   }
   if(method==='plugin-recovery/status')return ok({safeMode:false});
   if(method==='branding/get')return ok(branding);
   if(method==='desktop/titlebar')return ok(null);
   if(method==='plugin-recovery/repair-draft')return ok(null);
   if(['plugin-recovery/pulse','plugin-recovery/ui-language','plugin-recovery/core-ready','ui-preferences/flush-ready'].includes(method))return ok(null);
   if(method==='state/get')return ok(state);if(method==='navigation/get')return ok({sessionId:null});if(method==='translation/usage')return ok({calls:0,cost:null});if(method==='codex-auth/current')return ok(null);
   if(method==='navigation/view')return ok({sessionId:null});
   if(['extensions/renderers','local-cli/list','model-targets/list','runtime/catalog'].includes(method))return ok([]);if(method==='extensions/appearance')return ok({variables:{}});
   if(method==='studio/list')return ok({availability:'ready',authorityId:'fixture',generation:'g',revision:1,workspaces:[],connection:{hostname:'fixture.invalid',port:2222,hostPublicKeys:[]},enrollmentUrl:'',transport:'ssh'});
   if(method==='host/discover')return ok({hostId:'admin',ownerId:'fixture',generation:'g',observedAt:now,effectiveUid:0,privilege:'root',accounts:[],registry:'recognized',publicKeyFingerprints:[],workspaces:[],warnings:[],stateHash:'fixture'});
   if(method==='accounts/list'){publish();return ok(catalog);}
   if(method==='theme/set'){state.theme=p.theme;publish();return ok(state);}
   if(method==='remote-configuration/list')return ok([]);
   if(method==='remote-cli/list')return ok(h.rows);
   if(method==='remote-cli/configure'){const row=h.rows.find(r=>r.provider===p.provider);row.policy={...row.policy,...p.changes,revision:row.policy.revision+1};return ok(row.policy);}
   if(method==='remote-cli/plan'&&h.planError?.[p.provider])return {ok:false,error:h.planError[p.provider]};
   if(method==='remote-cli/plan')return ok({id:'plan',provider:p.provider,operation:p.operation,currentVersion:'9.8.6',version:p.operation==='uninstall'?undefined:'9.8.7',targets:['/fixture/'+p.provider],size:1000000});
   if(method==='remote-cli/apply'){assertConfirm(p);if(h.holdCli)await new Promise(resolve=>h.cliResolvers.push({provider:p.provider,resolve}));const row=h.rows.find(r=>r.provider===p.provider);row.version='9.8.7';return ok(row);}
   if(method==='remote-browser/profiles')return ok({installed:h.installed,missing:h.installed?[]:['fixture browser component'],profiles:h.profiles});
   if(method==='remote-browser/setup-plan')return ok({id:'browser-fixture-plan',chromeVersion:'154.0.0.1',installChrome:true,archives:[{name:'noVNC-1.6.0',license:'MPL-2.0'}],packageTransaction:'Fixture only: complete package transaction. No package manager is invoked.'});
   if(method==='remote-browser/setup-apply'){assertConfirm(p);h.installed=true;return ok({configured:true});}
   if(method==='remote-browser/create'){h.profiles.push({key:'c'.repeat(32),label:p.label,available:true});return ok({installed:true,missing:[],profiles:h.profiles});}
   if(method==='remote-browser/rename'){h.profiles.find(r=>r.key===p.key).label=p.label;return ok({installed:true,missing:[],profiles:h.profiles});}
   if(method==='remote-browser/delete'){assertConfirm(p);h.profiles=h.profiles.filter(r=>r.key!==p.key);return ok({installed:true,missing:[],profiles:h.profiles});}
   if(method==='remote-browser/launch'){if(h.browserRunning)return {ok:false,error:'远端已有浏览器运行，请先关闭当前浏览器，再启动其他用户；继续操控现有浏览器请点“恢复连接”。'};h.browserRunning=true;h.browserProfile=p.profileKey;h.viewerOpens=(h.viewerOpens??0)+1;return ok({running:true,viewerReady:true,profilesPreserved:true,profileKey:p.profileKey});}
   if(method==='remote-browser/reconnect'){if(!h.browserRunning)return {ok:false,error:'远端浏览器没有运行，请先选择用户启动。'};h.viewerOpens=(h.viewerOpens??0)+1;return ok({running:true,viewerReady:true,profilesPreserved:true});}
   if(method==='remote-browser/stop'){assertConfirm(p);h.browserRunning=false;return ok({running:false,viewerReady:false,profilesPreserved:true});}
   if(method==='remote-browser/start'){h.complete=false;h.job={jobId:'fixture-login',accountId:p.accountId,state:'preparing',viewerReady:false,codeRequested:false,cleanup:'pending'};return ok(h.job);}
   if(method==='remote-browser/status'){if(h.complete)h.job={...h.job,state:'authenticated',viewerReady:false,codeRequested:false,cleanup:'confirmed'};return ok(h.job);}
   if(method==='remote-browser/open')return ok(null);
   if(method==='remote-browser/code'){if(p.code!=='fixture-approval')throw Error('Fixture code only');h.complete=true;return ok({...h.job,state:'authenticated',viewerReady:false,codeRequested:false,cleanup:'confirmed'});}
   if(method==='remote-browser/cancel'){h.job={...h.job,state:'cancelled',viewerReady:false,codeRequested:false,cleanup:'confirmed'};return ok(h.job);}
   if(method==='native-accounts/remove'){assertConfirm(p);catalog.accounts=catalog.accounts.filter(a=>a.id!==p.accountId);publish();return ok({removed:p.accountId});}
   h.unexpected.push(method);return {ok:false,error:'Unmocked operation blocked: '+method};
  });
  function assertConfirm(p){if(p.confirm!==true)throw Error('Explicit fixture confirmation required');}
 },{state,branding});
 await page.reload();await navigateWorkbench(page,'connections');
 const count=m=>app.evaluate((_e,m)=>globalThis.__remoteQA.requests.filter(r=>r.method===m).length,m);
 await check('administrator CLI tab only inspects until preview is confirmed',async()=>{
  await page.getByTestId('connection-tab-cli').click();await page.getByTestId('remote-cli-codex').waitFor();assert.equal(await count('remote-cli/apply'),0);
  await page.getByTestId('remote-cli-codex').getByRole('button',{name:'检查并更新'}).click();await page.getByRole('dialog',{name:'更新远端 Codex'}).waitFor();assert.equal(await count('remote-cli/apply'),0);await page.getByTestId('remote-cli-confirm').click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await count('remote-cli/apply'),1);
 });
 await check('uninstall icon shows a separate confirmation without deleting account data',async()=>{
  await page.getByRole('button',{name:'卸载 Claude Code'}).click();await page.getByRole('dialog',{name:'卸载远端 Claude Code'}).getByRole('button',{name:'取消'}).click();assert.equal(await count('remote-cli/apply'),1);assert.equal(await app.evaluate(()=>globalThis.__remoteQA.catalog.accounts.length),1);
 });
 await check('Codex and Claude maintenance confirmations run independently',async()=>{
  await app.evaluate(()=>{globalThis.__remoteQA.holdCli=true;globalThis.__remoteQA.cliResolvers=[];});
  for(const provider of ['codex','claude']){await page.getByTestId('remote-cli-'+provider).getByRole('button',{name:'检查并更新'}).click();await page.getByTestId('remote-cli-confirm').click();await page.getByRole('dialog').waitFor({state:'hidden'});}
  assert.deepEqual(await app.evaluate(()=>globalThis.__remoteQA.cliResolvers.map(r=>r.provider)),['codex','claude']);
  await app.evaluate(()=>{globalThis.__remoteQA.holdCli=false;for(const r of globalThis.__remoteQA.cliResolvers)r.resolve();});
  for(const provider of ['codex','claude'])await page.getByTestId('remote-cli-'+provider).getByRole('button',{name:'检查并更新'}).waitFor();
 });
 await check('automatic update stays inline and saves only its runtime',async()=>{
  const codex=page.getByTestId('remote-cli-codex');await codex.getByRole('checkbox',{name:'自动更新'}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="remote-cli-codex"] input[type="checkbox"]')?.checked);
  await page.waitForFunction(()=>!document.querySelector('[data-testid="remote-cli-codex"] fieldset')?.disabled);
  const policies=await app.evaluate(()=>globalThis.__remoteQA.rows.map(r=>r.policy));assert.equal(policies[0].autoUpdate,true);assert.equal(policies[1].autoUpdate,false);
  const bounds=await codex.boundingBox();assert.ok(bounds.height<130,JSON.stringify(bounds));
 });
 await page.locator('.toast').waitFor({state:'hidden'});
 await page.screenshot({path:path.join(output,'remote-cli-installed-light.png')});
 await check('missing CLI failures appear once per compact row after a failed preview',async()=>{
  await app.evaluate(()=>{const h=globalThis.__remoteQA;h.planError={codex:'官方安装脚本返回 HTTP 403，请求被拒绝。'};h.rows=h.rows.map(r=>({...r,installed:false,managed:false,canUninstall:false,version:undefined,latest:undefined,executable:'',error:'官方安装脚本返回 HTTP 403，请求被拒绝。'}));});
  await page.getByRole('button',{name:'刷新配置管理'}).click();const row=page.getByTestId('remote-cli-codex');await row.getByRole('button',{name:'安装最新版'}).click();
  await row.getByRole('alert').filter({hasText:'HTTP 403'}).waitFor();assert.equal(await page.locator('.remote-cli [role="alert"]').count(),2);
  assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await count('remote-cli/apply'),3);
  for(const provider of ['codex','claude'])assert.ok((await page.getByTestId('remote-cli-'+provider).boundingBox()).height<135);
 });
 await page.screenshot({path:path.join(output,'remote-cli-light.png')});
 await page.evaluate(()=>window.workbench.call('theme/set',{theme:'dark'}));await page.screenshot({path:path.join(output,'remote-cli-dark.png')});
 await check('narrow CLI rows expose toggles and install buttons without horizontal overflow',async()=>{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(880,680));await page.evaluate(()=>window.workbench.call('theme/set',{theme:'light'}));
  for(const provider of ['codex','claude']){
   const row=page.getByTestId('remote-cli-'+provider);await row.getByRole('button',{name:'安装最新版'}).scrollIntoViewIfNeeded();
   for(const control of [row.getByRole('checkbox',{name:'自动更新'}),row.getByRole('button',{name:'安装最新版'})]){
    const box=await control.boundingBox();const w=await page.evaluate(()=>document.documentElement.clientWidth);assert.ok(box&&box.x>=0&&box.x+box.width<=w+1);
   }
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
  await page.screenshot({path:path.join(output,'remote-cli-narrow.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,900));
 });
 await check('a successful deliberate preview clears only that runtime release error',async()=>{
  await app.evaluate(()=>{globalThis.__remoteQA.planError={};});const row=page.getByTestId('remote-cli-codex');
  await row.getByRole('button',{name:'安装最新版'}).click();await page.getByRole('dialog',{name:'安装远端 Codex'}).waitFor();
  assert.equal(await row.getByRole('alert').count(),0);assert.equal(await page.getByTestId('remote-cli-claude').getByRole('alert').count(),1);
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();assert.equal(await count('remote-cli/apply'),3);
 });
 await check('refresh clears stale row errors without maintenance or automatic retry',async()=>{
  await app.evaluate(()=>{const h=globalThis.__remoteQA;h.planError={};h.rows=h.rows.map(r=>({...r,error:undefined,latest:'9.8.7'}));});
  await page.getByRole('button',{name:'刷新配置管理'}).click();await page.getByTestId('remote-cli-claude').getByText('9.8.7',{exact:true}).waitFor();
  assert.equal(await page.locator('.remote-cli [role="alert"]').count(),0);assert.equal(await count('remote-cli/apply'),3);
 });
 await page.getByTestId('connection-tab-browser').click();
 await check('missing browser offers the complete simulated installation preview before confirmation',async()=>{
  await app.evaluate(()=>{globalThis.__remoteQA.installed=false;});await page.getByRole('button',{name:'刷新浏览器用户'}).click();await page.getByRole('button',{name:'检查并预览安装方案'}).click();await page.getByRole('dialog',{name:'配置远端浏览器'}).waitFor();await page.getByText('Fixture only: complete package transaction. No package manager is invoked.',{exact:true}).waitFor();assert.equal(await count('remote-browser/setup-apply'),0);await page.getByRole('button',{name:'确认安装所列组件'}).click();await page.getByTestId('browser-profile-create').waitFor();assert.equal(await count('remote-browser/setup-apply'),1);
 });
 await check('browser profile creation and rename use stable selected identities',async()=>{
  await page.getByTestId('browser-profile-create').click();await page.getByRole('dialog',{name:'新增浏览器用户'}).getByRole('textbox').fill('测试用户');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await page.getByText('测试用户',{exact:true}).waitFor();await page.getByRole('button',{name:'改名 测试用户'}).click();await page.getByRole('dialog').getByRole('textbox').fill('临时测试');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await page.getByText('临时测试',{exact:true}).waitFor();
 });
 await check('profile deletion confirms only the selected profile and removes its row',async()=>{
  await page.getByRole('button',{name:'删除 临时测试'}).click();assert.equal(await count('remote-browser/delete'),0);await page.getByRole('button',{name:'确认删除此用户'}).click();await page.getByText('临时测试',{exact:true}).waitFor({state:'hidden'});assert.equal(await count('remote-browser/delete'),1);assert.equal(await page.getByText('工作账号',{exact:true}).count(),1);
 });
 await check('selected browser user opens automatically and a second launch is blocked',async()=>{
  await page.getByRole('button',{name:'启动并打开 工作账号',exact:true}).click();
  await page.getByRole('button',{name:'启动并打开 工作账号',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="启动并打开 工作账号"]')?.disabled);
  assert.equal(await app.evaluate(()=>globalThis.__remoteQA.browserProfile),'b'.repeat(32));assert.equal(await app.evaluate(()=>globalThis.__remoteQA.viewerOpens),1);
  await page.getByRole('button',{name:'启动并打开 个人阅读',exact:true}).click();await page.getByRole('alert').filter({hasText:'先关闭当前浏览器'}).waitFor();
  assert.equal(await app.evaluate(()=>globalThis.__remoteQA.browserProfile),'b'.repeat(32));assert.equal(await app.evaluate(()=>globalThis.__remoteQA.viewerOpens),1);
 });
 await check('reconnection after leaving the panel opens its viewer without another browser launch',async()=>{
  await page.getByTestId('connection-tab-cli').click();await page.getByTestId('connection-tab-browser').click();
  await page.getByTestId('browser-reconnect').click();await page.waitForFunction(()=>!document.querySelector('[data-testid="browser-reconnect"]')?.disabled);
  assert.equal(await app.evaluate(()=>globalThis.__remoteQA.viewerOpens),2);assert.equal(await count('remote-browser/launch'),2);assert.equal(await count('remote-browser/stop'),0);
 });
 await check('closing browser requires confirmation and preserves every saved profile',async()=>{
  await page.getByTestId('browser-stop').click();await page.getByRole('dialog',{name:'关闭远端浏览器'}).waitFor();assert.equal(await count('remote-browser/stop'),0);
  await page.getByRole('button',{name:'确认关闭',exact:true}).click();await page.getByRole('dialog',{name:'关闭远端浏览器'}).waitFor({state:'hidden'});
  assert.equal(await app.evaluate(()=>globalThis.__remoteQA.browserRunning),false);assert.equal(await app.evaluate(()=>globalThis.__remoteQA.profiles.length),2);assert.equal(await count('remote-browser/delete'),1);
  await page.getByTestId('browser-reconnect').click();await page.getByRole('alert').filter({hasText:'没有运行'}).waitFor();assert.equal(await count('remote-browser/launch'),2);
  await page.getByRole('button',{name:'刷新浏览器用户'}).click();
 });
 await page.screenshot({path:path.join(output,'browser-users-light.png')});
 await page.evaluate(()=>window.workbench.call('theme/set',{theme:'dark'}));await page.screenshot({path:path.join(output,'browser-users-dark.png')});
 await page.getByTestId('connection-tab-accounts').click();await page.getByTestId('provider-claude').click();
 await page.getByRole('button',{name:'远端浏览器登录',exact:true}).click();
 await check('Claude login requires an explicit remote profile and opens only the simulated viewer',async()=>{
  assert.equal(await page.getByTestId('claude-browser-start').isDisabled(),true);await page.getByTestId('claude-browser-profile').click();await page.getByRole('menuitemradio',{name:'工作账号',exact:true}).click();await page.getByTestId('claude-browser-start').click();
  await page.getByText('正在准备远端浏览器',{exact:true}).waitFor();assert.equal(await page.getByTestId('claude-browser-open').isDisabled(),true);assert.equal(await count('remote-browser/open'),0);
  await page.screenshot({path:path.join(output,'claude-preparing-browser-dark.png')});
  await app.evaluate(()=>{globalThis.__remoteQA.job={...globalThis.__remoteQA.job,state:'awaiting-browser',viewerReady:true};});
  await page.getByText('请在远端浏览器完成授权',{exact:true}).waitFor();await page.getByTestId('claude-browser-open').click();assert.equal(await count('remote-browser/open'),1);assert.equal(await app.evaluate(()=>globalThis.__remoteQA.requests.find(r=>r.method==='remote-browser/start').p.profileKey),'b'.repeat(32));
 });
 await check('fallback code entry is shown only after native prompt and clears after submission',async()=>{
  await app.evaluate(()=>{globalThis.__remoteQA.job.codeRequested=true;});await page.getByTestId('claude-callback-code').waitFor();assert.equal(await page.getByTestId('claude-callback-code').getAttribute('type'),'password');await page.getByTestId('claude-callback-code').fill('fixture-approval');await page.getByRole('button',{name:'提交授权码',exact:true}).click();await page.getByText('Claude 原生登录已核实',{exact:true}).waitFor();await page.getByTestId('claude-callback-code').waitFor({state:'hidden'});assert.equal(await count('remote-browser/code'),1);
 });
 await page.screenshot({path:path.join(output,'claude-simulated-login-dark.png')});
 const freshLogin=async()=>{await page.getByRole('dialog',{name:'Claude · 远端浏览器登录'}).getByRole('button',{name:'关闭窗口',exact:true}).click();await page.getByRole('button',{name:'远端浏览器登录',exact:true}).click();await page.getByTestId('claude-browser-profile').click();await page.getByRole('menuitemradio',{name:'工作账号',exact:true}).click();};
 await check('successful login cannot be accidentally restarted',async()=>{assert.equal(await page.getByTestId('claude-browser-start').isDisabled(),true);});
 await freshLogin();
 await check('automatic callback completes without asking for another code',async()=>{
  await page.getByTestId('claude-browser-start').click();await app.evaluate(()=>{globalThis.__remoteQA.complete=true;});await page.getByText('Claude 原生登录已核实',{exact:true}).waitFor();assert.equal(await page.getByTestId('claude-callback-code').count(),0);assert.equal(await count('remote-browser/code'),1);
 });
 await freshLogin();
 for(const error of ['未识别远端 CLI 的授权地址，浏览器未打开；请检查 CLI 登录入口兼容性。','等待远端 CLI 授权地址超时，浏览器未打开；请重新开始登录。','远端浏览器启动超时。']){
  await check('preparation failure clears pending controls: '+error,async()=>{
   await page.getByTestId('claude-browser-start').click();
   await app.evaluate((_electron,error)=>{globalThis.__remoteQA.job={...globalThis.__remoteQA.job,state:'failed',viewerReady:false,codeRequested:false,cleanup:'confirmed',error};},error);
   await page.getByText(error,{exact:true}).waitFor();assert.equal(await page.getByTestId('claude-browser-open').isDisabled(),true);assert.equal(await page.getByTestId('claude-callback-code').count(),0);assert.equal(await page.getByTestId('claude-browser-start').isEnabled(),true);
   await page.screenshot({path:path.join(output,'claude-preparation-failure-'+checks.length+'.png')});
  });
  await freshLogin();
 }
 await check('cancel closes this simulated flow without deleting saved profiles',async()=>{
  await page.getByTestId('claude-browser-start').click();await page.getByRole('button',{name:'结束并关闭本次进程'}).click();await page.getByText('本次登录已取消',{exact:true}).waitFor();assert.equal(await count('remote-browser/cancel'),1);assert.equal(await app.evaluate(()=>globalThis.__remoteQA.profiles.length),2);
 });
 await page.getByRole('dialog',{name:'Claude · 远端浏览器登录'}).getByRole('button',{name:'关闭窗口',exact:true}).click();
 await check('account removal needs confirmation then disappears from the shared catalog',async()=>{
  await page.getByRole('button',{name:'移除共享账号'}).click();assert.equal(await count('native-accounts/remove'),0);await page.getByRole('button',{name:'确认退出并移除'}).click();await page.getByTestId('native-state-claude-fixture').waitFor({state:'hidden'});assert.equal(await count('native-accounts/remove'),1);
 });
 await page.getByTestId('connection-tab-browser').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(880,680));await page.evaluate(()=>window.workbench.call('theme/set',{theme:'light'}));await page.screenshot({path:path.join(output,'browser-users-narrow.png')});
 await check('narrow layout has no horizontal document overflow and browser controls remain reachable',async()=>{
  const size=await page.evaluate(()=>({w:document.documentElement.clientWidth,s:document.documentElement.scrollWidth}));assert.ok(size.s<=size.w+1);
  const launch=page.getByRole('button',{name:'启动并打开 工作账号',exact:true});await launch.scrollIntoViewIfNeeded();
  const bounds=await launch.boundingBox();assert.ok(bounds&&bounds.width>0&&bounds.x>=0&&bounds.x+bounds.width<=size.w+1);
  await page.screenshot({path:path.join(output,'browser-users-narrow-controls.png')});
 });
 assert.deepEqual(errors,[]);assert.deepEqual(await app.evaluate(()=>globalThis.__remoteQA.unexpected),[]);assert.equal(await count('draft/submit'),0);
}catch(error){failure={message:error.message,stack:error.stack};if(app)failure.unexpected=await app.evaluate(()=>globalThis.__remoteQA?.unexpected??[]).catch(()=>[]);if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({syntheticOnly:true,realBrowserForbidden:true,checks,errors,...(failure?{failure}:{})},null,2));}
console.log(`Remote management UI: ${checks.length}/${checks.length} passed`);
