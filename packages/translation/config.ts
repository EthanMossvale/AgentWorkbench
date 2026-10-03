import type { Protocol, TranslationProfile, TranslationReasoning } from '../contracts/index';
import { assertTranslationApiHost } from './credentials';

const protocols: readonly Protocol[] = ['chat-completions', 'responses', 'anthropic-messages'];
const openAiEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const anthropicEfforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/** Normalize an API base or a pasted endpoint without inventing a gateway prefix. */
export function normalizeBaseUrl(base: string, options: { defaultVersion?: boolean } = {}): string {
  let url: URL;
  try { url = new URL(base.trim()); } catch { throw new Error('翻译端点不是有效的 URL。'); }
  assertTranslationApiHost(url.hostname);
  if (url.username || url.password) throw new Error('请使用独立凭据字段，不要将凭据写入端点地址。');
  if (!['http:','https:'].includes(url.protocol) || !url.hostname) throw new Error('端点须为有效 HTTP 或 HTTPS 地址。');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses|messages|models)$/, '');
  if (options.defaultVersion !== false && (!url.pathname || url.pathname === '/') && ['api.openai.com', 'api.anthropic.com'].includes(url.hostname)) url.pathname = '/v1';
  return url.origin+(url.pathname==='/'?'':url.pathname)+url.search+url.hash;
}

/** Protocol choices, not a claim that the selected model implements every value. */
export function reasoningOptions(protocol: Protocol): readonly string[] {
  return protocol === 'anthropic-messages' ? anthropicEfforts : openAiEfforts;
}

export function isModelId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\s\u0000-\u001f\u007f]/.test(value);
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}须为 ${min}–${max} 之间的整数。`);
  return value;
}

export function maxOutputTokens(profile: TranslationProfile): number {
  return integer(profile.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS, 1, Number.MAX_SAFE_INTEGER, '输出 token 上限');
}

export function validateReasoning(profile: TranslationProfile): TranslationReasoning | undefined {
  const value = profile.reasoning;
  if (value !== undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('思考参数格式不正确。');
    if (profile.effort) throw new Error('不能同时设置旧版思考档位与新的思考参数。');
    if (value.mode === 'default') return undefined;
    if (value.confirmed !== true || !isModelId(profile.model)) throw new Error('请先为所选模型确认思考参数的支持情况。');
    if (value.mode === 'effort') {
      if (profile.protocol === 'anthropic-messages' || typeof value.effort !== 'string' || !reasoningOptions(profile.protocol).includes(value.effort) || value.budgetTokens !== undefined) throw new Error('当前协议不支持这组思考档位参数。');
      return { mode: 'effort', effort: value.effort, confirmed: true };
    }
    if (value.mode === 'adaptive') {
      if (profile.protocol !== 'anthropic-messages' || value.budgetTokens !== undefined || (value.effort !== undefined && (typeof value.effort !== 'string' || !anthropicEfforts.includes(value.effort as typeof anthropicEfforts[number])))) throw new Error('自适应思考仅接受 Anthropic 协议支持的参数。');
      return { mode: 'adaptive', ...(value.effort ? { effort: value.effort } : {}), confirmed: true };
    }
    if (value.mode === 'budget') {
      if (profile.protocol !== 'anthropic-messages' || value.effort !== undefined) throw new Error('固定思考预算仅支持 Anthropic 协议，不能混入 effort。');
      const budgetTokens = integer(value.budgetTokens, 1024, Number.MAX_SAFE_INTEGER, '思考 token 预算');
      if (budgetTokens >= maxOutputTokens(profile)) throw new Error('思考 token 预算必须小于输出 token 上限，为译文保留空间。');
      return { mode: 'budget', budgetTokens, confirmed: true };
    }
    throw new Error('不支持的思考参数模式。');
  }
  // Legacy saved settings can only retain previously verified mappings.
  if (profile.effort) {
    if (profile.protocol === 'anthropic-messages' || !openAiEfforts.includes(profile.effort as typeof openAiEfforts[number]) || !Array.isArray(profile.verifiedEfforts) || !profile.verifiedEfforts.includes(profile.effort)) throw new Error('当前协议/模型没有已核实的思考档位映射，未发送该请求。');
    return { mode: 'effort', effort: profile.effort, confirmed: true };
  }
  return undefined;
}

/** Shared structural validation; an empty model is allowed while saving setup. */
export function validateTranslationProfile(profile: TranslationProfile): TranslationProfile {
  if (!protocols.includes(profile.protocol)) throw new Error('不支持的翻译协议。');
  const baseUrl = normalizeBaseUrl(profile.baseUrl);
  if (typeof profile.model !== 'string' || (profile.model !== '' && !isModelId(profile.model))) throw new Error('模型 ID 格式不正确。');
  integer(profile.maxCharacters, 0, Number.MAX_SAFE_INTEGER, '待译字符上限（0 为不限）');
  integer(profile.maxCalls, 0, Number.MAX_SAFE_INTEGER, '调用预算（0 为不限）');
  integer(profile.timeoutMs, 0, Number.MAX_SAFE_INTEGER, '等待上限毫秒数（0 为不限）');
  if (profile.source && (profile.source.kind !== 'custom' && profile.source.kind !== 'model' || profile.source.kind === 'model' && (typeof profile.source.targetId !== 'string' || !profile.source.targetId || profile.source.targetId.length > 512 || profile.source.effort !== undefined && typeof profile.source.effort !== 'string'))) throw Error('TRANSLATION_SOURCE_INVALID');
  maxOutputTokens(profile);
  validateReasoning(profile);
  return { ...profile, baseUrl };
}
