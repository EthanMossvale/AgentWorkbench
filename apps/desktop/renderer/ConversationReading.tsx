import {RememberedDetails,UiMemoryScope} from './UiMemory';
import { Fragment, createContext, memo, useCallback, useContext, useDeferredValue, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import {uiPreferences} from './ui-preferences';
import { createPortal } from 'react-dom';
import type { Session } from '../../../packages/contracts';
import { readingTurns, type ReadingTurn } from '../../../packages/collaboration-core/reading-turns';
import type { ConversationEntry } from '../../../packages/collaboration-core/timeline';
import { Icon } from './ui';
import TurnProgress from './TurnProgress';
import ActivityGroups from './ActivityGroups';
import { mergeTurnFileChanges } from '../../../packages/collaboration-core/file-changes';
type RenderEntry=(entry:ConversationEntry,completedReply:boolean,progress?:{active:boolean;target?:HTMLElement|null})=>ReactNode;
export interface ConversationReadingHandle { revealMessage(id:string):void }
const ProcessReveals=createContext<Map<string,()=>void>|null>(null);
function TurnProcess({turn,render}:{turn:ReadingTurn;render:(entry:ConversationEntry)=>ReactNode}){
  // Historical turns start folded. A visible live turn keeps its container and
  // user expansion choices when it settles, instead of collapsing the whole page.
  const [expanded,setExpanded]=useState(turn.active);
  const [streamed,setStreamed]=useState(turn.active);
  const reveals=useContext(ProcessReveals),scope=useContext(UiMemoryScope);
  useLayoutEffect(()=>{
    const reveal=()=>uiPreferences.change('disclosure.open',true,JSON.stringify([scope,'ConversationReading.details.1',turn.id]));
    const ids=turn.process.flatMap(entry=>entry.type==='message'?[entry.message.id]:[]);
    for(const id of ids)reveals?.set(id,reveal);
    return()=>{for(const id of ids)if(reveals?.get(id)===reveal)reveals.delete(id);};
  },[reveals,scope,turn.id,turn.process]);
  useLayoutEffect(()=>{if(turn.active){setExpanded(true);setStreamed(true);}},[turn.active]);
  return <RememberedDetails memoryId="ConversationReading.details.1" forceOpen={turn.active} scope={turn.id} className={'turn-process'+(streamed?' turn-process-streamed':'')} open={expanded} onToggle={event=>{if(event.target===event.currentTarget)setExpanded(event.currentTarget.open);}} data-turn-process data-turn-id={turn.id} data-process-completed={String(turn.completed)} data-testid="turn-process" body={()=><div className="turn-process-body"><ActivityGroups entries={turn.process} render={render}/></div>}>
    <summary hidden={turn.active}><Icon name="chevron" size={12}/>{!turn.active&&turn.timing?<TurnProgress turn={turn}/>:<span>运行过程</span>}<small>{turn.process.length} 条记录{turn.attention?' · 有需查看的记录':''}</small></summary>
  </RememberedDetails>;
}
function Turn({turn,render,activeProgressTarget}:{turn:ReadingTurn;render:RenderEntry;activeProgressTarget?:HTMLElement|null}){
  const entry=(item:ConversationEntry)=>render(item,turn.completed&&item.id===turn.replyId);
  const progress=<div className="turn-progress-line"><TurnProgress turn={turn}/></div>;
  const changes=mergeTurnFileChanges(turn.answers.flatMap(item=>item.type==='changes'?[item.changes]:[]),turn.id);
  const content:ReactNode[]=[];let process:ConversationEntry[]=[];
  const flush=()=>{if(!process.length)return;const id=process[0]===turn.process[0]?turn.id:turn.id+':process:'+process[0]!.id;content.push(<TurnProcess key={id} turn={{...turn,id,process,timing:id===turn.id?turn.timing:undefined}} render={entry}/>);process=[];};
  for(const item of turn.ordered??[...turn.users,...turn.process,...turn.answers]){
    if(item.type==='changes')continue;
    if(turn.users.includes(item)||turn.answers.includes(item)){flush();content.push(<Fragment key={item.id}>{entry(item)}</Fragment>);}
    else process.push(item);
  }
  flush();
  return <section className="reading-turn" data-testid="reading-turn">
    {turn.active ? activeProgressTarget === undefined ? progress : activeProgressTarget && createPortal(progress,activeProgressTarget) : !!turn.timing && !turn.process.length && progress}
    {content}
    {!turn.active&&turn.timing?.error&&<div className="callout warning compact turn-error" data-turn-error data-turn-id={turn.id}>{turn.timing.error}</div>}
    {changes&&render({type:'changes',id:changes.id,changes},false,{active:turn.active,target:activeProgressTarget})}
  </section>;
}
/** The stored object behind an entry; entry wrappers are rebuilt on every update, their records are not. */
const entryRecord=(entry:ConversationEntry):unknown=>entry.type==='message'?entry.message:entry.type==='activity'?entry.activity:entry.type==='peer'?entry.peer:entry.type==='child'?entry.child:entry.type==='delegated'?entry.childSession:entry.type==='interaction'?entry.item:undefined;
const changesKey=new WeakMap<object,string>();
/** Identity signature of everything a turn renders from; equal signatures render identical output. */
function turnDeps(turn:ReadingTurn,session:Session):unknown[]{
  const deps:unknown[]=[turn.active,turn.completed,turn.attention,turn.replyId,turn.timing,turn.lastNativeEventAt,turn.lastVisibleEventAt,turn.users.length,turn.process.length,turn.answers.length];
  let live=false;
  for(const entry of turn.ordered??[...turn.users,...turn.process,...turn.answers]){
    deps.push(entry.type,entry.id);
    if(entry.type==='changes'){let key=changesKey.get(entry.changes);if(key===undefined){key=JSON.stringify([entry.changes.truncated,entry.changes.files.map(file=>[file.path,file.previousPath,file.kind,file.edits,file.patches.map(patch=>[patch.activityId,patch.diff?.length,patch.truncated])])]);changesKey.set(entry.changes,key);}deps.push(key);continue;}
    deps.push(entryRecord(entry));
    if(entry.type==='child')deps.push(entry.lifecycle);
    if(entry.type==='peer')deps.push(entry.counterpart?.title,entry.counterpart?.archived);
    // These entries render from the whole session (children, plan review, interaction history).
    if(entry.type==='child'||entry.type==='interaction'||entry.type==='delegated'||entry.type==='message'&&entry.message.planReview)live=true;
  }
  if(live)deps.push(session);
  return deps;
}
const sameDeps=(a:unknown[],b:unknown[])=>a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
interface TurnProps {turn:ReadingTurn;deps:unknown[];context:unknown;render:RenderEntry;activeProgressTarget?:HTMLElement|null}
/**
 * A turn renders only when its own records or the reading context change, so a
 * streaming turn or composer input never re-renders the rest of the history.
 */
const StaticTurn=memo(function StaticTurn({turn,render,activeProgressTarget}:TurnProps){return <Turn turn={turn} render={render} activeProgressTarget={activeProgressTarget}/>;},
  (a,b)=>a.context!==undefined&&a.context===b.context&&a.activeProgressTarget===b.activeProgressTarget&&a.render===b.render&&sameDeps(a.deps,b.deps));
/**
 * `context` is a value that changes whenever anything the render callback reads
 * besides the entry itself changes. Without it every turn renders on every update.
 * The latest `render` is always used; callers keep callbacks current via refs.
 */
interface Props {ref?:Ref<ConversationReadingHandle>;viewKey?:string;entries:ConversationEntry[];session:Session;render:RenderEntry;context?:unknown;boundaryMessageId?:string;renderBoundary?:()=>ReactNode;activeProgressTarget?:HTMLElement|null}
const Reading=memo(function Reading({ref,entries,session,render,context,boundaryMessageId,renderBoundary,activeProgressTarget}:Props){
  const reveals=useMemo(()=>new Map<string,()=>void>(),[]);
  useImperativeHandle(ref,()=>({revealMessage:id=>reveals.get(id)?.()}),[reveals]);
  const latest=useRef(render);latest.current=render;
  const stable=useCallback<RenderEntry>((...args)=>latest.current(...args),[]);
  const turnRender=context===undefined?render:stable;
  const turns=useMemo(()=>readingTurns(entries,session),[entries,session]);
  return <ProcessReveals.Provider value={reveals}>{turns.map(turn=><Fragment key={turn.id}><StaticTurn turn={turn} deps={turnDeps(turn,session)} context={context} render={turnRender} activeProgressTarget={activeProgressTarget}/>{boundaryMessageId&&[...turn.users,...turn.process,...turn.answers].some(entry=>entry.type==='message'&&entry.message.id===boundaryMessageId)&&renderBoundary?.()}</Fragment>)}</ProcessReveals.Provider>;
},(a,b)=>a.context!==undefined&&a.context===b.context&&a.ref===b.ref&&a.viewKey===b.viewKey&&a.entries===b.entries&&a.session===b.session&&a.boundaryMessageId===b.boundaryMessageId&&a.renderBoundary===b.renderBoundary&&a.activeProgressTarget===b.activeProgressTarget);
export default function ConversationReading(props:Props){
  // Defer the complete reading snapshot. Deferring entries alone still rebuilt
  // every historical message during urgent input through the new render callback.
  const snapshot=useDeferredValue(props);
  // A layout/session switch must commit its focus handlers with the visible
  // controls. Otherwise the first focus can hit the previous view's handlers.
  return <Reading {...(props.viewKey===snapshot.viewKey?snapshot:props)}/>;
}
