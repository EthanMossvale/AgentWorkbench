import type { NativeFrame } from '../../services/remote-supervisor';
import { inspectNativeEvent, nativeEventCatalog } from './catalog';
import { knownNativePresentation } from './presentation';
import {nativeEventDiagnostic} from './diagnostics';
import type {Session} from '../contracts';
import type { NativeEventAudit, NativeEventCoverage, NativeEventPresenter, NativeEventPresentation, NativeEventReceipt, NativeEventRuntime, PluginNativeEvents } from './types';
export type * from './types';
export { inspectNativeEvent, nativeEventCatalog } from './catalog';

export interface NativeEventNotice { receipt: NativeEventReceipt; presentation?: NativeEventPresentation }
const fail=()=>{throw Error('NATIVE_EVENT_PRESENTER_INVALID');};
function presentation(value: unknown): NativeEventPresentation | undefined {
  if(value===undefined)return;
  if(!value||typeof value!=='object')return fail();
  if('then' in value){void Promise.resolve(value).catch(()=>{});return fail();}
  const p=value as NativeEventPresentation;
  if(typeof p.title!=='string'||!p.title.trim()||p.title.length>160||p.detail!==undefined&&(typeof p.detail!=='string'||p.detail.length>4096)||Object.keys(p).some(k=>!['title','detail'].includes(k)))return fail();
  return {title:p.title,...(p.detail!==undefined?{detail:p.detail}:{})};
}
/** Presentation extensions cannot change native results, approvals or identity. */
export class NativeEventRegistry {
  private presenters=new Map<string,NativeEventPresenter>();
  private observers=new Set<(receipt:Readonly<NativeEventReceipt>)=>void>();
  private changes=new Set<()=>void>();
  catalog(runtime?:NativeEventRuntime){return nativeEventCatalog.filter(e=>!runtime||e.runtime===runtime).map(e=>({...e}));}
  inspect=inspectNativeEvent;
  has(id:string){return this.presenters.has(id);}
  subscribe(handler:()=>void){this.changes.add(handler);return()=>{this.changes.delete(handler);};}
  private changed(){for(const handler of this.changes)try{handler();}catch{/* A failed observer cannot block release. */}}
  register(owner:string,definition:NativeEventPresenter){
    if(!definition||!/^[a-z][a-z0-9.-]{0,79}$/.test(definition.id)||!['codex','claude'].includes(definition.runtime)||!Array.isArray(definition.keys)||!definition.keys.length||definition.keys.length>64||definition.keys.some(k=>typeof k!=='string'||k.length>200||!/^[A-Za-z][A-Za-z0-9_./-]*$/.test(k))||typeof definition.present!=='function')return fail();
    const id=owner+'/'+definition.id;if(this.presenters.has(id))throw Error('NATIVE_EVENT_PRESENTER_DUPLICATE');
    this.presenters.set(id,{...definition,keys:[...new Set(definition.keys)]});this.changed();
    let live=true;return()=>{if(live){live=false;this.presenters.delete(id);this.changed();}};
  }
  scope(owner:string,assertActive:()=>void,own:(release:()=>void)=>()=>void):PluginNativeEvents{
    return Object.freeze({
      diagnostic:(receipt:Readonly<NativeEventReceipt>)=>{assertActive();return nativeEventDiagnostic(receipt);},
      catalog:(runtime?:NativeEventRuntime)=>{assertActive();return this.catalog(runtime);},
      inspect:(runtime:NativeEventRuntime,value:Readonly<Record<string,unknown>>)=>{assertActive();return this.inspect(runtime,value);},
      register:(definition:NativeEventPresenter)=>{assertActive();return own(this.register(owner,definition));},
      onReceipt:(handler:(receipt:Readonly<NativeEventReceipt>)=>void)=>{assertActive();if(typeof handler!=='function')return fail();this.observers.add(handler);return own(()=>{this.observers.delete(handler);});},
    });
  }
  present(event:NativeEventCoverage,value:Readonly<Record<string,unknown>>):{presentation?:NativeEventPresentation;adapterId?:string;adapterFailed?:boolean}{
    // Private and already-rendered events retain their existing paths. Even an extension
    // cannot accidentally promote hidden reasoning through this presentation API.
    if(['private','handled'].includes(event.disposition))return {};
    let failed=false;
    for(const [id,adapter]of [...this.presenters].reverse())if(adapter.runtime===event.runtime&&adapter.keys.includes(event.key)){
      try{const output=presentation(adapter.present({event:Object.freeze({...event}),value}));if(output)return {presentation:output,adapterId:id,...(failed?{adapterFailed:true}:{})};}
      catch{failed=true;}
    }
    const builtin=knownNativePresentation(event,value);
    return {...(builtin?{presentation:builtin}:{}),...(failed?{adapterFailed:true}:{})};
  }
  publish(receipt:NativeEventReceipt){for(const handler of this.observers)try{const result:unknown=handler(Object.freeze({...receipt}));if(result&&typeof result==='object'&&'then'in result)void Promise.resolve(result).catch(()=>{});}catch{/* Receipt observers cannot fail native processing. */}}
}

