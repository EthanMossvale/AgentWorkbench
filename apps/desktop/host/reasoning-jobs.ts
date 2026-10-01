import {createHash,randomUUID} from 'node:crypto';
import type {ApiModel,ModelConnection} from '../../../packages/model-api/types';
import {verifyConnectionReasoning} from '../../../packages/model-api/reasoning-probe';
export interface ReasoningJobView {id:string;state:'queued'|'running'|'complete'|'cancelled'|'failed';models:ApiModel[];error?:string}
interface Job extends ReasoningJobView {signature:string;abort:AbortController;run:()=>Promise<void>;done:Promise<void>;finish:()=>void;attached?:boolean;finishedAt?:number}
export const probeSignature=(c:ModelConnection,key:string)=>createHash('sha256').update(JSON.stringify([c.baseUrl,c.protocol,key,c.models.filter(m=>m.enabled).map(m=>[m.id,m.model,!!m.adaptiveThinking,m.effortCandidates??[]])])).digest('hex');
/** Bounded jobs belong to the host; public status contains probe evidence, never raw credentials or endpoints. */
export class ReasoningJobs {
 private jobs=new Map<string,Job>();private active=0;private disposed=false;
 constructor(private fetcher:typeof fetch,private now=Date.now){}
 private reusable(job:Job){return !['cancelled','failed'].includes(job.state)&&(job.state!=='complete'||this.now()-(job.finishedAt??0)<86400000);}
 start(connection:ModelConnection,key:string,previous?:ModelConnection,force=false):ReasoningJobView{
  if(this.disposed)throw Error('REASONING_JOBS_DISPOSED');const signature=probeSignature(connection,key);
  const existing=[...this.jobs.values()].find(job=>job.signature===signature&&this.reusable(job)&&(job.state!=='complete'||job.models.every(model=>model.reasoningProbe?.status!=='inconclusive'&&(!model.reasoningProbe?.reason||model.reasoningProbe.reason==='unsupported'))));if(existing&&!force)return this.view(existing);
  for(const [id,job]of this.jobs)if(this.jobs.size>=24&&!['running','queued'].includes(job.state))this.jobs.delete(id);
  if(this.jobs.size>=24||[...this.jobs.values()].filter(j=>['running','queued'].includes(j.state)).length>=4)throw Error('REASONING_JOBS_BUSY');
  let finish!:()=>void;const done=new Promise<void>(resolve=>finish=resolve),job:Job={id:randomUUID(),state:'queued',signature,abort:new AbortController(),models:[],done,finish,run:async()=>{
   try{const result=await verifyConnectionReasoning(connection,key,previous,this.fetcher,force,{signal:job.abort.signal,onModel:model=>{if(!job.abort.signal.aborted)job.models.push(model);}});if(!job.abort.signal.aborted){job.models=result.models.filter(m=>m.enabled);job.state='complete';}}
   catch{if(!job.abort.signal.aborted){job.state='failed';job.error='REASONING_DETECTION_FAILED';}}
   finally{key='';if(job.abort.signal.aborted)job.state='cancelled';job.finishedAt=this.now();job.finish();this.active--;this.pump();}
  }};this.jobs.set(job.id,job);this.pump();return this.view(job);
 }
 private pump(){if(this.disposed)return;while(this.active<1){const job=[...this.jobs.values()].find(j=>j.state==='queued');if(!job)break;job.state='running';this.active++;void job.run();}}
 private view(job:Job):ReasoningJobView{return structuredClone({id:job.id,state:job.state,models:job.models,error:job.error});}
 status(id:string){const job=this.jobs.get(id);if(!job)throw Error('REASONING_JOB_NOT_FOUND');return this.view(job);}
 cancel(id:string){const job=this.jobs.get(id);if(!job)throw Error('REASONING_JOB_NOT_FOUND');if(job.state==='running'||job.state==='queued'){const queued=job.state==='queued';job.abort.abort();job.state='cancelled';if(queued){job.run=async()=>{};job.finish();}}return this.view(job);}
 attach(id:string,connection:ModelConnection,key:string,apply:(models:ApiModel[])=>Promise<void>){const job=this.jobs.get(id);if(!job||job.signature!==probeSignature(connection,key)||!this.reusable(job))return false;job.attached=true;void job.done.then(()=>{if(job.state==='complete'&&!this.disposed)return apply(job.models);}).catch(()=>{});return true;}
 dispose(){this.disposed=true;for(const job of this.jobs.values()){job.abort.abort();if(job.state==='queued'){job.state='cancelled';job.run=async()=>{};job.finish();}}}
}
