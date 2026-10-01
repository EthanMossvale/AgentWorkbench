import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {encodeZip} from '../packages/native-resources/archive.ts';

const root=process.cwd(),output=path.resolve('build/qa/model-switching-ui');
await mkdir(output,{recursive:true});
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:path.join(output,'profile-'+Date.now()),AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:path.join(output,'missing.exe'),AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:path.join(output,'missing.exe')};delete env.ELECTRON_RUN_AS_NODE;
const source=`export function activate(api){
 const state=api.services.get('workbench.state'),context=api.services.get('models.context-state');
 const host={id:'member',name:'Fixture',hostname:'fixture.invalid',port:22,username:'member',role:'workspace',ownerId:'local-owner',workspaceGeneration:'g',identityFile:'unused',knownHostsFile:'unused'};
 const catalog={availability:'ready',source:'native-owner',authorityId:'a',generation:'g',workspaceId:'w',revision:1,selectionRevision:1,selectedAccountId:'c',selectedClaudeAccountId:'a',accounts:[{id:'c',generation:'c',provider:'codex',status:'authenticated',observedAt:'fixture'},{id:'a',generation:'a',provider:'claude',status:'authenticated',observedAt:'fixture'}]};
 const models=['primary','alternate'].map(model=>({id:model,model,name:model==='primary'?'Primary':'Alternate',isDefault:model==='primary',efforts:['low','medium','high','max'],defaultEffort:'medium',serviceTiers:[],...(model==='alternate'?{contextWindow:200000}:{})}));
 const counts={models:0,status:0,targets:0,refresh:0,writes:[]};let hold=false,release,fail=false;
 api.services.override('native.cli',{locate:async()=>({executable:process.execPath,source:'native'}),list:async()=>['claude','codex'].map(runtime=>({runtime,installed:true,version:'synthetic',autoUpdate:false}))});
 api.services.override('accounts.catalog',{list:async()=>structuredClone(catalog)});
 api.services.override('actions.native-accounts',{models:async()=>{counts.models++;return models;},status:async()=>{counts.status++;return {installed:true,authenticated:true,execution:'local-mcp-required',block:null};}});
 api.services.override('actions.native-codex',{supports:(_h,s)=>s.binding.runtime==='codex',models:async()=>{counts.models++;return models;},close:async()=>{}});
 api.services.override('runtime.native-provider',{prepare:async()=>({ready:false})});
 api.services.intercept('workbench.controller','call',async(next,method,payload)=>{
  if(method==='session/prepare-runtime')return {ready:false};
  if(method==='model-targets/list'){counts.targets++;if(payload?.refresh)counts.refresh++;}
  if(method==='session/model'){counts.writes.push(payload.selection);if(hold)await new Promise(resolve=>{release=resolve;});if(fail){fail=false;throw Error('Synthetic model save rejected');}}
  return next(method,payload);
 });
 api.registerCommand('seed',async()=>{await state.update(s=>{s.hosts=[host];s.accountCatalogs={[host.id]:catalog};s.activeWorkspaceId=host.id;s.plugins={translation:{enabled:false}};});const targets=await api.call('model-targets/list',{refresh:true});const chats=[];for(const runtime of ['claude','codex']){const chat=await api.call('session/create',{modelTargetId:targets.find(t=>t.runtime===runtime&&t.selection?.model==='primary').id});chats.push(chat);await state.update(s=>{const c=s.sessions.find(c=>c.id===chat.id);c.title=runtime;c.binding.nativeSessionId='synthetic-'+runtime;context.observe(c,{used:11715,total:11715,capacity:1000000,updatedAt:new Date().toISOString(),turnId:'turn'});});}return chats;});
 api.registerCommand('counts',()=>counts);
 api.registerCommand('hold',()=>{hold=true;});api.registerCommand('release',()=>{const done=release;release=undefined;done?.();});api.registerCommand('unhold',()=>{hold=false;const done=release;release=undefined;done?.();});api.registerCommand('fail',()=>{fail=true;});
 api.registerCommand('noise',()=>state.update(s=>{for(const a of s.accountCatalogs.member.accounts)a.observedAt=new Date().toISOString();s.accountCatalogs.member.revision++;}));
}`;
let app,page,plugin;const checks=[],errors=[];
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const command=(name,payload={})=>call('extensions/command',{id:plugin.manifest.id,name,payload});
const wait=async(check)=>{for(let n=0;n<150;n++){if(await check())return;await new Promise(r=>setTimeout(r,40));}throw Error('Condition timed out');};
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);};
const pass=name=>{checks.push(name);console.log('PASS '+name);};
try{
 await launch();
 const manifest={schemaVersion:1,apiVersion:1,id:'qa.model-switching',name:'Model switching fixture',version:'1.0.0',description:'Isolated acceptance',capabilities:['host'],main:'main.mjs'},file=path.join(output,'plugin.zip');
 await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await call('extensions/import',{filePath:file});plugin=(await call('extensions/list')).find(p=>p.manifest.id===manifest.id);await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:true,approveHost:true});
 const chats=await command('seed');
 for(const chat of chats){
  const get=async()=>(await call('state/get')).sessions.find(s=>s.id===chat.id);
  await page.getByTestId('sidebar-session-'+chat.id).locator('.session-select').click();await wait(async()=>/Primary \(1M\)/.test(await page.getByTestId('model-selector').innerText()));
  await page.getByTestId('model-selector').click();await page.getByTestId('native-effort').waitFor();const initial=await command('counts');
  await command('hold');await page.getByTestId('native-effort').press('End');await wait(async()=>(await command('counts')).writes.length===initial.writes.length+1);
  assert.equal(await page.getByTestId('native-effort').isEnabled(),true);assert.equal(await page.getByTestId('native-effort').inputValue(),'3');assert.equal((await get()).modelSelection.effort,'medium');
  await page.getByTestId('native-effort').press('Home');await page.getByTestId('native-effort').press('ArrowRight');assert.equal(await page.getByTestId('native-effort').inputValue(),'1');
  await command('release');await wait(async()=>(await command('counts')).writes.length===initial.writes.length+2);assert.equal(await page.getByTestId('native-effort').inputValue(),'1');await command('unhold');await wait(async()=>(await get()).modelSelection.effort==='medium');
  await command('hold');await page.getByTestId('current-model-choice').click();await page.getByRole('menuitemradio',{name:'Alternate',exact:true}).click();assert.match(await page.getByTestId('model-selector').innerText(),/Alternate/);assert.equal((await get()).modelSelection.model,'primary');assert.equal(await page.getByTestId('model-selector').isEnabled(),true);
  await wait(async()=>(await command('counts')).writes.length===initial.writes.length+3);await command('unhold');await wait(async()=>(await get()).modelSelection.model==='alternate');
  await page.keyboard.press('Escape');await page.getByTestId('context-ring').click();assert.match(await page.getByRole('tooltip').innerText(),/11,715 \/ 200,000/);assert.match(await page.getByRole('tooltip').innerText(),/沿用上次用量/);await page.keyboard.press('Escape');
  await page.getByTestId('model-selector').click();await page.getByTestId('current-model-choice').click();await page.getByRole('menuitemradio',{name:/Primary/}).click();await wait(async()=>(await get()).modelSelection.model==='primary');await page.keyboard.press('Escape');assert.match(await page.getByTestId('model-selector').innerText(),/\(1M\)/);
  await page.getByTestId('context-ring').click();assert.match(await page.getByRole('tooltip').innerText(),/11,715 \/ 1,000,000/);await page.screenshot({path:path.join(output,chat.binding.runtime+'.png')});await page.keyboard.press('Escape');
  const beforeNoise=await command('counts');await command('noise');await page.getByTestId('model-selector').click();await page.getByTestId('native-effort').waitFor();const afterNoise=await command('counts');assert.equal(afterNoise.models,beforeNoise.models);assert.equal(afterNoise.refresh,beforeNoise.refresh);
  assert.equal(afterNoise.models,initial.models);assert.equal(afterNoise.status,initial.status);
  await command('fail');await page.getByTestId('native-effort').press('End');await page.getByRole('alert').filter({hasText:'Synthetic model save rejected'}).waitFor();await wait(async()=>await page.getByTestId('native-effort').inputValue()==='1');await page.keyboard.press('Escape');
  pass(chat.binding.runtime+': immediate effort feedback, latest choice wins, failure rollback, context/1M roundtrip, no model rediscovery');
 }
 await app.close();app=undefined;await launch();
 for(const chat of chats){await page.getByTestId('sidebar-session-'+chat.id).locator('.session-select').click();await wait(async()=>/\(1M\)/.test(await page.getByTestId('model-selector').innerText()));await page.getByTestId('context-ring').click();assert.match(await page.getByRole('tooltip').innerText(),/11,715 \/ 1,000,000/);await page.keyboard.press('Escape');}
 pass('complete process restart retains both selected models and known context capacity');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(700,700));await page.getByTestId('context-ring').click();const box=await page.getByRole('tooltip').boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=await page.evaluate(()=>innerWidth));await page.screenshot({path:path.join(output,'narrow.png')});pass('narrow layout keeps the context tooltip inside the window');
 assert.deepEqual(errors,[]);
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await app?.close();await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,scope:'Built app and approved isolated plugin; controlled transport/save barriers, no live model task or remote deployment.'},null,2));}
