import { useState, useSyncExternalStore } from 'react';
import { shortcutFromEvent, shortcutIdentity, shortcutLabel } from '../../../packages/shortcuts';
import { shortcuts, type ShortcutEntry } from './shortcuts';
import { Icon, Modal } from './ui';
import './ShortcutSettings.css';

const label = (binding: string) => shortcutLabel(binding,shortcuts.mac);
const errorMessage = (error: unknown) => {
  const message=error instanceof Error?error.message:String(error);
  if(message.includes('REVISION_CONFLICT'))return '快捷键配置已在其他操作中更新，请关闭后重新编辑。';
  if(message.includes('CONFLICT'))return '该组合键已被其他功能使用，请先删除冲突绑定。';
  if(message.includes('UNKNOWN_ACTION'))return '该功能已停用，请关闭后重新选择。';
  return '未能保存快捷键，请重试。';
};
interface Recording { action: ShortcutEntry; index: number; revision: number }
export default function ShortcutSettings() {
  const entries=useSyncExternalStore(shortcuts.subscribe,shortcuts.getSnapshot);
  const [search,setSearch]=useState(''),[recording,setRecording]=useState<Recording|null>(null);
  const [candidate,setCandidate]=useState(''),[captureError,setCaptureError]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const [resetAll,setResetAll]=useState<{revision:number}|null>(null);
  const begin=(action:ShortcutEntry,index:number)=>{setError('');setCaptureError('');setCandidate('');setRecording({action,index,revision:shortcuts.getSettings().revision});};
  const change=async(operation:()=>Promise<void>,message:string)=>{
    if(busy)return;setBusy(true);setError('');setStatus('');
    try{await operation();setRecording(null);setResetAll(null);setStatus(message);}catch(error){setError(errorMessage(error));}finally{setBusy(false);}
  };
  const conflicts=recording&&candidate?entries.filter(entry=>entry.bindings.some((binding,index)=>!(entry.id===recording.action.id&&index===recording.index)&&shortcutIdentity(binding,shortcuts.mac)===shortcutIdentity(candidate,shortcuts.mac))):[];
  const query=search.trim().toLocaleLowerCase().replace(/\s/g,'');
  const visible=entries.filter(entry=>`${entry.label} ${entry.description} ${entry.owner??''} ${entry.bindings.length?entry.bindings.map(label).join(' '):'未分配'}`.toLocaleLowerCase().replace(/\s/g,'').includes(query));
  const save=()=>{
    if(!recording||!candidate||conflicts.length||captureError)return;
    const bindings=[...recording.action.bindings];if(recording.index<0)bindings.push(candidate);else bindings[recording.index]=candidate;
    void change(()=>shortcuts.save(recording.action.id,bindings,recording.revision),'快捷键已保存');
  };
  return <section className="settings-section shortcut-settings" data-workbench-shortcuts data-testid="shortcut-settings">
    <div className="shortcut-toolbar"><label className="shortcut-search"><Icon name="search" size={16}/><input aria-label="搜索快捷键" placeholder="搜索功能或快捷键" value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button className="icon-button" aria-label="清除快捷键搜索" onClick={()=>setSearch('')}><Icon name="close" size={14}/></button>}</label><button className="shortcut-reset-all" disabled={busy||!Object.keys(shortcuts.getSettings().overrides).length} onClick={()=>{setError('');setResetAll({revision:shortcuts.getSettings().revision});}}>恢复默认</button></div>
    <div className="shortcut-feedback" aria-live="polite">{!recording&&!resetAll&&error?<span role="alert">{error}</span>:status||'点击编辑录制组合键；删除后该功能将不再响应此快捷键。'}</div>
    <div className="settings-card shortcut-list">{visible.map(entry=><article className="shortcut-row" key={entry.id} data-shortcut-id={entry.id}>
      <div className="shortcut-description"><strong>{entry.label}</strong><small>{entry.description}</small>{entry.owner&&<small className="shortcut-source">插件 · {entry.owner}</small>}{entry.conflicts.length>0&&<small className="shortcut-conflict">与 {entry.conflicts.map(id=>entries.find(item=>item.id===id)?.label??id).join('、')} 冲突，请修改绑定</small>}</div>
      <div className="shortcut-bindings">{entry.bindings.length?entry.bindings.map((binding,index)=><div className="shortcut-binding" key={binding}><kbd>{label(binding)}</kbd><button className="icon-button" disabled={busy} aria-label={`编辑 ${entry.label} ${label(binding)}`} title="编辑快捷键" onClick={()=>begin(entry,index)}><Icon name="edit" size={15}/></button><button className="icon-button" disabled={busy} aria-label={`删除 ${entry.label} ${label(binding)}`} title="删除快捷键" onClick={()=>void change(()=>shortcuts.save(entry.id,entry.bindings.filter((_,i)=>i!==index),shortcuts.getSettings().revision),'已删除快捷键')}><Icon name="trash" size={15}/></button></div>):<div className="shortcut-binding"><span className="shortcut-unassigned">未分配</span><button className="icon-button" disabled={busy} aria-label={`设置 ${entry.label} 快捷键`} title="设置快捷键" onClick={()=>begin(entry,-1)}><Icon name="edit" size={15}/></button></div>}</div>
      <div className="shortcut-row-actions">{entry.bindings.length>0&&entry.bindings.length<8&&<button className="icon-button" disabled={busy} aria-label={`添加 ${entry.label} 快捷键`} title="添加快捷键" onClick={()=>begin(entry,-1)}><Icon name="plus" size={15}/></button>}{entry.customized&&<button className="icon-button" disabled={busy} aria-label={`恢复 ${entry.label} 默认快捷键`} title="恢复默认" onClick={()=>void change(()=>shortcuts.save(entry.id,undefined,shortcuts.getSettings().revision,true),'已恢复默认快捷键')}><Icon name="refresh" size={15}/></button>}</div>
    </article>)}</div>{!visible.length&&<p className="settings-empty">没有匹配的快捷键</p>}
    {recording&&<Modal title={`${recording.index<0?'添加':'修改'}快捷键`} subtitle={recording.action.label} className="shortcut-modal" onClose={()=>{if(!busy){setRecording(null);setError('');}}} dismissible={!busy}>
      <p>按下要使用的组合键，然后点击保存。</p>
      <div className="shortcut-recorder" data-workbench-shortcut-recorder data-autofocus tabIndex={0} role="group" aria-label="录制快捷键" data-testid="shortcut-recorder" onKeyDown={event=>{
        if(event.key==='Tab'||event.key==='Escape')return;
        event.preventDefault();event.stopPropagation();
        if(busy||event.nativeEvent.isComposing||event.keyCode===229||event.repeat)return;
        if(['Control','Alt','Shift','Meta','AltGraph'].includes(event.key))return;
        const binding=shortcutFromEvent(event.nativeEvent,shortcuts.mac);
        setCandidate(binding??'');setError('');setCaptureError(!binding?'请使用带 Ctrl、Alt 或 Command 的组合键，或功能键。系统编辑与恢复快捷键不可分配。':binding==='Shift+Enter'&&recording.action.id!=='composer-newline'?'Shift + Enter 保留用于聊天输入框换行。':'');
      }}>{candidate?<kbd>{label(candidate)}</kbd>:<span>按下快捷键…</span>}</div>
      <p className="shortcut-record-help">Esc 取消 · Tab 移动焦点 · 支持多个快捷键</p>
      <div className="shortcut-record-error" aria-live="polite">{(captureError||conflicts.length>0||error)&&<p role="alert">{captureError||(conflicts.length?`已用于「${conflicts.map(entry=>entry.label).join('」「')}」，请换一个组合键或先删除冲突绑定。`:error)}</p>}</div>
      <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>{setRecording(null);setError('');}}>取消</button><button className="button primary" data-testid="shortcut-save" disabled={busy||!candidate||!!captureError||!!conflicts.length} onClick={save}>{busy?'保存中…':'保存'}</button></div>
    </Modal>}
    {resetAll&&<Modal title="恢复默认快捷键" onClose={()=>{if(!busy){setResetAll(null);setError('');}}} dismissible={!busy}><p>恢复所有功能的默认快捷键？自定义组合键和已删除的绑定都会重置，包括当前停用插件的绑定。</p>{error&&<p role="alert">{error}</p>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>setResetAll(null)}>取消</button><button className="button primary" disabled={busy} onClick={()=>void change(()=>shortcuts.save(undefined,undefined,resetAll.revision,true),'已恢复全部默认快捷键')}>恢复默认</button></div></Modal>}
  </section>;
}
