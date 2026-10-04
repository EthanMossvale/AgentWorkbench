import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as hostBuild } from 'esbuild';
import { build as rendererBuild } from 'vite';
import { mkdir, writeFile, cp, appendFile, rename } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { encodeZip } from '../packages/native-resources/archive.ts';
// Host plugins run in the workbench core process; read their test globals there.
const coreEvaluate=(fn,arg)=>app.evaluate((_electron,{source,arg})=>globalThis.__workbenchCoreEvaluate(source,arg),{source:fn.toString(),arg});

// Synthetic isolated production application; no native client, model or user data.
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const output=path.resolve(process.env.AWB_CLAUDE_TITLE_QA??path.join(root,'build/qa/claude-title-'+Date.now()));
const appRoot=path.join(output,'app'),dataDir=path.join(output,'data');
await mkdir(appRoot,{recursive:true});
await rendererBuild({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await hostBuild({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
for(const [source,target] of [['vps-workspace-control','workspace-control'],['vps-account-broker','account-runtime']])await cp(path.join(root,'services',source),path.join(appRoot,'host',target),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-claude-title-qa',version:'1.0.0',main:'host/main.cjs'}));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:dataDir,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const checks=[],errors=[];
const record=name=>{checks.push(name);console.log('PASS '+name);};
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const wait=async predicate=>{for(let n=0;n<200;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Session preview did not settle');};
const shot=name=>page.screenshot({path:path.join(output,name+'.png')});
const toggle=(plugin,enabled)=>call('extensions/toggle',{id:plugin.manifest.id,hash:plugin.hash,enabled,...(enabled?{approveHost:true}:{})});
const importPlugin=async(id,renderer,main)=>{
  const manifest={schemaVersion:1,apiVersion:1,id,name:id,description:'Synthetic acceptance only',version:'1.0.0',capabilities:['host'],...(renderer?{renderer:'renderer.mjs'}:{}),...(main?{main:'main.mjs'}:{})};
  const file=path.join(output,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},...(renderer?[{name:'renderer.mjs',data:Buffer.from(renderer)}]:[]),...(main?[{name:'main.mjs',data:Buffer.from(main)}]:[])]));
  await call('extensions/import',{filePath:file});return(await call('extensions/list')).find(item=>item.manifest.id===id);
};
try{
  app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});
  page=await app.firstWindow();page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
  const cwd=path.join(output,'project'),config=path.join(dataDir,'native-home','.claude');await mkdir(cwd,{recursive:true});
  const folder=path.join(config,'projects',cwd.replace(/[^a-zA-Z0-9]/g,'-'));await mkdir(folder,{recursive:true});
  const ids={one:'11111111-1111-4111-a111-111111111111',two:'22222222-2222-4222-a222-222222222222'};
  for(const nativeId of Object.values(ids))await writeFile(path.join(folder,nativeId+'.jsonl'),JSON.stringify({type:'user',sessionId:nativeId,cwd,isSidechain:false,message:{role:'user',content:'Synthetic native message'}})+'\n');
  const fixture=await importPlugin('qa.claude-title-fixture',null,`export function activate(api){
    const state=api.services.get('workbench.state');api.registerMethod('qa/title-seed',p=>state.update(s=>{s.plugins.translation.enabled=false;s.sessions=Object.entries(p.ids).map(([id,nativeSessionId])=>({id,title:'Fallback '+id,titleSource:'fallback',projectId:null,projectPath:p.cwd,pinned:false,archived:false,group:'',status:'idle',createdAt:'2026-09-30T00:00:00Z',binding:{runtime:'claude',provider:'anthropic',accountRef:'synthetic',executionId:'local-device',egress:'direct-api',nativeSessionId},messages:[{id:'message-'+id,role:'user',original:'Synthetic first user message',submitted:'Synthetic task',timestamp:'2026-09-30T00:00:00Z',demo:true}]}));}));
    api.registerMethod('qa/title-fallback',p=>state.update(s=>{const row=s.sessions.find(s=>s.id===p.id);row.title='Fallback '+p.id;row.titleSource='fallback';}));
  }`);
  await assert.rejects(call('extensions/toggle',{id:fixture.manifest.id,hash:fixture.hash,enabled:true}),/approval/i);await toggle(fixture,true);await call('qa/title-seed',{ids,cwd});
  const select=id=>page.getByTestId('sidebar-session-'+id).locator('.session-select'),preview=page.getByTestId('sidebar-session-preview');
  const reset=async()=>{await page.mouse.move(730,450);await page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());await page.waitForTimeout(250);};
  const show=async id=>{await reset();await select(id).hover({position:{x:40,y:12}});await preview.locator(`[data-workbench-session-preview][data-session-id="${id}"]`).waitFor();};
  assert.deepEqual(await call('session/native-title/refresh',{sessionId:'one'}),{status:'unavailable'});assert.equal(await select('one').innerText(),'Fallback one');
  await appendFile(path.join(folder,ids.one+'.jsonl'),JSON.stringify({sessionId:ids.one,aiTitle:'Original Native Title'})+'\n');
  await show('one');await wait(async()=>(await select('one').innerText())==='Original Native Title');assert.equal(await preview.getByRole('button',{name:'重命名会话标题'}).innerText(),'Original Native Title');await shot('claude-native-title');
  record('actual preview route reads only bound synthetic Claude native metadata and updates sidebar and hover title; missing metadata keeps fallback');
  await preview.getByRole('button',{name:'重命名会话标题'}).click();await preview.getByRole('textbox',{name:'会话标题',exact:true}).fill('用户自己的标题');await preview.getByRole('button',{name:'保存会话标题'}).click();await wait(async()=>(await select('one').innerText())==='用户自己的标题');
  await appendFile(path.join(folder,ids.one+'.jsonl'),JSON.stringify({sessionId:ids.one,aiTitle:'New native name'})+'\n');assert.deepEqual(await call('session/native-title/refresh',{sessionId:'one'}),{status:'protected'});assert.equal(await select('one').innerText(),'用户自己的标题');
  record('inline manual title remains protected from later native metadata');
  const plugin=await importPlugin('qa.claude-title-reader',null,`export function activate(api){
    globalThis.__nativeTitleQA={mode:'value',requests:[]};
    api.registerMethod('qa/title-mode',p=>{globalThis.__nativeTitleQA.mode=p.mode;});
    api.services.override('sessions.native-titles',{read:async request=>{const q=globalThis.__nativeTitleQA;q.requests.push({id:request.nativeSessionId,cwd:request.cwd,configDir:request.configDir});if(q.mode==='delay')return new Promise(resolve=>{q.resolve=resolve;});return {nativeSessionId:request.nativeSessionId,title:'Plugin native title',source:'generated'};}});
  }`);
  await toggle(plugin,true);await show('two');await wait(async()=>(await select('two').innerText())==='Plugin native title');
  const request=await coreEvaluate(()=>globalThis.__nativeTitleQA.requests.at(-1));assert.deepEqual(request,{id:ids.two,cwd,configDir:config});
  record('approved host override reaches production preview consumption with exact native UUID and isolated runtime directory');
  await call('qa/title-fallback',{id:'two'});await call('qa/title-mode',{mode:'delay'});await page.evaluate(()=>{window.__pendingNativeTitle=window.workbench.call('session/native-title/refresh',{sessionId:'two'});});
  await wait(async()=>await coreEvaluate(()=>typeof globalThis.__nativeTitleQA.resolve==='function'));await toggle(plugin,false);await coreEvaluate(({},{id})=>globalThis.__nativeTitleQA.resolve({nativeSessionId:id,title:'Stale disabled title',source:'generated'}),{id:ids.two});assert.deepEqual(await page.evaluate(()=>window.__pendingNativeTitle),{status:'unavailable'});assert.equal(await select('two').innerText(),'Fallback two');
  await appendFile(path.join(folder,ids.two+'.jsonl'),JSON.stringify({sessionId:ids.two,customTitle:'Native restored title'})+'\n');assert.ok(['updated','unchanged'].includes((await call('session/native-title/refresh',{sessionId:'two'})).status));await wait(async()=>(await select('two').innerText())==='Native restored title');
  record('disable discards an outstanding override result and restores real native metadata reading');
  await toggle(plugin,true);const overlay=await importPlugin('qa.claude-title-overlay',null,`export function activate(api){api.services.override('sessions.native-titles',{read:async request=>({nativeSessionId:request.nativeSessionId,title:'Second reader',source:'custom'})});}`);await toggle(overlay,true);
  await call('session/native-title/refresh',{sessionId:'two'});await wait(async()=>(await select('two').innerText())==='Second reader');await toggle(overlay,false);await call('session/native-title/refresh',{sessionId:'two'});await wait(async()=>(await select('two').innerText())==='Plugin native title');
  const broken=await importPlugin('qa.claude-title-broken',null,`export function activate(api){api.services.override('sessions.native-titles',{read:async()=>{throw Error('Should be released');}});throw Error('Synthetic activation failure');}`);await toggle(broken,true);await wait(async()=>!(await call('extensions/list')).find(item=>item.manifest.id===broken.manifest.id).enabled);await call('session/native-title/refresh',{sessionId:'two'});await wait(async()=>(await select('two').innerText())==='Plugin native title');
  record('re-enable and multiple reader layers compose; failed activation restores the surviving implementation');
  await toggle(plugin,false);const relative=path.relative(dataDir,plugin.directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await rename(plugin.directory,path.join(output,'removed-reader'));await page.reload();await page.waitForFunction(()=>!!window.workbench);await show('two');await wait(async()=>(await select('two').innerText())==='Native restored title');assert.equal(await select('one').innerText(),'用户自己的标题');
  record('package removal and reload retain saved manual titles and restore the native reader for later hover instances');
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors,scope:'Hidden isolated Electron; synthetic native files and approved plugins; no model calls, native client changes, real history or remote operations.'},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,output}));
}catch(error){await shot('failure').catch(()=>{});await writeFile(path.join(output,'result.json'),JSON.stringify({passed:false,checks,rendererErrors:errors,error:String(error)},null,2));throw error;}
finally{await app?.close();}
