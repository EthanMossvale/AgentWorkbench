import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {encodeZip} from '../packages/native-resources/archive.ts';

const root=process.cwd(),appRoot=path.resolve(process.env.AGENT_WORKBENCH_TEST_APP??root),output=path.resolve('build/qa/desktop-updates-ui');
await mkdir(output,{recursive:true});const data=await mkdtemp(path.join(output,'profile-'));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:data,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:path.join(data,'missing-codex.exe'),AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:path.join(data,'missing-claude.exe')};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[];
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[appRoot],env,timeout:45000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByTestId('composer-input').waitFor();};
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
try{
 await launch();assert.equal((await call('desktop-updates/status')).phase,'disabled');assert.equal(await page.locator('[data-workbench-desktop-update]').isVisible(),false);
 const source=`export function activate(api){const service=api.services.get('desktop.updates');let emit=()=>{},installed=0;api.onDispose(service.register({id:'plugin:'+api.id+'/fixture',create(){return {subscribe(fn){emit=fn;return()=>{emit=()=>{}}},async check(){emit({phase:'downloading',percent:42})},async install(){installed++},dispose(){}}}}));api.services.override('desktop.updates',{install:async()=>{installed++;emit({phase:'installing'})}});api.registerCommand('phase',value=>{emit(value);return installed});}`;
 const zip=path.join(output,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id:'qa.desktop-updates',name:'Update fixture',version:'1.0.0',description:'Synthetic update UI',capabilities:['host'],main:'main.mjs'}))},{name:'main.mjs',data:Buffer.from(source)}]));
 await call('extensions/import',{filePath:zip});let records=await call('extensions/list');let record=records.find(r=>r.manifest.id==='qa.desktop-updates');
 await call('extensions/toggle',{id:record.manifest.id,hash:record.hash,enabled:true,approveHost:true});
 const phase=value=>call('extensions/command',{id:record.manifest.id,name:'phase',payload:value});
 await phase({phase:'downloading',percent:42});await page.getByRole('status').filter({hasText:'正在下载更新 42%'}).waitFor();
 await phase({phase:'ready',version:'0.1.2'});await page.getByRole('button',{name:'安装更新并重启工作台'}).waitFor();await page.screenshot({path:path.join(output,'ready-light.png')});
 await call('theme/set',{theme:'dark'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));await page.screenshot({path:path.join(output,'ready-dark.png')});
 await page.getByRole('button',{name:'安装更新并重启工作台'}).click();await page.getByRole('status').filter({hasText:'正在安装更新'}).waitFor();assert.equal(await phase({phase:'ready',version:'0.1.2'}),1);
 await call('extensions/toggle',{id:record.manifest.id,hash:record.hash,enabled:false});await page.locator('[data-workbench-desktop-update]').waitFor({state:'hidden'});
 await call('extensions/toggle',{id:record.manifest.id,hash:record.hash,enabled:true});await phase({phase:'ready',version:'0.1.3'});await page.getByRole('button',{name:'安装更新并重启工作台'}).waitFor();
 await call('extensions/toggle',{id:record.manifest.id,hash:record.hash,enabled:false});await app.close();app=undefined;await launch();assert.equal((await call('desktop-updates/status')).phase,'disabled');assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,scope:'Hidden production UI with approved synthetic backend; no real installer executed',errors},null,2));console.log('PASS update progress, ready action, explicit install dispatch, dark/narrow, disable/reenable and process restart');
}finally{await app?.close();}
