import {RememberedTextarea} from './UiMemory';
import { useEffect, useRef, useState } from 'react';
import type { AccountImportFormat, AccountLogin, AccountLoginMethod, LocalModelAccount, LoginMethod } from '../../../packages/model-management/types';
import { api } from './App';
import { Modal, errorText } from './ui';
import './AccountLoginDialog.css';

const messages: Record<string,string> = {
  LOCAL_ACCOUNT_DESKTOP_MISSING:'未检测到本机 Codex 桌面端，可选择 OAuth 或设备码授权。',
  LOCAL_ACCOUNT_METHOD_UNAVAILABLE:'此登录方式已停用或不可用，请重新选择。',
  LOCAL_ACCOUNT_RUNTIME_MISSING:'请先安装对应的官方 CLI。',
  LOCAL_ACCOUNT_RUNTIME_BUSY:'官方 CLI 正在维护，请稍后再试。',
  LOCAL_ACCOUNT_BROWSER_UNAVAILABLE:'未能自动打开浏览器。请复制授权链接，或点击“在浏览器中打开”。',
  LOCAL_ACCOUNT_CALLBACK_INVALID:'回调地址不属于本次授权。请粘贴当前浏览器地址栏中的完整回调地址。',
  LOCAL_ACCOUNT_CALLBACK_UNREACHABLE:'无法连接本次原生回调服务，请检查登录是否已超时或取消。',
  LOCAL_ACCOUNT_CALLBACK_REJECTED:'原生登录服务拒绝了此回调，请重新授权。',
  LOCAL_ACCOUNT_CALLBACK_PORT_BUSY:'本机已有授权占用回调端口。请完成现有登录，或改用设备码；不会中断其他客户端的授权。',
  LOCAL_ACCOUNT_DESKTOP_START_FAILED:'官方桌面窗口未能启动，请使用 OAuth 或设备码授权。',
  LOCAL_ACCOUNT_DESKTOP_CLOSED:'官方桌面窗口已关闭，尚未完成登录。',
  LOCAL_ACCOUNT_DESKTOP_CLEANUP_FAILED:'独立登录窗口的清理未确认，请先检查该窗口。',
  LOCAL_ACCOUNT_EXTENSION_CLEANUP_FAILED:'登录方式的清理未确认，请检查所属授权窗口后再试。',
  LOCAL_ACCOUNT_LOGIN_EXPIRED:'本次授权已超时，请重新发起。',
  LOCAL_ACCOUNT_LOGIN_UNVERIFIED:'登录或模型目录尚未核实，可在账号详情中刷新状态。',
  LOCAL_ACCOUNT_EMAIL_UNAVAILABLE:'原生账号尚未返回邮箱，暂不生成卡片；请重新核实。',
  LOCAL_ACCOUNT_LOGIN_FAILED:'官方授权未启动成功，请检查网络与 CLI 后重试。',
  LOCAL_ACCOUNT_LOGIN_INTERRUPTED:'原生授权进程已中断，请重新发起。',
  LOCAL_ACCOUNT_LOGIN_REJECTED:'官方未确认此次授权，请重新发起。',
  LOCAL_ACCOUNT_IMPORT_JSON_INVALID:'JSON 格式不完整，请检查粘贴或导入的文件。',
  LOCAL_ACCOUNT_IMPORT_INVALID:'未识别到完整的 Codex 凭据，请核对格式与必填字段。',
  LOCAL_ACCOUNT_IMPORT_JWT_INVALID:'accessToken 需要完整 JWT；仅有 refresh_token 时请选择对应格式。',
  LOCAL_ACCOUNT_IMPORT_IDENTITY_INVALID:'Agent Identity 缺少原生身份字段。',
  LOCAL_ACCOUNT_IMPORT_ACCOUNT_ID_REQUIRED:'缺少账号 ID，且无法从原始令牌中读取。请使用完整账号 JSON。',
  LOCAL_ACCOUNT_IMPORT_EXISTS:'此独立目录已有登录资料，未覆盖。请添加新账号导入，或刷新现有状态。',
  LOCAL_ACCOUNT_IMPORT_TARGET_INVALID:'此账号已登录或不支持该导入方式，请添加新的 Codex 账号。',
  LOCAL_ACCOUNT_IMPORT_NOT_CODEX:'文件包含非 Codex 订阅凭据；API Key 请在模型 API 连接中添加。',
  LOCAL_ACCOUNT_IMPORT_SIZE:'请提供不超过 2 MB 的凭据文本或 JSON 文件。',
  LOCAL_ACCOUNT_IMPORT_LIMIT:'每批最多导入 100 个账号。',
  LOCAL_ACCOUNT_IMPORT_DUPLICATE:'本批包含重复凭据，请移除重复项。',
  LOCAL_ACCOUNT_IMPORT_REFRESH_FAILED:'refresh_token 兑换未成功；未自动重试，请核对令牌与网络。',
  LOCAL_ACCOUNT_IMPORT_FORMAT_UNAVAILABLE:'此导入格式已停用，请重新选择。',
  LOCAL_ACCOUNT_CHANGED:'账号已被更新，请关闭后重新打开。',
  LOCAL_ACCOUNT_BUSY:'此账号仍有进行中的操作，请先完成或取消。',
};
const describe = (error:unknown) => messages[errorText(error)] ?? (errorText(error).startsWith('LOCAL_')?'此次账号操作未确认，请刷新状态后重试。':errorText(error));
const active = (job?:AccountLogin) => !!job && ['waiting','verifying'].includes(job.status);

