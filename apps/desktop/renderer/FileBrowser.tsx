import {useUiPreference} from './ui-preferences';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { FileView } from '../host/file-browser';
import { fileReference, isShortFileReference, type FileReference, type LinkedText } from '../../../packages/navigation/file-links';
import type { FileResolutionResult } from '../../../packages/navigation/file-resolution';
import { api } from './App';
import { Icon, errorText } from './ui';
import { LinkMenu, type LinkActions } from './MessageText';
import type { PreviewViews } from './CodePreview';
import ProjectFileTree from './ProjectFileTree';
import SelectMenu from './SelectMenu';
import './FileBrowser.css';
import HtmlPreview from './HtmlPreview';
const CodePreview = lazy(() => import('./CodePreview'));
const filename = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
const pathKey = (path:string) => /^[a-z]:/i.test(path)?path.replaceAll('\\','/').replace(/\/$/,'').toLowerCase():path.replace(/\/$/,'');
const contains = (root:string,target:string) => pathKey(target)===pathKey(root)||pathKey(target).startsWith(pathKey(root)+'/');
export interface FileBrowserBackend {
 label:string;placeholder:string;
 browse(path:string):Promise<FileView>;
 peek?(path:string):FileView|undefined;
 subscribe?(listener:(path:string,view?:FileView,error?:unknown)=>void):()=>void;
 prefetch?(path:string):void;
 invalidate?():void;
 controls(view:FileView|null,refresh:(path?:string)=>void):React.ReactNode;
 menu(path:string,x:number,y:number,close:()=>void,refresh:(path?:string)=>void,directory?:boolean):React.ReactNode;
}

