import type { PluginIncident, PluginRecoveryStore } from './recovery';

export interface PluginRepairBatchResult {
  repairs:{id:string;hash?:string;applied:boolean;status:'repaired'|'failed'|'unavailable'}[];
  remaining:PluginIncident[];complete:boolean;
}
const running=new WeakMap<PluginRecoveryStore,Promise<PluginRepairBatchResult>>();
/** One explicit action, one attempt per observed package. Unknown faults are never auto-retried. */
export function repairCompatibilityBatch(recovery:PluginRecoveryStore,repair:(id:string,hash:string)=>Promise<{applied:boolean}>):Promise<PluginRepairBatchResult>{
  const active=running.get(recovery);if(active)return active;
  const operation=runBatch(recovery,repair).finally(()=>{running.delete(recovery);});running.set(recovery,operation);return operation;
}
async function runBatch(recovery:PluginRecoveryStore,repair:(id:string,hash:string)=>Promise<{applied:boolean}>):Promise<PluginRepairBatchResult>{
  const targets=new Map<string,{id:string;hash?:string;repairable:boolean}>();
  for(const incident of recovery.snapshot().incidents){
    const key=incident.id+':'+(incident.hash??''),previous=targets.get(key);
    targets.set(key,{id:incident.id,hash:incident.hash,repairable:!!incident.hash&&(!!previous?.repairable||incident.repairable)});
  }
  const repairs:PluginRepairBatchResult['repairs']=[];
  for(const target of targets.values()){
    if(!target.repairable||!target.hash){repairs.push({id:target.id,hash:target.hash,applied:false,status:'unavailable'});continue;}
    try{const result=await repair(target.id,target.hash);repairs.push({id:target.id,hash:target.hash,applied:result.applied,status:result.applied?'repaired':'failed'});}
    catch{repairs.push({id:target.id,hash:target.hash,applied:false,status:'failed'});}
  }
  const remaining=recovery.snapshot().incidents;
  return {repairs,remaining,complete:remaining.length===0&&repairs.every(item=>item.applied)};
}
