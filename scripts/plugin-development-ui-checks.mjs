import assert from 'node:assert/strict';
import path from 'node:path';
import { collectDirectory, encodeZip } from '../packages/native-resources/archive.ts';
import { openWorkbenchSettings, navigateWorkbench } from './ui-control-helpers.mjs';

export async function checkDevelopmentPluginUi({app,page,call,output,put,record}) {
  const zip=path.join(output,'developer-api.zip');
  await put(zip,encodeZip(await collectDirectory(path.resolve('examples/plugins/developer-api'))));
  await call('extensions/import',{filePath:zip});
  let plugin=(await call('extensions/list')).find(p=>p.manifest.id==='example.developer-api');
  await call('extensions/toggle',{id:plugin.manifest.id,hash:plugin.hash,enabled:true,approveHost:true});
  await navigateWorkbench(page,'workspace');
  await page.getByTestId('developer-api-panel').waitFor({state:'visible'});
  await page.getByRole('button',{name:'读取服务',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="developer-api-status"]')?.textContent?.includes('服务'));
  const status=await call('example/developer/status');
  for(const id of ['workbench.controller','workbench.state','runtime.native-provider','native.memory','native.cli','desktop.window','desktop.menu','translation'])assert.ok(status.services.includes(id),id);
  await call('local-cli/list');
  assert.ok((await call('example/developer/status')).nativeLists>status.nativeLists);
  assert.equal((await call('demo.sample/get')).input,'插件提供的离线示例');
  await page.getByRole('button',{name:'发送事件',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="developer-api-status"]')?.textContent==='事件已收到');
  record('approved plugin discovers live services, wraps native maintenance, replaces an existing request, adds a method and receives host events');
  await page.screenshot({path:path.join(output,'development-plugin-panel.png')});

  await openWorkbenchSettings(page,'plugins');
  await page.getByTestId('developer-api-panel').waitFor({state:'hidden'});
  await navigateWorkbench(page,'workspace');
  await page.getByTestId('developer-api-panel').waitFor({state:'visible'});
  assert.equal(await page.getByTestId('developer-api-panel').count(),1);
  await call('extensions/toggle',{id:plugin.manifest.id,hash:plugin.hash,enabled:false});
  await page.getByTestId('developer-api-panel').waitFor({state:'detached'});
  assert.notEqual((await call('demo.sample/get')).input,'插件提供的离线示例');
  assert.ok(!(await call('extensions/services')).some(s=>s.id==='example.developer'));
  record('partial surfaces follow navigation and disabling restores core requests and unregisters services');

  const manifest={schemaVersion:1,apiVersion:1,id:'qa.open-development',name:'QA development',description:'Isolated API check',version:'1.0.0',capabilities:['host'],main:'main.mjs',renderer:'renderer.mjs'};
  const main=`export function activate(api) {
    for(const prefix of ['extensions','native-memory','native-skills','native-plugins','local-cli'])api.registerMethod(prefix+'/qa-development',()=>prefix);
    api.services.override('native.memory',{status:()=>({replacement:'native-memory-service'})});
  }`;
  const renderer=`export function activate(api) {
    const first=api.mountSurface('sidebar','replace');first.root.dataset.testid='qa-sidebar-replacement';first.root.textContent='插件侧栏';
    const second=api.mountSurface('sidebar','replace');second.root.dataset.testid='qa-sidebar-replacement-last';second.root.textContent='后挂载的插件侧栏';
    window.__qaReleaseEarlierSurface=first.dispose;api.onDispose(()=>{delete window.__qaReleaseEarlierSurface;});
    const late=api.mountSurface('.qa-late-target','replace');late.root.dataset.testid='qa-late-replacement';late.root.textContent='延迟挂载';
  }`;
  const patchZip=path.join(output,'qa-open-development.zip');
  await put(patchZip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(main)},{name:'renderer.mjs',data:Buffer.from(renderer)}]));
  await call('extensions/import',{filePath:patchZip});plugin=(await call('extensions/list')).find(p=>p.manifest.id===manifest.id);
  await call('extensions/toggle',{id:plugin.manifest.id,hash:plugin.hash,enabled:true,approveHost:true});
  for(const prefix of ['extensions','native-memory','native-skills','native-plugins','local-cli'])assert.equal(await call(prefix+'/qa-development'),prefix);
  assert.deepEqual(await call('native-memory/get'),{replacement:'native-memory-service'});
  await page.getByTestId('qa-sidebar-replacement-last').waitFor({state:'visible'});
  assert.equal(await page.getByTestId('qa-sidebar-replacement').isVisible(),false);
  await page.evaluate(()=>window.__qaReleaseEarlierSurface());
  await page.getByTestId('qa-sidebar-replacement').waitFor({state:'detached'});
  assert.equal(await page.getByTestId('qa-sidebar-replacement-last').isVisible(),true);
  assert.equal(await page.getByTestId('sidebar').evaluate(e=>e.hidden),true);
  await page.evaluate(()=>{const target=document.createElement('div');target.className='qa-late-target';document.body.append(target);});
  await page.getByTestId('qa-late-replacement').waitFor({state:'visible'});
  await page.evaluate(()=>document.querySelector('.qa-late-target').remove());
  await page.getByTestId('qa-late-replacement').waitFor({state:'detached'});
  await page.evaluate(()=>{const target=document.createElement('div');target.className='qa-late-target';document.body.append(target);});
  await page.getByTestId('qa-late-replacement').waitFor({state:'visible'});
  await call('extensions/toggle',{id:plugin.manifest.id,hash:plugin.hash,enabled:false});
  await page.getByTestId('qa-sidebar-replacement-last').waitFor({state:'detached'});
  assert.equal(await page.getByTestId('sidebar').evaluate(e=>e.hidden),false);
  assert.equal((await call('native-memory/get')).replacement,undefined);
  assert.equal(await page.locator('.qa-late-target').evaluate(e=>e.hidden),false);
  await page.evaluate(()=>document.querySelector('.qa-late-target').remove());
  record('all formerly excluded namespaces and actual native service implementations are replaceable; late surfaces remount and restore');
}
