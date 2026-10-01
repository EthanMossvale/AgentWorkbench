import {useEffect,useRef,useState} from 'react';
import type {SshHost} from '../../../packages/contracts';
import type {RemoteConfigurationRow,RemoteConfigurationPlan,RemoteConfigurationOperation} from '../../../packages/remote-account-catalog/configuration';
import {api} from './App';
import {Icon,Modal,Toggle,errorText} from './ui';

const verbs={install:'安装',update:'更新',uninstall:'卸载'};
export default function RemoteConfigurationRows({host,refresh,notify}:{host:SshHost;refresh:number;notify:(message:string)=>void}){
 const [rows,setRows]=useState<RemoteConfigurationRow[]>([]),[loading,setLoading]=useState(false),[busy,setBusy]=useState<string>(),[error,setError]=useState(''),[plan,setPlan]=useState<RemoteConfigurationPlan>();
 const epoch=useRef(0),locked=useRef(false),hostKey=JSON.stringify(host);
 useEffect(()=>{void load();const stop=window.workbench?.onExtensions?.(()=>{setPlan(undefined);void load();});return()=>{epoch.current++;stop?.();};},[hostKey,refresh]);
 async function load(){const e=++epoch.current;setLoading(true);setError('');setPlan(undefined);try{const result=await api<RemoteConfigurationRow[]>('remote-configuration/list',{id:host.id});if(e===epoch.current)setRows(result);}catch(err){if(e===epoch.current)setError(errorText(err));}finally{if(e===epoch.current)setLoading(false);}}
 async function review(row:RemoteConfigurationRow,operation:RemoteConfigurationOperation){if(locked.current)return;locked.current=true;setBusy(row.id);setError('');const e=epoch.current;try{const result=await api<RemoteConfigurationPlan>('remote-configuration/plan',{id:host.id,configurationId:row.id,operation});if(e===epoch.current)setPlan(result);}catch(err){if(e===epoch.current)setError(errorText(err));}finally{locked.current=false;setBusy(undefined);}}
 async function apply(){if(!plan||locked.current)return;const p=plan,e=epoch.current;locked.current=true;setBusy(p.configurationId);setPlan(undefined);setError('');try{const result=await api<RemoteConfigurationRow>('remote-configuration/apply',{id:host.id,configurationId:p.configurationId,planId:p.id,confirm:true});if(e===epoch.current){setRows(rows=>rows.map(row=>row.id===result.id?result:row));notify(p.operation==='uninstall'?`${p.label}已卸载，CLI、账号和登录资料保留。`:`${p.label}已${verbs[p.operation]}。可在新会话的模型选择器刷新 SSH 模型并开始验证。`);window.dispatchEvent(new Event('remote-configuration-changed'));}}catch(err){if(e===epoch.current)setError(errorText(err));}finally{locked.current=false;setBusy(undefined);}}
 async function configure(row:RemoteConfigurationRow,autoUpdate:boolean){if(!row.policy||locked.current)return;locked.current=true;setBusy(row.id);setPlan(undefined);setError('');const e=epoch.current;try{const result=await api<RemoteConfigurationRow>('remote-configuration/configure',{id:host.id,configurationId:row.id,revision:row.policy.revision,autoUpdate});if(e===epoch.current){setRows(rows=>rows.map(r=>r.id===result.id?result:r));notify('远端自动更新设置已保存并回读。');}}catch(err){if(e===epoch.current)setError(errorText(err));}finally{locked.current=false;setBusy(undefined);}}
 return <>
 {rows.map(row=><article className="remote-configuration-row" data-workbench-remote-configuration={row.id} data-testid={`remote-configuration-${row.id}`} key={row.id}>
  <div className="remote-cli-summary"><Icon name="settings" size={17}/><div className="remote-cli-description">
   <div className="remote-cli-name"><h4>{row.label}</h4><span>{row.error?'状态待核实':row.installed?(row.running?'运行中':'已安装 · 未运行'):'尚未安装'}</span></div>
   <dl><div><dt>已安装</dt><dd>{row.currentVersion??'—'}</dd></div><div><dt>本机携带</dt><dd>{row.bundledVersion}</dd></div></dl>
   <p className="remote-configuration-note">提供 SSH 模型目录、原生运行时连接与本机工具接入。</p>
  </div></div>
  <div className="remote-cli-actions">
   {row.policy&&<fieldset className="remote-cli-policies" disabled={loading||!!busy}><Toggle checked={row.policy.autoUpdate} onChange={value=>void configure(row,value)} label="自动更新"/></fieldset>}
   <button className="button secondary compact-button" disabled={loading||!!busy||!(row.installed?row.canUpdate:row.canInstall)} onClick={()=>void review(row,row.installed?'update':'install')}>{busy===row.id?'处理中…':row.installed?'检查并更新':'安装配置'}</button>
   {row.canUninstall&&<button className="icon-button" aria-label={`卸载${row.label}`} title="卸载远端配置" disabled={loading||!!busy} onClick={()=>void review(row,'uninstall')}><Icon name="trash" size={16}/></button>}
  </div>
  {row.error&&<p className="remote-cli-message inline-error" role="alert">{row.error}</p>}
  {row.policy?.autoUpdate&&<p className="remote-cli-message inline-note">新版工作台携带更新配置时，在远端空闲后自动应用；不会自动安装已卸载的配置。</p>}
  {row.policy?.lastAttemptError&&<p className="remote-cli-message inline-error" role="alert">上次自动更新未完成：{row.policy.lastAttemptError} 可手动检查。</p>}
 </article>)}
 {loading&&!rows.length&&<p className="inline-note" role="status">正在核对工作台远端配置…</p>}
 {error&&<p className="inline-error" role="alert">{error}</p>}
 {plan&&<Modal title={`${verbs[plan.operation]}${plan.label}`} onClose={()=>setPlan(undefined)}><div data-workbench-remote-configuration-plan>
  <p>{plan.operation==='uninstall'?'将停止并移除工作台提供的远端服务程序。卸载后 SSH 模型暂不可用，重新安装可继续使用已有账号。':'将应用本机工作台携带的远端配置，并核验服务启动。已有运行时或登录尚未结束时不会执行。'}</p>
  <p className="inline-note">Codex 和 Claude Code CLI、账号登录资料、工作空间及 SSH 授权均保留。</p>
  {plan.currentVersion&&<p className="inline-note">当前版本：{plan.currentVersion}</p>}{plan.version&&<p className="inline-note">目标版本：{plan.version}</p>}
  <ul className="remote-cli-targets">{plan.targets.map(target=><li key={target}>{target}</li>)}</ul>
  <div className="modal-actions"><button className="button secondary" onClick={()=>setPlan(undefined)}>取消</button><button className="button primary" data-testid="remote-configuration-confirm" onClick={()=>void apply()}>确认{verbs[plan.operation]}</button></div>
 </div></Modal>}
 </>;
}
