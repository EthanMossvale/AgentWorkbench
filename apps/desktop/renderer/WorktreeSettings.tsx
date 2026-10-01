import { useEffect, useState } from 'react';
import type { AppState } from '../../../packages/contracts';
import type { WorktreeRecord } from '../../../packages/worktrees';
import { api } from './App';
import { Icon, Toggle, errorText } from './ui';
import './WorktreeSettings.css';
interface Listing { root:string; defaultRoot:string; autoDelete:boolean;limit:number;records:WorktreeRecord[] }
export default function WorktreeSettings({state,onSelect}:{state:AppState;onSelect:(id:string)=>void}) {
  const [listing,setListing]=useState<Listing>(),[root,setRoot]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const receive=(value:Listing)=>{setListing(value);setRoot(value.root===value.defaultRoot?'':value.root);};
  const refresh=()=>api<Listing>('worktrees/list').then(receive).catch(e=>setError(errorText(e)));
  useEffect(()=>{let live=true;void api<Listing>('worktrees/list').then(value=>{if(live)receive(value);}).catch(e=>{if(live)setError(errorText(e));});return()=>{live=false;};},[]);
  const save=async(settings:{autoDelete?:boolean;limit?:number}={})=>{if(busy)return;setBusy(true);setError('');try{receive(await api<Listing>('worktrees/configure',{root:root.trim(),...settings}));}catch(e){setError(errorText(e));}finally{setBusy(false);}};
  return <section className="settings-section worktree-settings" data-testid="worktree-settings">
    <div className="settings-card"><div className="settings-action-row"><span><strong>工作树根目录</strong><small>留空使用默认目录；仅影响之后创建的工作树。</small></span><div className="worktree-root"><input aria-label="工作树根目录" value={root} placeholder={listing?.defaultRoot} disabled={busy} onChange={e=>setRoot(e.target.value)}/><button className="button secondary" disabled={busy||!listing} onClick={()=>void save()}>保存</button></div></div></div>
    <div className="settings-card worktree-cleanup-card"><Toggle label="自动清理工作树" description="清理前保存可恢复副本。" checked={listing?.autoDelete??false} onChange={autoDelete=>void save({autoDelete})}/><div className="worktree-retention-row"><label className="worktree-retention"><span>保留数量</span><input aria-label="保留工作树数量" type="number" min={1} max={100} value={listing?.limit??15} disabled={busy} onChange={e=>setListing(old=>old?{...old,limit:Number(e.target.value)}:old)} onBlur={()=>void save({limit:listing?.limit??15})}/></label><button className="text-button" disabled={busy||!listing?.autoDelete} onClick={async()=>{setBusy(true);setError('');try{await api('worktrees/cleanup');await refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}}}>立即清理</button></div></div>{error&&<p className="inline-error" role="alert">{error}</p>}
    <div className="worktree-list-heading"><h2>工作树</h2><button className="icon-button" aria-label="刷新工作树" onClick={()=>void refresh()}><Icon name="refresh" size={15}/></button></div>
    <div className="settings-card">{listing?.records.length?listing.records.map(record=>{
      const sessions=state.sessions.filter(session=>session.worktree?.id===record.id);
      return <div className="worktree-row" key={record.id}><Icon name="branch" size={16}/><div><strong>{sessions[0]?.title??'独立工作树'}</strong><small title={record.path}>{record.path}</small><small>{record.status==='archived'?'已清理 · 可恢复':record.status==='missing'?'目录已不存在':record.status==='failed'?'创建未完成 · 文件已保留':'独立检出'} · {record.head.slice(0,8)}</small></div>{record.archiveError&&<small className="inline-error">清理未完成，文件已保留</small>}{record.status==='archived'&&<button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await api('worktrees/restore',{id:record.id});await refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}}}>恢复工作树</button>}{sessions[0]&&<button className="text-button" onClick={()=>onSelect(sessions[0]!.id)}>打开聊天</button>}<button className="icon-button" aria-label="打开工作树目录" disabled={record.status==='missing'||record.status==='archived'} onClick={()=>void api('worktrees/open',{id:record.id}).catch(e=>setError(errorText(e)))}><Icon name="folder" size={16}/></button></div>;
    }):<p className="settings-empty">从消息或会话菜单选择“在新工作树中创建分支”后，将显示在这里。</p>}</div>
    <p className="worktree-help">仅清理本工作台管理的工作树，置顶、运行中和待确认会话受保护。副本包含未提交、未跟踪及忽略文件；无法完整保存时不清理。</p>
  </section>;
}
