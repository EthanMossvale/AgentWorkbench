import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as buildHost } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Builds a separate application and opens hidden synthetic profiles only.
const root=process.cwd(),output=path.resolve(process.env.AWB_DELETE_UI_QA??'build/qa/composer-controls-20260928/delete');
const appRoot=path.join(output,'app'),dataDir=path.join(output,'synthetic-'+Date.now());await mkdir(dataDir,{recursive:true});
await buildRenderer({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-delete-qa',version:'1.0.0',main:'host/main.cjs'}));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:dataDir,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page,passed=false;const checks=[],errors=[];
const record=name=>{checks.push(name);console.log('PASS '+name);};
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:root,env,timeout:45000});page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>!!window.workbench);await page.getByTestId('composer-input').waitFor();};
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
try{
 await launch();assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 const state=await call('state/get');await app.close();app=null;
 const sentinel=path.join(dataDir,'project-file.txt');await writeFile(sentinel,'preserve project file');
 const session={id:'synthetic-unknown',title:'失败回合的本地记录',projectId:null,projectPath:dataDir,pinned:false,archived:false,group:'',createdAt:'2026-09-28T00:00:00Z',status:'uncertain',nativeError:'合成回合回执未知，未自动重发。',binding:{runtime:'demo',provider:'offline',accountRef:'none',executionId:'local-device',egress:'demo'},messages:[{id:'synthetic-user',role:'user',original:'这是一条合成验收消息。',submitted:'Synthetic acceptance message.',timestamp:'2026-09-28T00:00:00Z'}]};
 await writeFile(path.join(dataDir,'state.json'),JSON.stringify({...state,plugins:{translation:{enabled:false}},sessions:[session,{...session,id:'synthetic-retained',title:'保留的其他会话',status:'idle'}]},null,2));
 await launch();await page.getByTestId('sidebar-session-'+session.id).locator('.session-select').click();
 await assert.rejects(call('session/delete',{id:session.id,confirm:true}),/结果未知/);
 record('legacy deletion retains the unknown record until its additional acknowledgement is supplied');
 const openDelete=async()=>{await page.getByTestId('sidebar-session-'+session.id).click({button:'right'});await page.getByTestId('session-delete').click();await page.getByRole('dialog',{name:'永久删除会话'}).waitFor();};
 await openDelete();const dialog=page.getByRole('dialog',{name:'永久删除会话'});assert.match(await dialog.innerText(),/当前回合结果仍未知/);assert.match(await dialog.innerText(),/不会重发旧请求/);assert.match(await dialog.innerText(),/不删除项目文件或远端原生历史/);assert.equal((await call('state/get')).sessions.find(item=>item.id===session.id).status,'uncertain');
 await page.screenshot({path:path.join(output,'delete-confirm-light.png'),fullPage:true});await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await call('state/get')).sessions.length,2);
 record('confirmation explains the unknown outcome and local-only scope; cancellation preserves the record');
 await call('theme/set',{theme:'dark'});await openDelete();await page.screenshot({path:path.join(output,'delete-confirm-dark.png'),fullPage:true});await page.getByTestId('confirm-sidebar-action').click();await page.getByRole('dialog',{name:'永久删除会话'}).waitFor({state:'hidden'});await page.getByTestId('sidebar-session-'+session.id).waitFor({state:'detached'});
 const remaining=await call('state/get');assert.deepEqual(remaining.sessions.map(item=>item.id),['synthetic-retained']);assert.equal(await readFile(sentinel,'utf8'),'preserve project file');
 record('confirmed unknown deletion passes through real IPC and removes only the selected local record');
 await app.close();app=null;await launch();assert.deepEqual((await call('state/get')).sessions.map(item=>item.id),['synthetic-retained']);assert.equal(await readFile(sentinel,'utf8'),'preserve project file');assert.deepEqual(errors,[]);passed=true;
 record('deletion persists after restart with other conversation and project files intact and no renderer errors');
}finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({passed,checks,errors,appRoot,scope:'Hidden Electron, production renderer/host in a separate build, synthetic state only; no real model, credentials, remote history or user profile.'},null,2));}
