import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as buildHost} from 'esbuild';
import {build as buildRenderer} from 'vite';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {StateStore} from '../apps/desktop/host/store.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';

const root=path.resolve(process.env.AWB_STREAM_UI_SOURCE??process.cwd()),label=process.env.AWB_STREAM_UI_LABEL??'candidate';
const output=path.resolve('build/qa/streaming-workspace-'+label+'-'+Date.now()),appRoot=path.join(output,'app'),profile=path.join(output,'.agent-workbench'),workspace=path.join(profile,'workspaces','fixture'),file=path.join(workspace,'pelican-bicycle.html'),image=path.join(workspace,'preview.png');
await mkdir(workspace,{recursive:true});await mkdir(appRoot,{recursive:true});
await writeFile(file,'<!doctype html><html><body><h1>Preview works</h1></body></html>');
await writeFile(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT9sAAAAASUVORK5CYII=','base64'));
await buildRenderer({root:path.join(root,'apps/desktop/renderer'),configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'error'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-stream-ui-qa',version:'0.1.0',main:'host/main.cjs'}));
const store=new StateStore(profile);await store.load();
const base=Date.parse('2026-10-01T00:00:00Z'),at=n=>new Date(base+n*1000).toISOString();
const prose='A public reply with **formatting**, `src/example.ts`, and an equation $x^2+y^2=z^2$. '.repeat(14)+'\n\n```ts\n'+Array.from({length:14},(_,i)=>'const sample'+i+' = "unchanged history";').join('\n')+'\n```';
const messages=[],activities=[];
for(let i=0;i<36;i++){
 messages.push({id:'user-'+i,role:'user',original:'Historical task '+i,timestamp:at(i*10),demo:false});
 for(let j=0;j<3;j++)activities.push({id:'tool-'+i+'-'+j,runtime:'codex',kind:'command',status:'completed',startedAt:at(i*10+j+1),updatedAt:at(i*10+j+2),input:'Synthetic public command',output:'Bounded output\n'.repeat(600)});
 messages.push({id:'reply-'+i,role:'assistant',phase:'final',original:prose,timestamp:at(i*10+7),demo:false});
}
messages.push({id:'current-user',role:'user',original:'Inspect a generated page',timestamp:at(400),demo:false},{id:'live',role:'assistant',phase:'commentary',original:'Streaming',timestamp:at(402),demo:false});
activities.push({id:'image',runtime:'codex',kind:'tool',category:'image',status:'completed',startedAt:at(401),updatedAt:at(401),imagePaths:[image]});
await store.update(s=>{s.plugins={translation:{enabled:false}};s.sessions=[{id:'fixture',projectId:null,projectPath:workspace,title:'Streaming workspace fixture',createdAt:at(0),status:'idle',messages,activities,pinned:false,archived:false,group:'',binding:{runtime:'codex',provider:'native',accountRef:'fixture',executionId:'local-device',egress:'runtime-managed'}}];});
const source=`export function activate(api){const state=api.services.get('workbench.state');let reads=0;
api.services.intercept('images.viewed','read',(next,input)=>{reads++;return next(input)});
api.registerCommand('reads',()=>reads);
api.registerCommand('stream',async()=>{for(let i=0;i<60;i++){await state.update(s=>{const session=s.sessions[0];session.status='running';session.messages.find(m=>m.id==='live').original+=' delta'+i;});await new Promise(r=>setTimeout(r,12));}});
api.registerCommand('finish',()=>state.update(s=>{s.sessions[0].status='idle';s.sessions[0].messages.find(m=>m.id==='live').phase='final';}));
api.registerCommand('links',()=>state.update(s=>{const session=s.sessions[0];session.messages.find(m=>m.id==='live').original=${JSON.stringify('[pelican-bicycle.html]('+file+')')};}));
api.registerCommand('runtime',runtime=>state.update(s=>{s.sessions[0].binding.runtime=runtime;for(const a of s.sessions[0].activities)a.runtime=runtime;}));}
`;
const renderer=`export function activate(api){api.observeSurfaces('runtime-image-log','after',({root})=>{root.dataset.qaImageMount='yes';});api.observeSurfaces('file-link','after',({root})=>{root.dataset.qaLinkMount='yes';});window.qaMarkdown=api.markdown;}`;
const manifest={schemaVersion:1,apiVersion:1,id:'qa.streaming-workspace',name:'Streaming QA',description:'Synthetic public data only',version:'1.0.0',capabilities:['host'],main:'main.mjs',renderer:'renderer.mjs'},zip=path.join(output,'fixture.zip');
await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)},{name:'renderer.mjs',data:Buffer.from(renderer)}]));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.execPath,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;
let app;const report={label,latencies:[],errors:[],checks:[]};
try{
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
 const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
 await page.getByText('Streaming workspace fixture',{exact:true}).first().click();await call('extensions/import',{filePath:zip});const plugin=(await call('extensions/list')).find(p=>p.manifest.id===manifest.id);await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:true,approveHost:true});
 const command=(name,payload)=>call('extensions/command',{id:manifest.id,name,payload});
 const input=page.getByTestId('composer-input');await input.fill('Warmup');await input.fill('');
 await page.evaluate(()=>{window.qaFrames=[];window.qaMeasuring=true;let last=performance.now();function tick(now){if(!window.qaMeasuring)return;window.qaFrames.push(now-last);last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);});
 const stream=command('stream');
 for(let i=0;i<24;i++){const started=performance.now();await input.fill('Typing while public output streams '+i);assert.equal(await input.inputValue(),'Typing while public output streams '+i);report.latencies.push(Math.round(performance.now()-started));}
 await stream;report.frameGaps=await page.evaluate(()=>{window.qaMeasuring=false;return window.qaFrames});
 const state=await call('state/get');assert.equal(state.sessions[0].messages.at(-1).original,'Streaming'+Array.from({length:60},(_,i)=>' delta'+i).join(''));assert.equal(state.sessions[0].status,'running');
 report.checks.push('All public deltas arrive in order while the editor accepts input');
 await command('finish');
 if(label!=='baseline'){
  const process=page.getByTestId('turn-process').last();await process.locator(':scope > summary').click();
  const log=page.locator('.runtime-image-log');await log.locator('summary').click();await log.locator('img').waitFor();assert.equal(await command('reads'),1);
  await page.waitForFunction(()=>document.querySelector('[data-qa-image-mount]'));
  await log.getByRole('button',{name:'查看图像 1',exact:true}).click();await page.getByTestId('image-viewer').waitFor();await page.keyboard.press('Escape');
  await command('links');const link=page.getByRole('link',{name:'pelican-bicycle.html',exact:true});await link.waitFor();assert.equal(await link.getAttribute('data-file-path'),file);await link.click();
  await page.getByTestId('file-dock').waitFor();await page.getByRole('textbox',{name:'文件路径',exact:true}).waitFor();await page.waitForFunction(()=>!!document.querySelector('.file-dock iframe'));
  assert.equal(await page.getByTestId('file-dock').getByRole('alert').count(),0);await page.screenshot({path:path.join(output,'image-and-file.png')});await page.getByRole('button',{name:'关闭文件面板',exact:true}).click();
  const raw=await readFile(path.join(profile,'state.json'),'utf8');assert.doesNotMatch(raw,/data:image|iVBORw0K/);assert.equal((await call('state/get')).sessions[0].messages.some(m=>m.attachments?.length),false);
  await command('runtime','claude');assert.equal((await call('attachments/activity-images',{sessionId:'fixture',activityId:'image'})).length,1);
  await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:false});await page.waitForFunction(()=>!document.querySelector('[data-qa-image-mount]'));assert.equal((await call('attachments/activity-images',{sessionId:'fixture',activityId:'image'})).length,1);
  await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:true});await page.waitForFunction(()=>document.querySelector('[data-qa-image-mount]'));
  await rm(image);await app.close();app=undefined;
  app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});const restarted=await app.firstWindow();await restarted.waitForFunction(()=>!!window.workbench);await restarted.locator('.runtime-image-log img').waitFor();
  assert.ok(await restarted.locator('.runtime-image-log img').evaluate(img=>img.complete&&img.naturalWidth>0));
  report.checks.push('Actual approved host/renderer plugin lifecycle, file link to real HTML preview, Codex/Claude image preview, disable/reenable, disclosure restart and snapshot after original removal');
 }
 assert.deepEqual(report.errors,[]);
 const sorted=report.latencies.toSorted((a,b)=>a-b);report.median=sorted[Math.floor(sorted.length/2)];report.p95=sorted[Math.ceil(sorted.length*.95)-1];
 console.log(JSON.stringify({label,median:report.median,p95:report.p95,checks:report.checks,output}));
}finally{await app?.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
