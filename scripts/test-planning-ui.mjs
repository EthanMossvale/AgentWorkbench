import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as hostBuild } from 'esbuild';
import { build as rendererBuild } from 'vite';
import { mkdir,writeFile,cp } from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd(),output=path.resolve(process.env.AWB_PLAN_UI_QA??'build/qa/native-planning/ui'),appRoot=path.join(output,'app'),data=path.join(output,'data-'+Date.now());
assert.ok(process.env.AWB_QA_CODEX&&process.env.AWB_QA_CLAUDE,'Explicit QA CLI paths required.');
await mkdir(data,{recursive:true});
for(const runtime of ['codex','claude'])await mkdir(path.join(data,'native-home','.'+runtime),{recursive:true});
let app,page,scenario='complete',held;const checks=[],errors=[],requests=[],translations=[];
const planSource='## Fixture plan\n\nInspect the fixture and add one test.\n\n- Inspect the fixture file `src/main.ts`.\n  - Run the test `npm test`.\n\n```ts\nconst status = "unchanged";\n```\n\n| Step | Result |\n| --- | --- |\n| Check output | Expected result |';
let paragraphRevision=false;
const translateText=text=>text.replaceAll('Fixture plan','验收计划').replaceAll('Inspect the fixture and add one test.',paragraphRevision?'再次检查样例，然后补上一个测试。':'检查样例并添加一个测试。').replaceAll('Inspect the fixture file','检查样例文件').replaceAll('Run the test','运行测试').replaceAll('Step','步骤').replaceAll('Result','结果').replaceAll('Check output','检查输出').replaceAll('Expected result','预期结果').replaceAll('Isolated planning fixture complete.','隔离计划验收完成。');
const currentMode=body=>[...body.messages.map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n').matchAll(/<collaboration_mode>([\s\S]*?)<\/collaboration_mode>/g)].at(-1)?.[1]??'';
const complete={choices:[{finish_reason:'stop',message:{role:'assistant',content:'Isolated planning fixture complete.'}}],usage:{prompt_tokens:100,completion_tokens:10}};
const server=createServer(async(req,res)=>{try{
  res.setHeader('content-type','application/json');if(req.url.endsWith('/models')){res.end(JSON.stringify({data:[{id:'fixture-model'}]}));return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  if(req.url.startsWith('/translation/')){const text=body.messages.at(-1).content;translations.push(text);let content;try{const values=JSON.parse(text);content=JSON.stringify(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,translateText(value)])));}catch{content=translateText(text);}res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}));return;}
  requests.push(body);if(requests.length>80)throw Error('Synthetic request budget exceeded');
  if(scenario==='hold'){held=res;return;}
  if(scenario==='exit'&&body.messages.filter(m=>m.role!=='system').at(-1).role!=='tool'){scenario='complete';res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'ui-plan',type:'function',function:{name:'ExitPlanMode',arguments:JSON.stringify({plan:planSource})}}]}}],usage:{prompt_tokens:100,completion_tokens:10}}));}
  else if(scenario==='codex-plan')res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'<proposed_plan>\n'+planSource+'\n</proposed_plan>'}}],usage:{prompt_tokens:100,completion_tokens:10}}));
  else res.end(JSON.stringify(complete));
}catch(error){errors.push(String(error));res.writeHead(500).end('{}');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
await rendererBuild({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await hostBuild({entryPoints:[`apps/desktop/host/${entry}.ts`],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await cp('services/vps-workspace-control',path.join(appRoot,'host/workspace-control'),{recursive:true});await cp('services/vps-account-broker',path.join(appRoot,'host/account-runtime'),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-planning-qa',version:'1.0.0',main:'host/main.cjs'}));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:data,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.env.AWB_QA_CODEX,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.env.AWB_QA_CLAUDE};delete env.ELECTRON_RUN_AS_NODE;
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const wait=async(fn,label)=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+label);};
const mark=name=>{checks.push(name);console.log('PASS '+name);};
const snap=name=>page.screenshot({path:path.join(output,name)});
try{
  app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1180,820));await call('plugins/set-enabled',{id:'translation',enabled:false});
  const connection=await call('model-api/save',{connection:{name:'计划模式验收',baseUrl:`http://127.0.0.1:${server.address().port}`,protocol:'chat-completions',models:[{id:'fixture',model:'fixture-model',name:'Synthetic fixture',enabled:true}]},key:'synthetic'});
  const targets=await call('model-targets/list'),target=runtime=>targets.find(t=>t.runtime===runtime&&t.binding.modelConnectionId===connection.id);
  const create=async runtime=>{const s=await call('session/create',{modelTargetId:target(runtime).id,projectId:null,permissionMode:runtime==='codex'?'full-access':'plan'});await page.getByTestId('sidebar-session-'+s.id).locator('.session-select').click();return s;};
  const get=async id=>(await call('state/get')).sessions.find(s=>s.id===id);
  const codex=await create('codex');await page.getByTestId('composer-add').click();await page.getByTestId('composer-menu').locator('[data-command=plan]').click();
  await page.getByTestId('composer-plan-mode').waitFor();assert.equal((await get(codex.id)).permissionMode,'full-access');assert.equal((await get(codex.id)).collaborationMode,'plan');assert.equal(requests.length,0);
  await call('theme/set',{theme:'light'});await snap('codex-plan-light.png');await call('theme/set',{theme:'dark'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));await snap('codex-plan-dark-narrow.png');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.getByTestId('composer-plan-mode').click();await wait(async()=>(await get(codex.id)).collaborationMode==='default','exit Codex plan');await page.getByTestId('composer-plan-mode').waitFor({state:'detached'});assert.equal((await get(codex.id)).permissionMode,'full-access');
  mark('Codex plus menu toggles a separate removable plan capsule in both themes without changing full access or sending a task');
  const claude=await create('claude');assert.equal(await page.getByTestId('composer-plan-mode').count(),0);assert.match(await page.getByTestId('composer-permission').innerText(),/计划模式/);
  scenario='exit';await page.getByTestId('composer-input').fill('Produce the fixture plan.');await page.getByTestId('prepare-draft').click();await page.getByTestId('open-plan').click();await page.getByTestId('plan-reader').waitFor();assert.match((await page.getByTestId('plan-source').allInnerTexts()).join('\n'),/Fixture plan/);assert.equal(await page.getByTestId('plan-translation').count(),0);await snap('claude-plan-approval.png');
  await page.getByTestId('native-approval-accept').click();await wait(async()=>{const s=await get(claude.id);return s.status==='idle'&&s.permissionMode==='default';},'approved Claude plan');assert.equal(await page.getByTestId('native-approval').count(),0);
  mark('Claude shows the full plan on demand with translation disabled, offers execution permissions and reads back default after approval');
  await page.getByTestId('plan-reader').waitFor({state:'detached'});
  for(const runtime of ['claude','codex']){
    const session=runtime==='claude'?claude:codex;await page.getByTestId('sidebar-session-'+session.id).locator('.session-select').click();scenario='hold';held=undefined;
    await page.getByTestId('composer-input').fill('Wait for the isolated stop fixture.');await page.getByTestId('prepare-draft').click();await wait(()=>!!held,'held native request');
    if(runtime==='claude'){await page.getByTestId('composer-permission').click();await page.getByTestId('permission-option-plan').click();await wait(async()=>(await get(session.id)).permissionMode==='plan','live plan permissions');}
    const before=requests.length;await page.getByTestId('session-stop').click();await wait(async()=>(await get(session.id)).status==='idle','quiet stop');held.end(JSON.stringify(complete));
    assert.equal((await get(session.id)).nativeError,undefined);assert.equal(await page.getByTestId('api-end-wait').count(),0);assert.equal(await page.locator('.callout.warning[role=status]').count(),0);assert.equal(await page.getByTestId('session-stop').count(),0);assert.equal(await page.getByTestId('reading-turn').last().getByTestId('turn-progress').count(),0);
    await snap(runtime+'-stopped.png');assert.equal(requests.length,before);scenario='complete';await page.getByTestId('composer-input').fill('Continue explicitly after stopping.');assert.equal(await page.getByTestId('prepare-draft').isEnabled(),true);await page.getByTestId('prepare-draft').click();await wait(async()=>(await get(session.id)).nativeTurnStatus==='completed','next explicit message');
    mark(runtime+' stop clears the spinner, approval and warning without a recovery action, and enables the next explicit send');
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,860));await call('theme/set',{theme:'light'});
  const settings=await call('state/get');await call('translation/settings',{profile:{...settings.translation,baseUrl:`http://127.0.0.1:${server.address().port}/translation`,protocol:'chat-completions',model:'fixture',consent:true},key:'synthetic',translateInput:true,translateProgress:true,translateFinal:true});await call('plugins/set-enabled',{id:'translation',enabled:true});await call('translation/auto-submit',{enabled:true});
  await call('message/retranslate',{sessionId:claude.id,messageId:(await get(claude.id)).messages.findLast(m=>m.role==='assistant').id});
  await page.getByTestId('sidebar-session-'+claude.id).locator('.session-select').click();await call('session/permissions',{sessionId:claude.id,permissionMode:'plan'});scenario='exit';await page.getByTestId('composer-input').fill('Produce another fixture plan.');await page.getByTestId('prepare-draft').click();await page.getByTestId('open-plan').waitFor();
  const paneToggle=page.getByTestId('toggle-translation-pane');if(await paneToggle.getAttribute('aria-pressed')!=='true')await paneToggle.click();
  await page.getByTestId('composer-input').fill('Keep this unsent draft.');await page.getByTestId('open-plan').click();await page.getByTestId('plan-translation').getByText('检查样例并添加一个测试。',{exact:true}).waitFor();
  assert.equal(await page.locator('.translation-pane').count(),0);assert.equal((await call('state/get')).translationLayout??'panel','panel');assert.ok(await page.locator('.original-pane .message-translation-note').count()>0);
  const reader=page.getByTestId('plan-reader');assert.equal(await reader.getByTestId('plan-block').count(),5);assert.equal(await reader.getByTestId('plan-translation').count(),4);assert.equal(await reader.locator('pre').count(),1);assert.equal(await reader.locator('table').count(),2);assert.equal(await reader.locator('ul ul').count(),2);
  assert.ok((await reader.getByTestId('plan-translation').allInnerTexts()).some(t=>t.includes('检查样例文件 src/main.ts')&&t.includes('运行测试 npm test')));assert.ok((await reader.getByTestId('plan-translation').allInnerTexts()).some(t=>t.includes('检查输出')&&t.includes('预期结果')));
  const beforeParagraphs=await reader.getByTestId('plan-translation').allInnerTexts(),beforeSources=await reader.getByTestId('plan-source').allInnerTexts(),beforeRequests=requests.length,translationCount=translations.length;
  const paragraphButton=reader.getByTestId('plan-block').nth(1).getByRole('button',{name:'重新翻译本段',exact:true});assert.match(await paragraphButton.getAttribute('class'),/translate-message-button/);paragraphRevision=true;await paragraphButton.click();await reader.getByText('再次检查样例，然后补上一个测试。',{exact:true}).waitFor();paragraphRevision=false;
  assert.equal(translations.length,translationCount+1);assert.deepEqual(Object.keys(JSON.parse(translations.at(-1))),['b1']);assert.equal(requests.length,beforeRequests);assert.deepEqual(await reader.getByTestId('plan-source').allInnerTexts(),beforeSources);
  const afterParagraphs=await reader.getByTestId('plan-translation').allInnerTexts();assert.deepEqual(afterParagraphs.filter((_,i)=>i!==1),beforeParagraphs.filter((_,i)=>i!==1));
  mark('Plan reader pairs compact Markdown blocks, translates list/table prose, displays standalone code once and reuses the message translation icon for one-paragraph retries');
  await snap('claude-plan-translated-light.png');await call('theme/set',{theme:'dark'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));await snap('claude-plan-translated-dark-narrow.png');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,860));await page.getByTestId('close-plan-reader').click();await page.locator('.translation-pane').waitFor();assert.equal(await page.getByTestId('composer-input').inputValue(),'Keep this unsent draft.');
  await page.getByTestId('open-plan').click();await page.getByRole('radio',{name:'自动接受编辑',exact:true}).check();await page.getByTestId('native-approval-plan-accept-edits').click();await wait(async()=>(await get(claude.id)).status==='idle'&&(await get(claude.id)).permissionMode==='accept-edits','approve with edit permission');await page.getByTestId('plan-reader').waitFor({state:'detached'});
  mark('Translated Claude full-plan reader temporarily stacks conversation translations, restores the panel and draft, and approval exits plan into the selected native permission');
  await page.getByTestId('sidebar-session-'+codex.id).locator('.session-select').click();await call('session/collaboration',{sessionId:codex.id,mode:'plan'});scenario='codex-plan';await page.getByTestId('composer-input').fill('Produce a native Codex plan.');await page.getByTestId('prepare-draft').click();await page.getByTestId('codex-plan-implement').waitFor();
  assert.equal((await get(codex.id)).nativeApprovals.length,0);const oldReference={kind:'message',receipt:(await get(codex.id)).messages.findLast(m=>m.planReview).planReview.receipt};
  await page.getByTestId('codex-plan-review').last().getByTestId('open-plan').click();await page.getByTestId('plan-translation').getByText('检查样例并添加一个测试。',{exact:true}).waitFor();await snap('codex-plan-review-translated.png');await page.getByTestId('close-plan-reader').click();
  const beforeRevise=requests.length;await page.getByTestId('codex-plan-revise').click();await page.getByTestId('codex-plan-revise').waitFor({state:'detached'});assert.equal((await get(codex.id)).collaborationMode,'plan');assert.equal(requests.length,beforeRevise);
  await page.getByTestId('composer-input').fill('Revise the native Codex plan.');await page.getByTestId('prepare-draft').click();await page.getByTestId('codex-plan-implement').waitFor();scenario='complete';await page.getByTestId('codex-plan-implement').click();await wait(async()=>(await get(codex.id)).nativeTurnStatus==='completed'&&(await get(codex.id)).messages.at(-1)?.original==='Isolated planning fixture complete.','Codex implementation');
  assert.equal((await get(codex.id)).collaborationMode,'default');assert.equal((await get(codex.id)).permissionMode,'full-access');assert.match(JSON.stringify(requests.at(-1)),/Implement the plan/);assert.match(currentMode(requests.at(-1)),/Default/);await assert.rejects(call('session/plan/respond',{sessionId:codex.id,reference:oldReference,action:'implement'}));
  mark('Codex native plan items remain in conversation, support full translated reading and explicit revise/implement, and implementation starts default collaboration without changing full access');
  // Switch this same, previously used conversation both ways, verifying fresh native tool schemas and UI.
  await call('permissions/remember',{projectId:null,runtime:'claude',permissionMode:'default'});await call('session/collaboration',{sessionId:codex.id,mode:'plan'});await call('session/model-target',{sessionId:codex.id,targetId:target('claude').id});await page.getByTestId('composer-plan-mode').waitFor({state:'detached'});
  assert.equal((await get(codex.id)).permissionMode,'default');await page.getByTestId('composer-add').click();await page.getByTestId('composer-menu').getByText('Claude Code',{exact:true}).waitFor();await page.getByTestId('composer-menu').locator('[data-command=plan]').click();await wait(async()=>(await get(codex.id)).permissionMode==='plan','Claude menu after switch');
  scenario='exit';await page.getByTestId('composer-input').fill('Use Claude tools after switching runtime.');await page.getByTestId('prepare-draft').click();await page.getByTestId('native-approval').waitFor();const claudeTools=requests.at(-1).tools.map(t=>t.function.name);assert.ok(claudeTools.includes('ExitPlanMode'));assert.ok(!claudeTools.includes('request_user_input'));
  await assert.rejects(call('session/model-target',{sessionId:codex.id,targetId:target('codex').id}));await page.getByTestId('native-approval').getByTestId('open-plan').click();await page.getByTestId('session-stop').click();await wait(async()=>(await get(codex.id)).status==='idle','stop approval before switching');await page.getByTestId('plan-reader').waitFor({state:'detached'});
  await call('session/model-target',{sessionId:codex.id,targetId:target('codex').id});await page.getByTestId('composer-plan-mode').waitFor();assert.equal((await get(codex.id)).permissionMode,'full-access');
  await page.getByTestId('composer-add').click();await page.getByTestId('composer-menu').getByText('Codex',{exact:true}).waitFor();await page.getByTestId('composer-input').press('Escape');scenario='complete';await page.getByTestId('composer-input').fill('Use Codex tools after switching back.');await page.getByTestId('prepare-draft').click();await wait(async()=>(await get(codex.id)).nativeTurnStatus==='completed','Codex switch-back task');const codexTools=requests.at(-1).tools.map(t=>t.function.name);assert.ok(codexTools.includes('request_user_input'));assert.ok(!codexTools.includes('ExitPlanMode'));assert.match(currentMode(requests.at(-1)),/Plan Mode/);
  mark('Same conversation runtime switches refresh native tools, menu, plan capsule and permission UI; each runtime retains its own modes and pending approvals prevent switching');
  assert.deepEqual(errors,[]);
}catch(error){errors.push(String(error));if(page){await snap('failure.png').catch(()=>{});await writeFile(path.join(output,'failure-state.json'),JSON.stringify(await call('state/get'))).catch(()=>{});}throw error;}
finally{if(app)await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,requestCount:requests.length,translationCount:translations.length,scope:'Hidden isolated Electron and installed CLIs; synthetic loopback provider; no production client interaction, real credentials, real model or remote deployment.'},null,2));}