export default function FileBrowser({ reference, roots = [], onClose, backend, active = true, ...actions }: { reference: FileReference; roots?: string[]; onClose: () => void;backend?:FileBrowserBackend; active?:boolean } & Omit<LinkActions,'openFile'> & Partial<Pick<LinkActions,'openFile'>>) {
  const [view,setView]=useState<FileView|null>(null), [location,setLocation]=useState(reference.path), [filter,setFilter]=useState('');
  const [tabs,setTabs]=useState<FileView[]>([]), [root,setRoot]=useState(''), [treeRefresh,setTreeRefresh]=useState(0);
  const savedViews=useRef<PreviewViews>(new Map());
  const [sourceOnly,setSourceOnly]=useUiPreference<boolean>('reader.source-only');
  const [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const [choices,setChoices]=useState<Extract<FileResolutionResult,{status:'ambiguous'|'incomplete'}>|null>(null);
  const [menu,setMenu]=useState<{item:LinkedText;x:number;y:number;mode?:'all'|'open';directory?:boolean}|null>(null);
  const panel=useRef<HTMLElement>(null), sequence=useRef(0), lastReference=useRef('');
  useEffect(()=>{if(!active){setMenu(null);return;}const previous=document.activeElement as HTMLElement|null;panel.current?.focus({preventScroll:true});return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};},[active]);
  const chooseRoot=(path:string,parent:string)=>[...roots].sort((a,b)=>b.length-a.length).find(folder=>contains(folder,path))??parent;
  const browse=async(target:FileReference,asRoot=false)=>{
    const request=++sequence.current;const cached=backend?.peek?.(target.path);setBusy(!cached);setError('');setChoices(null);setLocation(target.path);setView(cached??null);
    if(!target.path&&!actions.sessionId){setBusy(false);return;}
    try{
      if(!backend&&isShortFileReference(target.path)){
        const resolution=await api<FileResolutionResult>('files/resolve',{sessionId:actions.sessionId,path:target.path?target.path+(target.line?':'+target.line:''):undefined});
        if(sequence.current!==request)return;
        if(resolution.status!=='resolved'){setChoices(resolution);return;}
        target={path:resolution.path,line:resolution.line??target.line};
      }
      const next=await (backend?backend.browse(target.path):api<FileView>('files/browse',{sessionId:actions.sessionId,path:target.path?target.path+(target.line?':'+target.line:''):undefined}));
      if(sequence.current!==request)return;
      setView(next);setLocation(next.path);
      if(next.kind==='directory'){setRoot(next.path);setFilter('');}
      else{setTabs(current=>current.some(tab=>tab.path===next.path)?current.map(tab=>tab.path===next.path?next:tab):[...current,next]);if(asRoot||!root||!contains(root,next.path))setRoot(chooseRoot(next.path,next.parent));}
    }catch(e){if(sequence.current===request)setError(errorText(e));}
    finally{if(sequence.current===request)setBusy(false);}
  };
  useEffect(()=>{const key=JSON.stringify([reference.path,reference.line,actions.sessionId]);if(active){void browse(lastReference.current!==key?reference:view?{path:view.path,line:view.line}:reference,true);lastReference.current=key;}return()=>{sequence.current++;};},[reference.path,reference.line,actions.sessionId,active]);
  useEffect(()=>{if(!active)return;return backend?.subscribe?.((path,next,error)=>{if(path!==view?.path)return;if(error){setError(errorText(error));return;}if(next){setView(next);setError('');}});},[backend?.subscribe,view?.path,active]);
  const fileActions={...actions,openFile:(target:FileReference)=>{void browse(target);}};
  const showMenu=(path:string,x:number,y:number,mode?:'all'|'open',directory?:boolean)=>setMenu({item:{text:path,reference:{path,...(view?.path===path&&view.line?{line:view.line}:{})}},x,y,mode,directory:directory??(view?.path===path?view.kind==='directory':undefined)});
  const pickFolder=()=>backend?void browse({path:'/'}):void api<string|null>('project/pick').then(target=>{if(target)void browse({path:target});}).catch(actions.report);
  const refresh=(path?:string)=>{backend?.invalidate?.();setTreeRefresh(value=>value+1);const target=path??view?.path??reference.path;void browse({path:target,line:target===view?.path?view.line:undefined});};
  const rootOptions=[...new Map([...roots,...(root?[root]:[])].map(folder=>[pathKey(folder),folder])).values()];
  const showDirectory=()=>{if(root)void browse({path:root});};
  const closeBrowser=()=>{sequence.current++;setTabs([]);savedViews.current.clear();setView(root?{path:root,parent:root,kind:'directory'}:null);setMenu(null);setChoices(null);setError('');setBusy(false);onClose();};
  const closeTab=(path:string)=>{
    const remaining=tabs.filter(tab=>tab.path!==path);setTabs(remaining);savedViews.current.delete(path);
    if(view?.path===path||location===path){
      sequence.current++;setBusy(false);setError('');setChoices(null);
      const next=remaining.at(-1);
      if(next){setView(next);setLocation(next.path);setRoot(chooseRoot(next.path,next.parent));}
      else{setView(null);showDirectory();}
    }
  };
  const selectedFile=view&&view.kind!=='directory'?view:null;
  return <aside className="file-browser file-dock" aria-label={backend?.label??'文件浏览器'} data-testid="file-dock" ref={panel} tabIndex={-1} onKeyDown={event=>{if(event.key==='Escape'&&!menu){event.stopPropagation();closeBrowser();}}}>
    <header className="file-dock-header"><div className="file-dock-tabs" role="tablist" aria-label="文件标签页">
      <div className="file-tab-group"><button className="file-dock-tab" role="tab" aria-selected={!selectedFile} onClick={showDirectory}><Icon name="folder" size={14}/><span>文件</span></button><button className="file-tab-close" aria-label="关闭文件面板" title="关闭全部预览并退出文件浏览器" onClick={closeBrowser}><Icon name="close" size={12}/></button></div>
      {tabs.map(tab=><div className="file-tab-group" key={tab.path}><button className="file-dock-tab" role="tab" aria-selected={view?.path===tab.path} title={tab.path} onClick={()=>{if(backend){void browse({path:tab.path});return;}sequence.current++;setBusy(false);setError('');setView({...tab,line:undefined});setLocation(tab.path);if(!contains(root,tab.path))setRoot(chooseRoot(tab.path,tab.parent));}}><Icon name="document" size={14}/><span>{filename(tab.path)}</span></button><button className="file-tab-close" aria-label={'关闭 '+filename(tab.path)} onClick={()=>closeTab(tab.path)}><Icon name="close" size={12}/></button></div>)}
    </div></header>
    <form className="file-location" onSubmit={event=>{event.preventDefault();void browse({path:location});}}>
      <button type="button" className="icon-button" aria-label="上一级目录" disabled={!view||view.parent===view.path} onClick={()=>void browse({path:view!.parent})}><Icon name="arrow" size={16}/></button>
      <input aria-label="文件路径" value={location} onChange={event=>setLocation(event.target.value)} placeholder={backend?.placeholder??'输入本机绝对路径'}/>
      <button className="icon-button" aria-label="前往路径"><Icon name="chevron" size={15}/></button>
      <button type="button" className="icon-button" aria-label="选择目录" onClick={pickFolder}><Icon name="folder" size={15}/></button>
      <button type="button" className="icon-button" aria-label="刷新文件" disabled={!view||busy} onClick={()=>refresh(view!.path)}><Icon name="refresh" size={15}/></button>
    </form>
    <div className="file-dock-actions"><SelectMenu label="项目文件夹" testId="file-root-selector" value={root} options={rootOptions.map(folder=>({value:folder,label:filename(folder),description:folder,icon:'folder'}))} onChange={folder=>void browse({path:folder})} placeholder="选择文件夹" icon="folder" disabled={!rootOptions.length}/>
      <button className="icon-button" aria-label="复制文件路径" disabled={!view||busy||!!error} onClick={()=>void api('clipboard/write',{text:view!.path}).then(()=>actions.notify('已复制路径')).catch(actions.report)}><Icon name="copy" size={15}/></button>
      <div className="file-open-button">{!backend&&<button disabled={!view||busy||!!error} onClick={()=>void api('files/open',{sessionId:actions.sessionId,path:view!.path,target:'default'}).catch(actions.report)}><Icon name="desktop" size={14}/><span>打开</span></button>}<button aria-label="文件操作" aria-haspopup="menu" disabled={!view||busy||!!error} onClick={event=>{const box=event.currentTarget.getBoundingClientRect();showMenu(view!.path,box.right-220,box.bottom+4,'open');}}><Icon name="chevron-down" size={12}/></button></div>
    </div>
    {backend?.controls(busy||error?null:view,refresh)}
    <div className={'file-dock-body '+(selectedFile?'has-preview':'')} aria-busy={busy}>
      <div className={'file-browser-content file-preview '+(view?.kind==='text'?'is-code':'')} data-testid="file-browser-content">
        {busy&&<p role="status">读取中…</p>}{error&&<p className="inline-error" role="alert">{error}</p>}
        {choices&&<section className="file-resolution-choices" data-workbench-file-candidates aria-label="匹配的文件"><p role="status">{choices.message}</p>{choices.candidates.map(candidate=><button type="button" className="file-resolution-candidate" key={candidate} onClick={()=>void browse({path:candidate,line:fileReference(choices.requested)?.line})}><Icon name="document" size={15}/><span>{candidate}</span></button>)}</section>}
        {!busy&&!error&&!choices&&!view&&<div className="file-dock-empty"><Icon name="folder" size={28}/><p>选择文件夹，浏览本机文件</p><button className="button secondary" onClick={pickFolder}>选择文件夹</button></div>}
        {view?.kind==='text'&&!error&&(/\.html?$/i.test(view.path)&&!sourceOnly&&!view.line&&!backend?<HtmlPreview sessionId={actions.sessionId} path={view.path} content={view.content!} onSource={()=>setSourceOnly(true)}/>:<><Suspense fallback={<p role="status">正在打开代码…</p>}><CodePreview path={view.path} content={view.content!} line={view.line} savedViews={savedViews.current}/></Suspense>{/\.html?$/i.test(view.path)&&!backend&&<button className="text-button" onClick={()=>{setSourceOnly(false);setView(current=>current?{...current,line:undefined}:current);}}>返回 HTML 预览</button>}</>)}
        {view?.kind==='unsupported'&&!error&&<p>{backend?'此文件为二进制、非 UTF-8 文本或超过 1 MB，可使用上方“下载”保存到本机。':'此文件为二进制、非 UTF-8 文本或超过 1 MB，可使用上方的“打开”菜单。'}</p>}
      </div>
      {root&&<section className="file-explorer" aria-label="项目目录"><div className="file-browser-tools"><Icon name="search" size={14}/><input aria-label="筛选文件" placeholder="筛选文件…" value={filter} onChange={event=>setFilter(event.target.value)}/></div><ProjectFileTree root={root} sessionId={actions.sessionId} selected={selectedFile?.path} filter={filter} refresh={treeRefresh} open={fileActions.openFile} menu={(path,x,y,directory)=>showMenu(path,x,y,undefined,directory)} browse={backend?.browse} peek={backend?.peek} subscribe={backend?.subscribe} prefetch={backend?.prefetch} active={active}/></section>}
    </div>
    {menu&&(backend?backend.menu(menu.item.reference!.path,menu.x,menu.y,()=>setMenu(null),refresh,menu.directory):<LinkMenu {...menu} actions={fileActions} onClose={()=>setMenu(null)}/>)}
  </aside>;
}
