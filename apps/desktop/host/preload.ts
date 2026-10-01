import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppState, ApiResult, DesktopCommand } from '../../../packages/contracts/index';
async function call(method:string,payload:unknown={}){const result:ApiResult=await ipcRenderer.invoke('workbench:call',method,payload);if(!result.ok)throw new Error(result.error);return result.value;}
contextBridge.exposeInMainWorld('workbench',Object.freeze({
  onPluginEvent(callback:(event:import('../../../packages/plugins-core').PluginHostEvent)=>void){const listener=(_event:unknown,event:import('../../../packages/plugins-core').PluginHostEvent)=>callback(event);ipcRenderer.on('workbench:plugin-event',listener);return()=>ipcRenderer.removeListener('workbench:plugin-event',listener);},
  onExtensions(callback:()=>void){const listener=()=>callback();ipcRenderer.on('workbench:extensions',listener);return()=>ipcRenderer.removeListener('workbench:extensions',listener);},
  call,
  async attachFiles(files:File[]){if(!Array.isArray(files)||files.length>10)throw new Error('一次最多添加 10 个附件。');const inputs=[];for(const file of files){if(file.size>20*1024*1024)throw new Error('单个附件不能超过 20 MB。');const filePath=webUtils.getPathForFile(file);inputs.push(filePath?{filePath}:{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});}return call('attachments/import',{files:inputs});},
  async importSkillFile(file:File,provider:'codex'|'claude'){const filePath=webUtils.getPathForFile(file);if(!filePath)throw new Error('Drop a ZIP file saved on this computer.');return call('native-skills/import',{provider,filePath});},
  async importPluginFile(file:File){const filePath=webUtils.getPathForFile(file);if(!filePath)throw new Error('Drop a ZIP file saved on this computer.');return call('extensions/import',{filePath});},
  async importSshFile(file:File){const filePath=webUtils.getPathForFile(file);if(!filePath)throw new Error('请拖入已保存在本机的 SSH 文件。');return call('ssh/import-file',{filePath});},
  onState(callback:(state:AppState)=>void){const listener=(_event:unknown,state:AppState)=>callback(state);ipcRenderer.on('workbench:state',listener);return ()=>ipcRenderer.removeListener('workbench:state',listener);},
  onNavigate(callback:(sessionId:string)=>void){const listener=(_event:unknown,sessionId:string)=>callback(sessionId);ipcRenderer.on('workbench:navigate',listener);return ()=>ipcRenderer.removeListener('workbench:navigate',listener);},
  onCommand(callback:(command:DesktopCommand)=>void){const listener=(_event:unknown,command:DesktopCommand)=>callback(command);ipcRenderer.on('workbench:command',listener);return ()=>ipcRenderer.removeListener('workbench:command',listener);}
}));
