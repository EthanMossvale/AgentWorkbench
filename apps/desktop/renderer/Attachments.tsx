import { useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent } from 'react';
import type { Attachment, AttachmentView } from '../../../packages/attachments/types';
import { textPastePolicies } from '../../../packages/attachments/paste';
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_TOTAL } from '../../../packages/attachments/types';
import { api } from './App';
import { Icon, Modal, errorText } from './ui';
import './Attachments.css';
import {imageViewerController} from './media-controller';
import AttachmentMenu, {type AttachmentMenuAction} from './AttachmentMenu';
import type {AttachmentActionSurface} from './attachment-actions';
import {attachmentDraft, attachmentError, type AttachmentDraftResult} from './attachment-draft';

export function useAttachments(initial:Attachment[],locked:boolean,onChange:()=>void,report:(error:unknown)=>void) {
  const [items,setItems]=useState<AttachmentView[]>(initial),itemsRef=useRef(items);itemsRef.current=items;
  const [busy,setBusy]=useState(false),pending=useRef(false),mounted=useRef(true),generation=useRef(0);
  const [dragging,setDragging]=useState(false),depth=useRef(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  const replace=(next:AttachmentView[])=>{generation.current++;itemsRef.current=next;setItems(next);};
  const collect=async(load:()=>Promise<AttachmentView[]>,propagate=false):Promise<AttachmentDraftResult|undefined>=>{
    if(locked||pending.current){if(propagate)throw Error(locked?'ATTACHMENT_DRAFT_UNAVAILABLE':'ATTACHMENT_DRAFT_BUSY');return;}
    pending.current=true;setBusy(true);onChange();const revision=generation.current;
    try{const added=await load();if(!mounted.current||revision!==generation.current){if(propagate)throw Error('ATTACHMENT_DRAFT_CHANGED');return;}
      const next=[...itemsRef.current];for(const item of added)if(!next.some(old=>old.sha256===item.sha256&&old.name===item.name))next.push(item);
      if(next.length>MAX_ATTACHMENTS)throw Error('每条消息最多添加 10 个附件。');
      if(next.reduce((sum,a)=>sum+a.size,0)>MAX_ATTACHMENT_TOTAL)throw Error('附件总大小不能超过 50 MB。');
      const count=next.length-itemsRef.current.length;itemsRef.current=next;setItems(next);return {added:count,duplicates:added.length-count};
    }catch(error){if(propagate)throw error;if(mounted.current&&revision===generation.current)report(error);}finally{pending.current=false;if(mounted.current)setBusy(false);}
  };
  const collectRef=useRef(collect);collectRef.current=collect;
  useEffect(()=>{if(locked){generation.current++;return;}return attachmentDraft.register(async ids=>(await collectRef.current(()=>api<AttachmentView[]>('attachments/views',{ids}),true))!);},[locked]);
  const files=(files:File[])=>collect(()=>window.workbench.attachFiles(files));
  const fileDrag=(event:DragEvent)=>Array.from(event.dataTransfer.types).includes('Files');
  const dropProps={
    onDragEnter:(event:DragEvent)=>{if(!fileDrag(event))return;event.preventDefault();if(!locked){depth.current++;setDragging(true);}},
    onDragOver:(event:DragEvent)=>{if(!fileDrag(event))return;event.preventDefault();event.dataTransfer.dropEffect=locked||pending.current?'none':'copy';},
    onDragLeave:(event:DragEvent)=>{if(!fileDrag(event))return;event.preventDefault();depth.current=Math.max(0,depth.current-1);if(!depth.current)setDragging(false);},
    onDrop:(event:DragEvent)=>{if(!fileDrag(event))return;event.preventDefault();event.stopPropagation();depth.current=0;setDragging(false);if(!locked&&!pending.current)void files(Array.from(event.dataTransfer.files));},
  };
  useEffect(()=>{const clear=()=>{depth.current=0;setDragging(false);};window.addEventListener('dragend',clear);window.addEventListener('blur',clear);return()=>{window.removeEventListener('dragend',clear);window.removeEventListener('blur',clear);};},[]);
  const paste=(event:ClipboardEvent)=>{
    const list=Array.from(event.clipboardData.files);
    if(list.length){event.preventDefault();if(!locked)void files(list);return;}
    const text=event.clipboardData.getData('text/plain');
    if(!text||!textPastePolicies.decide(text).attachment)return;
    event.preventDefault();
    if(locked||pending.current){report(Error('正在处理附件或提交消息，请稍后重新粘贴；剪贴板内容未发送。'));return;}
    void files([new File([text],'pasted-text.txt',{type:'text/plain'})]);
  };
  return {items,replace,busy,pending,dragging,dropProps,paste,pick:()=>collect(()=>api<AttachmentView[]>('attachments/pick')),remove:(id:string)=>{if(locked||pending.current)return;onChange();replace(itemsRef.current.filter(a=>a.id!==id));}};
}
const size=(bytes:number)=>bytes<1024?`${bytes} B`:bytes<1024*1024?`${Math.ceil(bytes/1024)} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;
export function AttachmentList({items,onRemove,disabled=false,presentation='cards',context}:{items:Attachment[];onRemove?:(id:string)=>void;disabled?:boolean;presentation?:'cards'|'thumbnails';context?:AttachmentActionSurface}) {
  const [views,setViews]=useState<AttachmentView[]>([]),[viewing,setViewing]=useState<string|null>(null),[error,setError]=useState('');
  const [menu,setMenu]=useState<{item:Attachment;x:number;y:number}|null>(null),[notice,setNotice]=useState(''),[acting,setActing]=useState(false),pending=useRef(false);
  const canAdd=useSyncExternalStore(attachmentDraft.subscribe,attachmentDraft.available);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),3500);return()=>clearTimeout(timer);},[notice]);
  const key=items.map(a=>a.id).join(',');
  useEffect(()=>{let live=true;setError('');if(!items.length){setViews([]);return;}void api<AttachmentView[]>('attachments/views',{ids:items.map(a=>a.id)}).then(value=>{if(live)setViews(value);}).catch(e=>{if(live)setError(errorText(e));});return()=>{live=false;};},[key]);
  if(!items.length)return null;
  const active=views.find(a=>a.id===viewing);
  const open=(item:Attachment)=>{setNotice('');setError('');if(item.mime.startsWith('image/'))imageViewerController.show(items.filter(i=>i.mime.startsWith('image/')),item.id);else setViewing(item.id);};
  const perform=(operation:()=>Promise<unknown>,message='')=>async()=>{if(pending.current)return;pending.current=true;setActing(true);setError('');setNotice('');try{const result=await operation();if(message&&result!==false)setNotice(message);return result;}finally{pending.current=false;setActing(false);}};
  const actions=(item:Attachment):AttachmentMenuAction[]=>[
    {id:'view',label:item.mime.startsWith('image/')?'查看大图':'查看附件信息',icon:'document',run:()=>open(item)},
    {id:'open',label:'在默认应用中打开',icon:'desktop',disabled:acting,run:perform(()=>api('attachments/open',{id:item.id}))},
    ...(!onRemove?[{id:'add-to-draft',label:'加入当前草稿',icon:'plus',disabled:!canAdd||acting,run:perform(async()=>{const result=await attachmentDraft.add([item.id]);setNotice(result.added?'已加入草稿，尚未发送':'该附件已在草稿中');})}]:[]),
    ...(item.mime.startsWith('image/')?[{id:'copy-image',label:'复制图片',icon:'copy',divider:true,disabled:acting,run:perform(()=>api('attachments/copy-image',{id:item.id}),'已复制图片')}]:[]),
    {id:'copy-path',label:'复制文件路径',icon:'link',divider:!item.mime.startsWith('image/'),disabled:acting,run:perform(()=>api('clipboard/write',{text:item.path}),'已复制文件路径')},
    {id:'reveal',label:'在资源管理器中显示',icon:'folder',disabled:acting,run:perform(()=>api('attachments/reveal',{id:item.id}))},
    {id:'save-as',label:'另存为…',icon:'export',disabled:acting,run:perform(()=>api('attachments/save-as',{id:item.id}),'副本已保存')},
    ...(onRemove?[{id:'remove',label:'从草稿移除',icon:'close',divider:true,disabled:disabled||acting,run:()=>onRemove(item.id)}]:[]),
  ];
  return <><div className={`attachment-list${presentation==='thumbnails'?' is-thumbnail-strip':''}`} aria-label={onRemove?'待发送附件':'消息附件'} data-testid={onRemove?'composer-attachments':'message-attachments'}>{items.map((item,index)=>{const view=views.find(v=>v.id===item.id);return <div className={`attachment-item ${view?.preview?'is-image':''}`} key={item.id} data-attachment-id={item.id}>
    <button type="button" className="attachment-preview" aria-label={presentation==='thumbnails'?`查看图像 ${index+1}`:`查看附件 ${item.name}`} title={presentation==='thumbnails'?'点击展开 · 右键操作':`${item.name} · 右键查看更多操作`} aria-haspopup="dialog" onClick={()=>open(item)} onContextMenu={event=>{event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});setMenu({item,x:event.clientX,y:event.clientY});}} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();const box=event.currentTarget.getBoundingClientRect();setMenu({item,x:box.left,y:box.bottom});}}}>{view?.preview?<img src={view.preview} alt={item.name} draggable={false}/>:<Icon name="document" size={23}/>}{presentation!=='thumbnails'&&<span className="attachment-label"><strong>{item.name}</strong><small>{size(item.size)}</small></span>}</button>
    {onRemove&&<button type="button" className="attachment-remove" aria-label={`移除附件 ${item.name}`} disabled={disabled} onClick={()=>onRemove(item.id)}><Icon name="close" size={12}/></button>}
  </div>;})}</div>{notice&&!viewing&&<p className="attachment-notice" role="status">{notice}</p>}{error&&!viewing&&<p className="attachment-error" role="alert">{error}</p>}{menu&&<AttachmentMenu {...menu} item={menu.item} surface={context??(onRemove?'draft':'history')} busy={acting} actions={actions(menu.item)} onClose={()=>setMenu(null)} onError={error=>setError(attachmentError(error))}/>}{viewing&&<Modal title={items.find(a=>a.id===viewing)?.name??'附件'} className="attachment-modal" onClose={()=>setViewing(null)}><p>{onRemove?'此文件已加入草稿，发送前仍可移除。':'此文件是消息附件，可打开原文件或另存为副本。'}</p><div className="attachment-file-actions">{['在默认应用中打开','在资源管理器中显示','另存为…'].map(label=><button key={label} className="text-button" disabled={acting} onClick={()=>{const item=items.find(a=>a.id===viewing);if(item)void Promise.resolve(actions(item).find(a=>a.label===label)!.run()).catch(error=>setError(attachmentError(error)));}}>{label}</button>)}</div><p className="attachment-detail">{active?`${active.mime} · ${size(active.size)}`:''}</p>{notice&&<p role="status" className="attachment-notice">{notice}</p>}{error&&<p role="alert" className="attachment-error">{error}</p>}</Modal>}</>;
}
