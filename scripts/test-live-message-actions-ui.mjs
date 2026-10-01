import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as buildHost} from 'esbuild';
import {build as buildRenderer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {StateStore} from '../apps/desktop/host/store.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';

const root=process.cwd(),output=path.join(root,'build/qa/live-message-actions-'+Date.now()),appRoot=path.join(output,'app'),profile=path.join(output,'profile'),imagePath=path.join(output,'reference.png');
await mkdir(appRoot,{recursive:true});
await writeFile(imagePath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT9sAAAAASUVORK5CYII=','base64'));
await buildRenderer({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'error'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-live-actions-qa',version:'0.1.0',main:'host/main.cjs'}));
const store=new StateStore(profile);await store.load();await store.update(s=>{s.translationLayout='inline';s.translateIntermediate=false;s.sessions=[{id:'fixture',projectId:null,projectPath:output,title:'Live message actions',createdAt:new Date().toISOString(),status:'idle',messages:[],pinned:false,archived:false,group:'',binding:{runtime:'claude',provider:'claude',accountRef:'fixture',hostId:'fixture-member',accountRuntime:'native-owner',executionId:'local-device',egress:'vps'}}];});
const source=`export function activate(api){const state=api.services.get('workbench.state');let reads=0;api.services.intercept('images.viewed','read',async(next,input)=>{reads++;return next(input);});api.registerCommand('reads',()=>reads);api.registerCommand('seed',()=>state.update(s=>{const session=s.sessions[0],at=new Date().toISOString();session.status='running';session.messages=[{id:'user',role:'user',original:'Synthetic task',timestamp:at,demo:false},{id:'commentary',role:'assistant',original:'Checking the screenshot.',phase:'commentary',timestamp:at,demo:false,translationStatus:'off',translationSource:'离线固定 QA'}];session.activities=[{id:'image',runtime:'claude',kind:'tool',category:'image',toolName:'mcp__local_device__Read',imagePaths:[${JSON.stringify(imagePath)}],status:'completed',startedAt:at,updatedAt:at}];}));}`;
const manifest={schemaVersion:1,apiVersion:1,id:'qa.live-actions',name:'Live actions QA',description:'Synthetic live message actions',version:'1.0.0',capabilities:['host'],main:'main.mjs'},zip=path.join(output,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.execPath,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.workbench);
 const bitmap=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=100;const context=canvas.getContext('2d');context.fillStyle='#36a6a0';context.fillRect(0,0,160,100);context.fillStyle='#fae16b';context.fillRect(20,20,50,60);context.fillStyle='#d14f76';context.fillRect(90,35,50,30);return canvas.toDataURL('image/png').split(',')[1];});await writeFile(imagePath,Buffer.from(bitmap,'base64'));
 const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
 await page.getByText('Live message actions',{exact:true}).first().click();await call('extensions/import',{filePath:zip});const plugin=(await call('extensions/list')).find(p=>p.manifest.id===manifest.id);await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:true,approveHost:true});
 const command=name=>call('extensions/command',{id:manifest.id,name});await command('seed');
 const translate=page.getByRole('button',{name:'翻译这条消息',exact:true});await translate.waitFor();assert.equal(await translate.isEnabled(),true);await translate.click();await page.getByTestId('inline-translation').waitFor();assert.equal((await call('state/get')).sessions[0].status,'running');
 const log=page.locator('.runtime-image-log');await log.locator('summary').click();await log.locator('img').waitFor();assert.ok(await log.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0));assert.equal(await command('reads'),1);
 await log.getByRole('button',{name:'查看图像 1',exact:true}).click();await page.getByTestId('image-viewer').waitFor();await page.screenshot({path:path.join(output,'viewer.png')});await page.keyboard.press('Escape');
 await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:false});assert.equal((await call('attachments/activity-images',{sessionId:'fixture',activityId:'image'})).length,1);
 await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:true});await call('attachments/activity-images',{sessionId:'fixture',activityId:'image'});assert.equal(await command('reads'),1);
 await page.screenshot({path:path.join(output,'translated-image.png')});await app.close();app=undefined;
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});const restarted=await app.firstWindow();await restarted.waitForFunction(()=>!!window.workbench);const saved=await restarted.evaluate(()=>window.workbench.call('state/get'));assert.equal(saved.sessions[0].messages[1].translationStatus,'complete');assert.equal(saved.sessions[0].activities[0].viewedAttachments.length,1);assert.equal(saved.translateIntermediate,false);
 console.log('PASS running last commentary manual translation, SSH local MCP image thumbnail/viewer, approved plugin disable/reenable and restart; '+output);
}finally{await app?.close();}
