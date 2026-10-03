import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as buildHost} from 'esbuild';
import {build as buildRenderer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {StateStore} from '../apps/desktop/host/store.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';

// Hidden production window, isolated synthetic profile: switching sessions keeps each reading position.
const root=process.cwd(),runtime=process.env.AWB_READING_UI_RUNTIME??'codex';
assert.ok(['codex','claude'].includes(runtime));
const output=path.resolve('build/qa/reading-position-'+runtime+'-'+Date.now()),appRoot=path.join(output,'app'),profile=path.join(output,'.agent-workbench'),workspace=path.join(profile,'workspaces','fixture');
await mkdir(workspace,{recursive:true});await mkdir(appRoot,{recursive:true});
await buildRenderer({root:path.join(root,'apps/desktop/renderer'),configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'error'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-reading-ui-qa',version:'0.1.0',main:'host/main.cjs'}));
const base=Date.parse('2026-10-01T00:00:00Z'),at=n=>new Date(base+n*1000).toISOString();
const prose='A public reply paragraph with enough text to wrap across several lines in the reading pane. '.repeat(10);
const session=(id,title,turns)=>{const messages=[];for(let i=0;i<turns;i++)messages.push({id:id+'-user-'+i,role:'user',original:'Historical task '+i,timestamp:at(i*10),demo:false},{id:id+'-reply-'+i,role:'assistant',phase:'final',original:prose,timestamp:at(i*10+5),demo:false});
 messages.push({id:id+'-live',role:'assistant',phase:'commentary',original:'Streaming',timestamp:at(turns*10+5),demo:false});
 return {id,projectId:null,projectPath:workspace,title,createdAt:at(0),status:'idle',messages,activities:[],pinned:false,archived:false,group:'',binding:{runtime,provider:'native',accountRef:'fixture',executionId:'local-device',egress:'runtime-managed'}};};
const store=new StateStore(profile);await store.load();
await store.update(s=>{s.plugins={translation:{enabled:false}};s.sessions=[session('reading','Reading position fixture',40),session('other','Other session',3)];});
await store.flush();
const source=`export function activate(api){const state=api.services.get('workbench.state');
api.registerCommand('stream',async()=>{for(let i=0;i<40;i++){await state.updateSession('reading',session=>{session.status='running';session.messages.at(-1).original+=' delta '+i+' with more streamed public text to grow the reply';},{persist:'deferred'});await new Promise(r=>setTimeout(r,15));}});
api.registerCommand('finish',()=>state.updateSession('reading',session=>{session.status='idle';}));}`;
// The renderer plugin replaces restoration while window.qaForceFollow is set.
const renderer=`export function activate(api){api.readingPositions.override((sessionId,saved)=>window.qaForceFollow&&sessionId==='reading'?{follow:true}:saved);}`;
const manifest={schemaVersion:1,apiVersion:1,id:'qa.reading-position',name:'Reading QA',description:'Synthetic public data only',version:'1.0.0',capabilities:['host'],main:'main.mjs',renderer:'renderer.mjs'},zip=path.join(output,'fixture.zip');
await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)},{name:'renderer.mjs',data:Buffer.from(renderer)}]));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.execPath,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;
let app;const report={runtime,errors:[],checks:[]};
try{
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
 const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
 await call('extensions/import',{filePath:zip});const plugin=(await call('extensions/list')).find(p=>p.manifest.id===manifest.id);await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:true,approveHost:true});
 const command=(name,payload)=>call('extensions/command',{id:manifest.id,name,payload});
 const open=async id=>{await page.getByTestId('sidebar-session-'+id).click();await page.locator(`[data-sync-key^="${id}-"]`).first().waitFor();await page.waitForTimeout(700);};
 const pane=page.getByTestId('original-pane');
 const anchor=()=>pane.evaluate(element=>{const top=element.getBoundingClientRect().top;for(const block of element.querySelectorAll('[data-sync-key]')){const rect=block.getBoundingClientRect();if(rect.height&&rect.bottom>top+1)return {key:block.dataset.syncKey,offset:Math.round(rect.top-top),gap:Math.round(element.scrollHeight-element.scrollTop-element.clientHeight)};}return null;});
 await open('reading');
 // Leave the session in the middle of its history while it keeps streaming.
 await pane.evaluate(element=>{element.dispatchEvent(new WheelEvent('wheel',{deltaY:-400,bubbles:true}));element.scrollTop=Math.round((element.scrollHeight-element.clientHeight)*0.45);});
 await page.waitForTimeout(300);const left=await anchor();assert.ok(left&&left.gap>400,JSON.stringify(left));
 const stream=command('stream');await open('other');await stream;await open('reading');
 const returned=await anchor();assert.equal(returned.key,left.key,JSON.stringify({left,returned}));assert.ok(Math.abs(returned.offset-left.offset)<=2,JSON.stringify({left,returned}));
 report.checks.push('A session left mid-history reopens at the same text block while output streamed in the background');
 // Leave the session while following the newest output.
 await pane.evaluate(element=>{element.scrollTop=element.scrollHeight;});await page.waitForTimeout(300);
 assert.ok((await anchor()).gap<48);
 const second=command('stream');await open('other');await second;await open('reading');
 const following=await anchor();assert.ok(following.gap<48,JSON.stringify(following));
 const third=command('stream');await third;await page.waitForTimeout(400);
 assert.ok((await anchor()).gap<48,'keeps following new output after returning');
 report.checks.push('A session left at the newest output resumes following, including output that arrives afterwards');
 // An approved renderer plugin replaces the policy; disabling it restores the saved position.
 const leaveMiddle=async()=>{await pane.evaluate(element=>{element.dispatchEvent(new WheelEvent('wheel',{deltaY:-400,bubbles:true}));element.scrollTop=Math.round((element.scrollHeight-element.clientHeight)*0.4);});await page.waitForTimeout(300);const value=await anchor();await open('other');return value;};
 await page.evaluate(()=>{window.qaForceFollow=true;});
 await leaveMiddle();await open('reading');assert.ok((await anchor()).gap<48,'plugin override follows output');
 const middle=await leaveMiddle();
 await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:false});await page.waitForTimeout(500);
 await open('reading');const restored=await anchor();assert.equal(restored.key,middle.key,JSON.stringify({middle,restored}));
 report.checks.push('Approved renderer plugin override replaces restoration and disabling it restores the saved position');
 await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:true,approveHost:true});
 await command('finish');
 assert.deepEqual(report.errors,[]);
 console.log(JSON.stringify({runtime,checks:report.checks,output}));
}finally{await app?.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
