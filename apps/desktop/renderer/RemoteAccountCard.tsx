import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {AccountCatalog,SharedAccount,SshHost} from '../../../packages/contracts';
import {api} from './App';
import {Icon,Modal,Toggle,errorText} from './ui';
import AccountCard from './AccountCard';
import AccountUsagePanel from './AccountUsage';
import {sharedAccountRef} from '../../../packages/account-selection';
import {modelUsageRevision} from '../../../packages/model-management/usage';
import './AccountQuotaCard.css';

export default function RemoteAccountCard({host,catalog,account,controls,notify}:{host:SshHost;catalog:AccountCatalog;account:SharedAccount;controls?:ReactNode;notify:(text:string)=>void}){
 const [current,setCurrent]=useState(account),[usageRevision,setUsageRevision]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[removing,setRemoving]=useState(false);const lock=useRef(false),live=useRef(true);
 const scope={kind:'account' as const,id:sharedAccountRef(catalog,account)},admin=host.role==='admin';
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>setCurrent(account),[account]);
 useEffect(()=>window.workbench?.onState(state=>{setUsageRevision(modelUsageRevision(state,scope));const c=state.accountCatalogs?.[host.id],a=c?.authorityId===catalog.authorityId&&c.generation===catalog.generation?c.accounts.find(a=>a.id===account.id&&a.generation===account.generation):undefined;if(a)setCurrent(a);}),[scope.id,host.id]);
 const name=current.displayName??current.email??(current.provider==='codex'?'Codex':'Claude')+' 账号';
 const run=async(action:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();}catch(e){if(live.current){setError(errorText(e));notify(errorText(e));}}finally{lock.current=false;if(live.current)setBusy(false);}};
 const toggle=(enabled:boolean)=>run(async()=>{const value=await api<AccountCatalog>('accounts/set-enabled',{id:host.id,accountId:current.id,accountGeneration:current.generation,expectedRevision:admin?current.accessRevision??0:current.workspaceAccessRevision??0,enabled});const next=value.accounts.find(a=>a.id===current.id&&a.generation===current.generation);if(live.current&&next)setCurrent(next);notify(admin?(enabled?'账号已全局启用，各工作空间保留自身开关。':'账号已全局停用，所有工作空间均不可使用。'):(enabled?'已在此工作空间启用；仍受管理员总开关约束。':'已在此工作空间停用，其他工作空间不受影响。'));});
 return <><AccountCard preferenceScope={JSON.stringify([host.id,current.generation])} accountId={current.id} provider={current.provider} name={name} email={current.email} subtitle={(current.provider==='codex'?'Codex':'Claude')+' · '+(current.plan??'已登录')} testId={'shared-account-'+current.id} onRename={async name=>{const next=await api<SharedAccount>('accounts/rename',{id:host.id,accountId:current.id,generation:current.generation,revision:current.nameRevision,name});setCurrent(next);}} controls={<>{controls}{admin&&<button className="icon-button" disabled={busy} aria-label={'移除 '+name} onClick={()=>setRemoving(true)}><Icon name="trash" size={14}/></button>}<fieldset className="resource-fieldset model-source-toggle" disabled={busy}><Toggle label={(admin?'全局启用 ':'在此工作空间启用 ')+name} checked={admin?current.enabled!==false:current.workspaceEnabled!==false} onChange={enabled=>void toggle(enabled)}/></fieldset></>}>
 {current.enabled===false&&<p className="model-usage-note">管理员已停用此账号，所有工作空间均不可用。</p>}{!admin&&current.workspaceEnabled===false&&<p className="model-usage-note">此工作空间已停用此账号。</p>}
 {catalog.source==='native-owner'&&<><AccountUsagePanel host={host} catalog={{...catalog,accounts:[current],selectedAccountId:current.id}} refreshKey={usageRevision}/></>}{error&&<p className="inline-error" role="alert">{error}</p>}
 </AccountCard>{removing&&<Modal title="移除账号入口" dismissible={!busy} onClose={()=>setRemoving(false)}><p>移除「{name}」？此账号将不能再被工作空间使用，原生登录资料保留。</p>{error&&<p className="inline-error">{error}</p>}<footer className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setRemoving(false)}>取消</button><button className="button danger" disabled={busy} onClick={()=>void run(async()=>{await api('native-accounts/remove',{id:host.id,accountId:current.id,confirm:true});if(live.current)setRemoving(false);})}>确认移除</button></footer></Modal>}</>;
}
