import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as buildHost} from 'esbuild';
import {build as buildRenderer} from 'vite';
import {mkdir,writeFile,cp,rename} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {encodeZip} from '../packages/native-resources/archive.ts';

// Real installed CLI, synthetic loopback responses, isolated homes, hidden UI.
const root=process.cwd(),output=path.resolve(process.env.AWB_MEMORY_CITATION_QA??'build/qa/memory-citations/ui');
const appRoot=path.join(output,'app'),data=path.join(output,'data-'+Date.now());
assert.ok(process.env.AWB_QA_CODEX,'An explicit QA Codex executable is required.');
await mkdir(path.join(data,'native-home','.codex'),{recursive:true});
await mkdir(path.join(data,'native-home','.claude'),{recursive:true});
const citation='<oai-mem-citation>\n<citation_entries>\nMEMORY.md:4-8|note=[Export conventions]\n</citation_entries>\n<rollout_ids>11111111-1111-4111-a111-111111111111</rollout_ids>\n</oai-mem-citation>';
const checks=[],errors=[];let app,page,requests=0;
const server=createServer(async(req,res)=>{
  try{
    let text='';for await(const chunk of req)text+=chunk;
    res.setHeader('content-type','application/json');
    if(req.url.endsWith('/models'))return res.end(JSON.stringify({data:[{id:'citation-fixture',display_name:'引用验收模型'}]}));
    const body=JSON.parse(text);requests++;
    const noCitation=JSON.stringify(body.messages.findLast(message=>message.role==='user')).includes('No citation');
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:noCitation?'This answer has no citation.':'原生记忆引用验收完成。\n'+citation}}],usage:{prompt_tokens:100,completion_tokens:20}}));
  }catch(error){errors.push(String(error));res.writeHead(500).end('{}');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await buildRenderer({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[`apps/desktop/host/${entry}.ts`],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
for(const service of ['vps-workspace-control','vps-account-broker'])await cp('services/'+service,path.join(appRoot,'host',service==='vps-account-broker'?'account-runtime':'workspace-control'),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-memory-citation-qa',version:'1.0.0',main:'host/main.cjs'}));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:data,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.env.AWB_QA_CODEX,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:path.join(data,'missing-claude.exe')};delete env.ELECTRON_RUN_AS_NODE;
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const wait=async(check,label)=>{const end=Date.now()+45000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,80));}throw Error('Timed out: '+label);};
const record=name=>{checks.push(name);console.log('PASS '+name);};
const open=async id=>{await page.getByTestId('sidebar-session-'+id).locator('.session-select').click();await page.getByTestId('composer-input').waitFor();};
const launch=async()=>{
  app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>!!window.workbench);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  await app.evaluate(({BrowserWindow,ipcMain})=>{
    BrowserWindow.getAllWindows()[0].setContentSize(1280,860);
    const original=ipcMain._invokeHandlers.get('workbench:call');ipcMain.removeHandler('workbench:call');
    ipcMain.handle('workbench:call',(event,method,payload)=>{if(method==='clipboard/write'){globalThis.copiedReply=payload.text;return{ok:true,value:null};}return original(event,method,payload);});
  });
};
const send=async(text)=>{await page.getByTestId('composer-input').fill(text);await page.getByTestId('prepare-draft').click();await wait(async()=>(await call('state/get')).sessions.some(s=>s.messages.some(m=>m.role==='user'&&m.original===text)),'submission');await wait(async()=>(await call('state/get')).sessions.every(s=>s.status==='idle'),'completed turn');};
const importPlugin=async(id,renderer,main)=>{
  const manifest={schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Synthetic citation lifecycle check',capabilities:['host'],renderer:'renderer.mjs',...(main?{main:'main.mjs'}:{})};
  const zip=path.join(output,id+'.zip'),entries=[{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'renderer.mjs',data:Buffer.from(renderer)}];
  if(main)entries.push({name:'main.mjs',data:Buffer.from(main)});
  await writeFile(zip,encodeZip(entries));await call('extensions/import',{filePath:zip});return(await call('extensions/list')).find(p=>p.manifest.id===id);
};
const toggle=(p,enabled)=>call('extensions/toggle',{id:p.manifest.id,hash:p.hash,enabled,approveHost:enabled});
try{
  await launch();await call('plugins/set-enabled',{id:'translation',enabled:false});await call('theme/set',{theme:'dark'});
  const connection=await call('model-api/save',{connection:{name:'合成引用服务',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol:'chat-completions',auth:'none',models:[{id:'fixture',model:'citation-fixture',name:'引用验收模型',enabled:true}]},key:''});
  const target=(await call('model-targets/list')).find(t=>t.runtime==='codex'&&t.binding.modelConnectionId===connection.id);assert.ok(target?.ready);
  const session=await call('session/create',{modelTargetId:target.id});await open(session.id);
  await send('Return the citation fixture.');
  let saved=(await call('state/get')).sessions.find(s=>s.id===session.id),reply=saved.messages.find(m=>m.role==='assistant');
  assert.ok(reply);assert.equal(reply.original.trim(),'原生记忆引用验收完成。');assert.deepEqual(reply.memoryReferences,[{path:'MEMORY.md',title:'Export conventions',source:'native-citation'}]);
  let memory=page.getByTestId('reply-memory');await memory.waitFor();assert.equal(await memory.count(),1);
  assert.equal(await memory.evaluate(e=>e.closest('[data-turn-reply]').dataset.turnReply),'complete');
  await memory.hover();await page.getByRole('tooltip').filter({hasText:'Export conventions'}).waitFor();assert.match(await page.getByRole('tooltip').innerText(),/MEMORY.md/);
  assert.equal(await memory.evaluate(e=>getComputedStyle(e.closest('footer')).opacity),'1');
  await page.screenshot({path:path.join(output,'memory-dark.png')});
  await memory.click();assert.equal((await call('state/get')).sessions.length,1);
  await page.getByRole('button',{name:'复制回复',exact:true}).click();assert.equal((await app.evaluate(()=>globalThis.copiedReply)).trim(),'原生记忆引用验收完成。');
  record('real Codex strips markup; structured field persists and drives one footer icon with source tooltip');
  await call('theme/set',{theme:'light'});await memory.focus();await page.getByRole('tooltip').waitFor();await page.screenshot({path:path.join(output,'memory-light.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));await memory.scrollIntoViewIfNeeded();await memory.focus();
  const box=await page.getByRole('tooltip').boundingBox();assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=860&&box.y+box.height<=640);await page.screenshot({path:path.join(output,'memory-narrow.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);record('keyboard tooltip and light/dark narrow layouts remain readable');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,860));
  await send('No citation fixture.');assert.equal(await memory.count(),1);saved=(await call('state/get')).sessions.find(s=>s.id===session.id);assert.deepEqual(saved.messages.filter(m=>m.role==='assistant').at(-1).memoryReferences,[]);
  await app.close();app=undefined;await launch();memory=page.getByTestId('reply-memory');await open(session.id);await memory.waitFor();assert.equal(await memory.count(),1);record('no-citation reply inherits no source; native citation survives application restart');
  await send('Return another citation fixture.');assert.equal(await memory.count(),2);memory=memory.first();
  const renderer=`export function activate(api){
    api.observeSurfaces('reply-memory','replace',({root,target,signal})=>{
      root.dataset.testid='citation-plugin';root.textContent='记忆引用插件';
      const id=target.closest('[data-reply-id]').dataset.replyId;
      const paint=state=>{const m=state.sessions.flatMap(s=>s.messages).find(m=>m.id===id);if(!signal.aborted)root.title=(m?.memoryReferences??[]).map(r=>r.title).join(', ');};
      const release=api.onState(paint);api.call('state/get').then(paint);return release;
    });
  }`;
  const main=`export function activate(api){api.runtimes.register({apiVersion:1,id:'plugin:qa.memory-source',name:'合成记忆运行时',description:'Synthetic citation source',permissions:[{value:'default',label:'默认',description:'Synthetic only'}]}, {async run(ctx){await ctx.emit({type:'message',id:'answer',text:${JSON.stringify('插件引用验收。\n'+citation)},phase:'final'});},async stop(){}});}`;
  const plugin=await importPlugin('qa.memory-source',renderer,main);await toggle(plugin,true);
  await page.getByTestId('citation-plugin').first().waitFor();assert.equal(await page.getByTestId('citation-plugin').count(),2);assert.equal(await page.getByTestId('reply-memory').evaluateAll(nodes=>nodes.every(e=>e.hidden&&getComputedStyle(e).display==='none')),true);await wait(async()=>(await page.getByTestId('citation-plugin').evaluateAll(nodes=>nodes.every(e=>e.title==='Export conventions'))),'plugin citation state read');
  const pluginTarget=(await call('model-targets/list')).find(t=>t.runtime==='plugin:qa.memory-source');assert.ok(pluginTarget?.ready);
  const pluginSession=await call('session/create',{modelTargetId:pluginTarget.id});await open(pluginSession.id);await send('Emit synthetic memory evidence.');
  await page.getByTestId('citation-plugin').waitFor();assert.equal(await page.getByTestId('citation-plugin').count(),1);await toggle(plugin,false);await memory.waitFor();assert.equal(await page.getByTestId('citation-plugin').count(),0);
  await open(session.id);await memory.waitFor();record('approved plugin registers a source runtime consumed by the selector and replaces existing and later citation surfaces');
  await toggle(plugin,true);await page.getByTestId('citation-plugin').first().waitFor();assert.equal(await page.getByTestId('citation-plugin').count(),2);
  const second=await importPlugin('qa.memory-overlay',`export function activate(api){api.observeSurfaces('reply-memory','replace',({root})=>{root.dataset.testid='citation-overlay';root.textContent='第二引用视图';});}`);await toggle(second,true);await page.getByTestId('citation-overlay').first().waitFor();assert.equal(await page.getByTestId('citation-overlay').count(),2);assert.equal(await page.getByTestId('citation-plugin').first().isVisible(),false);
  await toggle(second,false);await page.getByTestId('citation-plugin').first().waitFor();await toggle(plugin,false);await memory.waitFor();record('multiple plugin layers and re-enable restore all citation instances without changing saved evidence');
  const late=await importPlugin('qa.memory-late',`export function activate(api){window.releaseCitations=[];window.citationAborted=0;window.citationCleaned=0;api.observeSurfaces('reply-memory','replace',async({root,signal})=>{root.dataset.testid='citation-late';await new Promise(resolve=>window.releaseCitations.push(resolve));if(signal.aborted)window.citationAborted++;return()=>{window.citationCleaned++;};});}`);await toggle(late,true);await page.waitForFunction(()=>window.releaseCitations?.length===2);await toggle(late,false);await page.getByTestId('citation-late').first().waitFor({state:'detached'});await page.evaluate(()=>window.releaseCitations.forEach(resolve=>resolve()));await page.waitForFunction(()=>window.citationCleaned===2&&window.citationAborted===2);await memory.waitFor();assert.equal(await page.getByTestId('citation-late').count(),0);record('late asynchronous replacements clean up every instance after disable and preserve restored core icons');
  const bad=await importPlugin('qa.memory-failure',`export function activate(api){api.observeSurfaces('reply-memory','replace',()=>{throw Error('Synthetic citation render failure');});}`);await toggle(bad,true);await wait(async()=>(await call('extensions/list')).some(p=>p.manifest.id===bad.manifest.id&&!p.enabled),'failed renderer deactivation');await wait(async()=>await memory.isVisible(),'failed plugin restores native icon');await toggle(bad,false);
  assert.ok(path.resolve(plugin.directory).startsWith(path.resolve(data)+path.sep));
  await rename(plugin.directory,path.join(output,'retired-memory-plugin-'+Date.now()));await call('extensions/renderers');
  assert.ok(!(await call('extensions/list')).some(p=>p.manifest.id===plugin.manifest.id));await memory.waitFor();assert.equal((await call('state/get')).sessions.find(s=>s.id===session.id).messages.find(m=>m.id===reply.id).memoryReferences[0].title,'Export conventions');record('failed registration and package removal preserve core icon and persisted source metadata');
  assert.deepEqual(errors,[]);assert.equal(requests,3);
}finally{
  if(app)await app.close();await new Promise(resolve=>server.close(resolve));
  await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,requests,realModelCalls:0,scope:'Real installed Codex CLI against synthetic loopback responses; isolated hidden Electron and approved synthetic ZIP plugins.'},null,2));
}
