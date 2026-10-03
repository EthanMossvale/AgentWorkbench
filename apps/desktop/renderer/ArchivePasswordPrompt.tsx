import {useState} from 'react';
import type {ArchivePasswordRequest,ArchiveUnlock} from '../../../packages/native-resources/archive-types';

export default function ArchivePasswordPrompt({request,busy,onUnlock,onCancel}:{request:ArchivePasswordRequest;busy:boolean;onUnlock:(value:ArchiveUnlock)=>void;onCancel:()=>void}){
 const [password,setPassword]=useState('');
 return <form data-workbench-archive-password onSubmit={event=>{event.preventDefault();const value=password;setPassword('');onUnlock({filePath:request.filePath,password:value});}}>
  <p className="skill-import-hint">{request.incorrect?'密码不正确，请重新输入。':'此 ZIP 已加密，请输入解压密码。'}</p>
  <label>压缩包密码<input aria-label="压缩包密码" type="password" autoComplete="off" autoFocus disabled={busy} value={password} onChange={event=>setPassword(event.target.value)} onKeyDown={event=>{if(event.nativeEvent.isComposing&&event.key==='Enter')event.preventDefault();}}/></label>
  <div className="modal-actions"><button className="button secondary" type="button" disabled={busy} onClick={onCancel}>选择其他文件</button><button className="button primary" type="submit" disabled={busy}>{busy?'正在解压…':'解压并导入'}</button></div>
 </form>;
}
