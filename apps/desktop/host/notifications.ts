import { app, Notification, type BrowserWindow } from 'electron';
import type { UiPreferenceStore } from '../../../packages/ui-preferences/store';
import type { AttentionDelivery } from '../../../packages/attention-notifications';
import { brandingImage } from './branding';
import { threadDeepLink } from '../../../packages/navigation';

export interface DesktopNotice { title: string; body: string; sessionId?: string }
export function desktopNotice(value: unknown): DesktopNotice {
  const v = value as Partial<DesktopNotice> | null;
  if (typeof v?.title !== 'string' || typeof v.body !== 'string' || !v.title.trim() || v.title.length > 200 || v.body.length > 500 || v.sessionId !== undefined && (typeof v.sessionId !== 'string' || v.sessionId.length > 100)) throw Error('DESKTOP_NOTIFICATION_INVALID');
  return { title: v.title, body: v.body, ...(v.sessionId ? { sessionId: v.sessionId } : {}) };
}

const threadLink = (sessionId: string) => { try { return threadDeepLink(sessionId); } catch { return undefined; } };
const xml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
function toastXml(notice: DesktopNotice, link: string, sound: boolean) {
  return `<toast launch="${xml(link)}" activationType="protocol"><visual><binding template="ToastGeneric"><text>${xml(notice.title)}</text><text>${xml(notice.body)}</text></binding></visual>${sound ? '' : '<audio silent="true"/>'}</toast>`;
}

/** System notifications always appear; `notifications.sound` only decides whether they are silent. */
export class DesktopNotifier {
  // Electron drops click handlers of collected notifications; keep shown ones until dismissed.
  private live = new Set<Notification>();
  private recorded: (DesktopNotice & AttentionDelivery)[] = [];
  constructor(private window: BrowserWindow, private preferences: UiPreferenceStore, private open: (sessionId: string) => void, private testing: boolean) {
    if (testing) Object.assign(app, { __workbenchNotificationsTest: { shown: () => structuredClone(this.recorded) } });
  }
  /** Background: the window is hidden, minimized or not foreground, or another session (or settings) is shown. */
  focused(sessionId: string) {
    const w = this.window;
    if (w.isDestroyed() || !w.isVisible() || w.isMinimized() || !w.isFocused()) return false;
    return this.preferences.get('navigation.view').value === 'workspace' && this.preferences.get('navigation.session').value === sessionId;
  }
  sound() { return this.preferences.get('notifications.sound').value !== false; }
  show(value: unknown): AttentionDelivery {
    const notice = desktopNotice(value), sound = this.sound();
    // Test profiles record instead of putting toasts on the developer's desktop.
    if (this.testing) { this.recorded.push({ ...notice, shown: true, sound }); return { shown: true, sound }; }
    if (!Notification.isSupported()) return { shown: false, sound: false };
    // Windows: a protocol launch target keeps the click working after the banner has moved
    // into the notification center, where Electron's in-process click handler no longer fires.
    const link = process.platform === 'win32' && notice.sessionId ? threadLink(notice.sessionId) : undefined;
    const toast = new Notification({ title: notice.title, body: notice.body, silent: !sound, icon: brandingImage(), ...(link ? { toastXml: toastXml(notice, link, sound) } : {}) });
    const release = () => { this.live.delete(toast); };
    toast.on('click', () => { release(); if (notice.sessionId) this.open(notice.sessionId); });
    toast.on('close', release); toast.on('failed', (_event, error) => { release(); console.error('DESKTOP_NOTIFICATION_FAILED', error); });
    this.live.add(toast); if (this.live.size > 50) this.live.delete(this.live.values().next().value!);
    toast.show();
    return { shown: true, sound };
  }
}
