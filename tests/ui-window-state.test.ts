import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {UiPreferenceStore} from '../packages/ui-preferences/store';
import type {DesktopWindowState as StateType} from '../apps/desktop/host/window-state';

// Exercise production state capture without showing or maximizing a user's window.
class WindowFixture extends EventEmitter {
  rectangle={x:80,y:60,width:1200,height:800};maximized=false;fullscreen=false;minimized=false;zoom=0;
  webContents={setZoomLevel:(value:number)=>{this.zoom=value;},getZoomLevel:()=>this.zoom};
  isDestroyed(){return false;}isMaximized(){return this.maximized;}isFullScreen(){return this.fullscreen;}isMinimized(){return this.minimized;}
  setMinimumSize(){}getNormalBounds(){return {...this.rectangle};}
  setBounds(value:typeof this.rectangle){this.rectangle={...value};this.emit('resize');}
  setFullScreen(value:boolean){this.fullscreen=value;this.emit(value?'enter-full-screen':'leave-full-screen');}
  maximize(){this.maximized=true;this.emit('maximize');}unmaximize(){this.maximized=false;this.emit('unmaximize');}
}
test('native event capture restores maximized/fullscreen/zoom and preserves normal bounds and missing-monitor preferences',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-window-state-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=new UiPreferenceStore(directory);await store.load();await store.set('window.bounds',{x:2500,y:90,width:1200,height:800});
 const screen=Object.assign(new EventEmitter(),{getPrimaryDisplay:()=>({id:1,workArea:{x:0,y:0,width:1920,height:1080}}),getAllDisplays:()=>[{id:1,workArea:{x:0,y:0,width:1920,height:1080}}]});
 const result=await build({entryPoints:['apps/desktop/host/window-state.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['electron']});
 const module={exports:{}};new Function('require','module','exports',result.outputFiles[0]!.text)((id:string)=>{assert.equal(id,'electron');return {screen};},module,module.exports);
 const {DesktopWindowState}=module.exports as {DesktopWindowState:new(window:unknown,store:UiPreferenceStore)=>StateType};
 const first=new WindowFixture(),state=new DesktopWindowState(first,store);state.restore();await new Promise(resolve=>setTimeout(resolve,280));
 assert.notEqual(first.rectangle.x,2500);await state.flush();assert.equal((store.get('window.bounds').value as {x:number}).x,2500);
 first.maximize();first.setFullScreen(true);first.zoom=2;await state.zoomChanged();await state.flush();assert.equal(store.get('window.maximized').value,true);assert.equal(store.get('window.fullscreen').value,true);state.dispose();
 const reopened=new UiPreferenceStore(directory);await reopened.load();const second=new WindowFixture(),next=new DesktopWindowState(second,reopened);next.restore();await new Promise(resolve=>setTimeout(resolve,280));assert.equal(second.maximized,true);assert.equal(second.fullscreen,true);assert.equal(second.zoom,2);assert.equal((reopened.get('window.bounds').value as {x:number}).x,2500);
 second.setFullScreen(false);second.unmaximize();second.setBounds({x:100,y:120,width:1000,height:750});await next.flush();assert.deepEqual(reopened.get('window.bounds').value,second.rectangle);assert.equal(reopened.get('window.maximized').value,false);assert.equal(reopened.get('window.fullscreen').value,false);
 second.minimized=true;second.setBounds({x:0,y:0,width:200,height:200});await next.flush();assert.equal((reopened.get('window.bounds').value as {width:number}).width,1000);next.dispose();assert.equal(screen.listenerCount('display-removed'),0);
});
