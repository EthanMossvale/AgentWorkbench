import type { AppState } from '../contracts/index';

type TranslationSettings = Pick<AppState, 'plugins' | 'translationQuickToggle'>;

/** The plugin switch is authoritative; a temporary pause never changes it. */
export const translationModuleEnabled = (state: TranslationSettings) => state.plugins?.translation?.enabled !== false;
export const translationQuickToggleVisible = (state: TranslationSettings | null) => !!state && translationModuleEnabled(state) && state.translationQuickToggle?.show !== false;
/** Hiding the optional control suspends its remembered pause until shown again. */
export const translationEnabled = (state: TranslationSettings) => translationModuleEnabled(state) && (state.translationQuickToggle?.show === false || state.translationQuickToggle?.paused !== true);
