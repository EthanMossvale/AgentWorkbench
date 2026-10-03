import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import type {Session} from '../../../packages/contracts';
import {annotationDraft,annotationNeedsDisplayTranslation,type AnnotationDraft,type ContextAnnotation} from '../../../packages/context-annotations';
import {annotationController,annotationError,type AnnotationSelection} from './annotation-controller';
import {useUiPreference} from './ui-preferences';
import {RememberedTextarea} from './UiMemory';
import {Icon} from './ui';
import {api} from './App';
import './ContextAnnotations.css';

export function useContextAnnotations(session:Session|undefined,active:boolean,locked:boolean,invalidate:()=>void,report:(error:unknown)=>void,translationKey?:string){
  const saved=annotationDraft(session?.annotationDraft),[busy,setBusy]=useState(false),pending=useRef(false);
  const [reading,setReading]=useState(false),[readingError,setReadingError]=useState(''),[retry,setRetry]=useState(0);
  const current=useRef({sessionId:session?.id,saved,locked,active,invalidate,report});current.current={sessionId:session?.id,saved,locked,active,invalidate,report};
  const previous=useRef(saved.revision);
  const readingSnapshot=JSON.stringify(saved.items.map(item=>item.displayTranslation));
  useEffect(()=>{if(previous.current!==saved.revision){previous.current=saved.revision;current.current.invalidate();}annotationController.changed();},[saved.revision,session?.id,locked,busy,readingSnapshot]);
  const write=async(items:ContextAnnotation[],revision=current.current.saved.revision)=>{
    const value=current.current;
    if(!value.sessionId||!value.active)throw Error('ANNOTATION_UNAVAILABLE');
    if(pending.current||value.locked)throw Error('ANNOTATION_BUSY');
    pending.current=true;setBusy(true);value.invalidate();
    try{return await api<AnnotationDraft>('annotations/update',{sessionId:value.sessionId,revision,items});}
    finally{pending.current=false;setBusy(false);}
  };
  const writeRef=useRef(write);writeRef.current=write;
  useEffect(()=>{
    setReadingError('');setReading(false);
    if(!active||!session?.id||!translationKey||!saved.items.some(annotationNeedsDisplayTranslation))return;
    let current=true;setReading(true);
    void api<AnnotationDraft>('annotations/translate',{sessionId:session.id,revision:saved.revision}).catch(error=>{if(current)setReadingError(annotationError(error));}).finally(()=>{if(current)setReading(false);});
    return()=>{current=false;};
  },[active,session?.id,saved.revision,translationKey,retry]);
  useLayoutEffect(()=>{if(!active||!session)return;return annotationController.bind({get:()=>({sessionId:current.current.sessionId!,...current.current.saved,busy:pending.current||current.current.locked}),write:items=>writeRef.current(items),translate:async()=>api<AnnotationDraft>('annotations/translate',{sessionId:current.current.sessionId!,revision:current.current.saved.revision})});},[active,session?.id]);
  return {items:saved.items,revision:saved.revision,busy,write,reading,readingError,retryReading:()=>setRetry(value=>value+1),clearSubmitted:async(revision:number|undefined)=>{
    const id=session?.id;if(!id||revision===undefined)return;
    try{await api('annotations/update',{sessionId:id,revision,items:[]});}catch(error){report(new Error('消息已发送，但注释未清空：'+annotationError(error)));}
  }};
}

export function SelectionAnnotations({root,sessionId,active,disabled,report,onAdded}:{root:RefObject<HTMLElement|null>;sessionId?:string;active:boolean;disabled:boolean;report:(error:unknown)=>void;onAdded:(draft:AnnotationDraft)=>void}){
  const [selection,setSelection]=useState<(AnnotationSelection&{x:number;y:number})|null>(null),[busy,setBusy]=useState(false);
  const toolbar=useRef<HTMLDivElement>(null),[position,setPosition]=useState({left:0,top:0});
  useSyncExternalStore(annotationController.subscribe,annotationController.getVersion);
  useEffect(()=>{
    if(!active||!sessionId){setSelection(null);return;}
    const read=()=>{
      const selected=window.getSelection(),container=root.current;
      if(!selected||selected.isCollapsed||!selected.rangeCount||!container)return setSelection(null);
      const range=selected.getRangeAt(0),element=(node:Node)=>node.nodeType===Node.ELEMENT_NODE?node as Element:node.parentElement;
      const start=element(range.startContainer),end=element(range.endContainer);
      if(!start||!end||!container.contains(start)||!container.contains(end)||!start.closest('[data-message-markdown]')||!end.closest('[data-message-markdown]')||start.closest('button,textarea,input,[data-plugin-mount]')||end.closest('button,textarea,input,[data-plugin-mount]'))return setSelection(null);
      const text=selected.toString();if(!text.trim())return setSelection(null);
      const rect=range.getBoundingClientRect();if(!rect.width&&!rect.height)return setSelection(null);
      const message=start.closest('[data-message-id]');
      setSelection({text,source:{sessionId,...(message?.getAttribute('data-message-id')?{messageId:message.getAttribute('data-message-id')!}:{}),side:start.closest('.translation-pane,.message-translation-note')?'translation':'source'},x:rect.left+rect.width/2,y:rect.top});
    };
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){window.getSelection()?.removeAllRanges();setSelection(null);}else if(event.shiftKey||event.key==='Shift')read();};
    const hide=()=>setSelection(null);
    // Scrolling is a high-frequency interaction. Re-reading the selection on
    // every scroll forced getBoundingClientRect/querySelector work and competed
    // with the compositor. The toolbar is transient, so dismiss it cheaply.
    const onScroll=()=>setSelection(null);
    document.addEventListener('selectionchange',read);document.addEventListener('pointerup',read);document.addEventListener('keyup',key);window.addEventListener('resize',hide);root.current?.addEventListener('scroll',onScroll,true);
    const container=root.current;return()=>{document.removeEventListener('selectionchange',read);document.removeEventListener('pointerup',read);document.removeEventListener('keyup',key);window.removeEventListener('resize',hide);container?.removeEventListener('scroll',onScroll,true);};
  },[active,sessionId,root]);
  useLayoutEffect(()=>{if(!selection||!toolbar.current)return;const rect=toolbar.current.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(window.innerWidth-rect.width-8,selection.x-rect.width/2)),top:Math.max(8,selection.y-rect.height-8)});},[selection,annotationController.getVersion()]);
  if(!selection||!active)return null;
  return createPortal(<div ref={toolbar} className="annotation-selection" data-workbench-annotation-selection data-session-id={sessionId} role="toolbar" aria-label="所选上下文" style={position} onPointerDown={event=>event.preventDefault()}>
    {annotationController.listActions().map(action=><button key={action.id} type="button" disabled={disabled||busy} onClick={()=>{setBusy(true);void annotationController.invoke(action.id,selection).then(draft=>{window.getSelection()?.removeAllRanges();setSelection(null);onAdded(draft);}).catch(error=>report(new Error(annotationError(error)))).finally(()=>setBusy(false));}}>{action.id==='core.add'&&<Icon name="chat" size={14}/>}<span>{action.label}</span></button>)}
  </div>,document.body);
}

