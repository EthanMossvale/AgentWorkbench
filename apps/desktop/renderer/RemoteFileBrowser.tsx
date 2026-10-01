import {RememberedTextarea} from './UiMemory';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {SshHost} from '../../../packages/contracts';
import type {RemoteFileView} from '../../../packages/remote-account-catalog/resources';
import FileBrowser from './FileBrowser';
import {RemoteDirectoryCache} from './remote-directory-cache';
import {api} from './App';
import {Modal,errorText} from './ui';

type Action='mkdir'|'write'|'move'|'copy'|'remove'|'info';
interface Dialog {action:Action;path:string;view?:RemoteFileView;value:string;refresh:(path?:string)=>void;creating?:boolean;loading?:boolean;error?:string}
function RemoteMenu({path,x,y,directory,choose,close,report}:{path:string;x:number;y:number;directory?:boolean;choose:(a:Action)=>void;close:()=>void;report:(e:unknown)=>void}) {
  const element=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    element.current?.querySelector('button')?.focus();
    const dismiss=(event:MouseEvent)=>{if(!element.current?.contains(event.target as Node))close();};
    document.addEventListener('mousedown',dismiss);
    return()=>document.removeEventListener('mousedown',dismiss);
  },[path]);
  return <div ref={element} className="remote-file-menu" data-remote-menu role="menu" aria-label="远端文件操作"
    style={{left:Math.max(8,Math.min(x,window.innerWidth-210)),top:Math.max(8,Math.min(y,window.innerHeight-290))}}
    onKeyDown={event=>{
      if(event.key==='Escape'){event.stopPropagation();close();}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();const items=[...element.current!.querySelectorAll('button')],index=items.indexOf(document.activeElement as HTMLButtonElement);
        items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
      }
    }}>
    {(['move','copy','remove','info'] as const).map(action=><button role="menuitem" key={action} onClick={()=>{choose(action);close();}}>{{move:'重命名 / 移动',copy:'复制到…',remove:'删除…',info:'属性'}[action]}</button>)}
    {directory!==true&&<button role="menuitem" onClick={()=>{choose('write');close();}}>编辑文本</button>}
    <button role="menuitem" onClick={()=>{void api('clipboard/write',{text:path}).catch(report);close();}}>复制远端路径</button>
  </div>;
}

