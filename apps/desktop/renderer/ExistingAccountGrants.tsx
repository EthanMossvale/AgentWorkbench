import {useEffect,useState} from 'react';
import type {AccountCatalog} from '../../../packages/contracts';
import {api} from './App';
import {Icon,errorText} from './ui';
import './AccountManagement.css';

function GrantRow({hostId,catalog,username,onSaved}:{hostId:string;catalog:AccountCatalog;username:string;onSaved:(value:AccountCatalog)=>void}){
 const original=catalog.assignments?.find(row=>row.username===username)?.accountIds??[];
 const [ids,setIds]=useState(original),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const signature=JSON.stringify(original);
 useEffect(()=>{setIds(JSON.parse(signature));},[signature]);
 const dirty=JSON.stringify([...ids].sort())!==JSON.stringify([...original].sort());
 const save=async()=>{setBusy(true);setError('');try{onSaved(await api<AccountCatalog>('accounts/assign',{id:hostId,username,accountIds:ids,expectedRevision:catalog.policyRevision}));}catch(e){setError(errorText(e));}finally{setBusy(false);}};
 return <div className="grant-row" data-testid={`grant-row-${username}`}><div className="grant-space"><Icon name="folder" size={15}/><span>{username}<small>{ids.length?'已分配 '+ids.length+' 个账号':'尚未分配'}</small></span></div><div className="grant-choices">{catalog.accounts.map(account=><button key={account.id} type="button" className="grant-choice" aria-pressed={ids.includes(account.id)} disabled={busy} onClick={()=>setIds(previous=>previous.includes(account.id)?previous.filter(id=>id!==account.id):[...previous,account.id])}><span className="grant-check">{ids.includes(account.id)&&<Icon name="check" size={11}/>}</span>{account.displayName??account.email??account.id}</button>)}</div><button className="text-button grant-save" disabled={busy||!dirty} data-testid={`existing-grants-save-${username}`} onClick={()=>void save()}>{busy?'保存中…':dirty?'保存修改':'已保存'}</button>{error&&<p className="inline-error" role="alert">{error}</p>}</div>;
}
export default function ExistingAccountGrants({hostId,catalog,onSaved}:{hostId:string;catalog:AccountCatalog;onSaved:(value:AccountCatalog)=>void}){
 if(catalog.source!=='existing-codex'||!catalog.assignments)return null;
 return <section className="account-grants" data-testid="existing-account-grants"><div className="account-section-heading"><h4>空间使用权</h4><span>同一账号，可供多个空间使用</span></div><div className="grant-list">{catalog.assignments.map(row=><GrantRow key={row.username} hostId={hostId} catalog={catalog} username={row.username} onSaved={onSaved}/>)}</div>{!catalog.assignments.length&&<p className="inline-note">添加成员工作空间后，在这里分配账号。</p>}<p className="account-footnote">此处管理工作台使用权。已有客户端的授权由原服务保留。</p></section>;
}
