import {useUiPreference} from './ui-preferences';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TurnFileChanges } from '../../../packages/collaboration-core/file-changes';
import { Icon } from './ui';
import { LinkMenu, type LinkActions } from './MessageText';
import { ChangeCounts, displayChangePath } from './file-change-display';
import { fileReviewController } from './file-review-controller';
import FileChangeCapsule from './FileChangeCapsule';
import './FileChangeCard.css';

export default function FileChangeCard({changes,cwd,roots=[],running,dockTarget,onReview,onCloseReview,...actions}:{changes:TurnFileChanges;cwd?:string;roots?:string[];running:boolean;dockTarget?:HTMLElement|null;onReview(path:string):void;onCloseReview():void}&LinkActions) {
  const [expanded,setExpanded] = useUiPreference<boolean>('disclosure.open',JSON.stringify(['file-changes',actions.sessionId,changes.id]));
  const callbacks=useRef({onReview,onCloseReview});callbacks.current={onReview,onCloseReview};
  const [menu,setMenu] = useState<{path:string;x:number;y:number}|null>(null);
  const source = useRef<ReturnType<typeof fileReviewController.bind>>(undefined);
  useEffect(() => { if (!actions.sessionId) return;
    const handle = fileReviewController.bind({snapshot:{sessionId:actions.sessionId,turnId:changes.id,changes,running},open:path=>callbacks.current.onReview(path),close:()=>callbacks.current.onCloseReview()}); source.current = handle;
    return () => { handle.dispose(); source.current = undefined; };
  },[actions.sessionId,changes.id]);
  useEffect(() => { if (actions.sessionId) source.current?.update({sessionId:actions.sessionId,turnId:changes.id,changes,running}); },[changes,running,actions.sessionId]);
  const files = changes.files; if (!files.length) return null;
  const known = files.every(file=>file.additions!==null&&file.deletions!==null);
  const added = files.reduce((sum,file)=>sum+(file.additions??0),0), removed = files.reduce((sum,file)=>sum+(file.deletions??0),0);
  const context = (path:string,event:React.MouseEvent|React.KeyboardEvent) => { event.preventDefault(); event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect(); setMenu({path,x:'clientX' in event?event.clientX:box.left,y:'clientY' in event?event.clientY:box.bottom}); };
  const compact = running && dockTarget !== undefined;
  return <>
    {compact ? dockTarget && createPortal(<FileChangeCapsule changes={changes} sessionId={actions.sessionId} cwd={cwd} roots={roots} onReview={onReview}/>,dockTarget) : <section className="file-change-card" data-file-change-card data-testid="file-change-card" data-session-id={actions.sessionId} data-turn-id={changes.id} aria-label="本轮文件修改">
      <header><span className="change-card-icon"><Icon name="compose" size={18}/></span><div><strong>已修改 {files.length} 个文件</strong><div className="change-card-summary" title="增删行数按本轮已完成的工具修改累计">{known?<ChangeCounts added={added} removed={removed}/>:<small>部分行数未提供</small>}{running&&<small>仍在进行</small>}</div></div><button className="change-review-button" onClick={()=>onReview(files[0]!.path)}>审阅</button></header>
      <div className="change-file-list">{(expanded?files:files.slice(0,3)).map(file=><button key={file.path} title={file.path} onClick={()=>onReview(file.path)} onContextMenu={event=>context(file.path,event)} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')context(file.path,event);}}><span className="change-file-path">{displayChangePath(file.path,cwd,roots)}</span><ChangeCounts added={file.additions} removed={file.deletions}/></button>)}</div>
      {files.length>3&&<button className="change-expand" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'收起文件列表':`再显示 ${files.length-3} 个文件`}<Icon name="chevron-down" size={13}/></button>}
      {changes.truncated&&<p className="change-card-note">文件记录已截断，以上不是完整列表。</p>}
    </section>}
    {menu&&<LinkMenu item={{text:menu.path,reference:{path:menu.path}}} x={menu.x} y={menu.y} actions={actions} onClose={()=>setMenu(null)}/>}
  </>;
}
