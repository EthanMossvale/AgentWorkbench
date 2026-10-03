import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppState, ApiResult, DesktopCommand } from '../../../packages/contracts/index';
import { createStateReceiver, type StatePatch } from '../../../packages/session-core/state-stream';
async function call(method:string,payload:unknown={}){const result:ApiResult=await ipcRenderer.invoke('workbench:call',method,payload);if(!result.ok)throw new Error(result.error);return result.value;}
// Legacy whole-state listeners merge here; each delivery copies the state across the
// context bridge, so the renderer uses onStatePatch and merges in its own world.
const legacyState=createStateReceiver(),legacyListeners=new Set<(state:AppState)=>void>();
ipcRenderer.on('workbench:state-patch',(_event,patch:StatePatch)=>{if(!legacyListeners.size)return;const state=legacyState.apply(patch);if(state==='resync'){ipcRenderer.send('workbench:state-resync');return;}for(const listener of legacyListeners)listener(state);});
contextBridge.exposeInMainWorld('workbench',Object.freeze({
  onPluginEvent(callback:(event:import('../../../packages/plugins-core').PluginHostEvent)=>void){const listener=(_event:unknown,event:import('../../../packages/plugins-core').PluginHostEvent)=>callback(event);ipcRenderer.on('workbench:plugin-event',listener);return()=>ipcRenderer.removeListener('workbench:plugin-event',listener);},
  onExtensions(callback:()=>void){const listener=()=>callback();ipcRenderer.on('workbench:extensions',listener);return()=>ipcRenderer.removeListener('workbench:extensions',listener);},
  call,
  async attachFiles(files:File[]){if(!Array.isArray(files))throw new Error('附件列表无效。');const inputs=[];for(const file of files){const filePath=webUtils.getPathForFile(file);inputs.push(filePath?{filePath}:{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});}return call('attachments/import',{files:inputs});},
  async importSkillFile(file:File,provider:'codex'|'claude'){const filePath=webUtils.getPathForFile(file);if(!filePath)throw new Error('Drop a ZIP file saved on this computer.');return call('native-skills/import',{provider,filePath});},
  async importPluginFile(file:File){const filePath=webUtils.getPathForFile(file);if(!filePath)throw new Error('Drop a ZIP file saved on this computer.');return call('extensions/import',{filePath});},
  async importSshFile(file:File){const filePath=webUtils.getPathForFile(file);if(!filePath)throw new Error('请拖入已保存在本机的 SSH 文件。');return call('ssh/import-file',{filePath});},
  onState(callback:(state:AppState)=>void){legacyListeners.add(callback);return ()=>{legacyListeners.delete(callback);};},
  onStatePatch(callback:(patch:StatePatch)=>void){const listener=(_event:unknown,patch:StatePatch)=>callback(patch);ipcRenderer.on('workbench:state-patch',listener);return ()=>ipcRenderer.removeListener('workbench:state-patch',listener);},
  requestStateResync(){ipcRenderer.send('workbench:state-resync');},
  onNavigate(callback:(sessionId:string)=>void){const listener=(_event:unknown,sessionId:string)=>callback(sessionId);ipcRenderer.on('workbench:navigate',listener);return ()=>ipcRenderer.removeListener('workbench:navigate',listener);},
  onCommand(callback:(command:DesktopCommand)=>void){const listener=(_event:unknown,command:DesktopCommand)=>callback(command);ipcRenderer.on('workbench:command',listener);return ()=>ipcRenderer.removeListener('workbench:command',listener);}
}));
