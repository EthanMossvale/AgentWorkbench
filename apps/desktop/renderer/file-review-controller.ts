import type { TurnFileChanges } from '../../../packages/collaboration-core/file-changes';
import type { PluginContentContext, PluginContentResult } from './plugin-lifecycle';

export interface FileReviewTarget { sessionId: string; turnId: string }
export interface FileReviewSnapshot extends FileReviewTarget { changes: TurnFileChanges; running: boolean }
export interface FileReviewViewContext extends PluginContentContext, FileReviewTarget { file: TurnFileChanges['files'][number] }
export interface FileReviewViewDefinition { id: string; label: string; render(context: FileReviewViewContext): PluginContentResult | Promise<PluginContentResult> }
export interface FileReviewViewOption { id: string; label: string }
export interface FileReviewPluginApi {
  list(sessionId?: string): FileReviewSnapshot[];
  open(target: FileReviewTarget, path?: string): void;
  close(target: FileReviewTarget): void;
  subscribe(listener: () => void): () => void;
  listViews(): readonly FileReviewViewOption[];
  registerView(definition: FileReviewViewDefinition): { id: string; dispose(): void };
}
interface Source { snapshot: FileReviewSnapshot; open(path: string): void; close(): void }
interface View extends FileReviewViewOption { render?: FileReviewViewDefinition['render']; failed?(error: unknown): void }
const builtins: View[] = [{id:'unified',label:'合并视图'},{id:'split',label:'并排视图'}];
/** Presentation of recorded native changes only. Never reads or writes the working tree. */
export function createFileReviewController() {
  const sources = new Map<symbol, Source>(), listeners = new Set<() => void>();
  let views: readonly View[] = builtins;
  const emit = () => { for (const listener of [...listeners]) { try { listener(); } catch { /* Isolate listeners. */ } } };
  const find = (target: FileReviewTarget) => {
    const source = [...sources.values()].findLast(s => s.snapshot.sessionId === target?.sessionId && s.snapshot.turnId === target?.turnId);
    if (!source) throw Error('FILE_REVIEW_UNAVAILABLE');
    return source;
  };
  return {
    list: (sessionId?: string): FileReviewSnapshot[] => structuredClone([...sources.values()].filter(s => !sessionId || s.snapshot.sessionId === sessionId).map(s => s.snapshot)),
    open(target: FileReviewTarget, path?: string) {
      const source = find(target), file = path === undefined ? source.snapshot.changes.files[0] : source.snapshot.changes.files.find(f => f.path === path);
      if (!file) throw Error('FILE_REVIEW_FILE_UNAVAILABLE');
      for (const other of sources.values()) if (other !== source) other.close();
      source.open(file.path);
    },
    close(target: FileReviewTarget) { find(target).close(); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    bind(source: Source) {
      const token = Symbol(); sources.set(token, source); emit();
      return {update(snapshot: FileReviewSnapshot) { if (sources.has(token)) { source.snapshot = snapshot; emit(); } }, dispose() { if (sources.delete(token)) { source.close(); emit(); } }};
    },
    getViews: () => views,
    listViews: (): readonly FileReviewViewOption[] => views.map(({id,label}) => ({id,label})),
    registerView(owner: string, definition: FileReviewViewDefinition, failed: (error: unknown) => void) {
      if (typeof definition?.id !== 'string' || !/^[a-zA-Z][\w.-]{0,79}$/.test(definition.id) || typeof definition.label !== 'string' || !definition.label.trim() || definition.label.length > 80 || typeof definition.render !== 'function') throw Error('FILE_REVIEW_INVALID_VIEW');
      const id = `plugin:${owner}:${definition.id}`;
      if (views.some(view => view.id === id)) throw Error('FILE_REVIEW_DUPLICATE_VIEW');
      const view: View = {id,label:definition.label,render:definition.render,failed};
      views = [...views, view]; emit();
      return {id, dispose() { if (views.includes(view)) { views = views.filter(item => item !== view); emit(); } }};
    },
  };
}
export const fileReviewController = createFileReviewController();
