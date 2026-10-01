import type {AccountUsage} from '../../../packages/account-usage/types';
const percent=(value:number)=>Math.round(value*100)/100+'%';
export default function QuotaLedgerPanel({usage}: {usage: AccountUsage}) {
 const ledger=usage.ledger;if(!ledger)return usage.ledgerReason?<p className="inline-note">{usage.ledgerReason}</p>:null;
 const name=(id:string)=>ledger.workspaceNames?.[id]??id;
 const ids=Object.keys(ledger.allocations??{});
 return <section className="quota-ledger-panel" data-testid="quota-ledger" data-workbench-quota-allocations data-account-id={usage.accountId}><h5>工作空间配给</h5>{ids.map(id=><article key={id}><div className="quota-ledger-heading"><strong>{name(id)}{id===ledger.currentWorkspaceId?' · 本机工作空间':''}</strong><span>{ledger.tokenTotals?.[id]===undefined?'已上报 token 未知':ledger.tokenTotals[id].toLocaleString()+' token · 已上报累计'}</span></div>{(['weekly'] as const).map(key=>{
 const allocation=ledger.allocations![id]![key==='weekly'?'weeklyPercent':'fiveHourPercent'];if(allocation===null||allocation===undefined)return null;
 const window=ledger.windows.find(w=>w.window===key),loans=window?.debts.filter(d=>d.borrower===id)??[],reserve=window?.reserveUsed?.[id]??0,overdraft=window?.overdrafts?.[id]??0;
 const balance=window?.balances[id],remaining=balance===undefined?undefined:balance-loans.reduce((sum,d)=>sum+d.percent,0)-reserve-overdraft;
 const relative=remaining===undefined?undefined:allocation>0?remaining/allocation*100:remaining===0?0:undefined,label=key==='weekly'?'Weekly':'5h';
 return <div className="model-quota-window" key={key}><div><span>{label} · 配给 {percent(allocation)}</span><strong>{relative===undefined?'未读取':percent(relative)}</strong><small>{remaining!==undefined?'剩余 '+percent(remaining)+' 账号额度':'等待配给账本回执'}</small></div>{relative===undefined?<div role="progressbar" aria-label={name(id)+' '+label+' 可用额度'} aria-valuetext="尚无配给回执" className="model-quota-unknown"/>:<progress aria-label={name(id)+' '+label+' 可用额度'} max={100} value={Math.max(0,Math.min(100,relative))}/>}<div className="quota-source-labels">{loans.map(d=><small key={d.lender}>借自 {name(d.lender)} · {percent(d.percent)}</small>)}{reserve>0&&<small>来自未分配额度 · {percent(reserve)}</small>}{overdraft>0&&<small>未授权超限 · {percent(overdraft)}</small>}</div>{window?.repayments?.filter(d=>d.borrower===id).map((d,i)=><small key={i}>已归还 {name(d.lender)} · {percent(d.percent)}</small>)}</div>;
 })}</article>)}{!ids.length&&<p className="account-footnote">尚无可显示的空间分配回执。</p>}<p className="account-footnote">可用百分比以管理分配额度为基准；来源标签按账号额度百分比显示。负数表示已超出本空间份额，进度条最低为 0%。借款在周额度下次确认重置时归还原空间，不足继续结转。配给与 token 均仅涵盖工作台已观测、已上报活动，不代表其他客户端的全部使用。</p></section>;
}
