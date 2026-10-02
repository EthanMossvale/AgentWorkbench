import {useUiPreference} from './ui-preferences';
import {useEffect,useRef,useState} from 'react';
import type {AccountCatalog,SharedAccount,SshHost} from '../../../packages/contracts';
import type {AccountSetupPlan} from '../../../packages/remote-account-catalog/setup';
import CodexLogin from './CodexLogin';
import NativeClaudeAccounts from './NativeClaudeAccounts';
import AccountSetup from './AccountSetup';
import {api} from './App';
import {errorText,Modal} from './ui';
import './AccountManagement.css';

export default function ProviderAccounts({host,cachedCatalog,active,notify}:{host:SshHost;cachedCatalog?:AccountCatalog;active:boolean;notify:(s:string)=>void}){
 const [provider,setProvider]=useUiPreference<'codex'|'claude'>('settings.remote-provider',host.id);
 const [catalog,setCatalog]=useState(cachedCatalog),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [setup,setSetup]=useState<AccountSetupPlan|null>(null),[enroll,setEnroll]=useState<SharedAccount|null>(null);
 const live=useRef(true),lock=useRef(false),epoch=useRef(0);
 useEffect(()=>{live.current=true;return()=>{live.current=false;epoch.current++;};},[]);
 useEffect(()=>{setCatalog(cachedCatalog);},[cachedCatalog]);
 const run=async(action:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();}catch(e){if(live.current)setError(errorText(e));}finally{lock.current=false;if(live.current)setBusy(false);}};
 const refresh=()=>run(async()=>{const version=++epoch.current,value=await api<AccountCatalog>('accounts/list',{id:host.id});if(live.current&&version===epoch.current)setCatalog(value);});
 useEffect(()=>{if(active&&(!cachedCatalog||cachedCatalog.availability!=='ready'||cachedCatalog.source==='existing-codex'))void refresh();},[active,host.id]);
 const prepare=()=>run(async()=>{const value=await api<AccountSetupPlan>('accounts/setup-plan',{id:host.id});if(live.current)setSetup(value);});
 const ready=catalog?.source==='native-owner'&&catalog.availability==='ready';
 const legacy=catalog?.source==='existing-codex'?catalog.accounts:catalog?.legacy?.accounts??[];
 const pending=legacy.filter(a=>!catalog?.accounts.some(current=>catalog.source==='native-owner'&&current.id===a.id&&current.generation===a.generation));
 const applySetup=()=>run(async()=>{if(!setup)return;try{await api('accounts/setup-apply',{id:host.id,planId:setup.id,confirm:true});const value=await api<AccountCatalog>('accounts/list',{id:host.id});if(live.current){setCatalog(value);setSetup(null);notify('统一账号服务已接通。可集中登录，再分配给工作空间。');}}catch(error){if(live.current)setSetup({...setup,status:'blocked',blockers:['SETUP_RECHECK_REQUIRED']});throw error;}});
 const enrollAccount=()=>run(async()=>{if(!enroll)return;await api('accounts/enroll-legacy',{id:host.id,accountId:enroll.id,confirm:true});const value=await api<AccountCatalog>('accounts/list',{id:host.id});if(live.current){setCatalog(value);setEnroll(null);notify('原账号已登记到统一入口。请在该账号行完成一次官方登录。');}});
 return <div className="provider-accounts">
  {!ready&&<div className="account-central-heading"><button className="text-button" data-testid="central-accounts-refresh" disabled={busy} onClick={()=>void refresh()}>{busy?'处理中…':'刷新账号'}</button></div>}
  <div className="provider-switch" role="tablist" aria-label="原生账号厂商">{(['codex','claude'] as const).map(value=><button key={value} role="tab" aria-selected={provider===value} data-testid={'provider-'+value} onClick={()=>setProvider(value)}>{value==='codex'?'Codex':'Claude'}<span>{ready?catalog.accounts.filter(a=>a.provider===value).length:'—'}</span></button>)}</div>
  {ready?<><div hidden={provider!=='codex'}><CodexLogin host={host} cachedCatalog={catalog} notify={notify}/></div><div hidden={provider!=='claude'}><NativeClaudeAccounts key={host.id} host={host} catalog={catalog} notify={notify} onCatalog={setCatalog}/></div></>:<section className="account-service-pending" data-testid="account-service-pending"><h3>{provider==='codex'?'Codex':'Claude'} 账号</h3><p>{busy?'正在核实统一账号入口…':'统一账号服务尚未接通'}</p>{host.role!=='admin'&&<p className="inline-note">请联系管理员分配账号。</p>}{catalog?.reason&&<p className="inline-note">{catalog.reason}</p>}{host.role==='admin'&&<button className="button secondary compact-button" data-testid="account-service-prepare" disabled={busy} onClick={()=>void prepare()}>准备统一账号服务…</button>}</section>}
  {provider==='codex'&&pending.length>0&&<section className="account-legacy" data-testid="legacy-account-catalog"><h4>已发现的原账号 <span>{pending.length}</span></h4>{pending.map(account=><article key={account.id+':'+account.generation}><div><strong>{account.displayName??account.email??account.id}</strong>{account.email&&<small>{account.email}</small>}<small>{account.plan??'套餐未知'} · 待集中接入</small></div>{host.role==='admin'&&<button className="text-button" data-testid={'legacy-enroll-'+account.id} disabled={busy} onClick={()=>ready?setEnroll(account):void prepare()}>{ready?'接入原账号…':'准备接入…'}</button>}</article>)}</section>}
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {setup&&<AccountSetup plan={setup} busy={busy} error={error} onClose={()=>{if(!busy)setSetup(null);}} onApply={()=>void applySetup()} onRecheck={()=>void prepare()}/>}
  {enroll&&<Modal title="接入原账号" subtitle="只需集中接入一次，工作空间继续使用同一账号。" onClose={()=>{if(!busy)setEnroll(null);}}><div className="account-setup-content"><strong>{enroll.email??enroll.displayName??enroll.id}</strong><p>请核对这是你要继续使用的原账号。接入会保留原账号标识和配给代次，并准备一处私有原生登录位置。</p><p>随后使用此账号完成一次官方登录，再分配给工作空间。此操作不会迁移旧会话或代替你登录。</p>{!enroll.email&&<p className="inline-error">旧服务没有提供可核实的邮箱，请先恢复其公开账号信息。</p>}{error&&<p className="inline-error">{error}</p>}<div className="account-setup-actions"><button className="button secondary" disabled={busy} onClick={()=>setEnroll(null)}>取消</button><button className="button primary" disabled={busy||!enroll.email} data-testid="confirm-legacy-enroll" onClick={()=>void enrollAccount()}>{busy?'接入中…':'确认接入此账号'}</button></div></div></Modal>}
 </div>;
}
