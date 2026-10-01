import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as buildHost } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { mkdir, writeFile, cp } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

// Production UI and host in a hidden, isolated app. Node stands in only for CLI
// installation discovery; no native task, user credentials or remote connection.
const root=process.cwd(),output=path.resolve('build/qa/runtime-effort-ui'),appRoot=path.join(output,'app'),data=path.join(output,'data-'+Date.now());
await mkdir(output,{recursive:true});
const checks=[],errors=[],requests=[],pids=[];let app,page,passed=false;
const server=createServer(async(req,res)=>{
  requests.push(req.url);res.setHeader('content-type','application/json');
  if(!req.url.endsWith('/models')){res.writeHead(500).end('{}');return;}
  res.end(JSON.stringify({data:[{id:'fixture-model',display_name:'Fixture model',supported_reasoning_levels:['low','medium','high','ultra'],default_reasoning_effort:'medium'}]}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
if(!process.argv.includes('--reuse-build')){
await buildRenderer({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[`apps/desktop/host/${entry}.ts`],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await cp('services/vps-workspace-control',path.join(appRoot,'host/workspace-control'),{recursive:true});
await cp('services/vps-account-broker',path.join(appRoot,'host/account-runtime'),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-runtime-effort-qa',version:'1.0.0',main:'host/main.cjs'}));
}
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:data,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.execPath,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const record=name=>{checks.push(name);console.log('PASS '+name);};
const launch=async()=>{
  app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:root,env,timeout:45000});pids.push(app.process().pid);
  page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.getByTestId('composer-runtime').waitFor();
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
};
const runtime=async value=>{await page.getByTestId('composer-runtime').click();await page.getByRole('menu',{name:'运行时',exact:true}).locator(`[data-value="${value}"]`).click();};
const shown=async label=>{await page.waitForFunction(label=>document.querySelector('[data-testid=model-selector]')?.textContent.includes(label),label);};
const saved=async(runtime,effort)=>page.waitForFunction(async({runtime,effort})=>{const s=await window.workbench.call('state/get');return s.lastSelectedRuntime===runtime&&s.lastModelSelection?.effort===effort;},{runtime,effort});
const setEffort=async key=>{if(await page.getByTestId('model-selector').getAttribute('aria-expanded')!=='true')await page.getByTestId('model-selector').click();await page.getByTestId('native-effort').press(key);await page.keyboard.press('Escape');};
try{
  await launch();await call('theme/set',{theme:'dark'});
  const connection=await call('model-api/save',{connection:{name:'Synthetic provider',baseUrl:`http://127.0.0.1:${server.address().port}`,protocol:'chat-completions',models:[{id:'map',model:'fixture-model',name:'Fixture model',enabled:true}]},key:''});
  const target=runtime=>`api/${connection.id}/map/${runtime}`;
  await page.waitForFunction(async()=>{const clis=await window.workbench.call('local-cli/list');return clis.filter(item=>item.installed).length===2;});
  await runtime('codex');await page.getByTestId('model-selector').click();await page.locator(`[role=menuitemradio][data-value="${target('codex')}"]`).click();await saved('codex','medium');await page.getByTestId('native-effort').waitFor();await page.keyboard.press('Escape');
  await setEffort('End');await shown('超高');await saved('codex','ultra');
  await page.getByTestId('composer-input').fill('Keep this unsent draft.');
  for(const next of ['claude','codex','claude','codex']){await runtime(next);await saved(next,'ultra');await shown('超高');}
  assert.equal(await page.getByTestId('composer-input').inputValue(),'Keep this unsent draft.');assert.equal((await call('state/get')).sessions.length,0);
  record('blank composer round trips keep exact effort and unsent text without creating a task');
  await setEffort('Home');await shown('低');await runtime('claude');await saved('claude','low');await shown('低');
  await page.getByTestId('new-session').click();await shown('低');
  record('a later explicit effort replaces the old choice and new chats inherit it');
  await app.close();app=undefined;await launch();await shown('低');await saved('claude','low');assert.notEqual(pids[0],pids[1]);
  await runtime('codex');await shown('低');await saved('codex','low');
  record('an actual app process restart restores the exact selection before another runtime switch');
  const chat=await call('session/create',{modelTargetId:target('codex'),modelSelection:{model:'fixture-model',effort:'ultra'}});
  await page.getByTestId(`sidebar-session-${chat.id}`).locator('.session-select').click();await shown('超高');
  await runtime('claude');await saved('claude','ultra');await shown('超高');
  let current=(await call('state/get')).sessions.find(s=>s.id===chat.id);assert.equal(current.binding.runtime,'claude');assert.equal(current.modelSelection.effort,'ultra');assert.equal(current.messages.length,0);
  record('the existing-session switch reaches the real host with the selected effort');
  await setEffort('Home');await shown('低');await saved('claude','low');
  for(const next of ['codex','claude','codex']){await runtime(next);await saved(next,'low');await shown('低');current=(await call('state/get')).sessions.find(s=>s.id===chat.id);assert.equal(current.modelSelection.effort,'low');assert.equal(current.id,chat.id);}
  assert.equal((await call('state/get')).sessions.length,1);
  record('current explicit effort wins over a stale saved lane in either direction');
  await page.screenshot({path:path.join(output,'existing-session-dark.png')});
  await call('theme/set',{theme:'light'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));
  await page.getByTestId('new-session').click();await shown('低');await runtime('claude');await saved('claude','low');
  await page.getByTestId('model-selector').click();await page.screenshot({path:path.join(output,'new-draft-light.png')});await page.keyboard.press('Escape');
  record('new chats after session switching show the remembered effort in the model control');
  await app.close();app=undefined;await launch();await shown('低');
  current=(await call('state/get')).sessions.find(s=>s.id===chat.id);assert.equal(current.binding.runtime,'codex');assert.equal(current.modelSelection.effort,'low');
  record('restart persists the last draft independently of the existing session binding');
  assert.ok(requests.every(url=>url.endsWith('/models')));assert.deepEqual(errors,[]);passed=true;
}catch(error){errors.push(String(error.stack??error));if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{if(app)await app.close();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'report.json'),JSON.stringify({passed,checks,errors,pids,scope:'Isolated hidden production Electron; metadata-only loopback; no real model task, native identity, remote execution or active client.'},null,2));}
