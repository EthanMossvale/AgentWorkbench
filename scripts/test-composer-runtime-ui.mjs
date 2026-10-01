import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as hostBuild } from 'esbuild';
import { build as rendererBuild } from 'vite';
import { mkdir,writeFile,cp } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd(),output=path.resolve(process.env.AWB_RUNTIME_MENU_UI_QA??'build/qa/runtime-commands/ui'),appRoot=path.join(output,'app'),data=path.join(output,'data-'+Date.now()),home=path.join(data,'native-home');
assert.ok(process.env.AWB_QA_CODEX&&process.env.AWB_QA_CLAUDE,'Explicit native QA executables required.');
const put=async(file,text)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);};
for(const runtime of ['codex','claude'])await put(path.join(home,'.'+runtime,'skills',runtime+'-fixture','SKILL.md'),`---\nname: ${runtime}-fixture\ndescription: Synthetic runtime-specific skill.\n---\nNATIVE_SKILL_${runtime}: Describe the synthetic fixture.\n`);
await put(path.join(home,'.claude/skills/hidden/SKILL.md'),'---\nname: hidden\ndescription: Background only\nuser-invocable: false\n---\nNot user invocable.');
let app,page,passed=false;const checks=[],errors=[],requests=[];
const server=createServer(async(req,res)=>{try{
  res.setHeader('content-type','application/json');if(req.url.endsWith('/models')){res.end(JSON.stringify({data:[{id:'fixture-model'}]}));return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
  res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'Synthetic fixture complete. '.repeat(100)}}],usage:{prompt_tokens:3000,completion_tokens:500}}));
}catch(error){errors.push(String(error));res.writeHead(500).end('{}');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await rendererBuild({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await hostBuild({entryPoints:[`apps/desktop/host/${entry}.ts`],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await cp('services/vps-workspace-control',path.join(appRoot,'host/workspace-control'),{recursive:true});await cp('services/vps-account-broker',path.join(appRoot,'host/account-runtime'),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-runtime-menu-qa',version:'1.0.0',main:'host/main.cjs'}));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:data,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.env.AWB_QA_CODEX,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.env.AWB_QA_CLAUDE};delete env.ELECTRON_RUN_AS_NODE;
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const mark=name=>{checks.push(name);console.log('PASS '+name);};
const wait=async(fn,label)=>{const end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw Error('Timed out: '+label);};
const screenshot=async name=>page.screenshot({path:path.join(output,name)});
try{
  app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,860));await call('theme/set',{theme:'light'});await call('plugins/set-enabled',{id:'translation',enabled:false});
  const connection=await call('model-api/save',{connection:{name:'运行时菜单验收',baseUrl:`http://127.0.0.1:${server.address().port}`,protocol:'chat-completions',models:[{id:'fixture',model:'fixture-model',name:'Synthetic fixture',enabled:true,contextWindow:128000}]},key:'synthetic-fixture-key'});
  const targets=await call('model-targets/list'),target=runtime=>targets.find(t=>t.runtime===runtime&&t.binding.modelConnectionId===connection.id);
  const chat=await call('session/create',{modelTargetId:target('codex').id,projectId:null,permissionMode:'default'});await page.getByTestId('sidebar-session-'+chat.id).locator('.session-select').click();
  const input=page.getByTestId('composer-input'),menu=page.getByTestId('composer-menu'),get=async()=>(await call('state/get')).sessions.find(s=>s.id===chat.id);
  const switchRuntime=async(runtime)=>{await page.getByTestId('composer-runtime').click();await page.getByRole('menu',{name:'运行时',exact:true}).locator(`[data-value=${runtime}]`).click();await wait(async()=>(await get()).binding.runtime===runtime,'same-session runtime switch');await menu.locator(`[data-command=${runtime==='claude'?'plan':'model'}]`).waitFor();};
  await input.fill('/');await menu.getByRole('option',{name:/codex-fixture/}).waitFor();assert.equal(await menu.getByRole('option',{name:/claude-fixture/}).count(),0);assert.equal(await menu.locator('[data-command=compact]').isDisabled(),true);assert.equal(await menu.locator('[data-command=plan]').count(),1);assert.equal(requests.length,0);mark('Codex catalog shows only its native skills and supported commands; discovery never calls a model');
  await switchRuntime('claude');assert.equal((await get()).id,chat.id);await menu.getByRole('option',{name:/claude-fixture/}).waitFor();assert.equal(await menu.getByRole('option',{name:/codex-fixture/}).count(),0);assert.equal(await menu.getByRole('option',{name:/hidden/}).count(),0);assert.equal(await input.inputValue(),'/');assert.equal(requests.length,0);await screenshot('claude-light.png');mark('same conversation Codex to Claude refreshes the already-open slash menu and native skill list');
  await menu.getByRole('option',{name:/claude-fixture/}).click();assert.match(await page.locator('.composer [data-testid=skill-tokens]').innerText(),/claude-fixture/);await input.fill('/');await switchRuntime('codex');await menu.getByRole('option',{name:/codex-fixture/}).waitFor();assert.equal(await page.locator('.composer [data-testid=skill-tokens]').count(),0);assert.equal(await menu.locator('[data-command=plan]').count(),1);mark('switching back refreshes Codex commands and removes the previously selected Claude skill');
  await input.fill('/approvals');await menu.locator('[data-command=permissions]').click();await page.getByTestId('permission-menu').waitFor();await page.keyboard.press('Escape');
  await input.fill('/model');await menu.locator('[data-command=model]').click();await page.getByRole('dialog',{name:'模型与思考设置'}).waitFor();await page.keyboard.press('Escape');
  await input.fill('/context');await menu.locator('[data-command=context]').click();await page.getByRole('dialog',{name:'会话状态'}).waitFor();await page.keyboard.press('Escape');mark('native permission alias, model and context entries open their actual controls');
  await input.fill('/fixture');await menu.getByRole('option',{name:/codex-fixture/}).click();await input.fill('Remember the fixture.');await page.getByTestId('prepare-draft').click();await wait(async()=>(await get()).nativeTurnStatus==='completed','native first task');assert.ok(requests.some(b=>JSON.stringify(b).includes('NATIVE_SKILL_codex')));
  await input.fill('/compact');await wait(()=>menu.locator('[data-command=compact]').isEnabled(),'manual compaction enabled after native history exists');const before=(await get()).messages.length;await menu.locator('[data-command=compact]').click();await wait(async()=>{const s=await get();return s.messages.length>before&&s.nativeTurnStatus==='completed';},'manual command completion');assert.equal((await get()).messages.filter(m=>m.original==='/compact').length,1);mark('menu compaction dispatch reaches the actual native CLI and records exactly one explicit command');
  await input.fill('/');await wait(()=>menu.locator('[data-command=compact]').isEnabled(),'native cleanup before switching');const stale=(await call('composer/catalog',{sessionId:chat.id})).scope;await switchRuntime('claude');await assert.rejects(call('composer/execute',{sessionId:chat.id,scope:stale,commandId:'compact'}),/COMPOSER_SCOPE_CHANGED/);assert.equal(await menu.locator('[data-command=compact]').isDisabled(),true);mark('switching invalidates old command scopes and blocks compaction until the new runtime receives history');
  await menu.locator('[data-command=plan]').click();await wait(async()=>(await get()).permissionMode==='plan','native plan mode');mark('Claude plan command changes the native permission mode without sending a task');
  await call('theme/set',{theme:'dark'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));await input.fill('/');await menu.getByRole('option',{name:/claude-fixture/}).waitFor();const box=await menu.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=860);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await screenshot('claude-dark-narrow.png');
  const count=requests.length;await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});assert.equal(await menu.isVisible(),true);await input.press('Escape');assert.equal(requests.length,count);mark('light and dark narrow layouts, IME confirmation and Escape preserve the draft without accidental execution');
  assert.deepEqual(errors,[]);passed=true;
}catch(error){errors.push(String(error));if(page)await screenshot('failure.png').catch(()=>{});throw error;}
finally{if(app)await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'report.json'),JSON.stringify({passed,checks,errors,modelRequests:requests.length,scope:'Hidden isolated full Electron app and installed native CLIs, disposable native homes and synthetic localhost provider only.'},null,2));}
