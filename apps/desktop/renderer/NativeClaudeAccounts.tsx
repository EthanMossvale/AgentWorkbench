import {usableSharedAccount} from '../../../packages/account-selection';
import {RememberedDetails} from './UiMemory';
import {useRef,useState} from 'react';
import type {AccountCatalog,SshHost} from '../../../packages/contracts';
import NativeAccountState from './NativeAccountState';
import {api} from './App';
import {errorText,Modal} from './ui';
import RemoteAccountCard from './RemoteAccountCard';
import RemoteBrowserManager from './RemoteBrowserManager';
export default function NativeClaudeAccounts({host,catalog,notify,onCatalog}:{host:SshHost;catalog:AccountCatalog;notify:(text:string)=>void;onCatalog?:(value:AccountCatalog)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[loginOpen,setLoginOpen]=useState(false);const lock=useRef(false);
 const run=async(method:string,params:Record<string,unknown>={})=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const value=await api<AccountCatalog>(method,{id:host.id,...params});onCatalog?.(value);}catch(e){setError(errorText(e));}finally{lock.current=false;setBusy(false);}};
 const accounts=catalog.accounts.filter(a=>a.provider==='claude');
 return <section className="claude-management" data-testid="claude-management"><div className="account-section-heading"><h3>Claude 账号</h3><button className="text-button" data-testid="claude-refresh" disabled={busy} onClick={()=>void run('accounts/list')}>刷新账号</button></div>
 {!accounts.length&&<p className="model-usage-note">尚未添加 Claude 账号，完成登录后会显示账号卡片。</p>}
 <div className="model-account-list native-claude-list">{accounts.filter(a=>a.status==='authenticated'||a.status==='configured').map(account=><RemoteAccountCard key={account.id+':'+account.generation} host={host} catalog={catalog} account={account} notify={notify} controls={host.role==='workspace'?catalog.selectedClaudeAccountId===account.id?<small>当前默认</small>:<button className="text-button" disabled={busy||!usableSharedAccount(account)} onClick={()=>void run('accounts/select',{accountId:account.id,provider:'claude',expectedRevision:catalog.claudeSelectionRevision??0})}>设为默认</button>:undefined}/>)}</div>
 {accounts.some(a=>!['authenticated','configured'].includes(a.status))&&<div className="account-pending-list"><h4>待恢复的已有账号</h4>{accounts.filter(a=>!['authenticated','configured'].includes(a.status)).map(account=><div key={account.id}><span>{account.displayName??'Claude 账号'}</span><NativeAccountState host={host} account={account} notify={notify}/></div>)}</div>}
 {host.role==='admin'&&<button className="text-button" disabled={busy} data-testid="claude-create" onClick={()=>setLoginOpen(true)}>登录 Claude</button>}
 {loginOpen&&<Modal title="远端 Claude 登录" className="model-account-login" onClose={()=>setLoginOpen(false)}><RemoteBrowserManager host={host} draftLogin notify={notify}/></Modal>}
 <RememberedDetails memoryId="NativeClaudeAccounts.details.1" className="account-help"><summary>登录与使用范围</summary><p>登录由远端官方 CLI 完成，工作空间使用已授权账号。额度以官方回执为准，用量仅统计此工作台收到的记录。</p></RememberedDetails>{error&&<p className="inline-error" role="alert">{error}</p>}
 </section>;
}
