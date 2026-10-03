import {annotationController,type AnnotationsApi,type AnnotationAction,type AnnotationSelection} from './annotation-controller';
import { visualizations, parseVisualization, type VisualizationsApi, type VisualizationReference, type VisualizationDocument, type VisualizationRenderer } from '../../../packages/visualizations';
import {uiPreferences} from './ui-preferences';
import type {UiPreferencesApi,UiPreferenceDefinition,UiValue} from '../../../packages/ui-preferences';
import {shortcuts,type ShortcutsPluginApi,type ShortcutDefinition,type ShortcutHandler} from './shortcuts';
import {fileReviewController,type FileReviewPluginApi,type FileReviewViewDefinition,type FileReviewTarget} from './file-review-controller';
import {attachmentDraft} from './attachment-draft';
import {attachmentActions,type AttachmentActionDefinition} from './attachment-actions';
import { fontPresets, type FontPluginApi, type FontPresetDefinition } from '../../../packages/appearance/fonts';
import {imageViewerController,setComposerSizing,type MediaPluginApi} from './media-controller';
import {textPastePolicies,type TextPastePolicy} from '../../../packages/attachments/paste';
import { markdownApi } from '../../../packages/message-markdown';
import {fileReferenceRecognition,type FileReferenceRecognitionApi} from '../../../packages/navigation/file-links';
import {activityGrouping,type ActivityGroupingEntry,type ActivityGroupingRule} from '../../../packages/collaboration-core/activity-groups';
import type { AppState, DesktopCommand, WorkbenchApi } from '../../../packages/contracts';
import type { PluginRendererEntry, PluginHostEvent } from '../../../packages/plugins-core';
import { previewController, type PreviewPluginApi } from './preview-controller';
import { createPluginSurfaces, workbenchSurfaces, type PluginSurface, type SurfacePlacement, type SurfaceRenderer } from './plugin-surfaces';
import { pluginSettings, coreSettingsTabs, coreSettingsLabels, type PluginSettingsApi, type PluginSettingsDefinition, type SettingsPageId } from './plugin-settings';
import type { PluginStorage, PluginDataSnapshot, PluginJson } from '../../../packages/plugins-core/storage-types';
import { themePresets, type ThemePluginApi, type ThemePresetDefinition } from '../../../packages/appearance/themes';
import { codeSyntax, type SyntaxPluginApi, type SyntaxHighlighter } from '../../../packages/appearance/syntax';

export interface RendererPluginApi {
  annotations: AnnotationsApi;
  visualizations: VisualizationsApi;
  uiPreferences: UiPreferencesApi;
  activities: import('../../../packages/collaboration-core/activity-groups').ActivityGroupingApi;
  fileChanges: FileReviewPluginApi;
  shortcuts: ShortcutsPluginApi;
  fonts: FontPluginApi;
  themes: ThemePluginApi;
  syntax: SyntaxPluginApi;
  markdown: typeof markdownApi;
  fileReferences:FileReferenceRecognitionApi;
  media: MediaPluginApi;
  previews: PreviewPluginApi;
  version: 1; id: string; root: HTMLElement; signal: AbortSignal;
  workbench: WorkbenchApi;
  surfaces: typeof workbenchSurfaces;
  mountSurface(surface: string, placement?: SurfacePlacement): PluginSurface;
  observeSurfaces(surface: string, placement: SurfacePlacement, render: SurfaceRenderer): () => void;
  settings: PluginSettingsApi;
  storage: PluginStorage;
  onEvent(listener: (event: PluginHostEvent) => void): () => void;
  call<T = unknown>(method: string, payload?: unknown): Promise<T>;
  command<T = unknown>(name: string, payload?: unknown): Promise<T>;
  onState(listener: (state: AppState) => void): () => void;
  onNavigate(listener: (sessionId: string) => void): () => void;
  onCommand(listener: (command: DesktopCommand) => void): () => void;
  addStyle(css: string): () => void;
  assetUrl(path: string): Promise<string>;
  listen(target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions): () => void;
  replaceShell(): () => void;
  onDispose(cleanup: () => void | Promise<void>): void;
}

type Cleanup = () => void | Promise<void>;
interface ActiveRenderer {
  hash: string; root: HTMLElement; abort: AbortController; cleanup: Cleanup[];
  shell: boolean; ready: boolean; failed: boolean;
}

/** Approved, self-contained ESM bundles run with the existing renderer bridge.
 * Full-trust plugin code is not a security sandbox. The supported API cleans up
 * its own styles, subscriptions and shell mounts without rewriting React's DOM.
 */
