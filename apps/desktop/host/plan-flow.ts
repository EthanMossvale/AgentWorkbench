import type { AppState, Message, NativeApproval } from '../../../packages/contracts';
import { planDocument, planTarget, type PlanReference, type PlanTranslation, type PlanBlockTranslation } from '../../../packages/session-core/plan-review';
import { TranslationModule } from '../../../packages/translation/module';

interface Operation {sessionId:string;reference:PlanReference;source:string;blockIndex?:number;abort:AbortController;promise:Promise<void>}

/** Optional display overlay, bound to the immutable native plan and its receipt. */
export class NativePlanFlow {
  private pending=new Map<string,Operation>();
  private disposed=false;
  constructor(private module:TranslationModule,private hooks:{snapshot():AppState;update(fn:(state:AppState)=>void):Promise<unknown>}){}
  read(sessionId:string,reference:PlanReference){const session=this.hooks.snapshot().sessions.find(s=>s.id===sessionId);const doc=session&&planDocument(session,reference);if(!doc||this.disposed)throw Error('PLAN_EXPIRED');return doc;}
  observe(state:AppState){
    for(const operation of this.pending.values()){const session=state.sessions.find(s=>s.id===operation.sessionId);if(!session||planDocument(session,operation.reference)?.text!==operation.source)operation.abort.abort();}
    if(this.disposed||!this.module.enabled())return;
    for(const session of state.sessions)if(session.status==='running'&&session.binding.runtime==='claude'&&!session.archived)for(const approval of session.nativeApprovals??[])if(approval.kind==='plan'&&approval.receipt&&(!approval.planTranslation||approval.planTranslation.translationStatus==='off'))void this.translate(session.id,{kind:'approval',receipt:approval.receipt}).catch(()=>{});
  }
  async translate(sessionId:string,reference:PlanReference,requestedBlock?:unknown){
    this.module.assertEnabled();const document=this.read(sessionId,reference),source=document.blocks;
    if(requestedBlock!==undefined&&(!Number.isSafeInteger(requestedBlock)||(requestedBlock as number)<0||(requestedBlock as number)>=source.length))throw Error('PLAN_BLOCK_INVALID');
    const blockIndex=requestedBlock as number|undefined;
    if(blockIndex!==undefined&&!source[blockIndex]!.translatable)throw Error('PLAN_BLOCK_NOT_TRANSLATABLE');
    const key=JSON.stringify([sessionId,reference.kind,reference.receipt,blockIndex??null]);
    const active=this.pending.get(key);if(active)return active.promise;
    for(const operation of this.pending.values())if(operation.sessionId===sessionId&&operation.reference.kind===reference.kind&&operation.reference.receipt===reference.receipt&&(blockIndex===undefined||operation.blockIndex===undefined))throw Error('PLAN_TRANSLATION_BUSY');
    const indices=source.flatMap((block,index)=>block.translatable&&(blockIndex===undefined||blockIndex===index)?[index]:[]);
    const abort=new AbortController(),policy=this.module.captureConfiguration(),model=this.hooks.snapshot().translation.model;
    const write=async(change:(blocks:PlanBlockTranslation[])=>void,checkPolicy=true)=>this.hooks.update(state=>{
      if(this.disposed||abort.signal.aborted)return;if(checkPolicy)this.module.assertCurrent(policy);
      const session=state.sessions.find(s=>s.id===sessionId),current=session&&planDocument(session,reference);if(!session||current?.text!==document.text)return;
      // Merge into the latest snapshot so independent paragraph retries never overwrite each other.
      const blocks=source.map((block,index):PlanBlockTranslation=>block.translatable?{...(current.planTranslationBlocks?.[index]??{translationStatus:'off'})}:{translationStatus:'complete',translation:block.source});
      change(blocks);
      const status=blocks.some(b=>b.translationStatus==='pending')?'pending':blocks.some(b=>b.translationStatus==='failed')?'failed':blocks.some(b=>b.translationStatus==='off')?'off':'complete';
      const value:PlanTranslation={planTranslationBlocks:blocks,translationStatus:status,translation:blocks.every(b=>typeof b.translation==='string')?blocks.map(b=>b.translation).join('\n\n'):current.translation,translationError:blocks.find(b=>b.translationStatus==='failed')?.translationError,translationSource:blocks.find(b=>b.translationSource)?.translationSource??current.translationSource};
      const target=planTarget(session,reference)!;if(reference.kind==='approval')(target as NativeApproval).planTranslation=value;else Object.assign(target as Message,value);
    });
    // Register before the first update so observe() cannot launch a duplicate request.
    const operation:Operation={sessionId,reference,source:document.text,blockIndex,abort,promise:Promise.resolve()};this.pending.set(key,operation);
    operation.promise=(async()=>{
      try{
        await write(blocks=>{for(const index of indices)blocks[index]={...blocks[index]!,translationStatus:'pending',translationError:undefined};});
        if(!indices.length)return;
        const result=await this.module.segments(Object.fromEntries(indices.map(index=>['b'+index,source[index]!.source])),'output',key,abort.signal,sessionId);
        await write(blocks=>{for(const index of indices)blocks[index]={translationStatus:'complete',translation:result.value['b'+index]!,translationSource:model};});
      }catch(error){
        await write(blocks=>{for(const index of indices)blocks[index]={...blocks[index]!,translationStatus:this.module.enabled()?'failed':'off',translationError:this.module.enabled()?(error instanceof Error?error.message:'PLAN_TRANSLATION_FAILED'):undefined};},false).catch(()=>{});
      }finally{if(this.pending.get(key)===operation)this.pending.delete(key);}
    })();return operation.promise;
  }
  dispose(){this.disposed=true;for(const operation of this.pending.values())operation.abort.abort();this.pending.clear();}
}
