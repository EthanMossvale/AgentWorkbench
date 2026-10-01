import type { NativeModelOption, NativeModelSelection, NativeContextUsage } from '../contracts';
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const bounded = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\x00-\x1f]/.test(v);
export function parseModels(value: unknown): NativeModelOption[] {
  const data = record(value).data; if (!Array.isArray(data)) throw Error('原生模型目录格式不正确。');
  return data.filter(v => { const m = record(v); return m.hidden !== true && bounded(m.id) && bounded(m.model); }).map(v => {
    const m = record(v);
    return { id: m.id as string, model: m.model as string, name: bounded(m.displayName) ? m.displayName : m.model as string, isDefault: m.isDefault === true,
      efforts: Array.isArray(m.supportedReasoningEfforts) ? [...new Set(m.supportedReasoningEfforts.map(e => record(e).reasoningEffort).filter(bounded))] : [],
      defaultEffort: bounded(m.defaultReasoningEffort) ? m.defaultReasoningEffort : undefined,
      serviceTiers: Array.isArray(m.serviceTiers) ? m.serviceTiers.filter(t => bounded(record(t).id)).map(t => { const tier = record(t); return { id: tier.id as string, name: bounded(tier.name) ? tier.name : tier.id as string, description: typeof tier.description === 'string' ? tier.description.slice(0,1000) : '' }; }) : [],
      defaultServiceTier: bounded(m.defaultServiceTier) ? m.defaultServiceTier : undefined,
      ...(Number.isSafeInteger(m.contextWindow??m.context_window)&&((m.contextWindow??m.context_window) as number)>0?{contextWindow:(m.contextWindow??m.context_window) as number}:{}) };
  });
}
export function validateModelSelection(value: unknown, models: NativeModelOption[]): NativeModelSelection {
  const selection = record(value), model = models.find(item => item.model === selection.model);
  if (!model) throw Error('请先读取当前账号的原生模型目录并选择模型。');
  if (selection.effort !== undefined && !model.efforts.includes(selection.effort as string)) throw Error('此模型未声明该思考档位。');
  if (selection.serviceTier !== undefined && !model.serviceTiers.some(tier => tier.id === selection.serviceTier)) throw Error('此模型未声明该速度档位。');
  return { model: model.model, ...(selection.effort !== undefined ? { effort: selection.effort as string } : {}), ...(selection.serviceTier !== undefined ? { serviceTier: selection.serviceTier as string } : {}) };
}
/** Apply public config/read values over model/list's catalog defaults. */
export function applyNativeModelDefaults(models: NativeModelOption[], value: unknown): NativeModelOption[] {
  const config = record(record(value).config);
  const selected = models.find(model => model.model === config.model) ?? models.find(model => model.isDefault);
  if (!selected) return models;
  return models.map(model => ({ ...model, isDefault: model.model === selected.model,
    ...(model.model===selected.model&&Number.isSafeInteger(config.model_context_window)&&(config.model_context_window as number)>0?{contextWindow:config.model_context_window as number}:{}),
    ...(model.model === selected.model && bounded(config.model_reasoning_effort) ? { defaultEffort: config.model_reasoning_effort } : {}),
    ...(model.model === selected.model && bounded(config.service_tier) ? { defaultServiceTier: config.service_tier } : {}) }));
}
export function parseEffectiveModel(value: unknown): NativeModelSelection | undefined {
  const result = record(value);
  if (!bounded(result.model)) return;
  return { model: result.model, ...(bounded(result.reasoningEffort) ? { effort: result.reasoningEffort } : {}),
    // A null service tier means the native standard tier, not the catalog's Fast default.
    serviceTier: bounded(result.serviceTier) ? result.serviceTier : 'default' };
}
export function parseContextUsage(value: unknown, updatedAt: string, turnId?: string): NativeContextUsage | undefined {
  const usage = record(value), used = record(usage.last).totalTokens, total = record(usage.total).totalTokens, capacity = usage.modelContextWindow;
  if (!Number.isSafeInteger(used) || (used as number) < 0 || !Number.isSafeInteger(total) || (total as number) < 0) return;
  return { used: used as number, total: total as number, capacity: Number.isSafeInteger(capacity) && (capacity as number) > 0 ? capacity as number : null, updatedAt, turnId };
}
