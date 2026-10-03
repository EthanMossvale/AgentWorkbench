// Hidden synthetic profile: no real credentials, model tasks or remote connection.
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {encodeZip} from '../packages/native-resources/archive.ts';

const root=process.cwd(),output=path.join(root,'build/qa/defensive-ux-'+Date.now()),profile=path.join(output,'profile');await mkdir(profile,{recursive:true});
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[];
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);await page.getByTestId('composer-input').waitFor();assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);};
const menu=async id=>{await page.locator(`[data-project-id="${id}"] .project-title`).focus();await page.keyboard.press('Shift+F10');await page.getByRole('menu',{name:'项目菜单'}).waitFor();};
try{
 await launch();
 const project=await call('project/create',{name:'Synthetic UX project',paths:[output]});
 const chat=await call('session/create',{runtime:'demo',projectId:project.id});
 const id='qa.defensive-ux',manifest={schemaVersion:1,apiVersion:1,id,name:'Undo fixture',version:'1.0.0',description:'Isolated lifecycle',capabilities:['host'],main:'main.mjs',renderer:'renderer.mjs'};
 const main=`export function activate(api){api.services.intercept('sidebar.projects','archive',async(next,id)=>({...await next(id),fixture:true}));}`;
 const renderer=`export function activate(api){api.observeSurfaces('sidebar-undo','after',({root})=>{const node=document.createElement('span');node.dataset.testid='undo-fixture';node.textContent='Fixture';root.append(node);return()=>node.remove();});}`;
 const zip=path.join(output,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(main)},{name:'renderer.mjs',data:Buffer.from(renderer)}]));
 await call('extensions/import',{filePath:zip});const plugin=(await call('extensions/list')).find(p=>p.manifest.id===id);await call('extensions/toggle',{id,hash:plugin.hash,enabled:true,approveHost:true});
 await menu(project.id);await page.getByTestId('project-archive-chats').click();await page.getByTestId('sidebar-undo').waitFor();await page.getByTestId('undo-fixture').waitFor();
 assert.equal(await page.getByRole('dialog',{name:'归档项目内会话'}).count(),0);assert.equal((await call('state/get')).sessions.find(s=>s.id===chat.id).archived,true);
 await call('extensions/toggle',{id,hash:plugin.hash,enabled:false});await page.getByTestId('undo-fixture').waitFor({state:'hidden'});
 await call('extensions/toggle',{id,hash:plugin.hash,enabled:true});await page.getByTestId('undo-fixture').waitFor();
 await page.getByTestId('sidebar-undo').click();assert.equal((await call('state/get')).sessions.find(s=>s.id===chat.id).archived,false);
 await menu(project.id);await page.getByTestId('project-remove').click();await page.getByTestId('sidebar-undo').waitFor();await page.getByTestId('undo-fixture').waitFor();
 assert.equal(await page.getByRole('dialog',{name:'移除项目'}).count(),0);assert.equal((await call('state/get')).projects.some(p=>p.id===project.id),false);
 await page.screenshot({path:path.join(output,'undo.png')});
 await page.getByTestId('sidebar-undo').click();assert.equal((await call('state/get')).sessions.find(s=>s.id===chat.id).projectId,project.id);
 await call('extensions/toggle',{id,hash:plugin.hash,enabled:false});
 await app.close();app=undefined;await launch();assert((await call('state/get')).projects.some(p=>p.id===project.id));assert.equal(await page.getByTestId('sidebar-undo').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS immediate archive/remove, undo, approved mounted/later surface, disable/reenable, process restart');
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')});throw error;}finally{await app?.close();await writeFile(path.join(output,'result.json'),JSON.stringify({errors},null,2));}
