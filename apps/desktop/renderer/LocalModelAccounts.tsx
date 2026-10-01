import AccountResetCards from './AccountResetCards';
import AccountQuotaSummary from './AccountQuotaSummary';
import {useUiPreference} from './ui-preferences';
import { modelUsageRevision } from '../../../packages/model-management/usage';
import { useEffect, useId, useRef, useState } from 'react';
import type { AppState } from '../../../packages/contracts';
import type { AccountProvider, LocalModelAccount } from '../../../packages/model-management/types';
import type { ResetPlan, ResetReceipt } from '../../../packages/account-usage/types';
import { api } from './App';
import { Icon, Modal, Toggle, errorText } from './ui';
import ModelUsageSummary from './ModelUsageSummary';
import LoginDialog from './AccountLoginDialog';
import AccountCard from './AccountCard';
import './NativeResources.css';
import './ModelManagement.css';
import AccountExport from './AccountExport';
import './AccountQuotaCard.css';

const providerName=(provider:AccountProvider)=>provider==='codex'?'Codex':'Claude';
const errors:Record<string,string>={LOCAL_ACCOUNT_RUNTIME_MISSING:'请先在“运行时 CLI”安装对应官方程序。',LOCAL_ACCOUNT_BUSY:'此账号仍有运行、待提交或结果未知的任务，请先处理完成。',LOCAL_ACCOUNT_CHANGED:'账号已在其他位置更新，请刷新后重试。',LOCAL_ACCOUNT_LOGIN_FAILED:'官方登录未完成，请重试或检查 CLI。',LOCAL_ACCOUNT_LOGIN_UNVERIFIED:'尚未核实登录和模型目录，可关闭后在账号详情中重新读取。',LOCAL_ACCOUNT_MODELS_UNAVAILABLE:'官方 CLI 尚未返回模型目录，账号未标为可用。',LOCAL_ACCOUNT_RESET_PENDING:'上次兑换结果尚未确认，请使用原请求核对。',LOCAL_ACCOUNT_RESET_REFRESH_REQUIRED:'请先刷新额度，再选择当前可用的重置卡。',LOCAL_ACCOUNT_ALREADY_AUTHENTICATED:'此配置已登录；登录另一个账号请点击“添加账号”。',LOCAL_ACCOUNT_LOGIN_EXPIRED:'本次登录已超时，请重新发起。',LOCAL_ACCOUNT_RUNTIME_BUSY:'官方 CLI 正在维护，请稍后再试。'};
const errorLabel=(e:unknown)=>errors[errorText(e)]??(errorText(e).startsWith('LOCAL_')?'原生账号操作未确认，请刷新状态后重试。':errorText(e));
export {quotaCountdown} from './AccountQuotaWindows';
function AccountDetail({account,state,refresh,onLogin}:{account:LocalModelAccount;state:AppState;refresh():Promise<unknown>;onLogin():void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[plan,setPlan]=useState<ResetPlan>(),[receipt,setReceipt]=useState<ResetReceipt>();const lock=useRef(false),live=useRef(true);
  useEffect(()=>{live.current=true;void api<ResetReceipt|null>('models/accounts/reset-status',{id:account.id}).then(r=>{if(live.current&&r)setReceipt(r);}).catch(()=>{});return()=>{live.current=false;};},[account.id]);
  const run=async<T,>(method:string,p:Record<string,unknown>={},accept?:(v:T)=>void)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const v=await api<T>(method,{id:account.id,...p});if(live.current)accept?.(v);await refresh();}catch(e){if(live.current)setError(errorLabel(e));}finally{lock.current=false;if(live.current)setBusy(false);}};
  const usage=account.usage;
  return <div className="model-account-detail"><AccountQuotaSummary accountId={account.id} usage={usage} busy={busy} onRefresh={()=>void run('models/accounts/refresh')} summary={(account.status==='authenticated'?'已核实官方登录':'尚未登录')+(account.plan?' · '+account.plan:'')}/>{account.status!=='authenticated'&&<button className="text-button" disabled={busy} onClick={onLogin}>登录</button>}
    {account.provider==='codex'&&<AccountResetCards usage={usage} scope={account.id} busy={busy||receipt?.state==='uncertain'} onUse={card=>void run<ResetPlan>('models/accounts/reset-preview',{cardKey:card.key},setPlan)}/>}
    {receipt&&<div className="model-reset-receipt" role="status">{receipt.message}{receipt.state==='uncertain'&&<button className="text-button" disabled={busy} onClick={()=>void run<ResetReceipt>('models/accounts/reset-redeem',{planId:receipt.id,confirm:true},setReceipt)}>使用原请求核对</button>}</div>}
    <ModelUsageSummary scope={{kind:'account',id:account.id}} refreshKey={modelUsageRevision(state,{kind:'account',id:account.id})+':'+account.usage?.observedAt}/>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    {plan&&<Modal title="使用一张重置卡" dismissible={!busy} onClose={()=>setPlan(undefined)}><p>{account.name} · {plan.title??'额度重置卡'}</p><p>确认使用所选卡片？当前可用 {plan.remaining} 张。仅提交本次兑换。</p><footer className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setPlan(undefined)}>取消</button><button className="button primary" disabled={busy} onClick={()=>void run<ResetReceipt>('models/accounts/reset-redeem',{planId:plan.id,confirm:true},v=>{setReceipt(v);setPlan(undefined);})}>确认使用</button></footer></Modal>}
  </div>;
}
export default function LocalModelAccounts({state,refresh,notify}:{state:AppState;refresh():Promise<unknown>;notify(text:string):void}){
  const tabId=useId();const [providerTab,setProviderTab]=useUiPreference<AccountProvider>('settings.accounts-tab');
  const [expanded,setExpanded]=useUiPreference<string[]>('models.expanded','local'),[login,setLogin]=useState<LocalModelAccount>(),[removing,setRemoving]=useState<LocalModelAccount>(),[busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
  const run=async<T,>(method:string,p:Record<string,unknown>,accept?:(v:T)=>void)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const v=await api<T>(method,p);await refresh();accept?.(v);}catch(e){setError(errorLabel(e));}finally{lock.current=false;setBusy(false);}};
  const accounts=state.localModelAccounts??[];
  return <section className="local-model-accounts" data-testid="local-model-accounts">
    <div className="model-api-heading"><h2>官方账号</h2><button className="text-button" disabled={busy} onClick={()=>void run<LocalModelAccount>('models/accounts/prepare',{provider:providerTab},setLogin)}><Icon name="plus" size={14}/>添加账号</button></div>
    <div className="skill-tabs model-account-tabs" role="tablist" aria-label="官方账号厂商">{(['codex','claude'] as const).map(p=><button type="button" key={p} id={tabId+'-'+p} role="tab" aria-controls={tabId+'-panel'} aria-selected={providerTab===p} tabIndex={providerTab===p?0:-1} onClick={()=>setProviderTab(p)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'codex':event.key==='End'?'claude':p==='codex'?'claude':'codex';setProviderTab(next);event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('#'+CSS.escape(tabId+'-'+next))?.focus();}}}>{providerName(p)} <span>{accounts.filter(a=>a.provider===p).length}</span></button>)}</div>
    <div className="model-account-list" id={tabId+'-panel'} role="tabpanel" aria-labelledby={tabId+'-'+providerTab}>{accounts.filter(a=>a.provider===providerTab).map(account=><AccountCard key={account.id} accountId={account.id} provider={account.provider} testId={'model-account-'+account.id} name={account.name} email={account.email} subtitle={providerName(account.provider)+' · '+(account.status==='authenticated'?account.plan??'已登录':account.status==='signed-out'?'待登录':'状态待核实')} expanded={expanded.includes(account.id)} onExpanded={open=>setExpanded(old=>open?[...old,account.id]:old.filter(id=>id!==account.id))} onRename={async name=>{await api('models/accounts/rename',{id:account.id,revision:account.revision,name});await refresh();}} controls={<><AccountExport account={account}/><button className="icon-button" disabled={busy} aria-label={'移除 '+account.name} onClick={()=>setRemoving(account)}><Icon name="trash" size={14}/></button><fieldset className="resource-fieldset model-source-toggle" disabled={busy}><Toggle label={'启用 '+account.name} checked={account.enabled} onChange={enabled=>void run('models/accounts/set-enabled',{id:account.id,revision:account.revision,enabled},()=>notify(enabled?'账号已启用':'账号已停用，登录资料保留'))}/></fieldset></>}><AccountDetail account={account} state={state} refresh={refresh} onLogin={()=>setLogin(account)}/></AccountCard>)}</div>
    {!accounts.some(a=>a.provider===providerTab)&&<p className="model-usage-note">尚未添加 {providerName(providerTab)} 账号，完成登录后会显示账号卡片。</p>}{error&&!removing&&<p className="inline-error" role="alert">{error}</p>}
    {login&&<LoginDialog key={login.id} account={login} refresh={refresh} onClose={()=>setLogin(undefined)}/>}
    {removing&&<Modal title="移除账号入口" dismissible={!busy} onClose={()=>setRemoving(undefined)}><p>从工作台移除「{removing.name}」？原生登录目录、历史与用量记录保留，不会退出其他客户端。</p>{error&&<p className="inline-error">{error}</p>}<footer className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setRemoving(undefined)}>取消</button><button className="button danger" disabled={busy} onClick={()=>void run('models/accounts/remove',{id:removing.id,revision:removing.revision,confirm:true},()=>setRemoving(undefined))}>确认移除</button></footer></Modal>}
  </section>;
}
