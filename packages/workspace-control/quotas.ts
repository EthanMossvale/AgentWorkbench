import type {AccountQuotaAllocations, AccountQuotaAllocation, ManagedWorkspace} from './types';

export const emptyAllocation = (): AccountQuotaAllocation => ({weeklyPercent: null, fiveHourPercent: null, allowOverage: true});
export const quotaWindows = ['weeklyPercent', 'fiveHourPercent'] as const;
export type QuotaWindowKey = typeof quotaWindows[number];
export const quotaPercent = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8);
export function validateAccountQuotas(value: unknown, allowed: string[]): AccountQuotaAllocations {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('无效的账号配给。');
  const result: AccountQuotaAllocations = {};
  for (const [id, item] of Object.entries(value)) {
    if (!allowed.includes(id) || !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['weeklyPercent','fiveHourPercent','allowOverage'].includes(key)) || (item.allowOverage !== undefined && typeof item.allowOverage !== 'boolean') || !quotaWindows.every(key => Object.hasOwn(item, key) && quotaPercent(item[key]))) throw Error('无效的账号配给。');
    result[id] = {weeklyPercent: item.weeklyPercent, fiveHourPercent: item.fiveHourPercent, allowOverage: item.allowOverage ?? true};
  }
  return result;
}
export function allocatedPercent(workspaces: ManagedWorkspace[], accountId: string, window: QuotaWindowKey, excluding?: string): number {
  return workspaces.filter(w => w.id !== excluding && w.status !== 'deleted').reduce((sum, w) => sum + Math.round((w.accountQuotas?.[accountId]?.[window] ?? 0) * 100), 0) / 100;
}
export function allocationError(workspaces: ManagedWorkspace[], accountId: string, allocation: AccountQuotaAllocation, excluding?: string): string | undefined {
  for (const window of quotaWindows) {
    const value = allocation[window], label = window === 'weeklyPercent' ? '周额度' : '5 小时额度';
    if (!quotaPercent(value)) return `${label}须为 0–100%，最多两位小数。`;
    const reserved = allocatedPercent(workspaces, accountId, window, excluding);
    if (Math.round(((value ?? 0) + reserved) * 100) > 10000) return `${label}超出分配上限：其他空间已占 ${reserved}%，本空间最多可分配 ${Math.round((100 - reserved) * 100) / 100}%。`;
  }
}
