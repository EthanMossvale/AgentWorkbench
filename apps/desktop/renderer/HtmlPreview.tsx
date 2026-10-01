import { useEffect, useState } from 'react';
import { api } from './App';
import { Icon, errorText } from './ui';
/** Opaque-origin artifact document, isolated from the Workbench preload and host API. */
export default function HtmlPreview({path,sessionId,onSource}:{content:string;path:string;sessionId?:string;onSource:()=>void}){
  const [revision,setRevision]=useState(0),[url,setUrl]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let active=true;setUrl('');setError('');void api<{url:string}>('html/preview',{path,sessionId}).then(result=>{if(active)setUrl(result.url);}).catch(e=>{if(active)setError(errorText(e));});return()=>{active=false;};},[path,sessionId,revision]);
  return <div className="html-preview" data-testid="html-preview"><div className="html-preview-toolbar"><Icon name="globe" size={14}/><span title={path}>HTML 预览</span><button className="text-button" onClick={onSource}>查看源码</button><button className="icon-button" title="重新载入预览" aria-label="重新载入预览" onClick={()=>setRevision(value=>value+1)}><Icon name="refresh" size={14}/></button><small title="支持页面脚本、样式与同目录资源；网络、弹窗和系统权限关闭。">隔离页面</small></div>{error?<p role="alert">{error}</p>:url?<iframe title="HTML 页面预览" sandbox="allow-scripts" referrerPolicy="no-referrer" src={url}/>:<p role="status">正在打开页面…</p>}</div>;
}
