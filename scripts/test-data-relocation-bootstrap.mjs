import {build} from 'esbuild';
import electron from 'electron';
import {mkdtemp,mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const output=path.resolve('build/qa/data-relocation-bootstrap');await mkdir(output,{recursive:true});
const fixture=await mkdtemp(path.join(output,'run-')),source=await mkdtemp(path.join(os.tmpdir(),'awb-relocation-'));
const home=path.join(source,'home'),legacy=path.join(home,'AppData','Workbench'),temp=path.join(source,'temp'),locator=path.join(source,'AgentWorkbench-location.json'),target=path.join(fixture,'installed-data'),chosen=path.join(source,'chosen-data');
await mkdir(legacy,{recursive:true});await mkdir(temp);await mkdir(legacy+'-attachments');
await writeFile(path.join(legacy,'opaque.bin'),Buffer.from([0,255,21,49]));
await writeFile(path.join(legacy,'state.json'),JSON.stringify({sessions:[{projectPath:legacy+'-attachments',messages:[{text:legacy}]}]}));
await writeFile(path.join(legacy+'-attachments','sentinel'),'attachment');
await build({entryPoints:['packages/app-data/index.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(fixture,'migration.cjs')});
await writeFile(path.join(fixture,'main.cjs'),`const {app}=require('electron');const {initializeAppData,resolveAppDataInstallation}=require('./migration.cjs');app.setPath('home',${JSON.stringify(home)});app.setPath('temp',${JSON.stringify(temp)});app.setPath('userData',${JSON.stringify(legacy)});try{const installation=process.argv.includes('--source')?resolveAppDataInstallation({platform:'win32',packaged:false,executable:process.execPath,home:${JSON.stringify(home)},appData:${JSON.stringify(path.dirname(locator))}}):${JSON.stringify({directory:target,locator})};const result=initializeAppData(app,undefined,installation);console.log('RESULT '+JSON.stringify(result));if(!result||process.argv.includes('--once'))app.exit(0);else app.whenReady().then(()=>process.stdin.on('data',()=>app.exit(0)));}catch(e){console.log('RESULT '+JSON.stringify({error:e.message,cause:e.cause?.message}));app.exit(1);}`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
function launch(once=false,sourceMode=false){const child=spawn(electron,[path.join(fixture,'main.cjs'),...(once?['--once']:[]),...(sourceMode?['--source']:[])],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});const exit=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});const result=new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Bootstrap timed out')),30000);child.stdout.on('data',data=>{text+=data;const line=text.split(/\r?\n/).find(v=>v.startsWith('RESULT '));if(line){clearTimeout(timer);resolve(JSON.parse(line.slice(7)));}});child.once('error',e=>{clearTimeout(timer);reject(e);});});return {child,exit,result};}
const missing=async file=>assert.equal(await access(file).then(()=>false,()=>true),true,file);
let active;const checks=[];
try{
 active=launch();let result=await active.result;console.log('Initial bootstrap received');assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.directory,legacy);assert.equal(result.migrated,false);
 assert.deepEqual(await readFile(path.join(legacy,'opaque.bin')),Buffer.from([0,255,21,49]));await missing(target);await missing(path.join(home,'.agentworkbench'));
 let state=JSON.parse(await readFile(path.join(legacy,'state.json'),'utf8'));assert.equal(state.sessions[0].projectPath,legacy+'-attachments');assert.equal(state.sessions[0].messages[0].text,legacy);checks.push('real Electron installed startup retains the existing profile and attachment paths');
 const second=launch(true,true);assert.equal(await second.result,null);await second.exit;checks.push('source launch honors the installed-profile singleton');active.child.kill();await active.exit;active=undefined;
 await writeFile(locator,JSON.stringify({version:1,directory:legacy,pending:chosen}));
 for(let i=0;i<2;i++){active=launch(true,i===1);result=await active.result;await active.exit;active=undefined;assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.directory,chosen);assert.deepEqual(await readFile(path.join(chosen,'opaque.bin')),Buffer.from([0,255,21,49]));}
 await missing(target);await missing(path.join(legacy,'opaque.bin'));assert.equal(await readFile(path.join(legacy+'-attachments','sentinel'),'utf8'),'attachment');await missing(chosen+'.migration.json');state=JSON.parse(await readFile(path.join(chosen,'state.json'),'utf8'));assert.equal(state.sessions[0].projectPath,legacy+'-attachments');checks.push('explicit pending relocation moves only the selected profile and source restart preserves it');await missing(path.join(home,'.agentworkbench'));
 const corrupt='{"version":900,"directory":"unknown"}';await writeFile(locator,corrupt);active=launch(true);result=await active.result;await active.exit;active=undefined;assert.equal(result.error,'APP_DATA_LOCATION_INVALID');assert.equal(await readFile(locator,'utf8'),corrupt);checks.push('unknown locator version stops without erasing data');
 await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,sourceVolume:path.parse(source).root,targetVolume:path.parse(target).root,checks},null,2));for(const check of checks)console.log('PASS '+check);
}finally{if(active){active.child.kill();await active.exit;}}
