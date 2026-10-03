import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(), output = path.resolve(process.env.AWB_METRICS_UI_QA ?? 'build/qa/session-metrics/ui');
await mkdir(output, { recursive: true });
const entry = `
import {uiPreferences} from '${root.replaceAll('\\','/')}/apps/desktop/renderer/ui-preferences';
import {preferenceKey} from '${root.replaceAll('\\','/')}/packages/ui-preferences';
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import ModelControls from '${root.replaceAll('\\','/')}/apps/desktop/renderer/ModelControls';
import SessionMetrics from '${root.replaceAll('\\','/')}/apps/desktop/renderer/SessionMetrics';
import Workspace from '${root.replaceAll('\\','/')}/apps/desktop/renderer/Workspace';
import {recordSessionUsage,parseTokenCounts,metricsSource} from '${root.replaceAll('\\','/')}/packages/session-metrics';
import {createPluginSurfaces} from '${root.replaceAll('\\','/')}/apps/desktop/renderer/plugin-surfaces';
import '${root.replaceAll('\\','/')}/apps/desktop/renderer/styles.css';
import '${root.replaceAll('\\','/')}/apps/desktop/renderer/WorkspaceChrome.css';
const root=createRoot(document.getElementById('root'));let sequence=0;
const state={version:1,theme:'light',sessions:[],projects:[],hosts:[],profiles:[],plugins:{translation:{enabled:false}},translation:{},collaboration:{sessions:[],messages:[],outbox:[],pending:[]},modelConnections:[],runtimeExtensions:[]};
window.workbench={call:async(method)=>method==='state/get'?state:[],onExtensions:()=>()=>{},onState:()=>()=>{},onNavigate:()=>()=>{},onCommand:()=>()=>{}};
const preferenceState={schemaVersion:1,revision:0,entries:{}};const originalCall=window.workbench.call;window.workbench.call=async(method,p)=>{if(method==='ui-preferences/get')return structuredClone(preferenceState);if(method==='ui-preferences/update'){preferenceState.entries[preferenceKey(p.id,p.scope)]={value:p.value,revision:++preferenceState.revision};return structuredClone(preferenceState);}return originalCall(method,p);};const preferencesReady=uiPreferences.initialize(window.workbench);
window.__qaCall=window.workbench.call;
const session=(runtime='codex')=>({id:'fixture',title:'会话用量示例',binding:{runtime,egress:'vps',provider:'fixture',accountRef:'fixture',executionId:'local'},status:'idle',messages:[],createdAt:'2026-01-01T00:00:00Z',projectId:null,pinned:false,archived:false,group:''});
window.qaShow=(runtime='codex',mode='footer')=>{
 let s=session(runtime);
 if(mode!=='empty'){
  for(let n=0;n<4;n++)s.messages.push({id:'u'+n,nativeTurnId:'t'+n,role:'user',original:'检查合成用量',demo:false,timestamp:'2026-01-01T00:00:00Z'});
  const put=(runtime,model,id,input,output,cache,write)=>{s.binding.runtime=runtime;recordSessionUsage(s,{id,model,inputTokens:input,outputTokens:output,cacheReadTokens:cache,cacheWriteTokens:write,totalTokens:input+output,steps:runtime==='codex'?100:65,elapsedMs:output/164*1000},{source:runtime,turnId:'t3',at:'2026-01-01T00:01:00Z'})};
  put('codex','example-model-a', 'first',19000000,80000,18430000,null);
  put('claude','example-model-b', 'second',1700000,20000,1649000,12000);
  s.binding.runtime=runtime;s.metrics.partialHistory=false;
 }
 state.sessions=[s];window.qaSession=s;
 flushSync(()=>root.render(mode==='workspace'?<div className='qa-workspace'><Workspace key={++sequence} state={state} session={s} draft={{runtime,projectId:null,projectPath:''}} active={false} onDraftChange={()=>{}} onSwitchDraft={()=>{}} onCreateProject={()=>{}} ensureSession={async()=>s} report={e=>{throw e}} notify={()=>{}} refresh={async()=>state} onFork={async()=>{}} forkingId='' onOpenSource={()=>{}}/></div>:<main className='qa-root'><div className='qa-demo'><p className='qa-caption'>会话统计 · 合成数据</p><div className='qa-conversation'>所有运行时与模型共用会话累计记录</div><div className='composer'><textarea aria-label='任务输入' placeholder='描述你的任务…'/><div className='composer-toolbar'><span>＋　完全权限</span><span>example-model-b</span></div></div><div className='composer-options'><span className='auto-send-toggle'>开启翻译</span><SessionMetrics session={s}/></div></div></main>));
};
window.qaProvider=()=>{const s=session('claude');s.binding={runtime:'claude',provider:'source',accountRef:'model-api:source',executionId:'local',egress:'direct-api',modelConnectionId:'source',modelMappingId:'mapping',nativeSessionId:'thread'};s.modelSelection={model:'fixture-ds'};s.messages=[{id:'request',role:'user',original:'Synthetic request',timestamp:'2026-01-01T00:00:00Z',demo:false}];state.modelConnections=[{id:'source',name:'Fixture',models:[{id:'mapping',name:'fixture-ds',model:'fixture-ds',enabled:true,contextWindow:1000000}]}];recordSessionUsage(s,{id:'request',model:'fixture-ds',...parseTokenCounts({prompt_tokens:10240,completion_tokens:192,prompt_cache_hit_tokens:5120},'chat-completions')},{source:metricsSource(s),turnId:'request',at:'2026-01-01T00:00:02Z'});flushSync(()=>root.render(<main className='qa-root'><div className='qa-demo'><ModelControls state={state} session={s} runtime='claude' value={s.modelSelection} active={false} disabled={false} bindingLocked={false} onTarget={()=>{}} onChange={()=>{}}/><SessionMetrics session={s}/></div></main>));};
window.qaSurfaces=createPluginSurfaces();preferencesReady.then(()=>{window.qaReady=true;});
`;
await writeFile(path.join(output, 'fixture.tsx'), entry);
await build({ entryPoints: [path.join(output, 'fixture.tsx')], outfile: path.join(output, 'fixture.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.ttf': 'file' }, alias: { 'monaco-codicons': path.join(root,'node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css') }, plugins: [{ name: 'isolated-bridge', setup(build) { build.onResolve({filter:/^\.\/CodePreview$/},()=>({path:'qa-no-file-preview',namespace:'qa-preview'})); build.onLoad({filter:/.*/,namespace:'qa-preview'},()=>({contents:'export default function UnusedFilePreview(){return null}',loader:'js'})); build.onResolve({ filter: /^\.\/App$/ }, () => ({ path: 'fixture-api', namespace: 'qa' })); build.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: 'export const api=(method,payload)=>window.__qaCall(method,payload);', loader: 'js' })); } }] });
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>.qa-root{height:100vh;box-sizing:border-box;background:var(--bg);padding:32px;display:flex;align-items:flex-end;justify-content:center}.qa-demo{width:min(780px,100%);margin-bottom:24px}.qa-caption{color:var(--muted);font-size:12px}.qa-conversation{height:180px;color:var(--text);padding:20px 0}.qa-demo textarea{width:100%;min-height:54px;background:none;border:0;resize:none;color:var(--text)}.qa-demo .composer-toolbar{justify-content:space-between;color:var(--muted)}.qa-demo .composer-options{padding:8px 4px}.qa-workspace{height:100vh;width:100vw;display:flex}.qa-workspace>.workspace{width:100%}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
await writeFile(path.join(output, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output, 'isolated-data'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1100,height:780,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(output, 'index.html'))});});app.on('window-all-closed',()=>app.quit());`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app; const checks = [], errors = [];
const record = label => { checks.push(label); console.log('PASS ' + label); };
try {
  app = await electron.launch({ executablePath: electronPath, args: [path.join(output, 'main.cjs')], env, cwd: root });
  const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message)); await page.waitForFunction(() => window.qaReady);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  const show = async (runtime, mode) => { await page.evaluate(([runtime, mode]) => window.qaShow(runtime, mode), [runtime, mode]); await page.getByTestId('session-metrics').waitFor(); };
  for (const runtime of ['codex', 'claude', 'api', 'plugin:fixture']) {
    await show(runtime, 'footer'); assert.match(await page.getByTestId('session-metrics').innerText(), /4 轮 165 步/); assert.match(await page.getByTestId('session-metrics').innerText(), /164 tok\/s/);
    assert.match(await page.getByTestId('session-metrics').innerText(), /20.8M tok/); assert.match(await page.getByTestId('session-metrics').innerText(), /缓存命中 97%/); record(runtime + ' footer totals');
  }
  const trigger = page.getByRole('button', { name: '会话用量明细', exact: true }), details = page.getByTestId('session-metrics-details');
  const hover = async () => { await page.mouse.move(0, 0); await trigger.hover(); await details.waitFor(); };
  await trigger.hover(); await page.waitForTimeout(700); assert.equal(await details.count(), 0);
  await page.mouse.move(0, 0); await page.waitForTimeout(400); assert.equal(await details.count(), 0); record('hover under one second is cancelled on leave');
  await hover(); assert.equal(await page.locator('.session-metrics-group[open]').count(), 0);
  assert.equal(await page.getByTestId('session-metrics-group').count(), 2);
  assert.equal(await details.locator('p').count(), 0); await page.screenshot({ path: path.join(output, 'light-details.png') });
  await details.hover(); await page.waitForTimeout(250); assert.equal(await details.isVisible(), true); record('delayed preview remains open while reading the panel');
  await page.mouse.move(0, 0); await details.waitFor({ state: 'hidden' });
  await trigger.click(); await details.waitFor({ timeout: 600 }); await page.mouse.move(0, 0); await page.waitForTimeout(250); assert.equal(await details.isVisible(), true);
  await trigger.click(); await details.waitFor({ state: 'hidden' }); record('click opens immediately, pins, and toggles closed');
  await trigger.click(); await page.getByRole('textbox', { name: '任务输入' }).click(); await details.waitFor({ state: 'hidden' }); record('outside click dismisses pinned details');
  await trigger.focus(); await page.waitForTimeout(100); assert.equal(await details.count(), 0);
  await page.keyboard.press('Enter'); await details.waitFor(); assert.equal(await details.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape'); await details.waitFor({ state: 'hidden' }); assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Space'); await details.waitFor(); record('keyboard activation and Escape preserve focus without surprise focus popups');
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await page.screenshot({ path: path.join(output, 'dark-details.png') });
  for (const group of await page.getByTestId('session-metrics-group').all()) if(await group.getAttribute('open')===null)await group.locator('summary').click();
  assert.equal(await page.getByTestId('session-metrics-group').count(), 2);
  assert.match(await details.innerText(), /example-model-a/); assert.match(await details.innerText(), /Claude Code/);
  assert.match(await details.innerText(), /≤ 609,000/); assert.match(await details.innerText(), /输入（不含缓存）/); assert.match(await details.innerText(), /18,430,000/); assert.match(await details.innerText(), /12,000/);
  await page.screenshot({ path: path.join(output, 'expanded-models.png') }); record('compact source rows expand independently and retain exact counters');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(420, 640)); await page.waitForTimeout(100);
  const panel = await details.boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(panel && panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= viewport.width && panel.y + panel.height <= viewport.height);
  assert.equal(await details.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: path.join(output, 'narrow-details.png') }); record('expanded dark/narrow details fit the viewport');
  await page.keyboard.press('Escape'); await page.mouse.move(0,0); await show('claude', 'empty'); await trigger.click();
  assert.match(await details.innerText(), /尚未收到用量回执/); assert.match(await page.getByTestId('session-metrics').innerText(), /0 轮 0 步/);
  await page.screenshot({path:path.join(output,'empty-details.png')}); record('missing usage stays unknown with one short empty-state line');
  await page.getByRole('button',{name:'关闭用量明细'}).click(); await details.waitFor({state:'hidden'});
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 780)); await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  await show('codex', 'workspace'); await page.locator('.composer-area [data-session-metrics]').waitFor(); await hover(); assert.equal(await page.locator('.context-ring').count(), 1); await page.screenshot({ path: path.join(output, 'workspace-integration.png') }); record('real Workspace footer integrates beside existing context ring');
  await page.keyboard.press('Escape');
  await hover();
  await page.evaluate(() => { window.qaMount = window.qaSurfaces.mount('fixture-extension', '[data-session-metrics][data-session-id="fixture"]', 'replace'); window.qaMount.root.textContent = '插件统计'; });
  await details.waitFor({state:'hidden'}); assert.equal(await page.getByTestId('session-metrics').isVisible(), false); assert.equal(await page.getByText('插件统计', { exact: true }).isVisible(), true);
  await page.evaluate(() => window.qaMount.dispose()); assert.equal(await page.getByTestId('session-metrics').isVisible(), true); record('renderer replacement restores core footer on dispose');
  await page.evaluate(() => { window.qaRelease = window.qaSurfaces.observe('fixture-watch', '[data-session-metrics]', 'replace', ({ root, target }) => { root.textContent = '统计替换 ' + target.dataset.sessionId; }, error => { throw error; }); const added = document.createElement('div'); added.dataset.sessionMetrics = ''; added.dataset.sessionId = 'second-fixture'; added.id = 'qa-extra-metrics'; added.textContent = 'Second core footer'; document.body.append(added); });
  await page.getByText('统计替换 second-fixture', { exact: true }).waitFor(); assert.equal(await page.getByText('统计替换 fixture', { exact: true }).isVisible(), true);
  await page.evaluate(() => window.qaRelease()); assert.equal(await page.getByTestId('session-metrics').isVisible(), true); assert.equal(await page.locator('#qa-extra-metrics').isVisible(), true); await page.evaluate(() => document.getElementById('qa-extra-metrics').remove()); record('multi-instance observer replaces later insertion and restores every footer');
  await page.evaluate(()=>window.qaProvider());await hover();assert.equal(await page.locator('.session-metrics-counts dt').filter({hasText:'缓存写入'}).count(),1);assert.match(await page.getByTestId('session-metrics').innerText(),/缓存命中 50%/);await page.screenshot({path:path.join(output,'provider-cache.png')});assert.match(await details.innerText(),/≤ 5,120/);record('provider input excludes known cache with an explicit upper bound and unknown write counter');await page.keyboard.press('Escape');await page.getByTestId('context-ring').focus();await page.locator('#context-usage-tooltip').waitFor();assert.match(await page.locator('#context-usage-tooltip').innerText(),/10,432 \/ 1,000,000 tokens/);assert.doesNotMatch(await page.locator('#context-usage-tooltip').innerText(),/用量未知/);await page.screenshot({path:path.join(output,'provider-context.png')});record('current context recovers from the latest exact native-lane receipt');
  assert.deepEqual(errors, []); record('zero renderer errors');
} finally {
  await app?.close(); await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, syntheticOnly: true, realModelCalls: 0 }, null, 2));
}
