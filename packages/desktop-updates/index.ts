/** Desktop application updates are independent of native CLI maintenance. */
export function desktopUpdatesEnabled(options:{packaged:boolean;platform:NodeJS.Platform;testProfile:boolean;distribution:unknown}):boolean {
  return options.packaged&&options.platform==='win32'&&!options.testProfile&&options.distribution==='release';
}

export interface DesktopUpdateState {
  phase: 'disabled'|'idle'|'checking'|'downloading'|'ready'|'installing'|'error';
  version?: string;
  percent?: number;
  error?: string;
}
export interface DesktopUpdateBackend {
  check(): Promise<void>;
  install(): Promise<void>;
  subscribe(listener:(state:DesktopUpdateState)=>void):()=>void;
  dispose():void;
}
export interface DesktopUpdateRegistration {id:string; create():DesktopUpdateBackend}
export interface DesktopUpdatesApi {
  snapshot():DesktopUpdateState;
  check():Promise<DesktopUpdateState>;
  install():Promise<void>;
  subscribe(listener:(state:DesktopUpdateState)=>void):()=>void;
  register(definition:DesktopUpdateRegistration):()=>void;
}
/** Registration replaces the actual checker/installer, including the automatic timer. */
export class DesktopUpdates implements DesktopUpdatesApi {
  private state:DesktopUpdateState={phase:'disabled'};
  private listeners=new Set<(state:DesktopUpdateState)=>void>();
  private entries:DesktopUpdateRegistration[]=[];
  private backend?:DesktopUpdateBackend;
  private unsubscribe?:()=>void;
  private timer?:ReturnType<typeof setInterval>;
  private epoch=0;
  private stopped=false;
  private checking?:number;
  private started=false;
  private installing=false;
  constructor(private core:()=>DesktopUpdateBackend,private busy:()=>boolean,private enabled:boolean){}
  snapshot(){return structuredClone(this.state);}
  subscribe(listener:(state:DesktopUpdateState)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private publish(value:DesktopUpdateState){this.state=structuredClone(value);for(const listener of this.listeners)try{listener(this.snapshot());}catch{/* Observer failures do not own updates. */}}
  private activate(){
    const replacement=this.entries.at(-1)?.create()??this.core();
    const generation=this.epoch+1;let stop:()=>void;
    try{
      if(!replacement||!['check','install','subscribe','dispose'].every(key=>typeof replacement[key as keyof DesktopUpdateBackend]==='function'))throw Error('DESKTOP_UPDATE_REGISTRATION_INVALID');
      stop=replacement.subscribe(value=>{if(!this.stopped&&generation===this.epoch)this.publish(value);});
      if(typeof stop!=='function')throw Error('DESKTOP_UPDATE_REGISTRATION_INVALID');
    }catch(error){try{replacement?.dispose?.();}catch{}throw error;}
    this.epoch=generation;try{this.unsubscribe?.();}catch{}try{this.backend?.dispose();}catch{}this.backend=replacement;
    this.publish({phase:this.enabled?'idle':'disabled'});
    this.unsubscribe=stop;
  }
  start(){if(this.stopped||this.started)return;this.started=true;if(!this.backend)this.activate();if(this.enabled){void this.check();this.timer=setInterval(()=>void this.check(),5*60*1000);this.timer.unref();}}
  register(definition:DesktopUpdateRegistration){
    if(this.stopped||!definition||!/^plugin:[a-z0-9.-]+\/[a-z0-9-]+$/.test(definition.id)||typeof definition.create!=='function'||this.entries.some(x=>x.id===definition.id)||this.installing)throw Error('DESKTOP_UPDATE_REGISTRATION_INVALID');
    this.entries.push(definition);try{this.activate();}catch(error){this.entries.pop();throw error;}
    let live=true;return()=>{if(!live)return;live=false;const index=this.entries.indexOf(definition);if(index<0)return;const active=index===this.entries.length-1;this.entries.splice(index,1);if(active&&!this.stopped)this.activate();};
  }
  async check(){
    if(this.stopped||!this.enabled||!this.backend||this.checking===this.epoch||this.installing||this.state.phase==='ready'||this.state.phase==='installing')return this.snapshot();
    const generation=this.epoch;this.checking=generation;
    try{await this.backend.check();}catch{if(!this.stopped&&generation===this.epoch)this.publish({phase:'error',error:'DESKTOP_UPDATE_CHECK_FAILED'});}finally{if(this.checking===generation)this.checking=undefined;}
    return this.snapshot();
  }
  async install(){
    if(this.stopped||!this.enabled||this.installing||this.state.phase!=='ready'||!this.backend)throw Error('DESKTOP_UPDATE_NOT_READY');
    if(this.busy())throw Error('DESKTOP_UPDATE_SESSION_BUSY');
    this.installing=true;this.publish({...this.state,phase:'installing'});
    try{await this.backend.install();}catch{this.publish({phase:'error',error:'DESKTOP_UPDATE_INSTALL_FAILED'});throw Error('DESKTOP_UPDATE_INSTALL_FAILED');}finally{this.installing=false;}
  }
  dispose(){this.stopped=true;++this.epoch;if(this.timer)clearInterval(this.timer);this.unsubscribe?.();this.backend?.dispose();this.listeners.clear();}
}
