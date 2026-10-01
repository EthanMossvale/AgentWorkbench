import {useEffect,useRef,useState} from 'react';
import type {NativeModelSelection} from '../../../packages/contracts';

const same=(a?:NativeModelSelection,b?:NativeModelSelection)=>a?.model===b?.model&&a?.effort===b?.effort&&a?.serviceTier===b?.serviceTier;
/** Paint immediately; serialize writes and coalesce further input to the latest choice. */
export function useModelSelection(scope:string,value:NativeModelSelection|undefined,persist:(value:NativeModelSelection)=>void|Promise<void>,failed:(error:unknown)=>void){
  const [optimistic,setOptimistic]=useState<{scope:string;value:NativeModelSelection}>();
  const state=useRef({scope,generation:0,running:false,pending:undefined as {value:NativeModelSelection;persist:typeof persist}|undefined});
  const actual=useRef(value);actual.current=value;
  if(state.current.scope!==scope)state.current={scope,generation:state.current.generation+1,running:false,pending:undefined};
  useEffect(()=>{if(!state.current.running&&optimistic?.scope===scope&&same(optimistic.value,value))setOptimistic(undefined);},[scope,value,optimistic]);
  useEffect(()=>()=>{state.current.generation++;state.current.pending=undefined;},[]);
  const choose=(selection:NativeModelSelection)=>{
    const current=state.current,generation=current.generation;
    setOptimistic({scope,value:selection});current.pending={value:selection,persist};
    if(current.running)return;
    current.running=true;
    void (async()=>{
      let last=selection;
      try{
        while(current.pending&&state.current===current&&current.generation===generation){
          const job=current.pending;current.pending=undefined;last=job.value;
          try{await job.persist(job.value);}catch(error){
            if(state.current!==current||current.generation!==generation)return;
            failed(error);if(!current.pending){setOptimistic(undefined);return;}
          }
        }
      }finally{
        current.running=false;
        if(state.current===current&&current.generation===generation&&same(last,actual.current))setOptimistic(undefined);
      }
    })();
  };
  return {value:optimistic?.scope===scope?optimistic.value:value,choose};
}
