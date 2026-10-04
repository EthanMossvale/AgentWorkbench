import type { AppState, Session, TranslationProfile } from '../../../packages/contracts';
import { modelTargets } from '../../../packages/model-api/targets';
import { availableReasoningEfforts } from '../../../packages/model-api/reasoning-info';
import type { TranslationBackend, TranslationTargetProvider } from '../../../packages/translation/types';
import { NativeTranslationRunner } from '../../../packages/translation/native';
import type { LocalCliService } from '../../../packages/native-runtime/cli';
import type { ModelConnections } from './model-connections';
import { modelProviders } from '../../../packages/model-api/providers';
import type { LocalModelAccounts } from './local-model-accounts';

export class WorkbenchTranslationTargets implements TranslationTargetProvider {
  private active=new Map<string,number>();
  constructor(private state:()=>AppState,private connections:ModelConnections,private accounts:LocalModelAccounts,private native:NativeTranslationRunner,private cli?:LocalCliService){}
  busy(id?:string){return id?(this.active.get(id)??0)>0:this.active.size>0;}
  private catalog(){return [...modelTargets(this.state(),()=>false).filter(t=>t.binding.modelConnectionId),...this.accounts.targets()];}
  async list(){const targets=this.catalog(),available=new Map<string,boolean>();
    for(const runtime of new Set(targets.filter(t=>t.binding.localAccountId).map(t=>t.runtime)))available.set(runtime,!!this.cli&&!this.cli.isMaintaining()&&!!await this.cli.locate(runtime as 'codex'|'claude'));
    return targets.map(t=>{
    const connection=this.state().modelConnections?.find(c=>c.id===t.binding.modelConnectionId),model=connection?.models.find(m=>m.id===t.binding.modelMappingId),account=this.state().localModelAccounts?.find(a=>a.id===t.binding.localAccountId),native=account?.models.find(m=>m.model===t.selection?.model);
    const ready=t.ready&&(!account||available.get(account.provider)===true);
    return {id:t.id,name:t.name,description:t.description,model:t.selection!.model,runtime:t.runtime,ready,...(!ready?{reason:'模型、凭据或原生运行时暂不可用。'}:{}),efforts:model?availableReasoningEfforts(model):native?.efforts??[],defaultEffort:t.selection?.effort};
  });}
  async resolve(id:string,profile:TranslationProfile,effort?:string):Promise<TranslationBackend>{
    const target=this.catalog().find(t=>t.id===id);if(!target?.ready)throw Error('TRANSLATION_TARGET_UNAVAILABLE');
    const binding=target.binding;
    if(binding.modelConnectionId){
      const connection=this.connections.connection(binding.modelConnectionId),model=connection.models.find(m=>m.id===binding.modelMappingId&&m.enabled);if(!connection.enabled||!model)throw Error('TRANSLATION_TARGET_UNAVAILABLE');
      const protocol=modelProviders.protocol(connection,model.model);
      return {sourceId:id,runtime:'api',auth:connection.auth,requestHeaders:sessionId=>modelProviders.headers({...connection,protocol},{model:model.model,sessionId}),profile:{...profile,baseUrl:connection.baseUrl,protocol,model:model.model,name:connection.name,consent:true,effort:undefined,verifiedEfforts:[],reasoning:effort?{mode:protocol==='anthropic-messages'?'adaptive':'effort',effort,confirmed:true}:undefined},key:await this.connections.key(connection)};
    }
    if(!binding.localAccountId||!this.cli)throw Error('TRANSLATION_TARGET_UNAVAILABLE');
    const session={binding,modelSelection:{model:target.selection!.model,...(effort?{effort}:{})}} as Session;
    const execution=this.accounts.execution(session),found=await this.cli.locate(execution.account.provider);if(!found)throw Error('LOCAL_ACCOUNT_RUNTIME_MISSING');
    const accountId=binding.localAccountId;
    return {sourceId:id,runtime:execution.account.provider,profile:{...profile,model:target.selection!.model,name:execution.account.name,consent:true,reasoning:undefined,effort:undefined,verifiedEfforts:[]},execute:async request=>{
      const current=this.accounts.execution(session);this.active.set(accountId,(this.active.get(accountId)??0)+1);
      try{return await this.native.run({runtime:current.account.provider,executable:found.executable,env:current.env,model:target.selection!.model,effort},request);}finally{const count=(this.active.get(accountId)??1)-1;if(count)this.active.set(accountId,count);else this.active.delete(accountId);}
    }};
  }
}
