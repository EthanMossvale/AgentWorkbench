import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as buildHost} from 'esbuild';
import {build as buildRenderer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {StateStore} from '../apps/desktop/host/store.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';

// Hidden production window, isolated synthetic profile: thinking within one output
// segment stays a single row at its first position; tools and images still stack.
const root=process.cwd(),runtime=process.env.AWB_THINKING_UI_RUNTIME??'claude';
assert.ok(['codex','claude'].includes(runtime));
const output=path.resolve('build/qa/thinking-rows-'+runtime+'-'+Date.now()),appRoot=path.join(output,'app'),profile=path.join(output,'.agent-workbench'),workspace=path.join(profile,'workspaces','fixture');
await mkdir(workspace,{recursive:true});await mkdir(appRoot,{recursive:true});
await buildRenderer({root:path.join(root,'apps/desktop/renderer'),configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'error'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-thinking-ui-qa',version:'0.1.0',main:'host/main.cjs'}));
const store=new StateStore(profile);await store.load();
await store.update(s=>{s.plugins={translation:{enabled:false}};s.sessions=[{id:'think',projectId:null,projectPath:workspace,title:'Thinking rows fixture',createdAt:new Date().toISOString(),status:'running',messages:[{id:'user',role:'user',original:'Do the task',timestamp:new Date(Date.now()-60000).toISOString(),demo:false}],activities:[],pinned:false,archived:false,group:'',binding:{runtime,provider:'native',accountRef:'fixture',executionId:'local-device',egress:'runtime-managed'}}];});
await store.flush();
const source=`const RUNTIME=${JSON.stringify(runtime)};let clock=Date.now()-50000;const now=()=>new Date(clock+=1000).toISOString();
const activity=(id,change)=>({id,runtime:RUNTIME,kind:'tool',status:'running',startedAt:now(),updatedAt:now(),...change});
export function activate(api){const state=api.services.get('workbench.state');const edit=fn=>state.updateSession('think',s=>{s.status='running';fn(s);});
const set=(s,id,status)=>{const a=s.activities.find(a=>a.id===id);a.status=status;a.updatedAt=now();};
api.registerCommand('step',async step=>{
 if(step==='think1')await edit(s=>s.activities.push(activity('think-1',{category:'reasoning'})));
 if(step==='tool1')await edit(s=>{set(s,'think-1','completed');s.activities.push(activity('cmd-1',{kind:'command',title:'npm test',input:'npm test'}));});
 if(step==='think2')await edit(s=>{set(s,'cmd-1','completed');s.activities.push(activity('think-2',{category:'reasoning'}));});
 if(step==='tool2')await edit(s=>{set(s,'think-2','completed');s.activities.push(activity('edit-1',{kind:'file-edit',title:'src/a.ts',input:'patch',status:'completed'}),activity('image-1',{category:'image',status:'completed'}));});
 if(step==='reply')await edit(s=>s.messages.push({id:'commentary',role:'assistant',phase:'commentary',original:'Visible progress summary.',timestamp:now(),demo:false}));
 if(step==='think3')await edit(s=>s.activities.push(activity('think-3',{category:'reasoning'})));
});}`;
const manifest={schemaVersion:1,apiVersion:1,id:'qa.thinking-rows',name:'Thinking QA',description:'Synthetic public data only',version:'1.0.0',capabilities:['host'],main:'main.mjs'},zip=path.join(output,'fixture.zip');
await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.execPath,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;
let app;const report={runtime,errors:[],steps:{}};
try{
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:60000});const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
 const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
 await call('theme/set',{theme:'dark'});
 await call('extensions/import',{filePath:zip});const plugin=(await call('extensions/list')).find(p=>p.manifest.id===manifest.id);await call('extensions/toggle',{id:manifest.id,hash:plugin.hash,enabled:true,approveHost:true});
 await page.getByTestId('sidebar-session-think').click();await page.getByTestId('user-source-user').waitFor();
 // Visible rows of the live process, top to bottom.
 const rows=()=>page.evaluate(()=>[...document.querySelectorAll('.turn-process-body > *')].map(node=>(node.querySelector(':scope > summary .activity-group-caption')??node.querySelector(':scope > summary')??node).textContent.replace(/\s+/g,' ').trim()).filter(Boolean));
 const step=async(name,expected)=>{await call('extensions/command',{id:manifest.id,name:'step',payload:name});
  let seen=[];for(let i=0;i<60;i++){await page.evaluate(()=>{const p=document.querySelector('[data-testid="turn-process"]');if(p&&!p.open)p.querySelector(':scope > summary')?.click();});seen=await rows();if(JSON.stringify(seen.map(r=>expected.find(e=>r.startsWith(e))??r))===JSON.stringify(expected))break;await page.waitForTimeout(100);}
  report.steps[name]=seen;await page.screenshot({path:path.join(output,name+'.png')});
  assert.deepEqual(seen.map(r=>expected.find(e=>r.startsWith(e))??r),expected,name+': '+JSON.stringify(seen));};
 await step('think1',['正在思考']);
 await step('tool1',['思考已结束','正在运行 npm test']);
 await step('think2',['正在思考','运行了 1 个命令']);
 await step('tool2',['思考已结束','运行了 1 个命令并编辑了文件','已查看']);
 await step('reply',['思考已结束','运行了 1 个命令并编辑了文件','已查看','原生原文Visible progress summary.']);
 await step('think3',['思考已结束','运行了 1 个命令并编辑了文件','已查看','原生原文Visible progress summary.','正在思考']);
 assert.equal(await page.locator('[data-activity-id^="think-"]').count(),2,'one thinking row per output segment');
 assert.deepEqual(report.errors,[]);
 console.log(JSON.stringify({runtime,steps:report.steps,output}));
}finally{await app?.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
