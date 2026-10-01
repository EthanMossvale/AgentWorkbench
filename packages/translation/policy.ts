export interface TranslationPolicyToken { epoch:number;signal:AbortSignal }
export class TranslationPolicyGate {
 private epoch=0;private controller=new AbortController();private reconfiguring=0;
 capture():TranslationPolicyToken{if(this.reconfiguring)throw new Error('翻译设置正在保存，暂不接收新请求。');return {epoch:this.epoch,signal:this.controller.signal};}
 assert(token:TranslationPolicyToken){if(this.reconfiguring||token.epoch!==this.epoch||token.signal.aborted)throw new Error('翻译设置或外发同意已变更；旧请求已取消。');}
 invalidate(){this.controller.abort(new Error('翻译设置或外发同意已变更；旧请求已取消。'));this.epoch++;this.controller=new AbortController();}
 beginConfigurationChange(){this.invalidate();this.reconfiguring++;let ended=false;return()=>{if(!ended){ended=true;this.reconfiguring--;}};}
}
