import {useEffect,useState} from 'react';
import type {Session} from '../../../packages/contracts';
import {api} from './App';
import {errorText} from './ui';
export default function ApiCallBudget({session}:{session:Session}){
 const [value,setValue]=useState(String(session.apiCallBudget??0)),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>{setValue(String(session.apiCallBudget??0));setError('');},[session.id,session.apiCallBudget]);
 const save=async()=>{if(value===String(session.apiCallBudget??0))return;setSaving(true);setError('');try{await api('session/api-budget',{sessionId:session.id,limit:Number(value),expected:session.apiCallBudget??0});}catch(error){setError(errorText(error));setValue(String(session.apiCallBudget??0));}finally{setSaving(false);}};
 return <div className="api-call-budget" data-workbench-api-budget><label>每回合调用预算<input type="number" aria-label="每回合调用预算" min={0} step={1} value={value} disabled={saving} onChange={e=>setValue(e.target.value)} onBlur={()=>void save()} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label><small>0 不限；修改从下一回合生效</small>{error&&<p role="alert">{error}</p>}</div>;
}
