import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {encodeZip} from '../packages/native-resources/archive.ts';
import {navigateWorkbench} from './ui-control-helpers.mjs';

const application=process.env.AWB_QA_APPLICATION,output=process.env.AWB_QA_OUTPUT;
if(!application||!output)throw Error('Explicit isolated application and QA output are required.');
await mkdir(output,{recursive:true});
const profile=path.join(output,'profile'),checks=[],errors=[];
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:path.join(output,'missing-codex.exe'),AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:path.join(output,'missing-claude.exe')};delete env.ELECTRON_RUN_AS_NODE;
const fixtureSource=`export function activate(api){
 const host={id:'member',name:'Imported workspace',hostname:'fixture.invalid',port:22,username:'member',role:'workspace',ownerId:'fixture',authorityId:'authority',authorityGeneration:'g',remoteWorkspaceId:'w',workspaceGeneration:'wg',identityFile:'C:/fixture/unused-key',knownHostsFile:'C:/fixture/unused-hosts'};
 let imports=0,installs=0,installed=false,allow=false;
 api.services.override('actions.workspace-management',{importPreview:async()=>({previewId:'fixture',workspaceName:'Imported workspace',username:'member',hostname:'fixture.invalid',port:22,expiresAt:new Date(Date.now()+600000).toISOString(),authorityId:'authority',workspaceId:'w',enrollmentUrl:'SSH fixture.invalid:22',transport:'ssh'}),import:async()=>{if(imports++)throw Error('Unexpected duplicate enrollment');return {...host};}});
 api.services.override('accounts.catalog',{list:async()=>({availability:'ready',source:'native-owner',authorityId:'authority',generation:'g',workspaceId:'w',revision:1,selectionRevision:1,selectedClaudeAccountId:'c',accounts:[{id:'c',generation:'cg',provider:'claude',status:'authenticated',observedAt:'fixture'}]})});
 api.services.override('native.cli',{locate:async runtime=>runtime==='claude'&&installed?{executable:process.execPath,source:'native'}:undefined,install:async(runtime,update,automatic,method)=>{if(runtime!=='claude'||update||automatic||method!=='native')throw Error('Unexpected installer arguments');installs++;if(!allow)throw Error('Synthetic offline installer');installed=true;return [];}});
 api.services.override('actions.native-accounts',{models:async()=>[{id:'fixture',model:'fixture',name:'Fixture Claude',isDefault:true,efforts:['high'],serviceTiers:[]}],status:async()=>({installed:true,authenticated:true,execution:'local-mcp-required',block:null})});
 api.services.override('actions.native-claude',{createTransport:()=>{throw Error('No model requests in this fixture');}});
 api.registerCommand('allow',()=>{allow=true;});api.registerCommand('counts',()=>({imports,installs}));
}`;
let app,page,plugin;
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const toggle=(p,enabled)=>call('extensions/toggle',{id:p.manifest.id,hash:p.hash,enabled,approveHost:enabled});
const install=async(id,source,renderer)=>{
 const manifest={schemaVersion:1,apiVersion:1,id,name:id,description:'Disposable workspace readiness acceptance',version:'1.0.0',capabilities:['host'],...(source?{main:'main.mjs'}:{}),...(renderer?{renderer:'renderer.mjs'}:{})};
 const zip=path.join(output,id+'.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},...(source?[{name:'main.mjs',data:Buffer.from(source)}]:[]),...(renderer?[{name:'renderer.mjs',data:Buffer.from(renderer)}]:[])]));
 await call('extensions/import',{filePath:zip});const installed=(await call('extensions/list')).find(p=>p.manifest.id===id);assert.ok(installed);await toggle(installed,true);return installed;
};
const command=name=>call('extensions/command',{id:plugin.manifest.id,name,payload:{}});
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const launch=async()=>{
 app=await electron.launch({executablePath:electronPath,args:[application],cwd:application,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
};
try{
 await launch();plugin=await install('qa.workspace-ready',fixtureSource);await navigateWorkbench(page,'connections');
 await page.getByTestId('studio-import-open').click();await page.getByTestId('studio-import-preview').waitFor();
 assert.match(await page.getByTestId('studio-import-dialog').innerText(),/官方安装器/);assert.deepEqual(await command('counts'),{imports:0,installs:0});pass('preview explains the optional official tool installation and performs no installation');
 await page.getByTestId('studio-import-confirm').click();await page.getByTestId('studio-import-error').waitFor();assert.match(await page.getByTestId('studio-import-error').innerText(),/成员连接已保存/);assert.equal(await page.getByTestId('studio-import-confirm').innerText(),'重新准备');
 assert.deepEqual(await command('counts'),{imports:1,installs:1});assert.equal((await call('state/get')).hosts.filter(h=>h.id==='member').length,1);pass('failed preparation keeps the imported member and offers explicit preparation recovery');
 await page.screenshot({path:path.join(output,'preparation-error.png')});
 await command('allow');await page.getByTestId('studio-import-confirm').click();await page.getByTestId('studio-import-dialog').waitFor({state:'hidden'});assert.deepEqual(await command('counts'),{imports:1,installs:2});
 assert.ok((await call('model-targets/list',{refresh:false})).some(t=>t.ready&&t.selection?.model==='fixture'));assert.equal((await call('state/get')).sessions.length,0);pass('recovery primes the real model selector without reenrollment or a model request');
 await page.getByTestId('studio-import-open').click();await page.getByTestId('studio-import-preview').waitFor();
 const surface=await install('qa.workspace-surface',null,`export function activate(api){return api.observeSurfaces('workspace-import','replace',({root})=>{const node=document.createElement('p');node.dataset.fixtureWorkspace='yes';node.textContent='Synthetic workspace replacement';root.append(node);return ()=>node.remove();});}`);
 await page.locator('[data-fixture-workspace]').waitFor();assert.equal(await page.getByTestId('studio-import-dialog').isVisible(),false);
 await page.getByRole('dialog',{name:'导入成员工作空间'}).getByRole('button',{name:'关闭窗口',exact:true}).click();await page.getByTestId('studio-import-open').click();await page.locator('[data-fixture-workspace]').waitFor();
 await toggle(surface,false);await page.getByTestId('studio-import-dialog').waitFor({state:'visible'});assert.equal(await page.locator('[data-fixture-workspace]').count(),0);pass('approved named surface replaces current and later dialogs and restores on disable');
 await call('theme/set',{theme:'dark'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,690));await page.getByTestId('studio-import-confirm').scrollIntoViewIfNeeded();const box=await page.getByTestId('studio-import-confirm').boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=await page.evaluate(()=>innerWidth));await page.locator('.toast').waitFor({state:'hidden'});await page.screenshot({path:path.join(output,'import-dark-narrow.png')});pass('narrow dark import controls remain visible within the viewport');
 await app.close();app=undefined;await launch();assert.equal(await page.getByTestId('studio-import-dialog').count(),0);assert.equal((await call('state/get')).hosts.filter(h=>h.id==='member').length,1);assert.deepEqual(await command('counts'),{imports:0,installs:0});pass('process restart retains the member and does not restore or replay import authorization');
 assert.deepEqual(errors,[]);
}finally{
 if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,boundary:'Hidden isolated desktop, approved synthetic plugins, no remote deployment, real installer or model request.'},null,2));
}
