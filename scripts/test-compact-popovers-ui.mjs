import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Hidden, isolated renderer fixtures. No user state, credentials, CLI or provider.
const root = process.cwd(), output = path.resolve(process.env.AWB_COMPACT_UI_QA ?? 'build/qa/compact-popovers-20260928/ui');
await mkdir(output, { recursive: true });
const source = root.replaceAll('\\', '/');
await writeFile(path.join(output, 'fixture.tsx'), `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import SessionMetrics from '${source}/apps/desktop/renderer/SessionMetrics';
import PermissionSelector from '${source}/apps/desktop/renderer/PermissionSelector';
import {recordSessionUsage,metricsSource,sessionMetrics} from '${source}/packages/session-metrics';
import {createPluginSurfaces} from '${source}/apps/desktop/renderer/plugin-surfaces';
import '${source}/apps/desktop/renderer/styles.css';
import '${source}/apps/desktop/renderer/WorkspaceChrome.css';
const root=createRoot(document.getElementById('root'));let s,permissions={};
window.qaChanges=[];window.qaSurfaces=createPluginSurfaces();
function Permissions({options}){const [value,setValue]=useState(options.value??'plan');return <PermissionSelector {...options} value={value} onChange={value=>{window.qaChanges.push(value);setValue(value)}}/>}
function Fixture(){return <main className='qa-root'><div className='qa-composer'><textarea aria-label='任务输入' defaultValue='检查合成示例'/><div className='qa-toolbar'><Permissions key={permissions.runtime} options={permissions}/><span>模型与思考</span></div><SessionMetrics session={s}/></div></main>}
function render(){flushSync(()=>root.render(<Fixture/>))}
window.qaShow=(mode='single',runtime='claude',extras={})=>{
 s={id:'compact-fixture',title:'合成示例',projectId:null,pinned:false,archived:false,group:'',status:'idle',createdAt:'2026-01-01T00:00:00Z',binding:{runtime:'claude',egress:'vps',provider:'fixture',accountRef:'fixture',executionId:'local'},modelSelection:{model:'example-flash'},messages:[0,1].map(n=>({id:'u'+n,nativeTurnId:'t'+n,role:'user',original:'Synthetic input',timestamp:'2026-01-01T00:00:00Z',demo:false}))};
 if(mode!=='empty')recordSessionUsage(s,{id:'receipt',model:'example-flash',inputTokens:23347,outputTokens:778,cacheReadTokens:null,cacheWriteTokens:null,totalTokens:24125,elapsedMs:778/76.3*1000},{source:metricsSource(s),turnId:'t1',at:'2026-01-01T00:01:00Z'});
 if(mode==='multiple'||mode==='many'){
  for(let n=0;n<(mode==='many'?16:2);n++){
   s.binding.runtime=n%2?'claude':'codex';const model=mode==='many'?'example-long-model-name-'+n+'-'.repeat(90):n?'example-pro':'example-flash';
   recordSessionUsage(s,{id:'receipt-'+n,model,inputTokens:10000,outputTokens:1200,cacheReadTokens:8000,cacheWriteTokens:0,totalTokens:11200},{source:metricsSource(s),turnId:'extra'+n,at:'2026-01-01T00:02:00Z'});
  }
  s.binding.runtime='claude';s.modelSelection={model:'example-pro'};s.metrics.partialHistory=false;
 }
 if(mode==='zero'){s.metrics.records[0].cacheReadTokens=0;s.metrics.records[0].cacheWriteTokens=0;}
 if(mode==='unknown')s.metrics.records[0].model='';
 permissions={runtime,value:runtime==='claude'?'plan':'default',...extras};window.qaChanges=[];render();
};
window.qaSwitch=(runtime,model,receipt=false)=>{s={...s,binding:{...s.binding,runtime},modelSelection:{model}};if(receipt)recordSessionUsage(s,{id:'switch',model,inputTokens:1000,outputTokens:100,cacheReadTokens:null,cacheWriteTokens:null,totalTokens:1100},{source:metricsSource(s),turnId:'switch',at:'2026-01-01T00:03:00Z'});render()};
window.qaSnapshot=()=>sessionMetrics(s);
window.qaPermission=options=>{permissions={...permissions,...options};render()};
window.qaReady=true;
`);
await build({ entryPoints: [path.join(output, 'fixture.tsx')], outfile: path.join(output, 'fixture.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic' });
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>.qa-root{height:100vh;padding:36px;display:flex;align-items:flex-end;justify-content:center;background:var(--bg);box-sizing:border-box}.qa-composer{width:640px;max-width:100%;padding:12px;border:1px solid var(--line);border-radius:12px}.qa-composer textarea{width:100%;height:55px;resize:none;background:none;color:var(--text);border:0}.qa-toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;color:var(--muted);font-size:12px}.qa-composer .session-metrics{display:flex;justify-content:flex-end}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
await writeFile(path.join(output, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output,'isolated-data'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:900,height:680,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(output,'index.html'))})});app.on('window-all-closed',()=>app.quit());`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app;const checks=[],errors=[],sizes={};
const pass=label=>{checks.push(label);console.log('PASS '+label)};
try{
 app=await electron.launch({executablePath:electronPath,args:[path.join(output,'main.cjs')],cwd:root,env});
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>window.qaReady);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 const usage=page.getByTestId('session-metrics-details'),permission=page.getByTestId('permission-menu');
 const close=async()=>{await page.keyboard.press('Escape');await page.mouse.move(0,0)};
 const show=async(mode='single',runtime='claude',extras={})=>{await close();await page.evaluate(([m,r,e])=>window.qaShow(m,r,e),[mode,runtime,extras])};
 const openUsage=async()=>{await page.getByRole('button',{name:'会话用量明细',exact:true}).click();await usage.waitFor()};
 const openPermission=async()=>{await page.getByTestId('composer-permission').click();await permission.waitFor()};
 const fits=async locator=>{const box=await locator.boundingBox(),vp=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=vp.width&&box.y+box.height<=vp.height);assert.ok(await locator.evaluate(el=>el.scrollWidth<=el.clientWidth));return box};
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await show();await openUsage();
  sizes[theme+'Usage']=await fits(usage);assert.equal(sizes[theme+'Usage'].width,280);assert.ok(sizes[theme+'Usage'].height<=240);
  assert.match(await usage.innerText(),/24,125/);assert.equal(await usage.locator('.session-metrics-counts dt').filter({hasText:'缓存'}).count(),0);
  assert.match(await usage.locator('.session-metrics-cache').innerText(),/缓存命中\s*—/);
  const columns=await usage.evaluate(el=>[...el.querySelectorAll('.session-metrics-counts>div,.session-metrics-rates>div')].map(item=>item.getBoundingClientRect().x));
  assert.equal(columns[0],columns[2]);assert.equal(columns[1],columns[3]);
  await usage.screenshot({path:path.join(output,theme+'-usage.png')});await page.screenshot({path:path.join(output,theme+'-usage-context.png')});
  await close();await openPermission();sizes[theme+'Permissions']=await fits(permission);assert.equal(sizes[theme+'Permissions'].width,280);assert.ok(sizes[theme+'Permissions'].height<=254);
  const rows=await permission.getByRole('menuitemradio').evaluateAll(items=>items.map(item=>({height:item.getBoundingClientRect().height,checked:item.getAttribute('aria-checked')})));
  assert.equal(rows.length,4);assert.ok(rows.every(row=>row.height<=66));assert.equal(rows.filter(row=>row.checked==='true').length,1);
  assert.equal(await permission.locator('.permission-selector-copy>small:visible').count(),4);
  await permission.screenshot({path:path.join(output,theme+'-permissions.png')});await page.screenshot({path:path.join(output,theme+'-permissions-context.png')});pass(theme+' aligned usage columns, visible unknown cache rate and individual permission descriptions');
 }
 await show('multiple');await openUsage();assert.equal(await usage.locator('.session-metrics-group').count(),3);assert.equal(await usage.locator('details[open]').count(),0);
 assert.equal(await usage.locator('[data-selected=true]').count(),1);assert.match(await usage.locator('[data-selected=true]').innerText(),/example-pro.*Claude Code/s);
 await usage.screenshot({path:path.join(output,'multiple-models.png')});
 await usage.locator('summary').first().focus();await page.keyboard.press('Enter');assert.equal(await usage.locator('details[open]').count(),1);assert.match(await usage.locator('details[open]').innerText(),/23,347/);
 pass('runtime and model rows are visible; exact details expand individually by keyboard');
 await show();await openUsage();const totalBefore=(await page.evaluate(()=>window.qaSnapshot())).totalTokens;
 await page.evaluate(()=>window.qaSwitch('codex','example-flash'));assert.equal(await usage.isVisible(),true);assert.match(await page.getByTestId('session-metrics-selection').innerText(),/已选.*Codex.*暂无记录/s);
 assert.equal((await page.evaluate(()=>window.qaSnapshot())).totalTokens,totalBefore);assert.equal(await usage.locator('[data-selected=true]').count(),0);
 await usage.screenshot({path:path.join(output,'switched-no-receipt.png')});
 await page.evaluate(()=>window.qaSwitch('codex','example-flash',true));assert.equal(await page.getByTestId('session-metrics-selection').count(),0);assert.equal(await usage.locator('.session-metrics-group').count(),2);assert.match(await usage.locator('[data-selected=true]').innerText(),/Codex/);
 assert.equal((await page.evaluate(()=>window.qaSnapshot())).totalTokens,totalBefore+1100);
 await page.evaluate(()=>window.qaSwitch('claude','example-flash'));assert.match(await usage.locator('[data-selected=true]').innerText(),/Claude Code/);
 await usage.screenshot({path:path.join(output,'switched-with-receipt.png')});pass('switch without receipt, first receipt and switch-back keep historical totals and correct selected runtime');
 await page.evaluate(()=>window.qaSwitch('claude','example-next'));assert.match(await page.getByTestId('session-metrics-selection').innerText(),/example-next.*暂无记录/s);assert.equal(await usage.locator('[data-selected=true]').count(),0);pass('same-runtime model change is separate from historical receipts');
 await show('zero');await openUsage();assert.match(await usage.innerText(),/缓存命中\s*0%/);assert.equal(await usage.locator('.session-metrics-counts dt').filter({hasText:'缓存'}).count(),2);pass('reported zero caches stay visible');
 await show('unknown');await openUsage();assert.match(await usage.innerText(),/模型未上报/);assert.equal(await usage.locator('[data-selected=true]').count(),0);
 await show('empty');await openUsage();assert.match(await usage.innerText(),/尚未收到用量回执/);pass('unknown model and empty usage never invent selected-source totals');
 await show('many');await openUsage();assert.equal(await usage.locator('.session-metrics-group').count(),17);
 assert.ok(await usage.locator('.session-metrics-groups').evaluate(el=>el.scrollHeight>el.clientHeight&&el.clientHeight<=176));
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(360,500));await page.waitForTimeout(100);await fits(usage);
 const last=usage.locator('summary').last();await last.scrollIntoViewIfNeeded();await last.click();await fits(usage);
 assert.ok(await last.locator('.session-metrics-group-identity').getAttribute('title'));await page.screenshot({path:path.join(output,'many-models-narrow.png')});pass('many sources scroll in a bounded list; long model names and narrow viewport fit');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(900,680));await show();await openPermission();
 const checked=page.getByTestId('permission-option-plan');assert.equal(await checked.getAttribute('aria-checked'),'true');
 await page.getByTestId('permission-option-full-access').hover();assert.match(await page.getByTestId('permission-option-full-access').locator('small').innerText(),/跳过原生权限询问/);assert.equal(await checked.getAttribute('aria-checked'),'true');assert.deepEqual(await page.evaluate(()=>window.qaChanges),[]);
 await page.getByTestId('permission-option-default').focus();assert.match(await page.getByTestId('permission-option-default').locator('small').innerText(),/原生规则/);
 await page.keyboard.press('End');assert.equal(await page.getByTestId('permission-option-full-access').evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await permission.waitFor({state:'hidden'});
 assert.deepEqual(await page.evaluate(()=>window.qaChanges),['accept-edits']);assert.equal(await page.getByTestId('composer-permission').evaluate(el=>el===document.activeElement),true);pass('permission descriptions remain visible; hover does not save and keyboard selection emits one unchanged value');
 await openPermission();await page.keyboard.press('Escape');await permission.waitFor({state:'hidden'});
 await openPermission();await page.getByRole('textbox',{name:'任务输入'}).click();await permission.waitFor({state:'hidden'});assert.equal(await page.getByRole('textbox',{name:'任务输入'}).inputValue(),'检查合成示例');
 await openPermission();await page.evaluate(()=>window.qaPermission({pending:true}));await permission.waitFor({state:'hidden'});assert.equal(await page.getByTestId('composer-permission').isDisabled(),true);pass('Escape, outside click and pending state dismiss safely and preserve the draft');
 for(const runtime of ['codex','api','plugin:fixture']){
  const extras=runtime.startsWith('plugin:')?{extension:{name:'扩展运行时',permissions:[{value:'default',label:'扩展默认',description:'扩展运行时提供的权限说明。'},{value:'plugin:fixture',label:'扩展自定义',description:'仅此插件定义的执行范围。'}]}}:{};
  await show('single',runtime,extras);await openPermission();assert.equal(await permission.getByRole('menuitemradio').count(),runtime.startsWith('plugin:')?2:3);await fits(permission);
  if(runtime.startsWith('plugin:')){await page.getByTestId('permission-option-plugin:fixture').click();assert.deepEqual(await page.evaluate(()=>window.qaChanges),['plugin:fixture']);}
 }
 pass('Codex, API and registered runtime permissions retain their own option values');
 await show();await openPermission();await page.evaluate(()=>window.qaPermission({runtime:'codex',value:'default'}));await permission.waitFor({state:'hidden'});pass('runtime change closes the old permission menu');
 await show();await openPermission();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(360,420));await page.waitForTimeout(100);await fits(permission);await permission.screenshot({path:path.join(output,'narrow-permissions.png')});
 await page.evaluate(()=>{window.qaMount=window.qaSurfaces.mount('fixture','[data-permission-selector]','replace');window.qaMount.root.textContent='扩展权限'});await permission.waitFor({state:'hidden'});
 await page.evaluate(()=>window.qaMount.dispose());assert.equal(await page.getByTestId('composer-permission').isVisible(),true);await openPermission();await fits(permission);pass('permission viewport anchoring and plugin replacement restore the core control');
 assert.deepEqual(errors,[]);pass('zero renderer errors');
}finally{await app?.close();await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,sizes,syntheticOnly:true,realModelCalls:0},null,2))}
