import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as buildHost} from 'esbuild';
import {build as buildRenderer} from 'vite';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {StateStore} from '../apps/desktop/host/store.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';

const root=process.cwd(),output=path.join(root,'build/qa/interaction-latency-ui-'+Date.now()),appRoot=path.join(output,'app'),profile=path.join(output,'profile');
await mkdir(appRoot,{recursive:true});
await buildRenderer({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'error'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-send-preparation-qa',version:'0.1.0',main:'host/main.cjs'}));
const store=new StateStore(profile);await store.load();await store.update(s=>{s.plugins={translation:{enabled:false}};s.sessions=[{id:'fixture',projectId:null,projectPath:output,title:'Send preparation fixture',createdAt:new Date().toISOString(),status:'idle',messages:[],pinned:false,archived:false,group:'',binding:{runtime:'demo',provider:'demo',accountRef:'demo',executionId:'local-device',egress:'demo'}}];});
const source=`export function activate(api){const state=api.services.get('workbench.state');let release,waiting=false,fail=false;
api.services.intercept('workbench.controller','call',async(next,method,payload)=>{if(method!=='draft/submit')return next(method,payload);waiting=true;await new Promise(r=>release=r);waiting=false;if(fail)throw Error('SYNTHETIC_SUBMIT_FAILURE');return next(method,payload);});
api.registerCommand('waiting',()=>waiting);api.registerCommand('release',value=>{fail=value.fail;release();});
api.registerCommand('stream',async()=>{for(let i=0;i<80;i++){await state.update(s=>{const session=s.sessions.find(s=>s.id==='fixture');session.status='running';if(i===0){const old=new Date(Date.now()-6*60000).toISOString();session.messages=[{id:'quiet-user',role:'user',original:'Quiet interval fixture',timestamp:old,demo:false}];session.activities=[{id:'thinking-fixture',runtime:'claude',kind:'tool',category:'reasoning',status:'running',startedAt:new Date(Date.parse(old)+1000).toISOString(),updatedAt:new Date(Date.parse(old)+1000).toISOString()}];}session.nativeEventAudit={version:1,frames:i,observations:i,unknown:0,unsupported:0,malformed:0,omitted:0,receipts:[{runtime:'claude',key:'delta/thinking_delta',disposition:'private',route:'metadata',count:i+1,firstAt:new Date().toISOString(),lastAt:new Date().toISOString(),lastBytes:10,lastDigest:'fixture'}]};});await new Promise(r=>setTimeout(r,10));}});}`;
const manifest={schemaVersion:1,apiVersion:1,id:'qa.send-preparation',name:'Send preparation QA',description:'Synthetic pending-input presentation',version:'1.0.0',capabilities:['host'],main:'main.mjs'},zip=path.join(output,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.execPath,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.workbench);
 const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
 await page.getByText('Send preparation fixture',{exact:true}).first().click();await call('extensions/import',{filePath:zip});const plugin=(await call('extensions/list')).find(p=>p.manifest.id===manifest.id);await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:true,approveHost:true});
 const command=(name,payload={})=>call('extensions/command',{id:manifest.id,name,payload});
 const input=page.getByTestId('composer-input');
 const waitSubmission=async()=>{for(let i=0;i<100;i++){if(await command('waiting'))return;await page.waitForTimeout(20);}throw Error('Submission did not reach gate');};
 await input.fill('First delayed input');await page.getByTestId('prepare-draft').click();await waitSubmission();await page.waitForFunction(()=>document.querySelector('[data-testid="composer-input"]').value==='',{},{timeout:1000});assert.equal(await input.inputValue(),'');assert.equal(await input.isEnabled(),true);
 await input.fill('Newer draft must survive');await command('release',{fail:true});await page.getByText('SYNTHETIC_SUBMIT_FAILURE',{exact:false}).waitFor({state:'hidden'});await page.waitForTimeout(100);assert.equal(await input.inputValue(),'Newer draft must survive');
 await page.getByTestId('prepare-draft').click();await waitSubmission();await page.waitForFunction(()=>document.querySelector('[data-testid="composer-input"]').value==='',{},{timeout:1000});assert.equal(await input.inputValue(),'');await command('release',{fail:true});await page.getByText('SYNTHETIC_SUBMIT_FAILURE',{exact:false}).waitFor();assert.equal(await input.inputValue(),'Newer draft must survive');
 await input.fill('Successful delayed input');await page.getByTestId('prepare-draft').click();await waitSubmission();await page.waitForFunction(()=>document.querySelector('[data-testid="composer-input"]').value==='',{},{timeout:1000});assert.equal(await input.inputValue(),'');await command('release',{fail:false});await page.getByText('Successful delayed input',{exact:true}).first().waitFor();for(let i=0;i<200;i++){if((await call('state/get')).sessions[0].status!=='running')break;await page.waitForTimeout(20);}
 const stream=command('stream');const latencies=[];
 for(let i=0;i<20;i++){const started=Date.now();await input.fill('Typing during stream '+i);assert.equal(await input.inputValue(),'Typing during stream '+i);latencies.push(Date.now()-started);}
 await stream;await page.getByTestId('native-activity-age').waitFor();assert.match(await page.getByTestId('native-activity-age').innerText(),/收到运行数据/);
 await page.getByText(/持续思考，\d+ 分钟无正文或工具进展/).waitFor();await page.getByText(/上次 .*tok\/s/).first().waitFor();
 await page.screenshot({path:path.join(output,'responsive.png')});
 await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:false});await app.close();app=undefined;
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});const restarted=await app.firstWindow();await restarted.waitForFunction(()=>!!window.workbench);const restored=await restarted.evaluate(()=>window.workbench.call('state/get'));assert.equal(restored.sessions[0].status,'uncertain');
 console.log('PASS delayed submit immediate clear, safe failure recovery, newer input preservation, streaming interaction and process restart; input fill/read milliseconds '+JSON.stringify(latencies)+'; '+output);
}finally{await app?.close();}
