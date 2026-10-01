import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as hostBuild} from 'esbuild';
import {build as rendererBuild} from 'vite';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {initialState} from '../apps/desktop/host/store.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';

// Production renderer, approved plugins and synthetic content only. No model/SSH.
const root=path.resolve(import.meta.dirname,'..'),output=path.resolve(process.env.AWB_ACTIVITY_PREFERENCE_QA??path.join(root,'build/qa/activity-preference-'+Date.now()));
const appRoot=path.join(output,'app'),data=path.join(output,'profile'),project=path.join(output,'project');
await mkdir(data,{recursive:true});await mkdir(project,{recursive:true});
await rendererBuild({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await hostBuild({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
for(const [source,target] of [['vps-workspace-control','workspace-control'],['vps-account-broker','account-runtime']])await cp(path.join(root,'services',source),path.join(appRoot,'host',target),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-activity-preference-qa',version:'1.0.0',main:'host/main.cjs'}));
const at=new Date('2026-01-01T00:00:00Z').getTime(),time=n=>new Date(at+n*1000).toISOString(),state=initialState();
state.projects=[{id:'project',name:'Synthetic project',path:project,paths:[project],group:'',authority:'local'}];
const session={id:'large-fixture',title:'Synthetic event history',projectId:'project',projectPath:project,binding:{runtime:'codex',provider:'fixture',accountRef:'fixture',executionId:'local-device',egress:'direct-api'},status:'idle',pinned:false,archived:false,group:'',createdAt:time(0),messages:[],activities:[]};
for(let group=0;group<6;group++){
  session.messages.push({id:'message-'+group,role:group===0?'user':'assistant',original:('Synthetic **public** history. Read `fixture.ts` and inspect results.\n\n').repeat(100),timestamp:time(group*50),demo:false,translationStatus:'off',phase:group===0?undefined:'commentary'});
  for(let i=0;i<38;i++)session.activities.push({id:`activity-${group}-${i}`,runtime:'codex',kind:'command',title:'Synthetic command '+i,status:'completed',input:'Write-Output fixture',output:('Synthetic output '+i+'\n').repeat(1100),startedAt:time(group*50+i+1),updatedAt:time(group*50+i+1),nativeOrder:group*50+i+1,exitCode:0});
}
state.sessions=[session];await writeFile(path.join(data,'state.json'),JSON.stringify(state));
let app,page;const errors=[],report={checks:[],samples:[],events:session.activities.length};
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const wait=async fn=>{for(let n=0;n<150;n++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('UI fixture did not settle');};
const launch=async()=>{const env={...process.env,AGENT_WORKBENCH_TEST_DATA:data,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.execPath,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.execPath};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.desktop-frame').waitFor();await page.getByTestId('sidebar-session-large-fixture').locator('.session-select').click();await page.getByTestId('activity-group').first().waitFor({state:'attached'});};
const toggle=(p,enabled)=>call('extensions/toggle',{id:p.manifest.id,hash:p.hash,enabled,approveHost:enabled});
async function plugin(id,source){const manifest={schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Isolated render regression',capabilities:['host'],renderer:'renderer.mjs'},file=path.join(output,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'renderer.mjs',data:Buffer.from(source)}]));await call('extensions/import',{filePath:file});return(await call('extensions/list')).find(p=>p.manifest.id===id);}
try{
  await launch();
  const probe=await plugin('qa.activity-prefs',`export function activate(api){window.__preferenceProbe=api.uiPreferences;window.__groupReads=0;api.activities.register({id:'observe',classify:()=>{window.__groupReads++;}});api.onDispose(()=>{window.__preferenceProbe=undefined;});}`);
  await toggle(probe,true);await wait(()=>page.evaluate(()=>!!window.__preferenceProbe));
  const group=page.getByTestId('activity-group').first();
  for(let i=0;i<8;i++){
    const sample=await group.evaluate(async node=>{window.__groupReads=0;const start=performance.now();node.querySelector('summary').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {ms:performance.now()-start,groupReads:window.__groupReads,open:node.open};});
    // Include persistence acknowledgement in the render count.
    await wait(async()=>{const saved=await call('ui-preferences/get');return Object.values(saved.entries).some(e=>e.value===sample.open&&e.revision>0);});
    sample.groupReads=await page.evaluate(()=>window.__groupReads);report.samples.push(sample);
  }
  if(!process.env.AWB_ACTIVITY_BASELINE)assert.ok(report.samples.every(s=>s.groupReads===0),'An unrelated disclosure must not rebuild the conversation grouping');
  report.checks.push(process.env.AWB_ACTIVITY_BASELINE?'Baseline disclosure regrouping measured':'Unrelated disclosure choices do not render the whole timeline');
  await group.locator(':scope > summary').evaluate(node=>{if(!node.parentElement.open)node.click();});
  await wait(async()=>{const snapshot=await call('ui-preferences/get');return Object.entries(snapshot.entries).some(([key,e])=>key.includes('ActivityGroups.details.1')&&e.value===true);});
  const prefsBefore=await readFile(path.join(data,'ui-preferences.json'),'utf8');
  await app.close();app=undefined;await launch();assert.equal(await page.getByTestId('activity-group').first().evaluate(n=>n.open),true);report.checks.push('Real process restart restores the same disclosure key');
  const override=await plugin('qa.activity-override',`export function activate(api){api.uiPreferences.override('disclosure.open',(value,scope)=>scope?.includes('ActivityGroups.details.1')?false:value);}`);
  await toggle(override,true);await wait(()=>page.getByTestId('activity-group').first().evaluate(n=>!n.open));
  await toggle(override,false);await wait(()=>page.getByTestId('activity-group').first().evaluate(n=>n.open));
  await toggle(override,true);await wait(()=>page.getByTestId('activity-group').first().evaluate(n=>!n.open));await toggle(override,false);await wait(()=>page.getByTestId('activity-group').first().evaluate(n=>n.open));
  assert.ok(prefsBefore.includes('ActivityGroups.details.1'));report.checks.push('Approved plugin overrides reach mounted disclosures; disable and reenable preserve preference');
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(output,'activity.png')});
}finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({...report,errors},null,2));console.log(JSON.stringify(report));}
