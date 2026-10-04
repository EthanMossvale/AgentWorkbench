import path from 'node:path';
import { readFileSync } from 'node:fs';
import { NativeSessionStorage } from '../../../packages/remote-account-catalog/session-storage';
import { RemoteResourceService } from '../../../packages/remote-account-catalog/resources';
import { WorktreeService } from '../../../packages/worktrees';
import { AttachmentStore } from './attachments';
import { StateStore, SecretStore } from './store';
import { WorkbenchController, safeError } from './controller';
import type { AppState, Capability, Session } from '../../../packages/contracts/index';
import { getNativeCapabilities } from '../../../packages/runtime-claude/index';
import { getLocalExecutorCapabilities } from '../../../services/local-executor/index';
import { parseThreadDeepLink } from '../../../packages/navigation/index';
import { SharedMemoryStore } from '../../../packages/memory-core/index';
import { SharedSkillsStore } from '../../../packages/skills-core/index';
import { SshOnboardingService } from './ssh-onboarding';
import { WorkspaceManagementService } from './workspace-management';
import { NativeQuotaAccounting } from './quota-accounting';
import { AccountUsageService } from '../../../packages/account-usage';
import { CodexBridgeService } from '../../../services/codex-bridge';
import { ClaudeBridgeService } from '../../../services/claude-bridge';
import { selectedSharedAccountRef } from '../../../packages/account-selection';
import { RemoteBrowserService } from '../../../packages/remote-account-catalog/browser';
import { RemoteCliService } from '../../../packages/remote-account-catalog/cli';
import { NativeRuntimeControl } from '../../../packages/workspace-control/native-runtime';
import { AccountServiceSetup } from '../../../packages/remote-account-catalog/setup';
import { FileActionService } from './file-actions';
import { NativeResources } from './native-resources';
import { officialLoginUrl } from '../../../packages/model-management/native';
import { createStatePublisher } from '../../../packages/session-core/state-stream';
import type { PluginIdentity, PluginRecoveryStore, RecoverySnapshot } from '../../../packages/plugins-core/recovery';
import { createRpcPeer, type CallFence, type RpcPeer } from './process-rpc';

/**
 * The workbench core: state, persistence, native runtimes, SSH transports, tools
 * and host plugins. It runs in an Electron utility process so model execution
 * never occupies the UI process thread that pumps window input. Electron-only
 * capabilities (dialogs, shell, clipboard, OS credential store, image work) are
 * requested from the UI process; window updates go over a direct MessagePort.
 */
export const CORE_PROCESS_FLAG = '--workbench-core';
export interface CoreInit {
  directory: string; appPath: string; version: string; testProfile: boolean; temporaryClipboard: boolean;
  executables?: { codex?: string; claude?: string }; recovery: RecoverySnapshot; recoveryHostVersion: string;
}
/** Methods the UI process answers (window, OS and UI-preference services). */
export const UI_OWNED_METHODS = ['desktop-updates/', 'plugin-recovery/', 'ui-preferences/', 'visualizations/instructions', 'visualizations/render', 'visualizations/release', 'desktop/'];
const uiOwned = (method: string) => UI_OWNED_METHODS.some(prefix => prefix.endsWith('/') ? method.startsWith(prefix) : method === prefix);
/** UI-process services exposed to host plugins as asynchronous proxies. */
export const UI_SERVICES = ['desktop.updates', 'desktop.data-directory', 'ui.preferences', 'desktop.window-state', 'extensions.recovery', 'appearance.reference-fonts', 'desktop.app', 'desktop.window', 'desktop.menu', 'desktop.tray', 'desktop.clipboard', 'desktop.dialog', 'desktop.shell', 'desktop.theme', 'desktop.protocol', 'desktop.session', 'files.html-preview', 'visualizations.presentation'];

