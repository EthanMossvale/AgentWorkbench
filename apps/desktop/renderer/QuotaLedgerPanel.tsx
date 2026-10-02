import type {AccountUsage} from '../../../packages/account-usage/types';
const percent=(value:number)=>Math.round(value*100)/100+'%';
export default function QuotaLedgerPanel({usage}: {usage: AccountUsage}) {
 const ledger=usage.ledger;if(!ledger)return usage.ledgerReason?<p className="inline-note">{usage.ledgerReason}</p>:null;
 const name=(id:string)=>ledger.workspaceNames?.[id]??id;
 const ids=Object.keys(ledger.allocations??{});
 return <section className="quota-ledger-panel" data-testid="quota-ledger" data-workbench-quota-allocations data-account-id={usage.accountId}>
  <h5>工作空间配给</h5>
  {ids.map(id=><article key={id}>
   <div className="quota-ledger-heading"><strong>{name(id)}{id===ledger.currentWorkspaceId?' · 本机工作空间':''}</strong><span>{ledger.tokenTotals?.[id]===undefined?'— token':ledger.tokenTotals[id].toLocaleString()+' token'}</span></div>
   {(['weekly'] as const).map(key=>{
    const allocation=ledger.allocations![id]!.weeklyPercent;if(allocation===null||allocation===undefined)return null;
    const window=ledger.windows.find(w=>w.window===key),loans=window?.debts.filter(d=>d.borrower===id)??[],reserve=window?.reserveUsed?.[id]??0,overdraft=window?.overdrafts?.[id]??0;
    const balance=window?.balances[id],remaining=balance===undefined?undefined:balance-loans.reduce((sum,d)=>sum+d.percent,0)-reserve-overdraft;
    const recovered=window?.recoveredTokens?.[id]??0,pending=recovered>0&&window?.estimatedTotalTokens===null;
    const relative=pending||remaining===undefined?undefined:allocation>0?remaining/allocation*100:remaining===0?0:undefined;
    return <div className="model-quota-window" key={key}>
     <div><span>Weekly · 配给 {percent(allocation)}</span><strong>{pending?'待校准':relative===undefined?'未读取':percent(relative)}</strong><small>{pending?'历史 token 已恢复，尚不能换算额度':remaining!==undefined?'剩余 '+percent(remaining)+' 账号额度':'等待配给账本回执'}</small></div>
     {relative===undefined?<div role="progressbar" aria-label={name(id)+' Weekly 可用额度'} aria-valuetext={pending?'历史用量已恢复，等待窗口校准':'尚无配给回执'} className="model-quota-unknown"/>:<progress aria-label={name(id)+' Weekly 可用额度'} max={100} value={Math.max(0,Math.min(100,relative))}/>}
     <div className="quota-source-labels">
      {loans.map(d=><small key={d.lender}>借自 {name(d.lender)} · {percent(d.percent)}</small>)}
      {reserve>0&&<small>来自未分配额度 · {percent(reserve)}</small>}{overdraft>0&&<small>未授权超限 · {percent(overdraft)}</small>}
     </div>
     {window?.repayments?.filter(d=>d.borrower===id).map((d,i)=><small key={i}>已归还 {name(d.lender)} · {percent(d.percent)}</small>)}
    </div>;
   })}
  </article>)}
  {!ids.length&&<p className="account-footnote">尚无可显示的空间分配回执。</p>}
 </section>;
}
