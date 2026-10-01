import {useEffect,useState} from 'react';
import type {DesktopUpdateState} from '../../../packages/desktop-updates';
import {api} from './App';
import {Icon} from './ui';
import './DesktopUpdate.css';

export default function DesktopUpdate(){
 const [state,setState]=useState<DesktopUpdateState>({phase:'disabled'}),[error,setError]=useState('');
 useEffect(()=>{let live=true,revision=0;const read=()=>{const request=++revision;void api<DesktopUpdateState>('desktop-updates/status').then(value=>{if(live&&request===revision)setState(value);}).catch(()=>{});};const stop=window.workbench.onPluginEvent?.(event=>{if(event.type==='plugin'&&event.id==='workbench.updates'&&event.topic==='changed')read();});read();return()=>{live=false;stop?.();};},[]);
 const visible=['downloading','ready','installing','error'].includes(state.phase);
 const install=async()=>{setError('');try{await api('desktop-updates/install');}catch(e){setError(String(e).includes('SESSION_BUSY')?'请先结束正在运行或结果尚未确认的任务，再安装更新。':'更新未能安装，请稍后重试。');}};
 return <div data-workbench-desktop-update className="desktop-update" hidden={!visible}>
  {state.phase==='downloading'?<div role="status"><Icon name="arrow" size={16}/><span>正在下载更新 {Math.floor(state.percent??0)}%</span></div>:state.phase==='ready'?<button title={`安装 ${state.version??''} 并重启工作台`} aria-label="安装更新并重启工作台" onClick={()=>void install()}><Icon name="refresh" size={18}/><span>更新并重启</span></button>:state.phase==='error'?<button onClick={()=>void api('desktop-updates/check').catch(()=>setError('暂时无法检查更新。'))}>更新失败，重试</button>:<span role="status">正在安装更新…</span>}
  {error&&<span role="alert">{error}</span>}
 </div>;
}
