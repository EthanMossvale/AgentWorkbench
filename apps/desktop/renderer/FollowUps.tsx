import {AnnotationCapsule} from './ContextAnnotations';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {AppState,Session} from '../../../packages/contracts';
import {coreFollowUpModes,type FollowUpEntry} from '../../../packages/session-core/follow-ups';
import {useUiPreference,uiPreferences} from './ui-preferences';
import {api} from './App';
import {AttachmentList} from './Attachments';
import {Icon,Modal} from './ui';
import './FollowUps.css';

export function FollowUpSettings({state}:{state:AppState}){
  const [mode,setMode]=useUiPreference<string>('composer.follow-up'),id=useId();
  const modes=state.followUpModes??coreFollowUpModes,missing=!modes.some(item=>item.id===mode);
  return <section className="settings-section general-settings follow-up-settings" data-workbench-follow-up-settings><h2>编辑器</h2><div className="settings-card"><div className="settings-action-row">
    <span><strong>跟进处理方式</strong><small>运行中排队等待，或直接引导。Ctrl+Enter 对本条消息反向处理。</small>{missing&&<small role="status">扩展不可用，暂用引导；已保留你的选择。</small>}</span>
    <div className="follow-up-choice"><div className="skill-tabs follow-up-tabs" role="tablist" aria-label="跟进处理方式">{modes.map((item,index)=><button type="button" key={item.id} id={id+'-'+index} role="tab" aria-selected={item.id===(missing?'steer':mode)} tabIndex={item.id===(missing?'steer':mode)?0:-1} title={item.description} onClick={()=>setMode(item.id)} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?modes.length-1:(index+(event.key==='ArrowRight'?1:-1)+modes.length)%modes.length;setMode(modes[next]!.id);document.getElementById(id+'-'+next)?.focus();}}>{item.label}</button>)}</div>{mode!=='steer'&&<button className="icon-button follow-up-reset" aria-label="恢复默认引导" title="恢复默认引导" onClick={()=>{const saved=uiPreferences.get('composer.follow-up');void uiPreferences.reset('composer.follow-up',saved.revision).catch(()=>{});}}><Icon name="refresh" size={13}/></button>}</div>
  </div></div></section>;
}

function QueueRow({item,session,canSteer,busy,action,inspect}:{item:FollowUpEntry;session:Session;canSteer:boolean;busy:boolean;action:(method:string,id:string)=>Promise<void>;inspect:()=>void}){
  const [menu,setMenu]=useState(false),[position,setPosition]=useState({top:0,left:0}),[mode,setMode]=useUiPreference<string>('composer.follow-up'),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),popup=useRef<HTMLDivElement>(null);
  const editable=['queued','paused'].includes(item.status),status=item.status==='paused'?'已暂停':item.status==='sending'?'发送中':item.status==='uncertain'?'待确认':'';
  const close=()=>{setMenu(false);trigger.current?.focus();};
  useLayoutEffect(()=>{if(!menu||!trigger.current||!popup.current)return;const anchor=trigger.current.getBoundingClientRect(),box=popup.current.getBoundingClientRect();setPosition({top:Math.max(8,anchor.top-box.height-4),left:Math.max(8,Math.min(anchor.right-box.width,window.innerWidth-box.width-8))});popup.current.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();},[menu]);
  useEffect(()=>{if(!menu)return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)&&!popup.current?.contains(event.target as Node))setMenu(false);};const dismiss=()=>setMenu(false);document.addEventListener('pointerdown',outside);window.addEventListener('resize',dismiss);return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',dismiss);};},[menu]);
  const label=item.preview.original.trim()||item.preview.attachments?.map(a=>a.name).join('、')||item.preview.skills?.map(s=>s.name).join('、')||'排队消息';
  return <div className="follow-up-row" data-follow-up-id={item.id} ref={root}>
    <Icon name={item.error||session.followUpError?'alert':'layers'} size={13}/><button className="follow-up-text" title={label} onClick={inspect}>{label}</button>
    {status&&<span className="follow-up-status" role="status" title={item.error}>{status}</span>}
    {editable&&<><button className="follow-up-send" disabled={busy||session.status==='uncertain'||session.status==='running'&&!canSteer} title={session.status==='running'?'现在引导当前任务':'发送这条排队消息'} onClick={()=>void action('follow-up/send',item.id)}><Icon name="arrow" size={12}/>{session.status==='running'?'引导':'发送'}</button><button className="icon-button" aria-label="移除排队消息" title="移除" disabled={busy} onClick={()=>void action('follow-up/cancel',item.id)}><Icon name="trash" size={13}/></button></>}
    <button ref={trigger} className="icon-button" aria-label="排队消息操作" title="更多" aria-haspopup="menu" aria-expanded={menu} onClick={()=>setMenu(value=>!value)}><Icon name="more" size={15}/></button>
    {menu&&createPortal(<div ref={popup} style={position} className="follow-up-menu" data-workbench-follow-up-menu role="menu" aria-label="排队消息操作" onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();}else if(event.key==='Tab')setMenu(false);else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const nodes=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]')],index=nodes.indexOf(document.activeElement as HTMLButtonElement);nodes[event.key==='Home'?0:event.key==='End'?nodes.length-1:(index+(event.key==='ArrowDown'?1:-1)+nodes.length)%nodes.length]?.focus();}}}>
      <button role="menuitem" onClick={()=>{close();inspect();}}><Icon name="document" size={14}/>查看完整消息</button>
      <button role="menuitem" onClick={()=>{close();setMode(mode==='queue'?'steer':'queue');}}><Icon name="layers" size={14}/>{mode==='queue'?'默认使用引导':'默认使用排队'}</button>
    </div>,document.body)}
  </div>;
}

export function FollowUpQueue({session,canSteer,report,refresh}:{session:Session;canSteer:boolean;report:(e:unknown)=>void;refresh:()=>Promise<unknown>}){
  const [busy,setBusy]=useState(''),[viewing,setViewing]=useState<string>();
  const action=async(method:string,id:string)=>{if(busy)return;setBusy(id);try{await api(method,{sessionId:session.id,id});await refresh();}catch(e){report(e);}finally{setBusy('');}};
  if(!session.followUps?.length)return null;
  const viewed=session.followUps.find(item=>item.id===viewing);
  return <div className="follow-up-queue" data-workbench-follow-up-queue data-session-id={session.id} aria-label="排队消息">
    {session.followUpError&&<div className="follow-up-storage-error" role="alert" title={session.followUpError}><Icon name="alert" size={13}/><span>{session.followUpError}</span></div>}
    <div className="follow-up-list">{session.followUps.map(item=><QueueRow key={item.id} item={item} session={session} canSteer={canSteer} busy={!!busy} action={action} inspect={()=>setViewing(item.id)}/>)}</div>
    {viewed&&createPortal(<div data-workbench-follow-up-detail><Modal title="排队消息" className="follow-up-detail" onClose={()=>setViewing(undefined)}><pre>{viewed.preview.original}</pre><AnnotationCapsule items={viewed.preview.annotations??[]} sessionId={viewed.preview.id+':queue'}/><AttachmentList items={viewed.preview.attachments??[]}/>{viewed.error&&<p role="status">{viewed.error}</p>}</Modal></div>,document.body)}
  </div>;
}
