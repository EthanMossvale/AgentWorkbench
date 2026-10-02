import {DesktopUpdates} from '../../../packages/desktop-updates';
import {createDesktopUpdateBackend} from './desktop-updates';
import { visualizationPresentation } from '../../../packages/visualizations/instructions';
import {brandingImage} from './branding';
import {UiPreferenceStore} from '../../../packages/ui-preferences/store';
import {DesktopWindowState} from './window-state';
import {FirstPresentation} from './first-presentation';
import { officialLoginUrl } from '../../../packages/model-management/native';
import {NativeSessionStorage} from '../../../packages/remote-account-catalog/session-storage';
import {RemoteResourceService} from '../../../packages/remote-account-catalog/resources';
import { HtmlPreviewService } from './html-preview';
import { WorktreeService } from '../../../packages/worktrees';
import {initializeAppData,type AppDataLocation} from '../../../packages/app-data';
import {installedDataDirectory} from '../../../packages/app-data/relocation';
import {DataDirectoryService} from '../../../packages/app-data/service';
import { AttachmentStore } from './attachments';
import { protocol, nativeImage, app, BrowserWindow, ipcMain, dialog, clipboard, ClipboardItem, safeStorage, shell, nativeTheme, session as electronSession } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { StateStore, SecretStore } from './store';
import { WorkbenchController, safeError } from './controller';
import type { Capability } from '../../../packages/contracts/index';
import { getNativeCapabilities } from '../../../packages/runtime-claude/index';
import { getLocalExecutorCapabilities } from '../../../services/local-executor/index';
import { parseThreadDeepLink } from '../../../packages/navigation/index';
import { SharedMemoryStore } from '../../../packages/memory-core/index';
import { SharedSkillsStore } from '../../../packages/skills-core/index';
import { installTray } from './tray';
import { SshOnboardingService } from './ssh-onboarding';
import { WorkspaceManagementService } from './workspace-management';
import {NativeQuotaAccounting} from './quota-accounting';
import {AccountUsageService} from '../../../packages/account-usage';
import { CodexBridgeService } from '../../../services/codex-bridge';
import { ClaudeBridgeService } from '../../../services/claude-bridge';
import { selectedSharedAccountRef } from '../../../packages/account-selection';
import {RemoteBrowserService} from '../../../packages/remote-account-catalog/browser';
import {RemoteCliService} from '../../../packages/remote-account-catalog/cli';
import { NativeRuntimeControl } from '../../../packages/workspace-control/native-runtime';
import { AccountServiceSetup } from '../../../packages/remote-account-catalog/setup';
import { installDesktopMenu, titlebarColors } from './desktop-menu';
import { FileActionService } from './file-actions';
import { NativeResources } from './native-resources';
import { isRecoveryGuardian, runRecoveryGuardian, startRecoveryGuardian, type RecoveryGuardian } from './plugin-recovery-guardian';
import { claudeReferenceFont, referenceFontResponse } from './claude-reference-font';
import { PluginRecoveryStore } from '../../../packages/plugins-core/recovery';
import { acknowledgePluginRepairDraft, readPluginRepairDraft, writeRecoveryLanguage } from '../../../packages/plugins-core/repair-draft';
import { repairCompatibilityBatch } from '../../../packages/plugins-core/compatibility-repair';

