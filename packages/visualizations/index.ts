import type { TokenizerExtension } from 'marked';
import { assertUiValue, type UiValue } from '../ui-preferences';

export interface VisualizationReference { path: string; title?: string; mode?: 'wide'; renderer?: string }
export interface VisualizationDocument { path: string; html: string; digest: string }
export interface VisualizationState { modelContent: UiValue; privateContent: UiValue }
export interface VisualizationToken { type: 'visualization'; raw: string; reference: VisualizationReference }
export interface VisualizationRenderer {
  id: string; label: string; replaces?: 'core.html';
  render(context: { document: VisualizationDocument; reference: VisualizationReference; signal: AbortSignal }): string | Promise<string>;
}
export interface VisualizationRendererHandle { id: string; dispose(): void }
export interface VisualizationRenderResult { html: string; renderer: string; fallback: boolean }
export interface VisualizationsApi {
  instructions(runtime?: string): Promise<string>;
  parse(raw: string): VisualizationReference | undefined;
  read(reference: VisualizationReference, sessionId?: string): Promise<VisualizationDocument>;
  render(document: VisualizationDocument, reference: VisualizationReference, renderer: string, signal: AbortSignal): Promise<VisualizationRenderResult>;
  listRenderers(): { id: string; label: string }[];
  registerRenderer(renderer: VisualizationRenderer): VisualizationRendererHandle;
  subscribe(listener: () => void): () => void;
}
const start = '\uE200visualize\uE202', end = '\uE201';
export function parseVisualization(raw: string): VisualizationReference | undefined {
  if (raw.length > 8192 || !raw.startsWith(start) || !raw.endsWith(end)) return;
  try {
    const value = JSON.parse(raw.slice(start.length, -end.length));
    if (!value || Array.isArray(value) || Object.keys(value).some(key => !['path','title','mode','renderer'].includes(key))) return;
    if (typeof value.path !== 'string' || !value.path || value.path.length > 4096 || /[\x00-\x1f]/.test(value.path) || !/\.html?$/i.test(value.path)) return;
    if (/^(?:[a-z][a-z0-9+.-]*:\/\/|\\\\|\/\/)/i.test(value.path)) return;
    if (value.title !== undefined && (typeof value.title !== 'string' || value.title.length > 160)) return;
    if (value.mode !== undefined && value.mode !== 'wide') return;
    if (value.renderer !== undefined && (typeof value.renderer !== 'string' || !/^(?:core\.html|plugin:[a-z][a-z0-9.-]{1,79}\/[a-z][a-z0-9.-]{0,79})$/.test(value.renderer))) return;
    return value;
  } catch { return; }
}
/** Only standalone complete references execute. Code fences/inline examples stay literal. */
export const visualizationExtension: TokenizerExtension = {
  name: 'visualization', level: 'block',
  start: source => { const match = /^ {0,3}\uE200visualize\uE202/m.exec(source); return match?.index; },
  tokenizer(source) {
    const match = /^(?: {0,3})(\uE200visualize\uE202[^\r\n]*?\uE201)[ \t]*(?:\n|$)/.exec(source);
    if (!match) return;
    const reference = parseVisualization(match[1]!);
    if (reference) return { type: 'visualization', raw: match[0], reference };
  },
};
export function visualizationState(value: unknown): VisualizationState {
  assertUiValue(value);
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key=>!['modelContent','privateContent'].includes(key))) throw Error('VISUALIZATION_STATE_INVALID');
  const next = { modelContent: value.modelContent ?? null, privateContent: value.privateContent ?? null };
  if (new TextEncoder().encode(JSON.stringify(next)).length > 16384) throw Error('VISUALIZATION_STATE_LIMIT');
  return structuredClone(next);
}
export function assertVisualizationHtml(html: unknown): asserts html is string {
  if (typeof html !== 'string' || new TextEncoder().encode(html).length > 1024 * 1024 || html.includes('\0')) throw Error('VISUALIZATION_HTML_INVALID');
}

/** Production directory used by both plugin calls and every mounted message. */
export class VisualizationRegistry {
  private entries = new Map<string, VisualizationRenderer>();
  private listeners = new Set<() => void>();
  private version = 0;
  getVersion = () => this.version;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private changed() { this.version++; for (const listener of this.listeners) try { listener(); } catch { /* Observer does not own registration. */ } }
  listRenderers = () => [{ id: 'core.html', label: 'HTML' }, ...[...this.entries].map(([id,entry])=>({id,label:entry.label}))];
  register(owner: string, definition: VisualizationRenderer): VisualizationRendererHandle {
    const id = `plugin:${owner}/${definition?.id}`;
    if (!/^plugin:[a-z][a-z0-9.-]{1,79}\/[a-z][a-z0-9.-]{0,79}$/.test(id) || typeof definition?.label !== 'string' || !definition.label || definition.label.length > 80 || typeof definition.render !== 'function' || definition.replaces !== undefined && definition.replaces !== 'core.html') throw Error('VISUALIZATION_RENDERER_INVALID');
    if (this.entries.has(id)) throw Error('VISUALIZATION_RENDERER_DUPLICATE');
    const entry = {...definition,id}; this.entries.set(id,entry); this.changed();
    return { id, dispose: () => { if (this.entries.get(id) === entry) { this.entries.delete(id); this.changed(); } } };
  }
  render = async (document: VisualizationDocument, reference: VisualizationReference, renderer: string, signal: AbortSignal): Promise<VisualizationRenderResult> => {
    assertVisualizationHtml(document.html); signal.throwIfAborted();
    const entry = renderer === 'core.html' ? [...this.entries.values()].filter(entry=>entry.replaces==='core.html').at(-1) : this.entries.get(renderer);
    if (!entry) return { html: document.html, renderer: 'core.html', fallback: renderer !== 'core.html' };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    try {
      const cancelled = new Promise<never>((_, reject) => { abort = () => reject(Error('VISUALIZATION_ABORTED')); signal.addEventListener('abort',abort,{once:true}); timeout=setTimeout(()=>reject(Error('VISUALIZATION_RENDERER_TIMEOUT')),10000); });
      const html = await Promise.race([Promise.resolve().then(()=>entry.render({document:structuredClone(document),reference:{...reference},signal})), cancelled]);
      signal.throwIfAborted(); if (this.entries.get(entry.id) !== entry) throw Error('VISUALIZATION_RENDERER_RELEASED');
      assertVisualizationHtml(html); return { html, renderer: entry.id, fallback: false };
    } catch (error) {
      signal.throwIfAborted(); return { html: document.html, renderer: 'core.html', fallback: true };
    } finally { clearTimeout(timeout); signal.removeEventListener('abort',abort); }
  };
}
export const visualizations = new VisualizationRegistry();
