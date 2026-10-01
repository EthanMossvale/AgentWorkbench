import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '../../../packages/contracts';
import { Icon } from './ui';

export default function ProjectPreview({project,count,attention,running,x,y,onEnter,onLeave,onClose,onEdit,onPin,onOpenFolder}:{project:Project;count:number;attention:number;running:number;x:number;y:number;onEnter:()=>void;onLeave:()=>void;onClose:()=>void;onEdit:()=>void;onPin:()=>void;onOpenFolder:(path:string)=>Promise<unknown>}) {
  const panel=useRef<HTMLDivElement>(null),paths=project.paths??(project.path?[project.path]:[]);
  const [opening,setOpening]=useState<string|null>(null),[error,setError]=useState('');
  const busy=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useLayoutEffect(()=>{const el=panel.current;if(!el)return;let left=x,top=y;const place=()=>{const bounds=el.getBoundingClientRect();left=Math.max(8,Math.min(left,window.innerWidth-bounds.width-8));top=Math.max(8,Math.min(top,window.innerHeight-bounds.height-8));el.style.left=`${left}px`;el.style.top=`${top}px`;};place();const resize=new ResizeObserver(place);resize.observe(el);return()=>resize.disconnect();},[x,y,project.id]);
  const openFolder=async(folder:string)=>{
    if(busy.current)return;busy.current=true;setOpening(folder);setError('');
    try{await onOpenFolder(folder);}catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'无法打开文件夹，请重试。');}
    finally{busy.current=false;if(mounted.current)setOpening(null);}
  };
  return createPortal(<div ref={panel} className="sidebar-project-preview" role="dialog" aria-label={`${project.name} 项目概览`} data-testid="project-preview" onMouseEnter={onEnter} onMouseLeave={onLeave} onFocusCapture={onEnter} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)&&!event.currentTarget.matches(':hover'))onLeave();else onEnter();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClose();}}}>
    <div data-workbench-project-preview data-project-id={project.id}>
    <header><Icon name="folder" size={15}/><strong>{project.name}</strong><button className="icon-button" aria-label={project.pinned?'取消置顶项目':'置顶项目'} aria-pressed={!!project.pinned} onClick={onPin}><Icon name="pin" size={14}/></button></header>
    <div className="project-preview-count"><Icon name="chat" size={14}/><span>{count} 个会话</span>{attention>0&&<span className="project-attention-count">{attention} 个待处理</span>}{running>0&&<span>{running} 个运行中</span>}</div>
    <div className="project-preview-folders" aria-busy={opening!==null}>{paths.length?paths.map(folder=><button type="button" className="project-preview-folder" key={folder} data-workbench-project-folder data-project-id={project.id} data-project-path={folder} aria-label={`打开文件夹 ${folder}`} title={folder} aria-disabled={opening!==null} onClick={()=>void openFolder(folder)}><Icon name="folder" size={14}/><span>{folder}</span><span className="project-preview-open" aria-hidden="true"><Icon name="arrow" size={13}/></span></button>):<p>尚未关联文件夹</p>}</div>
    {error&&<p className="project-preview-error" role="alert">{error}</p>}
    <button className="project-preview-edit" onClick={onEdit}><Icon name="settings" size={15}/><span>编辑项目</span></button>
    </div>
  </div>,document.body);
}
