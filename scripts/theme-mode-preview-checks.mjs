import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

export async function checkThemeModePreview({page,app,call,css,record,output}) {
  const previous=(await call('state/get')).theme;
  const preview=page.getByTestId('theme-system').locator('.theme-preview');
  await page.getByTestId('theme-system').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="theme-system"]').getAttribute('aria-pressed')==='true');
  try {
    for(const colorScheme of ['light','dark'])for(const zoom of [1,1.25,1.5]) {
      await page.emulateMedia({colorScheme});
      await page.waitForFunction(mode=>document.documentElement.dataset.theme===mode,colorScheme);
      await app.evaluate(({BrowserWindow},zoom)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom),zoom);
      await preview.scrollIntoViewIfNeeded();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const rect=await preview.boundingBox(),group=await page.locator('.appearance-modes').boundingBox();
      // Capture the native viewport: CDP screenshot clips use unscaled coordinates under Electron zoom.
      const {samples,splits,icons}=await app.evaluate(async({BrowserWindow,nativeImage},{rect,group})=>{
        const contents=BrowserWindow.getAllWindows()[0].webContents,zoom=contents.getZoomFactor();
        const frame=await contents.capturePage(),screen=nativeImage.createFromBuffer(frame.toPNG({scaleFactor:1}));
        const crop=box=>screen.crop({x:Math.round(box.x*zoom),y:Math.round(box.y*zoom),width:Math.round(box.width*zoom),height:Math.round(box.height*zoom)});
        const image=crop(rect),{width,height}=image.getSize(),pixels=image.toBitmap();
        const luminance=(x,y)=>{
          const offset=(Math.floor(y*height)*width+x)*4;
          return (pixels[offset]+pixels[offset+1]+pixels[offset+2])/3;
        };
        const rows=[0.72,0.82,0.9];
        const samples=rows.map(y=>[0.1,0.2,0.32,0.65,0.85].map(x=>luminance(Math.floor(x*width),y)));
        const splits=rows.map(y=>{
          let transitions=0,edge=-1,previous=true;
          for(let x=Math.ceil(width*0.07);x<width*0.93;x++){
            const light=luminance(x,y)>128;
            if(light!==previous){transitions++;edge=x/width;}previous=light;
          }
          return {transitions,edge};
        });
        return {samples,splits,icons:crop(group).toPNG().toString('base64')};
      },{rect,group});
      await writeFile(path.join(output,`mode-icons-${colorScheme}-${zoom*100}.png`),Buffer.from(icons,'base64'));
      // Blank rows cross a single sloping boundary; a separate sidebar wedge adds transitions.
      for(const row of samples){assert.ok(row.slice(0,3).every(value=>value>190),`Unexpected dark wedge on the light side: ${colorScheme}/${zoom}: ${JSON.stringify(samples)}`);assert.ok(row.slice(3).every(value=>value<90),`Unexpected light wedge on the dark side: ${colorScheme}/${zoom}: ${JSON.stringify(samples)}`);}
      for(const split of splits){assert.equal(split.transitions,1,JSON.stringify(splits));assert.ok(split.edge>0.3&&split.edge<0.65,JSON.stringify(splits));}
      assert.ok(splits[0].edge-splits[2].edge>=0.015,`Expected a visible diagonal: ${colorScheme}/${zoom}: ${JSON.stringify(splits)}`);
      assert.equal((await call('state/get')).theme,'system');
    }
    record('system preview pixels have one diagonal light/dark split without a sidebar wedge at 100%, 125% and 150% zoom in both modes');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    const id='qa.mode-preview',baseOutline=await css('.appearance-modes .theme-preview','outlineStyle');
    await call('qa/plugin-import',{id,source:`export async function activate(api){api.addStyle('.appearance-modes .theme-preview{outline:2px solid #3c78be}');await api.call('theme/set',{theme:'system'});}`});
    await call('qa/plugin-toggle',{id,enabled:true,approve:true});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.appearance-modes .theme-preview')).outlineWidth==='2px');
    assert.equal(await css('.appearance-modes .theme-preview','outlineColor'),'rgb(60, 120, 190)');
    for(const colorScheme of ['light','dark']){await page.emulateMedia({colorScheme});await page.waitForFunction(mode=>document.documentElement.dataset.theme===mode,colorScheme);}
    await call('qa/plugin-toggle',{id,enabled:false});
    await page.waitForFunction(expected=>getComputedStyle(document.querySelector('.appearance-modes .theme-preview')).outlineStyle===expected,baseOutline);
    assert.equal(await page.locator(`style[data-plugin="${id}"]`).count(),0);
    assert.equal((await call('state/get')).theme,'system');
    await call('qa/plugin-toggle',{id,enabled:true});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.appearance-modes .theme-preview')).outlineWidth==='2px');
    await call('qa/plugin-toggle',{id,enabled:false});
    await page.waitForFunction(expected=>getComputedStyle(document.querySelector('.appearance-modes .theme-preview')).outlineStyle===expected,baseOutline);
    assert.equal(await page.locator(`style[data-plugin="${id}"]`).count(),0);
    record('approved plugin mode calls and removable appearance styling survive system switching, disable and re-enable');
  } finally {
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await call('theme/set',{theme:previous});await page.evaluate(()=>window.qaRefresh());await page.emulateMedia({colorScheme:null});
  }
}
