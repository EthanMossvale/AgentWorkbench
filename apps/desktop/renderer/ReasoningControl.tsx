import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './ui';

const names:Record<string,string>={light:'低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高',ultra:'超高',minimal:'最低',none:'关闭'};
export const effortLabel=(value?:string)=>value?`${names[value]??value} · ${value}`:'服务默认';
export default function ReasoningControl({levels,value,defaultValue,disabled,onChange,modelChoice,status,leadingControl}:{levels:string[];value?:string;defaultValue?:string;disabled:boolean;onChange:(value?:string)=>void;modelChoice:ReactNode;status?:string;leadingControl?:ReactNode}){
  const [draft,setDraft]=useState<string>();useEffect(()=>setDraft(undefined),[value,levels.join('|')]);
  const baseline=levels.includes(defaultValue??'')?defaultValue!:levels.includes('medium')?'medium':levels[0]??'';
  const choices=levels.length?levels:[''],current=levels.length?draft??(levels.includes(value??'')?value:baseline):'',index=Math.max(0,choices.indexOf(current??''));
  const commit=(next:string)=>{setDraft(undefined);if(next!==(value??''))onChange(next||undefined);};
  return <div className="effort-control"><div className="effort-heading">{leadingControl}<strong aria-live="polite" title={[effortLabel(current),status].filter(Boolean).join(' · ')}>{current?names[current]??current:'默认'}</strong>{modelChoice}<button className="effort-reset" aria-label="恢复默认档位" title="恢复默认档位" disabled={disabled||!levels.length||current===baseline} onClick={()=>commit(baseline)}><Icon name="refresh" size={13}/></button></div>
    <div className="effort-slider" style={{'--effort-progress':`${index/Math.max(1,choices.length-1)*100}%`} as CSSProperties}><div className="effort-rail"/><div className="effort-ticks" aria-hidden="true">{choices.map((effort,i)=><i key={effort} title={effortLabel(effort)} className={i<=index?'filled':''}/>)}</div>
      <input type="range" data-testid="native-effort" aria-label="思考深度" aria-valuetext={effortLabel(current)} min={0} max={choices.length-1} step={1} value={index} disabled={disabled||levels.length<2} onChange={event=>setDraft(choices[Number(event.target.value)])} onPointerUp={event=>commit(choices[Number(event.currentTarget.value)]!)} onKeyUp={event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))commit(choices[Number(event.currentTarget.value)]!);}} onBlur={event=>{if(draft!==undefined)commit(choices[Number(event.currentTarget.value)]!);}}/>
    </div>
  </div>;
}
