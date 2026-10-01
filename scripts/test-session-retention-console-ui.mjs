import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {navigateWorkbench} from './ui-control-helpers.mjs';
const root=process.env.AWB_QA_APPLICATION,output=process.env.AWB_QA_OUTPUT;
if(!root||!output)throw Error('An isolated application and output are required.');
await mkdir(output,{recursive:true});const directory=await mkdtemp(path.join(os.tmpdir(),'awb-retention-ui-'));
let app,page,failure;const checks=[],errors=[];const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
try{
 app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env:{...process.env,AGENT_WORKBENCH_TEST_DATA:directory,AGENT_WORKBENCH_TEST_HIDDEN:'1',ELECTRON_RUN_AS_NODE:undefined}});
 page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
 const state=await page.evaluate(()=>window.workbench.call('state/get'));
 await app.evaluate(({ipcMain,BrowserWindow,session},state)=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,cb)=>cb({cancel:true}));
  state.hosts=[{id:'admin',name:'会话清理 · 隔离测试',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:'C:/fixture/key',knownHostsFile:'C:/fixture/known',ownerId:'fixture',workspaceGeneration:'g'}];state.theme='light';
  const h=globalThis.__retentionQA={state,requests:[],unexpected:[],offline:false,conflict:false,delay:false,start:Date.now()/1000,policies:{codex:{revision:0,autoUpdate:false,reclaimIdle:true,idleHours:24},claude:{revision:0,autoUpdate:false,reclaimIdle:false,idleHours:24}}};
  const publish=()=>BrowserWindow.getAllWindows()[0].webContents.send('workbench:state',state);
  const rows=(provider,after)=>{
   const policy=h.policies[provider],base={accountId:'account-fixture',accountGeneration:'ag',threadId:'native-fixture',eligible:false,clockReason:'recent_model_activity',active:false,interrupted:false,uncertain:false,remoteState:'present',operation:null};
   const item=(sessionId,title,last,extra={})=>({...base,sessionId,title,lastModelActivity:last,idleSeconds:last===null?null:Date.now()/1000-last,dueAt:last===null?null:last+policy.idleHours*3600,...extra});
   return after?[item('next-page','下一页原生会话',h.start-3600)]:[
    item('recent','整理项目与生成产物',h.start-23*3600,{active:true}),
    item('interrupted','已中断的工作区检查',h.start-25*3600,{interrupted:true,eligible:true,clockReason:'expired'}),
    item('unknown','等待首次原生活动',null,{threadId:null,clockReason:'activity_unknown'}),
    item('reclaimed','已保留本机归档的会话',h.start-48*3600,{remoteState:'reclaimed',localArchive:'reclaimed',localBytes:26843545}),
   ];
  };
  ipcMain.removeHandler('workbench:call');ipcMain.handle('workbench:call',async(_event,method,p={})=>{
   h.requests.push({method,p});const ok=value=>({ok:true,value});
   if(method==='state/get')return ok(state);if(method==='navigation/get'||method==='navigation/view')return ok({sessionId:null});if(method==='translation/usage')return ok({calls:0,cost:null});if(method==='codex-auth/current')return ok(null);
   if(['extensions/renderers','local-cli/list','model-targets/list','runtime/catalog'].includes(method))return ok([]);if(method==='extensions/appearance')return ok({variables:{}});
   if(method==='host/discover')return ok({hostId:'admin',ownerId:'fixture',generation:'g',observedAt:new Date().toISOString(),effectiveUid:0,privilege:'root',accounts:[],registry:'recognized',publicKeyFingerprints:[],workspaces:[],warnings:[],stateHash:'fixture'});
   if(method==='studio/list')return ok({availability:'ready',authorityId:'fixture',generation:'g',revision:1,workspaces:[],connection:{hostname:'fixture.invalid',port:22,hostPublicKeys:[]},enrollmentUrl:'',transport:'ssh'});
   if(method==='theme/set'){state.theme=p.theme;publish();return ok(state);}
   if(method==='remote-storage/inspect'){
    if(h.delay&&p.provider==='codex')await new Promise(r=>setTimeout(r,250));
    if(h.offline)return {ok:false,error:'SSH 连接失败，请检查网络和管理员密钥。'};
    return ok({provider:p.provider,policy:h.policies[p.provider],available:true,observedAt:Date.now()/1000,receivedAt:Date.now()/1000,sessions:rows(p.provider,p.after),total:51,nextCursor:p.after?null:'reclaimed',loginBusy:false,running:false});
   }
   if(method==='remote-storage/logs')return ok({entries:p.before?[]:[{id:'error-log',at:Date.now()-60000,lastAt:Date.now()-60000,provider:p.provider,kind:'error',message:'本机空间不足或低于保留余量；未删除远端唯一副本，请先释放本机空间。',sessionIds:['interrupted'],code:'LOCAL_DISK_PRESSURE',repeat:1},{id:'success-log',at:Date.now()-120000,lastAt:Date.now()-120000,provider:p.provider,kind:'reclaimed',message:'本机归档已校验，远端会话副本已清理。',sessionIds:['reclaimed'],bytes:26843545,repeat:1},{id:'deferred-log',at:Date.now()-180000,lastAt:Date.now()-180000,provider:p.provider,kind:'deferred',message:'达到本轮传输限额，进度已保存，下轮继续。',sessionIds:['recent'],repeat:1}],nextBefore:p.before?null:'deferred-log',location:'<application-data>/remote-session-archives/logs',maxEntries:2000,retentionDays:30});
   if(method==='remote-cli/configure'){if(h.conflict)return {ok:false,error:'策略已被其他窗口修改，请刷新后重新保存。'};const policy=h.policies[p.provider];if(p.revision!==policy.revision)throw Error('Revision conflict');h.policies[p.provider]={...policy,...p.changes,revision:policy.revision+1};return ok(h.policies[p.provider]);}
   h.unexpected.push(method);return {ok:false,error:'Unmocked operation blocked: '+method};
  });
 },state);
 await page.reload();await navigateWorkbench(page,'connections');await page.getByTestId('connection-tab-retention').click();
 const panel=page.locator('.remote-retention');
 await check('read-only session rows display actual interruption, unknown and reclaimed states',async()=>{
  await page.getByTestId('retention-session-interrupted').waitFor();assert.match(await page.getByTestId('retention-session-interrupted').innerText(),/已中断[\s\S]*待清理/);
  assert.match(await page.getByTestId('retention-session-unknown').innerText(),/暂无原生记录/);assert.match(await page.getByTestId('retention-session-reclaimed').innerText(),/已清理/);
  const requests=await app.evaluate(()=>globalThis.__retentionQA.requests);assert.equal(requests.filter(r=>/reclaim|configure|apply/.test(r.method)).length,0);
 });
 await check('countdown ticks locally without refreshing model activity',async()=>{const cell=page.getByTestId('retention-session-recent').locator('.retention-countdown'),before=await cell.innerText();await page.waitForTimeout(1200);assert.notEqual(await cell.innerText(),before);});
 await page.screenshot({path:path.join(output,'retention-light.png')});
 await check('custom hours persist and providers keep independent policies',async()=>{
  await panel.getByRole('spinbutton',{name:'Codex 闲置小时数'}).fill('48');await panel.getByRole('button',{name:'保存',exact:true}).click();await page.waitForFunction(()=>globalThis.__unused===undefined);await page.waitForTimeout(120);
  assert.equal(await app.evaluate(()=>globalThis.__retentionQA.policies.codex.idleHours),48);
  await panel.getByRole('tab',{name:'Claude Code',exact:true}).click();await panel.getByRole('spinbutton',{name:'Claude Code 闲置小时数'}).waitFor();assert.equal(await panel.getByRole('spinbutton').inputValue(),'24');assert.equal(await panel.getByRole('checkbox',{name:'自动清理',exact:true}).isChecked(),false);
  await panel.getByRole('checkbox',{name:'自动清理',exact:true}).click();await page.waitForTimeout(120);assert.equal(await app.evaluate(()=>globalThis.__retentionQA.policies.claude.reclaimIdle),true);
  await panel.getByRole('tab',{name:'Codex',exact:true}).click();await panel.getByRole('spinbutton',{name:'Codex 闲置小时数'}).waitFor();assert.equal(await panel.getByRole('spinbutton').inputValue(),'48');
 });
 await check('session pagination reaches later remote rows',async()=>{await panel.getByRole('button',{name:'下一页',exact:true}).click();await page.getByTestId('retention-session-next-page').waitFor();await panel.getByRole('button',{name:'上一页',exact:true}).click();await page.getByTestId('retention-session-recent').waitFor();});
 await check('logs show failure reasons, detail identifiers and local storage location',async()=>{assert.match(await panel.locator('.retention-logs').innerText(),/本机空间不足/);await panel.locator('.retention-log-details').first().locator('summary').click();assert.match(await panel.locator('.retention-log-details').first().innerText(),/LOCAL_DISK_PRESSURE[\s\S]*interrupted/);await panel.getByText('本机日志位置',{exact:true}).click();assert.match(await panel.locator('.retention-log-location').innerText(),/remote-session-archives\/logs/);});
 await check('revision errors preserve settings and explain the reason',async()=>{await app.evaluate(()=>{globalThis.__retentionQA.conflict=true;});await panel.getByRole('spinbutton').fill('72');await panel.getByRole('button',{name:'保存',exact:true}).click();await panel.getByRole('alert').filter({hasText:'其他窗口'}).waitFor();assert.equal(await app.evaluate(()=>globalThis.__retentionQA.policies.codex.idleHours),48);await app.evaluate(()=>{globalThis.__retentionQA.conflict=false;});});
 await check('offline inspection preserves readable local logs and marks countdown stale',async()=>{await app.evaluate(()=>{globalThis.__retentionQA.offline=true;});await panel.getByRole('button',{name:'刷新会话清理',exact:true}).click();await panel.getByRole('alert').filter({hasText:'SSH 连接失败'}).waitFor();assert.equal(await page.getByTestId('retention-session-recent').locator('.retention-countdown').innerText(),'待刷新');await panel.getByRole('button',{name:'刷新本机清理日志',exact:true}).click();assert.match(await panel.locator('.retention-logs').innerText(),/本机空间不足/);});
 await page.screenshot({path:path.join(output,'retention-offline.png')});
 await app.evaluate(()=>{globalThis.__retentionQA.offline=false;});await panel.getByRole('button',{name:'刷新会话清理',exact:true}).click();await panel.getByRole('tab',{name:'Claude Code',exact:true}).click();await panel.getByRole('tab',{name:'Codex',exact:true}).click();await panel.getByRole('spinbutton',{name:'Codex 闲置小时数'}).waitFor();
 await page.evaluate(()=>window.workbench.call('theme/set',{theme:'dark'}));await page.screenshot({path:path.join(output,'retention-dark.png')});
 await check('narrow layout keeps the complete settings, tabs and logs reachable without overflow',async()=>{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(860,720));await page.waitForTimeout(120);await panel.scrollIntoViewIfNeeded();assert.ok(await panel.getByRole('spinbutton').isVisible());assert.ok(await page.getByTestId('connection-tab-retention').isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:path.join(output,'retention-narrow-dark.png')});await panel.locator('.retention-log-heading').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'retention-narrow-logs.png')});});
 assert.deepEqual(errors,[]);assert.deepEqual(await app.evaluate(()=>globalThis.__retentionQA.unexpected),[]);
}catch(error){failure=error;console.error(error);if(page){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'failure.txt'),await page.locator('body').innerText().catch(()=>''));}process.exitCode=1;}finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({passed:checks.length,checks,errors,failure:failure?String(failure):null},null,2));}
