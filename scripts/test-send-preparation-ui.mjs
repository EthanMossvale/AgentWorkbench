import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as buildHost} from 'esbuild';
import {build as buildRenderer} from 'vite';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {StateStore} from '../apps/desktop/host/store.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';

const root=process.cwd(),output=path.join(root,'build/qa/send-preparation-ui-'+Date.now()),appRoot=path.join(output,'app'),profile=path.join(output,'profile');
await mkdir(appRoot,{recursive:true});
await buildRenderer({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'error'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-send-preparation-qa',version:'0.1.0',main:'host/main.cjs'}));
const store=new StateStore(profile);await store.load();await store.update(s=>{s.plugins={translation:{enabled:false}};s.sessions=[{id:'fixture',projectId:null,projectPath:output,title:'Send preparation fixture',createdAt:new Date().toISOString(),status:'idle',messages:[],pinned:false,archived:false,group:'',binding:{runtime:'demo',provider:'demo',accountRef:'demo',executionId:'local-device',egress:'demo'}}];});
const source=`export function activate(api){const state=api.services.get('workbench.state'),recovery=api.services.get('composer.recovery');api.registerCommand('pending',()=>state.update(s=>{const session=s.sessions.find(s=>s.id==='fixture');recovery.capture(session,{id:'prepared-input',original:'Visible immediately while the native process starts.',translated:'Visible immediately while the native process starts.',revision:1,sourceHash:'fixture',demo:false,bypass:true});session.status='running';}));api.registerCommand('accepted',()=>state.update(s=>{const session=s.sessions.find(s=>s.id==='fixture');session.messages.push({...recovery.pendingMessages(session,new Date().toISOString())[0],delivery:undefined});session.status='idle';}));}`;
const manifest={schemaVersion:1,apiVersion:1,id:'qa.send-preparation',name:'Send preparation QA',description:'Synthetic pending-input presentation',version:'1.0.0',capabilities:['host'],main:'main.mjs'},zip=path.join(output,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.execPath,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.workbench);
 const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
 await page.getByText('Send preparation fixture',{exact:true}).first().click();await call('extensions/import',{filePath:zip});const plugin=(await call('extensions/list')).find(p=>p.manifest.id===manifest.id);await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:true,approveHost:true});
 const command=name=>call('extensions/command',{id:manifest.id,name});
 await command('pending');await page.getByText('Visible immediately while the native process starts.',{exact:true}).first().waitFor();await page.getByText('已提交，等待原生接收',{exact:true}).waitFor();
 assert.equal(JSON.parse(await readFile(path.join(profile,'state.json'),'utf8')).sessions[0].messages.length,0);
 await page.screenshot({path:path.join(output,'pending.png')});
 await command('accepted');await page.getByText('实际提交文本',{exact:true}).waitFor();assert.equal((await call('state/get')).sessions[0].messages.length,1);assert.equal(await page.getByText('已提交，等待原生接收',{exact:true}).count(),0);
 await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:false});await app.close();app=undefined;
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});const restarted=await app.firstWindow();await restarted.waitForFunction(()=>!!window.workbench);const restored=await restarted.evaluate(()=>window.workbench.call('state/get'));assert.equal(restored.sessions[0].messages.length,1);assert.equal(restored.sessions[0].draftRecoveries.length,0);
 console.log('PASS hidden desktop pending input, receipt deduplication, plugin disable, complete process restart; '+output);
}finally{await app?.close();}
