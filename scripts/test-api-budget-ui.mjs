// Isolated production host/renderer; no native CLI or model request.
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {encodeZip} from '../packages/native-resources/archive.ts';
const root=process.cwd(),output=path.join(root,'build/qa/api-budget-'+Date.now()),profile=path.join(output,'profile');
await mkdir(output,{recursive:true});
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[],checks=[];
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);};
try{
 await launch();
 const id='qa.api-budget',manifest={schemaVersion:1,apiVersion:1,id,name:'Budget fixture',version:'1.0.0',description:'Synthetic only',capabilities:['host'],main:'main.mjs',renderer:'renderer.mjs'};
 const main=`export function activate(api){api.registerCommand('seed',p=>api.services.get('workbench.state').update(state=>{const s=state.sessions.find(s=>s.id===p.id);Object.assign(s.binding,{runtime:p.runtime??'api',modelConnectionId:'qa-api',modelMappingId:'fixture'});s.modelSelection={model:'fixture'};state.modelConnections=[{id:'qa-api',name:'Synthetic model',baseUrl:'http://127.0.0.1:1/v1',protocol:'chat-completions',auth:'none',hasKey:false,tools:true,timeoutMs:5000,revision:1,models:[{id:'fixture',model:'fixture',name:'Synthetic model',enabled:true,efforts:[]}]}];if(p.pause)s.apiBudgetPause={turnId:'fixture',calls:3,limit:3,at:'2026-10-03T00:00:00Z'};}));}`;
 const renderer=`export function activate(api){for(const name of ['api-call-budget','api-budget-pause'])api.observeSurfaces(name,'after',({root})=>{root.dataset.qaBudget='true';});window.qaBudgetReplace=()=>api.observeSurfaces('api-call-budget','replace',({root})=>{root.textContent='Synthetic budget replacement';});}`;
 const zip=path.join(output,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(main)},{name:'renderer.mjs',data:Buffer.from(renderer)}]));
 await call('extensions/import',{filePath:zip});const record=(await call('extensions/list')).find(p=>p.manifest.id===id);
 const toggle=enabled=>call('extensions/toggle',{id,hash:record.hash,enabled,...(enabled?{approveHost:true}:{})});await toggle(true);
 const session=await call('session/create',{runtime:'demo'}),seed=payload=>call('extensions/command',{id,name:'seed',payload:{id:session.id,...payload}});
 await seed({});await page.getByTestId('sidebar-session-'+session.id).locator('.session-select').click();await page.getByTestId('model-selector').click();
 const input=()=>page.getByRole('spinbutton',{name:'每回合调用预算'});
 assert.equal(await input().inputValue(),'0');await input().fill('3');await input().press('Enter');await page.waitForFunction(()=>!document.querySelector('[data-workbench-api-budget] input')?.disabled);
 await page.getByRole('dialog',{name:'模型与思考设置'}).press('Escape');await page.getByTestId('model-selector').click();assert.equal(await input().inputValue(),'3');
 await assert.rejects(call('session/api-budget',{sessionId:session.id,limit:9,expected:0}),/CHANGED/);
 await page.locator('[data-qa-budget]').first().waitFor({state:'attached'});await page.evaluate(()=>window.qaBudgetOff=window.qaBudgetReplace());await page.getByText('Synthetic budget replacement',{exact:true}).waitFor();await page.evaluate(()=>window.qaBudgetOff());await input().waitFor();
 checks.push('default unlimited, saved control, concurrent stale edit rejected, actual approved surface replacement');
 await page.getByRole('dialog',{name:'模型与思考设置'}).press('Escape');await seed({pause:true});await page.locator('[data-qa-budget]').first().waitFor({state:'attached'});await page.getByTestId('model-selector').click();await input().waitFor();
 await page.screenshot({path:path.join(output,'budget.png')});await toggle(false);await page.locator('[data-qa-budget]').first().waitFor({state:'detached'});assert.equal(await input().inputValue(),'3');await toggle(true);await page.locator('[data-qa-budget]').first().waitFor({state:'attached'});
 checks.push('later pause/control surfaces and disable/reenable preserve preference');
 await toggle(false);await app.close();app=undefined;await launch();await page.getByTestId('sidebar-session-'+session.id).locator('.session-select').click();await page.locator('[data-workbench-api-budget-pause]').waitFor();await page.getByTestId('model-selector').click();assert.equal(await input().inputValue(),'3');
 await call('session/api-budget',{sessionId:session.id,limit:0,expected:3});await page.waitForFunction(()=>document.querySelector('[data-workbench-api-budget] input')?.value==='0');
 checks.push('complete process restart restores budget/pause and explicit zero resets unlimited');assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,output}));
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await app?.close();await writeFile(path.join(output,'result.json'),JSON.stringify({checks,errors},null,2));}
