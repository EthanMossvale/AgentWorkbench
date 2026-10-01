import type { AppState, NativeModelSelection, RuntimeKind } from '../../../packages/contracts';
import type { ModelTarget } from '../../../packages/model-api/types';
import { localAccountRef } from '../../../packages/model-management/types';
import SelectMenu from './SelectMenu';
import './AccountSelector.css';

export default function LocalAccountSelector({state,runtime,accountId,selection,locked,onTarget}:{state:AppState;runtime:RuntimeKind;accountId:string;selection?:NativeModelSelection;locked:boolean;onTarget(target:ModelTarget):Promise<void>}) {
  const accounts=(state.localModelAccounts??[]).filter(a=>a.provider===runtime&&a.enabled);
  const choose=(id:string)=>{
    const account=accounts.find(a=>a.id===id),model=account?.models.find(m=>m.model===selection?.model);
    if(!account||account.status!=='authenticated'||!model)return;
    const next={model:model.model,...(selection?.effort&&model.efforts.includes(selection.effort)?{effort:selection.effort}:model.defaultEffort?{effort:model.defaultEffort}:{}),...(selection?.serviceTier&&model.serviceTiers.some(t=>t.id===selection.serviceTier)?{serviceTier:selection.serviceTier}:{})};
    void onTarget({id:`account/${id}/${encodeURIComponent(model.model)}`,runtime,name:model.name,description:account.name+' · 官方账号',ready:true,selection:next,binding:{runtime:account.provider,provider:account.provider==='codex'?'openai':'anthropic',accountRef:localAccountRef(id),localAccountId:id,executionId:'local-device',egress:'runtime-managed'}});
  };
  return <div className="composer-account-picker"><SelectMenu label="官方账号" testId="composer-local-account" icon="user" value={accountId} disabled={locked} placeholder="原账号不可用 · 请选择" options={accounts.map(account=>({value:account.id,label:account.name,description:account.status!=='authenticated'?'登录待核实':!account.models.some(m=>m.model===selection?.model)?'此账号暂无所选模型':account.plan??'本机官方登录',disabled:account.status!=='authenticated'||!account.models.some(m=>m.model===selection?.model)}))} onChange={choose} footer={<button type="button" className="text-button" onClick={()=>window.dispatchEvent(new CustomEvent('workbench-settings',{detail:'models'}))}>管理官方账号</button>}/></div>;
}
