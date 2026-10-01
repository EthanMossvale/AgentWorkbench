import {RememberedDetails} from './UiMemory';
import {useEffect,useRef,useState} from 'react';
import type {SshHost} from '../../../packages/contracts';
import type {RemoteCli,RemoteCliPlan,RemoteCliProvider,RemoteCliOperation,RemoteCliPolicy} from '../../../packages/remote-account-catalog/cli';
import {api} from './App';
import {Icon,Modal,Toggle,errorText} from './ui';
import './RemoteCliManager.css';
import RemoteConfigurationRows from './RemoteConfigurationRows';
const names={codex:'Codex CLI',claude:'Claude Code CLI'},verbs={install:'安装',update:'更新',uninstall:'卸载'};
export default function RemoteCliManager({host,notify}:{host:SshHost;notify:(v:string)=>void}){
 const [rows,setRows]=useState<RemoteCli[]>([]),[loading,setLoading]=useState(false),[busy,setBusy]=useState<Partial<Record<RemoteCliProvider,boolean>>>({}),[plan,setPlan]=useState<RemoteCliPlan>(),[error,setError]=useState(''),[rowErrors,setRowErrors]=useState<Partial<Record<RemoteCliProvider,string>>>({});
 const [configurationRefresh,setConfigurationRefresh]=useState(0);
 const epoch=useRef(0),locks=useRef(new Set<RemoteCliProvider>());
 useEffect(()=>{void load();return()=>{epoch.current++;};},[]);
 async function load(){setConfigurationRefresh(v=>v+1);const e=++epoch.current;setLoading(true);setError('');setRowErrors({});try{const value=await api<RemoteCli[]>('remote-cli/list',{id:host.id});if(e===epoch.current)setRows(value);}catch(e2){if(e===epoch.current)setError(errorText(e2));}finally{if(e===epoch.current)setLoading(false);}}
 async function configure(row:RemoteCli,key:'autoUpdate',value:boolean){if(!row.policy||locks.current.has(row.provider))return;locks.current.add(row.provider);setBusy(v=>({...v,[row.provider]:true}));setRowErrors(v=>({...v,[row.provider]:undefined}));const e=epoch.current;try{const policy=await api<RemoteCliPolicy>('remote-cli/configure',{id:host.id,provider:row.provider,revision:row.policy.revision,changes:{[key]:value}});if(e===epoch.current){setRows(v=>v.map(r=>r.provider===row.provider?{...r,policy}:r));notify('远端策略已保存并回读。');}}catch(error){if(e===epoch.current)setRowErrors(v=>({...v,[row.provider]:errorText(error)}));}finally{locks.current.delete(row.provider);if(e===epoch.current)setBusy(v=>({...v,[row.provider]:false}));}}
 async function review(provider:RemoteCliProvider,operation:RemoteCliOperation){if(locks.current.has(provider))return;locks.current.add(provider);setBusy(v=>({...v,[provider]:true}));setRowErrors(v=>({...v,[provider]:undefined}));const e=epoch.current;try{const p=await api<RemoteCliPlan>('remote-cli/plan',{id:host.id,provider,operation});if(e===epoch.current){if(operation!=='uninstall')setRows(v=>v.map(r=>r.provider===provider?{...r,latest:p.version,error:undefined,errorCode:undefined,releaseIssue:undefined}:r));setPlan(p);}}catch(err){if(e===epoch.current)setRowErrors(v=>({...v,[provider]:errorText(err)}));}finally{locks.current.delete(provider);if(e===epoch.current)setBusy(v=>({...v,[provider]:false}));}}
 async function apply(){if(!plan||locks.current.has(plan.provider))return;const p=plan,e=epoch.current;locks.current.add(p.provider);setBusy(v=>({...v,[p.provider]:true}));setRowErrors(v=>({...v,[p.provider]:undefined}));setPlan(undefined);try{const row=await api<RemoteCli>('remote-cli/apply',{id:host.id,provider:p.provider,planId:p.id,confirm:true});if(e===epoch.current){setRows(v=>v.map(r=>r.provider===row.provider?row:r));notify(`${names[p.provider]} 已${verbs[p.operation]}，账号与用户资料保留。`);}}catch(err){if(e===epoch.current)setRowErrors(v=>({...v,[p.provider]:errorText(err)}));}finally{locks.current.delete(p.provider);if(e===epoch.current){setBusy(v=>({...v,[p.provider]:false}));}}}
 return <section className="remote-cli" role="tabpanel" id="connection-panel-cli" aria-labelledby="connection-tab-cli">
 <div className="remote-cli-heading"><div><h3>配置管理</h3></div><button className="icon-button" aria-label="刷新配置管理" disabled={loading||Object.values(busy).some(Boolean)} onClick={()=>void load()}><Icon name="refresh"/></button></div>
 {loading&&<p className="inline-note" role="status">正在核对远端程序与官方发布版本…</p>}
 {rows.map(row=><article className="remote-cli-row" key={row.provider} data-testid={`remote-cli-${row.provider}`}>
  <div className="remote-cli-summary"><Icon name="terminal" size={17}/><div className="remote-cli-description">
   <div className="remote-cli-name"><h4>{names[row.provider]}</h4><span>{row.installed?(row.managed?'受管安装':'外部安装'):'尚未安装'}</span></div>
   <dl>{row.installed&&<div><dt>已安装</dt><dd>{row.version??'版本待核实'}</dd></div>}<div><dt>官方最新</dt><dd>{row.latest??'未能核实'}</dd></div></dl>
   {row.executable&&<p className="remote-cli-path" title={row.executable}>{row.executable}</p>}
  </div></div>
  <div className="remote-cli-actions">
   {row.policy?<fieldset className="remote-cli-policies" disabled={loading||busy[row.provider]}><Toggle checked={row.policy.autoUpdate} onChange={v=>void configure(row,'autoUpdate',v)} label="自动更新"/></fieldset>:<span className="inline-note">策略待刷新</span>}
   <button className="button secondary compact-button" disabled={loading||busy[row.provider]||row.busy||row.installed&&!row.managed} onClick={()=>void review(row.provider,row.installed?'update':'install')}>{busy[row.provider]?'处理中…':row.installed?'检查并更新':'安装最新版'}</button>
   {row.canUninstall&&<button className="icon-button" aria-label={`卸载 ${names[row.provider]}`} title="卸载程序" disabled={loading||busy[row.provider]||row.busy} onClick={()=>void review(row.provider,'uninstall')}><Icon name="trash" size={16}/></button>}
  </div>
  {row.busy&&<p className="remote-cli-message inline-note">使用中，暂不可维护。</p>}
  {(rowErrors[row.provider]||row.error)&&<p className="remote-cli-message inline-error" role="alert" title={rowErrors[row.provider]?undefined:row.releaseIssue?.source}>{rowErrors[row.provider]||row.error}</p>}
  {row.policy?.lastUpdateError&&<RememberedDetails memoryId="RemoteCliManager.details.1" scope={JSON.stringify([host.id,row.provider])} className="remote-cli-message remote-cli-update-error"><summary>上次自动更新未完成</summary><p className="inline-note">{row.policy.lastUpdateError} · 可手动检查</p></RememberedDetails>}
 </article>)}
 <RemoteConfigurationRows host={host} refresh={configurationRefresh} notify={notify}/>
 {error&&<p className="inline-error" role="alert">{error}</p>}
 {plan&&<Modal title={`${verbs[plan.operation]}远端 ${names[plan.provider]}`} dismissible={!busy[plan.provider]} onClose={()=>setPlan(undefined)}><p>{plan.operation==='uninstall'?'确认卸载下列工作台管理的 CLI 程序？原生登录和用户资料将保留。':`将从官方源${verbs[plan.operation]} ${plan.version}，安装前校验发布包。`}</p>{plan.currentVersion&&<p className="inline-note">当前版本：{plan.currentVersion}</p>}<ul className="remote-cli-targets">{plan.targets.map(p=><li key={p}>{p}</li>)}</ul>{plan.size&&<p className="inline-note">下载约 {Math.ceil(plan.size/1048576)} MB</p>}<div className="modal-actions"><button className="button secondary" disabled={busy[plan.provider]} onClick={()=>setPlan(undefined)}>取消</button><button className="button primary" data-testid="remote-cli-confirm" disabled={busy[plan.provider]} onClick={()=>void apply()}>{busy[plan.provider]?'正在处理…':`确认${verbs[plan.operation]}`}</button></div></Modal>}
 </section>;
}
