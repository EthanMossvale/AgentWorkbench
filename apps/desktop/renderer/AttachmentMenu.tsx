import {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './ui';
import type {Attachment} from '../../../packages/attachments/types';
import {attachmentActions,type AttachmentActionSurface,type AttachmentMenuAction} from './attachment-actions';
export type {AttachmentMenuAction} from './attachment-actions';
import './AttachmentMenu.css';

export default function AttachmentMenu({x,y,item,surface,busy=false,actions:base,onClose,onError}: {
  x:number; y:number; item:Attachment; surface:AttachmentActionSurface; busy?:boolean; actions:AttachmentMenuAction[];
  onClose:()=>void; onError:(error:unknown)=>void;
}) {
  useSyncExternalStore(attachmentActions.subscribe,attachmentActions.getSnapshot);
  const actions=attachmentActions.resolve(item,surface,base,busy);
  const panel=useRef<HTMLDivElement>(null), close=useRef(onClose);close.current=onClose;
  const [position,setPosition]=useState({left:x,top:y});
  useLayoutEffect(()=>{
    const box=panel.current!.getBoundingClientRect();
    setPosition({left:Math.max(8,Math.min(x,innerWidth-box.width-8)),top:Math.max(8,Math.min(y,innerHeight-box.height-8))});
  },[x,y,actions.length]);
  useEffect(()=>{
    const before=document.activeElement as HTMLElement|null;
    panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
    const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node)){close.current();if(event.button===0){event.preventDefault();event.stopPropagation();}}};
    const dismiss=()=>close.current();
    const scroll=(event:Event)=>{if(!panel.current?.contains(event.target as Node))dismiss();};
    // Streaming output or a status message must not dismiss an open menu.
    window.addEventListener('pointerdown',outside,true);window.addEventListener('resize',dismiss);window.addEventListener('blur',dismiss);document.addEventListener('wheel',scroll,true);document.addEventListener('touchmove',scroll,true);
    return()=>{window.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',dismiss);window.removeEventListener('blur',dismiss);document.removeEventListener('wheel',scroll,true);document.removeEventListener('touchmove',scroll,true);if(before?.isConnected)before.focus({preventScroll:true});};
  },[]);
  return createPortal(<div ref={panel} className="attachment-context-menu" role="menu" aria-label="附件操作" style={position}
    onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()}
    onContextMenu={event=>{event.preventDefault();event.stopPropagation();}}
    onKeyDown={event=>{
      event.stopPropagation();
      if(event.key==='Escape'||event.key==='Tab'){event.preventDefault();onClose();return;}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();const buttons=[...panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];if(!buttons.length)return;
        const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
      }
    }}>
    <div className="attachment-context-name" title={item.name}>{item.name}</div>
    <div className="attachment-context-actions" data-attachment-id={item.id} data-attachment-surface={surface}>{actions.map((action,index)=><div key={action.id}>{action.divider&&index>0&&<div role="separator" className="attachment-context-separator"/>}<button type="button" role="menuitem" aria-keyshortcuts={action.shortcut?.replace('Ctrl+','Control+').replace('Esc','Escape')} disabled={action.disabled} onClick={()=>{onClose();void Promise.resolve().then(action.run).catch(onError);}}>{action.icon&&<Icon name={action.icon} size={15}/>}<span>{action.label}</span>{action.shortcut&&<kbd aria-hidden="true">{action.shortcut}</kbd>}</button></div>)}</div>
  </div>,document.body);
}
