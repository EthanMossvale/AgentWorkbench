import { normalizeBaseUrl } from '../translation/config';
import type { ApiModel } from './types';

/** Preserve the user's API prefix; a version is added only when explicitly supplied. */
export function normalizeModelApiUrl(base: string): string {
  return normalizeBaseUrl(base, { defaultVersion: false });
}

/** Source edits invalidate evidence, never deliberate model settings. */
export function retainManualModelSettings(model: ApiModel): ApiModel {
  const manual = model.metadataSource === 'manual';
  const manualContext = manual || model.contextWindowSource === 'manual';
  const efforts = model.manualEfforts?.length ? model.manualEfforts : manual ? model.efforts : undefined;
  return { ...model,
    contextWindow: manualContext ? model.contextWindow : undefined,
    contextWindowSource: manualContext && model.contextWindow ? 'manual' : undefined,
    maxOutputTokens: manual ? model.maxOutputTokens : undefined,
    efforts, defaultEffort: efforts?.includes(model.defaultEffort ?? '') ? model.defaultEffort : undefined,
    adaptiveThinking: manual ? model.adaptiveThinking : undefined,
    metadataSource: manual ? 'manual' : undefined, reasoningProbe: undefined,
  };
}

/** A row without an upstream ID is an unfinished editor draft, not a configured model. */
export function isEmptyModelDraft(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const model = (value as { model?: unknown }).model;
  return typeof model === 'string' && !model.trim();
}
