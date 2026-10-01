import { useState } from 'react';
import type { AppState, NativeModelOption, RuntimeKind } from '../../../packages/contracts';
import type { ModelTarget } from '../../../packages/model-api/types';
import { Icon } from './ui';
import { chooseOfficialModel, officialModelGroups } from '../../../packages/model-management/selection';

interface Props { state:AppState; targets:ModelTarget[]; runtime:RuntimeKind; targetId?:string; hostId?:string; accountRef?:string; model?:string; nativeModels:NativeModelOption[]; locked:boolean; disabled:boolean; reading:boolean; onTarget:(target:ModelTarget)=>void; onNative:(model:NativeModelOption)=>void; onRefresh:()=>void; onConfigure:(tab:string)=>void }
export default function ModelTargetPicker({state,targets,runtime,targetId,hostId,accountRef,model,nativeModels,locked,disabled,reading,onTarget,onNative,onRefresh,onConfigure}:Props){
  const [search,setSearch]=useState('');
  const available=targets.filter(target=>target.runtime===runtime);
  const current=(target:ModelTarget)=>!target.binding.modelConnectionId&&target.binding.hostId===hostId&&(!accountRef||target.binding.accountRef===accountRef);
  type Row={id:string;name:string;source:string;group:string;checked:boolean;disabled:boolean;unavailable?:string;choose:()=>void;model?:string};
  const rows:Row[]=[],groups=new Map<string,Row[]>();
  for(const target of available.filter(target=>!target.binding.modelConnectionId&&!target.binding.localAccountId)){
    if(current(target)&&nativeModels.length)continue;
    if(!target.selection&&available.some(other=>other.selection&&other.binding.hostId===target.binding.hostId&&other.binding.accountRef===target.binding.accountRef))continue;
    const group='ssh/'+target.binding.hostId+'/'+target.binding.accountRef,source=(state.hosts.find(host=>host.id===target.binding.hostId)?.name??'SSH')+' · SSH';
    const items=groups.get(group)??[];items.push({id:target.id,name:target.selection||!target.ready?target.name:'默认模型',source,group,model:target.selection?.model,checked:current(target)&&(target.selection?model===target.selection.model:!model),disabled:disabled||locked||!target.ready,unavailable:target.ready?undefined:target.unavailableReason??'此 SSH 模型来源尚未就绪',choose:()=>onTarget(target)});groups.set(group,items);
  }
  if(nativeModels.length){const group='ssh/'+hostId+'/'+accountRef,source=(state.hosts.find(host=>host.id===hostId)?.name??'SSH')+' · SSH';groups.set(group,nativeModels.map(item=>({id:'native/'+item.id,name:item.contextWindow===1000000&&!/1m/i.test(item.name)?item.name+' (1M)':item.name,model:item.model,group,source,checked:model===item.model,disabled,choose:()=>onNative(item)})));}
  for(const group of groups.values())rows.push(...group);
  const currentAccountId=targetId?.startsWith('account/')?targetId.split('/')[1]:undefined;
  for(const group of officialModelGroups(available,runtime)){
    const target=chooseOfficialModel(group.accounts,currentAccountId);
    rows.push({id:'official/'+runtime+'/'+encodeURIComponent(group.model),name:group.name,model:group.model,source:(runtime==='codex'?'Codex':'Claude')+' · 官方账号',group:'official/'+runtime,checked:!!currentAccountId&&group.accounts.some(t=>t.id===targetId),disabled:disabled||locked||!target,unavailable:target?undefined:'账号或运行时未就绪',choose:()=>{if(target)onTarget(target);}});
  }
  for(const connection of state.modelConnections??[])for(const target of available.filter(target=>target.binding.modelConnectionId===connection.id))rows.push({id:target.id,name:target.name,model:target.selection?.model,source:connection.name+' · API',group:connection.id,checked:targetId===target.id,disabled:disabled||locked||!target.ready,unavailable:target.ready?undefined:'运行时或密钥未就绪',choose:()=>onTarget(target)});
  const query=search.trim().toLocaleLowerCase(),visible=rows.filter(row=>(row.name+' '+row.model+' '+row.source).toLocaleLowerCase().includes(query));
  return <div className="model-catalog-picker"><div className="model-catalog-search"><Icon name="search" size={14}/><input aria-label="搜索模型或来源" placeholder="搜索模型或来源" value={search} onChange={event=>setSearch(event.target.value)}/><button className="icon-button" aria-label="刷新模型目录" disabled={reading} onClick={onRefresh}><Icon name="refresh" size={13}/></button></div><div className="model-catalog-list" role="menu" aria-label="模型" onKeyDown={event=>{if(event.nativeEvent.isComposing||!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]:not(:disabled)')],index=items.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();}}>{visible.map((row,index)=><div key={row.id}>{visible[index-1]?.group!==row.group&&<div className="model-catalog-source">{row.source}</div>}<button type="button" role="menuitemradio" data-value={row.id} aria-checked={row.checked} disabled={row.disabled} onClick={row.choose}><span>{row.name}{row.unavailable&&<small>{row.unavailable}</small>}</span>{row.checked&&<Icon name="check" size={13}/>}</button></div>)}{!visible.length&&<p>{reading?'正在读取模型…':rows.length?'没有匹配的模型':runtime==='demo'||runtime==='api'?'请先在上方选择 Codex 或 Claude Code':'添加官方账号、模型 API，或连接 SSH 工作空间。'}</p>}</div><div className="model-catalog-actions"><button className="text-button" onClick={()=>onConfigure('models')}>管理模型与账号</button><button className="text-button" onClick={()=>onConfigure('connections')}>配置 SSH</button></div></div>;
}
