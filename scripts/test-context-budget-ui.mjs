import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Actual settings component in a hidden Electron, using only synthetic state and API calls.
const root = process.cwd(), output = path.resolve(process.env.AWB_CONTEXT_UI_QA ?? 'build/qa/claude-compaction/ui');
await mkdir(output, { recursive: true });
const source = root.replaceAll('\\', '/');
await writeFile(path.join(output, 'fixture.tsx'), `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import ModelApiSettings from '${source}/apps/desktop/renderer/ModelApiSettings';
import '${source}/apps/desktop/renderer/styles.css';
const model={id:'fixture',model:'custom-context-model',name:'示例模型',enabled:true,contextWindow:400000,contextWindowSource:'upstream',metadataSource:'upstream'};
const connection={id:'synthetic',revision:'one',name:'上下文测试',baseUrl:'https://example.invalid/v1',protocol:'chat-completions',enabled:true,hasKey:false,models:[model],discoveredModels:[model]};
window.qaCalls=[];window.qaSaved=null;
function Fixture(){const[state,setState]=useState({modelConnections:[connection]});
window.__qaCall=async(method,payload)=>{window.qaCalls.push({method,payload});
if(method==='model-api/discover')return[{...model,contextWindow:512000}];
if(method==='model-api/save'){const saved={...connection,...payload.connection,revision:'two'};window.qaSaved=saved;setState({modelConnections:[saved]});return saved;}
throw Error('Unexpected fixture method: '+method);};
return <main className="qa-root"><ModelApiSettings state={state} refresh={async()=>{}} notify={()=>{}}/></main>}
createRoot(document.getElementById('root')).render(<Fixture/>);window.qaReady=true;`);
await build({ entryPoints: [path.join(output, 'fixture.tsx')], outfile: path.join(output, 'fixture.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', plugins: [{ name: 'isolated-api', setup(builder) {
  builder.onResolve({ filter: /^\.\/App$/ }, () => ({ path: 'fixture-api', namespace: 'qa' }));
  builder.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: 'export const api=(method,payload)=>window.__qaCall(method,payload);', loader: 'js' }));
} }] });
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>.qa-root{height:100vh;overflow:auto;background:var(--bg);padding:30px}.model-api-settings{margin:auto}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
await writeFile(path.join(output, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output, 'isolated-data'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1060,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(output, 'index.html'))});});app.on('window-all-closed',()=>app.quit());`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app; const checks = [], errors = [];
const record = message => { checks.push(message); console.log('PASS ' + message); };
try {
  app = await electron.launch({ executablePath: electronPath, args: [path.join(output, 'main.cjs')], env, cwd: root });
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.qaReady);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  const open = async () => { await page.getByRole('button', { name: '编辑', exact: true }).click(); await page.getByRole('button', { name: '编辑映射 fixture' }).click(); };
  await open();
  const capacity = page.getByRole('spinbutton', { name: '上下文上限 fixture' }), budget = page.getByRole('textbox', { name: '自动压缩预算 fixture' });
  assert.equal(await budget.inputValue(), '360000'); assert.ok(await budget.evaluate(input => input.readOnly));
  record('upstream capacity derives a read-only 90 percent budget in model details');
  await capacity.fill('258400'); assert.equal(await budget.inputValue(), '232560');
  record('non-round capacity updates the exact budget immediately');
  await page.getByTestId('model-api-discover').click(); assert.equal(await capacity.inputValue(), '258400'); assert.equal(await budget.inputValue(), '232560');
  record('directory refresh preserves an explicit manual capacity and its budget');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await budget.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'budget-' + theme + '.png') });
  }
  await page.setViewportSize({ width: 560, height: 900 }); await budget.scrollIntoViewIfNeeded();
  const geometry = await page.locator('.model-api-mapping').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  assert.ok(geometry.scroll <= geometry.width + 1, JSON.stringify(geometry));
  await page.screenshot({ path: path.join(output, 'budget-narrow.png') });
  record('light dark and narrow details render without horizontal overflow');
  await capacity.fill('32001'); assert.equal(await budget.inputValue(), '28800');
  await capacity.fill(''); assert.equal(await budget.inputValue(), ''); assert.equal(await budget.getAttribute('placeholder'), '待填写上下文上限');
  record('integer rounding and unknown capacity never invent a model window');
  await capacity.fill('258400'); await page.getByTestId('model-api-save').click();
  await page.getByTestId('model-api-editor').waitFor({ state: 'hidden' });
  const saved = await page.evaluate(() => window.qaSaved.models[0]);
  assert.equal(saved.contextWindow, 258400); assert.equal(saved.contextWindowSource, 'manual'); assert.equal(saved.model, 'custom-context-model'); assert.equal(saved.compactAt, undefined);
  await open(); assert.equal(await capacity.inputValue(), '258400'); assert.equal(await budget.inputValue(), '232560');
  record('save and reopen retain full model capacity without storing a reduced copy');
  assert.deepEqual(errors, []);
} finally {
  if (app) await app.close();
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, scope: 'Actual model settings in hidden Electron; synthetic state and mocked host API; no user settings or external requests.' }, null, 2));
}
