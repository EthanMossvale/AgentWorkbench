import { mountPluginContent, type PluginContentContext, type PluginContentResult } from './plugin-lifecycle';

export const workbenchSurfaces = Object.freeze({
  'desktop-update':'[data-workbench-desktop-update]',
  'data-directory-settings':'[data-workbench-data-directory-settings]',
  'codex-install-directory':'[data-workbench-codex-install-directory]',
  'composer-model':'[data-workbench-model-controls]', 'composer-runtime':'[data-workbench-runtime-controls]',
  'composer-account':'[data-workbench-composer-account]',
  'draft-recovery':'[data-workbench-draft-recovery]',
  'annotation-selection':'[data-workbench-annotation-selection]',
  'composer-annotations':'[data-workbench-annotations="draft"]', 'message-annotations':'[data-workbench-annotations="message"]',
  'translation-settings':'[data-workbench-translation-settings]', 'translation-source':'[data-workbench-translation-source]',
  'translation-model':'[data-workbench-translation-model]', 'translation-custom':'[data-workbench-translation-custom]',
  'translation-intermediate':'[data-workbench-translation-intermediate]', 'translation-usage':'[data-workbench-translation-usage]',

  'follow-up-settings':'[data-workbench-follow-up-settings]', 'follow-up-queue':'[data-workbench-follow-up-queue]', 'follow-up-menu':'[data-workbench-follow-up-menu]', 'follow-up-detail':'[data-workbench-follow-up-detail]', 'user-message':'[data-workbench-user-message]',
  visualization:'[data-workbench-visualization]', 'visualization-toolbar':'[data-workbench-visualization-toolbar]',
  'brand-mark': '[data-workbench-brand-mark]',
  'ui-preferences-status': '[data-workbench-ui-preferences-status]',
  shell: '.desktop-frame', titlebar: '.desktop-titlebar', sidebar: '.sidebar',
  'session-preview': '[data-workbench-session-preview]', 'session-preview-body': '[data-workbench-session-preview-body]',
  'session-preview-title': '[data-workbench-session-preview-title]',
  'project-preview': '[data-workbench-project-preview]', 'project-folder': '[data-workbench-project-folder]',
  main: '.main-panel', workspace: '.workspace', composer: '.composer-area',
  'file-link': '[data-workbench-file-link]', 'file-link-menu': '[data-workbench-file-menu]', 'file-reader': '[data-testid="file-dock"]',
  'file-link-candidates': '[data-workbench-file-candidates]',
  'workspace-header': '.workspace-header', conversation: '.conversation-column',
  'reply-memory': '[data-testid="reply-memory"]',
  'session-fork-action': '[data-workbench-fork-action]', 'session-fork-picker': '[data-workbench-fork-picker]',
  settings: '.settings-layout',
  'local-cli-row': '.runtime-cli-row',
  shortcuts: '[data-workbench-shortcuts]', 'shortcut-recorder': '[data-workbench-shortcut-recorder]',
  'appearance-theme': '[data-workbench-theme-picker]',
  'connection-layout': '.connection-layout', 'remote-files': '.remote-file-dock',
  'workspace-export-duration': '[data-workbench-workspace-export-duration]',
  'workspace-import': '[data-workbench-workspace-import]',
  'remote-configuration-row': '[data-workbench-remote-configuration]', 'remote-configuration-plan': '[data-workbench-remote-configuration-plan]',
  'remote-cli-row': '.remote-cli-row', 'session-retention': '.remote-retention',
  'account-name-editor': '.account-name-editor', 'account-identity-email': '[data-workbench-account-email]',
  'model-account-login': '.model-account-login', 'model-account-import': '.model-account-import',
  'model-accounts': '.local-model-accounts', 'model-usage': '.model-usage-summary',
  'model-account-card': '[data-workbench-account-card]', 'model-account-quota': '[data-workbench-account-quota]', 'account-allocations': '[data-workbench-quota-allocations]',
  'model-account-export-trigger': '[data-workbench-account-export-trigger]', 'model-account-export': '[data-workbench-account-export]',
  'session-metrics': '[data-session-metrics]', 'turn-progress': '[data-turn-progress]',
  'active-turn-progress': '[data-active-turn-progress]', 'turn-process': '[data-turn-process]',
  'turn-error': '[data-turn-error]',
  'native-event-notice': '[data-workbench-native-event]',
  'chat-event': '[data-workbench-chat-event]',
  'activity-group': '[data-workbench-activity-group]',
  'runtime-usage': '[data-workbench-runtime-usage]',
  'file-change-capsule': '[data-file-change-capsule]', 'file-change-list': '[data-file-change-list]',
  'file-change-card': '[data-file-change-card]', 'file-change-review': '[data-file-change-review]',
  'file-change-diff': '[data-file-change-diff]', 'file-change-reader': '[data-file-change-reader]',
  'subagent-reader': '[data-testid="child-reader"]',
  'subagent-label': '[data-subagent-label]',
  'subagent-model-settings': '[data-testid="child-model-settings"]',
  'translation-toggle': '[data-testid="translation-quick-toggle"]',
  'translation-preview': '[data-workbench-preview]',
  'image-viewer': '.image-viewer', 'image-viewer-actions': '.image-viewer-actions',
  'image-viewer-zoom': '.image-zoom', 'attachment-list': '.attachment-list',
  'attachment-menu': '.attachment-context-actions', 'runtime-image-log': '.runtime-image-log',
  'plan-reader': '.plan-reader', 'plan-review': '.codex-plan-review, .approval-card[data-plan-review]',
});
export type SurfacePlacement = 'before' | 'after' | 'replace';
export interface PluginSurface { root: HTMLElement; dispose(): void }
interface Mount { selector: string; root: HTMLElement; placement: SurfacePlacement; order: number }
export interface SurfaceContext extends PluginContentContext { target: HTMLElement }
export type SurfaceRenderer = (context: SurfaceContext) => PluginContentResult | Promise<PluginContentResult>;
interface ObserverMount extends Mount { target: HTMLElement; release: () => void }
interface SurfaceObserver { id: string; selector: string; placement: SurfacePlacement; order: number; render: SurfaceRenderer; failed: (error: unknown) => void; instances: Map<HTMLElement, ObserverMount> }