interface MessagePortLike { postMessage(message: unknown): void; on(event: 'message', listener: (event: { data: unknown }) => void): void; on(event: 'close', listener: () => void): void; start(): void; close(): void }
interface ParentPort { postMessage(message: unknown): void; on(event: 'message', listener: (event: { data: unknown; ports: MessagePortLike[] }) => void): void }

/** Callers pass whole plugin records (which may hold functions); only the identity crosses processes. */
const identity = (plugin: PluginIdentity): PluginIdentity => ({ id: plugin.id, ...(plugin.name !== undefined ? { name: plugin.name } : {}), ...(plugin.hash !== undefined ? { hash: plugin.hash } : {}), ...(plugin.version !== undefined ? { version: plugin.version } : {}) });

/** Plugin recovery stays owned by the UI process; this mirror serves the registry in core. */
class RemoteRecoveryStore {
  private current: RecoverySnapshot; private listeners = new Set<(snapshot: RecoverySnapshot) => void>(); private tokens = 0;
  constructor(private ui: RpcPeer, initial: RecoverySnapshot, readonly hostVersion: string, readonly directory: string) {
    this.current = initial;
    ui.on('recovery', snapshot => { this.current = snapshot as RecoverySnapshot; for (const listener of this.listeners) listener(structuredClone(this.current)); });
  }
  get file() { return path.join(this.directory, 'plugin-recovery.json'); }
  snapshot(): RecoverySnapshot { return structuredClone(this.current); }
  hasPendingActivation() { return this.current.pending.length > 0; }
  subscribe(listener: (snapshot: RecoverySnapshot) => void) { this.listeners.add(listener); listener(this.snapshot()); return () => { this.listeners.delete(listener); }; }
  activity(plugin: PluginIdentity, phase: unknown) { const token = ++this.tokens; this.ui.emit('recovery.activity', { token, plugin: identity(plugin), phase }); return () => { this.ui.emit('recovery.activity-end', { token }); }; }
  private forward(method: string, ...args: unknown[]) { return this.ui.call<void>('recovery', method, ...args); }
  initialize() { return this.forward('initialize'); }
  beginBoot() { return this.forward('beginBoot'); }
  safeMode(enabled: boolean) { return this.forward('safeMode', enabled); }
  begin(plugin: PluginIdentity, ...args: unknown[]) { return this.forward('begin', identity(plugin), ...args); }
  finish(...args: unknown[]) { return this.forward('finish', ...args); }
  incident(plugin: PluginIdentity, ...args: unknown[]) { return this.forward('incident', identity(plugin), ...args); }
  clear(...args: unknown[]) { return this.forward('clear', ...args); }
  clearCompatibility(...args: unknown[]) { return this.forward('clearCompatibility', ...args); }
  ready() { return this.forward('ready'); }
  closed() { return this.forward('closed'); }
}

/** Host plugins keep their service ids; members are invoked asynchronously in the UI process. */
const remoteService = (ui: RpcPeer, id: string) => new Proxy({}, { get: (_target, member) => typeof member === 'string' && member !== 'then' ? (...args: unknown[]) => ui.call('service.invoke', id, member, args) : undefined });

