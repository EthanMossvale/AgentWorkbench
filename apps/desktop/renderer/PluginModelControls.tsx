import type { NativeModelSelection } from '../../../packages/contracts';
import type { RuntimeCatalogEntry } from '../../../packages/runtime-extensions/types';
import SelectMenu from './SelectMenu';

export default function PluginModelControls({descriptor,value,disabled,onChange}:{descriptor?:RuntimeCatalogEntry;value?:NativeModelSelection;disabled:boolean;onChange:(value:NativeModelSelection)=>void|Promise<void>}) {
  const models=descriptor?.models??[],selected=models.find(m=>m.model===value?.model)??models.find(m=>m.isDefault)??models[0];
  if(!selected)return <span className="muted" data-testid="plugin-model-default">由运行时选择模型</span>;
  return <div className="model-controls" data-testid="plugin-model-controls">
    <SelectMenu label="模型" testId="plugin-model-selector" value={selected.model} disabled={disabled} options={models.map(m=>({value:m.model,label:m.name}))} onChange={model=>{const m=models.find(m=>m.model===model)!;void onChange({model,effort:m.defaultEffort,serviceTier:m.defaultServiceTier});}}/>
    {!!selected.efforts.length&&<SelectMenu label="思考深度" testId="plugin-effort-selector" value={value?.effort??selected.defaultEffort??selected.efforts[0]!} disabled={disabled} options={selected.efforts.map(e=>({value:e,label:e}))} onChange={effort=>void onChange({model:selected.model,...value,effort})}/>}
    {!!selected.serviceTiers.length&&<SelectMenu label="服务档位" testId="plugin-tier-selector" value={value?.serviceTier??selected.defaultServiceTier??selected.serviceTiers[0]!.id} disabled={disabled} options={selected.serviceTiers.map(t=>({value:t.id,label:t.name}))} onChange={serviceTier=>void onChange({model:selected.model,...value,serviceTier})}/>}
  </div>;
}
