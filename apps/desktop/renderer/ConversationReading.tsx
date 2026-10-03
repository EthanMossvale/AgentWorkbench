import {RememberedDetails,UiMemoryScope} from './UiMemory';
import { Fragment, createContext, memo, useContext, useDeferredValue, useImperativeHandle, useLayoutEffect, useMemo, useState, type ReactNode, type Ref } from 'react';
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
interface Props {ref?:Ref<ConversationReadingHandle>;viewKey?:string;entries:ConversationEntry[];session:Session;render:RenderEntry;boundaryMessageId?:string;renderBoundary?:()=>ReactNode;activeProgressTarget?:HTMLElement|null}
const Reading=memo(function Reading({ref,entries,session,render,boundaryMessageId,renderBoundary,activeProgressTarget}:Props){
  const reveals=useMemo(()=>new Map<string,()=>void>(),[]);
  useImperativeHandle(ref,()=>({revealMessage:id=>reveals.get(id)?.()}),[reveals]);
  const turns=useMemo(()=>readingTurns(entries,session),[entries,session]);
  return <ProcessReveals.Provider value={reveals}>{turns.map(turn=><Fragment key={turn.id}><Turn turn={turn} render={render} activeProgressTarget={activeProgressTarget}/>{boundaryMessageId&&[...turn.users,...turn.process,...turn.answers].some(entry=>entry.type==='message'&&entry.message.id===boundaryMessageId)&&renderBoundary?.()}</Fragment>)}</ProcessReveals.Provider>;
});
export default function ConversationReading(props:Props){
  // Defer the complete reading snapshot. Deferring entries alone still rebuilt
  // every historical message during urgent input through the new render callback.
  const snapshot=useDeferredValue(props);
  // A layout/session switch must commit its focus handlers with the visible
  // controls. Otherwise the first focus can hit the previous view's handlers.
  return <Reading {...(props.viewKey===snapshot.viewKey?snapshot:props)}/>;
}
