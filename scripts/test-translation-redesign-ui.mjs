// Hidden isolated desktop acceptance. Synthetic profiles, approved fixture plugins and loopback HTTP only.
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {initialState} from '../apps/desktop/host/store.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';
import {openWorkbenchSettings,navigateWorkbench} from './ui-control-helpers.mjs';
const root=process.cwd(),output=path.join(root,'build/qa/translation-redesign-ui');await mkdir(output,{recursive:true});
const directory=path.join(output,'profile-'+Date.now());await mkdir(directory);
const requests=[],errors=[],checks=[];let app,page;
const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'completed',model:body.model,output:[{type:'message',status:'completed',content:[{type:'output_text',text:'Synthetic translated reply.'}]}],usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:60},total_tokens:120}}));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
const seed=initialState();seed.modelConnections=[{id:'fixture-api',revision:'r1',name:'合成 API',baseUrl,protocol:'responses',enabled:true,auth:'none',hasKey:false,models:[{id:'model',model:'fixture-model',name:'fixture-model',enabled:true},{id:'alias',model:'fixture-model',name:'翻译示例模型',enabled:true}],discoveredModels:[],tools:false,timeoutMs:0,maxOutputTokens:8192}];
seed.modelConnections.push({...structuredClone(seed.modelConnections[0]),id:'fixture-other',name:'另一来源',models:[{id:'model',model:'fixture-model',name:'fixture-model',enabled:true}]});
await writeFile(path.join(directory,'state.json'),JSON.stringify(seed));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:directory,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const state=()=>call('state/get');
const wait=async(fn,label)=>{const until=Date.now()+12000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out: '+label);};
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);await wait(async()=>await page.getByTestId('composer-input').isVisible()||await page.getByTestId('settings-layout').isVisible(),'ready app view');await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].setSize(1320,980);});};
const settings=()=>openWorkbenchSettings(page);
const workspace=()=>navigateWorkbench(page,'workspace');
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const save=async(kind)=>{await page.getByTestId('save-translation').click();await wait(async()=>(await state()).translation.source?.kind===kind&&await page.getByTestId('save-translation').isDisabled(),'saved '+kind);};
let session,previewId;
try{
 await launch();session=await call('session/create',{runtime:'demo'});await settings();
 await check('compact placement controls, no redundant input switch, and source tabs',async()=>{
  assert.equal(await page.getByText('输入先翻译为英文',{exact:true}).count(),0);
  const boxes=await page.locator('.translation-layout-options label').evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));assert.equal(boxes.length,3);assert.ok(boxes.every(b=>b.h<=34&&b.w<160),JSON.stringify(boxes));
  await page.getByRole('tab',{name:'已启用模型',exact:true}).click();await page.getByTestId('translation-target').selectOption('api/fixture-api/model');await save('model');
  assert.equal(await page.getByTestId('translation-endpoint').count(),0);await page.screenshot({path:path.join(output,'settings-light.png')});
 });
 await check('model labels omit duplicates, preserve aliases and distinguish equal models from different sources',async()=>{
  const options=await page.getByTestId('translation-target').locator('option').evaluateAll(nodes=>nodes.filter(n=>n.value).map(n=>({id:n.value,label:n.textContent,disabled:n.disabled})));
  assert.deepEqual(options,[{id:'api/fixture-api/model',label:'合成 API · fixture-model',disabled:false},{id:'api/fixture-api/alias',label:'合成 API · fixture-model · 翻译示例模型',disabled:false},{id:'api/fixture-other/model',label:'另一来源 · fixture-model',disabled:false}]);
  assert.equal(await page.getByTestId('translation-target').inputValue(),'api/fixture-api/model');
 });
 await check('global intermediate toggle works in inline and panel reading modes',async()=>{
  for(const layout of ['inline','panel']){await call('translation/layout',{layout});await workspace();await page.getByTestId('translate-intermediate').waitFor();assert.equal(await page.getByTestId('translate-intermediate').isVisible(),true);await settings();}
  await call('translation/layout',{layout:'inline'});await workspace();await page.getByTestId('translate-intermediate').click();await wait(async()=>(await state()).translateIntermediate===false,'intermediate off');await page.screenshot({path:path.join(output,'workspace-inline.png')});
 });
 await check('selected API translates once and token panel uses account component with independent time scopes',async()=>{
  previewId=(await call('draft/prepare',{sessionId:session.id,text:'这是翻译界面的合成输入。',demo:false})).id;assert.equal(requests.length,1);assert.equal(requests[0].model,'fixture-model');
  await settings();const panel=page.getByTestId('model-usage-translation');await panel.scrollIntoViewIfNeeded();
  assert.deepEqual(await panel.locator('.model-periods button').allTextContents(),['1 day','7 day','本月']);
  await wait(async()=>(await panel.locator('.model-usage-total').innerText()).includes('120'),'translation tokens');
  await panel.getByRole('button',{name:'1 day',exact:true}).click();await panel.locator('.model-usage-total').click();await panel.getByText('缓存命中率',{exact:true}).waitFor();assert.ok((await panel.innerText()).includes('60.0%'));
  await panel.getByRole('button',{name:'本月',exact:true}).click();await page.screenshot({path:path.join(output,'usage-light.png')});
  assert.equal((await call('models/usage',{scope:{kind:'api',id:'fixture-api'},period:'month'})).totalTokens,0);
 });
 await check('missing enabled model retains selection and resumes after reenable',async()=>{
  await call('draft/cancel',{id:previewId});let current=(await state()).modelConnections[0];await call('model-api/set-enabled',{id:current.id,revision:current.revision,enabled:false});
  await wait(async()=>(await page.getByTestId('translation-target').textContent()).includes('已选模型暂不可用'),'missing target');assert.equal(await page.getByTestId('translation-target').inputValue(),'api/fixture-api/model');
  current=(await state()).modelConnections[0];await call('model-api/set-enabled',{id:current.id,revision:current.revision,enabled:true});await wait(async()=>(await page.getByTestId('translation-target').textContent()).includes('翻译示例模型'),'restored target');
 });
 await check('approved plugin contributes selector, execution and mounted/later named surfaces',async()=>{
  const id='qa.translation-redesign',manifest={schemaVersion:1,apiVersion:1,id,name:'Translation fixture',version:'1.0.0',description:'Isolated translation lifecycle',capabilities:['host'],main:'main.mjs',renderer:'renderer.mjs'};
  const main=`export function activate(api){api.onDispose(api.services.get('translation.targets').register(api.id,{list:()=>[{id:'plugin:'+api.id+'/model',name:'插件翻译模型',description:'合成测试 · 插件翻译模型',model:'plugin-model',runtime:'api',ready:true,efforts:[]},{id:'plugin:'+api.id+'/unavailable',name:'offline-model',description:'合成测试 · offline-model',model:'offline-model',runtime:'api',ready:false,efforts:[]}],resolve:async(id,profile)=>({profile:{...profile,model:'plugin-model',consent:true},sourceId:id,runtime:'api',execute:async r=>({text:'Synthetic plugin reply.',counts:{inputTokens:10,outputTokens:2,cacheReadTokens:0,cacheWriteTokens:0,totalTokens:12}})})}));}`;
  const renderer=`export function activate(api){api.observeSurfaces('translation-model','after',({root})=>{const mark=document.createElement('span');mark.dataset.testid='fixture-translation-model';mark.textContent='Synthetic model surface';root.append(mark);return()=>mark.remove();});api.observeSurfaces('translation-usage','after',({root})=>{const mark=document.createElement('span');mark.dataset.testid='fixture-translation-surface';mark.textContent='Synthetic surface';root.append(mark);return()=>mark.remove();});}`;
  const file=path.join(directory,'fixture.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(main)},{name:'renderer.mjs',data:Buffer.from(renderer)}]));await call('extensions/import',{filePath:file});let record=(await call('extensions/list')).find(p=>p.manifest.id===id);
  await call('extensions/toggle',{id,hash:record.hash,enabled:true,approveHost:true});await page.getByTestId('fixture-translation-surface').waitFor();await page.getByTestId('translation-target').selectOption('plugin:'+id+'/model');await save('model');
  const pluginLabels=async()=>{assert.equal(await page.getByTestId('translation-target').locator('option:checked').textContent(),'合成测试 · 插件翻译模型');const unavailable=page.getByTestId('translation-target').locator('option[value="plugin:'+id+'/unavailable"]');assert.equal(await unavailable.textContent(),'合成测试 · offline-model · 暂不可用');assert.equal(await unavailable.evaluate(option=>option.disabled),true);await page.getByTestId('fixture-translation-model').waitFor();};
  await pluginLabels();await workspace();await settings();await page.getByTestId('fixture-translation-surface').waitFor();await pluginLabels();
  previewId=(await call('draft/prepare',{sessionId:session.id,text:'这是插件翻译的合成输入。',demo:false})).id;assert.equal(requests.length,1);await call('draft/cancel',{id:previewId});
  await call('extensions/toggle',{id,hash:record.hash,enabled:false});await page.getByTestId('fixture-translation-surface').waitFor({state:'detached'});await wait(async()=>(await page.getByTestId('translation-target').textContent()).includes('已选模型暂不可用'),'disabled plugin target');
  assert.equal(await page.getByTestId('fixture-translation-model').count(),0);assert.equal(await page.getByTestId('translation-target').locator('option[value="plugin:'+id+'/unavailable"]').count(),0);
  await call('extensions/toggle',{id,hash:record.hash,enabled:true});await page.getByTestId('fixture-translation-surface').waitFor();assert.equal(await page.getByTestId('translation-target').inputValue(),'plugin:'+id+'/model');
  await pluginLabels();
  await page.getByTestId('translation-target').selectOption('api/fixture-api/model');await save('model');await call('extensions/toggle',{id,hash:record.hash,enabled:false});
 });
 await check('native settings persistence across full process exit and narrow/dark rendering',async()=>{
  if(!await page.getByTestId('translation-advanced').evaluate(e=>e.open))await page.getByTestId('translation-advanced').locator('summary').click();await wait(async()=>Object.entries((await call('ui-preferences/get')).entries).some(([key,entry])=>key.includes('TranslationSettings.details.1')&&entry.value===true),'advanced disclosure saved');for(const id of ['translation-max-calls','translation-max-characters','translation-timeout'])assert.equal(await page.getByTestId(id).inputValue(),'0');
  await app.close();app=undefined;await launch();await settings();assert.equal(await page.getByRole('tab',{name:'已启用模型',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await page.getByTestId('translation-target').inputValue(),'api/fixture-api/model');
  assert.equal(await page.getByTestId('translation-target').locator('option:checked').textContent(),'合成 API · fixture-model');
  const panel=page.getByTestId('model-usage-translation');assert.equal(await panel.getByRole('button',{name:'本月',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await panel.locator('.model-usage-total').getAttribute('aria-expanded'),'true');assert.equal(await page.getByTestId('translation-advanced').evaluate(e=>e.open),true);assert.equal((await state()).translateIntermediate,false);
  await call('theme/set',{theme:'dark'});await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].setSize(940,980);});await panel.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'usage-dark-narrow.png')});
  await page.getByTestId('translation-target').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'selector-dark-narrow.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  await workspace();await page.getByTestId('translate-intermediate').waitFor();assert.equal(await page.getByTestId('translate-intermediate').isChecked(),false);await page.screenshot({path:path.join(output,'workspace-dark-narrow.png')});
 });
 await check('per-chat limit saves from UI, isolates new chats and survives full process restart',async()=>{
  await settings();const limit=(await call('translation/usage',{sessionId:session.id})).sessionCalls;
  assert.ok(limit>0);const control=page.getByTestId('translation-max-calls');assert.equal(await page.getByText('会话内调用上限',{exact:true}).count(),1);
  await control.fill(String(limit));await save('model');await control.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'session-limit-dark.png')});
  const before=requests.length;await assert.rejects(call('draft/prepare',{sessionId:session.id,text:'旧会话仍应达到上限'}),/本会话.*预算/);assert.equal(requests.length,before);
  const fresh=await call('session/create',{runtime:'demo'});await call('draft/prepare',{sessionId:fresh.id,text:'新会话有独立额度'});assert.equal(requests.length,before+1);
  await app.close();app=undefined;await launch();await settings();assert.equal(await page.getByTestId('translation-max-calls').inputValue(),String(limit));
  assert.equal((await call('translation/usage',{sessionId:session.id})).sessionCalls,limit);
  await assert.rejects(call('draft/prepare',{sessionId:session.id,text:'重启不能重置旧会话'}),/预算/);assert.equal(requests.length,before+1);
 });
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'report.json'),JSON.stringify({checks,requests:requests.length,realModelCalls:0,errors},null,2));
}catch(error){if(page){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});console.error('Renderer errors:',errors);console.error(await page.locator('body').innerText());}throw error;}finally{if(app)await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
