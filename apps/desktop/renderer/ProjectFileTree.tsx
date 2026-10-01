import {useUiPreference} from './ui-preferences';
import { useEffect, useRef, useState } from 'react';
import type { FileView } from '../host/file-browser';
import type { FileReference } from '../../../packages/navigation/file-links';
import { api } from './App';
import { Icon, errorText } from './ui';
import type {FileBrowserBackend} from './FileBrowser';

interface Props { root: string; sessionId?: string; selected?: string; filter: string; refresh: number; open: (reference: FileReference) => void; menu: (path: string, x: number, y: number, directory?:boolean) => void; browse?:FileBrowserBackend['browse']; peek?:FileBrowserBackend['peek']; subscribe?:FileBrowserBackend['subscribe']; prefetch?:FileBrowserBackend['prefetch']; active?:boolean }
/** Lazy directory reads stay on this device; changing this tree never changes a session binding. */
export default function ProjectFileTree({root,sessionId,selected,filter,refresh,open,menu,browse,peek,subscribe,prefetch,active=true}: Props) {
  const [directories,setDirectories]=useState<Record<string,FileView>>({}), [expandedPaths,setExpandedPaths]=useUiPreference<string[]>('files.expanded',JSON.stringify([sessionId,root]));
  const expanded=new Set(expandedPaths);
  const setExpanded=(update:(previous:Set<string>)=>Set<string>)=>setExpandedPaths(previous=>[...update(new Set(previous))]);
  const [errors,setErrors]=useState<Record<string,string>>({}), [loading,setLoading]=useState<Set<string>>(new Set());
  const generation=useRef(0), pending=useRef(new Set<string>());
  const load=async(target:string)=>{
    if(pending.current.has(target))return;
    const token=generation.current;pending.current.add(target);const cached=peek?.(target);if(cached)setDirectories(current=>({...current,[target]:cached}));else if(!directories[target])setLoading(current=>new Set(current).add(target));
    setErrors(current=>{const next={...current};delete next[target];return next;});
    try{const view=await (browse?browse(target):api<FileView>('files/browse',{sessionId,path:target}));if(token===generation.current){if(view.kind!=='directory')throw Error('此目录已不可用。');setDirectories(current=>({...current,[target]:view}));}}
    catch(error){if(token===generation.current)setErrors(current=>({...current,[target]:errorText(error)}));}
    finally{if(token===generation.current){pending.current.delete(target);setLoading(current=>{const next=new Set(current);next.delete(target);return next;});}}
  };
  useEffect(()=>{if(!active)return;generation.current++;pending.current.clear();setDirectories({});setErrors({});setLoading(new Set());if(root)void load(root);return()=>{generation.current++;};},[root,sessionId,refresh]);
  useEffect(()=>{if(active&&root)void load(root);else {generation.current++;pending.current.clear();setLoading(new Set());}},[active]);
  useEffect(()=>{if(!active)return;return subscribe?.((path,view,error)=>{
    if(view?.kind==='directory')setDirectories(current=>current[path]?{...current,[path]:view}:current);
    if(error)setErrors(current=>directories[path]?{...current,[path]:errorText(error)}:current);
    else setErrors(current=>{const next={...current};delete next[path];return next;});
  });},[subscribe,active,directories]);
  useEffect(()=>{if(!active)return;const visible:string[]=[],visit=(target:string,depth:number)=>{if(depth>48)return;for(const entry of directories[target]?.entries??[])if(entry.directory&&expanded.has(entry.path)){if(directories[entry.path])visit(entry.path,depth+1);else if(!errors[entry.path])visible.push(entry.path);}};visit(root,0);for(const target of visible.slice(0,20))void load(target);},[root,active,directories,expandedPaths.join('\n')]);
  const toggle=(target:string)=>{setExpanded(current=>{const next=new Set(current);if(next.has(target))next.delete(target);else next.add(target);return next;});if(!expanded.has(target)&&(!directories[target]||browse))void load(target);};
  const render=(target:string,depth:number):React.ReactNode=>{
    const view=directories[target], entries=view?.entries?.filter(entry=>!filter||entry.directory||entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))??[];
    return <>{loading.has(target)&&<p className="file-tree-note" role="status">读取中…</p>}{errors[target]&&<div className="file-tree-note" role="alert">{errors[target]}<button className="text-button" onClick={()=>void load(target)}>重试</button></div>}
    {entries.map(entry=><div key={entry.path} className="file-tree-node"><button className={`file-tree-row ${selected===entry.path?'selected':''}`} style={{paddingLeft:8+depth*13}} aria-expanded={entry.directory?expanded.has(entry.path):undefined} title={entry.path} onMouseEnter={()=>{if(entry.directory)prefetch?.(entry.path);}} onFocus={()=>{if(entry.directory)prefetch?.(entry.path);}} onClick={()=>entry.directory?toggle(entry.path):open({path:entry.path})} onContextMenu={event=>{event.preventDefault();menu(entry.path,event.clientX,event.clientY,entry.directory);}} onKeyDown={event=>{
      if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const box=event.currentTarget.getBoundingClientRect();menu(entry.path,box.left,box.bottom,entry.directory);}
      if(entry.directory&&((event.key==='ArrowRight'&&!expanded.has(entry.path))||(event.key==='ArrowLeft'&&expanded.has(entry.path)))){event.preventDefault();toggle(entry.path);}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const rows=[...event.currentTarget.closest('.file-tree')!.querySelectorAll<HTMLButtonElement>('.file-tree-row')];rows[rows.indexOf(event.currentTarget)+(event.key==='ArrowDown'?1:-1)]?.focus();}
    }}>{entry.directory?<span className={expanded.has(entry.path)?'tree-arrow expanded':'tree-arrow'}><Icon name="chevron" size={11}/></span>:<span className="tree-arrow"/>}<Icon name={entry.directory?'folder':'document'} size={14}/><span>{entry.name}</span></button>{entry.directory&&expanded.has(entry.path)&&depth<48&&<div className="file-tree-children">{render(entry.path,depth+1)}</div>}</div>)}
    {view&&!entries.length&&<p className="file-tree-note">{filter?'没有匹配的文件':'此目录为空'}</p>}{view?.truncated&&<p className="file-tree-note">仅显示前 1000 项。</p>}</>;
  };
  return <div className="file-tree" aria-label="文件夹内容">{root?render(root,0):<p className="file-tree-note">请选择文件夹</p>}</div>;
}
