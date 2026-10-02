import ModelUsageSummary from './ModelUsageSummary';
import AccountResetCards from './AccountResetCards';
import {sharedAccountRef} from '../../../packages/account-selection';
import AccountQuotaSummary from './AccountQuotaSummary';
import {useEffect,useRef,useState} from 'react';
import type {AccountCatalog,SshHost} from '../../../packages/contracts';
import type {AccountUsage,ResetPlan,ResetReceipt} from '../../../packages/account-usage/types';
import {api} from './App';
import {Modal,errorText} from './ui';
import QuotaLedgerPanel from './QuotaLedgerPanel';
const cardName=(type:string)=>({codexRateLimits:'Codex 额度重置卡',unknown:'额度重置卡'}[type]??type);
export default function AccountUsagePanel({host,catalog,refreshKey}:{host:SshHost;catalog:AccountCatalog;refreshKey?:string}){
 const [id,setId]=useState(catalog.selectedAccountId??catalog.accounts[0]?.id??''),[usage,setUsage]=useState<AccountUsage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[plan,setPlan]=useState<ResetPlan|null>(null),[receipt,setReceipt]=useState<ResetReceipt|null>(null);
 const epoch=useRef(0),lock=useRef(false);
 useEffect(()=>()=>{epoch.current++;},[]);
 const signature=JSON.stringify([host.hostname,host.port,host.username,catalog.authorityId,catalog.generation,catalog.workspaceId,catalog.accounts.map(a=>[a.id,a.generation])]);
 useEffect(()=>{epoch.current++;setUsage(null);setReceipt(null);setPlan(null);setId(old=>catalog.accounts.some(a=>a.id===old)?old:catalog.selectedAccountId??catalog.accounts[0]?.id??'');},[signature,catalog.selectedAccountId]);
 const run=async<T,>(action:()=>Promise<T>,accept:(v:T)=>void)=>{if(lock.current)return;lock.current=true;const request=++epoch.current;setBusy(true);setError('');try{const value=await action();if(request===epoch.current)accept(value);}catch(e){if(request===epoch.current)setError(errorText(e));}finally{lock.current=false;setBusy(false);}};
 const load=(refresh=false)=>run(()=>api<AccountUsage>('accounts/usage',{id:host.id,accountId:id,refresh,cacheOnly:!refresh}),value=>{setUsage(value);setReceipt(value.pendingReset??null);});
 useEffect(()=>{if(!id)return;let live=true;const request=++epoch.current;void api<AccountUsage>('accounts/usage',{id:host.id,accountId:id,cacheOnly:true}).then(value=>{if(live&&request===epoch.current){setUsage(value.pools.length?value:null);setReceipt(value.pendingReset??null);}}).catch(e=>{if(live)setError(errorText(e));});return()=>{live=false;epoch.current++;};},[host.id,id,signature]);
 const lastRevision=useRef(refreshKey);
 useEffect(()=>{if(lastRevision.current===refreshKey)return;let timer:ReturnType<typeof setTimeout>;const refresh=()=>{if(lock.current){timer=setTimeout(refresh,100);return;}lastRevision.current=refreshKey;if(id)void load();};refresh();return()=>clearTimeout(timer);},[refreshKey]);
 const preview=(key:string)=>run(()=>api<ResetPlan>('accounts/reset-preview',{id:host.id,accountId:id,cardKey:key}),setPlan);
 const redeem=(planId:string)=>run(()=>api<ResetReceipt>('accounts/reset-redeem',{id:host.id,planId,confirm:true}),value=>{setPlan(null);setReceipt(value);if(value.state==='redeemed')setUsage(null);});
 if(!catalog.accounts.length)return null;
 const account=catalog.accounts.find(a=>a.id===id),codex=account?.provider==='codex';
 return <section className="account-usage model-account-detail" data-testid="account-usage"><AccountQuotaSummary accountId={id} usage={usage??undefined} busy={busy} onRefresh={()=>void load(true)} summary={(account?.status==='authenticated'?'已核实官方登录':'尚未登录')+(account?.plan?' · '+account.plan:'')}/>
  {codex&&<AccountResetCards usage={usage??undefined} scope={account?sharedAccountRef(catalog,account):host.id} busy={busy||receipt?.state==='uncertain'} canUse={host.role==='admin'} onUse={card=>void preview(card.key)}/>}
  {usage&&<QuotaLedgerPanel usage={usage}/>}
  {receipt&&<div className="reset-receipt" data-testid="reset-receipt" role="status"><p>{receipt.message}</p>{receipt.state==='uncertain'&&<button className="text-button" disabled={busy} onClick={()=>void redeem(receipt.id)}>使用原请求确认回执</button>}{receipt.state==='redeemed'&&<button className="text-button" disabled={busy} onClick={()=>void load(true)}>刷新余额</button>}</div>}
  {account&&<ModelUsageSummary scope={{kind:'account',id:sharedAccountRef(catalog,account)}} refreshKey={refreshKey}/>}
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {plan&&<Modal title="使用一张重置卡" onClose={()=>{if(!busy)setPlan(null);}}><p className="reset-confirm-name">{plan.title??cardName(plan.cardType)}</p><p>账号：{catalog.accounts.find(a=>a.id===plan.accountId)?.displayName??catalog.accounts.find(a=>a.id===plan.accountId)?.email??plan.accountId}</p><p className="inline-note">当前有 {plan.remaining} 张。确认后提交一次兑换。若没有需要重置的额度窗口，原生服务会返回未消费；不会自动购买或连续使用。</p>{error&&<p className="inline-error">{error}</p>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setPlan(null)}>取消</button><button className="button primary" data-testid="reset-confirm" disabled={busy} onClick={()=>void redeem(plan.id)}>{busy?'正在确认…':'确认使用一张'}</button></div></Modal>}
 </section>;
}
