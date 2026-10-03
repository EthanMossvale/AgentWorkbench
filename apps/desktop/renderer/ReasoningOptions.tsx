import type { ApiModel } from '../../../packages/model-api/types';
import {useEffect,useState} from 'react';
import {api} from './App';
import {errorText} from './ui';
import { availableReasoningEfforts, reasoningEfforts, reasoningStatus } from '../../../packages/model-api/reasoning-info';

export default function ReasoningOptions({model,onManual,onDefault}:{model:ApiModel;onManual:(levels?:string[])=>void;onDefault:(effort:string)=>void}) {
  const manual=model.manualEfforts;
  const [custom,setCustom]=useState(''),[registered,setRegistered]=useState<string[]>([]),[error,setError]=useState('');
  useEffect(()=>{let active=true,revision=0;const load=()=>{const current=++revision;void api<string[]>('model-api/reasoning/options',{model}).then(values=>{if(active&&current===revision&&Array.isArray(values)){setRegistered(values);setError('');}}).catch(e=>{if(active&&current===revision)setError(errorText(e));});};load();const off=window.workbench.onExtensions?.(load);return()=>{active=false;off?.();};},[model]);
  const options=[...new Set([...reasoningEfforts,...availableReasoningEfforts(model),...registered,...(manual??[])])];
  const add=()=>{const value=custom.trim();if(value){onManual([...new Set([...(manual??[]),value])]);setCustom('');}};
  return <div className="model-api-reasoning" data-workbench-reasoning-options>
    {error&&<p role="alert">{error}</p>}
    <span>思考档位 <small>{reasoningStatus(model)}</small></span>
    <button type="button" className="text-button model-api-manual-mode" aria-label={(manual?.length?'恢复自动档位 ':'手动选择档位 ')+model.id} onClick={()=>onManual(manual?.length?undefined:availableReasoningEfforts(model).length?[...availableReasoningEfforts(model)]:['medium'])}>{manual?.length?'恢复自动':'手动选择'}</button>
    {manual?.length?<>
      <div className="model-api-effort-options" role="group" aria-label={'手动思考档位 '+model.id}>
        {options.map(effort=><label className="model-api-choice" key={effort}><input type="checkbox" checked={manual.includes(effort)} disabled={manual.length===1&&manual.includes(effort)} onChange={event=>onManual(options.filter(value=>value===effort?event.target.checked:manual.includes(value)))}/>{effort}</label>)}
      </div>
      <div className="model-api-custom-effort"><input aria-label={'自定义思考档位 '+model.id} placeholder="输入上游支持的档位名称" value={custom} onChange={event=>setCustom(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();add();}}}/><button type="button" className="text-button" aria-label={'添加档位 '+model.id} disabled={!custom.trim()} onClick={add}>添加</button></div>
      <label className="model-api-manual-default">默认档位<select aria-label={'默认思考档位 '+model.id} value={model.defaultEffort??manual[0]} onChange={event=>onDefault(event.target.value)}>{manual.map(effort=><option key={effort} value={effort}>{effort}</option>)}</select></label>
      <p className="model-api-note">手动选择优先于目录默认值；仅在发送任务时传递所选档位，保存不调用模型。</p>
    </>:!!availableReasoningEfforts(model).length&&<p className="model-api-note">{availableReasoningEfforts(model).join(' · ')}</p>}
  </div>;
}
