export interface PreviewView {
  id: string;
  kind: 'draft' | 'answer';
  title: string;
  content: readonly string[];
  canConfirm: boolean;
  canEdit: boolean;
}
interface PreviewEntry { view: PreviewView; confirm(): void; edit(): void }

/** Renderer-only preview actions. The host still validates the original receipt. */
export function createPreviewController() {
  const entries = new Map<symbol, PreviewEntry>();
  const listeners = new Set<(view: PreviewView | null) => void>();
  const current = () => [...entries.values()].at(-1);
  const get = () => current() ? structuredClone(current()!.view) : null;
  const emit = () => { for (const listener of listeners) { try { listener(get()); } catch { /* Isolate extension listeners. */ } } };
  const act = (id: string, action: 'confirm' | 'edit') => {
    const entry = current();
    if (!entry || entry.view.id !== id) throw Error('PREVIEW_STALE');
    if (action === 'confirm' ? !entry.view.canConfirm : !entry.view.canEdit) throw Error('PREVIEW_BUSY');
    entry.view = {...entry.view, canConfirm: false, canEdit: false}; emit();
    entry[action]();
  };
  return {
    get,
    subscribe(listener: (view: PreviewView | null) => void) { listeners.add(listener); listener(get()); return () => { listeners.delete(listener); }; },
    confirm: (id: string) => act(id, 'confirm'),
    edit: (id: string) => act(id, 'edit'),
    register(entry: PreviewEntry) { const key = Symbol(); entries.set(key, entry); emit(); return () => { entries.delete(key); emit(); }; },
  };
}
export const previewController = createPreviewController();
export type PreviewPluginApi = Pick<ReturnType<typeof createPreviewController>, 'get' | 'subscribe' | 'confirm' | 'edit'>;

export function previewEnter(event: {key: string; repeat?: boolean; isComposing?: boolean; keyCode?: number; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean}) {
  if (event.key !== 'Enter') return undefined;
  return event.repeat || event.isComposing || event.keyCode === 229 || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey ? 'ignore' : 'confirm';
}
