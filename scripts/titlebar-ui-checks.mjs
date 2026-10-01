import assert from 'node:assert/strict';
import path from 'node:path';
import {builtinThemes} from '../packages/appearance/themes.ts';
import {openThemeGroup} from './theme-preset-ui-checks.mjs';

const rgb=hex=>'rgb('+[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')+')';
export async function checkTitlebarAppearance({page,app,call,patch,css,record,output}) {
  const bar=page.getByTestId('desktop-titlebar'),file=page.getByTestId('desktop-menu-file');
  // Start independently of transient font-picker focus left by the preceding suite.
  await page.reload();await page.getByTestId('appearance-settings').waitFor();await bar.waitFor();
  const mode=async theme=>{await call('theme/set',{theme});await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);};
  const native=async(color,symbolColor)=>{
    await page.waitForFunction(async expected=>{
      const value=await window.workbench.call('qa/chrome');
      return value?.color===expected.color&&value?.symbolColor===expected.symbolColor;
    },{color,symbolColor});
  };
  const palette=async(colors)=>{
    await page.waitForFunction(expected=>{
      const style=getComputedStyle(document.querySelector('.desktop-titlebar'));
      return style.backgroundColor===expected.background&&style.color===expected.color;
    },{background:rgb(colors.side),color:rgb(colors.muted)});
    assert.equal(await css('.desktop-titlebar','backgroundColor'),rgb(colors.side));
    assert.equal(await css('.desktop-titlebar','color'),rgb(colors.muted));
    await native(colors.side,colors.muted);
  };
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,1000));
  await page.emulateMedia({colorScheme:null});
  // Offscreen Windows caption regions do not reliably dispatch CDP mouse hover.
  // Ask Chromium to render the real CSS pseudo-state; exercise actions by keyboard below.
  const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
  for(const preset of builtinThemes){
    await mode(preset.mode);await openThemeGroup(page);await page.getByTestId(`preset-${preset.id}`).click();
    await page.getByText('已保存，立即生效',{exact:true}).waitFor();await palette(preset.colors);
    await page.mouse.move(600,80);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const {root}=await cdp.send('DOM.getDocument');
    const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'[data-testid=desktop-menu-file]'});
    await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']});
    await page.waitForFunction(expected=>getComputedStyle(document.querySelector('[data-testid=desktop-menu-file]')).backgroundColor===expected,rgb(preset.colors.hover));
    assert.equal(await css('[data-testid=desktop-menu-file]','color'),rgb(preset.colors.text));
    await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
    if(['builtin.garden','builtin.sea','builtin.dusk'].includes(preset.id)){
      await page.getByTestId('theme-light').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`titlebar-${preset.id}.png`)});
    }
  }
  await cdp.detach();
  record('all twelve selected presets color the real titlebar, menu hover and actual native overlay calls');

  await patch({lightPreset:'builtin.garden',darkPreset:'builtin.dusk'});await call('theme/set',{theme:'system'});
  await page.waitForFunction(()=>document.querySelector('[data-testid=theme-system]').getAttribute('aria-pressed')==='true');
  for(const colorScheme of ['light','dark','light']){
    await page.emulateMedia({colorScheme});await page.waitForFunction(mode=>document.documentElement.dataset.theme===mode,colorScheme);
    const colors=builtinThemes.find(p=>p.id===`builtin.${colorScheme==='light'?'garden':'dusk'}`).colors;await palette(colors);
    await app.evaluate(()=>globalThis.qaDesktopMenu.refresh());await native(colors.side,colors.muted);
  }
  await page.reload();await bar.waitFor();await palette(builtinThemes.find(p=>p.id==='builtin.garden').colors);
  for(const zoom of [1,1.25,1.5]){
    await app.evaluate(({BrowserWindow},value)=>{BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value);globalThis.qaDesktopMenu.refresh();},zoom);
    assert.equal((await call('qa/chrome')).height,Math.round(46*zoom));assert.equal((await bar.boundingBox()).height,46);
  }
  await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1);globalThis.qaDesktopMenu.refresh();});
  record('system switching, native menu refresh, renderer reload and 100/125/150 percent zoom retain the selected chrome palette');

  const before=await call('qa/chrome');
  for(const payload of [{color:'transparent',symbolColor:'#123456'},{color:'#ffffff',symbolColor:'#000000',height:999},{}]){
    await assert.rejects(call('desktop/titlebar',payload),/APPEARANCE_INVALID_TITLEBAR/);assert.deepEqual(await call('qa/chrome'),before);
  }
  const id='qa.titlebar-theme',theme=`plugin:${id}/mint`;
  await call('qa/plugin-import',{id,source:`export function activate(api){api.themes.register({id:'mint',label:'插件薄荷',mode:'light',base:'builtin.garden',colors:{side:'#dcefe6',muted:'#435c50'}});}`,
    main:`export function activate(api){let finish;api.registerMethod('desktop/menu',()=>new Promise(resolve=>finish=resolve));api.registerCommand('close-menu',()=>{finish?.();finish=undefined;});api.registerCommand('set-chrome',p=>api.call('desktop/titlebar',p));}`});
  await assert.rejects(call('qa/plugin-toggle',{id,enabled:true}));await call('qa/plugin-toggle',{id,enabled:true,approve:true});
  await page.getByTestId('theme-light').click();await page.getByText('已保存，立即生效',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('style[data-workbench-appearance]'));
  await openThemeGroup(page,'plugin');await page.getByTestId(`preset-${theme}`).click();await page.getByText('已保存，立即生效',{exact:true}).waitFor();
  await native('#dcefe6','#435c50');assert.equal(await css('.desktop-titlebar','backgroundColor'),rgb('#dcefe6'));
  await file.focus();await page.keyboard.press('ArrowDown');await page.waitForFunction(()=>document.querySelector('[data-testid=desktop-menu-file]').getAttribute('aria-expanded')==='true');
  await page.waitForFunction(expected=>getComputedStyle(document.querySelector('[data-testid=desktop-menu-file]')).backgroundColor===expected,rgb('#e3eadb'));
  await call('qa/plugin-command',{id,name:'close-menu'});await page.waitForFunction(()=>document.querySelector('[data-testid=desktop-menu-file]').getAttribute('aria-expanded')==='false');
  await page.getByRole('button',{name:'后退',exact:true}).press('Enter');assert.equal(await page.evaluate(()=>window.qaBack),1);
  assert.equal(await page.getByRole('button',{name:'前进',exact:true}).isDisabled(),true);
  const toggle=page.getByTestId('sidebar-toggle');await toggle.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'false');await toggle.press('Enter');
  const direct=await call('qa/plugin-command',{id,name:'set-chrome',value:{color:'#123456',symbolColor:'#ffffff'}});assert.equal(direct.color,'#123456');await native('#123456','#ffffff');
  await page.evaluate(()=>window.qaTitlebar(false));await bar.waitFor({state:'detached'});await page.evaluate(()=>window.qaTitlebar(true));await bar.waitFor();await native('#dcefe6','#435c50');
  record('an approved plugin theme reaches the selector and native chrome; the public host call, remount, menu, history and sidebar interactions remain usable');

  const styleId='qa.titlebar-style';
  await call('qa/plugin-import',{id:styleId,source:`export function activate(api){api.addStyle('.desktop-titlebar{background:#d5e5f5;color:#354555}');api.observeSurfaces('titlebar','replace',({root,signal})=>{root.dataset.testid='qa-titlebar-replacement';root.textContent='插件导航栏';root.style.cssText='height:46px;flex-shrink:0;background:#d5e5f5;color:#354555';return()=>{window.qaTitlebarReleased=signal.aborted;};});}`});
  await call('qa/plugin-toggle',{id:styleId,enabled:true,approve:true});await page.getByTestId('qa-titlebar-replacement').waitFor();
  assert.equal(await css('.desktop-titlebar','display'),'none');await native('#d5e5f5','#354555');
  await page.evaluate(()=>window.qaTitlebar(false));await page.getByTestId('qa-titlebar-replacement').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.qaTitlebarReleased),true);
  await page.evaluate(()=>window.qaTitlebar(true));await page.getByTestId('qa-titlebar-replacement').waitFor();await native('#d5e5f5','#354555');
  await call('qa/plugin-toggle',{id:styleId,enabled:false});await page.getByTestId('qa-titlebar-replacement').waitFor({state:'detached'});assert.equal(await bar.isVisible(),true);await native('#dcefe6','#435c50');
  await call('qa/plugin-toggle',{id,enabled:false});await page.getByText(/所选主题暂不可用/).waitFor();await native('#efede8','#6c665f');assert.equal((await call('appearance/get')).lightPreset,theme);
  await call('qa/plugin-toggle',{id,enabled:true});await page.getByTestId('appearance-theme').filter({hasText:'插件薄荷'}).waitFor();await native('#dcefe6','#435c50');
  await call('qa/plugin-toggle',{id:styleId,enabled:true});await page.getByTestId('qa-titlebar-replacement').waitFor();await native('#d5e5f5','#354555');
  await call('qa/plugin-toggle',{id:styleId,enabled:false});await page.getByTestId('qa-titlebar-replacement').waitFor({state:'detached'});await native('#dcefe6','#435c50');
  record('coexisting approved theme and titlebar replacement plugins cover later instances, disable cleanup, saved-ID fallback and re-enable restoration');

  const hostId='qa.titlebar-host';
  await call('qa/plugin-import',{id:hostId,main:`export function activate(api){api.registerMethod('desktop/titlebar',p=>api.call('desktop/titlebar',{...p,color:'#112233'}));}`});
  await call('qa/plugin-toggle',{id:hostId,enabled:true,approve:true});await native('#112233','#435c50');
  await call('qa/plugin-toggle',{id:hostId,enabled:false});await native('#dcefe6','#435c50');
  await call('qa/plugin-toggle',{id:hostId,enabled:true});await native('#112233','#435c50');
  await call('qa/plugin-toggle',{id:hostId,enabled:false});await native('#dcefe6','#435c50');
  record('approved native titlebar method replacement restores the core palette on disable even when renderer CSS is unchanged');

  const lateId='qa.titlebar-late';
  await call('qa/plugin-import',{id:lateId,main:`export async function activate(api){let pending=false;await api.call('desktop/titlebar',{color:'#112233',symbolColor:'#ffffff'});api.registerMethod('desktop/titlebar',p=>new Promise(resolve=>{pending=true;setTimeout(()=>resolve(p),1000);}));api.registerCommand('pending',()=>pending);}`});
  await call('qa/plugin-toggle',{id:lateId,enabled:true,approve:true});
  await page.waitForFunction(async id=>window.workbench.call('qa/plugin-command',{id,name:'pending'}),lateId);
  await call('qa/plugin-toggle',{id:lateId,enabled:false});await native('#dcefe6','#435c50');
  record('a late native-method result after plugin disable cannot suppress reapplying the current core colors');

  const failed='qa.titlebar-failed';
  await call('qa/plugin-import',{id:failed,source:`export function activate(api){api.addStyle('.desktop-titlebar{background:#ff00ff}');throw Error('Synthetic titlebar activation failure');}`});
  await call('qa/plugin-toggle',{id:failed,enabled:true,approve:true});await page.waitForFunction(async id=>(await window.workbench.call('qa/plugin-status')).find(p=>p.manifest.id===id)?.enabled===false,failed);
  await native('#dcefe6','#435c50');assert.equal(await css('.desktop-titlebar','backgroundColor'),rgb('#dcefe6'));
  await call('qa/plugin-toggle',{id,enabled:false});await page.getByText(/所选主题暂不可用/).waitFor();await patch({lightPreset:'builtin.garden'});await palette(builtinThemes.find(p=>p.id==='builtin.garden').colors);
  record('malformed native palette requests and failed plugin activation cannot leave invalid or orphaned chrome colors');
}