export default function AccountLoginDialog({account,onClose,refresh}:{account:LocalModelAccount;onClose():void;refresh():Promise<unknown>}) {
  const [tab,setTab]=useState<'login'|'import'>('login'),[methods,setMethods]=useState<AccountLoginMethod[]>([]),[formats,setFormats]=useState<AccountImportFormat[]>([]);
  const [method,setMethod]=useState<LoginMethod>('browser'),[format,setFormat]=useState('auto'),[job,setJob]=useState<AccountLogin>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [code,setCode]=useState(''),[callback,setCallback]=useState(''),[contents,setContents]=useState('');
  const live=useRef(true),lifetime=useRef(0),locked=useRef(false),current=useRef<AccountLogin|undefined>(undefined),initialized=useRef(false),file=useRef<HTMLInputElement>(null),importedIds=useRef([account.id]);
  const [pendingImports,setPendingImports]=useState<string[]>([]);
  const accept=(value:AccountLogin)=>{if(current.current?.id===value.id&&!active(current.current)&&active(value))return;current.current=value;if(live.current)setJob({...value});};
  useEffect(()=>{
    live.current=true;const generation=++lifetime.current;let revision=0;
    const load=async()=>{const attempt=++revision;try{const [m,f]=await Promise.all([api<AccountLoginMethod[]>('models/accounts/login-methods',{id:account.id}),account.provider==='codex'?api<AccountImportFormat[]>('models/accounts/import-formats',{id:account.id}):Promise.resolve([])]);if(!live.current||attempt!==revision)return;setMethods(m);setFormats(f);if(!initialized.current){initialized.current=true;setMethod(m.find(v=>v.available)?.id??'browser');}}catch(e){if(live.current)setError(describe(e));}};
    void load();const stop=window.workbench?.onExtensions?.(()=>void load());
    return()=>{live.current=false;revision++;stop?.();queueMicrotask(()=>{if(live.current||lifetime.current!==generation)return;const j=current.current;void(async()=>{if(active(j))await api('models/accounts/login-cancel',{id:account.id,jobId:j!.id});for(const id of importedIds.current)await api('models/accounts/draft-discard',{id});})().catch(()=>{});});};
  },[account.id]);
  useEffect(()=>{
    if(!active(job))return;let stopped=false,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const next=await api<AccountLogin>('models/accounts/login-status',{id:account.id,jobId:job!.id});if(stopped)return;accept(next);if(next.status==='complete')await refresh();if(active(next))timer=setTimeout(poll,1000);}catch(e){if(!stopped){setError(describe(e));timer=setTimeout(poll,2500);}}};
    timer=setTimeout(poll,500);return()=>{stopped=true;clearTimeout(timer);};
  },[job?.id,job?.status]);
  const run=async(action:()=>Promise<void>)=>{if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');try{await action();}catch(e){if(live.current)setError(describe(e));}finally{locked.current=false;if(live.current)setBusy(false);}};
  const close=()=>void run(async()=>{if(active(current.current))accept(await api<AccountLogin>('models/accounts/login-cancel',{id:account.id,jobId:current.current!.id}));for(const id of importedIds.current)await api('models/accounts/draft-discard',{id});setContents('');setCode('');setCallback('');onClose();});
  const start=()=>void run(async()=>{const next=await api<AccountLogin>('models/accounts/login-start',{id:account.id,revision:account.revision,method});if(!live.current){await api('models/accounts/login-cancel',{id:account.id,jobId:next.id});await api('models/accounts/draft-discard',{id:account.id});return;}accept(next);});
  const copy=(text:string)=>void run(async()=>{await api('clipboard/write',{text});if(live.current)setNotice('已复制');});
  const verifyImports=async(ids:string[])=>{const pending:string[]=[];for(const id of ids){if(!live.current){await api('models/accounts/draft-discard',{id});continue;}try{const next=await api<LocalModelAccount>('models/accounts/refresh',{id});if(next.status!=='authenticated'||!next.models.length)pending.push(id);}catch{pending.push(id);}}await refresh();if(live.current){setPendingImports(pending);setNotice(`已核实 ${ids.length-pending.length} 个账号。${pending.length?`${pending.length} 个尚未核实，未生成卡片。`:'账号卡片已生成。'}`);}};
  const importAccounts=()=>void run(async()=>{
    const input=contents;setContents('');
    const result=await api<{imported:number;accounts:LocalModelAccount[];failure?:string;remaining?:number}>('models/accounts/import',{id:account.id,revision:account.revision,format,contents:input});
    importedIds.current=result.accounts.map(a=>a.id);await verifyImports(importedIds.current);if(result.failure&&live.current)setError(`本批已保存 ${result.imported} 个，另有 ${result.remaining} 个未导入。${describe(result.failure)}`);
  });
  const waiting=active(job),selected=methods.find(m=>m.id===method);
  return <Modal title={(account.provider==='codex'?'Codex':'Claude')+' · 官方登录'} dismissible={!busy} onClose={close}>
    <div className="model-login model-account-login" data-account-id={account.id}>
      <p>{account.name}</p>
      {account.provider==='codex'&&<div className="model-login-tabs" role="tablist" aria-label="账号接入"><button role="tab" aria-selected={tab==='login'} disabled={busy||waiting} onClick={()=>setTab('login')}>官方登录</button><button role="tab" aria-selected={tab==='import'} disabled={busy||waiting} onClick={()=>setTab('import')}>Token / JSON</button></div>}
      {tab==='login'?<>
        <div className="model-login-tabs account-method-tabs" role="tablist" aria-label="登录方式">{methods.map(item=><button key={item.id} role="tab" aria-selected={method===item.id} disabled={busy||waiting||!item.available} title={!item.available?describe(item.reason):item.description} onClick={()=>{setMethod(item.id);setError('');setNotice('');}}>{item.label}</button>)}</div>
        {!initialized.current&&<p className="model-usage-note">正在检测可用登录方式…</p>}
        <p className="model-usage-note">{selected?.description??'当前登录方式不可用，请重新选择。'}</p>
        {account.provider==='codex'&&methods.some(m=>m.id==='desktop'&&!m.available)&&<p className="model-usage-note">未检测到 Codex 桌面端，官方客户端入口不可用。</p>}
        <p className="model-usage-note">登录资料保存在此账号独立的原生目录。{method==='desktop'?'完成后仅关闭本次独立窗口并清理其临时界面配置。':''}</p>
        {job&&<div className="model-login-status" role="status">
          <span>{{waiting:method==='desktop'?'请在独立官方窗口中继续登录':'等待官方授权',verifying:'正在核实登录与模型目录',complete:'登录已核实',cancelled:'已取消',failed:'登录未完成'}[job.status]}</span>
          {job.userCode&&<div className="account-auth-code"><strong className="model-device-code">{job.userCode}</strong><button className="text-button" disabled={busy} onClick={()=>copy(job.userCode!)}>复制设备码</button></div>}
          {job.url&&<div className="account-auth-link"><label>授权链接<input aria-label="授权链接" readOnly value={job.url}/></label><button className="text-button" disabled={busy} onClick={()=>copy(job.url!)}>复制链接</button><button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await api('models/accounts/login-open',{id:account.id,jobId:job.id});})}>在浏览器中打开</button></div>}
          {job.browserError&&<p className="model-usage-note">{describe(job.browserError)}</p>}
          {job.callbackSupported&&job.status==='waiting'&&<form className="model-login-code" onSubmit={event=>{event.preventDefault();void run(async()=>{const url=callback.trim();setCallback('');accept(await api<AccountLogin>('models/accounts/login-callback',{id:account.id,jobId:job.id,url}));});}}><label>手动粘贴回调地址<input aria-label="手动粘贴回调地址" type="password" autoComplete="off" value={callback} onChange={e=>setCallback(e.target.value)} placeholder="http://localhost:1455/auth/callback?code=…&state=…" maxLength={16384}/></label><button className="button secondary" type="submit" disabled={busy||!callback.trim()}>我已授权，继续</button></form>}
          {job.userCode&&<p className="model-usage-note">若官方提示设备码授权未开启，请先在 ChatGPT 安全设置中启用。设备码无需本机回调端口。</p>}
          {job.codeRequested&&<form className="model-login-code" onSubmit={event=>{event.preventDefault();void run(async()=>{const input=code.trim();setCode('');accept(await api<AccountLogin>('models/accounts/login-code',{id:account.id,jobId:job.id,code:input}));});}}><label>官方临时授权码<input type="password" aria-label="官方临时授权码" autoComplete="off" value={code} onChange={e=>setCode(e.target.value)} maxLength={4096}/></label><button className="button secondary" type="submit" disabled={busy||!code.trim()}>提交授权码</button></form>}
          {job.error&&<p className="inline-error">{describe(job.error)}</p>}
        </div>}
      </>:<div className="model-account-import">
        <label>凭据格式<select aria-label="凭据格式" disabled={busy} value={format} onChange={e=>setFormat(e.target.value)}>{!formats.some(f=>f.id===format)&&<option value={format} disabled>所选格式不可用</option>}{formats.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
        <p className="model-usage-note">支持 auth.json、Agent Identity、账号 JSON、Sub2API / CPA JSON、accessToken、个人访问令牌 at-… 和 refresh_token；JSON 账号数组可批量导入。</p>
        <label>凭据内容<RememberedTextarea memoryId="AccountLoginDialog.editor.1" aria-label="凭据内容" autoComplete="off" spellCheck={false} disabled={busy} value={contents} onChange={e=>setContents(e.target.value)} placeholder="粘贴凭据或选择本地 JSON 文件"/></label>
        <input ref={file} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={event=>{const selected=event.target.files?.[0];event.target.value='';if(!selected)return;void run(async()=>{if(selected.size>2*1024*1024)throw Error('LOCAL_ACCOUNT_IMPORT_SIZE');const text=await selected.text();if(live.current)setContents(text);});}}/>
        <button className="button secondary" disabled={busy} onClick={()=>file.current?.click()}>从本地文件选择</button>
        <p className="model-usage-note">不会覆盖已有登录资料。提交后清空输入；仅 refresh_token 会进行一次官方兑换。</p>
      </div>}
      {notice&&<p className="model-usage-note" role="status">{notice}</p>}{pendingImports.length>0&&<button className="text-button" disabled={busy} onClick={()=>void run(()=>verifyImports(pendingImports))}>重新核实导入账号</button>}{job?.status==='failed'&&<button className="text-button" disabled={busy} onClick={()=>void run(()=>verifyImports([account.id]))}>重新核实登录</button>}{error&&<p className="inline-error" role="alert">{error}</p>}
      <footer className="modal-actions"><button className="button secondary" disabled={busy} onClick={close}>{waiting?'取消本次登录':'关闭'}</button>{tab==='login'?!waiting&&job?.status!=='complete'&&<button className="button primary" disabled={busy||!selected?.available} onClick={start}>{busy?'准备中…':'开始官方登录'}</button>:<button className="button primary" disabled={busy||!contents.trim()||!formats.some(f=>f.id===format)} onClick={importAccounts}>{busy?'导入与核实中…':'导入并核实'}</button>}</footer>
    </div>
  </Modal>;
}