/** Sibling mounts leave React-owned children intact and follow view changes. */
export function createPluginSurfaces() {
  const mounts = new Set<Mount>(), hidden = new Map<HTMLElement, boolean>();
  const watches = new Set<SurfaceObserver>();
  let stopped = false, sequence = 0;
  const eligible = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].filter(node => node instanceof HTMLElement && !!node.parentElement && !node.closest('[data-plugin-mount], [data-plugin-surface]'));
  const rootFor = (id: string) => { const root = document.createElement('div'); root.dataset.pluginMount = id; return root; };
  const validate = (surface: string, placement: SurfacePlacement) => {
    if (stopped) throw Error('Plugin surfaces are disposed.');
    if (!['before','after','replace'].includes(placement) || typeof surface !== 'string' || !surface || surface.length > 512) throw Error('Invalid plugin surface.');
    const selector = workbenchSurfaces[surface as keyof typeof workbenchSurfaces] ?? surface;
    document.querySelector(selector); return selector;
  };
  const observe = () => observer.observe(document.body, {childList: true, subtree: true, attributes: true});
  const refresh = () => {
    if (stopped) return;
    // Query the original visibility. A replacement must not invalidate selectors
    // such as :not([hidden]) or create a MutationObserver feedback loop.
    observer.disconnect();
    for (const [target, previous] of hidden) target.hidden = previous;
    const groups = new Map<HTMLElement, Mount[]>();
    for (const mount of mounts) {
      const target = eligible(mount.selector)[0];
      if (!target?.parentElement) { mount.root.remove(); continue; }
      const group = groups.get(target) ?? []; group.push(mount); groups.set(target, group);
    }
    for (const watch of watches) {
      const targets = new Set(eligible(watch.selector));
      for (const [target, instance] of watch.instances) if (!targets.has(target)) { watch.instances.delete(target); instance.release(); instance.root.remove(); }
      for (const target of targets) {
        let instance = watch.instances.get(target);
        if (!instance) {
          const root = rootFor(watch.id);
          instance = {selector:watch.selector,placement:watch.placement,order:watch.order,target,root,release:mountPluginContent<SurfaceContext>({root,target},watch.render,watch.failed)};
          watch.instances.set(target,instance);
        }
        const group = groups.get(target) ?? []; group.push(instance); groups.set(target,group);
      }
    }
    for (const [target, previous] of hidden) if (!groups.get(target)?.some(mount => mount.placement === 'replace')) { target.hidden = previous; hidden.delete(target); }
    for (const [target, group] of groups) {
      group.sort((a,b)=>a.order-b.order);
      const replacement = group.filter(mount => mount.placement === 'replace').at(-1);
      if (replacement) { if (!hidden.has(target)) hidden.set(target, target.hidden); if (!target.hidden) target.hidden = true; }
      for (const mount of group) mount.root.hidden = mount.placement === 'replace' && mount !== replacement;
      let cursor: Element = target;
      for (const mount of group.filter(item => item.placement === 'before').reverse()) {
        if (mount.root.nextSibling !== cursor) target.parentElement!.insertBefore(mount.root, cursor);
        cursor = mount.root;
      }
      cursor = target;
      for (const mount of group.filter(item => item.placement !== 'before')) {
        if (cursor.nextSibling !== mount.root) target.parentElement!.insertBefore(mount.root, cursor.nextSibling);
        cursor = mount.root;
      }
    }
    observe();
  };
  const observer = new MutationObserver(records => {
    if (records.some(record => !(record.target instanceof Element) || !record.target.closest('[data-plugin-mount], [data-plugin-surface]'))) refresh();
  });
  observe();
  return {
    mount(id: string, surface: string, placement: SurfacePlacement = 'after'): PluginSurface {
      const selector = validate(surface,placement);
      const root = rootFor(id);
      const mount = {selector,root,placement,order:sequence++}; mounts.add(mount); refresh();
      return {root,dispose:()=>{mounts.delete(mount);root.remove();refresh();}};
    },
    observe(id: string, surface: string, placement: SurfacePlacement, render: SurfaceRenderer, failed: (error: unknown) => void): () => void {
      const selector = validate(surface,placement);
      if (typeof render !== 'function') throw Error('Invalid plugin surface renderer.');
      const watch: SurfaceObserver = {id,selector,placement,order:sequence++,render,failed,instances:new Map()};
      watches.add(watch); refresh();
      return () => { watches.delete(watch); for (const instance of watch.instances.values()) { instance.release(); instance.root.remove(); } watch.instances.clear(); refresh(); };
    },
    dispose() { stopped = true; observer.disconnect(); for (const watch of watches) for (const instance of watch.instances.values()) { instance.release(); instance.root.remove(); } watches.clear(); for (const mount of mounts) mount.root.remove(); mounts.clear(); for (const [target, previous] of hidden) target.hidden = previous; hidden.clear(); },
  };
}
