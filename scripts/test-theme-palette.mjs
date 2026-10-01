import { openWorkbenchSettings, navigateWorkbench } from './ui-control-helpers.mjs';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'build/qa'),directory=path.join(output,'theme-palette-'+Date.now());
await mkdir(directory,{recursive:true});const env={...process.env,AGENT_WORKBENCH_TEST_DATA:directory};delete env.ELECTRON_RUN_AS_NODE;
const baseline=JSON.parse(await readFile(path.join(output,'light-theme-before.json'),'utf8'));
const checks=[],errors=[];let app,light,dark;
const check=(name,run)=>{run();checks.push({name,passed:true});console.log('PASS '+name);};
const read=()=>{const result={tokens:{},elements:{}};const root=getComputedStyle(document.documentElement);for(const key of ['bg','side','surface','raised','text','muted','line','accent','accent-contrast','tint','hover','danger','warning','shadow'])result.tokens[key]=root.getPropertyValue('--'+key).trim();for(const selector of ['body','.sidebar','.composer','.original-pane','.translated-pane','.workspace-header']){const e=document.querySelector(selector);if(e){const s=getComputedStyle(e);result.elements[selector]={background:s.backgroundColor,color:s.color,border:s.borderColor};}}return result;};
const channels=value=>value.startsWith('#')?[0,2,4].map(i=>parseInt(value.slice(i+1,i+3),16)):value.match(/[\d.]+/g).slice(0,3).map(Number);
const luminance=value=>channels(value).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
try{
 app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env});const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
 await page.evaluate(()=>window.workbench.call('theme/set',{theme:'dark'}));await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');dark=await page.evaluate(read);
 check('all dark theme tokens and measured workspace colors remain exactly unchanged',()=>assert.deepEqual(dark,baseline.dark));
 await page.evaluate(()=>window.workbench.call('theme/set',{theme:'light'}));await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');light=await page.evaluate(read);
 check('light surfaces, ink, borders and hover use neutral or warm RGB ordering without a green cast',()=>{for(const name of ['bg','side','surface','raised','text','muted','line','hover']){const[r,g,b]=channels(light.tokens[name]);assert.ok(r>=g&&g>=b,`${name}: ${light.tokens[name]}`);}});
 check('paper reading area and white composer remain visually separated',()=>{assert.equal(light.tokens.bg,'#faf9f6');assert.equal(light.elements['.composer'].background,'rgb(255, 255, 255)');assert.equal(light.elements['.sidebar'].background,'rgb(239, 237, 232)');});
 check('main and secondary text meet 4.5 to 1 contrast on reading, white and sidebar surfaces',()=>{for(const foreground of ['text','muted'])for(const background of ['bg','surface','side'])assert.ok(contrast(light.tokens[foreground],light.tokens[background])>=4.5,`${foreground}/${background} contrast`);});
 await openWorkbenchSettings(page);await page.getByTestId('settings-appearance').click();const swatches=await page.locator('.theme-option.light .theme-preview,.theme-option.light .theme-preview>i,.theme-option.dark .theme-preview,.theme-option.dark .theme-preview>i').evaluateAll(elements=>elements.map(e=>getComputedStyle(e).backgroundColor));
 check('light-mode theme swatches match the paper palette and approved charcoal dark palette',()=>assert.deepEqual(swatches,['rgb(250, 249, 246)','rgb(239, 237, 232)','rgb(36, 36, 36)','rgb(30, 30, 30)']));
 check('theme changes have no renderer errors',()=>assert.deepEqual(errors,[]));
}finally{if(app)await app.close();await writeFile(path.join(output,'light-theme-report.json'),JSON.stringify({observedAt:new Date().toISOString(),screenshots:false,checks,errors,dark,light},null,2));}
console.log(`Light palette: ${checks.length}/${checks.length} passed; screenshots=false; darkUnchanged=true`);
