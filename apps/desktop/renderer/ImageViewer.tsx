import {useUiPreference} from './ui-preferences';
import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type PointerEvent} from 'react';
import {createPortal} from 'react-dom';
import type {Attachment} from '../../../packages/attachments/types';
import {api} from './App';import {Icon,errorText} from './ui';
import './ImageViewer.css';
import AttachmentMenu,{type AttachmentMenuAction} from './AttachmentMenu';
import {attachmentDraft,attachmentError} from './attachment-draft';
export const attachmentSize=(n:number)=>n<1024?`${n} B`:n<1048576?`${Math.ceil(n/1024)} KB`:`${(n/1048576).toFixed(1)} MB`;
type Point={x:number;y:number};type Stroke=Point[];
/** Shared by draft and history; source bytes are immutable, edits export a separate PNG. */
export default function ImageViewer({images,initialId,onClose}:{images:Attachment[];initialId:string;onClose:()=>void}){
 const [id,setId]=useState(initialId),item=images.find(i=>i.id===id)??images[0]!,index=images.indexOf(item);
 const [source,setSource]=useState(''),[dimensions,setDimensions]=useState({w:0,h:0}),[viewport,setViewport]=useState({w:1,h:1});
 const [scale,setScale]=useUiPreference<number|null>('image.scale',item.id),[pan,setPan]=useState<Point>({x:0,y:0}),[editing,setEditing]=useState(false),[strokes,setStrokes]=useState<Stroke[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [menu,setMenu]=useState<Point|null>(null),[notice,setNotice]=useState('');
 const canAdd=useSyncExternalStore(attachmentDraft.subscribe,attachmentDraft.available),operation=useRef(false);
 const panel=useRef<HTMLDivElement>(null),stage=useRef<HTMLDivElement>(null),picture=useRef<HTMLImageElement>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<{pointer:number;start:Point;pan:Point}|null>(null),drawing=useRef(false);
 const backdropPress=useRef<{pointer:number;start:Point;moved:boolean}|null>(null);
 const isBackdrop=(target:EventTarget|null)=>target instanceof Element&&!target.closest('button,a,input,select,textarea,[role="button"],.image-viewer-picture,.image-viewer-tools,.image-zoom,.image-viewer-error');
 const fit=Math.min(1,Math.max(1,viewport.w-64)/Math.max(1,dimensions.w),Math.max(1,viewport.h-40)/Math.max(1,dimensions.h)),zoom=scale??fit;
 const bound=(p:Point,s=zoom)=>({x:Math.max(-Math.max(0,(dimensions.w*s-viewport.w)/2+24),Math.min(Math.max(0,(dimensions.w*s-viewport.w)/2+24),p.x)),y:Math.max(-Math.max(0,(dimensions.h*s-viewport.h)/2+24),Math.min(Math.max(0,(dimensions.h*s-viewport.h)/2+24),p.y))});
 const reset=()=>{setScale(null);setPan({x:0,y:0});};
 const zoomTo=(next:number,anchor:Point={x:0,y:0})=>{next=Math.max(Math.min(.05,fit),Math.min(8,next));setPan(bound({x:anchor.x-(anchor.x-pan.x)*next/zoom,y:anchor.y-(anchor.y-pan.y)*next/zoom},next));setScale(next);};
 const navigate=(delta:number)=>{if(busy||editing)return;const next=images[index+delta];if(next)setId(next.id);};
 useEffect(()=>{setMenu(null);setNotice('');},[item.id]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),3500);return()=>clearTimeout(timer);},[notice]);
 const perform=async(action:()=>Promise<unknown>,message='')=>{if(operation.current)return;operation.current=true;setBusy(true);setError('');setNotice('');try{const result=await action();if(message&&result!==false)setNotice(message);return result;}catch(error){setError(attachmentError(error));}finally{operation.current=false;setBusy(false);}};
 const copyImage=()=>perform(()=>api('attachments/copy-image',{id:item.id}),'已复制原图');
 useEffect(()=>{let live=true;setSource('');setDimensions({w:0,h:0});setStrokes([]);setEditing(false);setError('');setPan({x:0,y:0});void api<string>('attachments/image',{id:item.id}).then(value=>{if(live)setSource(value);}).catch(e=>{if(live)setError(errorText(e));});return()=>{live=false;};},[item.id]);
 useLayoutEffect(()=>{const node=stage.current!;const observer=new ResizeObserver(()=>setViewport({w:node.clientWidth,h:node.clientHeight}));observer.observe(node);return()=>observer.disconnect();},[]);
 useEffect(()=>{setPan(p=>bound(p));},[viewport.w,viewport.h,zoom]);
 useEffect(()=>{const before=document.activeElement as HTMLElement|null;panel.current?.focus();return()=>{if(before?.isConnected)before.focus();};},[]);
 useEffect(()=>{const node=stage.current!;const wheel=(e:WheelEvent)=>{if(!e.ctrlKey)return;e.preventDefault();e.stopPropagation();const r=node.getBoundingClientRect();zoomTo(zoom*Math.exp(-e.deltaY*.002),{x:e.clientX-r.left-r.width/2,y:e.clientY-r.top-r.height/2});};node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[zoom,pan,dimensions,viewport]);
 const point=(e:PointerEvent)=>{const r=svg.current!.getBoundingClientRect();return {x:Math.max(0,Math.min(dimensions.w,(e.clientX-r.left)/zoom)),y:Math.max(0,Math.min(dimensions.h,(e.clientY-r.top)/zoom))};};
 const lineWidth=Math.max(3,Math.min(dimensions.w,dimensions.h)/180);
 const save=()=>perform(async()=>{let bytes:Uint8Array|undefined;if(editing&&strokes.length){if(dimensions.w*dimensions.h>40000000)throw Error('图片过大，无法生成标注副本。');const canvas=document.createElement('canvas');canvas.width=dimensions.w;canvas.height=dimensions.h;const context=canvas.getContext('2d');if(!context||canvas.width*canvas.height>40000000)throw Error('图片过大，无法生成标注副本。');context.drawImage(picture.current!,0,0);context.strokeStyle='#ed654d';context.lineWidth=lineWidth;context.lineJoin=context.lineCap='round';for(const stroke of strokes){context.beginPath();context.moveTo(stroke[0]!.x,stroke[0]!.y);for(const p of stroke)context.lineTo(p.x,p.y);context.stroke();}const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('无法生成标注副本。')),'image/png'));bytes=new Uint8Array(await blob.arrayBuffer());}return api('attachments/save-as',{id:item.id,...(bytes?{png:bytes}:{})});},editing&&strokes.length?'标注副本已保存':'副本已保存');
 const contextActions:AttachmentMenuAction[]=[
  {id:'fit',label:'适应窗口',icon:'image',shortcut:'0',disabled:!dimensions.w,run:reset},
  {id:'actual-size',label:'实际大小（100%）',icon:'image',shortcut:'1',disabled:!dimensions.w,run:()=>zoomTo(1)},
  {id:'copy-image',label:editing?'复制原图':'复制图片',icon:'copy',shortcut:'Ctrl+C',divider:true,disabled:!dimensions.w||busy,run:copyImage},
  {id:'save-as',label:editing&&strokes.length?'另存为标注副本…':'另存为…',icon:'export',shortcut:'Ctrl+S',disabled:!dimensions.w||busy,run:save},
  {id:'add-to-draft',label:'加入当前草稿',icon:'plus',disabled:!canAdd||busy,run:()=>perform(async()=>{const result=await attachmentDraft.add([item.id]);setNotice(result.added?'已加入草稿，尚未发送':'该附件已在草稿中');})},
  {id:'copy-path',label:'复制文件路径',icon:'link',divider:true,disabled:busy,run:()=>perform(()=>api('clipboard/write',{text:item.path}),'已复制文件路径')},
  {id:'reveal',label:'在资源管理器中显示',icon:'folder',disabled:busy,run:()=>perform(()=>api('attachments/reveal',{id:item.id}))},
  {id:'open',label:'在默认应用中打开',icon:'desktop',disabled:busy,run:()=>perform(()=>api('attachments/open',{id:item.id}))},
  {id:'close',label:'关闭图片预览',icon:'close',shortcut:'Esc',divider:true,disabled:busy,run:onClose},
 ];
 return createPortal(<div className={`image-viewer${images.length>1?' has-multiple':''}`} role="dialog" aria-modal="true" aria-label="图片查看器" data-testid="image-viewer" tabIndex={-1} ref={panel}
 onPointerDownCapture={e=>{backdropPress.current=!menu&&e.button===0&&isBackdrop(e.target)?{pointer:e.pointerId,start:{x:e.clientX,y:e.clientY},moved:false}:null;}}
 onPointerMoveCapture={e=>{const press=backdropPress.current;if(press?.pointer===e.pointerId&&Math.hypot(e.clientX-press.start.x,e.clientY-press.start.y)>4)press.moved=true;}}
 onPointerCancelCapture={()=>{backdropPress.current=null;}}
 onClick={e=>{const press=backdropPress.current;backdropPress.current=null;if(press&&!press.moved&&!busy&&!menu&&isBackdrop(e.target)&&Math.hypot(e.clientX-press.start.x,e.clientY-press.start.y)<=4){e.stopPropagation();onClose();}}}
 onContextMenu={e=>{e.preventDefault();e.stopPropagation();backdropPress.current=null;setMenu({x:e.clientX,y:e.clientY});}}
 onKeyDown={e=>{
  if(e.nativeEvent.isComposing)return;
  if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();e.stopPropagation();setMenu({x:viewport.w/2,y:viewport.h/2});return;}
  if((e.ctrlKey||e.metaKey)&&['c','s','z'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();if(busy)return;if(e.key.toLowerCase()==='c'&&dimensions.w)void copyImage();if(e.key.toLowerCase()==='s'&&dimensions.w)void save();if(e.key.toLowerCase()==='z'&&editing)setStrokes(s=>s.slice(0,-1));return;}
  if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&dimensions.w&&['+','=','-','0','1'].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==='0')reset();else if(e.key==='1')zoomTo(1);else zoomTo(e.key==='-'?zoom/1.25:zoom*1.25);return;}
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!busy){if(editing){setEditing(false);setStrokes([]);}else onClose();}}
  if(!editing&&e.key==='ArrowLeft'){e.preventDefault();navigate(-1);}if(!editing&&e.key==='ArrowRight'){e.preventDefault();navigate(1);}
  if(e.key==='Tab'){const buttons=Array.from(panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===panel.current)){e.preventDefault();first?.focus();}}
 }}>
  <div className="image-viewer-tools" role="group" aria-label="图片操作">
   <div className="image-viewer-actions">{editing?<><button onClick={()=>setStrokes(s=>s.slice(0,-1))} disabled={!strokes.length||busy}>撤销</button><button disabled={busy} onClick={()=>{setEditing(false);setStrokes([]);}}>取消标注</button></>:<button aria-label="标注图片" title="标注图片，另存为副本" disabled={!dimensions.w||busy} onClick={()=>setEditing(true)}><Icon name="compose"/></button>}<button aria-label="打开图片所在位置" title="打开所在位置" disabled={busy} onClick={()=>void api('attachments/reveal',{id:item.id}).catch(e=>setError(errorText(e)))}><Icon name="folder"/></button><button aria-label="图片另存为" title={editing?'另存为标注副本':'另存为'} disabled={!dimensions.w||busy} onClick={()=>void save()}><Icon name="export"/></button></div>
   <button className="image-viewer-close" aria-label="关闭图片预览" title="关闭图片预览 · Esc" disabled={busy} onClick={onClose}><Icon name="close" size={18}/></button>
  </div>
  <div ref={stage} className={`image-viewer-stage ${editing?'is-editing':''}`} onDoubleClick={()=>{if(!editing){if(scale===1)reset();else zoomTo(1);}}} onPointerDown={e=>{if(e.button!==0||editing||menu)return;drag.current={pointer:e.pointerId,start:{x:e.clientX,y:e.clientY},pan};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current?.pointer===e.pointerId)setPan(bound({x:drag.current.pan.x+e.clientX-drag.current.start.x,y:drag.current.pan.y+e.clientY-drag.current.start.y}));}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
   {source?<div className="image-viewer-picture" style={{width:dimensions.w*zoom,height:dimensions.h*zoom,transform:`translate(${pan.x}px,${pan.y}px)`}}><img ref={picture} className="attachment-full-image" src={source} alt={item.name} draggable={false} onLoad={e=>{const image=e.currentTarget;setDimensions({w:image.naturalWidth,h:image.naturalHeight});}} onError={()=>setError('图片无法解码。')}/>{editing&&dimensions.w>0&&<svg ref={svg} className="image-annotation" viewBox={`0 0 ${dimensions.w} ${dimensions.h}`} onPointerDown={e=>{if(e.button!==0||busy)return;e.stopPropagation();drawing.current=true;e.currentTarget.setPointerCapture(e.pointerId);const p=point(e);setStrokes(s=>[...s,[p,{x:p.x+.01,y:p.y+.01}]]);}} onPointerMove={e=>{if(!drawing.current)return;const p=point(e);setStrokes(s=>s.length?[...s.slice(0,-1),[...s.at(-1)!,p]]:s);}} onPointerUp={()=>{drawing.current=false;}} onPointerCancel={()=>{drawing.current=false;}}>{strokes.map((stroke,i)=><polyline key={i} points={stroke.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#ed654d" strokeWidth={lineWidth} strokeLinecap="round" strokeLinejoin="round"/>)}</svg>}</div>:!error&&<span className="image-viewer-loading">正在读取图片…</span>}
  </div>
  {images.length>1&&!editing&&<><button className="image-page previous" aria-label="上一张图片" disabled={index===0||busy} onClick={()=>navigate(-1)}><Icon name="chevron" size={22}/></button><button className="image-page next" aria-label="下一张图片" disabled={index===images.length-1||busy} onClick={()=>navigate(1)}><Icon name="chevron" size={22}/></button></>}
  {error&&<p className="image-viewer-error" role="alert">{error}</p>}
  {notice&&<p className="image-viewer-notice" role="status">{notice}</p>}
  <footer className="image-viewer-footer">
   <div className="image-zoom" role="group" aria-label="图片缩放"><button aria-label="缩小图片" title="缩小" disabled={!dimensions.w} onClick={()=>zoomTo(zoom/1.25)}>−</button><button title="适应窗口" aria-label="适应窗口" disabled={!dimensions.w} onClick={reset}>{Math.round(zoom*100)}%</button><button aria-label="放大图片" title="放大" disabled={!dimensions.w} onClick={()=>zoomTo(zoom*1.25)}>＋</button></div>
   <div className="image-viewer-caption"><span title={item.name}>{item.name}</span><span>{attachmentSize(item.size)}{dimensions.w?` · ${dimensions.w} × ${dimensions.h}`:''}</span>{images.length>1&&<span>{index+1} / {images.length}</span>}{editing&&<span>拖动标注 · 另存为副本</span>}</div>
  </footer>
  {menu&&<AttachmentMenu {...menu} item={item} surface="viewer" busy={busy} actions={contextActions} onClose={()=>setMenu(null)} onError={error=>setError(attachmentError(error))}/>}
 </div>,document.body);
}
