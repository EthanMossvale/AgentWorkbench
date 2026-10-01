import {RememberedDetails} from './UiMemory';
import { Fragment, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Session } from '../../../packages/contracts';
import { readingTurns, type ReadingTurn } from '../../../packages/collaboration-core/reading-turns';
import type { ConversationEntry } from '../../../packages/collaboration-core/timeline';
import { Icon } from './ui';
import TurnProgress from './TurnProgress';
import ActivityGroups from './ActivityGroups';
import { mergeTurnFileChanges } from '../../../packages/collaboration-core/file-changes';
type RenderEntry=(entry:ConversationEntry,completedReply:boolean,progress?:{active:boolean;target?:HTMLElement|null})=>ReactNode;
function TurnProcess({turn,render}:{turn:ReadingTurn;render:(entry:ConversationEntry)=>ReactNode}){
  // Historical turns start folded. A visible live turn keeps its container and
  // user expansion choices when it settles, instead of collapsing the whole page.
  const [expanded,setExpanded]=useState(turn.active);
  const [streamed,setStreamed]=useState(turn.active);
  useLayoutEffect(()=>{if(turn.active){setExpanded(true);setStreamed(true);}},[turn.active]);
  return <RememberedDetails memoryId="ConversationReading.details.1" forceOpen={turn.active} scope={turn.id} className={'turn-process'+(streamed?' turn-process-streamed':'')} open={expanded} onToggle={event=>{if(event.target===event.currentTarget)setExpanded(event.currentTarget.open);}} data-turn-process data-turn-id={turn.id} data-process-completed={String(turn.completed)} data-testid="turn-process">
    <summary hidden={turn.active}><Icon name="chevron" size={12}/>{!turn.active&&turn.timing?<TurnProgress turn={turn}/>:<span>运行过程</span>}<small>{turn.process.length} 条记录{turn.attention?' · 有需查看的记录':''}</small></summary>
    <div className="turn-process-body"><ActivityGroups entries={turn.process} render={render}/></div>
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
export default function ConversationReading({entries,session,render,boundaryMessageId,renderBoundary,activeProgressTarget}:{entries:ConversationEntry[];session:Session;render:RenderEntry;boundaryMessageId?:string;renderBoundary?:()=>ReactNode;activeProgressTarget?:HTMLElement|null}){return readingTurns(entries,session).map(turn=><Fragment key={turn.id}><Turn turn={turn} render={render} activeProgressTarget={activeProgressTarget}/>{boundaryMessageId&&[...turn.users,...turn.process,...turn.answers].some(entry=>entry.type==='message'&&entry.message.id===boundaryMessageId)&&renderBoundary?.()}</Fragment>);}
