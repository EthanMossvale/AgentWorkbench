import {useUiPreference} from './ui-preferences';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, errorText } from './ui';
import './ModelManagement.css';
import './AccountCard.css';

export interface AccountCardProps {
  name:string; email?:string; subtitle:string; children?:ReactNode; controls?:ReactNode;
  expanded?:boolean; onExpanded?(expanded:boolean):void; onRename?(name:string):Promise<void>;
  testId?:string; className?:string; accountId?:string; provider?:string; preferenceScope?:string;
}
export function maskAccountEmail(email:string) {
  const at=email.lastIndexOf('@');if(at<1)return email.length<3?'•••':email.slice(0,1)+'•••'+email.slice(-1);
  const local=email.slice(0,at);return local.slice(0,Math.min(2,local.length))+'•••'+(local.length>3?local.slice(-1):'')+email.slice(at);
}
export default function AccountCard({name,email,subtitle,controls,children,expanded,onExpanded,onRename,testId,className='',accountId,provider,preferenceScope}:AccountCardProps){
  const [open,setOpen]=useUiPreference<boolean>('disclosure.open',JSON.stringify(['account',preferenceScope??'local',provider,accountId])),[editing,setEditing]=useState(false),[draft,setDraft]=useState(name),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reveal,setReveal]=useState(false);const lock=useRef(false),live=useRef(true),bodyId=useId();
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);useEffect(()=>{if(!editing)setDraft(name);},[name,editing]);useEffect(()=>setReveal(false),[email]);
  const isOpen=expanded??open;
  const toggle=()=>{if(onExpanded)onExpanded(!isOpen);else setOpen(!isOpen);};
  const save=async()=>{if(lock.current||!onRename)return;lock.current=true;setBusy(true);setError('');try{await onRename(draft.trim());if(live.current)setEditing(false);}catch(e){if(live.current)setError(errorText(e).startsWith('LOCAL_')?'账号名称未保存，请刷新后重试。':errorText(e));}finally{lock.current=false;if(live.current)setBusy(false);}};
  return <article className={'model-account account-card '+className} data-testid={testId} data-workbench-account-card data-account-id={accountId} data-provider={provider}>
    <div className="model-account-row">
      <button type="button" className="model-row-disclosure" aria-label={'展开 '+name} aria-expanded={isOpen} aria-controls={bodyId} onClick={toggle}><Icon name="chevron" size={13}/><span><strong>{name}</strong><small>{subtitle}</small></span></button>
      {onRename&&<button type="button" className="icon-button account-name-edit" aria-label={'重命名 '+name} title="编辑账号名称" onClick={()=>{setDraft(name);setEditing(true);setError('');}}><Icon name="edit" size={14}/></button>}{controls}
    </div>
    {editing&&<form className="account-name-editor" onSubmit={e=>{e.preventDefault();void save();}}><label>账号名称<input aria-label="编辑账号名称" autoFocus value={draft} disabled={busy} maxLength={100} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.stopPropagation();setEditing(false);}}}/></label><div><button className="text-button" type="submit" disabled={busy||!draft.trim()}>保存名称</button><button className="text-button" type="button" disabled={busy} onClick={()=>setEditing(false)}>取消改名</button></div>{error&&<p className="inline-error" role="alert">{error}</p>}</form>}
    {isOpen&&<div className="account-card-body" id={bodyId}>
      {email&&<div className="account-identity-email" data-workbench-account-email><span className="account-email-caption">邮箱</span><span className="account-email-value">{reveal?email:maskAccountEmail(email)}</span><button className="icon-button" type="button" aria-label={reveal?'隐藏邮箱':'显示邮箱'} aria-pressed={reveal} title={reveal?'隐藏邮箱':'显示邮箱'} onClick={()=>setReveal(v=>!v)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{!reveal&&<path d="m4 3 16 18"/>}</svg></button></div>}
      {children}
    </div>}
  </article>;
}
