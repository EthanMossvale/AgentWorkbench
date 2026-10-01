import {RememberedDetails} from './UiMemory';
import {useEffect,useRef,useState,type DragEvent} from 'react';
import type {SshHost} from '../../../packages/contracts';
import type {HostKeyPreview,SshConfigEntry,SshFileSelection} from '../host/ssh-onboarding';
import {api} from './App';
import {Field,Icon,Modal,errorText} from './ui';
import {ConnectionAddress} from './ConnectionAddress';
import './HostConnectionDialog.css';

interface Props {host:SshHost;onChange:(host:SshHost)=>void;onSave:(host:SshHost)=>Promise<void>;onClose:()=>void}
const identity=(host:SshHost)=>JSON.stringify([host.hostname,host.port,host.username,host.role,host.identityFile,host.knownHostsFile]);
const filename=(file:string)=>file.split(/[\\/]/).at(-1);
export default function HostConnectionDialog({host,onChange,onSave,onClose}:Props){
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[keySelection,setKeySelection]=useState(''),[entries,setEntries]=useState<SshConfigEntry[]>([]),[trust,setTrust]=useState<HostKeyPreview|null>(null),[confirmed,setConfirmed]=useState(false);
 const original=useRef(identity(host)),guard=useRef(false),depth=useRef(0);
 const [dragging,setDragging]=useState(false);
 useEffect(()=>{const preventNavigation=(event:globalThis.DragEvent)=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();};window.addEventListener('dragover',preventNavigation);window.addEventListener('drop',preventNavigation);return()=>{window.removeEventListener('dragover',preventNavigation);window.removeEventListener('drop',preventNavigation);};},[]);
 const patch=(changes:Partial<SshHost>)=>{if(guard.current)return;if(changes.hostname!==undefined||changes.port!==undefined){changes.knownHostsFile='';setTrust(null);setConfirmed(false);}setError('');onChange({...host,...changes});};
 const chooseEntry=(entry:SshConfigEntry)=>{setTrust(null);setConfirmed(false);setEntries([]);setKeySelection(entry.keySelectionId??'');onChange({...host,...entry});};
 const pick=async(kind:'key'|'known-hosts',file?:File)=>{if(guard.current)return;guard.current=true;setBusy(file?'正在识别文件…':'正在选择文件…');setError('');try{const result=file?await window.workbench.importSshFile(file) as SshFileSelection:await api<SshFileSelection|null>('ssh/pick-file',{kind});if(!result)return;if(result.entries){if(result.entries.length===1)chooseEntry(result.entries[0]!);else setEntries(result.entries);}else if(result.path){setEntries([]);onChange({...host,[kind==='key'?'identityFile':'knownHostsFile']:result.path});if(kind==='key')setKeySelection(result.keySelectionId??'');}}catch(error){setError(errorText(error));}finally{guard.current=false;setBusy('');}};
 const drop=(event:DragEvent)=>{event.preventDefault();event.stopPropagation();depth.current=0;setDragging(false);if(guard.current||!event.dataTransfer.types.includes('Files'))return;const files=[...event.dataTransfer.files];if(files.length!==1){setError('请一次拖入一个 SSH 密钥或连接配置文件。');return;}void pick('key',files[0]!);};
 const connect=async()=>{
  if(guard.current)return;guard.current=true;setBusy('正在核实…');setError('');
  let next={...host,name:host.name.trim()||`${host.hostname} · ${host.role==='admin'?'管理员':'成员'}`};
  try{
   if(!next.identityFile)throw Error('请先选择 VPS 提供的 SSH 密钥文件。');
   if(!next.knownHostsFile){
    if(!trust||!confirmed){setBusy('正在读取服务器身份…');setTrust(await api<HostKeyPreview>('ssh/scan-host-key',{hostname:next.hostname,port:next.port}));setConfirmed(false);return;}
    const saved=await api<{path:string}>('ssh/trust-host-key',{previewId:trust.id,hostname:next.hostname,port:next.port,confirm:true});next={...next,knownHostsFile:saved.path};onChange(next);
   }
   if(keySelection){setBusy('正在保存本机密钥…');const saved=await api<{path:string}>('ssh/install-key',{selectionId:keySelection,confirm:true});next={...next,identityFile:saved.path};setKeySelection('');}
   onChange(next);
   if(!host.id||original.current!==identity(next)){setBusy('正在验证 SSH 登录…');await api('ssh/verify',{host:next});}
   setBusy('正在保存连接…');await onSave(next);
  }catch(error){setError(errorText(error));}finally{guard.current=false;setBusy('');}
 };
 return <Modal className="ssh-connection-dialog" title={host.id?'编辑 SSH 连接':'连接你的服务器'} subtitle="准备好服务器地址和登录密钥，其余交给工作台。" dismissible={!busy} onClose={onClose}>
  <form onSubmit={event=>{event.preventDefault();void connect();}}>
   <div className="ssh-role-tabs" role="radiogroup" aria-label="连接角色">{([['admin','管理员','管理空间与设备'],['workspace','成员','使用已授权空间']] as const).map(([role,title,note])=><button type="button" role="radio" aria-checked={host.role===role} data-testid={`host-role-${role}`} disabled={!!busy} key={role} onClick={()=>patch({role,username:role==='admin'&&!host.username?'root':host.username})}><Icon name={role==='admin'?'shield':'user'} size={17}/><span>{title}<small>{note}</small></span></button>)}</div>
   <section className="ssh-key-section"><div className="ssh-step-label"><span>01</span><h3>选择登录密钥</h3></div><button type="button" className={`ssh-key-picker${host.identityFile?' has-file':''}${dragging?' is-dragging':''}`} data-testid="host-pick-key" disabled={!!busy} onClick={()=>void pick('key')} onDragEnter={event=>{event.preventDefault();event.stopPropagation();if(!guard.current&&event.dataTransfer.types.includes('Files')){depth.current++;setDragging(true);}}} onDragLeave={event=>{event.preventDefault();event.stopPropagation();depth.current=Math.max(0,depth.current-1);if(!depth.current)setDragging(false);}} onDragOver={event=>{event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=guard.current?'none':'copy';}} onDrop={drop} aria-describedby="ssh-file-hint"><Icon name="document" size={22}/><span><strong aria-live="polite">{dragging?'松开即可选择文件':host.identityFile?filename(host.identityFile):'选择 VPS 提供的 SSH 密钥文件'}</strong><small>{host.identityFile?'点击或拖入文件可更换':'将文件拖到这里，或点击选择'}</small></span><Icon name={host.identityFile?'check':'plus'} size={17}/></button><p className="inline-note" id="ssh-file-hint">支持 OpenSSH 私钥，也可导入 SSH 连接配置自动填写地址等信息。确认连接时将密钥复制到本机 .ssh/agent-workbench，保留原文件；暂不支持需要口令的密钥。</p></section>
   {!!entries.length&&<div className="ssh-config-choices" role="group" aria-label="选择配置中的服务器">{entries.map((entry,index)=><button type="button" key={index} onClick={()=>chooseEntry(entry)}><strong>{entry.name}</strong><ConnectionAddress hostname={entry.hostname} port={entry.port} control={false}/></button>)}</div>}
   <div className="ssh-step-label"><span>02</span><h3>填写服务器信息</h3></div>
   <div className="ssh-server-fields"><Field label="服务器 IP / 域名"><input data-testid="hostname" autoComplete="off" required disabled={!!busy} value={host.hostname} onChange={event=>patch({hostname:event.target.value.trim()})} placeholder="VPS 控制台中的公网地址"/></Field><Field label="SSH 端口"><input data-testid="port" type="number" min={1} max={65535} required disabled={!!busy} value={host.port} onChange={event=>patch({port:Number(event.target.value)})}/></Field></div>
   <Field label="服务器用户名" hint="root 是 Linux 内置管理员。若服务商给了其它账号，请填写那个账号；这里不能随意起名。"><input data-testid="username" autoComplete="off" required disabled={!!busy} value={host.username} onChange={event=>patch({username:event.target.value})} placeholder="例如 root 或 ubuntu"/></Field>
   <Field label="连接名称（可选）"><input data-testid="host-name" maxLength={100} disabled={!!busy} value={host.name} onChange={event=>patch({name:event.target.value})} placeholder="给连接起一个好认的名字"/></Field>
   <RememberedDetails memoryId="HostConnectionDialog.details.1" className="ssh-advanced"><summary>高级设置（可选，通常无需设置）</summary><p className="inline-note">无需选择 known_hosts 也能连接。首次连接时，工作台读取服务器指纹，经你向服务商或管理员核对后自动保存身份记录。</p><p className="inline-note">known_hosts 记录服务器公钥，用来识别服务器、防止连错。它不是登录密钥，单独导入不能获得登录权限；仅在你已有可信身份记录时使用。</p>{host.knownHostsFile&&<p className="inline-note">已有身份记录：{filename(host.knownHostsFile)}</p>}<button type="button" className="text-button" disabled={!!busy} onClick={()=>void pick('known-hosts')}>选择已有可信记录（可选）</button>{host.knownHostsFile&&<button type="button" className="text-button" disabled={!!busy} onClick={()=>{setTrust(null);setConfirmed(false);patch({knownHostsFile:''});}}>改为连接时核对</button>}{host.identityFile&&<p className="mono">密钥路径：{host.identityFile}</p>}</RememberedDetails>
   {trust&&!host.knownHostsFile&&<section className="ssh-host-trust" data-testid="ssh-host-trust"><h3>核对服务器身份</h3><ConnectionAddress hostname={trust.hostname} port={trust.port}/>{trust.fingerprints.map(value=><code key={value}>{value}</code>)}<p className="inline-note">请与 VPS 控制台或管理员提供的指纹核对。直接从网络读取的指纹不能独立证明服务器可信。</p><label className="checkbox-label"><input type="checkbox" data-testid="ssh-confirm-fingerprint" checked={confirmed} disabled={!!busy} onChange={event=>setConfirmed(event.target.checked)}/>我已向服务商或管理员核对，指纹一致</label></section>}
   {error&&<p className="inline-error" role="alert" data-testid="ssh-connection-error">{error}</p>}
   <div className="modal-actions"><button type="button" className="button secondary" disabled={!!busy} onClick={onClose}>取消</button><button className="button primary" data-testid="save-host" disabled={!!busy||!!trust&&!host.knownHostsFile&&!confirmed}>{busy||(!host.id?'连接并保存':'保存连接')}</button></div>
  </form>
 </Modal>;
}
