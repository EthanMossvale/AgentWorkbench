import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as hostBuild } from 'esbuild';
import { build as rendererBuild } from 'vite';
import { mkdir, writeFile, cp, rename } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { encodeZip } from '../packages/native-resources/archive.ts';

// Production renderer, controller, filesystem and approved plugin lifecycle.
// Only external application launches and the save dialog are recorded at the OS boundary.
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const output=path.resolve(process.env.AWB_FILE_RESOLUTION_QA??path.join(root,'build/qa/file-resolution-'+Date.now()));
const appRoot=path.join(output,'app'),dataDir=path.join(output,'data'),workspace=path.join(output,'workspace');
await mkdir(appRoot,{recursive:true});
await rendererBuild({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await hostBuild({entryPoints:[path.join(root,`apps/desktop/host/${entry}.ts`)],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
for(const [source,target] of [['vps-workspace-control','workspace-control'],['vps-account-broker','account-runtime']])await cp(path.join(root,'services',source),path.join(appRoot,'host',target),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-file-resolution-qa',version:'1.0.0',main:'host/main.cjs'}));
const file=async(relative,content='first\nsecond\n')=>{const target=path.join(output,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);return target;};
const nested=await file('workspace/deployment/README-部署说明.md'),literal=await file('workspace/assets/notes (v2) [中文] 100%.md'),encoded=await file('workspace/assets/literal%20name.md');
const duplicateA=await file('workspace/one/duplicate.md'),duplicateB=await file('workspace/two/duplicate.md'),external=await file('external/plugin.md');
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:dataDir,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const checks=[],errors=[];
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const wait=async predicate=>{for(let n=0;n<200;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('File UI did not settle');};
const shot=name=>page.screenshot({path:path.join(output,name+'.png')});
const toggle=(plugin,enabled)=>call('extensions/toggle',{id:plugin.manifest.id,hash:plugin.hash,enabled,...(enabled?{approveHost:true}:{})});
const install=async(id,main,renderer)=>{
 const manifest={schemaVersion:1,apiVersion:1,id,name:id,description:'Synthetic file navigation acceptance',version:'1.0.0',capabilities:['host'],...(main?{main:'main.mjs'}:{}),...(renderer?{renderer:'renderer.mjs'}:{})};
 const zip=path.join(output,id+'.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},...(main?[{name:'main.mjs',data:Buffer.from(main)}]:[]),...(renderer?[{name:'renderer.mjs',data:Buffer.from(renderer)}]:[])]));
 await call('extensions/import',{filePath:zip});return(await call('extensions/list')).find(item=>item.manifest.id===id);
};
try{
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:appRoot,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>!!window.workbench);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 await app.evaluate(({shell,dialog},output)=>{globalThis.__fileQA={opened:[],revealed:[]};shell.openPath=async p=>{globalThis.__fileQA.opened.push(p);return '';};shell.showItemInFolder=p=>globalThis.__fileQA.revealed.push(p);dialog.showSaveDialog=async()=>({canceled:false,filePath:output+'/saved-copy.md'});},output);
 const seed=await install('qa.file-seed',`export function activate(api){api.registerCommand('seed',p=>api.services.get('workbench.state').update(state=>{const session=state.sessions.find(s=>s.id===p.id);session.title='文件链接验收';session.binding.runtime=p.runtime;session.messages=[{id:'u',role:'user',original:'检查文件链接',timestamp:'2026-09-30T00:00:00Z',demo:true},{id:'a',role:'assistant',original:p.text,timestamp:'2026-09-30T00:00:01Z',demo:true}];}));}`);
 await toggle(seed,true);
 const project=await call('project/create',{name:'文件解析测试',paths:[workspace]});
 const session=await call('session/create',{runtime:'demo',projectId:project.id});
 const source='| 文件 | 说明 |\n| --- | --- |\n| `README-部署说明.md` | 嵌套文件 |\n| `notes (v2) [中文] 100%.md` | 中文与特殊字符 |\n| `literal%20name.md` | 字面百分号 |\n| [编码文件](<'+encoded.replaceAll('\\','/').replaceAll('%','%25')+':2>) | 行号 |\n| `duplicate.md:2` | 同名候选 |';
 const render=async(runtime='claude',text=source)=>{await call('extensions/command',{id:seed.manifest.id,name:'seed',payload:{id:session.id,runtime,text}});await page.getByTestId('sidebar-session-'+session.id).locator('.session-select').click();await page.locator('[data-workbench-file-link]').first().waitFor();await page.mouse.move(750,220);};
 const link=name=>page.locator('.conversation-column').getByRole('link',{name,exact:true});
 const dock=page.getByTestId('file-dock'),location=page.getByRole('textbox',{name:'文件路径',exact:true});
 const shown=async target=>{await wait(async()=>await location.inputValue()===target);await dock.locator('.monaco-editor').waitFor();assert.equal(await dock.getByRole('alert').count(),0);};
 const close=async()=>{if(await dock.isVisible())await dock.getByRole('button',{name:'关闭文件面板',exact:true}).click();};
 for(const runtime of ['claude','codex']){await render(runtime);await link('README-部署说明.md').click();await shown(nested);await close();}
 pass('both runtime render paths open the unique nested filename through production IPC and Monaco');
 for(const runtime of ['claude','codex']){
  await render(runtime);await link('README-部署说明.md').click();await shown(nested);await link('literal%20name.md').click();await shown(encoded);
  const tabs=dock.getByRole('tablist',{name:'文件标签页'});assert.equal(await tabs.getByRole('tab').count(),3);
  await tabs.getByRole('tab',{name:'README-部署说明.md',exact:true}).click();await shown(nested);
  await tabs.getByRole('button',{name:'关闭 literal%20name.md',exact:true}).click();await shown(nested);
  assert.equal(await dock.locator('.file-dock-header > button').count(),0);
  await shot('file-tabs-'+runtime);await close();await dock.waitFor({state:'detached'});
  await link('literal%20name.md').click();await shown(encoded);assert.equal(await tabs.getByRole('tab').count(),2);await close();
 }
 pass('Claude and Codex share adjacent tab closes, independent file closure and close-all exit without stale previews');
 await link('README-部署说明.md').click({button:'right'});const menu=page.getByRole('menu',{name:'链接操作',exact:true});
 await wait(()=>menu.getByRole('menuitem',{name:'在资源管理器中显示',exact:true}).isEnabled());await menu.getByRole('menuitem',{name:'在资源管理器中显示',exact:true}).click();
 await wait(async()=>(await app.evaluate(()=>globalThis.__fileQA.revealed.length))===1);assert.deepEqual(await app.evaluate(()=>globalThis.__fileQA.revealed),[nested]);
 await link('README-部署说明.md').click({button:'right'});await wait(()=>menu.getByRole('menuitem',{name:'在默认应用中打开',exact:true}).isEnabled());await menu.getByRole('menuitem',{name:'在默认应用中打开',exact:true}).click();
 await wait(async()=>(await app.evaluate(()=>globalThis.__fileQA.opened.length))===1);assert.deepEqual(await app.evaluate(()=>globalThis.__fileQA.opened),[nested]);pass('context menus enable resolved files and deliver the canonical path to Explorer and the default app');
 for(const [name,target] of [['notes (v2) [中文] 100%.md',literal],['literal%20name.md',encoded],['编码文件',encoded]]){await link(name).click();await shown(target);if(name==='编码文件')await dock.getByText('第 2 行，第 1 列',{exact:true}).waitFor();await close();}
 pass('Unicode, spaces, brackets, literal percentages, encoded destinations and exact line navigation survive the full renderer path');
 await link('literal%20name.md').click({button:'right'});await wait(()=>menu.getByRole('menuitem',{name:'复制文件内容',exact:true}).isEnabled());await menu.getByRole('menuitem',{name:'复制 Markdown 链接',exact:true}).click();
 await wait(async()=>(await app.evaluate(({clipboard})=>clipboard.readText())).includes(encodeURI(encoded.replaceAll('\\','/'))));const markdown=await app.evaluate(({clipboard})=>clipboard.readText());assert.ok(markdown.includes('literal%2520name.md'));
 await render('claude',markdown);await page.locator('.conversation-column [data-workbench-file-link]').click();await shown(encoded);await close();await render();
 pass('copied Markdown links round-trip the same literal filename');
 await render('claude','[文档章节](README-部署说明.md#deployment)');await link('文档章节').click();await shown(nested);await close();await render();pass('document section anchors open the referenced file instead of becoming part of its disk filename');
 await link('duplicate.md:2').focus();await page.keyboard.press('Enter');await dock.getByRole('region',{name:'匹配的文件'}).waitFor();
 assert.equal(await dock.locator('.file-resolution-candidate').count(),2);assert.equal(await dock.getByRole('button',{name:'打开',exact:true}).isDisabled(),true);
 await shot('ambiguous-light');await dock.getByRole('button',{name:duplicateB,exact:true}).click();await shown(duplicateB);await dock.getByText('第 2 行，第 1 列',{exact:true}).waitFor();await close();
 await link('duplicate.md:2').click({button:'right'});await menu.getByRole('menuitem',{name:duplicateB,exact:true}).waitFor();await page.keyboard.press('End');assert.equal(await menu.getByRole('menuitem',{name:duplicateB,exact:true}).evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Enter');await shown(duplicateB);await close();
 pass('ambiguous links show complete paths in both reader and menu; keyboard choice preserves the requested line');
 const partial=await install('qa.file-partial',`export function activate(api){api.services.intercept('files.navigation','locate',async(next,r)=>r.requested==='README-部署说明.md'?{status:'incomplete',requested:r.requested,candidates:[${JSON.stringify(nested)}],message:'查找范围未完整检查，请选择已找到的文件。'}:next(r));}`);await toggle(partial,true);
 await link('README-部署说明.md').click();await dock.getByRole('button',{name:nested,exact:true}).waitFor();await dock.getByRole('button',{name:nested,exact:true}).click();await shown(nested);await close();await toggle(partial,false);
 pass('incomplete discovery remains actionable without treating the partial match as unique');
 await call('theme/set',{theme:'dark'});await link('duplicate.md:2').click();await dock.locator('.file-resolution-candidate').first().waitFor();await page.setViewportSize({width:1000,height:740});await page.getByTestId('sidebar-toggle').click();const divider=page.getByRole('separator',{name:'调整文件面板宽度'});await divider.focus();for(let i=0;i<8;i++)await page.keyboard.press('ArrowRight');await shot('ambiguous-dark-narrow');assert.ok(await dock.evaluate(el=>el.getBoundingClientRect().width<=310&&el.scrollWidth<=el.clientWidth+1));await close();await page.setViewportSize({width:1200,height:820});await call('theme/set',{theme:'light'});
 pass('light and dark narrow file panes keep full candidate paths readable without horizontal overflow');
 const renderer=`export function activate(api){window.__filePlugin={mounts:0,cleaned:0,late:[],lateCleaned:0};for(const surface of ['file-link','file-link-menu','file-reader','file-link-candidates'])api.observeSurfaces(surface,'before',({root,signal})=>{const q=window.__filePlugin;q.mounts++;root.dataset.qaFileSurface=surface;root.textContent='Plugin '+surface;signal.addEventListener('abort',()=>q.cleaned++,{once:true});return()=>{};});api.observeSurfaces('file-reader','after',async({root})=>{await new Promise(resolve=>window.__filePlugin.late.push(resolve));root.textContent='Late fixture';return()=>window.__filePlugin.lateCleaned++;});}`;
 const extension=await install('qa.file-extension',`export function activate(api){api.onDispose(api.services.get('files.navigation').registerSource({id:'plugin:'+api.id+'/aliases',candidates:r=>r.requested==='registered.md'?[${JSON.stringify(external)}]:[]}));}`,renderer);await toggle(extension,true);
 await wait(async()=>await page.locator('[data-qa-file-surface="file-link"]').count()===5);
 await render('claude',source+'\n\n`registered.md`');await wait(async()=>await page.locator('[data-qa-file-surface="file-link"]').count()===6);await link('registered.md').click();await shown(external);await page.locator('[data-qa-file-surface="file-reader"]').waitFor();await close();
 await link('duplicate.md:2').click({button:'right'});await page.locator('[data-qa-file-surface="file-link-menu"]').waitFor();await page.locator('[data-qa-file-surface="file-link-candidates"]').waitFor();await page.keyboard.press('Escape');
 const replacement=await install('qa.file-replacement',undefined,`export function activate(api){api.observeSurfaces('file-link','replace',({root,target})=>{const b=document.createElement('button');b.dataset.qaReplacement='1';b.textContent=target.dataset.filePath;b.onclick=()=>target.click();root.append(b);});}`);await toggle(replacement,true);await wait(async()=>await page.locator('[data-qa-replacement]').count()===6);await page.locator('[data-qa-replacement]').filter({hasText:'registered.md'}).click();await shown(external);await close();await toggle(replacement,false);
 await link('registered.md').click();await shown(external);
 const readerReplacement=await install('qa.reader-replacement',undefined,`export function activate(api){api.observeSurfaces('file-reader','replace',({root})=>{root.textContent='Replacement file reader';});}`);
 await toggle(readerReplacement,true);await page.getByText('Replacement file reader',{exact:true}).waitFor();await dock.waitFor({state:'hidden'});
 await toggle(readerReplacement,false);await shown(external);await dock.getByRole('tab',{name:'文件',exact:true}).locator('..').getByRole('button',{name:'关闭文件面板',exact:true}).click();
 await toggle(readerReplacement,true);await link('registered.md').click();await page.getByText('Replacement file reader',{exact:true}).waitFor();await toggle(readerReplacement,false);await shown(external);await close();
 pass('approved reader replacement restores adjacent close controls and also covers later reader instances');
 const failed=await install('qa.file-failed',undefined,`export function activate(api){api.observeSurfaces('file-link','replace',()=>{throw Error('Synthetic mount failure');});}`);await toggle(failed,true);await wait(async()=>!(await call('extensions/list')).find(item=>item.manifest.id===failed.manifest.id).enabled);assert.equal(await link('registered.md').isVisible(),true);
 await toggle(extension,false);await wait(async()=>await page.locator('[data-qa-file-surface]').count()===0);await page.evaluate(()=>window.__filePlugin.late.splice(0).forEach(resolve=>resolve()));await wait(async()=>await page.evaluate(()=>window.__filePlugin.lateCleaned>=1));assert.equal(await page.evaluate(()=>window.__filePlugin.mounts===window.__filePlugin.cleaned),true);
 await assert.rejects(call('files/info',{sessionId:session.id,path:'registered.md'}),/FILE_NOT_FOUND/);await toggle(extension,true);assert.equal((await call('files/info',{sessionId:session.id,path:'registered.md'})).path,external);
 assert.ok(path.resolve(extension.directory).startsWith(path.resolve(dataDir)+path.sep));await rename(extension.directory,path.join(output,'removed-plugin'));await call('extensions/renderers');await wait(async()=>await page.locator('[data-qa-file-surface]').count()===0);await page.evaluate(()=>window.__filePlugin.late.splice(0).forEach(resolve=>resolve()));await assert.rejects(call('files/info',{sessionId:session.id,path:'registered.md'}),/FILE_NOT_FOUND/);
 pass('approved plugins reach the resolver and all named surfaces; later instances, replacement, multiple plugins, failure, late completion, disable, re-enable and package removal restore core behavior');
 await render();await link('README-部署说明.md').click();await shown(nested);await shot('resolved-restored');assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors,scope:'Hidden isolated production Electron with synthetic files and approved ZIP plugins. OS shell recorded, no active client, real chats, credentials, models or remote hosts.'},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,output}));
}catch(error){await shot('failure').catch(()=>{});await writeFile(path.join(output,'result.json'),JSON.stringify({passed:false,checks,rendererErrors:errors,error:String(error)},null,2));throw error;}
finally{await app?.close();}
