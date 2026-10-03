import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as buildHost} from 'esbuild';
import {build as buildRenderer} from 'vite';
import {mkdir,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {encodeZip} from '../packages/native-resources/archive.ts';
const root=process.cwd(),output=path.join(root,'build/qa/partial-translation-'+Date.now()),appRoot=path.join(output,'app'),profile=path.join(output,'profile');
await mkdir(output,{recursive:true});const checks=[],errors=[];let app,page;
const server=createServer((req,res)=>{req.resume();res.setHeader('content-type','application/json');res.end(JSON.stringify({fixtureText:'Registered partial',choices:[{finish_reason:'length',message:{content:'Core partial'}}]}));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await buildRenderer({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[`apps/desktop/host/${entry}.ts`],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await cp('services/vps-workspace-control',path.join(appRoot,'host/workspace-control'),{recursive:true});await cp('services/vps-account-broker',path.join(appRoot,'host/account-runtime'),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-partial-qa',version:'1.0.0',main:'host/main.cjs'}));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);};
try{
 await launch();const id='qa.partial-translation',manifest={schemaVersion:1,apiVersion:1,id,name:'Partial translation fixture',version:'1.0.0',description:'Synthetic only',capabilities:['host'],main:'main.mjs',renderer:'renderer.mjs'};
 const main=`export function activate(api){api.onDispose(api.services.get('translation.outputs').register({id:'plugin:'+api.id+'/output',read:data=>data.fixtureText?{text:data.fixtureText,incomplete:true}:undefined}));}`;
 const renderer=`export function activate(api){api.observeSurfaces('partial-translation','after',({root})=>{root.dataset.qaPartial='true';});window.qaPartialReplace=()=>api.observeSurfaces('partial-translation','replace',({root})=>{root.textContent='Synthetic partial replacement';});}`;
 const file=path.join(output,'fixture.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(main)},{name:'renderer.mjs',data:Buffer.from(renderer)}]));await call('extensions/import',{filePath:file});const plugin=(await call('extensions/list')).find(p=>p.manifest.id===id),toggle=enabled=>call('extensions/toggle',{id,hash:plugin.hash,enabled,...(enabled?{approveHost:true}:{})});await toggle(true);
 const state=await call('state/get');await call('translation/settings',{profile:{...state.translation,baseUrl:'http://127.0.0.1:'+server.address().port,model:'fixture',protocol:'chat-completions',consent:true},key:'synthetic-only',translateInput:true,translateProgress:false,translateFinal:true});await call('translation/auto-submit',{enabled:true});
 const session=await call('session/create',{runtime:'demo'});await page.getByTestId('sidebar-session-'+session.id).locator('.session-select').click();
 const prepare=async expected=>{await page.getByTestId('composer-input').fill('请保留完整原稿');await page.getByTestId('prepare-draft').click();await page.getByTestId('draft-preview').waitFor();await page.getByTestId('draft-submission-preview').filter({hasText:expected}).waitFor();assert.match(await page.getByTestId('draft-chinese-preview').innerText(),/请保留完整原稿/);await page.locator('[data-workbench-partial-translation]').waitFor();assert.equal((await call('state/get')).sessions.find(s=>s.id===session.id).messages.length,0);};
 await prepare('Registered partial');await page.locator('[data-qa-partial]').waitFor({state:'attached'});await page.evaluate(()=>window.qaPartialOff=window.qaPartialReplace());await page.getByText('Synthetic partial replacement',{exact:true}).waitFor();await page.evaluate(()=>window.qaPartialOff());await page.locator('[data-workbench-partial-translation]').waitFor();await page.screenshot({path:path.join(output,'partial.png')});
 await page.getByTestId('draft-edit').click();await toggle(false);await prepare('Core partial');await page.getByTestId('draft-edit').click();await toggle(true);await prepare('Registered partial');await page.locator('[data-qa-partial]').waitFor({state:'attached'});await page.getByTestId('draft-edit').click();checks.push('partial input retained in existing review with direct send enabled; approved reader and mounted/later surface replacement, disable and reenable');
 await toggle(false);await app.close();app=undefined;await launch();assert.equal((await call('state/get')).autoSubmitTranslated,true);await page.getByTestId('sidebar-session-'+session.id).locator('.session-select').click();await prepare('Core partial');checks.push('complete process restart retains direct-send preference; partial preview does not change it');assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,output}));
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await app?.close();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,realModelCalls:0},null,2));}
