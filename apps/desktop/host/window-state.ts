import {screen,type BrowserWindow} from 'electron';
import {UiPreferenceStore} from '../../../packages/ui-preferences/store';
import {fitWindow,type WindowBounds} from '../../../packages/ui-preferences/window';
import type {UiValue} from '../../../packages/ui-preferences';

export class DesktopWindowState {
  private timer?:ReturnType<typeof setTimeout>;
  private suppress=0;private disposed=false;private active=false;
  private queue:Promise<unknown>=Promise.resolve();
  private effective='';private fittedBounds='';
  private unsubscribe:()=>void;
  constructor(private window:BrowserWindow,private preferences:UiPreferenceStore){
    window.on('move',this.schedule);window.on('resize',this.schedule);window.on('maximize',this.schedule);window.on('unmaximize',this.schedule);window.on('enter-full-screen',this.schedule);window.on('leave-full-screen',this.schedule);
    screen.on('display-added',this.refit);screen.on('display-removed',this.refit);screen.on('display-metrics-changed',this.refit);
    this.unsubscribe=preferences.subscribe(()=>{if(this.active&&!this.suppress&&this.signature()!==this.effective)this.restore();});
  }
  private areas(){const primary=screen.getPrimaryDisplay();return [primary,...screen.getAllDisplays().filter(d=>d.id!==primary.id)].map(d=>d.workArea);}
  bounds(){return fitWindow(this.preferences.get('window.bounds').value as unknown as WindowBounds,this.areas());}
  private signature(){return JSON.stringify(['window.bounds','window.maximized','window.fullscreen','window.zoom'].map(id=>this.preferences.get(id).value));}
  restore(){
    if(this.disposed||this.window.isDestroyed())return;
    this.suppress++;clearTimeout(this.timer);this.effective=this.signature();
    this.window.setFullScreen(false);if(this.window.isMaximized())this.window.unmaximize();
    const bounds=this.bounds();this.window.setMinimumSize(Math.min(860,bounds.width),Math.min(640,bounds.height));this.window.setBounds(bounds);this.fittedBounds=JSON.stringify(this.window.getNormalBounds());
    this.window.webContents.setZoomLevel(this.preferences.get('window.zoom').value as number);
    if(this.preferences.get('window.maximized').value)this.window.maximize();
    if(this.preferences.get('window.fullscreen').value)this.window.setFullScreen(true);
    setTimeout(()=>{this.suppress--;this.active=true;},250);
  }
  private refit=()=>this.restore();
  private schedule=()=>{if(!this.active||this.suppress||this.disposed)return;clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.capture();},180);};
  capture(){
    clearTimeout(this.timer);if(!this.active||this.suppress||this.disposed||this.window.isDestroyed()||this.window.isMinimized())return this.queue;
    const entries:[string,UiValue][]=[['window.maximized',this.window.isMaximized()],['window.fullscreen',this.window.isFullScreen()]];
    if(!this.window.isMaximized()&&!this.window.isFullScreen()){
      const bounds=this.window.getNormalBounds(),signature=JSON.stringify(bounds);
      if(signature!==this.fittedBounds){entries.unshift(['window.bounds',bounds as unknown as UiValue]);this.fittedBounds=signature;}
    }
    return this.save(entries);
  }
  zoomChanged(){if(!this.disposed&&!this.window.isDestroyed())return this.save([['window.zoom',Math.max(-3,Math.min(4,this.window.webContents.getZoomLevel()))]]);}
  private save(entries:[string,UiValue][]){
    const operation=this.queue.then(async()=>{
      this.suppress++;
      try{for(const [id,value] of entries)if(JSON.stringify(this.preferences.get(id).value)!==JSON.stringify(value))await this.preferences.set(id,value);this.effective=this.signature();}
      finally{this.suppress--;}
    });this.queue=operation.catch(()=>{});return operation.catch(()=>{/* Store preserves the previous file; renderer receives the error on next read. */});
  }
  async flush(){await this.queue;await this.capture();await this.queue;await this.preferences.flush();}
  dispose(){this.disposed=true;clearTimeout(this.timer);this.unsubscribe();this.window.removeListener('move',this.schedule);this.window.removeListener('resize',this.schedule);this.window.removeListener('maximize',this.schedule);this.window.removeListener('unmaximize',this.schedule);this.window.removeListener('enter-full-screen',this.schedule);this.window.removeListener('leave-full-screen',this.schedule);screen.removeListener('display-added',this.refit);screen.removeListener('display-removed',this.refit);screen.removeListener('display-metrics-changed',this.refit);}
}
