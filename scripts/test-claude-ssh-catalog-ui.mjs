import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root=process.env.AWB_QA_APPLICATION,output=process.env.AWB_QA_OUTPUT;
if(!root||!output)throw Error('Explicit isolated app and output are required.');
await mkdir(output,{recursive:true});const directory=await mkdtemp(path.join(os.tmpdir(),'awb-claude-catalog-ui-'));
let app,page,failure;const checks=[],errors=[];
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
try{
 app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env:{...process.env,AGENT_WORKBENCH_TEST_DATA:directory,AGENT_WORKBENCH_TEST_HIDDEN:'1',ELECTRON_RUN_AS_NODE:undefined}});
 page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
 const state=await page.evaluate(()=>window.workbench.call('state/get')),branding=await page.evaluate(()=>window.workbench.call('branding/get'));
 await app.evaluate(({ipcMain,BrowserWindow,session},{state,branding})=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,cb)=>cb({cancel:true}));
  state.hosts=[{id:'member',name:'A · A',hostname:'fixture.invalid',port:22,username:'member',role:'workspace',identityFile:'unused',knownHostsFile:'unused',ownerId:'fixture',workspaceGeneration:'g'}];state.activeWorkspaceId='member';state.lastSelectedRuntime='claude';state.lastModelHostId='member';state.theme='light';
  const catalog={source:'native-owner',availability:'ready',authorityId:'a',generation:'g',workspaceId:'w',revision:1,selectionRevision:1,selectedClaudeAccountId:'c',accounts:[{id:'c',generation:'cg',provider:'claude',status:'authenticated',observedAt:new Date().toISOString()}]};state.accountCatalogs={member:catalog};
  const binding={runtime:'claude',provider:'anthropic',accountRef:'vps-account:a/g/claude/c/cg',executionId:'local-device',egress:'vps',hostId:'member',accountRuntime:'native-owner'};
  const h=globalThis.__catalogQA={requests:[],unexpected:[],failure:false,ready:false},preferences={schemaVersion:1,revision:0,entries:{}};
  const publish=()=>BrowserWindow.getAllWindows()[0].webContents.send('workbench:state',state);
  ipcMain.removeHandler('workbench:call');ipcMain.handle('workbench:call',async(_e,method,p={})=>{
   h.requests.push({method,p});const ok=value=>({ok:true,value});
   if(method==='state/get')return ok(state);if(method==='branding/get')return ok(branding);
   if(method==='ui-preferences/get')return ok(preferences);
   if(method==='ui-preferences/update'){const key=JSON.stringify([p.id,p.scope??'']);preferences.entries[key]={revision:++preferences.revision,...(p.reset?{}:{value:p.value})};return ok(preferences);}
   if(method==='plugin-recovery/status')return ok({safeMode:false});
   if(['plugin-recovery/repair-draft','desktop/titlebar','plugin-recovery/pulse','plugin-recovery/ui-language','plugin-recovery/core-ready','ui-preferences/flush-ready'].includes(method))return ok(null);
   if(['navigation/get','navigation/view'].includes(method))return ok({sessionId:null});
   if(method==='translation/usage')return ok({calls:0,cost:null});if(method==='codex-auth/current')return ok(null);
   if(['extensions/renderers','runtime/catalog'].includes(method))return ok([]);if(method==='extensions/appearance')return ok({variables:{}});
   if(method==='local-cli/list')return ok([{runtime:'claude',installed:true,version:'fixture',busy:false}]);
   if(method==='accounts/list')return ok(catalog);
   if(method==='theme/set'){state.theme=p.theme;publish();return ok(state);}
   if(method==='model-targets/list')return ok(h.failure?[{id:'ssh/member/claude/c',name:'Claude Code',description:'A · A · SSH',runtime:'claude',ready:false,binding,unavailableReason:'远端服务不支持此请求，请核对账号服务版本。'}]:['Fixture Sonnet','Fixture Opus'].map((name,i)=>({id:'ssh/member/claude/c/model/'+i,name,description:'A · A · SSH'+(h.ready?' · 官方 MCP 工具':''),runtime:'claude',ready:h.ready,binding,selection:{model:'fixture-'+i},...(h.ready?{}:{unavailableReason:'Claude 本机文件和工具执行桥尚未接通'})})));
   h.unexpected.push(method);return {ok:false,error:'Unmocked operation blocked: '+method};
  });
 },{state,branding});
 await page.reload();await page.getByTestId('model-selector').click();
 await check('native catalog names appear under the unchanged SSH source and remain disabled',async()=>{
  await page.getByRole('menuitemradio',{name:/Fixture Sonnet/}).waitFor();assert.equal(await page.getByRole('menuitemradio',{name:/Fixture Sonnet/}).isDisabled(),true);assert.equal(await page.getByRole('menuitemradio',{name:/Fixture Opus/}).isDisabled(),true);
  assert.equal(await page.locator('.model-catalog-source').textContent(),'A · A · SSH');assert.equal(await page.getByRole('menuitemradio',{name:/默认模型/}).count(),0);
 });
 await page.screenshot({path:path.join(output,'claude-catalog-light.png')});
 await check('refresh and a later menu instance never submit a model task',async()=>{
  await page.getByRole('button',{name:'刷新模型目录'}).click();await page.getByRole('menuitemradio',{name:/Fixture Opus/}).waitFor();await page.keyboard.press('Escape');await page.getByTestId('model-selector').click();await page.getByRole('menuitemradio',{name:/Fixture Sonnet/}).waitFor();
 });
 await check('narrow dark mode keeps model names and the full execution reason visible',async()=>{
  await page.evaluate(()=>window.workbench.call('theme/set',{theme:'dark'}));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));
  const bounds=await page.getByRole('dialog',{name:'模型与思考设置'}).boundingBox(),size=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth}));assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=size.width+1&&bounds.y>=0&&bounds.y+bounds.height<=size.height+1);assert.ok(size.scroll<=size.width+1);
  assert.equal(await page.locator('.model-catalog-list small').first().textContent(),'Claude 本机文件和工具执行桥尚未接通');
  await page.screenshot({path:path.join(output,'claude-catalog-dark-narrow.png')});
 });
 await check('an older broker has an explicit unavailable row without a fabricated model',async()=>{
  await app.evaluate(()=>{globalThis.__catalogQA.failure=true;});await page.getByRole('button',{name:'刷新模型目录'}).click();await page.getByRole('menuitemradio',{name:/远端服务不支持此请求/}).waitFor();assert.equal(await page.getByRole('menuitemradio').count(),1);assert.equal(await page.getByRole('menuitemradio').isDisabled(),true);
 });
 await check('eligible official MCP targets become selectable without starting a task',async()=>{
  await app.evaluate(()=>{globalThis.__catalogQA.failure=false;globalThis.__catalogQA.ready=true;});await page.getByRole('button',{name:'刷新模型目录'}).click();await page.getByRole('menuitemradio',{name:/Fixture Sonnet/}).waitFor();
  assert.equal(await page.getByRole('menuitemradio',{name:/Fixture Sonnet/}).isDisabled(),false);assert.equal(await page.getByRole('menuitemradio',{name:/Fixture Opus/}).isDisabled(),false);
  assert.equal(await page.locator('.model-catalog-source').textContent(),'A · A · SSH');assert.equal(await page.locator('.model-catalog-list small').count(),0);await page.screenshot({path:path.join(output,'claude-mcp-ready.png')});
 });
 const requests=await app.evaluate(()=>globalThis.__catalogQA.requests);assert.ok(!requests.some(r=>['draft/prepare','draft/submit','session/create','runtime/models'].includes(r.method)));assert.deepEqual(await app.evaluate(()=>globalThis.__catalogQA.unexpected),[]);assert.deepEqual(errors,[]);
}catch(error){failure={message:error.message,stack:error.stack};if(app)failure.unexpected=await app.evaluate(()=>globalThis.__catalogQA?.unexpected??[]).catch(()=>[]);if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({syntheticOnly:true,checks,errors,...(failure?{failure}:{})},null,2));}
