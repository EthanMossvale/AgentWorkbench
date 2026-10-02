import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {encodeZip} from '../packages/native-resources/archive.ts';
import {navigateWorkbench} from './ui-control-helpers.mjs';
const application=process.env.AWB_QA_APPLICATION,output=process.env.AWB_QA_OUTPUT;
if(!application||!output)throw Error('Explicit isolated application and output required');
await mkdir(output,{recursive:true});
const portableBundle=path.join(output,'portable.cjs');await build({entryPoints:['packages/workspace-control/portable.ts'],outfile:portableBundle,bundle:true,platform:'node',format:'cjs'});
const profile=path.join(output,'profile'),checks=[],errors=[];
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const toggle=(p,enabled)=>call('extensions/toggle',{id:p.manifest.id,hash:p.hash,enabled,approveHost:enabled});
const install=async(id,source,renderer)=>{
 const manifest={schemaVersion:1,apiVersion:1,id,name:id,description:'Disposable export expiry acceptance',version:'1.0.0',capabilities:['host'],...(source?{main:'main.mjs'}:{}),...(renderer?{renderer:'renderer.mjs'}:{})};
 const zip=path.join(output,id+'.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},...(source?[{name:'main.mjs',data:Buffer.from(source)}]:[]),...(renderer?[{name:'renderer.mjs',data:Buffer.from(renderer)}]:[])]));
 await call('extensions/import',{filePath:zip});const plugin=(await call('extensions/list')).find(p=>p.manifest.id===id);assert.ok(plugin);await toggle(plugin,true);return plugin;
};
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[application],cwd:application,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);};
const pass=name=>{checks.push(name);console.log('PASS '+name);};
try{
 await launch();
 const plugin=await install('qa.workspace-expiry',`import {createRequire} from 'node:module';
const {PortableWorkspaceService}=createRequire(import.meta.url)(${JSON.stringify(portableBundle)});
export async function activate(api){
 const portable=new PortableWorkspaceService(${JSON.stringify(path.join(output,'portable-profile'))},async(host,command,options)=>command.startsWith('exec /usr/bin/python3')?{exitCode:0,signal:null,stderr:'',stdout:JSON.stringify({username:'member',uid:1001,root:'/home/member',hostPublicKeys:['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4'],issuedAtEpoch:1700000000,expiresAtEpoch:1700003600})}:{exitCode:255,signal:null,stdout:'',stderr:'Connection timed out during banner exchange PRIVATE_SENTINEL'});
 api.onDispose(()=>portable.dispose());
 const file=${JSON.stringify(path.join(output,'synthetic.awworkspace'))},admin={hostname:'fixture.invalid',port:22,username:'root',role:'admin',ownerId:'fixture'},member={...admin,name:'Test',username:'member',role:'workspace'};await portable.export(admin,member,file);
 const calls=[];const workspace={id:'member',name:'测试工作空间',username:'member',uid:1001,generation:'wg',revision:1,root:'/home/member',environment:{runtimes:['codex','claude'],defaultDirectory:'/home/member',env:{}},allowedAccountIds:[],nativeQuota:'unknown',status:'active',devices:[],invites:[],createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'};
 api.services.register('qa.workspace-expiry.backend',{export:async(host,id,ttl)=>{calls.push({id,ttl});return {saved:true,path:'fixture.awworkspace'};}},{version:1});
 const backend=api.services.get('qa.workspace-expiry.backend');
 api.services.override('actions.workspace-management',{list:async()=>({availability:'ready',authorityId:'a',generation:'g',revision:1,workspaces:[workspace],connection:{hostname:'fixture.invalid',port:22,hostPublicKeys:[]},enrollmentUrl:'',transport:'ssh'}),exportManaged:(host,id,ttl)=>backend.export(host,id,ttl),importPreview:()=>portable.preview(file),import:(id,label)=>portable.import(id,label)});
 api.registerCommand('calls',()=>calls);
 }`);
 await call('host/save',{host:{id:'admin',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:'C:/fixture/unused-key',knownHostsFile:'C:/fixture/unused-pins'}});
 await navigateWorkbench(page,'connections');
 const open=()=>page.getByTestId('workspace-export-open').click();
 const close=()=>page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
 const counts=()=>call('extensions/command',{id:plugin.manifest.id,name:'calls',payload:{}});
 for(const ttl of [3600,21600,43200,86400,604800]){
  await open();const select=page.getByTestId('workspace-export-duration');assert.equal(await select.inputValue(),'3600');assert.deepEqual(await select.locator('option').allTextContents(),['1h','6h','12h','1day','7day']);await select.selectOption(String(ttl));await page.getByTestId('workspace-export-save').click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.deepEqual((await counts()).at(-1),{id:'member',ttl});
 }
 pass('five durations reach the approved registered backend through the production controller; each export defaults to 1h');
 for(const ttlSeconds of [0,604801,'3600',null])await assert.rejects(call('studio/export-managed',{id:'admin',workspaceId:'member',ttlSeconds}));
 assert.equal((await counts()).length,5);pass('controller rejects invalid TTL before plugin execution');
 await open();await page.getByTestId('workspace-export-duration').selectOption('604800');await close();await open();assert.equal(await page.getByTestId('workspace-export-duration').inputValue(),'3600');
 const surface=await install('qa.workspace-expiry-surface',null,`export function activate(api){return api.observeSurfaces('workspace-export-duration','replace',({root})=>{const node=document.createElement('p');node.dataset.expiryReplacement='yes';node.textContent='Synthetic expiry replacement';root.append(node);return ()=>node.remove();});}`);
 await page.locator('[data-expiry-replacement]').waitFor();assert.equal(await page.getByTestId('workspace-export-duration').isVisible(),false);await close();await open();await page.locator('[data-expiry-replacement]').waitFor();
 await toggle(surface,false);await page.getByTestId('workspace-export-duration').waitFor({state:'visible'});await toggle(surface,true);await page.locator('[data-expiry-replacement]').waitFor();await toggle(surface,false);
 pass('approved surface replaces mounted and later dialogs and restores on disable and reenable');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,690));await page.screenshot({path:path.join(output,'export-light.png')});await call('theme/set',{theme:'dark'});await page.screenshot({path:path.join(output,'export-dark.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByTestId('workspace-export-duration').selectOption('604800');await app.close();app=undefined;await launch();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,900));await page.waitForFunction(()=>{const el=document.querySelector('[data-testid=workspace-export-open]');return el&&el.getBoundingClientRect().width>0;});assert.equal(await page.getByTestId('workspace-export-duration').count(),0);await open();assert.equal(await page.getByTestId('workspace-export-duration').inputValue(),'3600');assert.deepEqual(await counts(),[]);await close();
 pass('full process restart preserves connections but never restores or replays a pending authorization');
 await toggle(plugin,false);await toggle(plugin,true);await open();await page.getByTestId('workspace-export-save').click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.deepEqual(await counts(),[{id:'member',ttl:3600}]);
 pass('registered backend cleans up and recovers after disable and reenable');
 await page.getByTestId('studio-workspace-member').click();await page.getByTestId('studio-invite-create').click();assert.equal(await page.getByTestId('workspace-export-duration').inputValue(),'3600');await page.getByTestId('workspace-export-duration').selectOption('604800');await page.getByRole('dialog').getByRole('button',{name:'导出文件',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.deepEqual((await counts()).at(-1),{id:'member',ttl:604800});pass('workspace detail export uses the same duration editor and command');
 await page.getByTestId('studio-import-open').click();await page.getByTestId('studio-import-preview').waitFor();assert.equal(await page.getByTestId('studio-import-confirm').isEnabled(),true);await page.getByTestId('studio-import-confirm').click();await page.getByTestId('studio-import-error').waitFor();assert.match(await page.getByTestId('studio-import-error').innerText(),/WORKSPACE_IMPORT_PROBE_HANDSHAKE_TIMEOUT/);assert.ok(!(await page.getByTestId('studio-import-error').innerText()).includes('PRIVATE_SENTINEL'));pass('approved importer runs production ACL and SSH diagnostic paths on an old displayed deadline without exposing raw output');assert.deepEqual(errors,[]);
}catch(error){if(page){console.error((await page.locator('body').innerText()).slice(0,2000));await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}throw error;}finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,boundary:'Isolated hidden desktop with approved synthetic plugins; no live remote or provider calls.'},null,2));}
