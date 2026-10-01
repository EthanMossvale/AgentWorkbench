import { randomUUID } from 'node:crypto';
import type { AppState } from '../../../packages/contracts';
import type { ModelConnection } from '../../../packages/model-api/types';
import { nativeContextSettings } from '../../../packages/model-api/native-context';
import { mergeDirectory, validateConnection } from '../../../packages/model-api/config';
import { discoverModels } from '../../../packages/model-api/provider';
import { verifyConnectionReasoning } from '../../../packages/model-api/reasoning-probe';
import { applyReasoning, reasoningCandidates } from '../../../packages/model-api/reasoning-info';
import type { SecretStore } from './store';
import {ReasoningJobs,probeSignature} from './reasoning-jobs';

export const modelCredentialScope = (connection: Pick<ModelConnection, 'id' | 'baseUrl' | 'protocol'>) => JSON.stringify([connection.id, connection.baseUrl, connection.protocol]);
interface Hooks { snapshot():AppState; update(change:(state:AppState)=>void):Promise<unknown>; busy(id:string):boolean }
export class ModelConnections {
  private queue:Promise<unknown>=Promise.resolve();
  readonly reasoning:ReasoningJobs;
  private disposed=false;private deferred=new Set<ReturnType<typeof setTimeout>>();
  constructor(private hooks:Hooks,private secrets:SecretStore,private fetcher:typeof fetch=fetch){this.reasoning=new ReasoningJobs(fetcher);}
  dispose(){this.disposed=true;for(const timer of this.deferred)clearTimeout(timer);this.deferred.clear();this.reasoning.dispose();}
  connection(id:unknown){const connection=this.hooks.snapshot().modelConnections?.find(item=>item.id===id);if(!connection)throw Error('模型连接已不存在，请重新选择。');return connection;}
  async key(connection:ModelConnection){return connection.auth==='none'?'':this.secrets.getModel(connection.credentialRef,modelCredentialScope(connection));}
  call(method:string,p:Record<string,unknown>):Promise<unknown>{
    if(method.startsWith('model-api/reasoning/'))return this.reasoningCall(method,p);
    const action=()=>this.perform(method,p);
    // Serialize credentials with metadata CAS, including refresh/delete.
    const pending=this.queue.then(action);this.queue=pending.catch(()=>{});return pending;
  }
  private async reasoningCall(method:string,p:Record<string,unknown>){
    if(method==='model-api/reasoning/status')return this.reasoning.status(String(p.jobId));
    if(method==='model-api/reasoning/cancel')return this.reasoning.cancel(String(p.jobId));
    if(method!=='model-api/reasoning/start')throw Error('REASONING_OPERATION_UNKNOWN');
    if(p.allowInference!==true)throw Error('REASONING_INFERENCE_REQUIRES_EXPLICIT_CONSENT');
    const previous=p.id?this.connection(p.id):undefined,candidate=validateConnection(p.connection,previous),same=previous&&modelCredentialScope(candidate)===modelCredentialScope(previous);
    if(p.key!==undefined&&(typeof p.key!=='string'||p.key.length>4096))throw Error('MODEL_KEY_INVALID');
    if(p.key===undefined&&previous?.hasKey&&!same)throw Error('MODEL_KEY_REQUIRED_FOR_NEW_SOURCE');
    const key=p.key!==undefined?String(p.key).trim():same?await this.key(previous!):'';candidate.auth=key?'key':'none';
    return this.reasoning.start(candidate,key,same&&p.key===undefined?previous:undefined,p.force===true);
  }
  private safeWhileBusy(previous:ModelConnection,candidate:ModelConnection,p:Record<string,unknown>){
    if(p.key!==undefined||modelCredentialScope(previous)!==modelCredentialScope(candidate)||previous.enabled!==candidate.enabled)return false;
    const essential=(m:ModelConnection['models'][number])=>JSON.stringify([m.model,m.enabled,m.contextWindow,m.maxOutputTokens,!!m.adaptiveThinking,m.effortCandidates,m.manualEfforts,m.manualEfforts?.length?m.defaultEffort:undefined]);
    return previous.models.filter(m=>m.enabled).every(old=>candidate.models.some(m=>m.id===old.id&&essential(m)===essential(old)));
  }
  private async perform(method:string,p:Record<string,unknown>){
    if(method==='model-api/context-budget'){
      const window=p.contextWindow;
      if(window!==undefined&&(!Number.isSafeInteger(window)||Number(window)<1||Number(window)>100000000))throw Error('MODEL_CONTEXT_WINDOW_INVALID');
      const settings=nativeContextSettings({id:'',model:'',name:'',enabled:false,contextWindow:window as number|undefined});
      return {window:settings?.window??null,compactAt:settings?.compactAt??null,percent:90,trigger:'native'};
    }
    if(method==='model-api/list')return this.hooks.snapshot().modelConnections??[];
    const previous=p.id?this.connection(p.id):undefined;
    if(previous&&p.revision!==previous.revision)throw Error('模型连接已在其他位置更新，请重新读取后保存。');
    if(method==='model-api/set-enabled'){
      if(!previous||typeof p.enabled!=='boolean')throw Error('请选择连接及开关状态。');
      if(this.hooks.busy(previous.id))throw Error('请等待此连接的任务结束，并关闭发送预览后再切换。');
      await this.hooks.update(s=>{if(this.hooks.busy(previous.id))throw Error('此连接仍有待处理任务。');const current=s.modelConnections?.find(item=>item.id===previous.id);if(!current||current.revision!==previous.revision)throw Error('连接已变化。');current.enabled=p.enabled as boolean;current.revision=randomUUID();});return this.connection(previous.id);
    }
    if(method==='model-api/delete'){
      if(!previous||p.confirm!==true)throw Error('请确认删除所选模型连接。');
      if(this.hooks.busy(previous.id))throw Error('此连接有运行中、待提交或结果未知的会话。');
      await this.hooks.update(s=>{if(this.hooks.busy(previous.id))throw Error('此连接仍有待处理任务。');s.modelConnections=s.modelConnections?.filter(item=>item.id!==previous.id);});
      await this.secrets.deleteModel(previous.credentialRef);return null;
    }
    if(method==='model-api/refresh'){
      if(!previous)throw Error('模型连接不存在。');
      const directory=await discoverModels(previous,await this.key(previous),this.fetcher),next=mergeDirectory(previous,directory);
      await this.hooks.update(s=>{const current=s.modelConnections?.find(item=>item.id===previous.id);if(!current||current.revision!==previous.revision)throw Error('连接已变化。');Object.assign(current,next);});return next;
    }
    if(method!=='model-api/save'&&method!=='model-api/discover')throw Error('Unknown model connection operation.');
    const candidate=validateConnection(p.connection,previous);
    if(p.verifyReasoning!==undefined&&typeof p.verifyReasoning!=='boolean')throw Error('思考档位检测选项无效。');
    if(p.backgroundReasoning!==undefined&&typeof p.backgroundReasoning!=='boolean'||p.backgroundReasoning===true&&p.verifyReasoning===true)throw Error('REASONING_MODE_INVALID');
    if((p.backgroundReasoning===true||p.verifyReasoning===true)&&p.allowInference!==true)throw Error('REASONING_INFERENCE_REQUIRES_EXPLICIT_CONSENT');
    if(p.forceReasoning!==undefined&&(typeof p.forceReasoning!=='boolean'||p.forceReasoning===true&&p.verifyReasoning!==true))throw Error('重新检测须同时开启思考档位验证。');
    if(previous&&method==='model-api/save'&&this.hooks.busy(previous.id)&&!this.safeWhileBusy(previous,candidate,p))throw Error('此连接正在使用，暂不能修改地址、密钥或已启用模型；可以添加新模型。');
    const same=previous&&modelCredentialScope(previous)===modelCredentialScope(candidate);
    if(method==='model-api/save'&&candidate.models.some(model=>model.enabled&&model.effortCandidates?.length)&&p.verifyReasoning!==true)throw Error('自定义思考档位必须在保存时验证。');
    if(same&&p.key===undefined)candidate.models=candidate.models.map(model=>{const old=previous.models.find(item=>item.id===model.id&&item.model===model.model);return old?.reasoningProbe&&!!model.adaptiveThinking===!!old.adaptiveThinking&&JSON.stringify(reasoningCandidates(model))===JSON.stringify(reasoningCandidates(old))?applyReasoning(model,{efforts:old.reasoningProbe.status==='declared'?old.reasoningProbe.declared:old.reasoningProbe.status==='verified'?old.reasoningProbe.accepted:undefined,defaultEffort:old.defaultEffort,reasoningProbe:old.reasoningProbe}):model;});
    if(previous&&!same){candidate.discoveredModels=[];candidate.discoveredAt=undefined;candidate.models=candidate.models.map(model=>({...model,contextWindow:undefined,maxOutputTokens:undefined,efforts:undefined,manualEfforts:undefined,defaultEffort:undefined,reasoningProbe:undefined,adaptiveThinking:undefined,metadataSource:undefined}));}
    const supplied=typeof p.key==='string'?p.key.trim():'';
    if(p.key!==undefined&&(typeof p.key!=='string'||p.key.length>4096))throw Error('模型密钥格式不正确。');
    // An omitted field preserves a saved key; an explicitly empty field clears it.
    // Never move a saved credential to a different address or protocol implicitly.
    if(p.key===undefined&&previous?.hasKey&&!same)throw Error('地址或协议已变化，请重新填写 API 密钥；不需要密钥时可清除原密钥。');
    const key=p.key!==undefined?supplied:(same?await this.key(previous!):'');
    candidate.auth=key?'key':'none';
    if(method==='model-api/discover')return discoverModels(candidate,key,this.fetcher);
    let next=candidate,newCredential:string|undefined;
    try{
      if(candidate.auth==='key')newCredential=p.key!==undefined||!same?await this.secrets.setModel(modelCredentialScope(candidate),key):previous?.credentialRef;
      next={...candidate,hasKey:!!key,credentialRef:newCredential};
      if(p.backgroundReasoning!==true)try{next=mergeDirectory(next,await discoverModels(next,key,this.fetcher));}catch(error){next.discoveryError=error instanceof Error?error.message:'模型目录读取失败，可手动添加模型。';}
      if(p.verifyReasoning===true)next=await verifyConnectionReasoning(next,key,same&&p.key===undefined?previous:undefined,this.fetcher,p.forceReasoning===true);
      await this.hooks.update(s=>{if(previous&&this.hooks.busy(previous.id)&&!this.safeWhileBusy(previous,next,p))throw Error('此连接仍有待处理任务。');s.modelConnections??=[];const index=s.modelConnections.findIndex(item=>item.id===next.id);if(previous&&(index<0||s.modelConnections[index]!.revision!==previous.revision))throw Error('连接已变化。');if(index<0)s.modelConnections.push(next);else s.modelConnections[index]=next;});
    }catch(error){if(newCredential&&newCredential!==previous?.credentialRef)await this.secrets.deleteModel(newCredential);throw error;}
    if(previous?.credentialRef!==next.credentialRef)await this.secrets.deleteModel(previous?.credentialRef);
    if(p.backgroundReasoning===true){
      const signature=probeSignature(next,key),apply=async(models:ModelConnection['models'])=>{const action=async()=>{if(this.disposed)return;if(this.hooks.busy(next.id)){const timer=setTimeout(()=>{this.deferred.delete(timer);void apply(models);},1000);timer.unref();this.deferred.add(timer);return;}const current=this.hooks.snapshot().modelConnections?.find(c=>c.id===next.id);if(!current||probeSignature(current,await this.key(current))!==signature)return;await this.hooks.update(s=>{const target=s.modelConnections?.find(c=>c.id===next.id);if(!target||target.revision!==current.revision)return;target.models=target.models.map(m=>{const result=models.find(r=>r.id===m.id&&r.model===m.model);return result?applyReasoning(m,{efforts:result.efforts,defaultEffort:result.defaultEffort,reasoningProbe:result.reasoningProbe}):m;});});};const operation=this.queue.then(action);this.queue=operation.catch(()=>{});await operation;};
      try{if(!p.jobId||!this.reasoning.attach(String(p.jobId),next,key,apply)){const job=this.reasoning.start(next,key,same&&p.key===undefined?previous:undefined);this.reasoning.attach(job.id,next,key,apply);}}
      catch{return {...next,reasoningJobError:'REASONING_DETECTION_UNAVAILABLE'};}
    }
    return next;
  }
}
