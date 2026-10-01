import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as hostBuild } from 'esbuild';
import { build as rendererBuild } from 'vite';
import { mkdir, writeFile, cp, rename } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { encodeZip } from '../packages/native-resources/archive.ts';

// Hidden production host/renderer with approved synthetic plugins and disposable state.
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),output=path.resolve(process.env.AWB_EVENT_QA??path.join(root,'build/qa/runtime-switch/ui-'+Date.now())),appRoot=path.join(output,'app'),dataDir=path.join(output,'data');
await mkdir(appRoot,{recursive:true});
await rendererBuild({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await hostBuild({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
for(const [source,target] of [['vps-workspace-control','workspace-control'],['vps-account-broker','account-runtime']])await cp(path.join(root,'services',source),path.join(appRoot,'host',target),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-native-events-qa',version:'1.0.0',main:'host/main.cjs'}));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:dataDir,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const checks=[],errors=[];
const record=name=>{checks.push(name);console.log('PASS '+name);};
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const until=async predicate=>{for(let n=0;n<240;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Native event QA did not settle');};
const shot=name=>page.screenshot({path:path.join(output,name+'.png')});
const openRecords=()=>page.locator('details.turn-process,details.activity-diagnostics').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
const toggle=(plugin,enabled)=>call('extensions/toggle',{id:plugin.manifest.id,hash:plugin.hash,enabled,...(enabled?{approveHost:true}:{})});
const command=(id,name,payload={})=>call('extensions/command',{id,name,payload});
async function fixture(id,main,renderer){const manifest={schemaVersion:1,apiVersion:1,id,name:id,description:'Synthetic event acceptance only',version:'1.0.0',capabilities:['host'],...(main?{main:'main.mjs'}:{}),...(renderer?{renderer:'renderer.mjs'}:{})};const file=path.join(output,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},...(main?[{name:'main.mjs',data:Buffer.from(main)}]:[]),...(renderer?[{name:'renderer.mjs',data:Buffer.from(renderer)}]:[])]));await call('extensions/import',{filePath:file});return(await call('extensions/list')).find(p=>p.manifest.id===id);}
const harness=`export function activate(api){
 let mode='normal',finish,refreshes=0;
 api.services.intercept('runtime.native-provider','runtimes',()=>['codex','claude']);
 api.services.intercept('models.targets','list',async(next,refresh)=>{if(refresh){refreshes++;await new Promise(r=>setTimeout(r,1600));}return next(refresh);});
 api.useHost(async(request,next)=>{if(request.method==='local-cli/list')return ['codex','claude'].map(runtime=>({runtime,installed:true}));if(request.method==='runtime/choice'){if(mode==='hold')await new Promise(r=>finish=r);if(mode==='fail')throw Error('Synthetic runtime choice failure');}return next();});
 api.registerCommand('mode',p=>{mode=p.mode;});api.registerCommand('release',()=>{finish?.();finish=undefined;});api.registerCommand('refreshes',()=>refreshes);
 api.registerCommand('seed',()=>api.services.get('workbench.state').update(s=>{s.modelConnections=[{id:'fixture',revision:'fixture',name:'Synthetic model',baseUrl:'http://127.0.0.1:1',protocol:'chat-completions',enabled:true,auth:'none',hasKey:false,models:[{id:'model',name:'Synthetic',model:'synthetic',enabled:true}],discoveredModels:[],tools:false,timeoutMs:1000,maxOutputTokens:100}];}));
 api.runtimes.register({apiVersion:1,id:'plugin:qa.switch',name:'Test extension runtime',description:'Synthetic acceptance',permissions:[{value:'default',label:'Default',description:'Synthetic'}],models:[{id:'model',model:'synthetic',name:'Synthetic',isDefault:true,efforts:[],serviceTiers:[]}]},{async discover(){return {ready:true};},async run(){throw Error('No model tasks allowed');},async stop(){}});
}`;
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.getByTestId('composer-runtime').waitFor();};
const choose=async runtime=>{await page.getByTestId('composer-runtime').click();await page.locator('[role=menuitemradio][data-value="'+runtime+'"]').click();};
const isRuntime=async label=>{await until(async()=>await page.getByTestId('composer-runtime').innerText()===label);};
let plugin;
try{
 await launch();assert.equal(await page.getByTestId('load-demo').count(),0);
 await page.getByTestId('composer-input').fill('Retain this draft');assert.equal(await page.getByTestId('prepare-draft').isDisabled(),true);
 plugin=await fixture('qa.runtime-switch',harness);await toggle(plugin,true);await command(plugin.manifest.id,'seed');
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByTestId('composer-runtime').click();await page.locator('[role=menuitemradio][data-value=codex]').waitFor();assert.equal(await page.locator('[role=menuitemradio][data-value=demo]').count(),0);await page.getByTestId('composer-runtime').click();await page.getByRole('menu',{name:'运行时',exact:true}).waitFor({state:'detached'});
 for(const [runtime,label] of [['codex','Codex'],['claude','Claude Code'],['codex','Codex']]){const before=performance.now();await choose(runtime);await isRuntime(label);const elapsed=performance.now()-before;assert.ok(elapsed<1400,'warm choice took '+elapsed+' ms');console.log('TIMING '+runtime+' '+Math.round(elapsed)+' ms');await until(async()=>(await call('state/get')).lastSelectedRuntime===runtime);}
 assert.equal(await command(plugin.manifest.id,'refreshes'),0);assert.equal(await page.getByTestId('composer-input').inputValue(),'Retain this draft');record('both native runtimes switch without remote refresh and retain the unsent draft');
 await command(plugin.manifest.id,'mode',{mode:'hold'});await choose('claude');assert.match(await page.getByTestId('composer-runtime').innerText(),/Claude Code.*切换中/);assert.equal(await page.getByTestId('composer-runtime').isDisabled(),true);assert.equal(await page.getByTestId('prepare-draft').isDisabled(),true);await shot('pending-switch');
 await page.getByTestId('new-session').click();await command(plugin.manifest.id,'release');await isRuntime('Codex');await command(plugin.manifest.id,'mode',{mode:'normal'});record('pending choice immediately shows destination, blocks sends and cannot overwrite a later new chat');
 await command(plugin.manifest.id,'mode',{mode:'fail'});await choose('claude');await isRuntime('Codex');await page.getByText('Synthetic runtime choice failure',{exact:true}).waitFor();await command(plugin.manifest.id,'mode',{mode:'normal'});await choose('claude');await isRuntime('Claude Code');await until(async()=>(await call('state/get')).lastSelectedRuntime==='claude');record('failure restores original selection and retry succeeds');
 await app.close();app=null;await launch();await isRuntime('Claude Code');assert.equal((await call('state/get')).sessions.length,0);record('full hidden Electron restart restores explicit runtime without creating a model task');
 await choose('plugin:qa.switch');await isRuntime('Test extension runtime');await until(async()=>(await call('state/get')).lastSelectedRuntime==='plugin:qa.switch');await toggle(plugin,false);await page.getByTestId('composer-runtime').click();assert.equal(await page.locator('[data-value="plugin:qa.switch"]').count(),0);await page.getByTestId('composer-runtime').click();await page.getByRole('menu',{name:'运行时',exact:true}).waitFor({state:'detached'});assert.equal((await call('state/get')).lastSelectedRuntime,'plugin:qa.switch');await toggle(plugin,true);await isRuntime('Test extension runtime');await page.getByTestId('new-session').click();await isRuntime('Test extension runtime');record('approved runtime registration reaches actual selector and retains preference through disable, reenable and later mount');
 await choose('codex');await isRuntime('Codex');await call('theme/set',{theme:'dark'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(900,700));await page.getByTestId('composer-runtime').click();assert.equal(await page.locator('[role=menuitemradio][data-value=demo]').count(),0);await shot('runtime-menu-dark');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,scope:'Hidden isolated production Electron; synthetic adapters; no real model or SSH tasks'},null,2));
}catch(error){if(page){await shot('failure').catch(()=>{});console.log((await page.locator('body').innerText()).slice(-5000));console.log(await call('extensions/list'));}throw error;}finally{if(app)await app.close();}
