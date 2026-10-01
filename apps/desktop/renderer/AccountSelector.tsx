import { usableSharedAccount } from '../../../packages/account-selection';
import { useEffect, useRef, useState } from 'react';
import type { AccountCatalog } from '../../../packages/contracts';
import { selectedSharedAccount, sharedAccountRef } from '../../../packages/account-selection';
import { api } from './App';
import { Icon, errorText } from './ui';
import './AccountSelector.css';
import SelectMenu from './SelectMenu';

interface Props { hostId:string; provider?:'codex'|'claude'; catalog?:AccountCatalog; accountRef?:string; locked:boolean; onPending?:(pending:boolean)=>void; onSelected?:()=>void }
/** Chooses this workspace's default. Existing sessions keep their original account binding. */
export default function AccountSelector({hostId,provider='codex',catalog,accountRef,locked,onPending,onSelected}:Props) {
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  const epoch=useRef(0),live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;epoch.current++;};},[]);
  const invoke=async(method:'accounts/list'|'accounts/select',accountId?:string)=>{
    if(pending)return;
    const request=++epoch.current;setPending(true);onPending?.(true);setError('');
    try{await api<AccountCatalog>(method,{id:hostId,...(accountId?{accountId,provider,expectedRevision:provider==='claude'?catalog?.claudeSelectionRevision??0:catalog?.selectionRevision}:{})});if(method==='accounts/select'&&live.current&&epoch.current===request)onSelected?.();}
    catch(e){if(live.current&&epoch.current===request)setError(errorText(e));}
    finally{if(live.current&&epoch.current===request){setPending(false);onPending?.(false);}}
  };
  const bound=accountRef&&catalog?.availability==='ready'?catalog.accounts.find(account=>sharedAccountRef(catalog,account)===accountRef):undefined;
  const selected=accountRef?bound:selectedSharedAccount(catalog,provider);
  const label=(provider==='claude'?'Claude':'Codex')+' 账号';
  const ready=catalog?.availability==='ready';
  return <div className="composer-account-picker">
    <SelectMenu label={label} testId="composer-account" icon="user" value={selected?.id ?? ''} disabled={locked || pending || !ready} placeholder={accountRef ? '会话原账号 · 待核实' : !ready ? '账号待连接' : '选择账号'} options={catalog?.accounts.filter(a=>a.provider===provider).map(account => ({value:account.id,label:account.displayName ?? account.email ?? label,description:[account.plan,!usableSharedAccount(account) ? '待核实' : ''].filter(Boolean).join(' · '),disabled:!usableSharedAccount(account)})) ?? []} onChange={value => { void invoke('accounts/select', value); }} footer={<button type="button" className="text-button" data-testid="composer-accounts-refresh" disabled={pending} onClick={() => void invoke('accounts/list')}>{pending ? '正在刷新…' : '刷新账号'}</button>} />
    {!ready && <button type="button" className="text-button" data-testid="composer-accounts-refresh" aria-label="刷新账号" disabled={pending} onClick={() => void invoke('accounts/list')}><Icon name="refresh" size={14} /></button>}
    {error&&<span className="composer-account-error" role="alert">{error}</span>}
  </div>;
}
