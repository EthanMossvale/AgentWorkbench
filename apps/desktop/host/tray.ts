import { app, Menu, Tray, type BrowserWindow } from 'electron';
import {BrandingRegistry} from '../../../packages/branding';
import {brandingImage} from './branding';

/** X keeps this exact window alive. Only a real app quit runs cleanup. */
export function installTray(window: BrowserWindow, dispose: () => Promise<void>, testing: boolean, branding = new BrandingRegistry()) {
  let tray: Tray | undefined;
  let quitting = false, cleanupStarted = false, cleanupFinished = false, cleanupCalls = 0;
  const windowId = window.id;
  const backgroundThrottling = window.webContents.getBackgroundThrottling();
  let currentBrand = branding.get();
  const applyBranding = () => {
    currentBrand = branding.get();
    if(!window.isDestroyed())window.setIcon(brandingImage(currentBrand));
    if(tray&&!tray.isDestroyed())tray.setImage(brandingImage(currentBrand,true));
    app.dock?.setIcon(brandingImage(currentBrand));
  };
  const stopBranding=branding.subscribe(applyBranding);
  applyBranding();
  const available = () => !!tray && !tray.isDestroyed();
  const show = () => { if (quitting || window.isDestroyed()) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); };
  const quit = () => app.quit();
  try {
    if (testing && process.env.AGENT_WORKBENCH_TEST_TRAY_FAIL === '1') throw new Error('Test tray failure');
    const image = brandingImage(currentBrand,true); if (image.isEmpty()) throw new Error('Tray image unavailable');
    tray = new Tray(image);
    tray.setToolTip('Agent Workbench');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '显示 Agent Workbench', click: show }, { type: 'separator' }, { label: '退出', click: quit }]));
    tray.on('click', show); tray.on('double-click', show);
  } catch { tray?.destroy(); tray = undefined; }
  window.on('close', event => { if (!quitting && available()) { event.preventDefault(); window.hide(); } });
  app.on('before-quit', event => {
    quitting = true;
    if (cleanupFinished) return;
    event.preventDefault();
    if (cleanupStarted) return;
    cleanupStarted = true; cleanupCalls++;
    // The controller fences new requests synchronously before its first await.
    void dispose().catch(() => { /* Failed remote cleanup remains unconfirmed. */ }).finally(() => { cleanupFinished = true; app.quit(); });
  });
  app.on('will-quit', () => { stopBranding(); tray?.destroy(); tray = undefined; });
  app.on('window-all-closed', () => { if (!available() || quitting) app.quit(); });
  const snapshot = () => ({ trayAvailable: available(), quitting, cleanupStarted, cleanupFinished, cleanupCalls, windowId, backgroundThrottling, visible: !window.isDestroyed() && window.isVisible(), isDestroyed: window.isDestroyed() });
  if (testing) Object.assign(app, { __workbenchTrayTest: { snapshot, show, quit, branding:()=>({id:currentBrand.id,app:brandingImage(currentBrand).toDataURL(),tray:brandingImage(currentBrand,true).toDataURL(),scales:brandingImage(currentBrand,true).getScaleFactors()}) } });
  return { show, isQuitting: () => quitting };
}
