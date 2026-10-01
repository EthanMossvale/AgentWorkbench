import type { ApiModel } from './types';

export const reasoningEfforts = ['light', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export const reasoningCandidates = (model: ApiModel): string[] => reasoningEfforts.filter(effort => !model.effortCandidates?.length || model.effortCandidates.includes(effort));
export const availableReasoningEfforts=(model:ApiModel):string[]=>model.manualEfforts?.length?model.manualEfforts:model.reasoningProbe?.status==='verified'?model.reasoningProbe.accepted:model.reasoningProbe?.status==='declared'?model.reasoningProbe.declared??[]:model.reasoningProbe?.status==='unsupported'?[]:model.efforts??[];
// Retain the exported name for existing callers; explicit manual choices are also usable.
export const defaultVerifiedEffort=(model:ApiModel)=>{const levels=availableReasoningEfforts(model);return levels.includes(model.defaultEffort??'')?model.defaultEffort:levels.includes('medium')?'medium':levels[0];};
export function applyReasoning(model:ApiModel, result:Pick<ApiModel,'efforts'|'defaultEffort'|'reasoningProbe'>):ApiModel {
  const merged={...model,...result};
  // An inconclusive request cannot erase usable directory metadata.
  if(result.reasoningProbe?.status==='inconclusive'&&!result.efforts?.length){merged.efforts=model.efforts;merged.defaultEffort=model.defaultEffort;}
  if(model.manualEfforts?.length){merged.efforts=[...model.manualEfforts];merged.defaultEffort=defaultVerifiedEffort({...merged,defaultEffort:model.defaultEffort});}
  return merged;
}
export interface ReasoningProbe {
  status: 'verified' | 'declared' | 'unsupported' | 'inconclusive';
  checkedAt: string; fingerprint: string; accepted: string[]; rejected: string[];
  declared?: string[]; httpStatus?: number;
  reason?: 'ignored' | 'unavailable' | 'budget' | 'format' | 'unsupported' | 'timeout' | 'auth' | 'rate-limit' | 'server' | 'network' | 'http';
}
/** Directory refreshes must not discard results for the same saved endpoint/model. */
export function mergeReasoning(model: ApiModel, known: ApiModel): Pick<ApiModel, 'efforts' | 'defaultEffort' | 'effortCandidates' | 'reasoningProbe' | 'manualEfforts'> {
  const same = !!model.adaptiveThinking === !!known.adaptiveThinking;
  const preserve = same && model.reasoningProbe && model.reasoningProbe.status !== 'inconclusive';
  return { efforts: model.manualEfforts?.length ? [...model.manualEfforts] : preserve ? availableReasoningEfforts(model) : known.efforts, defaultEffort: model.manualEfforts?.length ? defaultVerifiedEffort(model) : preserve ? model.defaultEffort : known.defaultEffort,
    manualEfforts:model.manualEfforts, effortCandidates: model.effortCandidates, reasoningProbe: same ? model.reasoningProbe : undefined };
}
export function reasoningStatus(model: ApiModel) {
  if(model.manualEfforts?.length)return model.manualEfforts.some(e=>model.reasoningProbe?.rejected.includes(e))?'手动选择，上游已拒绝部分档位':model.manualEfforts.every(e=>model.reasoningProbe?.accepted.includes(e))?'手动选择，已验证上游接受':model.manualEfforts.every(e=>model.reasoningProbe?.declared?.includes(e))?'手动选择，上游已声明':'手动选择，尚未验证';
  if (model.reasoningProbe?.status === 'verified') return model.reasoningProbe.reason ? '部分档位请求已接受；其余未确认' : '档位请求已接受';
  if (model.reasoningProbe?.status === 'declared') return '上游已声明可用档位';
  if (model.efforts?.length) return model.reasoningProbe?.status === 'inconclusive' ? '已识别档位；验证未完成' : '上游目录声明';
  if (model.reasoningProbe?.status === 'unsupported') return '此模型不支持所测档位';
  if (model.reasoningProbe?.reason === 'ignored') return '上次仅测试了无效值；有效档位未确认';
  const reasons:Partial<Record<NonNullable<ReasoningProbe['reason']>,string>>={timeout:'检测请求超时',auth:'鉴权或访问权限失败', 'rate-limit':'上游限流或额度不足',server:'上游服务异常',network:'检测连接失败',http:'检测请求被拒绝',budget:'本批检测已达上限',format:'未识别档位校验响应',unavailable:'检测未完成'};
  return model.reasoningProbe ? `${reasons[model.reasoningProbe.reason!]??'检测未完成'}${model.reasoningProbe.httpStatus?`（HTTP ${model.reasoningProbe.httpStatus}）`:''}，可手动选择` : '未声明档位，可手动选择';
}
