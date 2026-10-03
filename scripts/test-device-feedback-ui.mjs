// Hidden, isolated synthetic acceptance. No account, model task or remote connection is used.
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {initialState} from '../apps/desktop/host/store.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';
import {openWorkbenchSettings,navigateWorkbench} from './ui-control-helpers.mjs';

const root=process.cwd(),appRoot=path.resolve(process.env.AGENT_WORKBENCH_TEST_APP??root);
const output=path.join(root,'build/qa/device-feedback-'+Date.now()),directory=path.join(output,'profile');await mkdir(directory,{recursive:true});
const seed=initialState(),at='2026-10-01T00:00:00Z',sessions=[];
for(const runtime of ['claude','codex','demo']){
  const id=randomUUID();sessions.push({id,title:'Fixture '+runtime,titleSource:'manual',projectId:null,archived:false,projectPath:output,createdAt:at,updatedAt:at,permissionMode:'default',status:runtime==='demo'?'idle':'uncertain',binding:{runtime,provider:'native',accountRef:'synthetic',executionId:'local-device',egress:runtime==='demo'?'runtime-managed':'vps',...(runtime!=='demo'?{hostId:'missing-synthetic-host',accountRuntime:'native-owner'}:{})},messages:[{id:id+'-user',role:'user',original:'用户输入',submitted:'Submitted input',timestamp:at,demo:false},{id:id+'-reply',role:'assistant',phase:'final',original:'Original answer. `output.blend` and [explicit](output.blend).',translation:'中文回复。`output.blend` 和 [链接](output.blend)。',translationStatus:'complete',timestamp:at,demo:false},{id:id+'-progress',role:'assistant',original:'Progress source.',translation:'中文中途消息。',translationStatus:'complete',phase:'commentary',timestamp:at,demo:false}],...(runtime==='demo'?{}:{nativeError:'Unknown native completion',turnTimings:[{id:id+'-turn',startedAt:at,status:'uncertain'}]})});
}
seed.sessions=sessions;await writeFile(path.join(directory,'state.json'),JSON.stringify(seed));await writeFile(path.join(output,'output.blend'),'Synthetic file');
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:directory,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[],checks=[];
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const wait=async(check,label)=>{const until=Date.now()+15000;while(Date.now()<until){if(await check())return;await new Promise(r=>setTimeout(r,60));}throw Error('Timed out: '+label);};
const openSession=async id=>{await navigateWorkbench(page,'workspace');await page.getByTestId('sidebar-session-'+id).locator('.session-select').click();await wait(async()=>(await page.locator('.workspace-header').innerText()).includes(sessions.find(s=>s.id===id).title),'session selected');};
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);await page.evaluate(()=>{window.confirm=()=>true;window.alert=()=>{};});await page.getByTestId('composer-input').waitFor();await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].setContentSize(1280,900);});assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);};
const record=label=>{checks.push(label);console.log('PASS '+label);};
try{
  await launch();
  for(const session of sessions.slice(0,2)){
    await openSession(session.id);await page.getByTestId('api-end-wait').waitFor();
    await page.getByTestId('composer-input').fill('Pending input');await page.getByTestId('prepare-draft').click();await page.locator('.draft-error').waitFor();
    assert.doesNotMatch(await page.locator('.draft-error').innerText(),/请重试翻译|完成英文翻译后/);
    await page.getByTestId('api-end-wait').click();
    await wait(async()=>(await call('state/get')).sessions.find(s=>s.id===session.id).status==='idle','explicit recovery');
    const recovered=(await call('state/get')).sessions.find(s=>s.id===session.id);assert.equal(recovered.turnTimings[0].status,'uncertain');assert.equal(recovered.messages.length,3);
  }
  record('Claude and Codex unknown sessions expose explicit recovery without false completion or translation blame');
  const demo=sessions[2];await openSession(demo.id);await openWorkbenchSettings(page);
  assert.equal(await page.locator('.translation-layout-options input').count(),3);
  await page.getByTestId('translation-seamless').click();await wait(async()=>(await call('state/get')).translationLayout==='translated-only','seamless preset');
  await openSession(demo.id);const reply=page.locator(`[data-reply-id="${demo.id}-reply"]`);
  await wait(async()=>(await reply.innerText()).includes('中文回复'),'translated reply');assert.doesNotMatch(await reply.innerText(),/Original answer/);
  assert.equal(await reply.locator('.markdown-inline-code .message-link').count(),0);assert.equal(await reply.locator('a.message-link,button.message-link').count(),1);
  assert.equal(await page.getByTestId('toggle-translation-pane').count(),0);
  await page.getByTestId('open-files').click();assert.match(await reply.innerText(),/中文回复/);assert.equal((await call('state/get')).translationLayout,'translated-only');
  await page.screenshot({path:path.join(output,'translated-with-files.png')});record('translated-only source suppression, explicit links and occupied reader');
  await page.getByTestId('composer-input').fill('翻译失败保留这段原稿');await page.getByTestId('prepare-draft').click();await page.getByTestId('draft-original-fallback').waitFor();
  assert.equal((await call('state/get')).sessions.find(s=>s.id===demo.id).messages.length,3);
  await page.getByTestId('draft-original-fallback').click();await page.getByTestId('draft-submission-preview').waitFor();assert.match(await page.getByTestId('draft-submission-preview').innerText(),/翻译失败保留这段原稿/);
  assert.equal((await call('state/get')).sessions.find(s=>s.id===demo.id).messages.length,3);await page.keyboard.press('Escape');record('translation failure offers a reviewed raw preview and sends nothing automatically');
  const id='qa.feedback-ui',manifest={schemaVersion:1,apiVersion:1,id,name:'Feedback fixture',version:'1.0.0',description:'Isolated device feedback',capabilities:['host'],main:'main.mjs',renderer:'renderer.mjs'};
  const main=`export function activate(api){api.onDispose(api.services.get('translation.layouts').register({id:'plugin:'+api.id+'/reading',label:'Fixture layout',mode:'translated-only'}));}`;
  const renderer=`export function activate(api){api.fileReferences.register({id:'plugin:'+api.id+'/code',recognize:value=>value==='output.blend'?true:undefined});api.observeSurfaces('translation-layout','after',({root})=>{const node=document.createElement('span');node.dataset.testid='fixture-layout-surface';node.textContent='Fixture';root.append(node);return()=>node.remove();});}`;
  const zip=path.join(output,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(main)},{name:'renderer.mjs',data:Buffer.from(renderer)}]));await call('extensions/import',{filePath:zip});const plugin=(await call('extensions/list')).find(item=>item.manifest.id===id);
  await call('extensions/toggle',{id,hash:plugin.hash,enabled:true,approveHost:true});
  await wait(async()=>await reply.locator('.markdown-inline-code .message-link').count()===1,'mounted code recognition');
  await openWorkbenchSettings(page);await page.getByTestId('fixture-layout-surface').waitFor();await page.locator('input[value="plugin:qa.feedback-ui/reading"]').click();
  await wait(async()=>(await call('state/get')).translationLayout==='plugin:'+id+'/reading','plugin layout selection');
  await call('extensions/toggle',{id,hash:plugin.hash,enabled:false});await wait(async()=>await page.getByTestId('fixture-layout-surface').count()===0,'surface cleanup');
  assert.equal((await call('state/get')).translationLayout,'plugin:'+id+'/reading');await wait(async()=>(await page.locator('[data-workbench-translation-layout]').innerText()).includes('偏好已保留'),'missing layout fallback');
  await call('extensions/toggle',{id,hash:plugin.hash,enabled:true});await page.getByTestId('fixture-layout-surface').waitFor();await openSession(demo.id);assert.match(await reply.innerText(),/中文回复/);
  await openSession(sessions[0].id);assert.equal(await page.locator(`[data-reply-id="${sessions[0].id}-reply"] .markdown-inline-code .message-link`).count(),1);
  await call('extensions/toggle',{id,hash:plugin.hash,enabled:false});await call('translation/layout',{layout:'translated-only'});await openSession(demo.id);
  record('approved renderer rules and host layout registration update mounted/later instances and recover after disable/reenable');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(800,760));await call('theme/set',{theme:'dark'});await page.screenshot({path:path.join(output,'translated-compact-dark.png')});
  assert.equal(await page.locator('.workspace').evaluate(node=>node.scrollWidth<=node.clientWidth+2),true);assert.match(await reply.innerText(),/中文回复/);
  await app.close();app=undefined;await launch();await openSession(demo.id);assert.equal((await call('state/get')).translationLayout,'translated-only');assert.equal((await call('state/get')).autoSubmitTranslated,true);assert.match(await page.locator(`[data-reply-id="${demo.id}-reply"]`).innerText(),/中文回复/);
  const persisted=JSON.parse(await readFile(path.join(directory,'state.json'),'utf8'));for(const session of persisted.sessions.slice(0,2))assert.equal(session.turnTimings[0].status,'uncertain');
  record('full process restart restores reading preference and retains historical unknown outcomes');assert.deepEqual(errors,[]);
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}finally{await app?.close();await writeFile(path.join(output,'result.json'),JSON.stringify({checks,errors},null,2));}
