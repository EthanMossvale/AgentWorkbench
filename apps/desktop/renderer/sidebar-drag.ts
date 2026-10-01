import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { AppState, Project, Session } from '../../../packages/contracts';
import { orderedProjects } from '../../../packages/session-core/sidebar-order';
import { sidebarSessionScope, type SessionReorderRequest } from '../../../packages/session-core/sidebar-sessions';
import { api } from './App';

export function useSidebarDrag(state:AppState|null, dismiss:()=>void, notify:(text:string)=>void, report:(error:unknown)=>void) {
  const source=useRef<{type:'project'|'session';id:string;scope?:string}|null>(null);
  const [dragging,setDragging]=useState<typeof source.current>(null);
  const [target,setTarget]=useState<{type:'project'|'session';id:string;edge:'before'|'after'|'inside'}|null>(null);
  const finish=()=>{source.current=null;setDragging(null);setTarget(null);};
  useEffect(()=>{const cancel=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape')finish();};window.addEventListener('keydown',cancel);window.addEventListener('blur',finish);return()=>{window.removeEventListener('keydown',cancel);window.removeEventListener('blur',finish);};},[]);
  const start=(event:DragEvent,type:'project'|'session',id:string)=>{
    if(!(event.target as Element).closest(type==='project'?'.project-title':'.session-select')){event.preventDefault();return;}
    const session=state?.sessions.find(item=>item.id===id);
    event.stopPropagation();dismiss();source.current={type,id,...(type==='session'&&session?{scope:sidebarSessionScope(session)}:{})};setDragging(source.current);
    event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-agent-workbench-sidebar',JSON.stringify({type,id}));
  };
  const over=(event:DragEvent<HTMLElement>,project:Project)=>{
    const value=source.current;if(!value||!state)return;
    const from=value.type==='project'?orderedProjects(state).find(p=>p.id===value.id):undefined;
    if(value.type==='project'&&(!from||from.id===project.id||!!from.pinned!==!!project.pinned)){setTarget(null);event.dataTransfer.dropEffect='none';return;}
    event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';
    const heading=event.currentTarget.querySelector('.project-heading')?.getBoundingClientRect()??event.currentTarget.getBoundingClientRect();
    const edge=value.type==='session'?'inside':event.clientY<heading.top+heading.height/2?'before':'after';setTarget({type:'project',id:project.id,edge});
    const scroll=event.currentTarget.closest('.sidebar-scroll');if(scroll){const rect=scroll.getBoundingClientRect();if(event.clientY<rect.top+38)scroll.scrollTop-=12;else if(event.clientY>rect.bottom-38)scroll.scrollTop+=12;}
  };
  const move=async(id:string,project:Project)=>{await api('session/move-project',{id,projectId:project.id});notify(`已移到 ${project.name}，会话工作目录保持不变`);};
  const drop=async(event:DragEvent,project:Project)=>{
    if(!source.current||!target||target.type!=='project'||target.id!==project.id)return;
    event.preventDefault();event.stopPropagation();const value=source.current,edge=target.edge;finish();
    try{if(value.type==='session')await move(value.id,project);else if(edge!=='inside')await api('project/reorder',{id:value.id,targetId:project.id,edge});}catch(error){report(error);}
  };
  const reorder=async(request:SessionReorderRequest)=>{
    try{await api('session/reorder',request);}catch(error){
      const message=String(error);
      report(/SIDEBAR_(SESSION_(NOT_FOUND|ARCHIVED)|REORDER_SCOPE_CHANGED)/.test(message)?new Error('会话所在区域已变化，请刷新后重新排序。'):error);
    }
  };
  const overSession=(event:DragEvent<HTMLElement>,session:Session)=>{
    const value=source.current;if(value?.type!=='session')return;
    const current=state?.sessions.find(item=>item.id===value.id);
    // Other projects keep the existing move-to-project gesture. Same-section rows are anchors.
    if(!current||!value.scope||value.scope!==sidebarSessionScope(current)||session.archived){event.stopPropagation();setTarget(null);return;}
    if(sidebarSessionScope(session)!==value.scope){setTarget(null);return;}
    event.stopPropagation();
    if(session.id===value.id){setTarget(null);event.dataTransfer.dropEffect='none';return;}
    event.preventDefault();event.dataTransfer.dropEffect='move';
    const bounds=event.currentTarget.getBoundingClientRect();
    setTarget({type:'session',id:session.id,edge:event.clientY<bounds.top+bounds.height/2?'before':'after'});
    const scroll=event.currentTarget.closest('.sidebar-scroll');if(scroll){const rect=scroll.getBoundingClientRect();if(event.clientY<rect.top+38)scroll.scrollTop-=12;else if(event.clientY>rect.bottom-38)scroll.scrollTop+=12;}
  };
  const dropSession=async(event:DragEvent,session:Session)=>{
    if(source.current?.type!=='session'||target?.type!=='session'||target.id!==session.id)return;
    event.preventDefault();event.stopPropagation();
    const value=source.current,edge=target.edge;finish();
    if(value.scope&&edge!=='inside')await reorder({id:value.id,targetId:session.id,edge,scope:value.scope});
  };
  return {dragging,target,start,over,drop,finish,move,reorder,overSession,dropSession};
}
