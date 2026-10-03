// Production host/renderer with isolated synthetic files and an approved extension.
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {encodeZip} from '../packages/native-resources/archive.ts';
const root=process.cwd(),output=path.join(root,'build/qa/file-pagination-'+Date.now()),workspace=path.join(output,'workspace'),profile=path.join(output,'profile');
await mkdir(path.join(workspace,'nested'),{recursive:true});
const large=path.join(workspace,'large.txt'),target=path.join(workspace,'nested','needle.md');
await writeFile(large,'Line 中文🙂\n'.repeat(110000));await writeFile(target,'Found by continued search');
for(let start=0;start<1005;start+=100)await Promise.all(Array.from({length:Math.min(100,1005-start)},(_,i)=>writeFile(path.join(workspace,`file-${start+i}.txt`),'fixture')));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[],checks=[];
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);};
try{
 await launch();
 const id='qa.file-pages',manifest={schemaVersion:1,apiVersion:1,id,name:'File pages fixture',version:'1.0.0',description:'Synthetic only',capabilities:['host'],main:'main.mjs',renderer:'renderer.mjs'};
 const main=`export function activate(api){api.registerCommand('seed',p=>api.services.get('workbench.state').update(state=>{const s=state.sessions.find(s=>s.id===p.id);s.binding.runtime='claude';s.messages=[{id:'u',role:'user',original:'Synthetic file navigation',timestamp:'2026-10-03T00:00:00Z',demo:true},{id:'a',role:'assistant',original:p.text,timestamp:'2026-10-03T00:00:01Z',demo:true}];}));api.services.intercept('files.navigation','locate',(next,request)=>next({...request,budget:request.budget??{entries:10,directories:2,milliseconds:2000}}));}`;
 const renderer=`export function activate(api){api.observeSurfaces('file-pagination','after',({root})=>{root.dataset.qaPagination='true';});window.qaPaginationReplace=()=>api.observeSurfaces('file-pagination','replace',({root})=>{root.textContent='Synthetic replacement';});}`;
 const zip=path.join(output,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(main)},{name:'renderer.mjs',data:Buffer.from(renderer)}]));
 await call('extensions/import',{filePath:zip});const record=(await call('extensions/list')).find(p=>p.manifest.id===id);
 const toggle=enabled=>call('extensions/toggle',{id,hash:record.hash,enabled,...(enabled?{approveHost:true}:{})});await toggle(true);
 const project=await call('project/create',{name:'Pagination fixture',paths:[workspace]}),session=await call('session/create',{runtime:'demo',projectId:project.id});
 const text=`[大文件](<${large.replaceAll('\\','/')}>), [行号](<${large.replaceAll('\\','/')}:100000>), [继续查找](needle.md)`;
 await call('extensions/command',{id,name:'seed',payload:{id:session.id,text}});await page.getByTestId('sidebar-session-'+session.id).locator('.session-select').click();
 const link=name=>page.locator('.conversation-column').getByRole('link',{name,exact:true});
 let dock=page.getByTestId('file-dock');
 await link('大文件').click();await dock.getByRole('button',{name:'继续读取',exact:true}).waitFor();await dock.locator('.monaco-editor').waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('[data-qa-pagination]').length>=1);
 await page.evaluate(()=>window.qaPaginationOff=window.qaPaginationReplace());await page.getByText('Synthetic replacement',{exact:true}).first().waitFor();assert.equal(await dock.getByRole('button',{name:'继续读取',exact:true}).isVisible(),false);
 await page.evaluate(()=>window.qaPaginationOff());await dock.getByRole('button',{name:'继续读取',exact:true}).click();await dock.getByRole('button',{name:'继续读取',exact:true}).waitFor({state:'detached'});
 checks.push('large text pages, actual Monaco and surface replacement restoration');
 await dock.getByRole('tab',{name:'文件',exact:true}).click();await dock.getByRole('button',{name:'继续加载目录项',exact:true}).click();await dock.getByRole('button',{name:'继续加载目录项',exact:true}).waitFor({state:'detached'});assert.equal(await dock.locator('.file-tree-row').count(),1007);
 checks.push('directory reaches all 1007 entries');
 await dock.getByRole('button',{name:'关闭文件面板',exact:true}).click();await link('行号').click();await page.waitForFunction(()=>document.querySelector('[data-testid="code-preview"]')?.getAttribute('data-line')==='100000');await dock.getByRole('button',{name:'从头查看',exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'large-line.png')});
 await dock.getByRole('button',{name:'关闭文件面板',exact:true}).click();await link('继续查找').click();
 for(let n=0;n<12;n++){
   const more=dock.getByRole('button',{name:'扩大范围继续查找',exact:true});
   await Promise.race([more.waitFor(),dock.locator('.monaco-editor').waitFor()]);if(await more.count()===0)break;await more.click();await dock.locator('[aria-busy="true"]').waitFor({state:'detached'});
 }
 await page.waitForFunction(target=>document.querySelector('[aria-label="文件路径"]')?.value===target,target);await dock.locator('.monaco-editor').waitFor();
 checks.push('distant line seeking and explicit search continuation');
 await dock.getByRole('button',{name:'关闭文件面板',exact:true}).click();await link('大文件').click();await dock.getByRole('button',{name:'继续读取',exact:true}).waitFor();
 await toggle(false);await page.locator('[data-qa-pagination]').first().waitFor({state:'detached'});assert.equal(await dock.getByRole('button',{name:'继续读取',exact:true}).isVisible(),true);
 await toggle(true);await page.locator('[data-qa-pagination]').first().waitFor({state:'attached'});await toggle(false);
 await dock.getByRole('button',{name:'自动换行',exact:true}).click();const wrap=await dock.getByRole('button',{name:'自动换行',exact:true}).getAttribute('aria-pressed');
 await app.close();app=undefined;await launch();dock=page.getByTestId('file-dock');await page.getByTestId('sidebar-session-'+session.id).locator('.session-select').click();await link('大文件').click();await dock.getByRole('button',{name:'自动换行',exact:true}).waitFor();assert.equal(await dock.getByRole('button',{name:'自动换行',exact:true}).getAttribute('aria-pressed'),wrap);
 checks.push('later surfaces, disable/reenable and saved reader preference after full restart');assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,output}));
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await app?.close();await writeFile(path.join(output,'result.json'),JSON.stringify({checks,errors},null,2));}
