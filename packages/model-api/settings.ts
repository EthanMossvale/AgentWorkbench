import { normalizeBaseUrl } from '../translation/config';

/** Complete versionless API bases without changing an explicitly supplied version. */
export function normalizeModelApiUrl(base: string): string {
  const url = new URL(normalizeBaseUrl(base));
  if (!/(?:^|\/)v\d+(?:[a-z][a-z\d]*|(?:\.\d+)+)?(?:\/|$)/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/+$/, '') + '/v1';
  }
  return url.href.replace(/\/$/, '');
}

/** A row without an upstream ID is an unfinished editor draft, not a configured model. */
export function isEmptyModelDraft(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const model = (value as { model?: unknown }).model;
  return typeof model === 'string' && !model.trim();
}
