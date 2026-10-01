import { createHash } from 'node:crypto';
import type { ApiModel, ModelConnection } from './types';
import { apiHeaders } from './provider';
import { applyReasoning, reasoningCandidates, type ReasoningProbe } from './reasoning-info';
import { reasoningRejection } from './reasoning-errors';

type Result = {state:'accepted'|'rejected'|'unknown';declared?:string[];reason?:ReasoningProbe['reason'];httpStatus?:number};
interface Budget { remaining: number; signal: AbortSignal; unavailable?: Result }
const fingerprint = (connection: ModelConnection, model: ApiModel, key: string, candidates: string[]) => createHash('sha256').update(JSON.stringify([3,connection.baseUrl, connection.protocol, key, model.model, model.adaptiveThinking, candidates])).digest('hex');
export function reasoningProbeRequest(connection: ModelConnection, model: ApiModel, effort?: string) {
  const prompt = 'Reply with OK only. This is a parameter compatibility check; do not use tools.';
  if (connection.protocol === 'responses') return { route: 'responses', body: { model: model.model, input: prompt, stream: false, store: false, max_output_tokens: 64, ...(effort ? {reasoning:{effort}} : {}) } };
  if (connection.protocol === 'anthropic-messages') return { route: 'messages', body: { model: model.model, messages: [{role:'user',content:prompt}], stream: false, max_tokens: 64, ...(model.adaptiveThinking ? {thinking:{type:'adaptive'}} : {}), ...(effort ? {output_config:{effort}} : {}) } };
  return { route: 'chat/completions', body: {model:model.model,messages:[{role:'user',content:prompt}],stream:false,max_tokens:64,...(effort?{reasoning_effort:effort}:{})} };
}
async function readJson(response: Response) {
  const reader=response.body?.getReader();if(!reader)throw Error('empty');const chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536)throw Error('large');chunks.push(part.value);}
    const text=Buffer.concat(chunks).toString('utf8');
    if(!response.headers.get('content-type')?.includes('text/event-stream'))return JSON.parse(text);
    let result:unknown;
    for(const frame of text.split(/\r?\n\r?\n/)){
      const payload=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if(!payload||payload==='[DONE]')continue;const event=JSON.parse(payload);
      if(['response.completed','response.incomplete'].includes(event.type))result=event.response;
      else if(event.type==='error'||event.error)return {error:event.error??event};
      else if(event.type==='message_delta'&&typeof event.delta?.stop_reason==='string')result={content:[],stop_reason:event.delta.stop_reason};
      else if(event.choices?.some((choice:any)=>typeof choice.finish_reason==='string'))result={choices:event.choices.map((choice:any)=>({...choice,message:choice.message??{role:'assistant'}}))};
    }
    if(!result)throw Error('incomplete');return result;
  }
  finally{await reader.cancel().catch(()=>{});}
}
async function check(connection: ModelConnection, model: ApiModel, key: string, effort: string | undefined, budget: Budget, fetcher: typeof fetch): Promise<Result> {
  if(budget.unavailable)return budget.unavailable;
  if(budget.remaining<=0||budget.signal.aborted)return {state:'unknown',reason:'budget'};budget.remaining--;
  const {route,body}=reasoningProbeRequest(connection,model,effort);
  const signal=AbortSignal.any([budget.signal,AbortSignal.timeout(30000)]);
  try{
    const response=await fetcher(`${connection.baseUrl}/${route}`,{method:'POST',headers:apiHeaders(connection,key),body:JSON.stringify(body),redirect:'manual',signal});
    const httpStatus=response.status;
    if([401,403,429].includes(httpStatus)||httpStatus>=500){const result:Result={state:'unknown',reason:httpStatus===429?'rate-limit':httpStatus>=500?'server':'auth',httpStatus};if(httpStatus<500)budget.unavailable=result;await response.body?.cancel().catch(()=>{});return result;}
    let data:any;try{data=await readJson(response);}catch(error){if(signal.aborted)throw error;return {state:'unknown',reason:'format',httpStatus};}
    if(!data||typeof data!=='object')return {state:'unknown',reason:'format',httpStatus};
    if(response.ok){
      if(data?.error)return {state:'unknown',reason:'format',httpStatus};
      const valid=connection.protocol==='responses'?['completed','incomplete'].includes(data.status)&&Array.isArray(data.output):connection.protocol==='anthropic-messages'?Array.isArray(data.content)&&typeof data.stop_reason==='string':Array.isArray(data.choices)&&data.choices.some((item:any)=>item.message&&typeof item.finish_reason==='string');
      return valid?{state:'accepted'}:{state:'unknown',reason:'format',httpStatus};
    }
    // Only explicit parameter rejections count. Auth, quota, transport and server errors never infer capabilities.
    const error=reasoningRejection(data);
    return [400,422].includes(httpStatus)&&error.rejected?{state:'rejected',declared:error.declared}:{state:'unknown',reason:[400,422].includes(httpStatus)?'format':'http',httpStatus};
  }catch{return {state:'unknown',reason:budget.signal.aborted?'budget':signal.aborted?'timeout':'network'};}
}
async function inspect(connection:ModelConnection,model:ApiModel,key:string,previous:ApiModel|undefined,budget:Budget,fetcher:typeof fetch,force:boolean):Promise<ApiModel>{
  const candidates=reasoningCandidates(model);
  const id=fingerprint(connection,model,key,candidates),cached=previous?.reasoningProbe;
  const age=cached?Date.now()-Date.parse(cached.checkedAt):Infinity;
  const preferred=(accepted:string[])=>accepted.includes(model.defaultEffort??'')?model.defaultEffort:accepted.includes('medium')?'medium':accepted[0];
  if(!force&&age>=0&&age<86400000&&cached?.fingerprint===id&&cached.status!=='inconclusive'&&(!cached.reason||cached.reason==='unsupported')){const levels=cached.status==='declared'?cached.declared??[]:cached.accepted;return applyReasoning(model,{efforts:levels.length?[...levels]:undefined,defaultEffort:preferred(levels),reasoningProbe:cached});}
  const probe:ReasoningProbe={status:'inconclusive',checkedAt:new Date().toISOString(),fingerprint:id,accepted:[],rejected:[]};
  const finish=()=>{const levels=probe.status==='declared'?probe.declared??[]:probe.status==='verified'?probe.accepted:[];return applyReasoning(model,{efforts:levels.length?levels:undefined,defaultEffort:preferred(levels),reasoningProbe:probe});};
  const unknown=(result:Result)=>{probe.reason=result.reason??'unavailable';probe.httpStatus=result.httpStatus;};
  if(budget.remaining<1||budget.signal.aborted||budget.unavailable){unknown(budget.unavailable??{state:'unknown',reason:'budget'});return finish();}
  // Explicit request compatibility checks use legitimate values only. Acceptance
  // does not prove that a gateway enforces or internally applies the parameter.
  for(const effort of candidates){
    const result=await check(connection,model,key,effort,budget,fetcher);
    if(result.declared?.length){probe.declared=result.declared;if(!model.effortCandidates?.length){probe.status='declared';return finish();}}
    if(result.state==='accepted')probe.accepted.push(effort);else if(result.state==='rejected')probe.rejected.push(effort);else{unknown(result);break;}
  }
  probe.status=probe.accepted.length?'verified':probe.rejected.length===candidates.length?'unsupported':'inconclusive';
  if(probe.status==='unsupported')probe.reason='unsupported';
  return finish();
}
/** One bounded, explicitly requested batch. No retries, chat context or native login credentials. */
export async function verifyConnectionReasoning(connection:ModelConnection,key:string,previous:ModelConnection|undefined,fetcher:typeof fetch=fetch,force=false,options:{signal?:AbortSignal;onModel?:(model:ApiModel)=>void}={}):Promise<ModelConnection>{
  const budget:Budget={remaining:96,signal:AbortSignal.any([AbortSignal.timeout(180000),...(options.signal?[options.signal]:[])])},models=[...connection.models];let next=0;
  const worker=async()=>{for(;;){const index=next++;if(index>=models.length)return;const model=models[index]!;if(!model.enabled)continue;
    const result=await inspect(connection,model,key,previous?.models.find(item=>item.id===model.id&&item.model===model.model),budget,fetcher,force);models[index]=result;options.onModel?.(result);
  }};
  await Promise.all([worker(),worker()]);
  for(const model of models){if(!model.enabled||!model.effortCandidates?.length)continue;const rejected=model.reasoningProbe?.rejected??[];
    if(rejected.length)throw Error(`模型 ${model.name} 不接受思考档位 ${rejected.join('、')}；请移除这些档位后保存。`);
    if(model.reasoningProbe?.status!=='verified'||model.effortCandidates.some(effort=>!model.reasoningProbe!.accepted.includes(effort)))throw Error(`模型 ${model.name} 的自定义思考档位未能验证；请稍后重试，或清空自定义档位使用服务默认。`);
  }
  return {...connection,models};
}
