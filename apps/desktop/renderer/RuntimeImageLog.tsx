import {RememberedDetails} from './UiMemory';
import {useEffect,useState} from 'react';
import type {RuntimeActivity} from '../../../packages/collaboration-core/activity';
import type {AttachmentView} from '../../../packages/attachments/types';
import {AttachmentList} from './Attachments';
import {api} from './App';
import {Icon} from './ui';

/** Thumbnails survive collapse: reopening paints the last result at once and revalidates it. */
type CachedImages={promise:Promise<AttachmentView[]>;value?:AttachmentView[];prefetched:boolean};
const cachedImages=new Map<string,CachedImages>(),cachedImageLimit=64;
const imageSource=(item:RuntimeActivity)=>JSON.stringify(item.imagePaths??(item.runtime==='codex'&&item.input?[item.input]:[]));
const imageKey=(sessionId:string,item:RuntimeActivity)=>JSON.stringify([sessionId,item.id,imageSource(item)]);
function readImages(sessionId:string,item:RuntimeActivity,prefetched:boolean):CachedImages {
  const key=imageKey(sessionId,item),promise=api<AttachmentView[]>('attachments/activity-images',{sessionId,activityId:item.id}),entry:CachedImages={promise,prefetched,value:cachedImages.get(key)?.value};
  cachedImages.set(key,entry);
  promise.then(value=>{
    if(cachedImages.get(key)!==entry)return;
    entry.value=value;cachedImages.delete(key);cachedImages.set(key,entry);
    while(cachedImages.size>cachedImageLimit)cachedImages.delete(cachedImages.keys().next().value!);
  },()=>{if(cachedImages.get(key)===entry)cachedImages.delete(key);});
  return entry;
}
/** Hover or focus on a collapsed log starts the read so the click usually finds it done. */
function prefetchImages(sessionId:string|undefined,item:RuntimeActivity) {
  if(sessionId&&item.status==='completed'&&!cachedImages.has(imageKey(sessionId,item)))readImages(sessionId,item,true);
}

function Thumbnails({sessionId,item}:{sessionId?:string;item:RuntimeActivity}) {
  const sourceKey=imageSource(item),key=sessionId?imageKey(sessionId,item):'';
  const [images,setImages]=useState<AttachmentView[]|null>(()=>cachedImages.get(key)?.value??null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let live=true;const cached=cachedImages.get(key);setImages(cached?.value??null);setError('');
    if(!sessionId){setError('此图像日志没有可用的预览来源。');return;}
    // An unconsumed hover read is already fresh; anything older is shown and then re-read.
    const entry=cached?.prefetched?cached:readImages(sessionId,item,false);entry.prefetched=false;
    void entry.promise.then(value=>{if(live)setImages(value);}).catch(reason=>{if(live){setImages(null);setError(String(reason).includes('REMOTE_UNAVAILABLE')?'运行时未提供可在本机预览的图片。':'图片暂不可用，原文件可能已移动或更改。');}});
    return()=>{live=false;};
  },[sessionId,item.id,sourceKey,item.status,retry]);
  const placeholders=Math.min(10,Math.max(1,item.imagePaths?.length??item.viewedAttachments?.length??1));
  return <div className="runtime-image-thumbnails">{images?<AttachmentList items={images} presentation="thumbnails" context="activity"/>:error?<p role="status">{error} <button type="button" className="text-button" onClick={()=>setRetry(value=>value+1)}>重新读取</button></p>:<div className="runtime-image-placeholders" role="status" aria-label="正在读取图片…">{Array.from({length:placeholders},(_,index)=><span key={index}/>)}</div>}</div>;
}

/** Viewing is a collapsed process log; generation keeps its native result path. */
export default function RuntimeImageLog({sessionId,item}:{sessionId?:string;item:RuntimeActivity}) {
  const count=item.imagePaths?.length??item.viewedAttachments?.length??1;
  const label=item.status==='completed'?`已查看 ${count} 张图像`:item.status==='running'?`正在查看 ${count} 张图像`:item.status==='failed'?'查看图像失败':item.status==='cancelled'?'查看图像已取消':'查看图像结果未确认';
  return <RememberedDetails memoryId="RuntimeImageLog.details.1" scope={item.id} className={`runtime-step runtime-image-log ${item.status}`} data-testid="runtime-activity" data-activity-id={item.id} body={()=><Thumbnails sessionId={sessionId} item={item}/>}>
    <summary aria-label={label} onPointerEnter={()=>prefetchImages(sessionId,item)} onFocus={()=>prefetchImages(sessionId,item)}><span className={item.status==='running'?'activity-pulse':''}><Icon name="image" size={14}/></span><span>{label}</span><Icon name="chevron-down" size={12}/></summary>
  </RememberedDetails>;
}
