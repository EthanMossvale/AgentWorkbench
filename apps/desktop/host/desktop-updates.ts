import {NsisUpdater} from 'electron-updater';
import type {DesktopUpdateBackend,DesktopUpdateState} from '../../../packages/desktop-updates';

export function createDesktopUpdateBackend(beforeInstall:()=>Promise<void>,onFailure:()=>void=()=>{}):DesktopUpdateBackend {
  const updater=new NsisUpdater({provider:'generic',url:'https://ethanmossvale.github.io/AgentWorkbench/updates/'});
  updater.autoDownload=true;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;
  updater.disableDifferentialDownload=true;updater.logger=null;
  const listeners=new Set<(state:DesktopUpdateState)=>void>();let version:string|undefined,stopped=false,cancel:(()=>void)|undefined;
  const emit=(state:DesktopUpdateState)=>{if(!stopped)for(const listener of listeners)listener(state);};
  updater.on('checking-for-update',()=>emit({phase:'checking'}));
  updater.on('update-not-available',()=>emit({phase:'idle'}));
  updater.on('update-available',info=>{version=info.version;emit({phase:'downloading',version,percent:0});});
  updater.on('download-progress',info=>emit({phase:'downloading',version,percent:Math.max(0,Math.min(100,info.percent))}));
  updater.on('update-downloaded',info=>emit({phase:'ready',version:info.version,percent:100}));
  updater.on('error',()=>{onFailure();emit({phase:'error',error:'DESKTOP_UPDATE_DOWNLOAD_FAILED'});});
  return {
    async check(){if(stopped)return;const result=await updater.checkForUpdates();cancel=()=>result?.cancellationToken?.cancel();if(stopped){cancel();await result?.downloadPromise?.catch(()=>{});return;}await result?.downloadPromise;},
    async install(){await beforeInstall();updater.quitAndInstall(true,true);},
    subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener);};},
    dispose(){stopped=true;cancel?.();listeners.clear();updater.removeAllListeners();updater.on('error',()=>{});},
  };
}
