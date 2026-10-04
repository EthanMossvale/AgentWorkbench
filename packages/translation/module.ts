import type { AppState, TranslationDirection, TranslationResult } from '../contracts/index';
import { TranslationPolicyGate, type TranslationPolicyToken } from './policy';
import { TranslationQueue } from './queue';
import { Translator, listModels, type Fetcher } from './provider';
import { translationEnabled, translationModuleEnabled } from './settings';
import { TranslationTargetRegistry } from './targets';
import { translationMetrics } from './usage';
import type { TranslationBackend, TranslationUsageReceipt } from './types';
export { translationEnabled } from './settings';

export const translationManifest = Object.freeze({
  id: 'translation', version: '1.0.0', name: '双语翻译', defaultEnabled: true,
  description: '独立处理输入、公开进度和结果译文；关闭后使用原文工作流。',
  capabilities: ['translation.input', 'translation.progress', 'translation.final'],
});
export interface TranslationDelivery<T> { value: T; policy: TranslationPolicyToken }

/** Optional text processing; native sessions and execution never belong to this module. */
export class TranslationModule {
  readonly targets = new TranslationTargetRegistry();
  private policy = new TranslationPolicyGate();
  readonly queue = new TranslationQueue();
  private translator: Translator;
  private disposed = false;
  private pending = new Map<symbol,{source:string;done:Promise<void>}>();
  busy(id?:string){return id?[...this.pending.values()].some(({source})=>source.startsWith('api/'+encodeURIComponent(id)+'/')||source.startsWith('account/'+id+'/')):this.pending.size>0;}
  private begin(){const token=Symbol(),source=this.state().translation.source;let resolve!:()=>void;const done=new Promise<void>(yes=>resolve=yes);this.pending.set(token,{source:source?.kind==='model'?source.targetId:'custom',done});return()=>{this.pending.delete(token);resolve();};}
  /** `read` is an optional copy-free view for the flag checks that run on every state change. */
  constructor(private state: () => AppState, private key: (scope: string) => Promise<string>, private fetcher: Fetcher = fetch, observed?:(receipt:TranslationUsageReceipt)=>Promise<void>, reserve?:(sessionId:string,limit:number)=>Promise<void>, private read: () => Readonly<AppState> = state) {
    this.translator = new Translator(fetcher, observed, reserve);
  }
  get outputs(){return this.translator.outputs;}
  enabled() { return !this.disposed && translationEnabled(this.read() as AppState); }
  private assertModuleEnabled() { if (this.disposed || !translationModuleEnabled(this.read() as AppState)) throw new Error('翻译模块已关闭；请先在设置中开启。'); }
  assertEnabled() { this.assertModuleEnabled(); if (!this.enabled()) throw new Error('翻译已临时暂停；请在会话框左下角恢复翻译。'); }
  describe() { return { ...translationManifest, enabled: !this.disposed && translationModuleEnabled(this.read() as AppState) }; }
  usage(sessionId?:string) {
    const state=this.state(),session=sessionId===undefined?undefined:state.sessions.find(item=>item.id===sessionId);
    if(sessionId!==undefined&&!session)throw Error('TRANSLATION_SESSION_MISSING');
    return {...this.translator.usage(state.translation.id),...(session?{sessionCalls:session.translationCalls??0}:{}),snapshot:translationMetrics(state.translationUsage)};
  }
  beginConfigurationChange() { return this.policy.beginConfigurationChange(); }
  captureConfiguration() { return this.policy.capture(); }
  assertConfiguration(token: TranslationPolicyToken) { this.policy.assert(token); }
  assertCurrent(token: TranslationPolicyToken) { this.policy.assert(token); this.assertEnabled(); }
  private async requestContext(signal?: AbortSignal, configuration = false) {
    const assertEnabled = () => configuration ? this.assertModuleEnabled() : this.assertEnabled();
    assertEnabled(); const policy = this.policy.capture(); const state = this.state();
    let backend:TranslationBackend;
    const signals=[policy.signal,...(signal?[signal]:[])];
    if(!configuration&&state.translation.source?.kind==='model'){
      const resolved=await this.targets.resolve(state.translation.source.targetId,state.translation,state.translation.source.effort);
      backend=resolved.backend;signals.push(resolved.signal);
    }else backend={profile:state.translation,key:await this.key(state.translation.baseUrl),runtime:'api',sourceId:'custom:'+state.translation.id};
    this.policy.assert(policy);assertEnabled();
    return { state, backend, key:backend.key??'', policy, signal: AbortSignal.any(signals) };
  }
  async models() {
    const context = await this.requestContext(undefined, true);
    const models = await listModels(context.state.translation, context.key, this.fetcher, context.signal);
    this.policy.assert(context.policy); this.assertModuleEnabled();
    return { models, source: context.state.translation.baseUrl };
  }
  async translate(text: string, direction: TranslationDirection, operationId: string, priority: 'input' | 'progress' | 'final', signal?: AbortSignal, sessionId='runtime'): Promise<TranslationDelivery<TranslationResult>> {
    const finish=this.begin();try {
    const context = await this.requestContext(signal);
    const value = await this.queue.enqueue(operationId, priority, () => {
      this.assertCurrent(context.policy);
      return this.translator.translate(text, direction, context.backend.profile, context.key, context.signal,'translation',context.backend,sessionId);
    }, context.signal);
    this.assertCurrent(context.policy);
    return { value:direction==='output'&&value.incomplete?{...value,text:'（部分译文，尚未完成）\n'+value.text}:value, policy: context.policy };
    }finally{finish();}
  }
  async refine(original: string, instruction: string, operationId: string, signal?: AbortSignal, sessionId='runtime') {
    const finish=this.begin();try {
    const context = await this.requestContext(signal);
    const value = await this.queue.enqueue(operationId, 'input', () => {
      this.assertCurrent(context.policy);
      return this.translator.integrateSupplement(original, instruction, context.backend.profile, context.key, context.signal,context.backend,sessionId);
    }, context.signal);
    this.assertCurrent(context.policy);
    return value;
    }finally{finish();}
  }
  async segments(values:Record<string,string>,direction:TranslationDirection,operationId:string,signal?:AbortSignal,sessionId='runtime') {
    const finish=this.begin();try {
    const context=await this.requestContext(signal);
    const value=await this.queue.enqueue(operationId,'input',()=>this.translator.translate(JSON.stringify(values),direction,context.backend.profile,context.key,context.signal,'segments',context.backend,sessionId),context.signal);
    this.assertCurrent(context.policy);
    const translated=JSON.parse(value.text) as Record<string,string>;
    return {value:direction==='output'&&value.incomplete?Object.fromEntries(Object.entries(translated).map(([id,text])=>[id,'（部分译文，尚未完成；缺失段落保留原文）\n'+text])):translated,incomplete:value.incomplete,policy:context.policy};
    }finally{finish();}
  }
  async dispose() { if (!this.disposed) { this.disposed = true; this.policy.invalidate(); this.targets.dispose(); } await Promise.all([...this.pending.values()].map(task=>task.done)); }
}
