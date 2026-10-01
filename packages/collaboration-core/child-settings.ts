import type { NativeFrame } from '../../services/remote-supervisor';
import type { NativeModelSelection } from '../contracts';

/** Metadata describes configuration or a reported model, never hidden backend identity. */
export type ChildSettingSource = 'requested' | 'native' | 'provider';
export interface ChildSetting<T> { value:T; source:ChildSettingSource }
export interface NativeChildSettings {
  model?:ChildSetting<string>;
  effort?:ChildSetting<string>;
  fast?:ChildSetting<boolean>;
}
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\x00-\x1f]/.test(v);

export function childSettings(value:unknown,source:ChildSettingSource):NativeChildSettings {
  const v=object(value),result:NativeChildSettings={};
  if(text(v.model)&&!['<synthetic>','inherit'].includes(v.model))result.model={value:v.model,source};
  const effort=v.reasoningEffort??v.effort;
  if(text(effort))result.effort={value:effort,source};
  if(typeof v.fastMode==='boolean')result.fast={value:v.fastMode,source};
  else if(v.serviceTier==='priority'||v.serviceTier==='fast')result.fast={value:true,source};
  else if(v.serviceTier==='default'||v.serviceTier==='standard')result.fast={value:false,source};
  return result;
}

/** Merge per field: later partial observations do not erase stronger evidence. */
export function mergeChildSettings(previous:NativeChildSettings={},next:NativeChildSettings={}):NativeChildSettings {
  const merged={...previous},rank={requested:0,native:1,provider:2};
  for(const key of ['model','effort','fast'] as const){const value=next[key];if(value&&(!previous[key]||rank[value.source]>=rank[previous[key]!.source]))Object.assign(merged,{[key]:value});}
  return merged;
}

/** Only explicitly scoped protocol metadata. Public reply prose is never parsed. */
export function nativeChildFrameSettings(runtime:'claude'|'codex',frame:NativeFrame):NativeChildSettings {
  const msg=frame.value,params=object(msg.params);
  if(runtime==='codex')return msg.method==='thread/started'?childSettings(object(params.thread),'native'):{};
  if(msg.type==='assistant')return childSettings({model:object(msg.message).model},'native');
  const event=object(msg.event);
  if(msg.type==='stream_event'&&event.type==='message_start')return childSettings({model:object(event.message).model},'native');
  if(msg.type==='system'&&msg.subtype==='init')return childSettings({model:msg.model,fastMode:msg.fast_mode_state==='on'?true:msg.fast_mode_state==='off'?false:undefined},'native');
  return {};
}

/** A fixed third-party gateway mapping is distinct from native family aliases. */
export function providerChildSettings(model:string,selection?:NativeModelSelection):NativeChildSettings {
  return childSettings({model,effort:selection?.effort},'provider');
}
