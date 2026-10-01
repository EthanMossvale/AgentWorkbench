import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as bundle} from 'esbuild';
import {build as rendererBuild} from 'vite';
import {mkdtemp,mkdir,writeFile,cp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {navigateWorkbench} from './ui-control-helpers.mjs';

const root=process.cwd(),output=path.join(root,'build/qa/native-account-ui-20260926'),application=path.join(output,'application');
await mkdir(application,{recursive:true});
await rendererBuild({build:{outDir:path.join(application,'renderer'),emptyOutDir:true}});
for(const name of ['main','preload'])await bundle({entryPoints:[`apps/desktop/host/${name}.ts`],outfile:path.join(application,`host/${name}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await cp('services/vps-account-broker',path.join(application,'host/account-runtime'),{recursive:true,filter:p=>!p.includes('__pycache__')});
await cp('services/vps-workspace-control',path.join(application,'host/workspace-control'),{recursive:true,filter:p=>!p.includes('__pycache__')});
await writeFile(path.join(application,'package.json'),JSON.stringify({name:'native-account-ui-fixture',version:'1.0.0',main:'host/main.cjs'}));
const directory=await mkdtemp(path.join(os.tmpdir(),'awb-native-account-ui-'));
let app,failure;const checks=[],errors=[];const check=async(name,fn)=>{await fn();checks.push(name);};
try{
 app=await electron.launch({executablePath:electronPath,args:[application],cwd:root,env:{...process.env,AGENT_WORKBENCH_TEST_DATA:directory,ELECTRON_RUN_AS_NODE:undefined}});
 const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>!!window.workbench);
 const state=await page.evaluate(()=>window.workbench.call('state/get'));
 await app.evaluate(({ipcMain,BrowserWindow},state)=>{
  const now=new Date().toISOString();
  state.hosts=[{id:'admin',name:'界面验收 · 合成数据，未连接 VPS',hostname:'fixture.invalid',port:2222,username:'root',role:'admin',identityFile:'C:\\fixture\\key',knownHostsFile:'C:\\fixture\\known',ownerId:'local-owner',workspaceGeneration:'admin'}];state.theme='dark';
  const catalog={availability:'ready',source:'native-owner',authorityId:'authority',generation:'g',revision:1,workspaceId:'administrator',selectionRevision:0,claudeSelectionRevision:0,accounts:[{id:'codex-one',generation:'ag',provider:'codex',status:'authenticated',email:'fixture@example.invalid',plan:'Pro',observedAt:now},{id:'claude-one',generation:'cg',provider:'claude',status:'unauthenticated',displayName:'Claude 测试账号',observedAt:now}]};
  state.accountCatalogs={admin:catalog};
  const h=globalThis.__nativeQa={state,catalog,requests:[],unexpected:[],count:1};
  const publish=()=>BrowserWindow.getAllWindows()[0].webContents.send('workbench:state',state);
  ipcMain.removeHandler('workbench:call');ipcMain.handle('workbench:call',async(_e,method,p={})=>{
   h.requests.push({method,p});const ok=value=>({ok:true,value});
   if(['extensions/renderers','model-targets/list','local-cli/list','runtime/catalog'].includes(method))return ok([]);
   if(method==='extensions/appearance')return ok({variables:{}});
   if(method==='navigation/view')return ok({sessionId:h.migrationSessionId??null});
   if(method==='state/get')return ok(state);if(method==='navigation/get')return ok({sessionId:h.migrationSessionId??null});if(method==='translation/usage')return ok({calls:0,cost:null});if(method==='codex-auth/current')return ok(null);
   if(method==='session/read')return ok(state);
   if(method==='runtime/models')return {ok:false,error:'Synthetic fixture has no native H acceptance.'};
   if(method==='session/migration-manifest'){h.clipboard=JSON.stringify({sessionId:p.sessionId,threadId:state.sessions[0].binding.nativeSessionId});return ok(null);}
   if(method==='session/migrate-native'){
    if(!h.migrationReady)return {ok:false,error:'管理员尚未完成此会话的原生账号与历史迁移，原历史仍保留。'};
    const s=state.sessions[0];s.binding.accountRuntime='native-owner';s.binding.accountRef='vps-account:authority/g/codex/codex-one/ag';s.nativeReady=false;publish();return ok({});
   }
   if(method==='accounts/list'){publish();return ok(catalog);}
   if(method==='host/discover')return ok({hostId:p.id,workspaces:[],accounts:[],warnings:[]});
   if(method==='accounts/setup-plan')return ok({downloads:h.setupDownload?['codex','claude'].map(provider=>({provider,version:provider==='codex'?'0.155.1':'2.1.281',url:'https://official.invalid/fixture',sha256:'a'.repeat(64),size:provider==='codex'?101581479:237375560,target:'/opt/agent-workbench/native/'+provider})):[],detected:h.setupDownload?[{provider:'codex',path:'/root/.local/bin/codex',status:'untrusted'}]:[],id:'fixture-plan',status:h.setupBlocked?'blocked':'installable',blockers:h.setupBlocked?['CLI_PLATFORM_UNSUPPORTED']:[],warnings:[],paths:['/opt/agent-workbench/account-runtime','/etc/agent-workbench/accounts.json','/var/lib/agent-workbench-accounts'],owner:'agent-workbench-accounts',binaries:{codex:'/usr/bin/codex',claude:'/usr/bin/claude'},authorityId:'authority',generation:'g',createOwner:true,policyPath:'/var/lib/agent-workbench-policy/workspaces.json'});
   if(method==='accounts/setup-apply'){if(h.setupFail)return {ok:false,error:'下载官方 CLI 失败，请检查 VPS 出网后重新预览。'};if(p.confirm!==true)return {ok:false,error:'Confirmation required'};catalog.availability='ready';catalog.source='native-owner';catalog.accounts=[];publish();return ok({status:'ready',authorityId:'authority',generation:'g'});}
   if(method==='accounts/enroll-legacy'){if(p.confirm!==true)return {ok:false,error:'Confirmation required'};catalog.accounts.push({...catalog.legacy.accounts.find(a=>a.id===p.accountId),status:'unauthenticated'});publish();return ok({accountId:p.accountId});}
   if(method==='studio/list')return ok({availability:'ready',authorityId:'authority',generation:'g',revision:1,workspaces:[],connection:{hostname:'fixture.invalid',port:2222,hostPublicKeys:[]},enrollmentUrl:'',transport:'ssh'});
   if(method==='theme/set'){state.theme=p.theme;publish();return ok(state);}
   if(method==='native-accounts/status'||method==='native-accounts/review'){
    const a=catalog.accounts.find(a=>a.id===p.accountId);a.status='authenticated';publish();
    return ok({accountId:a.id,provider:a.provider,installed:true,authenticated:true,versionMatched:true,version:a.provider==='claude'?'2.1.281 (Claude Code)':'codex-cli 0.155.1',execution:a.provider==='claude'?'local-tools-unverified':'local-executor-required',block:method.endsWith('/review')?null:a.provider==='codex'?{reason:'rate_limited',observedAt:Date.now()/1000}:null});
   }
   if(method==='native-accounts/login-command')return ok({command:catalog.accounts.find(a=>a.id===p.accountId).provider==='claude'?'sudo -u fixture-owner env -i CLAUDE_CONFIG_DIR=/fixture/private /fixture/claude auth login':'sudo -u fixture-owner env -i CODEX_HOME=/fixture/private /fixture/codex login'});
   if(method==='clipboard/write'){h.clipboard=p.text;return ok(null);}
   if(method==='native-accounts/create-claude'){const id='claude-'+(++h.count);catalog.accounts.push({id,generation:'g'+h.count,provider:'claude',status:'unauthenticated',observedAt:now});publish();return ok({accountId:id});}
   if(method==='accounts/usage')return ok({accountId:p.accountId,observedAt:now,availability:'ready',pools:[{id:'codex',name:'Codex',secondary:{usedPercent:25,windowMinutes:10080,resetsAt:2000000000}}],cards:[],cardsSupported:false});
   h.unexpected.push(method);return {ok:false,error:'Unexpected fixture operation: '+method};
  });
 },state);
 await page.reload();await navigateWorkbench(page,'connections');await page.getByTestId('connection-tab-accounts').click();
 const count=method=>app.evaluate((_e,m)=>globalThis.__nativeQa.requests.filter(r=>r.method===m).length,method);
 await check('Codex and Claude catalog rows stay in their own provider tabs',async()=>{
  assert.equal(await page.getByTestId('shared-account-codex-one').count(),1);assert.equal(await page.getByTestId('shared-account-claude-one').count(),0);
  assert.match(await page.getByTestId('provider-codex').innerText(),/1/);assert.match(await page.getByTestId('provider-claude').innerText(),/1/);
  assert.equal(await count('native-accounts/status'),0);
 });
 await check('status and recovery are explicit and do not submit a model task',async()=>{
  const row=page.getByTestId('native-state-codex-one');await row.getByRole('button',{name:'核实状态',exact:true}).click();await row.getByText('账号额度已达限制',{exact:true}).waitFor();await row.getByRole('button',{name:'重新读取原生状态并核实恢复'}).click();await row.getByText('原生登录已核实',{exact:true}).waitFor();assert.equal(await count('native-accounts/review'),1);assert.equal(await count('draft/submit'),0);
 });
 await page.screenshot({path:path.join(output,'codex-owner-dark.png')});
 await check('Claude native login is prepared without presenting token entry',async()=>{
  await page.getByTestId('provider-claude').click();const row=page.getByTestId('native-state-claude-one');await row.getByRole('button',{name:'复制官方登录命令'}).click();assert.match(await app.evaluate(()=>globalThis.__nativeQa.clipboard),/ auth login$/);assert.equal(await page.getByTestId('claude-management').locator('input').count(),0);
  await row.getByRole('button',{name:'核实状态',exact:true}).click();await row.getByText(/本机工具链待验收/).waitFor();
 });
 await check('adding a Claude native profile updates only its provider count',async()=>{
  await page.getByTestId('claude-create').click();await page.getByTestId('native-state-claude-2').waitFor();assert.equal(await count('native-accounts/create-claude'),1);assert.match(await page.getByTestId('provider-codex').innerText(),/1/);assert.match(await page.getByTestId('provider-claude').innerText(),/2/);
 });
 await page.screenshot({path:path.join(output,'claude-owner-dark.png')});
 await check('native account management fits the narrow light theme',async()=>{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(920,740));await page.evaluate(()=>window.workbench.call('theme/set',{theme:'light'}));
  const overflow=await page.locator('.host-detail').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,right:e.getBoundingClientRect().right,viewport:innerWidth}));assert.ok(overflow.scroll<=overflow.width+1&&overflow.right<=overflow.viewport,JSON.stringify(overflow));
  await page.screenshot({path:path.join(output,'claude-owner-light-narrow.png')});
 });
 await check('missing native service keeps old public accounts visible without per-workspace logins',async()=>{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));
  await app.evaluate(({BrowserWindow})=>{const h=globalThis.__nativeQa;h.catalog.availability='unavailable';delete h.catalog.source;h.catalog.accounts=[];h.catalog.legacy={availability:'ready',authorityId:'old',generation:'old-g',revision:1,accounts:[{id:'old-one',generation:'old-ag',provider:'codex',status:'configured',email:'original@example.invalid',observedAt:new Date().toISOString()}]};BrowserWindow.getAllWindows()[0].webContents.send('workbench:state',h.state);});
  await page.getByTestId('account-service-pending').waitFor();assert.equal(await page.getByText('各空间的原生登录与可用状态').count(),0);assert.equal(await page.getByText(/在对应空间的远端终端/).count(),0);assert.equal(await page.getByTestId('claude-create').count(),0);
  await page.getByTestId('provider-codex').click();await page.getByTestId('legacy-account-catalog').waitFor();assert.match(await page.getByTestId('legacy-account-catalog').innerText(),/original@example.invalid/);assert.equal(await count('host/discover'),1);assert.equal(await count('accounts/setup-apply'),0);
  await page.screenshot({path:path.join(output,'central-service-missing-light.png')});
 });
 await check('setup preview is explicit and cancelling does not install or authorize',async()=>{
  await page.getByTestId('account-service-prepare').click();const modal=page.getByRole('dialog',{name:'准备统一账号服务'});await modal.waitFor();assert.match(await modal.innerText(),/集中保管原生登录/);assert.equal(await count('accounts/setup-apply'),0);await modal.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await count('accounts/setup-apply'),0);assert.equal(await count('codex-auth/start'),0);
 });
 await check('central setup and official installation preview fit the minimum window',async()=>{
  await app.evaluate(()=>{globalThis.__nativeQa.setupDownload=true;});
  const layout=await page.locator('.host-detail').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,right:e.getBoundingClientRect().right,viewport:innerWidth}));assert.ok(layout.scroll<=layout.width+1&&layout.right<=layout.viewport,JSON.stringify(layout));
  await page.getByTestId('account-service-prepare').click();const modal=page.getByRole('dialog',{name:'准备统一账号服务'});assert.equal(await page.getByTestId('account-service-confirm').innerText(),'确认一键配置');assert.match(await page.getByTestId('account-cli-downloads').innerText(),/Claude 2.1.281/);assert.match(await page.getByTestId('account-cli-detected').innerText(),/路径权限待核实/);const box=await modal.evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,bottom:e.getBoundingClientRect().bottom,right:e.getBoundingClientRect().right,height:innerHeight,viewport:innerWidth}));assert.ok(box.scroll<=box.width+1&&box.bottom<=box.height+1&&box.right<=box.viewport,JSON.stringify(box));const confirm=await page.getByTestId('account-service-confirm').boundingBox();assert.ok(confirm&&confirm.y>=0&&confirm.y+confirm.height<=640);await page.locator('.toast').waitFor({state:'hidden',timeout:6000});await page.screenshot({path:path.join(output,'central-setup-minimum-window.png')});await modal.getByRole('button',{name:'取消',exact:true}).click();
 });
 await check('blocked preparation explains the missing dependency without enabling install',async()=>{
  await app.evaluate(()=>{globalThis.__nativeQa.setupBlocked=true;});await page.getByTestId('account-service-prepare').click();const modal=page.getByRole('dialog',{name:'准备统一账号服务'});await modal.getByText(/系统或架构暂无已验证/).waitFor();assert.equal(await page.getByTestId('account-service-confirm').count(),0);await modal.getByRole('button',{name:'取消',exact:true}).click();await app.evaluate(()=>{globalThis.__nativeQa.setupBlocked=false;});
 });
 await check('failed download keeps the error visible and requires a fresh preview before retry',async()=>{
  await app.evaluate(()=>{globalThis.__nativeQa.setupFail=true;});await page.getByTestId('account-service-prepare').click();await page.getByTestId('account-service-confirm').click();const modal=page.getByRole('dialog',{name:'准备统一账号服务'});await modal.getByText(/此次配置未确认完成/).waitFor();assert.match(await modal.innerText(),/下载官方 CLI 失败/);assert.equal(await page.getByTestId('account-service-confirm').count(),0);assert.equal(await count('codex-auth/start'),0);await app.evaluate(()=>{globalThis.__nativeQa.setupFail=false;});await modal.getByRole('button',{name:'重新检查',exact:true}).click();await page.getByTestId('account-service-confirm').waitFor();await modal.getByRole('button',{name:'取消',exact:true}).click();
 });
 await check('confirmed setup makes both provider entry points available from one service',async()=>{
  await page.getByTestId('legacy-enroll-old-one').click();await page.getByRole('dialog',{name:'准备统一账号服务'}).getByText('查看接入位置').click();await page.screenshot({path:path.join(output,'central-service-setup-light.png')});await page.getByTestId('account-service-confirm').click();await page.getByTestId('codex-auth-start').waitFor();assert.equal(await count('accounts/setup-apply'),2);assert.equal(await count('codex-auth/start'),0);await page.getByTestId('provider-claude').click();await page.getByTestId('claude-create').waitFor();
 });
 await check('legacy enrollment preserves identity and reuses a central login command',async()=>{
  await page.getByTestId('provider-codex').click();await page.getByTestId('legacy-enroll-old-one').click();await page.getByRole('dialog',{name:'接入原账号'}).getByRole('button',{name:'取消',exact:true}).click();assert.equal(await count('accounts/enroll-legacy'),0);await page.getByTestId('legacy-enroll-old-one').click();await page.getByTestId('confirm-legacy-enroll').click();const row=page.getByTestId('native-state-old-one');await row.waitFor();assert.equal(await page.getByTestId('legacy-enroll-old-one').count(),0);assert.equal(await count('accounts/enroll-legacy'),1);await row.getByRole('button',{name:'复制官方登录命令'}).click();assert.match(await app.evaluate(()=>globalThis.__nativeQa.clipboard),/CODEX_HOME=.+ login$/);assert.equal(await count('draft/submit'),0);
  await page.evaluate(()=>window.workbench.call('theme/set',{theme:'dark'}));await page.screenshot({path:path.join(output,'central-legacy-enrolled-dark.png')});
 });
 await check('legacy session shows a compact migration notice while retaining its history and draft',async()=>{
  await app.evaluate(({BrowserWindow})=>{
   const h=globalThis.__nativeQa;h.migrationSessionId='00000000-0000-4000-8000-000000000001';h.state.theme='dark';
   h.state.sessions=[{id:h.migrationSessionId,title:'旧会话迁移 · 合成历史',projectId:null,projectPath:'C:\\Fixture',createdAt:new Date().toISOString(),group:'',pinned:false,archived:false,status:'uncertain',nativeReady:false,nativeTurnId:'old-turn',binding:{runtime:'codex',provider:'openai',hostId:'member',accountRef:'vps-account:old/g/codex/codex-one/ag',executionId:'local-device',egress:'vps',nativeSessionId:'00000000-0000-4000-8000-000000000002'},messages:[{id:'old-message',role:'assistant',original:'This is preserved synthetic history.',timestamp:new Date().toISOString(),demo:false}]}];
   h.state.hosts.push({...h.state.hosts[0],id:'member',role:'workspace',username:'member'});BrowserWindow.getAllWindows()[0].webContents.send('workbench:state',h.state);
  });
  await page.reload();await navigateWorkbench(page,'workspace');await page.getByTestId('legacy-account-migration').waitFor();
  await page.getByTestId('composer-input').fill('保留这份尚未发送的草稿');await page.getByRole('button',{name:'复制迁移资料',exact:true}).click();
  assert.ok(!(await app.evaluate(()=>globalThis.__nativeQa.clipboard)).includes('synthetic history'));
  await page.getByTestId('adopt-native-migration').click();await page.getByText(/管理员尚未完成此会话/).waitFor();
  assert.equal(await page.getByTestId('composer-input').inputValue(),'保留这份尚未发送的草稿');assert.equal(await page.getByTestId('legacy-account-migration').count(),1);
  await page.screenshot({path:path.join(output,'legacy-migration-dark.png')});
  await page.evaluate(()=>window.workbench.call('theme/set',{theme:'light'}));
  const box=await page.getByTestId('legacy-account-migration').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));assert.ok(box.scroll<=box.width+1);
  await page.screenshot({path:path.join(output,'legacy-migration-light-narrow.png')});
 });
 await check('verified adoption removes the migration notice without submitting or changing history',async()=>{
  await app.evaluate(()=>{globalThis.__nativeQa.migrationReady=true;});await page.getByTestId('adopt-native-migration').click();await page.getByTestId('legacy-account-migration').waitFor({state:'hidden'});
  assert.equal(await page.getByTestId('composer-input').inputValue(),'保留这份尚未发送的草稿');assert.equal(await count('draft/submit'),0);
  assert.equal(await app.evaluate(()=>globalThis.__nativeQa.state.sessions[0].messages[0].original),'This is preserved synthetic history.');
 });
 assert.deepEqual(errors,[]);assert.deepEqual(await app.evaluate(()=>globalThis.__nativeQa.unexpected),[]);
}catch(e){failure={message:e.message,stack:e.stack};throw e;}finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({syntheticOnly:true,checks,errors,...(failure?{failure}:{})},null,2));}
console.log(`Native account UI: ${checks.length}/${checks.length} passed`);