if(!isRecoveryGuardian)protocol.registerSchemesAsPrivileged([{scheme:'awb-preview',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}},{scheme:'awb-font',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.setName('AgentWorkbench');
const userDataOverride=process.env.AGENT_WORKBENCH_TEST_DATA;
if(!isRecoveryGuardian&&userDataOverride&&/^\d{4,5}$/.test(process.env.AGENT_WORKBENCH_TEST_APP_PORT??''))app.commandLine.appendSwitch('remote-debugging-port',process.env.AGENT_WORKBENCH_TEST_APP_PORT!);
const hiddenQa=!!userDataOverride&&process.env.AGENT_WORKBENCH_TEST_HIDDEN==='1';
const installedLocation=app.isPackaged&&process.platform==='win32'&&!userDataOverride?{
 directory:installedDataDirectory(process.execPath,app.getPath('home')),
 locator:path.join(app.getPath('appData'),'AgentWorkbench-location.json'),
}:undefined;
let pendingLink=process.argv.find(argument=>argument.startsWith('agent-workbench:'));
let receiveLink:((url:string)=>void)|undefined;
app.on('open-url',(event,url)=>{if(url.startsWith('agent-workbench:')){event.preventDefault();pendingLink=url;receiveLink?.(url);}});
if(userDataOverride){if(!path.isAbsolute(userDataOverride))throw new Error('测试目录必须是绝对路径');app.setPath('userData',userDataOverride);}
let dataLocation:AppDataLocation|undefined;
if(isRecoveryGuardian)void runRecoveryGuardian().catch(()=>app.exit(1));
else try{const acquired=userDataOverride?app.requestSingleInstanceLock():!!(dataLocation=initializeAppData(app,process.env.AGENT_WORKBENCH_HOME,installedLocation)??undefined);if(!acquired)app.quit();else void boot().catch(error=>{dialog.showErrorBox('AgentWorkbench 启动失败',safeError(error));app.quit();});}catch(error){const cause=(error as {cause?:{code?:string}})?.cause?.code;dialog.showErrorBox('AgentWorkbench 数据目录迁移失败',safeError(error)+(cause&&['EPERM','EACCES','EBUSY'].includes(cause)?'\n旧目录仍被占用或无法访问。请正常退出已有工作台后重试；现有数据未被覆盖。':''));app.quit();}
async function boot(){
 await app.whenReady();
 protocol.handle('awb-font',request=>referenceFontResponse(request.url));
 const directory=app.getPath('userData');
 const uiPreferences=new UiPreferenceStore(directory);await uiPreferences.load();
 const recovery=new PluginRecoveryStore(directory,app.getVersion());await recovery.initialize();
 if(process.argv.includes('--safe-mode'))await recovery.safeMode(true);
 await recovery.beginBoot();let guardian:RecoveryGuardian|undefined,performRecovery:(action:string)=>Promise<unknown>=async()=>{throw Error('PLUGIN_RECOVERY_STARTING');};
 try{guardian=await startRecoveryGuardian(recovery,action=>performRecovery(action));}catch{await recovery.safeMode(true);await recovery.incident({id:'workbench.recovery'},'PLUGIN_GUARDIAN_UNAVAILABLE','startup','unknown');}
 const state=new StateStore(directory);await state.load();
 nativeTheme.themeSource=state.snapshot().theme;
 // Legacy stores remain readable through their old API; new work uses native sources only.
 const shared:{memory:SharedMemoryStore;skills:SharedSkillsStore;native?:NativeResources}={memory:new SharedMemoryStore(directory),skills:new SharedSkillsStore(directory)};
 const cryptoCheck=()=>{if(!safeStorage.isEncryptionAvailable()||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text'))throw new Error('操作系统安全凭据存储不可用；不会保存明文密钥。');};
 const secrets=new SecretStore(path.join(directory,'secrets'),{encrypt:text=>{cryptoCheck();return safeStorage.encryptString(text);},decrypt:data=>{cryptoCheck();return safeStorage.decryptString(data);}});
 const window=new BrowserWindow({icon:brandingImage(),width:1440,height:940,minWidth:860,minHeight:640,show:false,backgroundColor:nativeTheme.shouldUseDarkColors?'#242424':'#faf9f6',title:'AgentWorkbench',titleBarStyle:'hidden',titleBarOverlay:titlebarColors(nativeTheme.shouldUseDarkColors),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,backgroundThrottling:false,offscreen:hiddenQa}});
 const windowState=new DesktopWindowState(window,uiPreferences);
 const firstPresentation=new FirstPresentation(async()=>{
  // Include layout effects, registered palettes and the caption-color frame before revealing.
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  // maximize()/setFullScreen() can themselves reveal a hidden native window.
  // Restore geometry only once the remembered appearance has been rendered.
  if(window.isDestroyed())return;
  windowState.restore();
  if(!window.isDestroyed()&&!hiddenQa)window.show();
 },()=>{void recovery.incident({id:'workbench.renderer'},'WORKBENCH_PRESENTATION_FAILED','renderer','unknown');});
 let desktopMenu:ReturnType<typeof installDesktopMenu>|undefined;
 let shortcutRevision=JSON.stringify(state.snapshot().shortcuts);
 let hasSessionWork=()=>false;
 let dataDirectoryService:DataDirectoryService|undefined;
 shared.native=new NativeResources(directory,{
  openZip:async kind=>{const picked=await dialog.showOpenDialog(window,{title:kind==='skill'?'导入 Skill ZIP':'导入工作台插件 ZIP',properties:['openFile'],filters:[{name:'ZIP',extensions:['zip']}]});return picked.canceled?null:picked.filePaths[0]??null;},
  saveZip:async name=>{const picked=await dialog.showSaveDialog(window,{title:'导出分享包',defaultPath:name,filters:[{name:'ZIP',extensions:['zip']}]});return picked.canceled?null:picked.filePath??null;},
 },()=>state.snapshot().projects.flatMap(project=>project.paths??[project.path]),()=>{if(!window.isDestroyed())window.webContents.send('workbench:extensions');},userDataOverride?path.join(directory,'native-home'):undefined, { pluginOptions:{recovery},cliOptions:{ ...(userDataOverride ? { executables:{codex:process.env.AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE,claude:process.env.AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE} } : {}), idle:()=>!dataDirectoryService?.isChanging()&&!hasSessionWork()&&!state.snapshot().sessions.some(session=>session.status==='running'||session.status==='uncertain')} });
 const htmlPreviews=new HtmlPreviewService();protocol.handle('awb-preview',request=>htmlPreviews.response(request));
 const index=path.join(__dirname,'../renderer/index.html');const allowedUrl=pathToFileURL(index).href;
 let navigationSessionId:string|null=null;
 if(!userDataOverride){
  if(process.defaultApp)app.setAsDefaultProtocolClient('agent-workbench',process.execPath,[app.getAppPath()]);
  else app.setAsDefaultProtocolClient('agent-workbench');
 }
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(url!==allowedUrl)event.preventDefault();});
 window.webContents.on('will-frame-navigate',event=>{if(![allowedUrl,'about:blank'].includes(event.url)&&!(event.isMainFrame===false&&htmlPreviews.owns(event.url)))event.preventDefault();});
 window.webContents.on('will-attach-webview',event=>event.preventDefault());
 electronSession.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 electronSession.defaultSession.setPermissionCheckHandler(()=>false);
 const nativeCodex=await CodexBridgeService.load(path.join(app.getAppPath(),'build/runtime/codex-0.155.1/codex.exe'),path.join(directory,'native-codex'),path.join(app.getAppPath(),'build/qa/native-acceptance.json'));
 await state.update(snapshot=>{for(const saved of snapshot.sessions){const host=snapshot.hosts.find(item=>item.id===saved.binding.hostId);if(saved.status==='blocked'&&host&&nativeCodex.supports(host,saved)){saved.status='idle';if(!saved.messages.length&&saved.title==='Codex · 待验证连接')saved.title='新的 Codex 任务';}}});
 const accepted=()=>state.snapshot().hosts.some(host=>nativeCodex.supports(host,{binding:{runtime:'codex',provider:'openai',hostId:host.id,executionId:'local-device',egress:'vps',accountRef:selectedSharedAccountRef(state.snapshot().accountCatalogs?.[host.id])??'',accountRuntime:state.snapshot().accountCatalogs?.[host.id]?.source}} as import('../../../packages/contracts').Session));
 const capabilities=():Capability[]=>[
  ...getNativeCapabilities(),
  ...getLocalExecutorCapabilities(),
  {id:'egress',label:'原生模型远端出网',status:'unverified' as const,detail:'尚未执行真实模型任务和网络出口验证，不以进程位置代替证据。'}
 ].map(item=>accepted()&&['codex-h-native','local-executor-contract','egress'].includes(item.id)?{...item,status:'implemented' as const,detail:item.id==='egress'?'已验收绑定的 Codex 0.155.1：真实模型任务期间，VPS 原生进程具有外部 HTTPS 连接；未宣称工具网络也统一从 VPS 出口。':'已验收绑定的 Codex 0.155.1：VPS 原生认证、本机文件读取/补丁/PowerShell、审批、恢复和停止清理；其它连接仍须独立验收。'}:item);
 const controller=new WorkbenchController(state,secrets,{
  worktrees:new WorktreeService(directory),
  attachments:new AttachmentStore(path.join(directory,'attachments'),data=>{const image=nativeImage.createFromBuffer(data);return image.isEmpty()?undefined:image.resize({width:240,quality:'good'}).toDataURL();},[directory],async name=>{const picked=await dialog.showSaveDialog(window,{title:'附件另存为',defaultPath:name});return picked.canceled?null:picked.filePath??null;},{nativePaths:true,copyImage:async data=>{const image=nativeImage.createFromBuffer(Buffer.from(data));const size=image.getSize();if(image.isEmpty()||size.width*size.height>40000000)throw Error('ATTACHMENT_IMAGE_INVALID');await clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(image.toPNG())],{type:'image/png'})})]);},...(userDataOverride||installedLocation?{temporaryDirectory:path.join(directory,'clipboard-temp')}:{})}),
  pickAttachments:async()=>{const picked=await dialog.showOpenDialog(window,{properties:['openFile','multiSelections'],title:'添加附件'});return picked.canceled?[]:picked.filePaths;},
  pickAccountExport:async fileName=>{const picked=await dialog.showSaveDialog(window,{title:'导出账号 JSON',defaultPath:fileName,filters:[{name:'JSON',extensions:['json']}]});return picked.canceled?null:picked.filePath??null;},
  modelControlPaths:[directory],
  fileActions:new FileActionService({openPath:async target=>{const failure=await shell.openPath(target);if(failure)throw Error(failure);},reveal:target=>shell.showItemInFolder(target),copy:text=>clipboard.writeText(text),pickSave:async source=>{const result=await dialog.showSaveDialog(window,{title:'另存为',defaultPath:source});return result.canceled?null:result.filePath??null;}}),
  nativeCodex,nativeClaude:new ClaudeBridgeService(path.join(directory,'native-claude')),
  accountUsage:new AccountUsageService(directory),
  nativeAccounts:new NativeRuntimeControl(directory),
  accountSetup:new AccountServiceSetup(),
  remoteCli:new RemoteCliService(),
  remoteCliPolicies:new RemoteCliService(),
  sessionStorage:new NativeSessionStorage(path.join(directory,'remote-session-archives')),
  remoteResources:new RemoteResourceService(undefined,{upload:async()=>{const picked=await dialog.showOpenDialog(window,{title:'上传到远端',properties:['openFile']});return picked.canceled?null:picked.filePaths[0]??null;},download:async name=>{const picked=await dialog.showSaveDialog(window,{title:'从远端下载（另存为新文件）',defaultPath:name});return picked.canceled?null:picked.filePath??null;}}),
  remoteBrowser:new RemoteBrowserService(async url=>{if(!/^http:\/\/127\.0\.0\.1:\d+\/vnc\.html\?autoconnect=1&resize=scale$/.test(url))throw Error('Invalid remote viewer URL.');await shell.openExternal(url);}),
  quotaAccounting:new NativeQuotaAccounting(directory,()=>state.snapshot()),
  revealPath:target=>shell.showItemInFolder(target),
  openWeb:async url=>{const value=new URL(url);if(!["http:","https:"].includes(value.protocol)||value.username||value.password)throw Error("Invalid website URL.");await shell.openExternal(value.href);},
  sshOnboarding:new SshOnboardingService({directory,...(userDataOverride?{home:path.join(directory,'synthetic-home')}:{ }),pickFile:async kind=>{const selected=await dialog.showOpenDialog(window,{title:kind==='key'?'选择 SSH 密钥或连接配置':kind==='config'?'导入 SSH 连接配置':'选择已有服务器身份记录',properties:['openFile']});return selected.canceled?null:selected.filePaths[0]??null;}}),
  workspaceManagement:new WorkspaceManagementService({directory,pickImport:async()=>{const selected=await dialog.showOpenDialog(window,{title:'导入工作空间',properties:['openFile'],filters:[{name:'工作空间',extensions:['awworkspace']}]});return selected.canceled?null:selected.filePaths[0]??null;},pickExport:async filename=>{const selected=await dialog.showSaveDialog(window,{title:'导出工作空间',defaultPath:filename,filters:[{name:'工作空间',extensions:['awworkspace']}]});return selected.canceled?null:selected.filePath??null;}}),
  pickDirectory:async()=>{const picked=await dialog.showOpenDialog(window,{properties:['openDirectory'],title:'选择本机项目目录'});return picked.canceled?null:picked.filePaths[0]??null;},
  pickDirectories:async()=>{const picked=await dialog.showOpenDialog(window,{properties:['openDirectory','multiSelections'],title:'为项目关联文件夹'});return picked.canceled?[]:picked.filePaths;},
  pickSkill:async()=>{const picked=await dialog.showOpenDialog(window,{properties:['openFile'],title:'导入共享 SKILL.md',filters:[{name:'Skill Markdown',extensions:['md']}]});return picked.canceled?null:picked.filePaths[0]??null;},
  getNavigation:()=>navigationSessionId,
  openSession:sessionId=>{if(lifecycle.isQuitting()||window.isDestroyed())throw Error('SESSION_NAVIGATION_UNAVAILABLE');navigationSessionId=sessionId;window.webContents.send('workbench:navigate',sessionId);},
  openPath:async target=>{const failure=await shell.openPath(target);if(failure)throw new Error('无法在文件管理器打开目录。');},openExternal:async url=>{if(!officialLoginUrl(url,'codex')&&!officialLoginUrl(url,'claude'))throw new Error('LOCAL_ACCOUNT_BROWSER_URL_REJECTED');await shell.openExternal(url);},copy:value=>clipboard.writeText(value),nativeCapabilities:capabilities
 },updated=>{const changed=nativeTheme.themeSource!==updated.theme;if(changed)nativeTheme.themeSource=updated.theme;const nextShortcuts=JSON.stringify(updated.shortcuts);if(changed||nextShortcuts!==shortcutRevision){shortcutRevision=nextShortcuts;desktopMenu?.refresh();}shared.native?.plugins.publish({type:'state',payload:updated});if(!window.isDestroyed())window.webContents.send('workbench:state',updated);},shared);
 hasSessionWork=()=>controller.hasActiveSessionWork();
 controller.remoteConfigurations.subscribe(()=>{if(!window.isDestroyed())window.webContents.send('workbench:extensions');});
 controller.localAccounts.access.subscribe(()=>{if(!window.isDestroyed())window.webContents.send('workbench:extensions');});
 const registry=shared.native.plugins,repairPlugin=registry.repairCompatibility.bind(registry),listPlugins=registry.list.bind(registry);
 let coreReady=false;
 const readyRenderers=new Set<string>();
 const completeBoot=async()=>{
  if(coreReady&&recovery.snapshot().boot==='starting'&&!recovery.hasPendingActivation()){
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
  if(controller.hasActiveSessionWork())throw Error('PLUGIN_RECOVERY_SESSION_BUSY');
  const result=await repairCompatibilityBatch(recovery,repairPlugin),repaired=result.repairs.filter(item=>item.applied).length;
  const summary=result.complete?'已应用全部已检测问题的兼容适配。请检查插件实际功能。':`已应用 ${repaired} 项兼容适配，仍有 ${new Set(result.remaining.map(item=>item.id)).size} 个故障目标需检查。请进入安全模式，用同一份草稿请求 Agent 批量修复。`;
  return {...result,message:summary+'\n'+result.repairs.map(item=>item.id+'：'+(item.status==='repaired'?'已应用适配':item.status==='failed'?'适配失败，需检查':'无可验证适配，需检查')).join('\n')};
 }};
 const emergencyRepair=recoveryApi.repair.bind(recoveryApi),emergencyStatus=recoveryApi.status.bind(recoveryApi),emergencyShow=recoveryApi.show.bind(recoveryApi);
 performRecovery=async action=>{if(action==='show'){if(!hiddenQa)window.show();return {shown:true};}if(action==='repair')return emergencyRepair();throw Error('PLUGIN_RECOVERY_ACTION_INVALID');};
 const recoveryCall=async(method:string,payload:unknown)=>{
  if(method==='plugin-recovery/status')return emergencyStatus();
  if(method==='plugin-recovery/show')return emergencyShow();
  if(method==='plugin-recovery/repair')return emergencyRepair();
  if(method==='plugin-recovery/ui-language'){await writeRecoveryLanguage(directory,(payload as {language?:unknown})?.language);return null;}
  if(method==='plugin-recovery/repair-draft')return recovery.snapshot().safeMode?readPluginRepairDraft(directory):null;
  if(method==='plugin-recovery/repair-draft/ack'){if(!recovery.snapshot().safeMode)throw Error('PLUGIN_SAFE_MODE_REQUIRED');return acknowledgePluginRepairDraft(directory,(payload as {id?:unknown})?.id);}
  if(method==='plugin-recovery/pulse'){guardian?.rendererPulse();return null;}
  if(method==='plugin-recovery/core-ready'){coreReady=true;await completeBoot();return null;}
  if(method==='plugin-recovery/core-failed'){await recovery.incident({id:'workbench.renderer'},'WORKBENCH_RENDER_FAILED','renderer','unknown');return null;}
  const p=payload as {id?:string;hash?:string};
  const record=(await listPlugins()).find(r=>r.manifest.id===p?.id&&r.hash===p?.hash&&r.enabled&&r.manifest.renderer);
  if(!record){if(['plugin-recovery/renderer-ready','plugin-recovery/renderer-failed'].includes(method)&&recovery.snapshot().pending.some(entry=>entry.id===p?.id&&entry.hash===p?.hash&&entry.phase==='renderer')){await recovery.finish(p.id!,'renderer');await completeBoot();return null;}throw Error('PLUGIN_RECOVERY_REVISION_CHANGED');}
  if(method==='plugin-recovery/renderer-start'){await recovery.begin({...record.manifest,hash:record.hash},'renderer');return null;}
  if(method==='plugin-recovery/renderer-ready'){readyRenderers.add(`${record.manifest.id}:${record.hash}`);await recovery.finish(record.manifest.id,'renderer');await completeBoot();return null;}
  if(method==='plugin-recovery/renderer-failed'){await registry.rendererFailed(record.manifest.id,record.hash);await completeBoot();return null;}
  throw Error('PLUGIN_RECOVERY_ACTION_INVALID');
 };
 let flushAcknowledged:((token:string)=>void)|undefined;
 const flushRenderer=()=>new Promise<void>(resolve=>{const token=String(Date.now());const timer=setTimeout(()=>{flushAcknowledged=undefined;resolve();},2500);flushAcknowledged=received=>{if(received!==token)return;clearTimeout(timer);flushAcknowledged=undefined;resolve();};shared.native!.plugins.publish({type:'plugin',id:'workbench.ui-preferences',topic:'flush',payload:{token}});});
 uiPreferences.subscribe(snapshot=>shared.native!.plugins.publish({type:'plugin',id:'workbench.ui-preferences',topic:'changed',payload:snapshot}));
 let updateInstalling=false;
 dataDirectoryService=new DataDirectoryService({directory,defaultDirectory:dataLocation?.defaultDirectory??directory,locator:installedLocation?.locator,testOverride:!!userDataOverride,
  busy:()=>updateInstalling||controller.hasActiveSessionWork()||state.snapshot().sessions.some(session=>session.status==='running'||session.status==='uncertain')||shared.native!.cli.isMaintaining(),
  pick:async kind=>{const result=await dialog.showOpenDialog(window,{title:kind==='codex'?'选择 Codex 原生安装目录的父目录':'选择工作台资料所在的磁盘和目录',properties:['openDirectory','createDirectory']});if(result.canceled)return null;const parent=result.filePaths[0];return parent?kind==='codex'?path.join(parent,'Codex'):path.join(parent,'AgentWorkbenchData',path.basename(installedLocation!.directory)):null;},
  flush:async()=>{await flushRenderer();await windowState.flush();},restart:()=>{app.relaunch();app.quit();},
 });
 const desktopUpdates=new DesktopUpdates(()=>createDesktopUpdateBackend(async()=>{updateInstalling=true;try{await flushRenderer();await windowState.flush();}catch(error){updateInstalling=false;throw error;}},()=>{updateInstalling=false;}),()=>!!dataDirectoryService?.isChanging()||controller.hasActiveSessionWork()||state.snapshot().sessions.some(s=>s.status==='running'||s.status==='uncertain'),app.isPackaged&&process.platform==='win32'&&!userDataOverride);
 const stopUpdateEvents=desktopUpdates.subscribe(payload=>shared.native!.plugins.publish({type:'plugin',id:'workbench.updates',topic:'changed',payload}));
 const core=async(request:{method:string;payload:unknown})=>request.method==='desktop-updates/status'?desktopUpdates.snapshot():request.method==='desktop-updates/check'?desktopUpdates.check():request.method==='desktop-updates/install'?desktopUpdates.install():request.method.startsWith('plugin-recovery/')?recoveryCall(request.method,request.payload):request.method==='branding/get'?shared.native!.plugins.branding.get():request.method==='branding/list'?shared.native!.plugins.branding.list():request.method==='ui-preferences/get'?uiPreferences.snapshot():request.method==='ui-preferences/update'?uiPreferences.update(request.payload as import('../../../packages/ui-preferences').UiPreferenceChange):request.method==='ui-preferences/flush-ready'?(flushAcknowledged?.((request.payload as {token:string}).token),null):request.method==='visualizations/instructions'?visualizationPresentation.instructions((request.payload as {runtime?:string})?.runtime):request.method==='visualizations/read'?(()=>{const p=request.payload as {sessionId?:string;path:string};const session=state.snapshot().sessions.find(s=>s.id===p.sessionId);if(p.sessionId&&!session)throw Error('VISUALIZATION_SESSION_UNAVAILABLE');return htmlPreviews.readVisualization(session?.projectPath??'',p.path);})():request.method==='visualizations/render'?htmlPreviews.createVisualization(request.payload as import('../../../packages/visualizations/document').VisualizationPageOptions):request.method==='visualizations/release'?htmlPreviews.releaseVisualization((request.payload as {url:string}).url):request.method==='html/preview'?(()=>{const p=request.payload as {sessionId?:string;path:string};const cwd=state.snapshot().sessions.find(s=>s.id===p.sessionId)?.projectPath??'';return htmlPreviews.create(cwd,p.path);})():request.method==='desktop/titlebar'?desktopMenu!.setAppearance(request.payload):request.method==='desktop/action'?desktopMenu!.execute((request.payload as {id?:unknown})?.id):request.method==='desktop/menu'?desktopMenu!.popup((request.payload??{}) as Record<string,unknown>):request.method==='desktop/data-directory'?dataDirectoryService!.get():request.method==='desktop/data-directory/choose'?dataDirectoryService!.choose((request.payload as {kind?:'codex'})?.kind):request.method==='desktop/data-directory/migrate'?dataDirectoryService!.migrate((request.payload as {target:string})?.target):request.method==='desktop/info'?{version:app.getVersion()}:controller.call(request.method,request.payload);
 shared.native.plugins.connectHost(core);
 shared.native.plugins.connectEvents(event=>{if(event.type==='plugin'&&!window.isDestroyed())window.webContents.send('workbench:plugin-event',event);});
 desktopMenu=installDesktopMenu(window,()=>state.snapshot().theme,value=>shared.native!.plugins.dispatch({method:'theme/set',payload:{theme:value}},core),async()=>{guardian?.show();},()=>state.snapshot().shortcuts,()=>{void windowState.zoomChanged();});
 const cleanupTimer=setInterval(()=>{void controller.maintainWorktrees().catch(()=>{});void controller.maintainRemote().catch(()=>{});},60000);cleanupTimer.unref();
 const stopBrandingEvents=shared.native.plugins.branding.subscribe(payload=>shared.native!.plugins.publish({type:'plugin',id:'workbench.branding',topic:'changed',payload}));
 const lifecycle=installTray(window,async()=>{desktopUpdates.dispose();stopUpdateEvents();stopBrandingEvents();clearInterval(cleanupTimer);stopBootWatch();await flushRenderer();await windowState.flush();windowState.dispose();await controller.dispose();await recovery.closed();guardian?.close();},!!userDataOverride,shared.native.plugins.branding);
 const developmentServices:Record<string,object|undefined>={
  ...controller.developmentServices(),
  'desktop.updates':desktopUpdates,
  'desktop.data-directory':dataDirectoryService,
  'ui.preferences':uiPreferences,'desktop.window-state':windowState,
  'native.resources':shared.native,'native.memory':shared.native.memory,'native.memory-controls':shared.native.memoryControls,
  'native.skills':shared.native.skills,'native.plugins':shared.native.nativePlugins,'native.cli':shared.native.cli,
  'extensions':shared.native.plugins,'legacy.memory':shared.memory,'legacy.skills':shared.skills,
  'extensions.recovery':recoveryApi,
  'appearance.reference-fonts':claudeReferenceFont,
  'desktop.app':app,'desktop.window':window,'desktop.menu':desktopMenu,'desktop.tray':lifecycle,
  'desktop.clipboard':clipboard,'desktop.dialog':dialog,'desktop.shell':shell,'desktop.theme':nativeTheme,
  'desktop.protocol':protocol,'desktop.session':electronSession.defaultSession,'files.html-preview':htmlPreviews,'visualizations.presentation':visualizationPresentation,
 };
 for(const [id,service] of Object.entries(developmentServices))if(service)shared.native.plugins.services.register(id,service,{version:1});
 await shared.native.initialize();
 desktopUpdates.start();
 receiveLink=url=>{if(lifecycle.isQuitting())return;const id=parseThreadDeepLink(url);if(id&&state.snapshot().sessions.some(session=>session.id===id)){navigationSessionId=id;if(!hiddenQa)lifecycle.show();if(!window.isDestroyed())window.webContents.send('workbench:navigate',id);}};
 if(pendingLink)receiveLink(pendingLink);
 ipcMain.handle('workbench:call',async(event,method:unknown,payload:unknown)=>{
  try{
   if((lifecycle.isQuitting()||updateInstalling||dataDirectoryService?.isChanging())&&!['ui-preferences/update','ui-preferences/flush-ready','ui-preferences/get'].includes(String(method)))throw new Error('工作台正在退出，请稍后重新打开。');
   if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==allowedUrl)throw new Error('IPC 来源未授权。');
   if(typeof method!=='string'||method.length>100)throw new Error('无效的 IPC 请求。');
   const bytes=method==='attachments/save-as'?(payload as {png?:unknown})?.png:undefined;
   const files=method==='attachments/import'?(payload as {files?:{bytes?:unknown}[]})?.files:undefined;
   if(bytes!==undefined&&(!(bytes instanceof Uint8Array)||bytes.byteLength>20*1024*1024))throw Error('ATTACHMENT_EDIT_INVALID');
   if(files!==undefined&&(!Array.isArray(files)||files.length>10||files.some(file=>file.bytes!==undefined&&(!(file.bytes instanceof Uint8Array)||file.bytes.byteLength>20*1024*1024))))throw Error('ATTACHMENT_INPUT_INVALID');
   const metadata=bytes!==undefined?{...(payload as object),png:undefined}:files?{files:files.map(file=>({...file,bytes:undefined}))}:payload;
   if(Buffer.byteLength(JSON.stringify(metadata??{}))>2_000_000)throw new Error('无效或过大的 IPC 请求。');
   // Emergency diagnostics and heartbeats cannot be swallowed by plugin middleware.
   return {ok:true,value:await (method.startsWith('plugin-recovery/')?recoveryCall(method,payload):shared.native!.plugins.dispatch({method,payload},core))};
  }catch(error){return {ok:false,error:safeError(error)};}
 });
 guardian?.monitorRenderer();
 window.webContents.on('render-process-gone',()=>{if(!lifecycle.isQuitting())void recovery.incident({id:'workbench.renderer'},'PLUGIN_RENDERER_CRASHED','renderer','unknown');});
 window.webContents.on('unresponsive',()=>{if(!lifecycle.isQuitting())void recovery.incident({id:'workbench.renderer'},'PLUGIN_RENDERER_UNRESPONSIVE','renderer','unknown');});
 await window.loadFile(index);firstPresentation.documentLoaded();
 app.on('second-instance',(_event,argv)=>{const link=argv.find(argument=>argument.startsWith('agent-workbench:'));if(link)receiveLink?.(link);if(!hiddenQa)lifecycle.show();});
 app.on('activate',()=>{if(!hiddenQa)lifecycle.show();});
}
