import type { TranslationTarget } from '../../../packages/translation/types';

/** Catalog descriptions may already end with the model's display name. */
export function translationTargetLabel(target: Pick<TranslationTarget, 'description' | 'name'>): string {
  const description = target.description.trim(), name = target.name.trim();
  if (!description) return name;
  if (!name || description === name || description.endsWith(` · ${name}`)) return description;
  return `${description} · ${name}`;
}
