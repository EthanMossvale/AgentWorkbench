// Real hidden Electron, synthetic profiles and approved plugins only.
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ZipWriter,Uint8ArrayWriter,Uint8ArrayReader} from '@zip.js/zip.js';
import {encodeZip} from '../packages/native-resources/archive.ts';
import {openWorkbenchSettings} from './ui-control-helpers.mjs';
const root=process.cwd(),output=path.join(root,'build/qa/archive-import-'+Date.now()),profile=path.join(output,'profile');await mkdir(output,{recursive:true});
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
const zip=async(file,entries,password)=>{const writer=new ZipWriter(new Uint8ArrayWriter(),{password,zip64:true,useWebWorkers:false,useCompressionStream:true});for(const entry of entries)await writer.add(entry.name,new Uint8ArrayReader(entry.data));await writeFile(file,await writer.close());};
const encrypted=path.join(output,'encrypted.zip'),large=path.join(output,'large.zip'),secret='fixture-only-password';
const skill=name=>Buffer.from('---\nname: '+name+'\ndescription: Synthetic archive acceptance\n---\nExact source');
await zip(encrypted,[{name:'SKILL.md',data:skill('encrypted-skill')}],secret);
await writeFile(large,encodeZip([{name:'SKILL.md',data:skill('large-skill')},{name:'large.bin',data:Buffer.alloc(67*1024*1024,0x41)}]));
const encryptedPlugin=path.join(output,'encrypted-plugin.zip'),pluginManifest={schemaVersion:1,apiVersion:1,id:'qa.encrypted-package',name:'Encrypted package',version:'1.0.0',description:'Synthetic only',capabilities:['context'],contributes:{context:'Fixture'}};await zip(encryptedPlugin,[{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(pluginManifest))}],secret);
let app,page;const errors=[];
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>!!window.workbench);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);};
try{
 await launch();await openWorkbenchSettings(page,'skills');await page.getByRole('tab',{name:/个人/}).click();
 const id='qa.archive-ui',main="export function activate(api){let file;api.registerCommand('pick',value=>{file=value;});api.services.override('desktop.dialog',{showOpenDialog:async()=>({canceled:false,filePaths:[file]})});}",renderer="export function activate(api){api.observeSurfaces('archive-password','after',({root})=>{root.dataset.testid='archive-fixture';root.textContent='Fixture surface';});}";
 const fixture=path.join(output,'fixture.zip');await writeFile(fixture,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id,name:'Archive UI fixture',version:'1.0.0',description:'Synthetic',capabilities:['host'],main:'main.mjs',renderer:'renderer.mjs'}))},{name:'main.mjs',data:Buffer.from(main)},{name:'renderer.mjs',data:Buffer.from(renderer)}]));await call('extensions/import',{filePath:fixture});const hash=(await call('extensions/list')).find(item=>item.manifest.id===id).hash;
 const toggle=enabled=>call('extensions/toggle',{id,hash,enabled,...(enabled?{approveHost:true}:{})}),pick=file=>call('extensions/command',{id,name:'pick',payload:file});await toggle(true);
 for(const provider of ['Codex','Claude Code']){
  await pick(encrypted);await page.getByTestId('skills-import').click();await page.getByRole('tab',{name:provider,exact:true}).click();await page.getByTestId('skill-zip-dropzone').click();await page.getByLabel('压缩包密码',{exact:true}).waitFor();await page.getByTestId('archive-fixture').waitFor();
  await page.getByLabel('压缩包密码',{exact:true}).fill('wrong');await page.getByRole('button',{name:'解压并导入',exact:true}).click();await page.getByText('密码不正确，请重新输入。',{exact:true}).waitFor();assert.equal(await page.getByLabel('压缩包密码',{exact:true}).inputValue(),'');
  if(provider==='Codex'){await toggle(false);await page.getByTestId('archive-fixture').waitFor({state:'detached'});assert.equal(await page.locator('[data-workbench-archive-password]').count(),1);await toggle(true);await page.getByTestId('archive-fixture').waitFor();await page.screenshot({path:path.join(output,'password.png')});}
  await page.getByLabel('压缩包密码',{exact:true}).fill(secret);await page.getByRole('button',{name:'解压并导入',exact:true}).click();await page.getByRole('dialog',{name:'导入 Skill',exact:true}).waitFor({state:'detached'});
 }
 await pick(large);await page.getByTestId('skills-import').click();const zone=page.getByTestId('skill-zip-dropzone'),box=await zone.boundingBox(),cdp=await page.context().newCDPSession(page);for(const type of ['dragEnter','dragOver','drop'])await cdp.send('Input.dispatchDragEvent',{type,x:box.x+box.width/2,y:box.y+box.height/2,data:{items:[],files:[large],dragOperationsMask:1}});await page.getByRole('dialog',{name:'导入 Skill',exact:true}).waitFor({state:'detached'});assert.equal((await readFile(path.join(profile,'native-home','.agents','skills','large-skill','large.bin'))).length,67*1024*1024);
 await openWorkbenchSettings(page,'plugins');await page.getByRole('tab',{name:'工作台插件',exact:true}).click();await pick(encryptedPlugin);await page.getByTestId('plugin-import').click();await page.getByTestId('plugin-zip-dropzone').click();await page.getByTestId('archive-fixture').waitFor();await page.getByLabel('压缩包密码',{exact:true}).fill(secret);await page.getByRole('button',{name:'解压并导入',exact:true}).click();await page.getByRole('dialog',{name:'导入工作台插件',exact:true}).waitFor({state:'detached'});assert.equal((await call('extensions/list')).find(item=>item.manifest.id==='qa.encrypted-package').enabled,false);
 await pick(encrypted);await page.getByTestId('plugin-import').click();await page.getByTestId('plugin-zip-dropzone').click();await page.getByLabel('压缩包密码',{exact:true}).fill('UNSUBMITTED_SECRET');await app.close();app=undefined;await launch();assert.equal(await page.locator('[data-workbench-archive-password]').count(),0);assert.equal(await page.getByTestId('settings-plugins').getAttribute('aria-current'),'page');assert.ok(!(await readFile(path.join(profile,'state.json'),'utf8')).includes('UNSUBMITTED_SECRET'));assert.deepEqual(errors,[]);
 console.log('PASS both native import targets, wrong/correct passwords, 67 MiB real drop, encrypted plugin disabled by default, approved mounted/later surface and disable/reenable, full restart clears transient secrets');
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')});throw error;}finally{await app?.close();await writeFile(path.join(output,'result.json'),JSON.stringify({errors},null,2));}