export async function runCore(parent: ParentPort) {
  const ui = createRpcPeer(message => parent.postMessage(message));
  let rendererPort: MessagePortLike | undefined, rendererPortId = 0, portSeq = 0;
  const ready = new Promise<CoreInit>(resolve => ui.handle('init', ((init: CoreInit) => { resolve(init); return new Promise(done => readyDone = done); }) as never));
  let readyDone: (value: unknown) => void = () => {};
  const portMessages: ((message: unknown) => void)[] = [];
  let portConnected = () => {};
  parent.on('message', event => {
    const port = event.ports?.[0];
    // Each window load requests a fresh port; it starts from a complete state.
    if (port) { rendererPort?.close(); rendererPort = port; rendererPortId = Number((event.data as { id?: unknown })?.id) || 0; portSeq = 0; port.on('message', message => { for (const listener of portMessages) listener(message.data); }); port.start(); portConnected(); return; }
    ui.receive(event.data);
  });
  const init = await ready;
  const { directory } = init;
  // Liveness for the recovery guardian: a stalled core (e.g. a looping host plugin) stops these.
  ui.emit('alive'); setInterval(() => ui.emit('alive'), 500).unref();
  const toRenderer = (type: string, payload?: unknown) => { try { if (rendererPort) { rendererPort.postMessage({ type, payload }); portSeq++; } } catch { /* A closed window must not fail the core. */ } };
  const dialogOpen = async (options: Record<string, unknown>) => { const picked = await ui.call<{ canceled: boolean; filePaths: string[] }>('dialog.open', options); return picked.canceled ? [] : picked.filePaths; };
  const dialogSave = async (options: Record<string, unknown>) => { const picked = await ui.call<{ canceled: boolean; filePath?: string }>('dialog.save', options); return picked.canceled ? null : picked.filePath ?? null; };
  const state = new StateStore(directory); await state.load();
  const shared: { memory: SharedMemoryStore; skills: SharedSkillsStore; native?: NativeResources } = { memory: new SharedMemoryStore(directory), skills: new SharedSkillsStore(directory) };
  const secrets = new SecretStore(path.join(directory, 'secrets'), {
    encrypt: async text => Buffer.from(await ui.call<Uint8Array>('crypto.encrypt', text)),
    decrypt: data => ui.call<string>('crypto.decrypt', new Uint8Array(data)),
  });
  let hasSessionWork = () => false, quitting = false, dataDirectoryChanging = false;
  ui.on('lifecycle', value => { const v = value as { quitting?: boolean; dataDirectoryChanging?: boolean }; if (typeof v.quitting === 'boolean') quitting = v.quitting; if (typeof v.dataDirectoryChanging === 'boolean') dataDirectoryChanging = v.dataDirectoryChanging; });
  const recovery = new RemoteRecoveryStore(ui, init.recovery, init.recoveryHostVersion, directory) as unknown as PluginRecoveryStore;
  const running = () => state.read().sessions.some(session => session.status === 'running' || session.status === 'uncertain');
  shared.native = new NativeResources(directory, {
    openZip: async kind => (await dialogOpen({ title: kind === 'skill' ? '导入 Skill ZIP' : '导入工作台插件 ZIP', properties: ['openFile'], filters: [{ name: 'ZIP', extensions: ['zip'] }] }))[0] ?? null,
    saveZip: async name => dialogSave({ title: '导出分享包', defaultPath: name, filters: [{ name: 'ZIP', extensions: ['zip'] }] }),
  }, () => state.read().projects.flatMap(project => project.paths ?? [project.path]), () => toRenderer('extensions'), init.testProfile ? path.join(directory, 'native-home') : undefined,
  { pluginOptions: { recovery }, cliOptions: { ...(init.executables ? { executables: init.executables } : {}), idle: () => !dataDirectoryChanging && !hasSessionWork() && !running() } });
  const nativeCodex = await CodexBridgeService.load(path.join(init.appPath, 'build/runtime/codex-0.155.1/codex.exe'), path.join(directory, 'native-codex'), path.join(init.appPath, 'build/qa/native-acceptance.json'));
  await state.update(snapshot => { for (const saved of snapshot.sessions) { const host = snapshot.hosts.find(item => item.id === saved.binding.hostId); if (saved.status === 'blocked' && host && nativeCodex.supports(host, saved)) { saved.status = 'idle'; if (!saved.messages.length && saved.title === 'Codex · 待验证连接') saved.title = '新的 Codex 任务'; } } });
  const accepted = () => { const current = state.read(); return current.hosts.some(host => nativeCodex.supports(host, { binding: { runtime: 'codex', provider: 'openai', hostId: host.id, executionId: 'local-device', egress: 'vps', accountRef: selectedSharedAccountRef(current.accountCatalogs?.[host.id]) ?? '', accountRuntime: current.accountCatalogs?.[host.id]?.source } } as Session)); };
  const capabilities = (): Capability[] => [
    ...getNativeCapabilities(), ...getLocalExecutorCapabilities(),
    { id: 'egress', label: '原生模型远端出网', status: 'unverified' as const, detail: '尚未执行真实模型任务和网络出口验证，不以进程位置代替证据。' },
  ].map(item => accepted() && ['codex-h-native', 'local-executor-contract', 'egress'].includes(item.id) ? { ...item, status: 'implemented' as const, detail: item.id === 'egress' ? '已验收绑定的 Codex 0.155.1：真实模型任务期间，VPS 原生进程具有外部 HTTPS 连接；未宣称工具网络也统一从 VPS 出口。' : '已验收绑定的 Codex 0.155.1：VPS 原生认证、本机文件读取/补丁/PowerShell、审批、恢复和停止清理；其它连接仍须独立验收。' } : item);
  // Only changed root fields, sessions and entries cross to the window, directly over its port.
  const statePublisher = createStatePublisher(); let publishedState: AppState | undefined;
  const sendState = () => { if (!publishedState || !rendererPort) return; const patch = statePublisher.next(publishedState); if (patch) toRenderer('state-patch', patch); };
  portMessages.push(message => { if ((message as { type?: string })?.type === 'resync') { statePublisher.reset(); sendState(); } });
  portConnected = () => { statePublisher.reset(); sendState(); };
  let navigationSessionId: string | null = null, appearance = '';
  const controller = new WorkbenchController(state, secrets, {
    worktrees: new WorktreeService(directory),
    generatedImageDecoder: data => ui.call('image.decode', new Uint8Array(data)),
    attachments: new AttachmentStore(path.join(directory, 'attachments'), data => ui.call<string | undefined>('image.thumbnail', new Uint8Array(data)), [directory], async name => dialogSave({ title: '附件另存为', defaultPath: name }), { nativePaths: true, copyImage: async data => { await ui.call('clipboard.image', new Uint8Array(data)); }, ...(init.temporaryClipboard ? { temporaryDirectory: path.join(directory, 'clipboard-temp') } : {}) }),
    pickAttachments: () => dialogOpen({ properties: ['openFile', 'multiSelections'], title: '添加附件' }),
    pickAccountExport: fileName => dialogSave({ title: '导出账号 JSON', defaultPath: fileName, filters: [{ name: 'JSON', extensions: ['json'] }] }),
    modelControlPaths: [directory],
    fileActions: new FileActionService({ openPath: async target => { const failure = await ui.call<string>('shell.openPath', target); if (failure) throw Error(failure); }, reveal: target => { void ui.call('shell.reveal', target); }, copy: text => { void ui.call('clipboard.text', text); }, pickSave: source => dialogSave({ title: '另存为', defaultPath: source }) }),
    nativeCodex, nativeClaude: new ClaudeBridgeService(path.join(directory, 'native-claude')),
    accountUsage: new AccountUsageService(directory),
    nativeAccounts: new NativeRuntimeControl(directory),
    accountSetup: new AccountServiceSetup(),
    remoteCli: new RemoteCliService(),
    remoteCliPolicies: new RemoteCliService(),
    sessionStorage: new NativeSessionStorage(path.join(directory, 'remote-session-archives')),
    remoteResources: new RemoteResourceService(undefined, { upload: async () => (await dialogOpen({ title: '上传到远端', properties: ['openFile'] }))[0] ?? null, download: name => dialogSave({ title: '从远端下载（另存为新文件）', defaultPath: name }) }),
    remoteBrowser: new RemoteBrowserService(async url => { if (!/^http:\/\/127\.0\.0\.1:\d+\/vnc\.html\?autoconnect=1&resize=scale$/.test(url)) throw Error('Invalid remote viewer URL.'); await ui.call('shell.openExternal', url); }),
    quotaAccounting: new NativeQuotaAccounting(directory, () => state.snapshot()),
    revealPath: target => { void ui.call('shell.reveal', target); },
    openWeb: async url => { const value = new URL(url); await ui.call('shell.openExternal', value.href); },
    sshOnboarding: new SshOnboardingService({ directory, ...(init.testProfile ? { home: path.join(directory, 'synthetic-home') } : {}), pickFile: async kind => (await dialogOpen({ title: kind === 'key' ? '选择 SSH 密钥或连接配置' : kind === 'config' ? '导入 SSH 连接配置' : '选择已有服务器身份记录', properties: ['openFile'] }))[0] ?? null }),
    workspaceManagement: new WorkspaceManagementService({ directory, pickImport: async () => (await dialogOpen({ title: '导入工作空间', properties: ['openFile'], filters: [{ name: '工作空间', extensions: ['awworkspace'] }] }))[0] ?? null, pickExport: filename => dialogSave({ title: '导出工作空间', defaultPath: filename, filters: [{ name: '工作空间', extensions: ['awworkspace'] }] }) }),
    pickDirectory: async () => (await dialogOpen({ properties: ['openDirectory'], title: '选择本机项目目录' }))[0] ?? null,
    pickDirectories: () => dialogOpen({ properties: ['openDirectory', 'multiSelections'], title: '为项目关联文件夹' }),
    pickSkill: async () => (await dialogOpen({ properties: ['openFile'], title: '导入共享 SKILL.md', filters: [{ name: 'Skill Markdown', extensions: ['md'] }] }))[0] ?? null,
    getNavigation: () => navigationSessionId,
    openSession: sessionId => { if (quitting) throw Error('SESSION_NAVIGATION_UNAVAILABLE'); navigationSessionId = sessionId; toRenderer('navigate', sessionId); },
    openPath: async target => { const failure = await ui.call<string>('shell.openPath', target); if (failure) throw new Error('无法在文件管理器打开目录。'); },
    openExternal: async url => { if (!officialLoginUrl(url, 'codex') && !officialLoginUrl(url, 'claude')) throw new Error('LOCAL_ACCOUNT_BROWSER_URL_REJECTED'); await ui.call('shell.openExternal', url); },
    copy: value => { void ui.call('clipboard.text', value); }, nativeCapabilities: capabilities,
  }, updated => {
    const next = JSON.stringify([updated.theme, updated.shortcuts]); if (next !== appearance) { appearance = next; ui.emit('appearance', { theme: updated.theme, shortcuts: updated.shortcuts }); }
    shared.native?.plugins.publish({ type: 'state', payload: updated }); publishedState = updated; sendState(); reportStatus();
  }, shared);
  hasSessionWork = () => controller.hasActiveSessionWork();
  // The UI process decides about updates, relocation and recovery from this status.
  let status = '';
  const reportStatus = () => { const value = { busy: controller.hasActiveSessionWork() || running(), maintaining: shared.native!.cli.isMaintaining() }; const text = JSON.stringify(value); if (text !== status) { status = text; ui.emit('status', value); } };
  controller.remoteConfigurations.subscribe(() => toRenderer('extensions'));
  controller.localAccounts.access.subscribe(() => toRenderer('extensions'));
  const registry = shared.native.plugins;
  const dispatchToUi = (method: string, payload: unknown) => ui.call('main.call', method, payload);
  const core = async (request: { method: string; payload: unknown }) => {
    const { method, payload } = request;
    if (uiOwned(method)) return dispatchToUi(method, payload);
    if (method === 'branding/get') return registry.branding.get();
    if (method === 'branding/list') return registry.branding.list();
    // Window-side previews read files from the session's project directory resolved here.
    if (method === 'visualizations/read' || method === 'html/preview') {
      const p = payload as { sessionId?: string; path: string }, session = state.read().sessions.find(item => item.id === p?.sessionId);
      if (method === 'visualizations/read' && p?.sessionId && !session) throw Error('VISUALIZATION_SESSION_UNAVAILABLE');
      return ui.call(method === 'html/preview' ? 'html.create' : 'visualization.read', session?.projectPath ?? '', p?.path);
    }
    return controller.call(method, payload);
  };
  registry.connectHost(core);
  registry.connectEvents(event => toRenderer('plugin-event', event), event => event.type === 'plugin');
  const stopBrandingEvents = registry.branding.subscribe(payload => { registry.publish({ type: 'plugin', id: 'workbench.branding', topic: 'changed', payload }); ui.emit('branding', registry.branding.get()); });
  const developmentServices: Record<string, object | undefined> = {
    ...controller.developmentServices(),
    'native.resources': shared.native, 'native.memory': shared.native.memory, 'native.memory-controls': shared.native.memoryControls,
    'native.skills': shared.native.skills, 'native.archives': shared.native.archives, 'native.plugins': shared.native.nativePlugins, 'native.cli': shared.native.cli,
    'extensions': registry, 'legacy.memory': shared.memory, 'legacy.skills': shared.skills,
    ...Object.fromEntries(UI_SERVICES.map(id => [id, remoteService(ui, id)])),
  };
  for (const [id, service] of Object.entries(developmentServices)) if (service) registry.services.register(id, service, { version: 1 });
  const cleanupTimer = setInterval(() => { void controller.maintainWorktrees().catch(() => {}); void controller.maintainRemote().catch(() => {}); }, 60000); cleanupTimer.unref();
  // Port messages posted before the reply (e.g. the state patch a call caused) must reach the window first.
  const fence = (): CallFence => ({ port: rendererPortId, seq: portSeq });
  ui.handle('call', (async (method: string, payload: unknown) => {
    try { const value = await registry.dispatch({ method, payload }, core); return { value, fence: fence() }; }
    catch (error) { const failure = error as Error & { code?: unknown }; return { error: failure?.message ?? String(error), ...(typeof failure?.code === 'string' ? { code: failure.code } : {}), fence: fence() }; }
  }) as never);
  ui.handle('core', ((method: string, payload: unknown) => core({ method, payload })) as never);
  ui.handle('publish', ((event: Parameters<typeof registry.publish>[0]) => { registry.publish(event); }) as never);
  ui.handle('plugins.list', (() => registry.list()) as never);
  ui.handle('plugins.repair', ((id: string, hash: string) => registry.repairCompatibility(id, hash)) as never);
  ui.handle('plugins.renderer-failed', ((id: string, hash: string) => registry.rendererFailed(id, hash)) as never);
  ui.handle('navigate.link', ((url: string) => { const id = parseThreadDeepLink(url); if (!id || !state.read().sessions.some(session => session.id === id)) return null; navigationSessionId = id; toRenderer('navigate', id); return id; }) as never);
  ui.handle('state.snapshot', (() => controller.call('state/get', {})) as never);
  ui.handle('flush', (() => state.flush()) as never);
  // Test profiles only: UI suites read globals that host plugins set, and host plugins now live here.
  if (process.env.AGENT_WORKBENCH_TEST_DATA) ui.handle('qa.evaluate', (async (source: string, arg: unknown) => (0, eval)(`(${source})`)({}, arg)) as never);
  ui.handle('shutdown', (async () => { clearInterval(cleanupTimer); stopBrandingEvents(); await controller.dispose(); await state.flush().catch(() => {}); }) as never);
  // Reply to init once the core can serve calls; plugin activation continues after.
  readyDone({ theme: state.read().theme, shortcuts: state.read().shortcuts, branding: registry.branding.get(), distribution: readDistribution(init.appPath) });
  try { await shared.native.initialize(); reportStatus(); ui.emit('initialized', null); }
  catch (error) { ui.emit('initialize-failed', safeError(error)); }
}
function readDistribution(appPath: string): unknown { try { return JSON.parse(readFileSync(path.join(appPath, 'package.json'), 'utf8')).workbenchDistribution; } catch { return undefined; } }