export function AnnotationCapsule({items,sessionId,disabled=false,editable=false,onEdit,onRemove,onClear}:{items:ContextAnnotation[];sessionId:string;disabled?:boolean;editable?:boolean;onEdit?:(id:string,text:string)=>Promise<unknown>;onRemove?:(id:string)=>Promise<unknown>;onClear?:()=>Promise<unknown>}){
  const [open,setOpen]=useUiPreference<boolean>('composer.annotations-open',sessionId),[editing,setEditing]=useState<string|null>(null),[value,setValue]=useState(''),[error,setError]=useState('');
  const panel=useRef<HTMLDivElement>(null),chip=useRef<HTMLButtonElement>(null);
  const act=(operation:()=>Promise<unknown>)=>{setError('');void operation().catch(error=>setError(annotationError(error)));};
  useEffect(()=>{if(!open)setEditing(null);},[open]);
  if(!items.length)return null;
  return <div className={`annotation-capsule ${editable?'annotation-draft':'annotation-history'}`} data-workbench-annotations={editable?'draft':'message'} data-session-id={sessionId} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setEditing(null);setOpen(false);chip.current?.focus();}}}>
    <div className="annotation-chip"><button ref={chip} type="button" aria-expanded={open} aria-label={`${items.length} 条注释`} onClick={()=>setOpen(value=>!value)}><Icon name="chat" size={14}/><span>{items.length} 条注释</span></button>{editable&&<button type="button" className="annotation-clear" aria-label="清空注释" title="清空注释" disabled={disabled} onClick={()=>act(()=>onClear!())}><Icon name="close" size={12}/></button>}</div>
    {open&&<div ref={panel} className="annotation-panel" role="region" aria-label="上下文注释"><ol>{items.map(item=><li key={item.id}><div className="annotation-row"><small>所选文本{item.source?.side==='translation'?' · 译文':''}</small>{editable&&<span><button type="button" className="icon-button" aria-label="编辑注释" disabled={disabled} onClick={()=>{setEditing(item.id);setValue(item.text);setError('');}}><Icon name="edit" size={14}/></button><button type="button" className="icon-button" aria-label="删除注释" disabled={disabled} onClick={()=>act(()=>onRemove!(item.id))}><Icon name="trash" size={14}/></button></span>}</div>{editing===item.id?<div className="annotation-editor"><RememberedTextarea memoryId="composer.annotation-editor" scope={sessionId} aria-label="注释内容" autoFocus value={value} onChange={event=>setValue(event.target.value)} disabled={disabled}/><div><button type="button" className="text-button" disabled={disabled||!value.trim()} onClick={()=>act(async()=>{await onEdit!(item.id,value);setEditing(null);})}>保存</button><button type="button" className="text-button" disabled={disabled} onClick={()=>setEditing(null)}>取消</button></div></div>:<p>{item.text}</p>}{item.displayTranslation&&item.displayTranslation!==item.text&&<div className="annotation-display-translation"><small>译文（给你看的）</small><p>{item.displayTranslation}</p></div>}{item.translatedText&&item.translatedText!==item.text&&<div className="annotation-sent"><small>实际发送给模型</small><p>{item.translatedText}</p></div>}</li>)}</ol><button type="button" className="text-button annotation-collapse" onClick={()=>setOpen(false)}>收起</button></div>}
    {error&&<div role="alert" className="annotation-error">{error}</div>}
  </div>;
}
