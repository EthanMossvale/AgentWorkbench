/**
 * Per-session reading position for the original conversation pane. A session
 * left while following the newest output resumes following; otherwise the
 * first visible text block and its offset are restored when the session opens
 * again. Positions live for the application session only: offsets depend on
 * rendered content, fonts and width, so a restart opens at the newest output.
 */
export interface ReadingPosition {
  follow: boolean;
  /** `data-sync-key` of the first visible block, when one was visible. */
  anchor?: string;
  /** Anchor top relative to the scroll container top, in CSS pixels. */
  offset?: number;
  /** Fallback when the anchor is no longer rendered. */
  scrollTop?: number;
}
export type ReadingPositionResolver = (sessionId: string, saved: ReadingPosition | undefined) => ReadingPosition | undefined;

const positions = new Map<string, ReadingPosition>();
const resolvers: { resolve: ReadingPositionResolver }[] = [];

export const readingPositions = Object.freeze({
  get: (sessionId: string): ReadingPosition | undefined => positions.get(sessionId),
  remember(sessionId: string, position: ReadingPosition) { positions.set(sessionId, { ...position }); },
  forget(sessionId: string) { positions.delete(sessionId); },
  /** Effective position used by the workspace; the newest override wins. */
  resolve(sessionId: string): ReadingPosition | undefined {
    let value = positions.get(sessionId);
    for (const entry of resolvers) value = entry.resolve(sessionId, value);
    return value;
  },
  /** Replace the restoration policy without erasing saved positions; returns cleanup. */
  override(resolve: ReadingPositionResolver): () => void {
    const entry = { resolve }; resolvers.push(entry);
    return () => { const index = resolvers.indexOf(entry); if (index >= 0) resolvers.splice(index, 1); };
  },
});

/** Capture the reading position of a scroll container. */
export function captureReadingPosition(element: HTMLElement, follow: boolean): ReadingPosition {
  if (follow) return { follow: true };
  const top = element.getBoundingClientRect().top;
  for (const block of element.querySelectorAll<HTMLElement>('[data-sync-key]')) {
    const rect = block.getBoundingClientRect();
    if (rect.height && rect.bottom > top + 1) return { follow: false, anchor: block.dataset.syncKey, offset: rect.top - top, scrollTop: element.scrollTop };
  }
  return { follow: false, scrollTop: element.scrollTop };
}

/** Scroll so the saved anchor sits at its saved offset; returns whether a layout write happened. */
export function applyReadingPosition(element: HTMLElement, position: ReadingPosition): boolean {
  const block = position.anchor ? element.querySelector<HTMLElement>(`[data-sync-key="${CSS.escape(position.anchor)}"]`) : null;
  if (block && position.offset !== undefined) {
    const delta = block.getBoundingClientRect().top - element.getBoundingClientRect().top - position.offset;
    if (Math.abs(delta) <= 1) return false;
    element.scrollTop += delta; return true;
  }
  if (position.scrollTop === undefined || Math.abs(element.scrollTop - position.scrollTop) <= 1) return false;
  element.scrollTop = position.scrollTop; return true;
}
