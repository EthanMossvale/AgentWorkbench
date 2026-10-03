import {RememberedDetails} from './UiMemory';
import {useEffect,useState} from 'react';
import type {RuntimeActivity} from '../../../packages/collaboration-core/activity';
import type {AttachmentView} from '../../../packages/attachments/types';
import {AttachmentList} from './Attachments';
import {api} from './App';
import {Icon} from './ui';

function Thumbnails({sessionId,item}:{sessionId?:string;item:RuntimeActivity}) {
  const [images,setImages]=useState<AttachmentView[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const sourceKey=JSON.stringify(item.imagePaths??(item.runtime==='codex'&&item.input?[item.input]:[]));
  useEffect(()=>{
    let live=true;setImages(null);setError('');
    if(!sessionId){setError('此图像日志没有可用的预览来源。');return;}
    void api<AttachmentView[]>('attachments/activity-images',{sessionId,activityId:item.id}).then(value=>{if(live)setImages(value);}).catch(reason=>{if(live)setError(String(reason).includes('REMOTE_UNAVAILABLE')?'运行时未提供可在本机预览的图片。':'图片暂不可用，原文件可能已移动或更改。');});
    return()=>{live=false;};
  },[sessionId,item.id,sourceKey,item.status,retry]);
  return <div className="runtime-image-thumbnails">{images?<AttachmentList items={images} presentation="thumbnails" context="activity"/>:error?<p role="status">{error} <button type="button" className="text-button" onClick={()=>setRetry(value=>value+1)}>重新读取</button></p>:<p role="status">正在读取图片…</p>}</div>;
}

/** Viewing is a collapsed process log; generation keeps its native result path. */
export default function RuntimeImageLog({sessionId,item}:{sessionId?:string;item:RuntimeActivity}) {
  const [open,setOpen]=useState(false),count=item.imagePaths?.length??item.viewedAttachments?.length??1;
  const label=item.status==='completed'?`已查看 ${count} 张图像`:item.status==='running'?`正在查看 ${count} 张图像`:item.status==='failed'?'查看图像失败':item.status==='cancelled'?'查看图像已取消':'查看图像结果未确认';
  return <RememberedDetails memoryId="RuntimeImageLog.details.1" scope={item.id} open={open} className={`runtime-step runtime-image-log ${item.status}`} data-testid="runtime-activity" data-activity-id={item.id} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary aria-label={label}><span className={item.status==='running'?'activity-pulse':''}><Icon name="image" size={14}/></span><span>{label}</span><Icon name="chevron-down" size={12}/></summary>
    {open&&<Thumbnails sessionId={sessionId} item={item}/>}
  </RememberedDetails>;
}
