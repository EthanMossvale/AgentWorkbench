import {build} from 'esbuild';
import electron from 'electron';
import {mkdtemp,mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const output=path.resolve('build/qa/data-relocation-bootstrap');await mkdir(output,{recursive:true});
const fixture=await mkdtemp(path.join(output,'run-')),source=await mkdtemp(path.join(os.tmpdir(),'awb-relocation-'));
const home=path.join(source,'home'),legacy=path.join(home,'AppData','Workbench'),temp=path.join(source,'temp'),locator=path.join(source,'locator.json'),target=path.join(fixture,'installed-data'),chosen=path.join(source,'chosen-data');
await mkdir(legacy,{recursive:true});await mkdir(temp);await mkdir(legacy+'-attachments');
await writeFile(path.join(legacy,'opaque.bin'),Buffer.from([0,255,21,49]));
await writeFile(path.join(legacy,'state.json'),JSON.stringify({sessions:[{projectPath:legacy+'-attachments',messages:[{text:legacy}]}]}));
await writeFile(path.join(legacy+'-attachments','sentinel'),'attachment');
await build({entryPoints:['packages/app-data/index.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(fixture,'migration.cjs')});
await writeFile(path.join(fixture,'main.cjs'),`const {app}=require('electron');const {initializeAppData}=require('./migration.cjs');app.setPath('home',${JSON.stringify(home)});app.setPath('temp',${JSON.stringify(temp)});app.setPath('userData',${JSON.stringify(legacy)});try{const result=initializeAppData(app,undefined,${JSON.stringify({directory:target,locator})});console.log('RESULT '+JSON.stringify(result));if(!result||process.argv.includes('--once'))app.exit(0);else app.whenReady().then(()=>process.stdin.on('data',()=>app.exit(0)));}catch(e){console.log('RESULT '+JSON.stringify({error:e.message,cause:e.cause?.message}));app.exit(1);}`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
function launch(once=false){const child=spawn(electron,[path.join(fixture,'main.cjs'),...(once?['--once']:[])],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});const exit=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});const result=new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Bootstrap timed out')),30000);child.stdout.on('data',data=>{text+=data;const line=text.split(/\r?\n/).find(v=>v.startsWith('RESULT '));if(line){clearTimeout(timer);resolve(JSON.parse(line.slice(7)));}});child.once('error',e=>{clearTimeout(timer);reject(e);});});return {child,exit,result};}
const missing=async file=>assert.equal(await access(file).then(()=>false,()=>true),true,file);
let active;const checks=[];
try{
 active=launch();let result=await active.result;console.log('Initial bootstrap received');assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.directory,target);
 assert.deepEqual(await readFile(path.join(target,'opaque.bin')),Buffer.from([0,255,21,49]));await missing(legacy);await missing(legacy+'-attachments');await missing(path.join(home,'.agentworkbench'));
 let state=JSON.parse(await readFile(path.join(target,'state.json'),'utf8'));assert.equal(state.sessions[0].projectPath,path.join(target,'attachments'));assert.equal(state.sessions[0].messages[0].text,legacy);checks.push('real Electron first installed startup migrates across volumes and removes legacy aliases');
 const second=launch(true);assert.equal(await second.result,null);await second.exit;checks.push('second process cannot migrate the active profile');active.child.kill();await active.exit;active=undefined;
 await writeFile(locator,JSON.stringify({version:1,directory:target,pending:chosen}));
 for(let i=0;i<2;i++){active=launch(true);result=await active.result;await active.exit;active=undefined;assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.directory,chosen);assert.deepEqual(await readFile(path.join(chosen,'opaque.bin')),Buffer.from([0,255,21,49]));}
 await missing(target);await missing(legacy);await missing(legacy+'-attachments');await missing(chosen+'.migration.json');state=JSON.parse(await readFile(path.join(chosen,'state.json'),'utf8'));assert.equal(state.sessions[0].projectPath,path.join(chosen,'attachments'));checks.push('explicit move, complete exit and repeated restart preserve the chosen drive and content');
 const corrupt='{"version":900,"directory":"unknown"}';await writeFile(locator,corrupt);active=launch(true);result=await active.result;await active.exit;active=undefined;assert.equal(result.error,'APP_DATA_LOCATION_INVALID');assert.equal(await readFile(locator,'utf8'),corrupt);checks.push('unknown locator version stops without erasing data');
 await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,sourceVolume:path.parse(source).root,targetVolume:path.parse(target).root,checks},null,2));for(const check of checks)console.log('PASS '+check);
}finally{if(active){active.child.kill();await active.exit;}}
