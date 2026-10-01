import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd(),output=path.resolve(process.env.AWB_IMAGE_UI_QA??'build/qa/generated-images/ui'),base=root.replaceAll('\\','/');await mkdir(output,{recursive:true});
await writeFile(path.join(output,'fixture.tsx'),`
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import {ToolActivity} from '${base}/apps/desktop/renderer/RuntimeTimeline';
import NativeChildConversation from '${base}/apps/desktop/renderer/NativeChildConversation';
import ImageViewerHost from '${base}/apps/desktop/renderer/ImageViewerHost';
import {startPluginRenderers} from '${base}/apps/desktop/renderer/plugin-renderer';
import '${base}/apps/desktop/renderer/styles.css';import '${base}/apps/desktop/renderer/ReadingPane.css';
const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;const c=canvas.getContext('2d');c.fillStyle='#eee8de';c.fillRect(0,0,640,400);c.fillStyle='#427b9b';c.beginPath();c.arc(320,175,105,0,Math.PI*2);c.fill();c.fillStyle='#384247';c.font='22px sans-serif';c.textAlign='center';c.fillText('Synthetic image delivery fixture',320,340);const preview=canvas.toDataURL();
const file={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',path:'<workspace>/generated_images/image-fixture.png',name:'image-fixture.png',size:12000,mime:'image/png',sha256:'fixture',storage:'source'};
window.qaCalls=[];window.qaEntries=[];
window.__qaCall=async(method,payload)=>{window.qaCalls.push({method,payload});if(method==='attachments/views')return [{...file,preview}];if(method==='attachments/image')return preview;if(method==='extensions/renderers')return window.qaEntries;if(method==='attachments/save-as')return true;return null;};
const bridge={call:window.__qaCall,onExtensions:fn=>{window.qaRefresh=fn;return()=>{}},onState:()=>()=>{},onNavigate:()=>()=>{},onCommand:()=>()=>{}};window.workbench=bridge;
window.qaStopPlugins=startPluginRenderers(bridge,document.getElementById('root'));
const root=createRoot(document.getElementById('root'));const at='2026-09-28T00:00:00Z';
window.qaShow=(status='saved',remoteCopy='removed',child=false)=>{const item={id:'codex:root:turn:image',runtime:'codex',kind:'tool',category:'image-generation',status:'completed',title:file.path,input:'A blue circle on white.',startedAt:at,updatedAt:at,turnId:'turn',imageDelivery:{status,remoteCopy,...(status==='saved'?{attachment:file}:{}),...(status==='failed'?{error:'GENERATED_IMAGE_FILE_CHANGED'}:{})}};const session={id:'session',title:'生成图像',binding:{runtime:'codex'},messages:[],nativeChildren:[{runtime:'codex',nativeChildId:'child',title:'设计图片',operation:'completed',status:'completed',updatedAt:at,messages:[]}],activities:[{...item,nativeChildId:'child'}]};flushSync(()=>root.render(<main className="qa-root"><section className="qa-content"><h2>生成图片</h2><ToolActivity item={item}/>{child&&<NativeChildConversation session={session} sessions={[session]} childId="child" enabled={false} onClose={()=>{}} onNavigate={()=>{}} copy={()=>{}} actions={{openFile:()=>{},report:()=>{},notify:()=>{}}}/>}<ImageViewerHost/></section></main>));};window.qaReady=true;
`);
await build({entryPoints:[path.join(output,'fixture.tsx')],outfile:path.join(output,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'fixture-api',setup(build){build.onResolve({filter:/^\.\/App$/},()=>({path:'fixture-api',namespace:'qa'}));build.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:'export const api=(method,payload)=>window.__qaCall(method,payload);',loader:'js'}));}}]});
await writeFile(path.join(output,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self' blob:;style-src 'self' 'unsafe-inline';img-src 'self' data:;connect-src 'none'"><link rel="stylesheet" href="fixture.css"><style>.qa-root{height:100vh;overflow:auto;background:var(--bg);padding:24px}.qa-content{max-width:740px;margin:auto;min-width:0}.qa-content h2{font-size:18px;font-weight:500}.qa-content .child-conversation-dock{position:relative;width:100%;max-width:none;height:470px;margin-top:24px}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
await writeFile(path.join(output,'main.cjs'),`const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output,'isolated-data'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1040,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(output,'index.html'))});});app.on('window-all-closed',()=>app.quit());`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let app;const checks=[],errors=[];const pass=text=>{checks.push(text);console.log('PASS '+text);};
try{
 app=await electron.launch({executablePath:electronPath,args:[path.join(output,'main.cjs')],env,cwd:root});const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>window.qaReady);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 await page.evaluate(()=>window.qaShow('saved','removed',true));await page.locator('.generated-image-result img').first().waitFor();assert.equal(await page.locator('.generated-image-result').count(),2);assert.equal(await page.locator('details[open]').count(),0);assert.ok(await page.locator('.generated-image-result img').first().evaluate(e=>e.complete&&e.naturalWidth>0));pass('root and actual child reader show image thumbnails outside collapsed tool details');
 await page.screenshot({path:path.join(output,'generated-light.png'),fullPage:true});
 await page.getByRole('button',{name:'查看附件 image-fixture.png',exact:true}).first().click();await page.getByTestId('image-viewer').waitFor();pass('generated attachment opens the native workbench image viewer');
 const save=page.getByRole('button',{name:/另存/}).first();await save.click();assert.ok(await page.evaluate(()=>window.qaCalls.some(c=>c.method==='attachments/save-as')));pass('image export uses the existing attachment export contract');
 await page.keyboard.press('Escape');await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.setViewportSize({width:420,height:800});await page.screenshot({path:path.join(output,'generated-dark-narrow.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));pass('dark narrow layout keeps previews and workspace paths within the viewport');
 await page.evaluate(()=>window.qaShow('receiving','pending'));await page.getByText('正在保存到本地工作区…',{exact:true}).waitFor();pass('receiving state is visible before local save completion');
 await page.evaluate(()=>window.qaShow('failed','retained'));await page.getByRole('alert').filter({hasText:'目标文件已变化'}).waitFor();assert.equal(await page.locator('.generated-image-result img').count(),0);pass('failed delivery does not pretend a local image exists');
 await page.evaluate(()=>window.qaShow('failed','not-applicable'));assert.ok(!(await page.getByRole('alert').innerText()).includes('远端'));pass('local image delivery failure does not claim remote storage');
 await page.evaluate(()=>window.qaShow('saved','retained'));await page.getByText('本地图片已保存；远端 PNG 清理未确认。',{exact:true}).waitFor();await page.screenshot({path:path.join(output,'cleanup-unconfirmed.png')});pass('unconfirmed remote cleanup remains distinct from successful local delivery');
 assert.deepEqual(errors,[]);
}finally{await app?.close();await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,scope:'Hidden isolated Electron; real production image components with synthetic attachment API'},null,2));}
