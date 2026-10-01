import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(), output = path.resolve('build/qa/context-usage-ui'), source = root.replaceAll('\\', '/');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'fixture.tsx'), `
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import ModelControls from '${source}/apps/desktop/renderer/ModelControls';
import{metricsSource,parseTokenCounts,recordSessionUsage}from'${source}/packages/session-metrics';
import '${source}/apps/desktop/renderer/styles.css';
const root=createRoot(document.getElementById('root'));
const model={id:'mapping',model:'context-fixture',name:'上下文测试模型',enabled:true,contextWindow:1000000};
const state={hosts:[],modelConnections:[{id:'source',revision:'one',name:'Fixture',models:[model]}]};
window.showContext=(mode)=>{
 const session={id:'fixture',title:'Fixture',status:'idle',messages:[],nativeTurnId:'turn',modelSelection:{model:model.model},binding:{runtime:'claude',provider:'source',executionId:'local',accountRef:'fixture',egress:'direct-api',modelConnectionId:'source',modelMappingId:model.id,nativeSessionId:'thread'},nativeContextUsage:{used:mode==='native'?80100:0,total:mode==='native'?80100:0,capacity:1000000,runtimeCapacity:900000,updatedAt:'2026-09-30T00:00:03Z',...(mode==='native'||mode==='zero'?{turnId:'turn'}:{})}};
 if(mode==='unknown')delete session.nativeContextUsage;
 else for(const[id,input,output,at]of[['first',90000,200,'01'],['last',80000,100,'02']])recordSessionUsage(session,{id,model:model.model,...parseTokenCounts({prompt_tokens:input,completion_tokens:output},'chat-completions')},{source:metricsSource(session),turnId:'turn',at:'2026-09-30T00:00:'+at+'Z'});
 flushSync(()=>root.render(<main className='qa-root'><div className='qa-composer'><p>描述你的任务…</p><ModelControls key={mode} state={state} session={session} runtime='claude' value={session.modelSelection} active={false} disabled={false} bindingLocked={false} onTarget={()=>{}} onChange={()=>{}}/></div></main>));
};window.showContext('legacy');window.qaReady=true;`);
await build({ entryPoints: [path.join(output, 'fixture.tsx')], outfile: path.join(output, 'fixture.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.ttf': 'file' }, plugins: [{ name: 'isolated-api', setup(builder) {
  builder.onResolve({ filter: /^\.\/App$/ }, () => ({ path: 'fixture-api', namespace: 'qa' }));
  builder.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: 'export const api=async()=>[];', loader: 'js' }));
} }] });
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>.qa-root{height:100vh;background:var(--bg);display:flex;align-items:flex-end;justify-content:center;padding:40px 20px;box-sizing:border-box}.qa-composer{width:min(760px,100%);border:1px solid var(--border);border-radius:20px;padding:18px;box-sizing:border-box}.qa-composer p{height:60px;color:var(--muted)}.qa-composer .model-controls{justify-content:flex-end}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
await writeFile(path.join(output, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output, 'isolated-data'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1000,height:700,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(output, 'index.html'))});});app.on('window-all-closed',()=>app.quit());`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const errors = [], checks = []; let app;
const pass = label => { checks.push(label); console.log('PASS ' + label); };
try {
  app = await electron.launch({ executablePath: electronPath, args: [path.join(output, 'main.cjs')], env, cwd: root });
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => window.qaReady);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  const show = async mode => { await page.evaluate(mode => window.showContext(mode), mode); await page.getByTestId('context-ring').focus(); await page.locator('#context-usage-tooltip').waitFor(); };
  for (const mode of ['legacy', 'native']) {
    await show(mode);
    assert.match(await page.locator('#context-usage-tooltip').innerText(), /8% 已使用/);
    assert.match(await page.locator('#context-usage-tooltip').innerText(), /80,100 \/ 1,000,000 tokens/);
    assert.match(await page.locator('#context-usage-tooltip').innerText(), /900,000 tokens/);
    assert.equal(await page.locator('.context-meter i').evaluate(element => element.style.width), '8%');
    pass(mode + ' context uses the latest request and retains the separate native budget');
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.screenshot({ path: path.join(output, theme + '.png') });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(420, 640));
  await show('legacy');
  const box = await page.locator('#context-usage-tooltip').boundingBox(), width = await page.evaluate(() => innerWidth);
  assert.ok(box && box.x >= 0 && box.x + box.width <= width);
  await page.screenshot({ path: path.join(output, 'narrow.png') }); pass('light, dark and narrow context popup stays within the viewport');
  await show('unknown'); assert.match(await page.locator('#context-usage-tooltip').innerText(), /用量未知/);
  assert.equal(await page.locator('.context-meter').count(), 0); pass('missing receipt remains unknown');
  await show('zero'); assert.match(await page.locator('#context-usage-tooltip').innerText(), /0% 已使用/);
  pass('explicit new native zero is not overwritten by older provider totals');
  assert.deepEqual(errors, []);
} finally {
  await app?.close(); await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, scope: 'Actual ModelControls in hidden Electron with synthetic state; no user app interaction.' }, null, 2));
}
