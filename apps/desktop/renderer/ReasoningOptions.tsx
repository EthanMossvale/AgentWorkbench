import type { ApiModel } from '../../../packages/model-api/types';
import { availableReasoningEfforts, reasoningEfforts, reasoningStatus } from '../../../packages/model-api/reasoning-info';

export default function ReasoningOptions({model,onManual,onDefault}:{model:ApiModel;onManual:(levels?:string[])=>void;onDefault:(effort:string)=>void}) {
  const manual=model.manualEfforts;
  return <div className="model-api-reasoning">
    <span>思考档位 <small>{reasoningStatus(model)}</small></span>
    <button type="button" className="text-button model-api-manual-mode" aria-label={(manual?.length?'恢复自动档位 ':'手动选择档位 ')+model.id} onClick={()=>onManual(manual?.length?undefined:availableReasoningEfforts(model).length?[...availableReasoningEfforts(model)]:['medium'])}>{manual?.length?'恢复自动':'手动选择'}</button>
    {manual?.length?<>
      <div className="model-api-effort-options" role="group" aria-label={'手动思考档位 '+model.id}>
        {reasoningEfforts.map(effort=><label className="model-api-choice" key={effort}><input type="checkbox" checked={manual.includes(effort)} disabled={manual.length===1&&manual.includes(effort)} onChange={event=>onManual(reasoningEfforts.filter(value=>value===effort?event.target.checked:manual.includes(value)))}/>{effort}</label>)}
      </div>
      <label className="model-api-manual-default">默认档位<select aria-label={'默认思考档位 '+model.id} value={model.defaultEffort??manual[0]} onChange={event=>onDefault(event.target.value)}>{manual.map(effort=><option key={effort} value={effort}>{effort}</option>)}</select></label>
      <p className="model-api-note">手动选择优先于目录默认值；仅在发送任务时传递所选档位，保存不调用模型。</p>
    </>:!!availableReasoningEfforts(model).length&&<p className="model-api-note">{availableReasoningEfforts(model).join(' · ')}</p>}
  </div>;
}
