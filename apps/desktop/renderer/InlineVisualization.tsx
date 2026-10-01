import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from './App';
import { uiPreferences, useUiPreference } from './ui-preferences';
import { visualizations, visualizationState, type VisualizationDocument, type VisualizationReference } from '../../../packages/visualizations';
import './InlineVisualization.css';

export default function InlineVisualization({reference,sessionId}:{reference:VisualizationReference;sessionId?:string}) {
  const [document,setDocument]=useState<VisualizationDocument>(),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{let live=true;setDocument(undefined);setError('');void api<VisualizationDocument>('visualizations/read',{sessionId,path:reference.path}).then(value=>{if(live)setDocument(value);}).catch(()=>{if(live)setError('无法读取展示文件。请确认文件仍在本机，且为 1 MB 以内的 UTF-8 HTML。');});return()=>{live=false;};},[sessionId,reference.path,reload]);
  return <section className="inline-visualization" data-workbench-visualization data-visualization-path={reference.path} data-visualization-mode={reference.mode??'normal'} onClick={event=>event.stopPropagation()}>
    {document?<VisualizationView key={JSON.stringify([sessionId,document.path,reload])} document={document} reference={reference} sessionId={sessionId} reload={()=>setReload(value=>value+1)}/>:<><div className="visualization-toolbar" data-workbench-visualization-toolbar><span>{reference.title||'交互展示'}</span><button type="button" onClick={()=>setReload(value=>value+1)}>重新载入</button></div><p className="visualization-status" role={error?'alert':'status'}>{error||'正在载入交互展示…'}</p></>}
  </section>;
}
function VisualizationView({document:source,reference,sessionId,reload}:{document:VisualizationDocument;reference:VisualizationReference;sessionId?:string;reload:()=>void}) {
  const scope=JSON.stringify([sessionId??'',source.path]);
  const [showSource,setShowSource]=useUiPreference<boolean>('visualization.source',scope);
  const [savedRenderer,setRenderer]=useUiPreference<string>('visualization.renderer',scope);
  const version=useSyncExternalStore(visualizations.subscribe,visualizations.getVersion);
  const preferenceVersion=useSyncExternalStore(uiPreferences.subscribe,uiPreferences.getVersion);
  const selected=uiPreferences.get('visualization.renderer',scope).saved?savedRenderer:reference.renderer??savedRenderer;
  const frame=useRef<HTMLIFrameElement>(null),channel=useRef(crypto.randomUUID());
  const [url,setUrl]=useState(''),[height,setHeight]=useState(240),[error,setError]=useState(''),[fallback,setFallback]=useState(false);
  const [dark,setDark]=useState(()=>document.documentElement.dataset.theme==='dark');
  const state=()=>visualizationState(uiPreferences.get('visualization.state',scope).value);
  const post=(data:Record<string,unknown>)=>frame.current?.contentWindow?.postMessage({channel:channel.current,...data},'*');
  const globals=()=>post({type:'globals',state:state(),dark});
  useEffect(()=>{const observer=new MutationObserver(()=>setDark(document.documentElement.dataset.theme==='dark'));observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();},[]);
  useEffect(()=>{globals();},[preferenceVersion,dark,url]);
  useEffect(()=>{
    const abort=new AbortController();let owned='';channel.current=crypto.randomUUID();setUrl('');setError('');
    void visualizations.render(source,reference,selected,abort.signal).then(async result=>{
      if(abort.signal.aborted)return;
      const page=await api<{url:string}>('visualizations/render',{html:result.html,channel:channel.current,state:state(),dark});
      owned=page.url;if(abort.signal.aborted){void api('visualizations/release',{url:owned}).catch(()=>{});return;}
      setFallback(result.fallback);setUrl(page.url);
    }).catch(()=>{if(!abort.signal.aborted)setError('交互展示未能载入，可查看源码或重新载入。');});
    return()=>{abort.abort();if(owned)void api('visualizations/release',{url:owned}).catch(()=>{});};
  },[source,selected,version]);
  useEffect(()=>{
    let live=true;
    const receive=(event:MessageEvent)=>{
      const data=event.data;
      if(event.source!==frame.current?.contentWindow||!data||data.channel!==channel.current)return;
      if(data.type==='height'&&Number.isFinite(data.height))setHeight(Math.max(160,Math.min(900,data.height)));
      else if(data.type==='ready')globals();
      else if(data.type==='error')setError('展示中的脚本发生错误；可以查看源码或重新载入。');
      else if(data.type==='blocked-navigation')setError('交互展示无法打开外部页面。');
      else if(data.type==='state'&&Number.isSafeInteger(data.id)&&data.id>0){
        const sourceWindow=event.source,sourceChannel=data.channel;
        const current=()=>live&&frame.current?.contentWindow===sourceWindow&&channel.current===sourceChannel;
        void (async()=>{
          try { const value=visualizationState(data.value),before=uiPreferences.get('visualization.state',scope);await uiPreferences.set('visualization.state',value as unknown as import('../../../packages/ui-preferences').UiValue,before.revision,scope);if(current())post({type:'state-result',id:data.id,state:state()}); }
          catch { if(current()){setError('交互状态未能保存，请重新调整控件。');post({type:'state-result',id:data.id,error:'VISUALIZATION_STATE_SAVE_FAILED'});} }
        })();
      }
    };
    window.addEventListener('message',receive);return()=>{live=false;window.removeEventListener('message',receive);};
  },[scope,dark,url]);
  const renderers=visualizations.listRenderers(),missing=!renderers.some(item=>item.id===selected);
  return <>
    <div className="visualization-toolbar" data-workbench-visualization-toolbar><span title={source.path}>{reference.title||'交互展示'}</span>
      {(renderers.length>1||missing)&&<select aria-label="展示渲染器" value={selected} onChange={event=>setRenderer(event.target.value)}>{missing&&<option value={selected}>暂不可用 · {selected}</option>}{renderers.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select>}
      <button type="button" aria-pressed={showSource} onClick={()=>setShowSource(value=>!value)}>{showSource?'返回预览':'查看源码'}</button><button type="button" onClick={reload}>重新载入</button>
    </div>
    {fallback&&<p className="visualization-status" role="status">所选扩展暂不可用，已回退到 HTML；原选择已保留。</p>}
    {error&&<p className="visualization-status" role="alert">{error}</p>}
    {showSource?<pre className="visualization-source" tabIndex={0}>{source.html}</pre>:url?<iframe ref={frame} title={reference.title||'交互展示'} sandbox="allow-scripts" referrerPolicy="no-referrer" src={url} style={{height}} onLoad={globals}/>:!error&&<p className="visualization-status" role="status">正在准备交互展示…</p>}
  </>;
}
