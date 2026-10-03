// Isolated real host and approved fixture extension. No native model task or user profile.
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {encodeZip,readArchive} from '../packages/native-resources/archive.ts';
const root=process.cwd(),output=path.join(root,'build/qa/defensive-files-'+Date.now()),profile=path.join(output,'profile');
const skillRoot=path.join(profile,'native-home','.codex','skills','.system');
const add=async name=>{const dir=path.join(skillRoot,name);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'SKILL.md'),`---\nname: ${name}\ndescription: Synthetic export fixture.\n---\nSynthetic ${name}.\n`);};
await add('official-fixture');
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[];
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);};
try{
 await launch();await page.getByTestId('sidebar-footer-menu').click();await page.getByTestId('settings-open').click();await page.getByTestId('settings-skills').click();await page.getByRole('tab',{name:/官方/}).click();await page.getByRole('button',{name:'导出 official-fixture',exact:true}).waitFor();
 const id='qa.defensive-files-ui',manifest={schemaVersion:1,apiVersion:1,id,name:'File UX fixture',version:'1.0.0',description:'Synthetic only',capabilities:['host'],main:'main.mjs',renderer:'renderer.mjs'};
 const target=path.join(profile,'official-export.zip');
 const main=`export function activate(api){api.services.override('desktop.dialog',{showSaveDialog:async()=>({canceled:false,filePath:${JSON.stringify(target)}})});}`;
 const renderer=`export function activate(api){api.observeSurfaces('native-skill-export','after',({root,target})=>{root.dataset.testid='export-fixture';root.dataset.skillId=target.dataset.skillId;root.textContent='';});}`;
 const zip=path.join(output,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(main)},{name:'renderer.mjs',data:Buffer.from(renderer)}]));
 await call('extensions/import',{filePath:zip});const record=(await call('extensions/list')).find(p=>p.manifest.id===id);const toggle=enabled=>call('extensions/toggle',{id,hash:record.hash,enabled,...(enabled?{approveHost:true}:{})});await toggle(true);
 await page.getByTestId('export-fixture').waitFor({state:'attached'});await page.getByRole('button',{name:'导出 official-fixture',exact:true}).click();await page.getByRole('status').filter({hasText:'Skill ZIP 已导出'}).waitFor();
 assert.equal((await readArchive(target)).find(f=>f.name==='SKILL.md').data.toString(),await readFile(path.join(skillRoot,'official-fixture','SKILL.md'),'utf8'));
 await add('later-fixture');await page.getByTestId('skills-refresh').click();await page.getByRole('button',{name:'导出 later-fixture',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-testid="export-fixture"]').length===2);
 await toggle(false);await page.getByTestId('export-fixture').first().waitFor({state:'detached'});assert.equal(await page.locator('[data-workbench-skill-export]').count(),2);
 await toggle(true);await page.waitForFunction(()=>document.querySelectorAll('[data-testid="export-fixture"]').length===2);await page.screenshot({path:path.join(output,'official-export.png')});await toggle(false);
 await app.close();app=undefined;await launch();await page.getByRole('button',{name:'导出 official-fixture',exact:true}).waitFor();assert.equal(await page.getByTestId('settings-skills').getAttribute('aria-current'),'page');assert.deepEqual(errors,[]);
 console.log('PASS official export bytes, mounted/later surface, disable/reenable, persisted settings after restart');
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')});throw error;}finally{await app?.close();await writeFile(path.join(output,'result.json'),JSON.stringify({errors},null,2));}
