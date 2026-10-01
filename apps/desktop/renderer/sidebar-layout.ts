export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_RAIL_WIDTH = 64;
export const SIDEBAR_MAX_WIDTH = 600;
export const SIDEBAR_LAYOUT_KEY = 'workbench.sidebar-layout.v1';
export type SidebarLayout = { compact: boolean; width: number };

export function sidebarMaxWidth(viewportWidth: number) {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.floor(viewportWidth / 2), viewportWidth - 520));
}

export function sidebarWidth(width: number, viewportWidth: number) {
  return Math.round(Math.max(SIDEBAR_MIN_WIDTH, Math.min(Number.isFinite(width) ? width : SIDEBAR_MIN_WIDTH, sidebarMaxWidth(viewportWidth))));
}

export function parseSidebarLayout(saved: string | null): SidebarLayout {
  try {
    const value: unknown = JSON.parse(saved ?? 'null');
    if (value && typeof value === 'object') {
      const { compact, width } = value as Record<string, unknown>;
      return { compact: compact === true, width: sidebarWidth(typeof width === 'number' ? width : SIDEBAR_MIN_WIDTH, 1920) };
    }
  } catch { /* A damaged preference must not block the workspace. */ }
  return { compact: false, width: SIDEBAR_MIN_WIDTH };
}

// Find the first readable letter/number, skipping punctuation and leading emoji.
// Segment graphemes so accented letters and non-BMP characters remain intact.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function sidebarInitial(title: string): string {
  for (const { segment } of graphemes.segment(title.trim())) {
    if (!/[\p{L}\p{N}]/u.test(segment)) continue;
    const upper = segment.toLocaleUpperCase();
    return [...graphemes.segment(upper)][0]?.segment ?? segment;
  }
  return '·';
}
