import { useEffect, useState } from 'react';
import type { ForkLocation, Session } from '../../../packages/contracts';
import type { WorktreeInspection } from '../../../packages/worktrees';
import { api } from './App';
import { Icon, Modal, errorText } from './ui';
import './ForkDialog.css';

export interface ForkOptions { busy?:boolean; workspace:WorktreeInspection; worktree:WorktreeInspection }
export const hasWorktreeChoice=(options:ForkOptions|null)=>!!(options?.worktree.available||options?.worktree.repositoryRoot);
export function useForkOptions(sessionId?: string, messageId?: string) {
  const [result,setResult]=useState<{sessionId:string;messageId?:string;options:ForkOptions}|null>(null);
  useEffect(()=>{
    let live=true,timer:ReturnType<typeof setTimeout>|undefined;setResult(null);
    const load=()=>{if(sessionId)void api<ForkOptions>('session/fork-options',{sessionId,messageId}).then(options=>{
      if(live){setResult({sessionId,messageId,options});if(options.busy)timer=setTimeout(load,500);}
    }).catch(error=>{if(live)setResult({sessionId,messageId,options:{workspace:{available:false,reason:errorText(error)},worktree:{available:false,reason:errorText(error)}}});});};
    load();return()=>{live=false;clearTimeout(timer);};
  },[sessionId,messageId]);
  return result?.sessionId===sessionId&&result?.messageId===messageId?result?.options??null:null;
}
export default function ForkDialog({session,messageId,initialOptions,busy,error,onChoose,onClose}:{session:Session;messageId?:string;initialOptions:ForkOptions;busy:boolean;error?:string;onChoose:(location:ForkLocation)=>void;onClose:()=>void}) {
  const options=useForkOptions(session.id,messageId)??initialOptions;
  return <Modal title="从这里创建聊天分支" className="fork-dialog" onClose={onClose} dismissible={!busy}>
    <div className="fork-choices" data-testid="fork-location-picker" data-workbench-fork-picker data-session-id={session.id} data-message-id={messageId}>
      <button data-testid="fork-here" data-autofocus disabled={busy||!options?.workspace.available} onClick={()=>onChoose('workspace')}><Icon name="desktop" size={17}/><span><strong>在此工作空间中创建分支</strong><small>{options?.workspace.reason??'保留当前目录，从此消息继续聊天'}</small></span></button>
      <button data-testid="fork-worktree" disabled={busy||!options?.worktree.available} onClick={()=>onChoose('worktree')}><Icon name="branch" size={17}/><span><strong>在新工作树中创建分支</strong><small>{!options?'正在检查 Git 工作区…':options.worktree.reason??'复制当前已跟踪修改和未忽略文件，独立继续'}</small></span></button>
    </div>
    {busy&&<p className="fork-note" role="status">正在创建分支…</p>}{error&&<p className="inline-error" role="alert">{error}</p>}
  </Modal>;
}
