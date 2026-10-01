export interface QuotaLedgerWindow {
  window: 'weekly' | 'fiveHour'; resetsAt: number; observedAt: number; usedPercent: number;
  sampleTokens: number; samplePercent: number; estimatedTotalTokens: number | null; samples: number;
  unassignedPercent: number; overrunPercent: number; balances: Record<string, number>;
  reserveUsed?:Record<string,number>; overdrafts?:Record<string,number>;
  repayments?: {borrower: string; lender: string; percent: number}[];
  debts: {borrower: string; lender: string; percent: number}[];
}
export interface QuotaLedgerView {accountId: string; mode: 'estimated'; coverage: 'workbench-observed'; currentWorkspaceId?:string; allocations?:Record<string,{weeklyPercent:number|null;fiveHourPercent:number|null}>; tokenTotals?:Record<string,number>; workspaceNames?: Record<string,string>; windows: QuotaLedgerWindow[]}
const row = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const amount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e15;
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
export function parseQuotaLedger(value: unknown, accountId: string): QuotaLedgerView {
  const invalid = () => {throw Error('无效的配给账本回执。');};
  if (!row(value) || value.accountId !== accountId || value.mode !== 'estimated' || value.coverage !== 'workbench-observed' || !Array.isArray(value.windows) || value.windows.length > 2) return invalid();
  const windows = value.windows.map((w: unknown): QuotaLedgerWindow => {
    if (!row(w) || !['weekly', 'fiveHour'].includes(w.window) || !['resetsAt','observedAt','usedPercent','sampleTokens','samplePercent','samples','unassignedPercent','overrunPercent'].every(k => amount(w[k])) || w.usedPercent > 100 || !(w.estimatedTotalTokens === null || amount(w.estimatedTotalTokens)) || !row(w.balances) || Object.keys(w.balances).length > 256 || !Array.isArray(w.debts) || w.debts.length > 65536) return invalid();
    const balances: Record<string, number> = {};
    for (const [id, value] of Object.entries(w.balances)) {if (!identifier(id) || !(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e15)) return invalid(); balances[id] = value;}
    const debts = w.debts.map((d: unknown) => {if (!row(d) || !identifier(d.borrower) || !identifier(d.lender) || !amount(d.percent)) return invalid(); return {borrower: d.borrower, lender: d.lender, percent: d.percent};});
    const repayments = Array.isArray(w.entries) ? w.entries.filter((e: any) => row(e) && e.kind === 'repay' && identifier(e.borrower) && identifier(e.lender) && amount(e.percent)).slice(-12).map((e: any) => ({borrower: e.borrower, lender: e.lender, percent: e.percent})) : [];
    const numericMap=(v:unknown)=>{const out:Record<string,number>={};if(row(v))for(const [k,n] of Object.entries(v))if(identifier(k)&&amount(n))out[k]=n;return out;};
    return {reserveUsed:numericMap(w.reserveUsed),overdrafts:numericMap(w.overdrafts),repayments, window: w.window, resetsAt: w.resetsAt, observedAt: w.observedAt, usedPercent: w.usedPercent, sampleTokens: w.sampleTokens, samplePercent: w.samplePercent, estimatedTotalTokens: w.estimatedTotalTokens, samples: w.samples, unassignedPercent: w.unassignedPercent, overrunPercent: w.overrunPercent, balances, debts};
  });
  const workspaceNames: Record<string,string> = {};
  if (row(value.workspaceNames)) for (const [id,name] of Object.entries(value.workspaceNames)) if (identifier(id) && typeof name === 'string' && name.length <= 256 && !/[\x00-\x1f]/.test(name)) workspaceNames[id] = name;
  const allocations:NonNullable<QuotaLedgerView['allocations']>={},tokenTotals:Record<string,number>={};
  if(row(value.allocations))for(const [id,a] of Object.entries(value.allocations))if(identifier(id)&&row(a)&&['weeklyPercent','fiveHourPercent'].every(k=>a[k]===null||amount(a[k])&&a[k]<=100))allocations[id]={weeklyPercent:a.weeklyPercent,fiveHourPercent:a.fiveHourPercent};
  if(row(value.tokenTotals))for(const [id,n] of Object.entries(value.tokenTotals))if(identifier(id)&&amount(n))tokenTotals[id]=n;
  return {allocations,tokenTotals,...(identifier(value.currentWorkspaceId)?{currentWorkspaceId:value.currentWorkspaceId}:{}),accountId, mode: 'estimated', coverage: 'workbench-observed', windows, workspaceNames};
}
