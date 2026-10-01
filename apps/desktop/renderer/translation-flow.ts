import {annotationPrompt,annotationsNeedInputTranslation} from '../../../packages/context-annotations';
import { skillPrompt } from '../../../packages/composer-core';
import type { AppState, DraftPreview } from '../../../packages/contracts';
import { translationEnabled } from '../../../packages/translation/settings';

export interface TranslationFlowPolicy { enabled: boolean; key: string }

/** Public settings only. Any changed preparation policy invalidates the local preview. */
export function translationFlowPolicy(state: Pick<AppState, 'translation' | 'translateInput' | 'plugins' | 'translationQuickToggle'> | null): TranslationFlowPolicy {
  const enabled = translationEnabled(state ?? {});
  return { enabled, key: JSON.stringify([enabled, state?.translationQuickToggle?.show !== false, state?.translationQuickToggle?.paused === true, state?.translateInput, state?.translation]) };
}

export function preparedDraftAction(options: {
  requested: TranslationFlowPolicy; current: TranslationFlowPolicy; preview: DraftPreview;
  source: string; bypass: boolean; autoSubmit: boolean;
}): 'discard' | 'review' | 'submit-original' | 'submit-translated' {
  const { requested, current, preview, source, bypass, autoSubmit } = options;
  if (requested.key !== current.key || requested.enabled !== current.enabled || preview.original !== source) return 'discard';
  if (!requested.enabled) {
    return preview.moduleDisabled === true && preview.bypass && preview.translated === skillPrompt(annotationPrompt(source,preview.annotations),preview.skills) ? 'submit-original' : 'discard';
  }
  if (preview.moduleDisabled || preview.bypass && !bypass) return 'discard';
  if (annotationsNeedInputTranslation(preview.annotations)) return 'review';
  return autoSubmit && !bypass ? 'submit-translated' : 'review';
}
