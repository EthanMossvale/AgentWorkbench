import {useEffect,useRef,useState} from 'react';
import type {SharedAccount,SshHost} from '../../../packages/contracts';
import type {NativeRuntimeStatus} from '../../../packages/workspace-control/native-runtime';
import {api} from './App';
import {errorText,Icon,Modal} from './ui';
import RemoteBrowserManager from './RemoteBrowserManager';

export default function NativeAccountState({host,account,notify}:{host:SshHost;account:SharedAccount;notify?:(text:string)=>void}){
 const [browser,setBrowser]=useState(false),[removing,setRemoving]=useState(false);
 const [value,setValue]=useState<NativeRuntimeStatus>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const epoch=useRef(0),locked=useRef(false);
 const identity=JSON.stringify([host.id,host.hostname,host.port,host.username,host.role,host.ownerId,host.workspaceGeneration,host.identityFile,host.knownHostsFile]);
 useEffect(()=>{epoch.current++;locked.current=false;setBusy(false);setValue(undefined);setError('');return()=>{epoch.current++;};},[identity,account.id,account.generation]);
 const act=async(method:'status'|'review'|'login-command')=>{
  if(locked.current)return;locked.current=true;setBusy(true);setError('');const version=epoch.current;
  try{if(method==='login-command'){const result=await api<{command:string}>('native-accounts/login-command',{id:host.id,accountId:account.id});if(version!==epoch.current)return;await api('clipboard/write',{text:result.command});notify?.('原生登录命令已复制，请在该 VPS 的管理员终端完成官方登录。');}
   else {const result=await api<NativeRuntimeStatus>('native-accounts/'+method,{id:host.id,accountId:account.id});if(version===epoch.current)setValue(result);}
  }catch(e){if(version===epoch.current)setError(errorText(e));}finally{if(version===epoch.current){locked.current=false;setBusy(false);}}
 };
 const block=value?.block?.reason;
 return <div className="native-account-state" data-testid={`native-state-${account.id}`}>
  <div className="native-account-line"><span>{!value?'尚未核实':!value.versionMatched?'运行时版本待核实':!value.authenticated?'待完成原生登录':block?({rate_limited:'账号额度已达限制',authentication_required:'原生认证待恢复',billing_review:'账单状态待核实'}[block]):'原生登录已核实'}</span><button className="text-button" disabled={busy} onClick={()=>void act('status')}>{busy?'核实中…':'核实状态'}</button>{host.role==='admin'&&account.provider==='claude'&&<button className="text-button" onClick={()=>setBrowser(true)}>远端浏览器登录</button>}{host.role==='admin'&&<button className="text-button" disabled={busy} onClick={()=>void act('login-command')}>复制官方登录命令</button>}</div>
  {value&&<p className="native-account-detail">{value.version??'版本未知'} · {value.execution==='local-tools-unverified'?'本机工具链待验收':value.execution==='local-executor-required'?'本机执行就绪以此会话的能力验收为准':'运行服务待就绪'}</p>}
  {block&&host.role==='admin'&&<button className="text-button" disabled={busy} onClick={()=>void act('review')}>重新读取原生状态并核实恢复</button>}
  {host.role==='admin'&&<button className="icon-button" aria-label="移除共享账号" title="移除共享账号" disabled={busy} onClick={()=>setRemoving(true)}><Icon name="trash" size={16}/></button>}
  {browser&&<Modal title="Claude · 远端浏览器登录" onClose={()=>setBrowser(false)}><RemoteBrowserManager host={host} account={account} notify={notify??(()=>{})}/></Modal>}
  {removing&&<Modal title="移除共享账号" dismissible={!busy} onClose={()=>setRemoving(false)}><p>退出并移除「{account.displayName??account.email??account.id}」？所有工作空间将不能再使用此账号。</p><p className="inline-note">使用官方 CLI 退出登录。历史会话、配置、记忆和技能保留，账号不再显示在共享列表中。</p>{error&&<p className="inline-error">{error}</p>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setRemoving(false)}>取消</button><button className="button primary" disabled={busy} onClick={async()=>{if(locked.current)return;locked.current=true;setBusy(true);setError('');try{await api('native-accounts/remove',{id:host.id,accountId:account.id,confirm:true});setRemoving(false);notify?.('账号已退出并移除。');}catch(e){setError(errorText(e));}finally{locked.current=false;setBusy(false);}}}>确认退出并移除</button></div></Modal>}
  {error&&<p className="inline-error" role="alert">{error}</p>}
 </div>;
}
