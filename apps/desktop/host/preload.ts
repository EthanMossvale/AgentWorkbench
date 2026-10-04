import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppState, ApiResult, DesktopCommand } from '../../../packages/contracts/index';
import { createStateReceiver, type StatePatch } from '../../../packages/session-core/state-stream';
// Core pushes (state, plugin events, extension notices, navigation) arrive on a
// dedicated port straight from the core process; the same channels may still be
// sent by the UI process over IPC. Both feed one set of listeners per channel.
type Channel='state-patch'|'plugin-event'|'extensions'|'navigate';
const listeners=new Map<Channel,Set<(payload:unknown)=>void>>();
const deliver=(channel:Channel,payload:unknown)=>{for(const listener of [...(listeners.get(channel)??[])])listener(payload);};
const listen=(channel:Channel,listener:(payload:unknown)=>void)=>{let set=listeners.get(channel);if(!set)listeners.set(channel,set=new Set());set.add(listener);return()=>{set!.delete(listener);};};
for(const channel of ['state-patch','plugin-event','extensions','navigate'] as Channel[])ipcRenderer.on('workbench:'+channel,(_event,payload)=>deliver(channel,payload));
let corePort:MessagePort|undefined,corePortId=0,received=0;
// A call's reply travels through the UI process, but the state it changed comes over the port.
// Hold the reply until the port messages the core posted before it have been delivered.
let fenced:{seq:number;release:()=>void}[]=[];
const releaseFenced=()=>{const ready=fenced.filter(item=>item.seq<=received);if(!ready.length)return;fenced=fenced.filter(item=>item.seq>received);for(const item of ready)item.release();};
ipcRenderer.on('workbench:core-port',(event,id:unknown)=>{const port=event.ports[0];if(!port)return;corePort?.close();corePort=port;corePortId=Number(id)||0;received=0;for(const item of fenced.splice(0))item.release();port.onmessage=message=>{const data=message.data as {type?:Channel;payload?:unknown};received++;if(data?.type)deliver(data.type,data.payload);releaseFenced();};port.start();});
async function call(method:string,payload:unknown={}){
  const result=await ipcRenderer.invoke('workbench:call',method,payload) as ApiResult&{fence?:{port:number;seq:number}};
  const fence=result.fence;if(fence&&corePort&&fence.port===corePortId&&fence.seq>received)await new Promise<void>(release=>{fenced.push({seq:fence.seq,release});});
  if(!result.ok)throw new Error(result.error);return result.value;
}
ipcRenderer.send('workbench:core-port');
// A complete state sent on the legacy channel (older hosts, test harnesses) replaces
// the merged state; the next incremental patch then resynchronises from the core.
ipcRenderer.on('workbench:state',(_event,state:AppState)=>{if(!state||!Array.isArray(state.sessions))return;const {sessions,...root}=state;deliver('state-patch',{revision:-1,base:null,root,removed:[],order:sessions.map(session=>session.id),sessions} satisfies StatePatch);});
const requestResync=()=>{if(corePort)corePort.postMessage({type:'resync'});else ipcRenderer.send('workbench:state-resync');};
// Legacy whole-state listeners merge here; each delivery copies the state across the
// context bridge, so the renderer uses onStatePatch and merges in its own world.
const legacyState=createStateReceiver(),legacyListeners=new Set<(state:AppState)=>void>();
listen('state-patch',patch=>{if(!legacyListeners.size)return;const state=legacyState.apply(patch as StatePatch);if(state==='resync'){requestResync();return;}for(const listener of legacyListeners)listener(state);});
contextBridge.exposeInMainWorld('workbench',Object.freeze({
  onPluginEvent(callback:(event:import('../../../packages/plugins-core').PluginHostEvent)=>void){return listen('plugin-event',event=>callback(event as import('../../../packages/plugins-core').PluginHostEvent));},
  onExtensions(callback:()=>void){return listen('extensions',()=>callback());},
  call,
  async attachFiles(files:File[]){if(!Array.isArray(files))throw new Error('附件列表无效。');const inputs=[];for(const file of files){const filePath=webUtils.getPathForFile(file);inputs.push(filePath?{filePath}:{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});}return call('attachments/import',{files:inputs});},
  async importSkillFile(file:File,provider:'codex'|'claude'){const filePath=webUtils.getPathForFile(file);if(!filePath)throw new Error('Drop a ZIP file saved on this computer.');return call('native-skills/import',{provider,filePath});},
  async importPluginFile(file:File){const filePath=webUtils.getPathForFile(file);if(!filePath)throw new Error('Drop a ZIP file saved on this computer.');return call('extensions/import',{filePath});},
  async importSshFile(file:File){const filePath=webUtils.getPathForFile(file);if(!filePath)throw new Error('请拖入已保存在本机的 SSH 文件。');return call('ssh/import-file',{filePath});},
  onState(callback:(state:AppState)=>void){legacyListeners.add(callback);return ()=>{legacyListeners.delete(callback);};},
  onStatePatch(callback:(patch:StatePatch)=>void){return listen('state-patch',patch=>callback(patch as StatePatch));},
  requestStateResync(){requestResync();},
  onNavigate(callback:(sessionId:string)=>void){return listen('navigate',id=>callback(id as string));},
  onCommand(callback:(command:DesktopCommand)=>void){const listener=(_event:unknown,command:DesktopCommand)=>callback(command);ipcRenderer.on('workbench:command',listener);return ()=>ipcRenderer.removeListener('workbench:command',listener);}
}));
