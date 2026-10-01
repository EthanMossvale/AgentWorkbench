import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import electronPath from 'electron';
import {build as hostBuild} from 'esbuild';
import {build as rendererBuild} from 'vite';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {PluginRegistry} from '../packages/plugins-core/index.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.env.AWB_RECOVERY_QA??path.join(root,'build/qa/plugin-recovery-'+Date.now()));
const appRoot=path.join(output,'app');await mkdir(appRoot,{recursive:true});
if(!process.env.AWB_RECOVERY_REUSE_BUILD){
  await rendererBuild({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
  for(const entry of ['main','preload'])await hostBuild({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
  for(const [source,destination] of [['vps-workspace-control','workspace-control'],['vps-account-broker','account-runtime'],['vps-browser','remote-browser']])await cp(path.join(root,'services',source),path.join(appRoot,'host',destination),{recursive:true,filter:value=>!value.includes('__pycache__')});
  await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-plugin-recovery-qa',version:'0.1.0',main:'host/main.cjs'}));
}
const checks=[],errors=[];let app,mainBrowser,guardBrowser,page,guard,dataDir;
const record=name=>{checks.push(name);console.log('PASS '+name);};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async check=>{for(let i=0;i<160;i++){try{if(await check())return;}catch{}await delay(100);}throw Error('Recovery QA condition did not settle');};
const port=async()=>{const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;};
let mainPort,guardPort;
const connect=async value=>{await until(async()=>(await fetch(`http://127.0.0.1:${value}/json/version`,{signal:AbortSignal.timeout(1000)})).ok);return chromium.connectOverCDP(`http://127.0.0.1:${value}`);};
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const guardCall=method=>guard.evaluate(method=>window.workbench.call('recovery/'+method),method);
async function connectPanel(){guardBrowser=await connect(guardPort);await until(()=>guardBrowser.contexts()[0].pages().length>0);guard=guardBrowser.contexts()[0].pages()[0];await guard.waitForFunction(()=>!!window.workbench);await guard.getByRole('heading',{name:'工作台插件恢复',exact:true}).waitFor();}
async function launch(name,{seed,waitForMain=true}={}){
  dataDir=path.join(output,name);await mkdir(dataDir,{recursive:true});if(seed)await seed(dataDir);
  mainPort=await port();guardPort=await port();
  const env={...process.env,AGENT_WORKBENCH_TEST_DATA:dataDir,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_GUARD_TIMEOUT:'2500',AGENT_WORKBENCH_TEST_APP_PORT:String(mainPort),AGENT_WORKBENCH_TEST_GUARD_PORT:String(guardPort)};delete env.ELECTRON_RUN_AS_NODE;
  // Launch the real process directly: Playwright's Electron owner kills its process tree
  // after a crash, which would invalidate an independent guardian survival test.
  const log=createWriteStream(path.join(dataDir,'synthetic-process.log'));
  const child=spawn(electronPath,[appRoot],{cwd:appRoot,env,stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout.pipe(log);child.stderr.pipe(log);child.on('exit',()=>log.end());app={close:async()=>{if(child.exitCode===null)child.kill();}};
  if(waitForMain){mainBrowser=await connect(mainPort);await until(()=>mainBrowser.contexts()[0].pages().some(p=>p.url().endsWith('index.html')));page=mainBrowser.contexts()[0].pages().find(p=>p.url().endsWith('index.html'));page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>!!window.workbench);await until(async()=>(await call('plugin-recovery/status')).boot==='ready');}
}
async function reconnectAfterRestart(){
  app=null;mainBrowser=await connect(mainPort);await until(()=>mainBrowser.contexts()[0].pages().some(p=>p.url().endsWith('index.html')));page=mainBrowser.contexts()[0].pages().find(p=>p.url().endsWith('index.html'));page.setDefaultTimeout(12000);await page.waitForFunction(()=>!!window.workbench);await until(async()=>(await call('plugin-recovery/status')).boot==='ready');
  await call('plugin-recovery/show');await connectPanel();
}
async function emergencyRestart(action='safe'){
  const oldPort=mainPort;await guard.getByRole('button',{name:action==='safe'?'以安全模式重启':'退出安全模式并重启',exact:true}).click().catch(()=>{});
  await until(async()=>{const ports=JSON.parse(await readFile(path.join(dataDir,'plugin-recovery-test-ports.json'),'utf8'));if(ports.main===oldPort)return false;mainPort=ports.main;guardPort=ports.guardian;return true;});
  void guardBrowser?.close().catch(()=>{});void mainBrowser?.close().catch(()=>{});await reconnectAfterRestart();
}
async function stop(){if((!guard||guard.isClosed())&&guardPort)await connectPanel().catch(()=>{});if(guard&&!guard.isClosed())await guardCall('quit').catch(()=>{});else await app?.close().catch(()=>{});await mainBrowser?.close().catch(()=>{});await guardBrowser?.close().catch(()=>{});app=null;mainBrowser=null;guardBrowser=null;page=null;guard=null;await delay(200);}
async function add(id,source,requires,renderer){
  const manifest={schemaVersion:1,apiVersion:1,id,name:id,description:'Synthetic recovery fixture',version:'1.0.0',capabilities:['host'],...(source?{main:'main.mjs'}:{}),...(renderer?{renderer:'renderer.mjs'}:{}),...(requires?{requires}:{})};
  const file=path.join(output,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},...(source?[{name:'main.mjs',data:Buffer.from(source)}]:[]),...(renderer?[{name:'renderer.mjs',data:Buffer.from(renderer)}]:[])]));await call('extensions/import',{filePath:file});return (await call('extensions/list')).find(p=>p.manifest.id===id);
}
const enable=plugin=>call('extensions/toggle',{id:plugin.manifest.id,hash:plugin.hash,enabled:true,approveHost:true});
async function seedEnabled(directory,id,source,renderer=false){
  const registry=new PluginRegistry(directory);await registry.initialize();const manifest={schemaVersion:1,apiVersion:1,id,name:id,description:'Synthetic fault fixture',version:'1.0.0',capabilities:['host'],[renderer?'renderer':'main']:'entry.mjs'};
  const file=path.join(directory,'fixture.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'entry.mjs',data:Buffer.from(source)}]));await registry.importZip(file);const plugin=(await registry.list())[0];await registry.dispose();await writeFile(path.join(directory,'plugins.json'),JSON.stringify({version:1,entries:{[id]:{hash:plugin.hash,approval:plugin.hash,enabled:true}}}));
}
try{
  await launch('ordinary');await call('plugin-recovery/show');await connectPanel();
  assert.equal((await guardCall('status')).snapshot.boot,'ready');await guard.screenshot({path:path.join(output,'healthy-panel.png')});record('independent core panel is callable before installing any plugin');
  const failure=await add('qa.host-failure','export function activate(){throw Error("PRIVATE_FIXTURE_SENTINEL");}');await enable(failure);
  await until(async()=>(await guardCall('status')).snapshot.incidents.some(i=>i.id===failure.manifest.id&&i.certainty==='confirmed'));
  assert.doesNotMatch(JSON.stringify(await guardCall('status')),/PRIVATE_FIXTURE_SENTINEL/);assert.equal((await call('state/get')).schemaVersion!==null,true);
  await guard.locator('#issues h2').filter({hasText:failure.manifest.id}).waitFor();
  await guard.screenshot({path:path.join(output,'host-failure-light.png')});await guard.emulateMedia({colorScheme:'dark'});await guard.setViewportSize({width:460,height:680});await guard.screenshot({path:path.join(output,'host-failure-dark-narrow.png'),fullPage:true});record('caught host failure names the plugin, retains core startup and excludes raw error secrets');
  const provider=await add('qa.contract-provider','export function activate(api){api.services.register("qa.current",{readNew:()=>42},{version:2,adapters:[{version:1,members:{readOld:"readNew"}}]});}');await enable(provider);
  const old=await add('qa.old-api','export async function activate(api){await new Promise(r=>setTimeout(r,6000));const service=api.services.get("qa.current");api.registerCommand("ping",()=>service.readOld());}',{services:[{id:'qa.current',version:1,members:['readOld']}]});await enable(old);
  await until(async()=>(await guardCall('status')).snapshot.incidents.some(i=>i.id===old.manifest.id&&i.repairable));await guard.locator('#issues h2').filter({hasText:old.manifest.id}).waitFor();await guard.screenshot({path:path.join(output,'compatibility-repair.png'),fullPage:true});
  const failedAfterAdapter=await add('qa.adapter-fails','export async function activate(){await new Promise(r=>setTimeout(r,6000));throw Error("PRIVATE_BATCH_SENTINEL");}',{services:[{id:'qa.current',version:1,members:['readOld']}]});await enable(failedAfterAdapter);
  const otherOld=await add('qa.other-old','export function activate(api){api.registerCommand("ping",()=>api.services.get("qa.current").readOld()+1);}',{services:[{id:'qa.current',version:1,members:['readOld']}]});await enable(otherOld);
  const unsupported=await add('qa.no-adapter','export function activate(){}',{services:[{id:'qa.current',version:99,members:['missingMethod']}]});await enable(unsupported);
  await guard.getByRole('button',{name:'一键修复兼容问题',exact:true}).click();assert.equal(await guard.locator('#safe').isEnabled(),true);
  await guard.getByRole('alert').filter({hasText:'已应用 2 项兼容适配，仍有 3 个故障目标需检查'}).waitFor({timeout:30000});
  assert.equal(await call('extensions/command',{id:old.manifest.id,name:'ping'}),42);assert.equal(await call('extensions/command',{id:otherOld.manifest.id,name:'ping'}),43);
  const batchNotice=await guard.getByRole('alert').textContent();assert.match(batchNotice,/qa.adapter-fails：适配失败/);assert.match(batchNotice,/qa.no-adapter：无可验证适配/);assert.doesNotMatch(batchNotice,/已应用全部/);
  await guard.setViewportSize({width:780,height:730});await guard.emulateMedia({colorScheme:'light'});await guard.screenshot({path:path.join(output,'batch-partial-repair.png'),fullPage:true});
  record('one click repairs two plugins, continues after a third fails, and reports unsupported faults without claiming full success');
  record('batch longer than ten seconds keeps its result channel and emergency safe-mode button available');
  const middleware=await add('qa.recovery-blocker','export function activate(api){api.useHost(async(request,next)=>request.method.startsWith("plugin-recovery/")?new Promise(()=>{}):next());api.services.override("extensions.recovery",{repair:()=>new Promise(()=>{}),show:()=>({shown:false})});}');await enable(middleware);assert.equal((await call('plugin-recovery/status')).safeMode,false);assert.equal((await call('plugin-recovery/show')).shown,true);record('core recovery bypasses hostile middleware and replacement of ordinary recovery services');

  await until(async()=>(await guardCall('status')).snapshot.incidents.some(i=>i.id===unsupported.manifest.id&&!i.repairable));
  assert.equal(await guard.locator('#copy + #copy-repair').count(),1);
  await guard.getByRole('button',{name:'复制诊断信息',exact:true}).click();await guard.getByRole('alert').filter({hasText:'诊断信息已复制'}).waitFor();await assert.rejects(readFile(path.join(dataDir,'plugin-repair-draft.json')),error=>error.code==='ENOENT');
  const choiceBefore=JSON.stringify((await call('state/get')).lastModelSelection);
  await guard.getByRole('button',{name:'复制诊断并准备 Agent 修复草稿',exact:true}).click();
  await until(async()=>{await readFile(path.join(dataDir,'plugin-repair-draft.json'),'utf8');return true;});
  const pendingDraft=JSON.parse(await readFile(path.join(dataDir,'plugin-repair-draft.json'),'utf8'));assert.match(pendingDraft.text,/请检查并修复/);assert.match(pendingDraft.text,/qa.no-adapter/);assert.match(pendingDraft.text,/qa.host-failure/);assert.match(pendingDraft.text,/qa.adapter-fails/);assert.match(pendingDraft.text,/不要只修第一个/);assert.doesNotMatch(pendingDraft.text,/PRIVATE_BATCH_SENTINEL/);assert.match(pendingDraft.text,/SERVICE_CONTRACT_UNSUPPORTED/);assert.match(pendingDraft.text,/qa.current/);
  assert.equal(await call('plugin-recovery/repair-draft'),null);assert.equal((await call('state/get')).sessions.length,0);assert.equal(await page.getByTestId('composer-input').inputValue(),'');
  record('unrepairable compatibility exposes a user-requested Chinese repair draft beside diagnostic copy without starting a session');
  const preferenceBefore=await readFile(path.join(dataDir,'plugins.json'),'utf8');
  const native=path.join(dataDir,'native-home/.claude/settings.json');await mkdir(path.dirname(native),{recursive:true});const nativeValue=JSON.stringify({enabledPlugins:{'official@example':true}});await writeFile(native,nativeValue);
  await emergencyRestart();assert.equal((await call('plugin-recovery/status')).safeMode,true);await page.locator('[data-plugin-recovery=safe-mode]').waitFor();assert.ok((await call('extensions/list')).every(p=>!p.enabled));assert.equal(await readFile(path.join(dataDir,'plugins.json'),'utf8'),preferenceBefore);assert.equal(await readFile(native,'utf8'),nativeValue);await page.screenshot({path:path.join(output,'safe-mode-shell.png')});record('emergency restart enters the actual base shell and preserves third-party preferences and native official settings');
  await until(async()=>await page.getByTestId('composer-input').inputValue()===pendingDraft.text);
  await until(async()=>await call('plugin-recovery/repair-draft')===null);assert.equal((await call('state/get')).sessions.length,0);await page.screenshot({path:path.join(output,'safe-mode-repair-draft.png')});
  await page.getByTestId('composer-input').fill(pendingDraft.text+'\n用户补充');await delay(1300);assert.ok((await page.getByTestId('composer-input').inputValue()).endsWith('用户补充'));
  await page.reload();await until(async()=>(await call('plugin-recovery/status')).boot==='ready');await delay(1300);assert.equal(await page.getByTestId('composer-input').inputValue(),'');assert.equal((await call('state/get')).sessions.length,0);
  await page.evaluate(()=>{document.documentElement.lang='ja';});await until(async()=>JSON.parse(await readFile(path.join(dataDir,'plugin-recovery-language.json'),'utf8')).language==='en');
  await guard.getByRole('button',{name:'复制诊断并准备 Agent 修复草稿',exact:true}).click();await until(async()=>(await page.getByTestId('composer-input').inputValue()).startsWith('Inspect and repair'));assert.equal((await call('state/get')).sessions.length,0);
  assert.equal(JSON.stringify((await call('state/get')).lastModelSelection),choiceBefore);
  await page.getByTestId('model-selector').click();await page.getByRole('dialog',{name:'模型与思考设置',exact:true}).waitFor();assert.equal(await page.getByTestId('composer-input').inputValue(),JSON.parse(await readFile(path.join(dataDir,'plugin-repair-draft.json'),'utf8')).text);await page.keyboard.press('Escape');
  record('safe-mode draft is editable, acknowledged after insertion, never resent on reload, and uses English for non-Chinese UI');
  await emergencyRestart('normal');assert.equal((await call('plugin-recovery/status')).safeMode,false);assert.equal(await call('extensions/command',{id:old.manifest.id,name:'ping'}),42);assert.equal(await call('extensions/command',{id:otherOld.manifest.id,name:'ping'}),43);assert.ok(!(await call('plugin-recovery/status')).incidents.some(i=>i.id===old.manifest.id&&i.phase==='compatibility'));record('explicit normal restart restores approved plugins and the saved compatibility adapter');await stop();
  await launch('repair-loop');await call('plugin-recovery/show');await connectPanel();
  await enable(await add('qa.loop-provider','export function activate(api){api.services.register("qa.loop",{readNew:()=>42},{version:2,adapters:[{version:1,members:{readOld:"readNew"}}]});}'));
  await enable(await add('qa.repair-loop','export function activate(){while(true){}}',{services:[{id:'qa.loop',version:1,members:['readOld']}]}));
  await guard.getByRole('button',{name:'一键修复兼容问题',exact:true}).click();await until(async()=>(await guardCall('status')).hung);assert.equal(await guard.locator('#safe').isEnabled(),true);
  await emergencyRestart();assert.equal((await call('plugin-recovery/status')).safeMode,true);assert.ok((await call('extensions/list')).every(plugin=>!plugin.enabled));record('safe restart remains executable when a compatibility repair itself enters an infinite loop');await stop();
  await launch('host-loop',{waitForMain:false,seed:directory=>seedEnabled(directory,'qa.host-loop','export function activate(){while(true){}}')});await connectPanel();await until(async()=>(await guardCall('status')).hung);
  assert.ok((await guardCall('status')).snapshot.incidents.some(i=>i.id==='qa.host-loop'&&i.certainty==='suspected'));await guard.screenshot({path:path.join(output,'host-loop-independent-panel.png')});record('independent guardian remains responsive during a real main-process infinite loop');
  await emergencyRestart();assert.equal((await call('plugin-recovery/status')).safeMode,true);assert.equal((await call('extensions/list'))[0].enabled,false);record('safe restart terminates only the hung synthetic workbench and prevents its plugin from running again');await stop();
  await launch('renderer-loop',{waitForMain:false,seed:directory=>seedEnabled(directory,'qa.renderer-loop','export function activate(){while(true){}}',true)});await connectPanel();await until(async()=>(await guardCall('status')).snapshot.incidents.some(i=>i.code==='PLUGIN_RENDERER_UNRESPONSIVE'));await guard.screenshot({path:path.join(output,'renderer-loop-independent-panel.png')});record('renderer heartbeat loss is diagnosed even while the main process continues responding');
  await emergencyRestart();assert.equal((await call('plugin-recovery/status')).safeMode,true);record('renderer infinite loop also recovers to a usable safe-mode shell');await stop();
  await launch('startup-middleware',{waitForMain:false,seed:directory=>seedEnabled(directory,'qa.startup-blocker','export function activate(api){api.useHost(async(request,next)=>request.method==="state/get"?new Promise(()=>{}):next());}')});await connectPanel();await until(async()=>(await guardCall('status')).snapshot.incidents.some(i=>i.code==='WORKBENCH_STARTUP_INCOMPLETE'&&i.id==='qa.startup-blocker'));record('incomplete core startup diagnoses pending plugin middleware even with healthy heartbeats');await emergencyRestart();await stop();
  await launch('process-exit',{waitForMain:false,seed:directory=>seedEnabled(directory,'qa.exit','export function activate(){process.exit(27);}')}).catch(()=>{});await connectPanel();await until(async()=>(await guardCall('status')).disconnected);assert.ok((await guardCall('status')).snapshot.incidents.some(i=>i.id==='qa.exit'));record('guardian survives a native process exit and retains the last observed plugin identity');await emergencyRestart();await stop();
  await launch('corrupt-prefs',{seed:directory=>writeFile(path.join(directory,'plugins.json'),'{corrupt')});await connectPanel();assert.ok((await guardCall('status')).snapshot.incidents.some(i=>i.code==='PLUGIN_PREFERENCES_INVALID'));assert.equal(await readFile(path.join(dataDir,'plugins.json'),'utf8'),'{corrupt');record('corrupt preferences show a diagnosis without preventing base startup or replacing the damaged file');await stop();
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,output}));
}catch(error){await guard?.screenshot({path:path.join(output,'failure-panel.png')}).catch(()=>{});await writeFile(path.join(output,'result.json'),JSON.stringify({passed:false,checks,rendererErrors:errors,error:String(error)},null,2));throw error;}
finally{await stop();}
