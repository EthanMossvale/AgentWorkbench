import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as hostBuild } from 'esbuild';
import { build as rendererBuild } from 'vite';
import { mkdir, writeFile, cp, rename } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { encodeZip } from '../packages/native-resources/archive.ts';

// Isolated hidden production application. Never contacts models or reads user history.
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const output=path.resolve(process.env.AWB_SESSION_HOVER_QA??path.join(root,'build/qa/session-hover-'+Date.now()));
const appRoot=path.join(output,'app'),dataDir=path.join(output,'data');
await mkdir(appRoot,{recursive:true});
await rendererBuild({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await hostBuild({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
for(const [source,target] of [['vps-workspace-control','workspace-control'],['vps-account-broker','account-runtime']])await cp(path.join(root,'services',source),path.join(appRoot,'host',target),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-session-hover-qa',version:'1.0.0',main:'host/main.cjs'}));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:dataDir,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const checks=[],failures=[],errors=[];
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const wait=async predicate=>{for(let n=0;n<100;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Hover state did not settle');};
const shot=name=>page.screenshot({path:path.join(output,name+'.png')});
const check=async(name,fn)=>{try{await fn();checks.push(name);console.log('PASS '+name);}catch(error){failures.push({name,error:String(error)});console.log('FAIL '+name+': '+error);await shot('failure-'+failures.length);}};
const toggle=(plugin,enabled)=>call('extensions/toggle',{id:plugin.manifest.id,hash:plugin.hash,enabled,...(enabled?{approveHost:true}:{})});
const importPlugin=async(id,renderer,main)=>{
  const manifest={schemaVersion:1,apiVersion:1,id,name:id,description:'Synthetic hover acceptance only',version:'1.0.0',capabilities:['host'],...(renderer?{renderer:'renderer.mjs'}:{}),...(main?{main:'main.mjs'}:{})};
  const file=path.join(output,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},...(renderer?[{name:'renderer.mjs',data:Buffer.from(renderer)}]:[]),...(main?[{name:'main.mjs',data:Buffer.from(main)}]:[])]));
  await call('extensions/import',{filePath:file});return(await call('extensions/list')).find(item=>item.manifest.id===id);
};
try{
  app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});
  page=await app.firstWindow();page.setDefaultTimeout(3500);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
  const fixture=await importPlugin('qa.hover-fixture',null,`export function activate(api){
    const state=api.services.get('workbench.state');
    api.registerMethod('qa/seed',()=>state.update(s=>{s.plugins.translation.enabled=false;s.sessions=['one','two','three'].map((id,i)=>({id,title:'Conversation '+id,titleSource:'fallback',projectId:null,pinned:false,archived:false,group:'',status:'idle',createdAt:'2026-09-29T00:00:00Z',binding:{runtime:'demo',provider:'offline',accountRef:'fixture',executionId:'local-device',egress:'demo'},messages:[{id:'message-'+id,role:'user',original:'Synthetic first message. '.repeat(100),submitted:'Synthetic input',timestamp:'2026-09-29T00:00:00Z',demo:true}]}));}));
    api.registerMethod('qa/native-title',p=>state.update(s=>api.services.get('sessions.presentation').nativeTitle(s.sessions.find(row=>row.id===p.id),p.title)));
  }`);
  await assert.rejects(call('extensions/toggle',{id:fixture.manifest.id,hash:fixture.hash,enabled:true}),/approval/i);await toggle(fixture,true);await call('qa/seed');
  const row=id=>page.getByTestId('sidebar-session-'+id),select=id=>row(id).locator('.session-select');
  const preview=page.getByTestId('sidebar-session-preview');
  const current=()=>preview.locator('[data-workbench-session-preview]').getAttribute('data-session-id');
  const reset=async()=>{await page.mouse.move(730,450);await page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());await page.keyboard.press('Escape');await page.waitForTimeout(250);};
  const show=async(id='one')=>{await select(id).hover({position:{x:40,y:12}});await preview.locator(`[data-workbench-session-preview][data-session-id="${id}"]`).waitFor();};
  await call('theme/set',{theme:'light'});
  await check('quick action to title rearms hover inside the same row',async()=>{
    await reset();await show();await page.getByTestId('quick-pin-one').hover();await preview.waitFor({state:'detached'});await show();
  });
  await check('unrelated conversation scrolling does not dismiss preview',async()=>{
    await reset();await show();await page.locator('.main-panel').evaluate(el=>el.dispatchEvent(new Event('scroll',{bubbles:false})));await page.waitForTimeout(250);assert.equal(await preview.isVisible(),true);
  });
  await check('selecting the hovered conversation keeps its preview',async()=>{
    await reset();await show('two');await select('two').click({position:{x:40,y:12}});await page.waitForTimeout(450);assert.equal(await preview.isVisible(),true);assert.equal(await current(),'two');
  });
  await check('right arrow opens immediately before the hover delay',async()=>{
    await reset();await select('one').focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);assert.equal(await preview.evaluate(el=>el===document.activeElement),true);assert.equal(await preview.locator('.session-preview-body').getAttribute('data-expanded'),'true');
  });
  await check('focused card survives pointer leave and Escape returns focus without reopening',async()=>{
    await reset();await select('one').focus();await preview.waitFor();await page.keyboard.press('ArrowRight');await preview.hover();await page.mouse.move(730,450);await page.waitForTimeout(400);assert.equal(await preview.isVisible(),true);await page.keyboard.press('Escape');await preview.waitFor({state:'detached'});await page.waitForTimeout(400);assert.equal(await select('one').evaluate(el=>el===document.activeElement),true);assert.equal(await preview.count(),0);
  });
  await check('rapid row switching cancels obsolete opens and closes',async()=>{
    await reset();await show();await select('two').hover({position:{x:40,y:12}});await page.waitForTimeout(100);await select('one').hover({position:{x:40,y:12}});await page.waitForTimeout(450);assert.equal(await current(),'one');await reset();await select('two').hover();await select('three').hover();await preview.locator('[data-session-id="three"][data-workbench-session-preview]').waitFor();
  });
  // Baseline mode records the reported defects without assuming the new editor exists.
  if(!process.env.AWB_SESSION_HOVER_BASELINE){
    const title=()=>preview.getByRole('button',{name:'重命名会话标题',exact:true});
    const input=()=>preview.getByRole('textbox',{name:'会话标题',exact:true});
    await check('mouse can cross a quick action on the way into the title',async()=>{
      await reset();await show();const pin=await page.getByTestId('quick-pin-one').boundingBox();await page.mouse.move(pin.x+6,pin.y+6);await page.waitForTimeout(60);await title().hover();await page.waitForTimeout(300);assert.equal(await preview.isVisible(),true);
    });
    await check('mouse transfer reaches title and explicit click saves a protected manual title',async()=>{
      await reset();await show();await title().click();await input().fill('鼠标修改的会话标题');await page.mouse.move(730,450);await page.waitForTimeout(350);assert.equal(await input().isVisible(),true);await preview.getByRole('button',{name:'保存会话标题'}).click();await wait(async()=>(await select('one').innerText())==='鼠标修改的会话标题');const session=(await call('state/get')).sessions.find(s=>s.id==='one');assert.equal(session.titleSource,'manual');await call('qa/native-title',{id:'one',title:'Must not replace manual title'});assert.equal((await call('state/get')).sessions.find(s=>s.id==='one').title,session.title);await shot('title-renamed-light');
    });
    await check('IME Enter does not save; Escape cancels just the edit',async()=>{
      await reset();await show();await title().click();await input().fill('未提交的输入法标题');await input().evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true})));await page.waitForTimeout(200);assert.equal(await input().isVisible(),true);assert.equal((await call('state/get')).sessions.find(s=>s.id==='one').title,'鼠标修改的会话标题');await page.keyboard.press('Escape');await title().waitFor();assert.equal(await preview.isVisible(),true);assert.equal(await title().innerText(),'鼠标修改的会话标题');
    });
    await check('empty titles validate locally and keyboard Enter saves valid titles',async()=>{
      await title().click();await input().fill('   ');await page.keyboard.press('Enter');await preview.getByRole('alert').waitFor();assert.equal(await input().getAttribute('maxlength'),'150');await input().fill('Keyboard title');await page.keyboard.press('Enter');await wait(async()=>(await select('one').innerText())==='Keyboard title');
    });
    await check('composer arrow keys are not stolen by a pointer-only preview',async()=>{
      await reset();await select('one').click({position:{x:40,y:12}});const composer=page.locator('.composer-area textarea').first();await composer.fill('abc');await composer.focus();await composer.evaluate(el=>el.setSelectionRange(0,0));await show('two');await page.keyboard.press('ArrowRight');assert.equal(await composer.evaluate(el=>el===document.activeElement&&el.selectionStart===1),true);
    });
    await check('sidebar scrolling dismisses a misplaced preview and hover can reopen it',async()=>{
      await reset();await show();await page.locator('.sidebar').evaluate(el=>el.dispatchEvent(new Event('scroll',{bubbles:false})));await preview.waitFor({state:'detached'});await reset();await show();
    });
    await check('failed and late title saves stay scoped to the initiating card',async()=>{
      const interceptor=await importPlugin('qa.hover-save',null,`export function activate(api){let mode='fail';api.registerMethod('qa/save-mode',p=>{mode=p.mode;});api.useHost(async(request,next)=>{if(request.method==='session/update'&&request.payload.title){if(mode==='fail')throw Error('Synthetic save failure');if(mode==='delay')await new Promise(resolve=>{globalThis.__finishHoverSave=resolve;});}return next();});}`);
      await toggle(interceptor,true);await title().click();await input().fill('Delayed title');await page.keyboard.press('Enter');await preview.getByRole('alert').waitFor();assert.match(await preview.getByRole('alert').innerText(),/保存失败/);assert.equal(await input().inputValue(),'Delayed title');await call('qa/save-mode',{mode:'delay'});await page.keyboard.press('Enter');await wait(()=>input().getAttribute('readonly').then(v=>v!==null));await reset();await show('two');await app.evaluate(()=>globalThis.__finishHoverSave());await wait(async()=>(await select('one').innerText())==='Delayed title');assert.equal(await current(),'two');assert.equal(await preview.locator('input').count(),0);await toggle(interceptor,false);
    });
    const renderer=`export function activate(api){const q=window.__hoverPlugin={mounted:0,cleaned:0,pending:[],lateCleaned:0};
      api.observeSurfaces('session-preview-title','after',async({root})=>{root.textContent='附加标题';await new Promise(r=>q.pending.push(r));return()=>q.lateCleaned++;});
      api.observeSurfaces('session-preview-title','replace',({root,target})=>{q.mounted++;const button=document.createElement('button');button.textContent='插件改名';button.dataset.qaRename='1';button.onclick=()=>api.call('session/update',{id:target.dataset.sessionId,title:'Plugin title '+target.dataset.sessionId});root.append(button);return()=>q.cleaned++;});}`;
    const plugin=await importPlugin('qa.hover-title',renderer);
    await check('approved plugin replaces a mounted title and invokes the actual rename route',async()=>{
      await reset();await show();await preview.hover();await toggle(plugin,true);await preview.locator('[data-qa-rename]').click();await wait(async()=>(await select('one').innerText())==='Plugin title one');assert.equal(await preview.locator('[data-workbench-session-preview-title]').evaluate(el=>el.hidden),true);
    });
    await check('later title instances and asynchronous cleanup restore the core on disable',async()=>{
      await reset();await show('two');await preview.locator('[data-qa-rename]').click();await wait(async()=>(await select('two').innerText())==='Plugin title two');await toggle(plugin,false);await title().waitFor();await page.evaluate(()=>window.__hoverPlugin.pending.splice(0).forEach(r=>r()));await wait(async()=>await page.evaluate(()=>window.__hoverPlugin.lateCleaned===2));assert.deepEqual(await page.evaluate(()=>[window.__hoverPlugin.mounted,window.__hoverPlugin.cleaned]),[2,2]);assert.equal(await title().innerText(),'Plugin title two');
    });
    await check('re-enable, multiple title replacements and mount failure recover the editor',async()=>{
      await toggle(plugin,true);await preview.locator('[data-qa-rename]').waitFor();const overlay=await importPlugin('qa.hover-overlay',`export function activate(api){api.observeSurfaces('session-preview-title','replace',({root})=>{root.dataset.qaOverlay='1';root.textContent='Second title plugin';});}`);await toggle(overlay,true);await preview.locator('[data-qa-overlay]').waitFor();assert.equal(await preview.locator('[data-qa-rename]').isVisible(),false);await toggle(overlay,false);await preview.locator('[data-qa-rename]').waitFor({state:'visible'});const broken=await importPlugin('qa.hover-broken',`export function activate(api){api.observeSurfaces('session-preview-title','replace',()=>{throw Error('Synthetic title mount failure');});}`);await toggle(broken,true);await wait(async()=>!(await call('extensions/list')).find(p=>p.manifest.id===broken.manifest.id).enabled);await preview.locator('[data-qa-rename]').waitFor({state:'visible'});await toggle(plugin,false);await title().waitFor();await page.evaluate(()=>window.__hoverPlugin.pending.splice(0).forEach(r=>r()));await title().click();await input().fill('Restored core editor');await preview.getByRole('button',{name:'保存会话标题'}).click();await wait(async()=>(await select('two').innerText())==='Restored core editor');
    });
    await check('removing the disabled synthetic package and reloading retains core rename and saved titles',async()=>{
      const relative=path.relative(dataDir,plugin.directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
      await rename(plugin.directory,path.join(output,'removed-title-plugin'));await page.reload();await page.waitForFunction(()=>!!window.workbench);assert.equal((await call('extensions/list')).some(p=>p.manifest.id===plugin.manifest.id),false);await reset();await show('two');await title().click();await input().fill('After plugin removal');await page.keyboard.press('Enter');await wait(async()=>(await select('two').innerText())==='After plugin removal');
    });
    await check('dark narrow-window editor remains readable and inside the viewport',async()=>{
      await reset();await call('theme/set',{theme:'dark'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));await show();await title().click();await input().fill('一个需要检查输入框与确认按钮是否完整显示的标题');await shot('title-editor-dark-narrow');assert.equal(await preview.evaluate(el=>{const r=el.getBoundingClientRect();return r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight||el.scrollWidth>el.clientWidth;}),false);await preview.getByRole('button',{name:'取消重命名'}).click();
    });
  }
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'result.json'),JSON.stringify({passed:!failures.length,checks,failures,rendererErrors:errors,scope:'Isolated hidden Electron and approved synthetic plugins; no real model, client, history or remote operations.'},null,2));
  assert.deepEqual(failures,[]);console.log(JSON.stringify({passed:true,checks:checks.length,output}));
}finally{await app?.close();}
