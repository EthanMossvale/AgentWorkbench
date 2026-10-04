import {DesktopUpdates,desktopUpdatesEnabled} from '../../../packages/desktop-updates';
import {createDesktopUpdateBackend} from './desktop-updates';
import { visualizationPresentation } from '../../../packages/visualizations/instructions';
import {brandingImage} from './branding';
import {UiPreferenceStore} from '../../../packages/ui-preferences/store';
import {DesktopWindowState} from './window-state';
import {FirstPresentation} from './first-presentation';
import { HtmlPreviewService } from './html-preview';
import {initializeAppData,resolveAppDataInstallation,type AppDataLocation} from '../../../packages/app-data';
import {relocateAppData} from '../../../packages/app-data/relocation';
import {DataDirectoryService} from '../../../packages/app-data/service';
import { protocol, nativeImage, app, BrowserWindow, ipcMain, dialog, clipboard, ClipboardItem, safeStorage, shell, nativeTheme, session as electronSession, utilityProcess, MessageChannelMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { safeError } from './controller';
import type { Theme } from '../../../packages/contracts/index';
import type { ShortcutSettings } from '../../../packages/shortcuts';
import {decodeGeneratedImage,imagePng} from './image-decoder';
import { installTray } from './tray';
import { DesktopNotifier, registerToastIdentity, toastAppId } from './notifications';
import { threadDeepLink } from '../../../packages/navigation';
import { installDesktopMenu, titlebarColors } from './desktop-menu';
import { isRecoveryGuardian, runRecoveryGuardian, startRecoveryGuardian, type RecoveryGuardian } from './plugin-recovery-guardian';
import { claudeReferenceFont, referenceFontResponse } from './claude-reference-font';
import { PluginRecoveryStore } from '../../../packages/plugins-core/recovery';
import { acknowledgePluginRepairDraft, readPluginRepairDraft, writeRecoveryLanguage } from '../../../packages/plugins-core/repair-draft';
import { repairCompatibilityBatch } from '../../../packages/plugins-core/compatibility-repair';
import type { PluginRecord } from '../../../packages/plugins-core';
import type { BrandingRegistry, BrandingSnapshot } from '../../../packages/branding';
import { CORE_PROCESS_FLAG, runCore, type CoreInit } from './core-process';
import { createRpcPeer, type CallFence } from './process-rpc';

// The same bundle runs as the UI process and, with CORE_PROCESS_FLAG, as the
// workbench core in an Electron utility process (see core-process.ts).
const isCoreProcess=process.argv.includes(CORE_PROCESS_FLAG);
if(isCoreProcess)void runCore((process as unknown as {parentPort:Parameters<typeof runCore>[0]}).parentPort).catch(error=>{console.error('WORKBENCH_CORE_FAILED',safeError(error));process.exit(1);});
if(!isRecoveryGuardian&&!isCoreProcess)protocol.registerSchemesAsPrivileged([{scheme:'awb-preview',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}},{scheme:'awb-font',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
if(!isCoreProcess)app.setName('AgentWorkbench');
const userDataOverride=process.env.AGENT_WORKBENCH_TEST_DATA;
const testRelocation=!!userDataOverride&&process.env.AGENT_WORKBENCH_TEST_RELOCATION==='1';
if(!isCoreProcess&&!isRecoveryGuardian&&userDataOverride&&/^\d{4,5}$/.test(process.env.AGENT_WORKBENCH_TEST_APP_PORT??''))app.commandLine.appendSwitch('remote-debugging-port',process.env.AGENT_WORKBENCH_TEST_APP_PORT!);
const hiddenQa=!!userDataOverride&&process.env.AGENT_WORKBENCH_TEST_HIDDEN==='1';
const installedLocation=isCoreProcess||userDataOverride||process.env.AGENT_WORKBENCH_HOME?undefined:resolveAppDataInstallation({platform:process.platform,packaged:app.isPackaged,executable:process.execPath,home:app.getPath('home'),appData:app.getPath('appData')});
let pendingLink=process.argv.find(argument=>argument.startsWith('agent-workbench:'));
let receiveLink:((url:string)=>void)|undefined;
if(!isCoreProcess)app.on('open-url',(event,url)=>{if(url.startsWith('agent-workbench:')){event.preventDefault();pendingLink=url;receiveLink?.(url);}});
if(!isCoreProcess&&userDataOverride){if(!path.isAbsolute(userDataOverride))throw new Error('测试目录必须是绝对路径');app.setPath('userData',userDataOverride);}
let dataLocation:AppDataLocation|undefined;
if(isCoreProcess){/* runCore above owns this process. */}
else if(isRecoveryGuardian)void runRecoveryGuardian().catch(()=>app.exit(1));
else try{const acquired=userDataOverride?app.requestSingleInstanceLock():!!(dataLocation=initializeAppData(app,process.env.AGENT_WORKBENCH_HOME,installedLocation)??undefined);if(!acquired)app.quit();else void boot().catch(error=>{dialog.showErrorBox('AgentWorkbench 启动失败',safeError(error));app.quit();});}catch(error){const cause=(error as {cause?:{code?:string}})?.cause?.code;dialog.showErrorBox('AgentWorkbench 数据目录迁移失败',safeError(error)+(cause&&['EPERM','EACCES','EBUSY'].includes(cause)?'\n旧目录仍被占用或无法访问。请正常退出已有工作台后重试；现有数据未被覆盖。':''));app.quit();}

const RECOVERY_METHODS=new Set(['initialize','beginBoot','safeMode','begin','finish','incident','clear','clearCompatibility','ready','closed']);
async function boot(){
 await app.whenReady();
 // Windows shows toasts under this identity; the installer's shortcut uses the same appId.
 if(process.platform==='win32')app.setAppUserModelId(toastAppId(app.isPackaged));
 protocol.handle('awb-font',request=>referenceFontResponse(request.url));
 const directory=app.getPath('userData');
 const uiPreferences=new UiPreferenceStore(directory);await uiPreferences.load();
 const recovery=new PluginRecoveryStore(directory,app.getVersion());await recovery.initialize();
 if(process.argv.includes('--safe-mode'))await recovery.safeMode(true);
 await recovery.beginBoot();let guardian:RecoveryGuardian|undefined,performRecovery:(action:string)=>Promise<unknown>=async()=>{throw Error('PLUGIN_RECOVERY_STARTING');};
 try{guardian=await startRecoveryGuardian(recovery,action=>performRecovery(action));}catch{await recovery.incident({id:'workbench.recovery'},'PLUGIN_GUARDIAN_UNAVAILABLE','startup','unknown');}
 // Model execution, persistence, runtimes and host plugins run in the core process;
 // this process keeps windows and OS input free of that work.
 const child=utilityProcess.fork(__filename,[CORE_PROCESS_FLAG],{serviceName:'AgentWorkbench Core',stdio:'inherit',env:{...process.env}});
 const core=createRpcPeer(message=>child.postMessage(message));
 child.on('message',message=>core.receive(message));
 // Test profiles only: lets UI suites evaluate a function where host plugins run.
 if(userDataOverride)(globalThis as Record<string,unknown>).__workbenchCoreEvaluate=(source:string,arg:unknown)=>core.call('qa.evaluate',source,arg);
 let quitting=false,coreCrashed=false;
 const coreExited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 // An unexpected core exit ends the workbench without a clean recovery shutdown, so the
 // guardian observes the disconnect and diagnoses the pending plugin instead of stopping with it.
 child.on('exit',code=>{core.close('WORKBENCH_CORE_EXITED');if(quitting)return;coreCrashed=true;if(guardian){app.quit();return;}dialog.showErrorBox('AgentWorkbench 核心进程已退出',`退出代码 ${code}。已保存的数据未被修改；请重新打开工作台。`);app.quit();});
 let window:BrowserWindow|undefined;
 const cryptoCheck=()=>{if(!safeStorage.isEncryptionAvailable()||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text'))throw new Error('操作系统安全凭据存储不可用；不会保存明文密钥。');};
 const owner=()=>window&&!window.isDestroyed()?window:undefined;
 core.handle('dialog.open',((options:Electron.OpenDialogOptions)=>{const parent=owner();return parent?dialog.showOpenDialog(parent,options):dialog.showOpenDialog(options);}) as never);
 core.handle('dialog.save',((options:Electron.SaveDialogOptions)=>{const parent=owner();return parent?dialog.showSaveDialog(parent,options):dialog.showSaveDialog(options);}) as never);
 core.handle('shell.openPath',((target:string)=>shell.openPath(target)) as never);
 core.handle('shell.reveal',((target:string)=>{shell.showItemInFolder(target);}) as never);
 core.handle('shell.openExternal',((url:string)=>shell.openExternal(url)) as never);
 core.handle('clipboard.text',((text:string)=>{clipboard.writeText(text);}) as never);
 const runInWindow=(script:string)=>{const target=owner();if(!target)throw Error('WORKBENCH_WINDOW_UNAVAILABLE');return target.webContents.executeJavaScript(script);};
 // Image decoding needs nativeImage or the window's decoders, both in this process.
 core.handle('image.decode',((data:Uint8Array)=>decodeGeneratedImage(data,runInWindow)) as never);
 core.handle('clipboard.image',(async(data:Uint8Array)=>{const png=await imagePng(data,runInWindow);await clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(png)],{type:'image/png'})})]);}) as never);
 core.handle('crypto.encrypt',((text:string)=>{cryptoCheck();return new Uint8Array(safeStorage.encryptString(text));}) as never);
 core.handle('crypto.decrypt',((data:Uint8Array)=>{cryptoCheck();return safeStorage.decryptString(Buffer.from(data));}) as never);
 core.handle('image.thumbnail',((data:Uint8Array)=>{const image=nativeImage.createFromBuffer(Buffer.from(data));return image.isEmpty()?undefined:image.resize({width:240,quality:'good'}).toDataURL();}) as never);
 core.handle('recovery',(async(method:string,...args:unknown[])=>{if(!RECOVERY_METHODS.has(method))throw Error('PLUGIN_RECOVERY_ACTION_INVALID');await (recovery as unknown as Record<string,(...values:unknown[])=>Promise<unknown>>)[method]!(...args);core.emit('recovery',recovery.snapshot());}) as never);
 const activities=new Map<number,()=>void>();
 core.on('recovery.activity',value=>{const {token,plugin,phase}=value as {token:number;plugin:Parameters<PluginRecoveryStore['activity']>[0];phase:Parameters<PluginRecoveryStore['activity']>[1]};activities.set(token,recovery.activity(plugin,phase));});
 core.on('recovery.activity-end',value=>{const token=(value as {token:number}).token;activities.get(token)?.();activities.delete(token);});
 const stopRecoveryMirror=recovery.subscribe(snapshot=>core.emit('recovery',snapshot));
 let theme:Theme='light',shortcuts:ShortcutSettings|undefined,status={busy:false,maintaining:false};
 let brandingSnapshot:BrandingSnapshot|undefined;const brandingListeners=new Set<(snapshot:BrandingSnapshot)=>void>();
 const branding={get:()=>brandingSnapshot!,subscribe:(listener:(snapshot:BrandingSnapshot)=>void)=>{brandingListeners.add(listener);return()=>{brandingListeners.delete(listener);};}} as unknown as BrandingRegistry;
 core.on('branding',value=>{brandingSnapshot=value as BrandingSnapshot;for(const listener of brandingListeners)listener(brandingSnapshot);});
 core.on('status',value=>{status=value as typeof status;});
 // Monitoring starts with the core's first liveness report and ends when quitting.
 let coreAliveAt=0;core.on('alive',()=>{if(!coreAliveAt)guardian?.monitorHost(()=>quitting?0:Date.now()-coreAliveAt);coreAliveAt=Date.now();});
 const coreReady=await core.call<{theme:Theme;shortcuts?:ShortcutSettings;branding:BrandingSnapshot;distribution:unknown}>('init',{directory,appPath:app.getAppPath(),version:app.getVersion(),testProfile:!!userDataOverride,temporaryClipboard:!!(userDataOverride||installedLocation),...(userDataOverride?{executables:{codex:process.env.AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE,claude:process.env.AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE}}:{}),recovery:recovery.snapshot(),recoveryHostVersion:app.getVersion()} satisfies CoreInit);
 theme=coreReady.theme;shortcuts=coreReady.shortcuts;brandingSnapshot=coreReady.branding;
 nativeTheme.themeSource=theme;
 const created=window=new BrowserWindow({icon:brandingImage(),width:1440,height:940,minWidth:860,minHeight:640,show:false,backgroundColor:nativeTheme.shouldUseDarkColors?'#242424':'#faf9f6',title:'AgentWorkbench',titleBarStyle:'hidden',titleBarOverlay:titlebarColors(nativeTheme.shouldUseDarkColors),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,backgroundThrottling:false,offscreen:hiddenQa}});
 const windowState=new DesktopWindowState(created,uiPreferences);
 const firstPresentation=new FirstPresentation(async()=>{
  // Include layout effects, registered palettes and the caption-color frame before revealing.
  await created.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  // maximize()/setFullScreen() can themselves reveal a hidden native window.
  // Restore geometry only once the remembered appearance has been rendered.
  if(created.isDestroyed())return;
  windowState.restore();
  if(!created.isDestroyed()&&!hiddenQa)created.show();
 },()=>{void recovery.incident({id:'workbench.renderer'},'WORKBENCH_PRESENTATION_FAILED','renderer','unknown');});
 let desktopMenu:ReturnType<typeof installDesktopMenu>|undefined,notifier:DesktopNotifier|undefined;
 core.on('appearance',value=>{const next=value as {theme:Theme;shortcuts?:ShortcutSettings};const changed=next.theme!==theme;theme=next.theme;const shortcutsChanged=JSON.stringify(next.shortcuts)!==JSON.stringify(shortcuts);shortcuts=next.shortcuts;if(changed&&nativeTheme.themeSource!==theme)nativeTheme.themeSource=theme;if(changed||shortcutsChanged)desktopMenu?.refresh();});
 const htmlPreviews=new HtmlPreviewService();protocol.handle('awb-preview',request=>htmlPreviews.response(request));
 core.handle('html.create',((cwd:string,file:string)=>htmlPreviews.create(cwd,file)) as never);
 core.handle('visualization.read',((cwd:string,file:string)=>htmlPreviews.readVisualization(cwd,file)) as never);
 const index=path.join(__dirname,'../renderer/index.html');const allowedUrl=pathToFileURL(index).href;
 if(!userDataOverride){
  if(process.defaultApp)app.setAsDefaultProtocolClient('agent-workbench',process.execPath,[app.getAppPath()]);
  else app.setAsDefaultProtocolClient('agent-workbench');
 }
 created.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 created.webContents.on('will-navigate',(event,url)=>{if(url!==allowedUrl)event.preventDefault();});
 created.webContents.on('will-frame-navigate',event=>{if(![allowedUrl,'about:blank'].includes(event.url)&&!(event.isMainFrame===false&&htmlPreviews.owns(event.url)))event.preventDefault();});
 created.webContents.on('will-attach-webview',event=>event.preventDefault());
 electronSession.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 electronSession.defaultSession.setPermissionCheckHandler(()=>false);
 // State, plugin events and navigation go from the core to the window over a
 // dedicated port: high-frequency model output never passes through this thread.
 let portIds=0;
 ipcMain.on('workbench:core-port',event=>{
  if(event.sender!==created.webContents||event.senderFrame!==created.webContents.mainFrame||event.senderFrame.url!==allowedUrl)return;
  const {port1,port2}=new MessageChannelMain(),id=++portIds;
  child.postMessage({t:'port',id},[port1]);event.senderFrame.postMessage('workbench:core-port',id,[port2]);
 });
 const listPlugins=()=>core.call<PluginRecord[]>('plugins.list');
 const repairPlugin=(id:string,hash:string)=>core.call<{applied:boolean}>('plugins.repair',id,hash);
 const publish=(event:unknown)=>{void core.call('publish',event).catch(()=>{});};
 let rendererCoreReady=false;
 const readyRenderers=new Set<string>();
 const completeBoot=async()=>{
  if(rendererCoreReady&&recovery.snapshot().boot==='starting'&&!recovery.hasPendingActivation()){
   // Discovery may finish after core-ready, before renderer-start has been reported.
   const expected=(await listPlugins()).filter(record=>record.enabled&&record.approved&&record.manifest.renderer);
   if(expected.some(record=>!readyRenderers.has(`${record.manifest.id}:${record.hash}`))||recovery.hasPendingActivation())return;
   if(recovery.snapshot().boot==='starting')await recovery.ready();
   firstPresentation.appearanceReady();
  }
 };
 // Core-ready can precede a slow host activation triggered by initial state reads.
 // Observe its eventual completion without replacing the guardian's subscriber.
 const stopBootWatch=recovery.subscribe(()=>{void completeBoot().catch(()=>{});});
 const recoveryApi={status:()=>recovery.snapshot(),show:()=>{guardian?.show();return {shown:!!guardian};},repair:async()=>{
  if(status.busy)throw Error('PLUGIN_RECOVERY_SESSION_BUSY');
  const result=await repairCompatibilityBatch(recovery,repairPlugin),repaired=result.repairs.filter(item=>item.applied).length;
  const summary=result.complete?'已应用全部已检测问题的兼容适配。请检查插件实际功能。':`已应用 ${repaired} 项兼容适配，仍有 ${new Set(result.remaining.map(item=>item.id)).size} 个故障目标需检查。请进入安全模式，用同一份草稿请求 Agent 批量修复。`;
  return {...result,message:summary+'\n'+result.repairs.map(item=>item.id+'：'+(item.status==='repaired'?'已应用适配':item.status==='failed'?'适配失败，需检查':'无可验证适配，需检查')).join('\n')};
 }};
 const emergencyRepair=recoveryApi.repair.bind(recoveryApi),emergencyStatus=recoveryApi.status.bind(recoveryApi),emergencyShow=recoveryApi.show.bind(recoveryApi);
 performRecovery=async action=>{if(action==='show'){if(!hiddenQa)created.show();return {shown:true};}if(action==='repair')return emergencyRepair();throw Error('PLUGIN_RECOVERY_ACTION_INVALID');};
 const recoveryCall=async(method:string,payload:unknown)=>{
  if(method==='plugin-recovery/status')return emergencyStatus();
  if(method==='plugin-recovery/show')return emergencyShow();
  if(method==='plugin-recovery/repair')return emergencyRepair();
  if(method==='plugin-recovery/ui-language'){await writeRecoveryLanguage(directory,(payload as {language?:unknown})?.language);return null;}
  if(method==='plugin-recovery/repair-draft')return recovery.snapshot().safeMode?readPluginRepairDraft(directory):null;
  if(method==='plugin-recovery/repair-draft/ack'){if(!recovery.snapshot().safeMode)throw Error('PLUGIN_SAFE_MODE_REQUIRED');return acknowledgePluginRepairDraft(directory,(payload as {id?:unknown})?.id);}
  if(method==='plugin-recovery/pulse'){guardian?.rendererPulse();return null;}
  if(method==='plugin-recovery/core-ready'){rendererCoreReady=true;await completeBoot();return null;}
  if(method==='plugin-recovery/core-failed'){await recovery.incident({id:'workbench.renderer'},'WORKBENCH_RENDER_FAILED','renderer','unknown');return null;}
  const p=payload as {id?:string;hash?:string};
  const record=(await listPlugins()).find(r=>r.manifest.id===p?.id&&r.hash===p?.hash&&r.enabled&&r.manifest.renderer);
  if(!record){if(['plugin-recovery/renderer-ready','plugin-recovery/renderer-failed'].includes(method)&&recovery.snapshot().pending.some(entry=>entry.id===p?.id&&entry.hash===p?.hash&&entry.phase==='renderer')){await recovery.finish(p.id!,'renderer');await completeBoot();return null;}throw Error('PLUGIN_RECOVERY_REVISION_CHANGED');}
  if(method==='plugin-recovery/renderer-start'){await recovery.begin({...record.manifest,hash:record.hash},'renderer');return null;}
  if(method==='plugin-recovery/renderer-ready'){readyRenderers.add(`${record.manifest.id}:${record.hash}`);await recovery.finish(record.manifest.id,'renderer');await completeBoot();return null;}
  if(method==='plugin-recovery/renderer-failed'){await core.call('plugins.renderer-failed',record.manifest.id,record.hash);await completeBoot();return null;}
  throw Error('PLUGIN_RECOVERY_ACTION_INVALID');
 };
 let flushAcknowledged:((token:string)=>void)|undefined;
 const flushRenderer=()=>new Promise<void>(resolve=>{const token=String(Date.now());const timer=setTimeout(()=>{flushAcknowledged=undefined;resolve();},2500);flushAcknowledged=received=>{if(received!==token)return;clearTimeout(timer);flushAcknowledged=undefined;resolve();};publish({type:'plugin',id:'workbench.ui-preferences',topic:'flush',payload:{token}});});
 uiPreferences.subscribe(snapshot=>publish({type:'plugin',id:'workbench.ui-preferences',topic:'changed',payload:snapshot}));
 let updateInstalling=false,testRelocationTarget:string|undefined;
 const flushCore=()=>core.call('flush');
 const dataDirectoryService:DataDirectoryService=new DataDirectoryService({directory,defaultDirectory:dataLocation?.defaultDirectory??directory,locator:installedLocation?.locator,testOverride:testRelocation,
  busy:()=>updateInstalling||status.busy||status.maintaining,
  pick:async kind=>{const result=await dialog.showOpenDialog(created,{title:kind==='codex'?'选择 Codex 原生安装目录的父目录':'选择工作台资料所在的磁盘和目录',properties:['openDirectory','createDirectory']});if(result.canceled)return null;const parent=result.filePaths[0];return parent?kind==='codex'?path.join(parent,'Codex'):path.join(parent,'AgentWorkbenchData',path.basename(installedLocation?.directory??directory)):null;},
  flush:async()=>{await flushRenderer();await windowState.flush();await flushCore();},
  relocate:testRelocation?target=>{relocateAppData(directory,target);testRelocationTarget=target;}:undefined,
  restart:()=>{if(testRelocation&&testRelocationTarget){process.env.AGENT_WORKBENCH_TEST_DATA=testRelocationTarget;}app.relaunch();app.quit();},
 });
 const desktopUpdates=new DesktopUpdates(()=>createDesktopUpdateBackend(async()=>{updateInstalling=true;try{await flushRenderer();await windowState.flush();await flushCore();}catch(error){updateInstalling=false;throw error;}},()=>{updateInstalling=false;}),()=>!!dataDirectoryService.isChanging()||status.busy,desktopUpdatesEnabled({packaged:app.isPackaged,platform:process.platform,testProfile:!!userDataOverride,distribution:coreReady.distribution}));
 const stopUpdateEvents=desktopUpdates.subscribe(payload=>publish({type:'plugin',id:'workbench.updates',topic:'changed',payload}));
 const lifecycleState=()=>core.emit('lifecycle',{quitting,dataDirectoryChanging:dataDirectoryService.isChanging()});
 // Methods owned by this process; the core routes them here after plugin middleware.
 const mainCall=async(method:string,payload:unknown):Promise<unknown>=>{
  if(method==='desktop-updates/status')return desktopUpdates.snapshot();
  if(method==='desktop-updates/check')return desktopUpdates.check();
  if(method==='desktop-updates/install')return desktopUpdates.install();
  if(method.startsWith('plugin-recovery/'))return recoveryCall(method,payload);
  if(method==='ui-preferences/get')return uiPreferences.snapshot();
  if(method==='ui-preferences/update')return uiPreferences.update(payload as import('../../../packages/ui-preferences').UiPreferenceChange);
  if(method==='ui-preferences/flush-ready'){flushAcknowledged?.((payload as {token:string}).token);return null;}
  if(method==='visualizations/instructions')return visualizationPresentation.instructions((payload as {runtime?:string})?.runtime);
  if(method==='visualizations/render')return htmlPreviews.createVisualization(payload as import('../../../packages/visualizations/document').VisualizationPageOptions);
  if(method==='visualizations/release')return htmlPreviews.releaseVisualization((payload as {url:string}).url);
  if(method==='desktop/titlebar')return desktopMenu!.setAppearance(payload);
  if(method==='desktop/action')return desktopMenu!.execute((payload as {id?:unknown})?.id);
  if(method==='desktop/menu')return desktopMenu!.popup((payload??{}) as Record<string,unknown>);
  if(method==='desktop/data-directory')return dataDirectoryService.get();
  if(method==='desktop/data-directory/choose')return dataDirectoryService.choose((payload as {kind?:'codex'})?.kind);
  if(method==='desktop/data-directory/migrate'){const result=dataDirectoryService.migrate((payload as {target:string})?.target);lifecycleState();try{return await result;}finally{lifecycleState();}}
  if(method==='desktop/info')return {version:app.getVersion()};
  if(method==='desktop/notify')return notifier!.show(payload);
  throw Error('RPC_METHOD_UNAVAILABLE: '+method);
 };
 core.handle('main.call',((method:string,payload:unknown)=>mainCall(method,payload)) as never);
 desktopMenu=installDesktopMenu(created,()=>theme,value=>core.call<{error?:string}>('call','theme/set',{theme:value}).then(reply=>{if(reply.error!==undefined)throw Error(reply.error);}),async()=>{guardian?.show();},()=>shortcuts,()=>{void windowState.zoomChanged();});
 const lifecycle=installTray(created,async()=>{quitting=true;lifecycleState();desktopUpdates.dispose();stopUpdateEvents();stopBootWatch();await flushRenderer();await windowState.flush();windowState.dispose();await core.call('shutdown').catch(()=>{});
  // The core holds plugin modules, data files and child processes; it is gone before this process exits.
  child.kill();await Promise.race([coreExited,new Promise(resolve=>setTimeout(resolve,3000))]);stopRecoveryMirror();if(coreCrashed)return;await recovery.closed();guardian?.close();},!!userDataOverride,branding);
 notifier=new DesktopNotifier(created,uiPreferences,sessionId=>{if(lifecycle.isQuitting())return;if(!hiddenQa)lifecycle.show();try{void core.call('navigate.link',threadDeepLink(sessionId)).catch(()=>{});}catch{/* Not a local thread identifier. */}},!!userDataOverride&&process.env.AGENT_WORKBENCH_TEST_REAL_NOTIFICATIONS!=='1');
 // Toast title and icon follow the current branding; test profiles leave the user's registry alone.
 const toastIdentity=()=>{if(!userDataOverride)void registerToastIdentity(toastAppId(app.isPackaged),'AgentWorkbench',brandingImage(brandingSnapshot),directory).catch(error=>console.error('DESKTOP_NOTIFICATION_IDENTITY_FAILED',safeError(error)));};
 toastIdentity();brandingListeners.add(toastIdentity);
 core.handle('notifications.focused',((sessionId:string)=>notifier!.focused(sessionId)) as never);
 // The core marks background turn endings inside the state change itself, so it needs focus before any await.
 let focusSent='';const sendFocus=()=>{if(created.isDestroyed())return;const value={window:created.isVisible()&&!created.isMinimized()&&created.isFocused(),view:String(uiPreferences.get('navigation.view').value),session:String(uiPreferences.get('navigation.session').value)};const text=JSON.stringify(value);if(text!==focusSent){focusSent=text;core.emit('focus',value);}};
 for(const event of ['focus','blur','show','hide','minimize','restore'] as const)created.on(event as 'focus',sendFocus);
 uiPreferences.subscribe(sendFocus);sendFocus();
 core.handle('notifications.show',((notice:unknown)=>lifecycle.isQuitting()?{shown:false,sound:false}:notifier!.show(notice)) as never);
 // Host plugins in the core reach these services asynchronously by id.
 const uiServices:Record<string,object|undefined>={
  'desktop.updates':desktopUpdates,'desktop.data-directory':dataDirectoryService,
  'ui.preferences':uiPreferences,'desktop.window-state':windowState,'extensions.recovery':recoveryApi,
  'appearance.reference-fonts':claudeReferenceFont,
  'desktop.app':app,'desktop.window':created,'desktop.menu':desktopMenu,'desktop.tray':lifecycle,
  'desktop.clipboard':clipboard,'desktop.dialog':dialog,'desktop.shell':shell,'desktop.theme':nativeTheme,
  'desktop.protocol':protocol,'desktop.session':electronSession.defaultSession,'files.html-preview':htmlPreviews,'visualizations.presentation':visualizationPresentation,
 };
 core.handle('service.invoke',(async(id:string,member:string,args:unknown[])=>{
  const service=uiServices[id] as Record<string,unknown>|undefined;if(!service)throw Error('PLUGIN_SERVICE_UNAVAILABLE');
  const value=service[member];const result=typeof value==='function'?await (value as (...values:unknown[])=>unknown).apply(service,Array.isArray(args)?args:[]):value;
  try{return structuredClone(result);}catch{return undefined;}
 }) as never);
 desktopUpdates.start();
 receiveLink=url=>{if(lifecycle.isQuitting())return;void core.call<string|null>('navigate.link',url).then(id=>{if(id&&!hiddenQa)lifecycle.show();}).catch(()=>{});};
 if(pendingLink)receiveLink(pendingLink);
 ipcMain.handle('workbench:call',async(event,method:unknown,payload:unknown)=>{
  try{
   if((lifecycle.isQuitting()||updateInstalling||dataDirectoryService.isChanging())&&!['ui-preferences/update','ui-preferences/flush-ready','ui-preferences/get'].includes(String(method)))throw new Error('工作台正在退出，请稍后重新打开。');
   if(event.sender!==created.webContents||event.senderFrame!==created.webContents.mainFrame||event.senderFrame.url!==allowedUrl)throw new Error('IPC 来源未授权。');
   if(typeof method!=='string'||method.length>100)throw new Error('无效的 IPC 请求。');
   const bytes=method==='attachments/save-as'?(payload as {png?:unknown})?.png:undefined;
   const files=method==='attachments/import'?(payload as {files?:{bytes?:unknown}[]})?.files:undefined;
   if(bytes!==undefined&&(!(bytes instanceof Uint8Array)))throw Error('ATTACHMENT_EDIT_INVALID');
   if(files!==undefined&&(!Array.isArray(files)||files.some(file=>file.bytes!==undefined&&(!(file.bytes instanceof Uint8Array)))))throw Error('ATTACHMENT_INPUT_INVALID');
   const metadata=bytes!==undefined?{...(payload as object),png:undefined}:files?{files:files.map(file=>({...file,bytes:undefined}))}:payload;
   if(Buffer.byteLength(JSON.stringify(metadata??{}))>2_000_000)throw new Error('无效或过大的 IPC 请求。');
   // Emergency diagnostics and heartbeats cannot be swallowed by plugin middleware;
   // everything else is relayed to the core without work on this thread.
   if(method.startsWith('plugin-recovery/'))return {ok:true,value:await recoveryCall(method,payload)};
   // `fence` tells the preload which port message to await, so a call never resolves before the state it changed.
   const reply=await core.call<{value?:unknown;error?:string;code?:string;fence:CallFence}>('call',method,payload);
   if(reply.error===undefined)return {ok:true,value:reply.value,fence:reply.fence};
   const failure=Error(reply.error) as Error&{code?:string};if(reply.code)failure.code=reply.code;
   return {ok:false,error:safeError(failure),fence:reply.fence};
  }catch(error){return {ok:false,error:safeError(error)};}
 });
 guardian?.monitorRenderer();
 created.webContents.on('render-process-gone',()=>{if(!lifecycle.isQuitting())void recovery.incident({id:'workbench.renderer'},'PLUGIN_RENDERER_CRASHED','renderer','unknown');});
 created.webContents.on('unresponsive',()=>{if(!lifecycle.isQuitting())void recovery.incident({id:'workbench.renderer'},'PLUGIN_RENDERER_UNRESPONSIVE','renderer','unknown');});
 await created.loadFile(index);firstPresentation.documentLoaded();
 app.on('second-instance',(_event,argv)=>{const link=argv.find(argument=>argument.startsWith('agent-workbench:'));if(link)receiveLink?.(link);if(!hiddenQa)lifecycle.show();});
 app.on('activate',()=>{if(!hiddenQa)lifecycle.show();});
}
