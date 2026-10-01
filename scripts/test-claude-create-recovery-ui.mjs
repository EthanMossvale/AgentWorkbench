import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build} from 'esbuild';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {encodeZip} from '../packages/native-resources/archive.ts';
import {navigateWorkbench} from './ui-control-helpers.mjs';

// Run only against an explicitly supplied isolated build and a fresh QA profile.
// Production IPC/controller/renderer/service; synthetic SSH responses, no login.
const application=process.env.AWB_QA_APPLICATION,output=process.env.AWB_QA_OUTPUT;
if(!application||!output)throw Error('Explicit isolated application and QA output are required.');
const directory=path.join(output,'profile'),runtime=path.join(output,'native-runtime.cjs'),remote=path.join(output,'remote.json');
await mkdir(output,{recursive:true});
await mkdir(directory,{recursive:true});
await build({entryPoints:['packages/workspace-control/native-runtime.ts'],outfile:runtime,bundle:true,platform:'node',format:'cjs',target:'node22'});
await writeFile(remote,JSON.stringify({revision:3,accounts:[],calls:[],reject:false}));
const host={id:'fixture-admin',name:'账号恢复测试 · 合成环境',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:path.join(output,'unused-key'),knownHostsFile:path.join(output,'unused-hosts'),ownerId:'fixture',workspaceGeneration:'g'};
const manifest={schemaVersion:1,apiVersion:1,id:'qa.create-recovery',name:'Synthetic native account recovery',description:'Disposable transport fixture',version:'1.0.0',capabilities:['host'],main:'main.mjs'};
const source=`import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
const {NativeRuntimeControl}=createRequire(import.meta.url)(${JSON.stringify(runtime)});
export async function activate(api){
 const file=${JSON.stringify(remote)},host=${JSON.stringify(host)},local=${JSON.stringify(directory)};
 const load=async()=>JSON.parse(await readFile(file,'utf8'));
 const save=value=>writeFile(file,JSON.stringify(value));
 const catalog=async()=>{const state=await load();return {source:'native-owner',availability:'ready',authorityId:'fixture',generation:'g',workspaceId:'administrator',revision:state.revision,selectionRevision:0,accounts:state.accounts};};
 const runner=async(_h,_command,options)=>{
  const state=await load(),request=JSON.parse(options.stdin),p=request.params;state.calls.push(request);
  const reply=async value=>{await save(state);return {exitCode:0,signal:null,stderr:'',stdout:JSON.stringify(value)};};
  if(request.method==='runtime/remove'){
   const account=state.accounts.find(a=>a.id===p.accountId);
   if(!account||p.confirm!==true||p.expectedRevision!==state.revision||p.accountGeneration!==account.generation)throw Error('Invalid fixture removal');
   state.accounts=state.accounts.filter(a=>a.id!==p.accountId);state.revision++;return reply({ok:true,value:{removed:p.accountId,accountGeneration:p.accountGeneration}});
  }
  if(request.method!=='runtime/claude-create')throw Error('Unexpected synthetic transport call');
  const id='claude-'+p.requestId,existing=state.accounts.find(a=>a.id===id);
  if(existing)return reply({ok:true,value:existing});
  if(state.reject||p.expectedRevision!==state.revision)return reply({ok:false,error:'STALE_SELECTION'});
  const account={id,provider:'claude',generation:'account-'+(++state.revision),status:'unauthenticated',observedAt:new Date().toISOString()};state.accounts.push(account);return reply({ok:true,value:account});
 };
 const service=new NativeRuntimeControl(local,runner);
 api.services.override('actions.native-accounts',{createClaude:service.createClaude.bind(service),remove:service.remove.bind(service)});
 api.services.override('accounts.catalog',{list:catalog});
 api.services.override('workbench.actions',{discoverWorkspaces:async()=>({hostId:host.id,ownerId:'fixture',generation:'g',observedAt:new Date().toISOString(),effectiveUid:0,privilege:'root',accounts:[],registry:'recognized',publicKeyFingerprints:[],workspaces:[],warnings:[],stateHash:'fixture'})});
 api.registerCommand('seed',async()=>{const current=await catalog();await api.services.get('workbench.state').update(state=>{state.hosts=[host];state.accountCatalogs={[host.id]:current};});});
}`;
const zip=path.join(output,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:directory,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page,plugin;const checks=[],errors=[];
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const state=async()=>JSON.parse(await readFile(remote,'utf8'));
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const open=async()=>{
 app=await electron.launch({executablePath:electronPath,args:[application],cwd:application,env,timeout:45000});
 app.process().stderr?.on('data',data=>console.log('Electron: '+data.toString()));
 console.log('Startup '+JSON.stringify(await app.evaluate(({app,BrowserWindow})=>({path:app.getAppPath(),data:app.getPath('userData'),windows:BrowserWindow.getAllWindows().length,ready:app.isReady()}))));
 page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 await app.evaluate(({session})=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true})));
};
const show=async()=>{
 await page.waitForFunction(()=>['settings-layout','sidebar-footer-menu'].some(id=>{const e=document.querySelector('[data-testid="'+id+'"]');return e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;}));
 await navigateWorkbench(page,'connections');await page.getByTestId('connection-tab-accounts').click();await page.getByTestId('provider-claude').click();await page.getByTestId('claude-create').waitFor();
};
const ready=()=>page.waitForFunction(()=>{const button=document.querySelector('[data-testid="claude-create"]');return button&&!button.disabled;});
const add=async()=>{await page.getByTestId('claude-create').click();await page.locator('[data-testid^="native-state-claude-"]').waitFor();await ready();return (await state()).accounts[0].id;};
const remove=async()=>{await page.getByRole('button',{name:'移除共享账号',exact:true}).click();await page.getByRole('dialog',{name:'移除共享账号'}).getByRole('button',{name:'确认退出并移除',exact:true}).click();await page.getByText('尚未添加 Claude 账号',{exact:true}).waitFor();};
try{
 await open();await call('extensions/import',{filePath:zip});plugin=(await call('extensions/list')).find(p=>p.manifest.id===manifest.id);
 await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:true,approveHost:true});await call('extensions/command',{id:manifest.id,name:'seed',payload:{}});await show();
 const first=await add();await remove();assert.equal((await state()).accounts.length,0);pass('production buttons create and remove through the approved fixture and real recovery service');
 await app.close();app=undefined;await open();await show();
 const second=await add();assert.notEqual(second,first);assert.equal((await state()).calls.length,4);assert.equal(await page.getByTestId('claude-management').getByRole('alert').count(),0);
 await page.screenshot({path:path.join(output,'recreated-after-restart.png')});pass('full process restart preserves the journal and re-add uses a fresh identity without the stale error');
 await remove();const racing=await state();racing.reject=true;await writeFile(remote,JSON.stringify(racing));
 await page.getByTestId('claude-create').click();await page.getByTestId('claude-management').getByRole('alert').getByText('账号目录已变化，请刷新后重新确认。',{exact:true}).waitFor();await ready();
 assert.equal((await state()).calls.length,racing.calls.length+2);assert.equal((await readdir(path.join(directory,'native-account-requests'))).filter(f=>f.endsWith('.json')).length,0);
 pass('a second catalog race stops after one replacement and clears only the definitively rejected recovery record');
 const recovered=await state();recovered.reject=false;await writeFile(remote,JSON.stringify(recovered));await page.getByTestId('claude-refresh').click();await ready();const third=await add();assert.notEqual(third,second);
 assert.equal(await page.getByTestId('claude-management').getByRole('alert').count(),0);pass('explicit refresh and add recover from the bounded conflict without manual profile deletion');
 await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:false});assert.equal((await call('extensions/list')).find(p=>p.manifest.id===manifest.id).enabled,false);
 assert.deepEqual(errors,[]);pass('temporary plugin disables cleanly and the renderer reports no errors');
}finally{
 if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'final-state.png')}).catch(()=>{});
 if(app)await app.close();
 await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,accounts:(await state()).accounts.length,boundary:'Hidden production desktop with approved disposable plugin and synthetic SSH; no real account, login, model or VPS.'},null,2));
}
