import type { NativeChildSettings,ChildSetting } from '../../../packages/collaboration-core/child-settings';
const labels:Record<string,string>={none:'关闭',minimal:'最低',light:'低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高',ultra:'超高'};
const source={requested:'调用请求；尚无 Subagent 运行时回传',native:'Subagent 原生协议回传；不证明上游物理模型身份',provider:'本次 API 网关的固定映射配置；不证明上游实际采用了参数'};
const hint=(value?:ChildSetting<unknown>)=>value?source[value.source]:'原生协议未提供此 Subagent 的参数；不会从主会话或回复文本推断';
export default function ChildModelSettings({settings={}}:{settings?:NativeChildSettings}){
  const {model,effort,fast}=settings;
  return <div className="child-model-settings" data-testid="child-model-settings" aria-label="Subagent 模型参数">
    <span className="child-model-name" title={`${model?.value??'模型未知'} · ${hint(model)}`} data-testid="child-model">{model?.source==='requested'?'请求 · ':model?.source==='provider'?'API · ':''}{model?.value??'模型未知'}</span>
    <span className="child-model-options"><span title={hint(effort)} data-testid="child-effort">思考 {effort?`${labels[effort.value]??effort.value}${effort.source==='requested'?'（请求）':''}`:'未知'}</span><span title={hint(fast)} data-testid="child-fast" className={fast?.value?'fast-enabled':''}>Fast {fast?`${fast.value?'开启':'关闭'}${fast.source==='requested'?'（请求）':''}`:'未知'}</span></span>
  </div>;
}
