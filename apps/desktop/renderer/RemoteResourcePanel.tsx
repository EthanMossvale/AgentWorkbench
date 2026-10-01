import {useEffect,useRef,useState} from 'react';
import type {SshHost} from '../../../packages/contracts';
import type {RemoteResources,ResourcePolicy} from '../../../packages/remote-account-catalog/resources';
import {api} from './App';
import {Icon,Toggle,errorText} from './ui';
import './RemoteResources.css';
const bytes=(n:number)=>n>=1073741824?(n/1073741824).toFixed(1)+' GB':Math.round(n/1048576)+' MB';
export default function RemoteResourcePanel({host,onFiles,filesOpen,notify}:{host:SshHost;onFiles:()=>void;filesOpen:boolean;notify:(s:string)=>void}){
 const [value,setValue]=useState<RemoteResources>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false);const alive=useRef(true),reading=useRef(false);
 async function read(){if(reading.current)return;reading.current=true;setLoading(true);try{const next=await api<RemoteResources>('remote-resources/read',{id:host.id});if(alive.current){setValue(next);setError('');}}catch(e){if(alive.current)setError(errorText(e));}finally{reading.current=false;if(alive.current)setLoading(false);}}
 useEffect(()=>{alive.current=true;void read();const timer=setInterval(()=>void read(),15000);return()=>{alive.current=false;clearInterval(timer);};},[]);
 async function configure(enabled:boolean){if(!value||busy)return;setBusy(true);try{const next=await api<ResourcePolicy>('remote-resources/configure',{id:host.id,revision:value.policy.revision,autoMemory:enabled});if(alive.current)setValue(v=>v?{...v,policy:next}:v);notify(enabled?'自动回收已保存，远端原生服务运行时生效。':'自动回收已关闭。');}catch(e){if(alive.current)setError(errorText(e));}finally{if(alive.current)setBusy(false);}}
 async function reclaim(){setBusy(true);setError('');try{const reply=await api<{result:{available:boolean;closed:string[];protected:number;pending?:number}}>('remote-resources/reclaim',{id:host.id});if(!reply.result.available)throw Error('远端原生服务尚未运行，没有可回收的工作台进程。');notify(`已回收 ${reply.result.closed.length} 个空闲运行时，保留 ${reply.result.protected} 个忙碌运行时。${reply.result.pending?'仍有清理等待确认，请刷新。':''}`);await read();}catch(e){if(alive.current)setError(errorText(e));}finally{if(alive.current)setBusy(false);}}
 return <section className="remote-resources" aria-label="VPS 资源">
  <div className="connection-details-heading"><h3>VPS 资源</h3><button className="icon-button" aria-label="刷新远端资源" disabled={loading||busy} onClick={()=>void read()}><Icon name="refresh" size={15}/></button></div>
  {value&&<><div className="remote-resource-meters">{([{label:'内存',...value.memory},{label:'储存 · /',...value.storage}]).map(item=><div key={item.label}><div><strong>{item.label}</strong><span>{bytes(item.used)} / {bytes(item.total)}</span></div><progress aria-label={item.label+'占用'} value={item.used} max={item.total}/><small>可用 {bytes(item.available)}</small></div>)}</div>{value.memory.swapTotal>0&&<p className="inline-note">交换空间 {bytes(value.memory.swapUsed)} / {bytes(value.memory.swapTotal)}</p>}</>}
  <div className="remote-resource-actions">{value&&<button className="button secondary" disabled={busy||!value.runtime.available} onClick={()=>void reclaim()}>回收空闲内存</button>}<button className="button secondary" aria-pressed={filesOpen} onClick={onFiles}><Icon name="folder" size={14}/>远端文件</button></div>
  {value?<><fieldset disabled={busy} title="低内存时仅回收工作台空闲运行时，保留浏览器与其他软件。"><Toggle label="自动回收空闲内存" checked={value.policy.autoMemory} onChange={v=>void configure(v)}/></fieldset>{!value.runtime.available&&<p className="inline-note">维护服务未就绪，内存回收暂不可用。</p>}<small className="resource-observed" title="每 15 秒刷新">{new Date(value.observedAt*1000).toLocaleTimeString()} 更新</small></>:<p role="status">{loading?'正在读取 VPS 资源…':'资源尚未读取'}</p>}
  {error&&<p role="alert" className="inline-error">{error}</p>}
 </section>;
}