export function startPluginRenderers(bridge: WorkbenchApi | undefined, shell: HTMLElement) {
  if (!bridge) return () => {};
  const active = new Map<string, ActiveRenderer>();
  const surfaces = createPluginSurfaces();
  let stopped = false, requested = 0;
  const previousHidden = shell.hidden;
  const updateShell = () => {
    const replacements = [...active.values()].filter(value => value.shell && value.ready && !value.failed);
    const current = replacements.at(-1);
    shell.hidden = !!current || previousHidden;
    for (const value of active.values()) value.root.hidden = !value.ready || value.failed || (value.shell && value !== current);
  };
  const clean = (fn: Cleanup) => { try { void Promise.resolve(fn()).catch(() => {}); } catch { /* Continue releasing other owned resources. */ } };
  const release = (value: ActiveRenderer) => {
    value.abort.abort();
    for (const dispose of value.cleanup.splice(0).reverse()) clean(dispose);
    value.root.remove();
  };
  const activate = async (entry: PluginRendererEntry, value: ActiveRenderer) => {
    const assertActive = () => { if (value.abort.signal.aborted || value.failed) throw Error('Plugin renderer is no longer active.'); };
    const own = (cleanup: Cleanup) => {
      // A registration notification can synchronously fail or disable its owner.
      if(value.abort.signal.aborted||value.failed)clean(cleanup);
      assertActive(); let live = true;
      const once = () => { if (live) { live = false; const index=value.cleanup.indexOf(once);if(index>=0)value.cleanup.splice(index,1);clean(cleanup); } };
      value.cleanup.push(once); return once;
    };
    const failed = (error: unknown) => {
      if (value.abort.signal.aborted || value.failed) return;
      value.failed = true; release(value); updateShell();
      console.warn(`Workbench plugin renderer failed (${entry.id}):`, error);
      void bridge.call('plugin-recovery/renderer-failed', {id:entry.id,hash:entry.hash}).catch(() => {});
    };
    const guarded = <T extends (...args:any[])=>unknown>(listener:T):T => ((...args:Parameters<T>)=>{
      if(value.abort.signal.aborted||value.failed)return;
      try{void Promise.resolve(listener(...args)).catch(failed);}catch(error){failed(error);}
    }) as T;
    const openSettings = (id: SettingsPageId) => { assertActive(); if (!pluginSettings.has(id)) throw Error('PLUGIN_SETTINGS_UNAVAILABLE'); window.dispatchEvent(new CustomEvent('workbench-settings',{detail:id})); };
    const shortcutHandler=(run:ShortcutHandler):ShortcutHandler=>async context=>{assertActive();try{await run(context);}catch(error){failed(error);throw error;}};
    const api: RendererPluginApi = Object.freeze({
      annotations:Object.freeze({
        get:()=>{assertActive();return annotationController.get();},
        add:(selection:AnnotationSelection)=>{assertActive();return annotationController.add(selection);},
        update:(id:string,text:string)=>{assertActive();return annotationController.update(id,text);},
        translate:()=>{assertActive();return annotationController.translate();},
        remove:(id:string)=>{assertActive();return annotationController.remove(id);},
        clear:()=>{assertActive();return annotationController.clear();},
        subscribe:(listener:()=>void)=>{assertActive();return own(annotationController.subscribe(guarded(listener)));},
        listActions:()=>{assertActive();return annotationController.listActions();},
        registerAction:(action:AnnotationAction)=>{assertActive();const handle=annotationController.registerAction(entry.id,action);return {id:handle.id,dispose:own(handle.dispose)};},
        overrideAction:(id:string,action:Omit<AnnotationAction,'id'>)=>{assertActive();const handle=annotationController.overrideAction(id,action);return {id:handle.id,dispose:own(handle.dispose)};},
      }),
      uiPreferences:Object.freeze({
        list:()=>{assertActive();return uiPreferences.registry.list();},
        get:(id:string,scope?:string)=>{assertActive();return uiPreferences.get(id,scope);},
        set:async(id:string,value:UiValue,revision:number,scope?:string)=>{assertActive();const result=await uiPreferences.set(id,value,revision,scope);assertActive();return result;},
        reset:async(id:string,revision:number,scope?:string)=>{assertActive();const result=await uiPreferences.reset(id,revision,scope);assertActive();return result;},
        register:(definition:UiPreferenceDefinition)=>{assertActive();const handle=uiPreferences.registry.register(entry.id,definition);return {id:handle.id,dispose:own(handle.dispose)};},
        override:(id:string,resolve:(value:UiValue,scope?:string)=>UiValue)=>{assertActive();const handle=uiPreferences.registry.override(entry.id,id,(value,scope)=>{assertActive();return resolve(value,scope);});return {id:handle.id,dispose:own(handle.dispose)};},
        subscribe:(listener:()=>void)=>{assertActive();return own(uiPreferences.subscribe(guarded(listener)));},
      }),
      activities:Object.freeze({chat:(item:Readonly<import('../../../packages/collaboration-core/activity').RuntimeActivity>)=>{assertActive();return activityGrouping.chat(item);},registerChat:(rule:import('../../../packages/collaboration-core/activity-groups').ActivityChatRule)=>{assertActive();const handle=activityGrouping.registerChat(entry.id,rule);return {id:handle.id,dispose:own(handle.dispose)};},group:<T extends ActivityGroupingEntry>(items:readonly T[])=>{assertActive();return activityGrouping.group(items);},register:(rule:ActivityGroupingRule)=>{assertActive();const handle=activityGrouping.register(entry.id,rule);return {id:handle.id,dispose:own(handle.dispose)};},subscribe:(listener:()=>void)=>{assertActive();return own(activityGrouping.subscribe(guarded(listener)));}}),
      fileChanges:Object.freeze({
        list:(sessionId?:string)=>{assertActive();return fileReviewController.list(sessionId);},
        open:(target:FileReviewTarget,path?:string)=>{assertActive();fileReviewController.open(target,path);},
        close:(target:FileReviewTarget)=>{assertActive();fileReviewController.close(target);},
        subscribe:(listener:()=>void)=>{assertActive();return own(fileReviewController.subscribe(guarded(listener)));},
        listViews:()=>{assertActive();return fileReviewController.listViews();},
        registerView:(definition:FileReviewViewDefinition)=>{assertActive();const handle=fileReviewController.registerView(entry.id,definition,failed);return {id:handle.id,dispose:own(handle.dispose)};},
      }),
      shortcuts:Object.freeze({
        list:()=>{assertActive();return shortcuts.getSnapshot();},
        subscribe:(listener:()=>void)=>{assertActive();return own(shortcuts.subscribe(guarded(listener)));},
        getSettings:()=>{assertActive();return shortcuts.getSettings();},
        setBindings:async(id:string,bindings:string[],revision:number)=>{assertActive();await shortcuts.save(id,bindings,revision);assertActive();},
        reset:async(id:string|undefined,revision:number)=>{assertActive();await shortcuts.save(id,undefined,revision,true);assertActive();},
        register:(definition:ShortcutDefinition)=>{assertActive();if(typeof definition?.run!=='function')throw Error('SHORTCUT_INVALID_ACTION');const handle=shortcuts.register(entry.id,{...definition,run:shortcutHandler(definition.run)});return {id:handle.id,dispose:own(handle.dispose)};},
        override:(id:string,run:ShortcutHandler)=>{assertActive();if(typeof run!=='function')throw Error('SHORTCUT_INVALID_ACTION');const handle=shortcuts.override(entry.id,id,shortcutHandler(run));return {id:handle.id,dispose:own(handle.dispose)};},
        invoke:async(id:string)=>{assertActive();await shortcuts.invoke(id);assertActive();},
      }),
      fonts: Object.freeze({register:(definition:FontPresetDefinition)=>{assertActive();const handle=fontPresets.register(entry.id,definition);return {id:handle.id,dispose:own(handle.dispose)};},list:()=>{assertActive();return fontPresets.getSnapshot();},subscribe:(listener:()=>void)=>{assertActive();return own(fontPresets.subscribe(guarded(listener)));}}),
      themes: Object.freeze({register:(definition:ThemePresetDefinition)=>{assertActive();const handle=themePresets.register(entry.id,definition);return {id:handle.id,dispose:own(handle.dispose)};},list:()=>{assertActive();return themePresets.getSnapshot();},subscribe:(listener:()=>void)=>{assertActive();return own(themePresets.subscribe(guarded(listener)));}}),
      syntax: Object.freeze({highlight:(text:string,language:string)=>{assertActive();return codeSyntax.highlight(text,language);},register:(language:string,highlight:SyntaxHighlighter)=>{assertActive();return own(codeSyntax.register(language,highlight));},subscribe:(listener:()=>void)=>{assertActive();return own(codeSyntax.subscribe(guarded(listener)));}}),
      visualizations:Object.freeze({
        instructions:async(runtime?:string)=>{assertActive();const result=await bridge.call<string>('visualizations/instructions',{runtime});assertActive();return result;},
        parse:parseVisualization,
        read:async(reference:VisualizationReference,sessionId?:string)=>{assertActive();const result=await bridge.call<VisualizationDocument>('visualizations/read',{sessionId,path:reference.path});assertActive();return result;},
        render:async(document:VisualizationDocument,reference:VisualizationReference,renderer:string,signal:AbortSignal)=>{assertActive();const result=await visualizations.render(document,reference,renderer,signal);assertActive();return result;},
        listRenderers:()=>{assertActive();return visualizations.listRenderers();},
        registerRenderer:(definition:VisualizationRenderer)=>{assertActive();const handle=visualizations.register(entry.id,{...definition,render:context=>{assertActive();return definition.render(context);}});return {id:handle.id,dispose:own(handle.dispose)};},
        subscribe:(listener:()=>void)=>{assertActive();return own(visualizations.subscribe(guarded(listener)));},
      }),
      markdown: markdownApi,
      fileReferences: Object.freeze({code:(text:string)=>{assertActive();return fileReferenceRecognition.code(text);},subscribe:(listener:()=>void)=>{assertActive();return own(fileReferenceRecognition.subscribe(guarded(listener)));},revision:()=>{assertActive();return fileReferenceRecognition.revision();},register:(rule:import('../../../packages/navigation/file-links').FileReferenceRule)=>{assertActive();if(!rule.id.startsWith('plugin:'+entry.id+'/'))throw Error('FILE_REFERENCE_RULE_OWNER');return own(fileReferenceRecognition.register({...rule,recognize:text=>{try{assertActive();return rule.recognize(text);}catch(error){failed(error);return undefined;}}}));}}),
      version: 1 as const, id: entry.id, root: value.root, signal: value.abort.signal,
      media:Object.freeze({openImages:async(ids:string[],initialId?:string)=>{assertActive();const opened=await imageViewerController.open(ids,initialId);if(value.abort.signal.aborted||value.failed){if(imageViewerController.get()===opened)imageViewerController.close();return;}own(()=>{if(imageViewerController.get()===opened)imageViewerController.close();});},closeImages:()=>{assertActive();imageViewerController.close();},addToDraft:(ids:string[])=>{assertActive();return attachmentDraft.add(ids);},registerAttachmentAction:(definition:AttachmentActionDefinition)=>{assertActive();const handle=attachmentActions.register(entry.id,definition);return {id:handle.id,dispose:own(handle.dispose)};},setComposerSizing:(policy:Parameters<typeof setComposerSizing>[0])=>{assertActive();return own(setComposerSizing(policy));},decideTextPaste:(text:string)=>{assertActive();return textPastePolicies.decide(text);},registerTextPastePolicy:(definition:TextPastePolicy)=>{assertActive();const handle=textPastePolicies.register(entry.id,definition);return {id:handle.id,dispose:own(handle.dispose)};}}),
      previews: Object.freeze({get:()=>{assertActive();return previewController.get();},subscribe:(listener:Parameters<PreviewPluginApi['subscribe']>[0])=>{assertActive();return own(previewController.subscribe(listener));},confirm:(id:string)=>{assertActive();previewController.confirm(id);},edit:(id:string)=>{assertActive();previewController.edit(id);}}),
      workbench: Object.freeze(Object.fromEntries(Object.entries(bridge).map(([name, method]) => [name, (...args: unknown[]) => { assertActive(); if(name.startsWith('on')&&typeof args[0]==='function')args[0]=guarded(args[0] as (...values:unknown[])=>unknown);const result = Reflect.apply(method, bridge, args); return name.startsWith('on') && typeof result === 'function' ? own(result as Cleanup) : result; }])) as unknown as WorkbenchApi),
      surfaces: workbenchSurfaces,
      mountSurface: (surface: string, placement?: SurfacePlacement) => { assertActive(); const mount = surfaces.mount(entry.id,surface,placement); return {root:mount.root,dispose:own(mount.dispose)}; },
      observeSurfaces: (surface: string, placement: SurfacePlacement, render: SurfaceRenderer) => { assertActive(); return own(surfaces.observe(entry.id,surface,placement,render,failed)); },
      settings: Object.freeze({
        register: (definition: PluginSettingsDefinition) => { assertActive(); const page = pluginSettings.register(entry.id,definition,failed); return {id:page.id,dispose:own(page.dispose),open:()=>openSettings(page.id)}; },
        open: openSettings,
        list: () => { assertActive(); const entries = pluginSettings.getSnapshot(); return [...coreSettingsTabs.filter(id=>!entries.some(page=>page.id===id)).map(id=>({id,label:coreSettingsLabels[id]})),...entries.map(page=>({id:page.id,label:page.definition.label,owner:page.owner}))]; },
      }),
      storage: Object.freeze({
        read: async () => { assertActive(); const result = await bridge.call<PluginDataSnapshot>('extensions/storage/read',{id:entry.id,hash:entry.hash}); assertActive(); return result; },
        write: async (revision: string | null, values: Record<string, PluginJson>) => { assertActive(); const result = await bridge.call<PluginDataSnapshot>('extensions/storage/write',{id:entry.id,hash:entry.hash,revision,values}); assertActive(); return result; },
      }),
      onEvent: (listener: (event: PluginHostEvent) => void) => { assertActive(); return own(bridge.onPluginEvent?.(guarded(listener)) ?? (()=>{})); },
      call: <T = unknown>(method: string, payload?: unknown) => { assertActive(); return bridge.call<T>(method, payload); },
      command: <T = unknown>(name: string, payload?: unknown) => { assertActive(); return bridge.call<T>('extensions/command', {id: entry.id, name, payload}); },
      onState: (listener: (state: AppState) => void) => { assertActive(); return own(bridge.onState(guarded(listener))); },
      onNavigate: (listener: (id: string) => void) => { assertActive(); return own(bridge.onNavigate(guarded(listener))); },
      onCommand: (listener: (command: DesktopCommand) => void) => { assertActive(); return own(bridge.onCommand(guarded(listener))); },
      assetUrl: async (path:string) => { assertActive(); const url=await bridge.call<string>('extensions/asset',{id:entry.id,hash:entry.hash,path});assertActive();return url; },
      listen: (target:EventTarget,type:string,listener:EventListener,options?:AddEventListenerOptions) => { assertActive();const wrapped=guarded(listener);target.addEventListener(type,wrapped,options);return own(()=>target.removeEventListener(type,wrapped,options)); },
      addStyle: (css: string) => { assertActive(); const style = document.createElement('style'); style.dataset.plugin = entry.id; style.textContent = css; document.head.append(style); return own(() => style.remove()); },
      replaceShell: () => { assertActive(); value.shell = true; updateShell(); return own(() => { value.shell = false; updateShell(); }); },
      onDispose: (cleanup: Cleanup) => { if (value.abort.signal.aborted) clean(cleanup); else own(cleanup); },
    });
    const url = URL.createObjectURL(new Blob([entry.source], {type: 'text/javascript'}));
    let timeout:number|undefined;
    try {
      await bridge.call('plugin-recovery/renderer-start',{id:entry.id,hash:entry.hash});assertActive();
      timeout=window.setTimeout(()=>failed(Error('PLUGIN_RENDERER_ACTIVATION_TIMEOUT')),10000);
      const module = await import(/* @vite-ignore */ url) as {activate?: (api: RendererPluginApi) => unknown};
      assertActive();
      if (typeof module.activate !== 'function') throw Error('Plugin renderer must export activate(api).');
      const cleanup = await module.activate(api);
      if (typeof cleanup === 'function') { if (value.abort.signal.aborted) clean(cleanup as Cleanup); else own(cleanup as Cleanup); }
      assertActive(); value.ready = true; updateShell();
      await bridge.call('plugin-recovery/renderer-ready',{id:entry.id,hash:entry.hash});
    } catch (error) {
      // Keep the failed hash in the map: do not automatically rerun plugin code.
      failed(error);
    } finally { if(timeout!==undefined)window.clearTimeout(timeout);URL.revokeObjectURL(url); }
  };
  const refresh = async () => {
    const ticket = ++requested;
    try {
      const entries = await bridge.call<PluginRendererEntry[]>('extensions/renderers');
      if (stopped || ticket !== requested) return;
      for (const [id, value] of active) if (!entries.some(entry => entry.id === id && entry.hash === value.hash)) { active.delete(id); release(value); }
      for (const entry of entries) if (!active.has(entry.id)) {
        const root = document.createElement('div'); root.dataset.pluginSurface = entry.id; root.hidden = true; document.body.append(root);
        const value: ActiveRenderer = {hash:entry.hash,root,abort:new AbortController(),cleanup:[],shell:false,ready:false,failed:false};
        active.set(entry.id, value); void activate(entry, value);
      }
      updateShell();
    } catch { /* A temporary host failure must not rerun or replace a live UI. */ }
  };
  const update = () => { void refresh(); };
  const unsubscribe = bridge.onExtensions?.(update);
  window.addEventListener('focus', update);
  const timer = window.setInterval(update, 5000);
  update();
  return () => { stopped = true; requested++; window.clearInterval(timer); unsubscribe?.(); window.removeEventListener('focus', update); for (const value of active.values()) release(value); active.clear(); surfaces.dispose(); shell.hidden = previousHidden; };
}