export default function RemoteFileBrowser({host,active=true,onClose,notify,report}:{host:SshHost;active?:boolean;onClose:()=>void;notify:(s:string)=>void;report:(e:unknown)=>void}) {
  const [dialog,setDialog]=useState<Dialog>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const epoch=useRef(0),alive=useRef(true);
  const cache=useMemo(()=>new RemoteDirectoryCache(path=>api<RemoteFileView>('remote-files/browse',{id:host.id,path})),[JSON.stringify(host)]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;cache.dispose();};},[cache]);
  useEffect(()=>{cache.setActive(active);if(!active){epoch.current++;setDialog(undefined);}return()=>cache.setActive(false);},[active,cache]);
  const closeDialog=()=>{epoch.current++;setDialog(undefined);};
  const choose=(action:Action,view:RemoteFileView,refresh:(path?:string)=>void,creating=false)=>{
    epoch.current++;setError('');setDialog({action,path:view.path,view,refresh,creating,value:action==='write'&&!creating?view.content??'':action==='move'||action==='copy'?view.path:''});
  };
  const inspect=async(action:Action,path:string,refresh:(path?:string)=>void)=>{
    const token=++epoch.current;setError('');setDialog({action,path,refresh,value:'',loading:true});
    try{
      const view=await cache.fresh(path);
      if(!alive.current||token!==epoch.current)return;
      if(action==='write'&&(view.kind!=='text'||view.link))throw Error('此文件不能直接编辑；请下载后处理。');
      choose(action,view,refresh);
    }catch(error){if(alive.current&&token===epoch.current)setDialog({action,path,refresh,value:'',error:errorText(error)});}
  };
  const transfer=async(method:string,view:RemoteFileView,refresh:(path?:string)=>void)=>{
    setBusy(true);
    try{const value=await api<{cancelled?:boolean}>(method,{id:host.id,path:method.endsWith('upload')?(view.kind==='directory'?view.path:view.parent):view.path,revision:view.revision});
      if(!value.cancelled){cache.invalidate();if(alive.current){notify(method.endsWith('upload')?'已上传并写入远端。':'已下载并校验本机副本。');refresh();}}
    }catch(error){cache.invalidate();if(alive.current)report(error);}finally{if(alive.current)setBusy(false);}
  };
  async function apply(){
    if(!dialog?.view||busy)return;const d=dialog,view=dialog.view;setBusy(true);setError('');
    try{
      const parent=view.kind==='directory'?view.path:view.parent;
      const target=d.creating?parent.replace(/\/$/,'')+'/'+d.value:view.path;
      if(d.creating&&(!d.value.trim()||/[\\/\x00-\x1f]/.test(d.value)||['.','..'].includes(d.value)))throw Error('请输入单个文件或文件夹名称。');
      await api('remote-files/mutate',{id:host.id,operation:d.action,path:target,...(!d.creating?{revision:view.revision}:{}),...(d.action==='write'?{content:d.creating?'':d.value}:{}),...(['move','copy'].includes(d.action)?{destination:d.value}:{}),...(d.action==='remove'?{confirm:true}:{})});
      cache.invalidate();
      if(alive.current){d.refresh(d.action==='remove'||d.action==='move'?view.parent:d.creating?parent:undefined);closeDialog();notify('远端文件操作已完成。');}
    }catch(error){cache.invalidate();if(alive.current)setError(errorText(error));}finally{if(alive.current)setBusy(false);}
  }
  return <><FileBrowser reference={{path:'/'}} roots={['/']} active={active} onClose={onClose} notify={notify} report={report} backend={{
    label:'远端文件浏览器',placeholder:'输入远端绝对路径，如 /home',browse:cache.read,peek:cache.peek,subscribe:cache.subscribe,prefetch:cache.prefetch,invalidate:cache.invalidate,
    controls:(raw,refresh)=>{
      const view=raw as RemoteFileView|null;
      return <div className="remote-file-tools"><span>远端 · {host.name}</span><button disabled={!view||busy} onClick={()=>choose('write',view!,refresh,true)}>新建文件</button><button disabled={!view||busy} onClick={()=>choose('mkdir',view!,refresh,true)}>新建文件夹</button><button disabled={!view||busy} onClick={()=>void transfer('remote-files/upload',view!,refresh)}>上传</button>{view?.kind!=='directory'&&<button disabled={!view||busy||!!view.link} onClick={()=>void transfer('remote-files/download',view!,refresh)}>下载</button>}{view?.kind==='text'&&<button disabled={busy} onClick={()=>choose('write',view,refresh)}>编辑</button>}</div>;
    },
    menu:(path,x,y,close,refresh,directory)=><RemoteMenu key={path} path={path} x={x} y={y} directory={directory} close={close} report={report} choose={action=>void inspect(action,path,refresh)}/>
  }}/>{dialog&&<Modal title={{mkdir:'新建远端文件夹',write:dialog.creating?'新建远端文件':'编辑远端文本',move:'重命名 / 移动',copy:'复制到远端路径',remove:'删除远端文件',info:'远端文件属性'}[dialog.action]} dismissible={!busy} onClose={closeDialog}>
    <p className="remote-file-path">{dialog.path}</p>
    {dialog.loading?<p role="status">正在核对远端文件…</p>:dialog.error?<p role="alert" className="inline-error">{dialog.error}<button className="text-button" onClick={()=>void inspect(dialog.action,dialog.path,dialog.refresh)}>重试</button></p>:dialog.view&&<>
      {dialog.action==='info'?<dl className="detail-list"><div><dt>大小</dt><dd>{dialog.view.size??0} 字节</dd></div><div><dt>权限</dt><dd>{dialog.view.mode??'—'}</dd></div><div><dt>修改时间</dt><dd>{dialog.view.modified?new Date(dialog.view.modified*1000).toLocaleString():'—'}</dd></div></dl>:dialog.action==='remove'?<p>永久删除此{dialog.view.kind==='directory'?'文件夹及其全部内容':'文件'}？此操作不进入回收站。</p>:dialog.action==='write'&&!dialog.creating?<RememberedTextarea memoryId="RemoteFileBrowser.editor.1" className="remote-file-editor" aria-label="远端文本内容" value={dialog.value} onChange={e=>setDialog({...dialog,value:e.target.value})}/>:<label className="field"><span>{dialog.creating?'名称':'目标绝对路径'}</span><input aria-label={dialog.creating?'名称':'目标绝对路径'} value={dialog.value} onChange={e=>setDialog({...dialog,value:e.target.value})}/></label>}
    </>}
    {error&&<p role="alert" className="inline-error">{error}</p>}
    <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={closeDialog}>{dialog.action==='info'?'关闭':'取消'}</button>{dialog.action!=='info'&&<button className="button primary" disabled={busy||!dialog.view||dialog.loading} onClick={()=>void apply()}>{busy?'处理中…':dialog.action==='remove'?'确认永久删除':'保存'}</button>}</div>
  </Modal>}</>;
}
