import { randomUUID } from 'node:crypto';
import { isModelId } from '../translation/config';
import { isEmptyModelDraft, normalizeModelApiUrl } from './settings';
import type { ApiModel, ModelConnection } from './types';
import { mergeReasoning, orderReasoningEfforts } from './reasoning-info';

const obj = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const clean = (value: unknown, max = 255) => typeof value === 'string' && value.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : '';
const positive = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
/** Execution policy, not user-facing connection options. */
export const API_DEFAULTS = { tools: true, timeoutMs: 120000, maxOutputTokens: 8192 } as const;
export const outputTokenLimit = (model: ApiModel) => model.maxOutputTokens ?? API_DEFAULTS.maxOutputTokens;
export function modelMetadata(value: unknown): Partial<ApiModel> {
  const v = obj(value), limits = obj(v.limits), reasoning = obj(v.reasoning), thinking = obj(v.thinking), top = obj(v.top_provider), capabilities=obj(v.capabilities), effort=obj(capabilities.effort);
  const contextWindow = positive(v.context_window ?? v.contextWindow ?? v.context_length ?? v.max_context_tokens ?? v.context_window_tokens ?? v.max_input_tokens ?? limits.context ?? limits.context_window ?? top.context_length);
  const maxOutputTokens = positive(v.max_output_tokens ?? v.max_tokens ?? limits.output ?? limits.max_output_tokens ?? top.max_completion_tokens);
  const raw = v.supported_reasoning_efforts ?? v.supportedReasoningEfforts ?? v.supported_reasoning_levels ?? v.reasoning_efforts ?? reasoning.efforts ?? reasoning.levels ?? thinking.levels ?? effort.supported_efforts ?? effort.levels ?? (effort.supported === true ? Object.entries(effort).filter(([key,value]) => key !== 'supported' && obj(value).supported === true).map(([key]) => key) : undefined);
  const efforts = Array.isArray(raw) ? [...new Set(raw.map(item => typeof item === 'string' ? item : obj(item).reasoningEffort ?? obj(item).reasoning_effort ?? obj(item).effort ?? obj(item).level ?? obj(item).value).filter(isModelId))] : undefined;
  const defaultEffort = clean(v.default_reasoning_effort ?? v.defaultReasoningEffort ?? reasoning.default_effort ?? reasoning.default ?? thinking.default ?? effort.default_effort ?? effort.default);
  return { ...(contextWindow ? { contextWindow, contextWindowSource: 'upstream' as const } : {}), ...(maxOutputTokens ? { maxOutputTokens } : {}), ...(efforts?.length ? { efforts, ...(efforts.includes(defaultEffort) ? { defaultEffort } : {}) } : {}), ...(obj(obj(capabilities.thinking).types).adaptive?.supported === true ? { adaptiveThinking:true } : {}), metadataSource: 'upstream' };
}
export function parseModelDirectory(value: unknown): ApiModel[] {
  const data = obj(value).data;
  if (!Array.isArray(data)) throw Error('模型目录格式不受支持，可手动添加映射。');
  const result = new Map<string, ApiModel>();
  for (const item of data) { const v = obj(item); if (!isModelId(v.id)) continue; result.set(v.id, { id: v.id, model: v.id, name: clean(v.display_name ?? v.name) || v.id, enabled: false, ...modelMetadata(v) }); if (result.size >= 2000) break; }
  return [...result.values()];
}
export function validateApiModel(value: unknown): ApiModel {
  const v = obj(value);
  const model = typeof v.model === 'string' ? v.model.trim() : v.model;
  const name = typeof v.name === 'string' && !v.name.trim() ? model : v.name;
  if (!isModelId(v.id) || !isModelId(model) || !clean(name) || typeof v.enabled !== 'boolean') throw Error('请填写有效的映射名称和上游模型 ID。');
  for (const key of ['contextWindow', 'maxOutputTokens']) if (v[key] !== undefined && !positive(v[key])) throw Error('上下文与输出上限须为正整数。');
  if (v.efforts !== undefined && (!Array.isArray(v.efforts) || v.efforts.some((item: unknown) => !isModelId(item)))) throw Error('思考档位格式不正确。');
  const selectedLevels=Array.isArray(v.manualEfforts)&&v.manualEfforts.length?v.manualEfforts:v.efforts;
  if (v.defaultEffort !== undefined && (!Array.isArray(selectedLevels) || !selectedLevels.includes(v.defaultEffort))) throw Error('默认思考档位不在所选档位中。');
  if(v.effortCandidates!==undefined&&(!Array.isArray(v.effortCandidates)||v.effortCandidates.some((item:unknown)=>!isModelId(item))))throw Error('待测思考档位格式不正确。');
  if(v.manualEfforts!==undefined&&(!Array.isArray(v.manualEfforts)||v.manualEfforts.some((item:unknown)=>!isModelId(item))))throw Error('MODEL_MANUAL_EFFORTS_INVALID');
  const manualEfforts=v.manualEfforts?.length?orderReasoningEfforts(v.manualEfforts):undefined;
  if(manualEfforts&&v.effortCandidates?.length)throw Error('MODEL_REASONING_MODES_CONFLICT');
  const efforts=manualEfforts??(v.efforts?.length?[...new Set<string>(v.efforts)]:undefined);
  const defaultEffort=manualEfforts?(manualEfforts.includes(v.defaultEffort)?v.defaultEffort:manualEfforts.includes('medium')?'medium':manualEfforts[0]):v.defaultEffort;
  return { ...(v.effortCandidates?.length ? {effortCandidates:orderReasoningEfforts(v.effortCandidates)} : {}), ...(manualEfforts?{manualEfforts}:{}), ...(v.adaptiveThinking === true ? {adaptiveThinking:true} : {}), id: v.id, name: clean(name), model, enabled: v.enabled, ...(v.contextWindow ? { contextWindow: v.contextWindow, ...(v.contextWindowSource==='manual'||v.contextWindowSource==='upstream'?{contextWindowSource:v.contextWindowSource}:{}) } : {}), ...(v.maxOutputTokens ? { maxOutputTokens: v.maxOutputTokens } : {}), ...(efforts?.length ? { efforts, ...(defaultEffort ? { defaultEffort } : {}) } : {}), ...(v.metadataSource === 'upstream' || v.metadataSource === 'manual' ? { metadataSource: v.metadataSource } : {}) };
}
export function validateConnection(value: unknown, previous?: ModelConnection): ModelConnection {
  const v = obj(value);
  if (v.enabled !== undefined && typeof v.enabled !== 'boolean') throw Error('连接开关无效。');
  if (!clean(v.name, 100)) throw Error('请为连接起一个名称。');
  if (!['chat-completions', 'responses', 'anthropic-messages'].includes(v.protocol)) throw Error('请选择接口协议。');
  if (!Array.isArray(v.models)) throw Error('模型映射列表无效。');
  const models = v.models.filter((model: unknown) => !isEmptyModelDraft(model)).map(validateApiModel);
  if (models.length > 2000) throw Error('模型映射列表无效。');
  if (new Set(models.map((m: ApiModel) => m.id)).size !== models.length) throw Error('映射标识不能重复。');
  if (v.modelsUrl !== undefined && v.modelsUrl !== null && typeof v.modelsUrl !== 'string') throw Error('模型列表地址无效。');
  const modelsUrl = typeof v.modelsUrl === 'string' && v.modelsUrl.trim() ? normalizeModelApiUrl(v.modelsUrl) : undefined;
  // A provider that is currently missing stays selected; requests then use the saved address and protocol.
  if (v.providerId !== undefined && v.providerId !== null && (typeof v.providerId !== 'string' || !/^(core\.[a-z0-9][a-z0-9-]{0,62}|plugin:[^\s/]{1,120}\/[^\s]{1,120})$/.test(v.providerId))) throw Error('模型提供商无效。');
  const providerId = typeof v.providerId === 'string' ? v.providerId : undefined;
  return { id: previous?.id ?? randomUUID(), revision: randomUUID(), name: clean(v.name, 100), baseUrl: normalizeModelApiUrl(v.baseUrl), ...(modelsUrl ? { modelsUrl } : {}), ...(providerId ? { providerId } : {}), protocol: v.protocol, enabled: v.enabled ?? previous?.enabled ?? true, auth: v.auth === 'key' ? 'key' : previous?.auth ?? 'none', hasKey: false, models, discoveredModels: previous?.discoveredModels ?? [], discoveredAt: previous?.discoveredAt, ...API_DEFAULTS };
}
export function mergeDirectory(connection: ModelConnection, directory: ApiModel[]): ModelConnection {
  const metadata = new Map(directory.map(model => [model.model, model]));
  const models = connection.models.map(model => { const known = metadata.get(model.model); return known && model.metadataSource !== 'manual' ? { ...model, adaptiveThinking: known.adaptiveThinking, contextWindow: model.contextWindowSource==='manual'?model.contextWindow:known.contextWindow, contextWindowSource: model.contextWindowSource==='manual'?'manual':known.contextWindowSource, maxOutputTokens: known.maxOutputTokens, ...mergeReasoning(model,known), metadataSource: 'upstream' as const } : model; });
  return { ...connection, models, discoveredModels: directory, discoveredAt: new Date().toISOString(), discoveryError: undefined };
}
/** Trigger only when a window is actually known; this is a runtime policy, not an API parameter. */
export function compactionBudget(model: ApiModel, outputBudget: number): number | undefined {
  if (!model.contextWindow) return;
  return Math.max(1, model.contextWindow - outputBudget);
}
