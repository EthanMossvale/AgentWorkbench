import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { AppState, NativeModelOption, NativeModelSelection, RuntimeKind, Session } from '../../../packages/contracts';
import type { ModelTarget } from '../../../packages/model-api/types';
import ModelTargetPicker from './ModelTargetPicker';
import { api } from './App';
import { errorText, Icon } from './ui';
import './ModelControls.css';
import ApiCallBudget from './ApiCallBudget';
import ReasoningControl from './ReasoningControl';
import { availableReasoningEfforts, reasoningStatus } from '../../../packages/model-api/reasoning-info';
import { currentProviderContext, displayedContext } from '../../../packages/model-api/native-context';
import { nativeContextState } from '../../../packages/model-api/context-state';
import { useModelSelection } from './use-model-selection';
const efforts: Record<string,string> = { none:'关闭', minimal:'最低', light:'低', low:'低', medium:'中', high:'高', xhigh:'极高', max:'最高', ultra:'超高' };
interface Props { state:AppState|null; targetId?:string; bindingLocked:boolean; onTarget:(target:ModelTarget)=>void|Promise<void>; active:boolean; runtime:RuntimeKind; session?:Session; hostId?:string; accountRef?:string; value?:NativeModelSelection; disabled:boolean; onChange:(selection:NativeModelSelection)=>void|Promise<void> }
export default function ModelControls({state,targetId,bindingLocked,onTarget,active,runtime,session,hostId,accountRef,value,disabled,onChange}:Props) {
  const [open,setOpen]=useState(false),[contextOpen,setContextOpen]=useState(false),[models,setModels]=useState<NativeModelOption[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [catalogOpen,setCatalogOpen]=useState(false),[configurationRevision,setConfigurationRevision]=useState(0);
  useEffect(()=>{const changed=()=>setConfigurationRevision(v=>v+1);window.addEventListener('remote-configuration-changed',changed);return()=>window.removeEventListener('remote-configuration-changed',changed);},[]);
  const [targets,setTargets]=useState<ModelTarget[]>([]),[reading,setReading]=useState(false);
  const targetEpoch=useRef(0),targetRefreshing=useRef(false);
  const [position,setPosition]=useState<CSSProperties>({visibility:'hidden'}),[contextPosition,setContextPosition]=useState<CSSProperties>({visibility:'hidden'});
  const trigger=useRef<HTMLButtonElement>(null),ring=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null),contextPanel=useRef<HTMLDivElement>(null),epoch=useRef(0);
  const hoverTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),closeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const sourceKey=JSON.stringify([runtime,hostId,accountRef,session?.id,session?.binding.localAccountId,session?.binding.modelConnectionId,targetId?.split('/').slice(0,2)]);
  const selection=useModelSelection(sourceKey,value??session?.nativeEffectiveModel,onChange,e=>setError(errorText(e)));
  const effective=selection.value;
  const parts=targetId?.split('/'),connection=state?.modelConnections?.find(connection=>connection.id===(session?.binding.modelConnectionId??(parts?.[0]==='api'?decodeURIComponent(parts[1]??''):undefined)));
  const providerModel=connection?.models.find(model=>model.id===(session?.binding.modelMappingId??decodeURIComponent(parts?.[2]??'')));
  const localAccount=state?.localModelAccounts?.find(account=>account.id===(session?.binding.localAccountId??(parts?.[0]==='account'?parts[1]:undefined)));
  const selected:NativeModelOption|undefined=providerModel?{...providerModel,isDefault:false,efforts:availableReasoningEfforts(providerModel),serviceTiers:[]}:localAccount?.models.find(model=>model.model===(effective?.model??decodeURIComponent(parts?.[2]??'')))??models.find(model=>model.model===effective?.model)??(!effective?models.find(model=>model.isDefault):undefined);
  const revision=JSON.stringify([(state?.modelConnections??[]).map(connection=>[connection.id,connection.revision]),state?.hosts,Object.entries(state?.accountCatalogs??{}).map(([id,c])=>[id,c.authorityId,c.generation,c.selectionRevision,c.selectedAccountId,c.claudeSelectionRevision,c.selectedClaudeAccountId,c.availability,c.accounts.map(a=>[a.id,a.generation,a.status])]),state?.localModelAccounts?.map(a=>[a.id,a.revision,a.status]),state?.runtimeExtensions]);
  const loadTargets=async(refresh=false)=>{if(targetRefreshing.current)return;const request=++targetEpoch.current;targetRefreshing.current=refresh;setReading(true);try{const next=await api<ModelTarget[]>('model-targets/list',{refresh});if(request===targetEpoch.current){setTargets(next);setError('');}}catch(error){if(request===targetEpoch.current)setError(errorText(error));}finally{if(request===targetEpoch.current)setReading(false);if(refresh)targetRefreshing.current=false;}};
  useEffect(()=>{if(active)void loadTargets(false);},[active,revision,configurationRevision]);
  useEffect(()=>()=>{targetEpoch.current++;},[]);
  const effort=selected?.efforts.length?(effective?.effort??selected.defaultEffort??(selected.efforts.includes('medium')?'medium':selected.efforts[0])):undefined;
  const serviceTier=effective ? effective.serviceTier??'default' : selected?.defaultServiceTier;
  const load=async(refresh=false)=>{
    if(providerModel||runtime==='demo'||runtime==='api')return;
    if(localAccount){try{if(refresh)await api('models/accounts/refresh',{id:localAccount.id});await loadTargets(false);}catch(e){setError(errorText(e));}return;}
    if(!hostId&&!session){setError('请先选择已连接的 SSH 模型来源。');return;}
    if(runtime!=='codex'&&runtime!=='claude')return;
    const current=++epoch.current;setBusy(true);setError('');
    try{const result=await api<NativeModelOption[]>('runtime/models',{...(session?{sessionId:session.id}:{hostId,runtime}),refresh});if(epoch.current===current)setModels(result);}
    catch(e){if(epoch.current===current)setError(errorText(e));}finally{if(epoch.current===current)setBusy(false);}
  };
  useEffect(()=>{
    epoch.current++;setModels([]);setContextOpen(false);setError('');setBusy(false);
    if(active&&(runtime==='codex'||runtime==='claude')&&hostId&&!providerModel)void load();
    return()=>{epoch.current++;clearTimeout(hoverTimer.current);clearTimeout(closeTimer.current);};
  },[active,sourceKey,configurationRevision]);
  useEffect(()=>{setOpen(false);setCatalogOpen(false);},[active,runtime,session?.id]);
  useEffect(()=>{if(!contextOpen)return;const dismiss=(event:KeyboardEvent)=>{if(event.key==='Escape'){clearTimeout(hoverTimer.current);setContextOpen(false);}};const outside=(event:PointerEvent)=>{if(!ring.current?.contains(event.target as Node)&&!contextPanel.current?.contains(event.target as Node))setContextOpen(false);};document.addEventListener('keydown',dismiss);document.addEventListener('pointerdown',outside);return()=>{document.removeEventListener('keydown',dismiss);document.removeEventListener('pointerdown',outside);};},[contextOpen]);
  useEffect(()=>{
    if(!open){setCatalogOpen(false);return;}
    panel.current?.focus();
    const outside=(event:PointerEvent)=>{if(!trigger.current?.contains(event.target as Node)&&!panel.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  useLayoutEffect(()=>{
    if(!open&&!contextOpen)return;
    const positionPanel=()=>{
      if(open&&trigger.current&&panel.current){const box=trigger.current.getBoundingClientRect(),width=Math.min(catalogOpen||!selected?300:224,innerWidth-24),height=panel.current.offsetHeight;setPosition({width,left:Math.max(12,Math.min(box.right-width,innerWidth-width-12)),top:Math.max(12,box.top-height-9),maxHeight:Math.max(120,box.top-24)});}
      if(contextOpen&&ring.current&&contextPanel.current){const box=ring.current.getBoundingClientRect(),width=224,height=contextPanel.current.offsetHeight;setContextPosition({width,left:Math.max(12,Math.min(box.right-width,innerWidth-width-12)),top:Math.max(12,box.top-height-8)});}
    };
    positionPanel();const observer=new ResizeObserver(positionPanel);if(panel.current)observer.observe(panel.current);if(contextPanel.current)observer.observe(contextPanel.current);
    window.addEventListener('resize',positionPanel);window.addEventListener('scroll',positionPanel,true);
    return()=>{observer.disconnect();window.removeEventListener('resize',positionPanel);window.removeEventListener('scroll',positionPanel,true);};
  },[open,contextOpen,models,busy,error,targets,catalogOpen,selected?.model]);
  const choose=(value:NativeModelSelection)=>{setError('');selection.choose(value);};
  const commitEffort=(next?:string)=>{if(selected&&next!==effort)choose({model:selected.model,effort:next,...(serviceTier==='priority'?{serviceTier:'priority'}:{})});};
  const showContext=()=>{clearTimeout(closeTimer.current);clearTimeout(hoverTimer.current);if(!open)hoverTimer.current=setTimeout(()=>setContextOpen(true),180);};
  const hideContext=()=>{clearTimeout(hoverTimer.current);clearTimeout(closeTimer.current);closeTimer.current=setTimeout(()=>setContextOpen(false),160);};
  const projected=session&&effective&&effective.model!==session.modelSelection?.model?{...session}:session;
  if(projected&&projected!==session&&effective)nativeContextState.select(projected,effective,selected?.contextWindow);
  const usage=currentProviderContext(projected,providerModel),{capacity,runtimeCapacity,percent}=displayedContext(providerModel,usage,selected?.contextWindow);
  const baseName=selected?.name??targets.find(target=>target.id===targetId)?.name??effective?.model??(runtime==='demo'?'选择模型':busy?'读取模型…':'选择模型');
  const name=capacity===1000000&&!/1m/i.test(baseName)?baseName+' (1M)':baseName;
  const contextModels=models.map(model=>{const known=model.model===selected?.model?capacity:usage?.modelWindows?.[model.model];return known&&Number.isSafeInteger(known)&&known>0&&known<=100000000?{...model,contextWindow:known}:model;});
  return <div className="model-controls" data-workbench-model-controls>
    <button ref={ring} className="context-ring" data-testid="context-ring" aria-label={percent===null?'上下文用量未知':`上下文已用 ${percent}%`} aria-describedby={contextOpen?'context-usage-tooltip':undefined} onPointerEnter={showContext} onPointerLeave={hideContext} onFocus={showContext} onBlur={hideContext} onClick={()=>{clearTimeout(hoverTimer.current);if(!open)setContextOpen(true);}} onKeyDown={event=>{if(event.key==='Escape'){setContextOpen(false);clearTimeout(hoverTimer.current);}}}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><circle className={percent===null?'unknown':'used'} cx="10" cy="10" r="7" pathLength="100" strokeDasharray={`${percent??0} 100`}/></svg></button>
    <button ref={trigger} className="model-trigger" data-testid="model-selector" aria-label="模型与思考深度" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={()=>{clearTimeout(hoverTimer.current);setContextOpen(false);setOpen(!open);if(!open&&!models.length&&!busy&&hostId&&!providerModel)void load();}}><span className="model-selection-label"><span className="model-name">{name}</span>{effort&&<span className="model-effort"> · {efforts[effort]??effort}</span>}</span>{serviceTier==='priority'&&<small className="model-fast-badge">Fast</small>}</button>
    {contextOpen&&!open&&createPortal(<div id="context-usage-tooltip" className="context-tooltip" style={contextPosition} ref={contextPanel} role="tooltip" onPointerEnter={()=>{clearTimeout(closeTimer.current);}} onPointerLeave={hideContext}><div className="context-usage-heading"><span>上下文</span><strong>{percent===null?'用量未知':`${percent}% 已使用`}</strong></div>{percent!==null&&<div className="context-meter"><i style={{width:`${percent}%`}}/></div>}<p>{usage?`${usage.used.toLocaleString()} / ${capacity?.toLocaleString()??'未知'} tokens`:capacity?`窗口 ${capacity.toLocaleString()} tokens；尚无用量回执`:'等待原生运行时提供用量'}</p>{usage?.estimated&&<small>沿用上次用量，等待当前模型回执校准</small>}<small>{providerModel?(capacity?'容量来自当前模型；由原生运行时管理压缩':'上游未提供模型容量，可在模型映射中填写'):capacity===1000000?'原生上下文容量 1M；由原生运行时自动压缩':'由原生运行时自动压缩'}</small>{providerModel&&runtimeCapacity&&runtimeCapacity!==capacity&&<small>原生可用预算：{runtimeCapacity.toLocaleString()} tokens</small>}</div>,document.body)}
    {open&&createPortal(<section className={'model-popover'+(selected&&!catalogOpen?' compact':'')} style={position} ref={panel} role="dialog" aria-label="模型与思考设置" tabIndex={-1} onKeyDown={event=>{
      event.stopPropagation();if(event.key==='Escape'){event.preventDefault();if(catalogOpen&&selected){setCatalogOpen(false);requestAnimationFrame(()=>panel.current?.querySelector<HTMLButtonElement>('.current-model')?.focus());}else{setOpen(false);trigger.current?.focus();}}
      if(event.key==='Tab'){const items=[...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')],first=items[0],last=items.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    }}>
      {selected&&catalogOpen&&<header><button className="text-button" data-testid="model-picker-back" onClick={()=>setCatalogOpen(false)}>返回模型设置</button></header>}
      {state&&(catalogOpen||!selected)&&<ModelTargetPicker state={state} targets={targets} runtime={runtime} targetId={targetId} hostId={hostId} accountRef={accountRef} model={selected?.model??effective?.model} nativeModels={providerModel||localAccount?[]:contextModels} locked={bindingLocked} disabled={disabled} reading={reading||busy} onTarget={target=>{Promise.resolve(onTarget(target)).then(()=>setCatalogOpen(false)).catch(e=>setError(errorText(e)));}} onNative={model=>{setCatalogOpen(false);choose({model:model.model,...(model.defaultEffort&&model.efforts.includes(model.defaultEffort)?{effort:model.defaultEffort}:{}),...(model.defaultServiceTier==='priority'?{serviceTier:'priority'}:{})});}} onRefresh={()=>{void loadTargets(true);if((hostId||localAccount)&&!providerModel)void load(true);}} onConfigure={tab=>{setOpen(false);window.dispatchEvent(new CustomEvent('workbench-settings',{detail:tab}));}}/>}
      {selected&&!catalogOpen&&<>
        <ReasoningControl key={selected.model} levels={selected.efforts} value={effort} defaultValue={selected.defaultEffort} disabled={disabled||!!providerModel&&bindingLocked} onChange={commitEffort} leadingControl={selected.serviceTiers.some(tier=>tier.id==='priority')?<button className="effort-fast" role="switch" aria-label="Fast" aria-checked={serviceTier==='priority'} title={serviceTier==='priority'?'Fast 已开启':'开启 Fast'} disabled={disabled} onClick={()=>choose({model:selected.model,effort,...(serviceTier!=='priority'?{serviceTier:'priority'}:{})})}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-13h-7z"/></svg></button>:undefined} status={providerModel?reasoningStatus(providerModel)+(!availableReasoningEfforts(providerModel).length?'；可在模型连接详情中手动选择':''):undefined} modelChoice={<button className="current-model" data-testid="current-model-choice" aria-expanded={catalogOpen} title={name+' · '+(connection?.name??'原生运行时')} onClick={()=>setCatalogOpen(true)}><span>{name}</span><Icon name="chevron-down" size={11}/></button>}/>
      </>}
      {session?.binding.runtime==='api'&&!catalogOpen&&<ApiCallBudget session={session}/>}
      {error&&<p role="alert">{error}</p>}{busy&&<p role="status">读取模型…</p>}
    </section>,document.body)}
  </div>;
}
