import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TurnFileChanges } from '../../../packages/collaboration-core/file-changes';
import { ChangeCounts, displayChangePath } from './file-change-display';
import { Icon } from './ui';

export default function FileChangeCapsule({changes,sessionId,cwd,roots,onReview}:{changes:TurnFileChanges;sessionId?:string;cwd?:string;roots:string[];onReview(path:string):void}) {
  const [open,setOpen] = useState(false), [position,setPosition] = useState({left:0,top:0});
  const anchor = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), id = useId();
  const files = changes.files, known = files.every(file => file.additions !== null && file.deletions !== null);
  const close = (restore = false) => { setOpen(false); if (restore) anchor.current?.focus({preventScroll:true}); };
  useEffect(() => { if (!open) return;
    const outside = (e: Event) => { if (e.target instanceof Node && !anchor.current?.contains(e.target) && !panel.current?.contains(e.target)) close(); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } };
    document.addEventListener('pointerdown',outside); document.addEventListener('focusin',outside); window.addEventListener('keydown',escape);
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
    return () => { document.removeEventListener('pointerdown',outside); document.removeEventListener('focusin',outside); window.removeEventListener('keydown',escape); };
  },[open]);
  useLayoutEffect(() => { if (!open) return;
    const place = () => { const a = anchor.current?.getBoundingClientRect(), p = panel.current?.getBoundingClientRect(); if (!a || !p) return;
      if (!a.width || !a.height) { close(); return; }
      setPosition({left:Math.max(10,Math.min(innerWidth-p.width-10,a.left+a.width/2-p.width/2)),top:Math.max(10,Math.min(innerHeight-p.height-10,a.top-p.height-8))});
    };
    place(); const observer = new ResizeObserver(place); if (anchor.current) observer.observe(anchor.current); if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize',place); window.addEventListener('scroll',place,true);
    return () => { observer.disconnect(); window.removeEventListener('resize',place); window.removeEventListener('scroll',place,true); };
  },[open]);
  return <div className="file-change-capsule-container" data-file-change-capsule data-session-id={sessionId} data-turn-id={changes.id}>
    <button ref={anchor} type="button" className="file-change-capsule" aria-label={`查看本轮 ${files.length} 个已更改文件`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?id:undefined} title="本轮已完成的文件修改，行数按修改累计" onClick={() => setOpen(!open)}>
      <span>{files.length} 个文件已更改</span>{known && <ChangeCounts added={files.reduce((n,f)=>n+f.additions!,0)} removed={files.reduce((n,f)=>n+f.deletions!,0)}/>}<Icon name="chevron-down" size={12}/>
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label="本轮已更改文件" className="file-change-popover" data-file-change-list data-session-id={sessionId} data-turn-id={changes.id} style={position} onKeyDown={e => {
      if (!['ArrowDown','ArrowUp','Home','End'].includes(e.key)) return; e.preventDefault();
      const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
    }}><header><strong>本轮文件修改</strong><small>点击文件查看差异</small></header><div className="change-file-list">{files.map(file => <button key={file.path} title={file.path} onClick={() => { close(true); onReview(file.path); }}><span className="change-file-path">{displayChangePath(file.path,cwd,roots)}</span><ChangeCounts added={file.additions} removed={file.deletions}/></button>)}</div>{changes.truncated && <p className="change-card-note">文件记录已截断，以上不是完整列表。</p>}</div>,document.body)}
  </div>;
}
