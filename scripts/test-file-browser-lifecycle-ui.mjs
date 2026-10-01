import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),output=process.env.AWB_FILE_LIFECYCLE_QA;
if(!output)throw Error('An isolated output directory is required.');
await mkdir(output,{recursive:true});const base=root.replaceAll('\\','/');
await writeFile(path.join(output,'fixture.tsx'),`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import FileBrowser from '${base}/apps/desktop/renderer/FileBrowser';
import ConnectionLayout from '${base}/apps/desktop/renderer/ConnectionLayout';
import{createPluginSurfaces}from '${base}/apps/desktop/renderer/plugin-surfaces';
import '${base}/apps/desktop/renderer/styles.css';import '${base}/apps/desktop/renderer/Connections.css';import '${base}/apps/desktop/renderer/RemoteResources.css';
window.qaCalls=[];
window.__qaCall=async(method,payload)=>{
  window.qaCalls.push({method,payload});
  if(method!=='files/browse')throw Error('Unexpected method: '+method);
  const match=payload.path.match(/^(.*?)(?::(\\d+))?$/),path=match[1],line=match[2]?Number(match[2]):undefined;
  return path.endsWith('.txt')?{path,parent:'/',kind:'text',content:'synthetic preview',line}:{path,parent:'/',kind:'directory',entries:[{path:path+'/file.txt',name:'file.txt',directory:false}]};
};
function Fixture(){
  const[reference,setReference]=useState({path:'/one'}),[active,setActive]=useState(true);
  window.qaReference=value=>flushSync(()=>setReference(value));window.qaVisible=value=>flushSync(()=>setActive(value));
  return <main className="connections-page"><ConnectionLayout filesOpen={active} navigation={<nav className="connection-host-tree">Synthetic connection</nav>} files={<FileBrowser reference={reference} roots={['/']} active={active} onClose={()=>setActive(false)} notify={()=>{}} report={error=>{throw error;}}/>}><section className="host-detail">Synthetic details</section></ConnectionLayout></main>;
}
window.qaSurfaces=createPluginSurfaces();createRoot(document.getElementById('root')).render(<Fixture/>);
`);
await build({entryPoints:[path.join(output,'fixture.tsx')],outfile:path.join(output,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'fixture-bridge',setup(build){
  build.onResolve({filter:/^\.\/App$/},()=>({path:'bridge',namespace:'fixture'}));
  build.onResolve({filter:/^\.\/CodePreview$/},()=>({path:'preview',namespace:'fixture'}));
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='bridge'?'export const api=(method,payload)=>window.__qaCall(method,payload);':"import React from 'react';export default function Preview({path,line}){return <pre data-testid='preview' data-path={path} data-line={line}>synthetic preview</pre>;}",loader:'tsx',resolveDir:root}));
}}]});
await writeFile(path.join(output,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';connect-src 'none';img-src 'self' data:;object-src 'none'"><link rel="stylesheet" href="fixture.css"><style>.connections-page{padding:24px;max-width:none}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
await writeFile(path.join(output,'main.cjs'),`const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output,'data'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(output,'index.html'))});});app.on('window-all-closed',()=>app.quit());`);
let app,page,failure;const checks=[],errors=[];
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
try{
  app=await electron.launch({executablePath:electronPath,args:[path.join(output,'main.cjs')],cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.locator('.file-tree-row[title="/one/file.txt"]').waitFor();
  await check('an external reference changes the existing local browser instead of reopening the old location',async()=>{
    await page.evaluate(()=>window.qaReference({path:'/two'}));await page.locator('.file-tree-row[title="/two/file.txt"]').waitFor();assert.equal(await page.getByRole('textbox',{name:'文件路径',exact:true}).inputValue(),'/two');
  });
  await check('file line references survive refresh; closing the browser clears previews',async()=>{
    await page.evaluate(()=>window.qaReference({path:'/alpha.txt',line:42}));await page.getByTestId('preview').waitFor();assert.equal(await page.getByTestId('preview').getAttribute('data-line'),'42');
    await page.getByRole('button',{name:'刷新文件',exact:true}).click();assert.equal(await page.getByTestId('preview').getAttribute('data-line'),'42');
    await page.evaluate(()=>window.qaReference({path:'/beta.txt'}));await page.getByRole('tab',{name:'beta.txt',exact:true}).waitFor();
    await page.getByRole('tab',{name:'alpha.txt',exact:true}).click();assert.deepEqual(await page.getByRole('tab').allTextContents(),['文件','alpha.txt','beta.txt']);
    await page.getByRole('button',{name:'关闭 beta.txt',exact:true}).click();assert.equal(await page.getByTestId('preview').getAttribute('data-path'),'/alpha.txt');
    assert.equal(await page.locator('.file-dock-header > button').count(),0);assert.equal(await page.getByRole('tab',{name:'文件',exact:true}).locator('..').getByRole('button',{name:'关闭文件面板',exact:true}).count(),1);
    await page.getByRole('button',{name:'关闭文件面板',exact:true}).click();await page.evaluate(()=>window.qaVisible(true));await page.getByRole('tab',{name:'文件',exact:true}).waitFor();assert.equal(await page.getByTestId('preview').count(),0);assert.equal(await page.getByRole('tab').count(),1);
  });
  await check('new references received while hidden take precedence when the panel opens',async()=>{
    await page.evaluate(()=>{window.qaVisible(false);window.qaReference({path:'/three'});});await page.evaluate(()=>window.qaVisible(true));await page.locator('.file-tree-row[title="/three/file.txt"]').waitFor();
  });
  await check('a registered surface replacement restores the actual split layout when disposed',async()=>{
    await page.evaluate(()=>{window.qaRelease=window.qaSurfaces.observe('fixture','connection-layout','replace',({root})=>{root.textContent='Replacement layout';},error=>{throw error;});});
    await page.getByText('Replacement layout',{exact:true}).waitFor();assert.equal(await page.getByTestId('file-dock').isVisible(),false);
    await page.evaluate(()=>window.qaRelease());await page.getByTestId('file-dock').waitFor();await page.getByTestId('connection-divider-files').waitFor();assert.equal(await page.getByRole('separator').count(),2);assert.equal(await page.locator('.file-tree-row[title="/three/file.txt"]').isVisible(),true);
  });
  assert.deepEqual(errors,[]);
}catch(error){failure=error;console.error(error);process.exitCode=1;if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}
finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({passed:checks.length,checks,errors,failure:failure?String(failure):null},null,2));}