export const freshNativeEventAudit=():NativeEventAudit=>({version:1,frames:0,observations:0,unknown:0,unsupported:0,malformed:0,omitted:0,receipts:[]});
const add=(n:number)=>Math.min(Number.MAX_SAFE_INTEGER,(Number.isSafeInteger(n)&&n>=0?n:0)+1);
export const receiptKey=(receipt:Pick<NativeEventReceipt,'runtime'|'key'|'nativeChildId'>)=>JSON.stringify([receipt.runtime,receipt.nativeChildId??null,receipt.key]);
/** Reclassify metadata after an upgrade without replaying payloads or inventing outcomes. */
export function refreshNativeEventHistory(session:Session){
  const current=new Map(nativeEventCatalog.map(e=>[e.runtime+':'+e.key,e]));
  for(const receipt of session.nativeEventAudit?.receipts??[]){const entry=current.get(receipt.runtime+':'+receipt.key);if(entry)Object.assign(receipt,entry);}
  for(const activity of session.activities??[])if(activity.protocol){const r=activity.protocol.receipt,entry=current.get(r.runtime+':'+r.key);if(entry){Object.assign(r,entry);activity.status=['handled','private','observed'].includes(entry.disposition)?'completed':'uncertain';if(!r.adapterId)activity.protocol.presentation=knownNativePresentation(entry,{});}activity.presentation='diagnostic';}
}
/** Bounded metadata ledger: no raw values, native text, secrets or hidden reasoning. */
export class NativeEventMonitor {
  private audit:NativeEventAudit;
  private seen=new WeakSet<object>();
  private notices=new Map<string,NativeEventNotice>();
  constructor(readonly runtime:NativeEventRuntime,readonly registry:NativeEventRegistry,initial?:NativeEventAudit){
    this.audit=initial?.version===1?structuredClone(initial):freshNativeEventAudit();
    this.audit.receipts=this.audit.receipts.slice(-256);
  }
  observe(frame:NativeFrame,nativeChildId?:string):NativeEventNotice[]{
    if(this.seen.has(frame))return [];this.seen.add(frame);
    this.audit.frames=add(this.audit.frames);
    const changes:NativeEventNotice[]=[];
    for(const event of this.registry.inspect(this.runtime,frame.value)){
      this.audit.observations=add(this.audit.observations);
      if(event.disposition==='unknown'||event.disposition==='unsupported'||event.disposition==='malformed')this.audit[event.disposition]=add(this.audit[event.disposition]);
      const key=receiptKey({...event,nativeChildId});
      let receipt=this.audit.receipts.find(r=>receiptKey(r)===key);
      if(!receipt&&this.audit.receipts.length>=256){this.audit.omitted=add(this.audit.omitted);continue;}
      if(!receipt){receipt={...event,count:0,firstAt:frame.receivedAt,lastAt:frame.receivedAt,lastBytes:0,lastDigest:'',...(nativeChildId?{nativeChildId}:{})};this.audit.receipts.push(receipt);}
      else Object.assign(receipt,event);
      receipt.count=add(receipt.count);receipt.lastAt=frame.receivedAt;
      receipt.lastSequence=frame.sequence;receipt.lastBytes=frame.rawBase64?Math.floor(frame.rawBase64.length*3/4)-(frame.rawBase64.endsWith('==')?2:frame.rawBase64.endsWith('=')?1:0):Buffer.byteLength(frame.rawText??'','utf8');receipt.lastDigest=/^[a-f0-9]{64}$/.test(frame.sha256)?frame.sha256:'';
      const adapted=this.registry.present(event,frame.value);
      receipt.adapterId=adapted.adapterId;receipt.adapterFailed=adapted.adapterFailed;
      this.registry.publish(receipt);
      if(['unknown','unsupported','malformed','observed'].includes(event.disposition)){
        const notice={receipt:{...receipt},...(adapted.presentation?{presentation:adapted.presentation}:{})};
        // Frequent observed-only metadata stays in the ledger; compatibility issues always get a row.
        if(event.disposition!=='observed'||adapted.presentation||receipt.count===1){this.notices.set(key,notice);changes.push(notice);}
      }
    }
    if(this.audit.omitted){
      const key='overflow',old=this.notices.get(key),receipt:NativeEventReceipt={runtime:this.runtime,key:'audit/overflow',disposition:'unknown',route:'Additional discriminator receipts coalesced at the bounded ledger limit',count:this.audit.omitted,firstAt:old?.receipt.firstAt??frame.receivedAt,lastAt:frame.receivedAt,lastBytes:0,lastDigest:''};
      const notice={receipt};this.notices.set(key,notice);changes.push(notice);
    }
    return changes;
  }
  releaseMissingPresenters():NativeEventNotice[]{
    const changed:NativeEventNotice[]=[];
    for(const receipt of this.audit.receipts)if(receipt.adapterId&&!this.registry.has(receipt.adapterId)){delete receipt.adapterId;delete receipt.adapterFailed;const key=receiptKey(receipt),notice={receipt:{...receipt}};this.notices.set(key,notice);changed.push(notice);}
    return changed;
  }
  snapshot(){return structuredClone(this.audit);}
}
