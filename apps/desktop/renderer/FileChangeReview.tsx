import {useUiPreference} from './ui-preferences';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { TurnFileChanges } from '../../../packages/collaboration-core/file-changes';
import { diffLines, splitDiffLines, type DiffLine } from '../../../packages/collaboration-core/diff-view';
import { fileReviewController } from './file-review-controller';
import { mountPluginContent } from './plugin-lifecycle';
import { ChangeCounts, displayChangePath } from './file-change-display';
import { Icon } from './ui';
import {LinkMenu,type LinkActions} from './MessageText';

function Diff({diff,split}:{diff:string;split:boolean}) {
  const lines = useMemo(() => diffLines(diff),[diff]), rows = useMemo(() => splitDiffLines(lines),[lines]);
  const cell = (line: DiffLine | undefined, side: 'old'|'new') => <div className={'change-diff-cell diff-'+(line?.kind??'empty')}><span className="diff-number">{side==='old'?line?.oldLine:line?.newLine}</span><span className="diff-sign">{line?.kind==='added'?'+':line?.kind==='removed'?'−':''}</span><code>{line?.text || ' '}</code></div>;
  if (!lines.length) return <p className="change-review-note">原生补丁为空，没有可显示的差异。</p>;
  return <div className={'change-diff '+(split?'is-split':'is-unified')} aria-label="文件差异">{split ? rows.map((row,i) => row.meta ? <div className="diff-meta" key={i}>{row.meta.text}</div> : <div className="change-diff-pair" key={i}>{cell(row.left,'old')}{cell(row.right,'new')}</div>) : lines.map((line,i) => line.kind==='meta' ? <div className="diff-meta" key={i}>{line.text}</div> : <div key={i} className={'change-diff-line diff-'+line.kind}><span className="diff-number">{line.oldLine}</span><span className="diff-number">{line.newLine}</span><span className="diff-sign">{line.kind==='added'?'+':line.kind==='removed'?'−':''}</span><code>{line.text || ' '}</code></div>)}</div>;
}
function ExtensionView({view,file,sessionId,turnId}:{view:ReturnType<typeof fileReviewController.getViews>[number];file:TurnFileChanges['files'][number];sessionId:string;turnId:string}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!root.current || !view.render) return; return mountPluginContent({root:root.current,file:structuredClone(file),sessionId,turnId},view.render,view.failed ?? (()=>{})); },[view,file,sessionId,turnId]);
  return <div ref={root} className="change-review-extension"/>;
}
export default function FileChangeReview({changes,selectedPath,onSelect,onClose,onOpenFile,cwd,roots,sessionId,running,actions}:{changes:TurnFileChanges;selectedPath:string;onSelect(path:string):void;onClose():void;onOpenFile(path:string):void;cwd?:string;roots:string[];sessionId?:string;running:boolean;actions:LinkActions}) {
  const [query,setQuery] = useState(''), [viewId,setViewId] = useUiPreference<string>('reader.diff-view');
  const dock=useRef<HTMLElement>(null),[menu,setMenu]=useState<{path:string;x:number;y:number}|null>(null);
  useEffect(()=>{setQuery('');dock.current?.focus({preventScroll:true});},[sessionId,changes.id]);
  const onContext=(path:string,event:React.MouseEvent|React.KeyboardEvent)=>{event.preventDefault();event.stopPropagation();const box=event.currentTarget.getBoundingClientRect();setMenu({path,x:'clientX' in event?event.clientX:box.left,y:'clientY' in event?event.clientY:box.bottom});};
  const views = useSyncExternalStore(fileReviewController.subscribe,fileReviewController.getViews), view = views.find(item=>item.id===viewId) ?? views[0]!;
  const selected = changes.files.find(file=>file.path===selectedPath) ?? changes.files[0]!;
  const files = changes.files.filter(file=>(file.path+' '+(file.previousPath??'')).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const detail = useRef<HTMLDivElement>(null);
  const [narrow,setNarrow] = useState(false);
  useEffect(() => { const node = detail.current; if (!node) return; const observer = new ResizeObserver(() => setNarrow(node.clientWidth < 560)); observer.observe(node); return () => observer.disconnect(); },[]);
  useEffect(() => { detail.current?.scrollTo(0,0); },[selected.path]);
  const label = (path:string) => displayChangePath(path,cwd,roots);
  return <aside className="file-change-review" data-file-change-reader data-testid="file-change-reader" data-session-id={sessionId} data-turn-id={changes.id} aria-label="文件修改详情" tabIndex={-1} ref={dock} onKeyDown={event=>{if(event.key==='Escape'&&!menu){event.stopPropagation();onClose();}}}>
    <header className="change-reader-header"><strong>本轮文件修改</strong><button className="icon-button" aria-label="关闭文件审查面板" onClick={onClose}><Icon name="close" size={16}/></button></header>
    <div className="change-review-toolbar"><span>{changes.files.length} 个文件{running?' · 仍在进行':''}</span><label>差异显示<select aria-label="差异显示方式" value={view.id} onChange={e=>setViewId(e.target.value)}>{views.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
    <div className="change-review-body" data-file-change-review data-session-id={sessionId} data-turn-id={changes.id} data-file-path={selected.path}>
      <nav aria-label="修改的文件"><input aria-label="筛选修改的文件" placeholder="筛选文件…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="change-review-files">{files.map(file=><button key={file.path} aria-current={file.path===selected.path?'true':undefined} onClick={()=>onSelect(file.path)} onContextMenu={e=>onContext(file.path,e)} onKeyDown={e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10')onContext(file.path,e);}} title={file.path}><span>{label(file.path)}</span><ChangeCounts added={file.additions} removed={file.deletions}/></button>)}{!files.length&&<p className="change-review-note">没有匹配的文件。</p>}</div></nav>
      <section className="change-review-detail"><header><div><strong title={selected.path}>{label(selected.path)}</strong>{selected.previousPath&&<small>原路径：{label(selected.previousPath)}</small>}<ChangeCounts added={selected.additions} removed={selected.deletions}/></div><button className="text-button" onClick={()=>onOpenFile(selected.path)} onContextMenu={e=>onContext(selected.path,e)} onKeyDown={e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10')onContext(selected.path,e);}}>打开文件</button></header>
        <div className="change-patches" ref={detail} data-file-change-diff data-session-id={sessionId} data-turn-id={changes.id} data-file-path={selected.path} data-diff-view={view.id==='split'&&narrow?'unified':view.id}>
          {view.id==='split'&&narrow&&<p className="change-review-note">窗口较窄，暂用合并视图；放宽窗口后恢复并排。</p>}
          {view.render ? <ExtensionView view={view} file={selected} sessionId={sessionId??''} turnId={changes.id}/> : selected.patches.map((patch,index)=><section key={patch.activityId+':'+index} className="change-patch">{selected.patches.length>1&&<h3>第 {index+1} 次修改</h3>}{patch.diff!==undefined?<Diff diff={patch.diff} split={view.id==='split'&&!narrow}/>:<p className="change-review-note">原生工具已确认此文件修改，但未提供可显示的差异。</p>}{patch.truncated&&<p className="change-review-note">差异已截断，行数统计来自完整原生补丁。</p>}</section>)}
        </div>
      </section>
    </div>
    <footer className="change-review-footer">仅显示原生工具确认的修改；行数按本轮操作累计，不代表工作区净差异。{changes.truncated&&' 文件列表已截断。'}</footer>
    {menu&&<LinkMenu item={{text:menu.path,reference:{path:menu.path}}} x={menu.x} y={menu.y} actions={actions} onClose={()=>setMenu(null)}/>}
  </aside>;
}
