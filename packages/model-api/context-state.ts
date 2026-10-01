import type {NativeContextUsage,NativeModelSelection,Session} from '../contracts';
import {metricsSource} from '../session-metrics';

export interface NativeContextStateService {
  recover(session:Session):NativeContextUsage|undefined;
  select(session:Session,selection:NativeModelSelection,capacity?:number):void;
  observe(session:Session,usage:NativeContextUsage):void;
  capacity(session:Session,capacity:number):void;
  handoff(previous:Session,restored:NativeContextUsage|undefined,capacity?:number):NativeContextUsage|undefined;
}
const windowSize=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<=100000000;
const modelWindows=(value:NativeContextUsage['modelWindows']):Record<string,number>=>Object.assign(Object.create(null),Object.fromEntries(Object.entries(value??{}).filter(([,size])=>windowSize(size))));
/** Context receipts belong to a native thread; capacities belong to a model. */
export const nativeContextState:NativeContextStateService={
  recover(session){
    if(session.nativeContextUsage)return session.nativeContextUsage;
    if(!session.binding.nativeSessionId)return;
    // Native Codex billing deltas may span requests; they are not context receipts.
    if(session.binding.runtime!=='claude'&&session.binding.egress!=='direct-api')return;
    const source=metricsSource(session);
    const latest=session.metrics?.records.filter(row=>{
      if(row.runtime!==session.binding.runtime||row.id.startsWith('result:')||row.inputTokens===null||row.outputTokens===null)return false;
      if(row.source===source)return true;
      // Older selectors changed target IDs within the same native thread.
      try{const identity=JSON.parse(row.source);return identity[0]===session.binding.runtime&&identity[2]===session.binding.nativeSessionId;}catch{return false;}
    }).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    if(!latest||session.nativeProtocol?.resetAt&&session.nativeProtocol.resetAt>=latest.updatedAt||session.activities?.some(a=>a.category==='compaction'&&!a.nativeChildId&&a.updatedAt>=latest.updatedAt))return;
    const used=latest.inputTokens!+latest.outputTokens!;
    return {used,total:used,capacity:null,updatedAt:latest.updatedAt,turnId:latest.turnId,estimated:true};
  },
  select(session,selection,capacity){
    const previous=this.recover(session);if(!previous)return;
    const oldModel=session.modelSelection?.model??session.nativeEffectiveModel?.model;
    const windows=modelWindows(previous.modelWindows);
    if(oldModel&&windowSize(previous.capacity))windows[oldModel]=previous.capacity;
    if(windowSize(capacity)&&!windows[selection.model])windows[selection.model]=capacity;
    session.nativeContextUsage=oldModel===selection.model?{...previous,modelWindows:windows}:{...previous,capacity:windows[selection.model]??null,runtimeCapacity:undefined,estimated:true,modelWindows:windows};
  },
  observe(session,usage){
    const selected=session.modelSelection?.model??session.nativeEffectiveModel?.model;
    const model=session.status==='running'?session.nativeActiveSettings?.modelSelection?.model??selected:selected,windows=modelWindows({...session.nativeContextUsage?.modelWindows,...usage.modelWindows});
    if(model&&windowSize(usage.capacity))windows[model]=usage.capacity;
    const pending=!!selected&&selected!==model;
    session.nativeContextUsage={...usage,capacity:pending?windows[selected!]??null:usage.capacity??(model?windows[model]??null:null),...(pending?{runtimeCapacity:undefined}:{}),estimated:pending,modelWindows:windows};
  },
  capacity(session,capacity){
    if(!session.nativeContextUsage||!windowSize(capacity))return;
    const usage=session.nativeContextUsage,model=session.modelSelection?.model??session.nativeEffectiveModel?.model;
    usage.capacity=capacity;usage.runtimeCapacity=capacity;
    if(model)usage.modelWindows={...usage.modelWindows,[model]:capacity};
  },
  handoff(previous,restored,capacity){
    const usage=this.recover(previous);
    if(restored){const saved=structuredClone(restored);return usage&&usage.updatedAt>saved.updatedAt?{...saved,used:usage.used,total:usage.total,updatedAt:usage.updatedAt,turnId:usage.turnId,estimated:true}:saved;}
    if(!usage)return;
    return {...usage,capacity:windowSize(capacity)?capacity:null,runtimeCapacity:undefined,modelWindows:undefined,estimated:true};
  },
};
