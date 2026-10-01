import type { AppState, NativeModelSelection, Session } from '../../../packages/contracts';
import SelectMenu from './SelectMenu';
import './ModelApiSettings.css';
const labels:Record<string,string>={none:'关闭',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最大',ultra:'超高'};
export default function ApiModelControls({state,targetId,session,value,disabled,onChange}:{state:AppState|null;targetId?:string;session?:Session;value?:NativeModelSelection;disabled:boolean;onChange:(selection:NativeModelSelection)=>void|Promise<void>}){
  const parts=targetId?.split('/'),connection=state?.modelConnections?.find(item=>item.id===(parts?.[1]?decodeURIComponent(parts[1]):'')),model=connection?.models.find(item=>item.id===(parts?.[2]?decodeURIComponent(parts[2]):''));
  const usage=session?.nativeContextUsage,capacity=usage?.capacity??model?.contextWindow;
  const percent=capacity&&usage?Math.min(100,Math.round(usage.used/capacity*100)):undefined;
  return <div className="api-model-controls"><span className="api-model-context" title={capacity?`上下文窗口 ${capacity.toLocaleString()}；${usage?`最近输入 ${usage.used.toLocaleString()}`:'尚无用量回执'}。压缩由执行层管理，原始历史保留。`:'上游未提供上下文窗口，不显示猜测值。'}>{percent===undefined?capacity?`${Math.round(capacity/1000)}k`:'窗口未知':`${percent}%`}</span>{model?.efforts?.length?<SelectMenu label="思考深度" testId="api-model-effort" value={value?.effort??''} placeholder="服务默认" disabled={disabled} onChange={effort=>{void onChange({model:model.model,...(effort?{effort}:{})});}} options={[{value:'',label:'服务默认'},...model.efforts.map(effort=>({value:effort,label:labels[effort]??effort}))]}/>:<span className="api-model-context">服务默认</span>}</div>;
}
