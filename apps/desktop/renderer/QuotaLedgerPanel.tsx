import type {AccountUsage} from '../../../packages/account-usage/types';
const percent=(value:number)=>Math.round(value*100)/100+'%';
export default function QuotaLedgerPanel({usage}: {usage: AccountUsage}) {
 const ledger=usage.ledger;if(!ledger)return usage.ledgerReason?<p className="inline-note">{usage.ledgerReason}</p>:null;
 const name=(id:string)=>ledger.workspaceNames?.[id]??id;
 const ids=Object.keys(ledger.allocations??{});
 return <section className="quota-ledger-panel" data-testid="quota-ledger" data-workbench-quota-allocations data-account-id={usage.accountId}>
  <h5>工作空间配给</h5>
  {ids.map(id=><article key={id}>
   <div className="quota-ledger-heading"><strong>{name(id)}{id===ledger.currentWorkspaceId?' · 本机工作空间':''}</strong><span>{ledger.tokenTotals?.[id]===undefined?'已记录 token 未知':ledger.tokenTotals[id].toLocaleString()+' token · 已记录累计'}</span></div>
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
      {recovered>0&&<small>本周期建账前已恢复 {recovered.toLocaleString()} token{pending?' · 待校准':' · 估算消耗 '+percent(window?.recoveredPercent?.[id]??0)}</small>}
      {loans.map(d=><small key={d.lender}>借自 {name(d.lender)} · {percent(d.percent)}</small>)}
      {reserve>0&&<small>来自未分配额度 · {percent(reserve)}</small>}{overdraft>0&&<small>未授权超限 · {percent(overdraft)}</small>}
     </div>
     {window?.repayments?.filter(d=>d.borrower===id).map((d,i)=><small key={i}>已归还 {name(d.lender)} · {percent(d.percent)}</small>)}
    </div>;
   })}
  </article>)}
  {!ids.length&&<p className="account-footnote">尚无可显示的空间分配回执。</p>}
  {ledger.historyVersion!==1&&<p className="account-footnote">远端额度服务尚不支持历史恢复，需要更新后同步；旧回执不代表本空间的完整消耗。</p>}
  {ledger.windows.some(w=>w.unassignedPercent>0)&&<p className="account-footnote">账号存在尚未完整归属的消耗，不平摊给工作空间。</p>}
  <p className="account-footnote">可用百分比以管理分配额度为基准；账号实际可用量仍受上方原生额度限制。历史恢复仅使用可核实归属的数字记录，百分比为采样估算，缺少样本时显示待校准。负数表示已超出本空间份额，进度条最低为 0%。借款在周额度下次确认重置时归还原空间，不足继续结转。未记录的其他客户端用量不算作本空间消耗。</p>
 </section>;
}
