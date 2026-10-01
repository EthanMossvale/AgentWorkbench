import {RememberedDetails,RememberedTextarea} from './UiMemory';
import { useEffect, useId, useRef, useState } from 'react';
import type { AppState, Session } from '../../../packages/contracts';
import { requestKey, validateAnswers, validateForm, type NativeQuestion, type NativeInteraction, type InteractionReply, type NativePlan, type QuestionTranslation, type AnswerPreview } from '../../../packages/native-interactions';
import { api } from './App';
import { errorText } from './ui';
import PreviewModal from './PreviewModal';
import { translationFlowPolicy } from './translation-flow';
import './NativeInteractions.css';
import { useAsyncQuestionReply } from './useAsyncQuestionReply';

type Answers = Record<string,string[]>;
export function QuestionPager({items,page,onPage,disabled,answers}:{items:NativeQuestion[];page:number;onPage:(page:number)=>void;disabled:boolean;answers:Answers}){
  if(items.length<2)return null;
  return <nav className="native-question-pager" aria-label="问题分页" data-testid="question-pager"><button type="button" disabled={disabled||page===0} onClick={()=>onPage(page-1)} aria-label="上一题">‹</button><span data-testid="question-position" aria-live="polite">第 {page+1} / {items.length} 题</span><div>{items.map((q,index)=>{let answered=true;try{validateAnswers([q],{[q.id]:answers[q.id]});}catch{answered=false;}return <button type="button" key={q.id} disabled={disabled} aria-label={'第 '+(index+1)+' 题'+(answered?'，已填写':'')} aria-current={page===index?'step':undefined} className={answered?'answered':''} onClick={()=>onPage(index)}>{index+1}</button>;})}</div><button type="button" disabled={disabled||page===items.length-1} onClick={()=>onPage(page+1)} aria-label="下一题">›</button></nav>;
}
function Translated({text}:{text?:string}){return text?<small className="native-question-translation" data-testid="question-translation">{text}</small>:null;}
function focusQuestion(card:HTMLElement|null){const question=card?.querySelector<HTMLElement>('.native-question:not([hidden])');question?.querySelector('legend')?.scrollIntoView({block:'nearest'});const input=question?.querySelector<HTMLElement>('textarea,input[type=password]')??question?.querySelector<HTMLElement>('input:checked')??question?.querySelector<HTMLElement>('input');input?.focus({preventScroll:true});}
function QuestionFields({ items, value, onChange, disabled,translation,page=0,onAdvance }: { items:NativeQuestion[];value:Answers;onChange:(next:Answers)=>void;disabled:boolean;translation?:QuestionTranslation;page?:number;onAdvance?:()=>void }) {
  const prefix=useId();
  const [custom,setCustom]=useState<Record<string,boolean>>({});
  return <>{items.map((q,qi)=>{
    const translated=translation?.values;
    const selected=value[q.id]??[],isOther=custom[q.id]||!q.options.length;
    const isOption=(text:string)=>q.options.some(o=>o.label===text);
    const freeValue=selected.find(text=>!isOption(text))??'';
    const changeFree=(text:string)=>onChange({...value,[q.id]:q.multiple?[...selected.filter(isOption),text]:[text]});
    const showFooter=(node:HTMLElement)=>requestAnimationFrame(()=>node.closest('.native-interaction')?.querySelector('footer')?.scrollIntoView({block:'nearest'}));
    const choose=(label:string,checked:boolean)=>{if(!q.multiple)setCustom(c=>({...c,[q.id]:false}));onChange({...value,[q.id]:q.multiple?(checked?[...selected.filter(v=>v!==label),label]:selected.filter(v=>v!==label)):[label]});};
    return <fieldset key={q.id} className="native-question" disabled={disabled} hidden={qi!==page} onKeyDown={event=>{
      if(event.key!=='Enter'||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey||event.nativeEvent.isComposing||event.keyCode===229)return;
      if(!(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement))return;
      event.preventDefault();if(!disabled&&!event.repeat)onAdvance?.();
    }}>
      <legend><span>{q.question}</span>{q.multiple&&<em>多选</em>}<Translated text={translated?.[`q${qi}.question`]}/></legend>
      <div className="native-question-options">{q.options.map((option,index)=><label className={`native-question-option ${(q.multiple||!isOther)&&selected.includes(option.label)?'selected':''}`} key={option.label}>
        <input type={q.multiple?'checkbox':'radio'} name={prefix+q.id} checked={(q.multiple||!isOther)&&selected.includes(option.label)} onChange={e=>choose(option.label,e.target.checked)}/>
        <span><span className="native-option-source"><strong>{option.label}</strong>{option.description&&<span> · {option.description}</span>}</span><Translated text={[translated?.[`q${qi}.option${index}.label`],translated?.[`q${qi}.option${index}.description`]].filter(Boolean).join(' · ')}/></span>
      </label>)}
      {q.other&&q.options.length>0&&<label className={`native-question-option ${isOther?'selected':''}`}><input type={q.multiple?'checkbox':'radio'} name={prefix+q.id} checked={!!isOther} onChange={e=>{setCustom(c=>({...c,[q.id]:e.target.checked}));onChange({...value,[q.id]:q.multiple?[...selected.filter(isOption),...(e.target.checked?['']:[])]:['']});}}/><span>其他回答</span></label>}
      </div>
      {isOther&&(q.secret?<input className="native-free-answer" type="password" autoComplete="off" aria-label={q.question} value={freeValue} maxLength={32000} onFocus={e=>showFooter(e.currentTarget)} onChange={e=>changeFree(e.target.value)}/>:<RememberedTextarea memoryId="NativeInteractions.editor.1" className="native-free-answer" rows={2} aria-label={q.question} placeholder="写下你的回答…" value={freeValue} maxLength={32000} onFocus={e=>showFooter(e.currentTarget)} onChange={e=>changeFree(e.target.value)}/>)}
      {q.secret&&<small className="native-interaction-note">隐私回答仅回传当前运行时，不写入工作台交互记录。</small>}
    </fieldset>;
  })}</>;
}
const titles={questions:'想与你确认',form:'补充信息',url:'外部确认',permissions:'额外权限请求',unsupported:'尚未支持的原生交互'};
const statuses={pending:'等待回应',answered:'已回答',declined:'已拒绝',cancelled:'已取消',expired:'已由运行时结束',uncertain:'连接中断 · 未自动重发',unsupported:'已明确拒绝 · 需要适配'};
function InteractionCard({ item, session,state,onReturnToQuestion }: {item:NativeInteraction;session:Session;state:AppState|null;onReturnToQuestion?:()=>void}){
  const [answers,setAnswers]=useState<Answers>({}),[content,setContent]=useState<Record<string,unknown>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [preview,setPreview]=useState<AnswerPreview|null>(null),[page,setPage]=useState(0);
  const questionItems=item.questions??[],lastPage=page>=questionItems.length-1;
  const changePage=(value:number)=>{setPage(value);requestAnimationFrame(()=>focusQuestion(cardRef.current));};
  const cardRef=useRef<HTMLElement>(null);
  const sending=useRef(false),pending=item.status==='pending',policy=translationFlowPolicy(state);
  const current=useRef({pending,policy,auto:state?.autoSubmitTranslated===true});current.current={pending:pending&&!item.deferred,policy,auto:state?.autoSubmitTranslated===true};
  const generation=useRef(0),previewRef=useRef<AnswerPreview|null>(null),requestRef=useRef<string|null>(null);
  const cancelPreview=()=>{generation.current++;if(previewRef.current)void api('interaction/cancel',{id:previewRef.current.id}).catch(()=>{});if(requestRef.current)void api('interaction/cancel',{clientRequest:requestRef.current}).catch(()=>{});previewRef.current=null;requestRef.current=null;setPreview(null);};
  useEffect(()=>{cancelPreview();if(!pending){setAnswers({});setContent({});}setBusy(false);sending.current=false;},[pending,policy.key,item.deferred]);
  useEffect(()=>()=>{generation.current++;if(previewRef.current)void api('interaction/cancel',{id:previewRef.current.id}).catch(()=>{});if(requestRef.current)void api('interaction/cancel',{clientRequest:requestRef.current}).catch(()=>{});},[]);
  const changeAnswers=(value:Answers)=>{cancelPreview();setAnswers(value);setError('');};
  const editAnswer=()=>{if(busy)return;cancelPreview();const firstFree=questionItems.findIndex(q=>(answers[q.id]??[]).some(a=>!q.options.some(o=>o.label===a)));if(firstFree>=0)setPage(firstFree);onReturnToQuestion?.();requestAnimationFrame(()=>{const card=cardRef.current;const question=card?.querySelector('.native-question:not([hidden])');const input=question?.querySelector<HTMLElement>('textarea,input[type=password]')??question?.querySelector<HTMLElement>('input:checked')??question?.querySelector<HTMLElement>('input');input?.focus();});};
  let valid=!item.unsupportedReason;
  try{if(item.kind==='questions')validateAnswers(item.questions??[],answers);else if(item.kind==='form')validateForm(item.fields??[],content);}catch{valid=false;}
  const respond=async(action:InteractionReply['action'])=>{
    if(sending.current||!pending||item.deferred)return;sending.current=true;setBusy(true);setError('');
    const sequence=++generation.current,requested=policy.key;
    try{
      if(action==='submit'&&item.kind==='questions'){
        const clientRequest=crypto.randomUUID();requestRef.current=clientRequest;
        const value=await api<AnswerPreview>('interaction/prepare',{sessionId:session.id,requestId:item.id,receipt:item.receipt,answers,clientRequest});
        requestRef.current=null;
        if(sequence!==generation.current||!current.current.pending||current.current.policy.key!==requested){await api('interaction/cancel',{id:value.id});return;}
        previewRef.current=value;
        if(value.review&&!current.current.auto){setPreview(value);return;}
        await api('interaction/submit',{sessionId:session.id,id:value.id,sourceHash:value.sourceHash,automatic:value.review});previewRef.current=null;
      }else {cancelPreview();await api('session/interaction',{sessionId:session.id,requestId:item.id,receipt:item.receipt,reply:{action,...(action==='submit'?{content}:{})}});}
      setAnswers({});setContent({});
    }catch(e){if(sequence===generation.current||action!=='submit')setError(errorText(e));}finally{sending.current=false;setBusy(false);}
  };
  const confirm=async()=>{if(!preview||sending.current)return;sending.current=true;setBusy(true);setError('');try{await api('interaction/submit',{sessionId:session.id,id:preview.id,sourceHash:preview.sourceHash,automatic:false});previewRef.current=null;setPreview(null);setAnswers({});}catch(e){setError(errorText(e));cancelPreview();}finally{sending.current=false;setBusy(false);}};
  const child=!!item.threadId&&!!session.binding.nativeSessionId&&item.threadId!==session.binding.nativeSessionId;
  if(!pending)return <RememberedDetails memoryId="NativeInteractions.details.1" className="native-interaction-history" data-testid="native-interaction-history"><summary>{statuses[item.status]}<span>{item.answerRecord?.flatMap(a=>a.secret?['隐私回答']:a.original).join(' · ')||titles[item.kind]}</span></summary>{item.questions?.map((q,qi)=>{const answer=item.answerRecord?.find(a=>a.questionId===q.id);return <div className="native-answer-record" key={q.id}><p>{q.question}</p>{policy.enabled&&<Translated text={item.questionTranslation?.values?.[`q${qi}.question`]}/>}<p>{answer?.secret?'隐私回答不保存':answer?.original.join(' · ')}</p>{policy.enabled&&answer&&!answer.secret&&<Translated text={answer.original.some((value,i)=>value!==answer.submitted[i])?answer.submitted.join(' · '):answer.original.map(value=>item.questionTranslation?.values?.[`q${qi}.option${q.options.findIndex(o=>o.label===value)}.label`]).filter(Boolean).join(' · ')}/>}</div>;})??<p>{item.message||item.title}</p>}</RememberedDetails>;
  return <section ref={cardRef} className="native-interaction" data-testid="native-interaction" hidden={!!item.deferred} aria-label={titles[item.kind]}>
    <header><span>{titles[item.kind]}{child?' · Subagent':''}{item.title&&item.kind!=='unsupported'?' · '+item.title:''}</span><span>{item.blocking&&<small>等待回应</small>}{item.kind==='questions'&&<button className="text-button" disabled={busy} onClick={()=>{cancelPreview();void api('interaction/presentation',{sessionId:session.id,receipt:item.receipt,action:'defer'}).catch(e=>setError(errorText(e)));}}>稍后回应</button>}</span></header>
    {item.message&&<p className="native-interaction-message">{item.message}</p>}
    {item.unsupportedReason?<p className="native-interaction-note">这项请求包含尚未支持的原生格式。可拒绝或取消，工作台不会代为同意。<br/>{item.unsupportedReason}</p>:<>
      {item.kind==='questions'&&<><QuestionPager items={questionItems} page={page} onPage={changePage} disabled={busy||!!preview} answers={answers}/><QuestionFields items={questionItems} page={page} value={answers} onChange={changeAnswers} disabled={busy||!!preview} translation={policy.enabled?item.questionTranslation:undefined} onAdvance={()=>{if(!lastPage)changePage(page+1);else if(valid)void respond('submit');}}/></>}
      {item.kind==='form'&&<div className="native-form-fields">{item.fields?.map(f=><label key={f.id}><span>{f.title}{f.required?' *':''}</span>{f.description&&<small>{f.description}</small>}{f.type==='multi'?<select multiple aria-label={f.title} value={(content[f.id]??[]) as string[]} disabled={busy} onChange={e=>setContent(c=>({...c,[f.id]:Array.from(e.target.selectedOptions,o=>o.value)}))}>{f.options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:f.type==='select'||f.type==='boolean'?<select aria-label={f.title} disabled={busy} value={String(content[f.id]??'')} onChange={e=>setContent(c=>({...c,[f.id]:e.target.value===''?undefined:f.type==='boolean'?e.target.value==='true':e.target.value}))}><option value="">请选择</option>{f.type==='boolean'?<><option value="true">是</option><option value="false">否</option></>:f.options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input aria-label={f.title} disabled={busy} type={['number','integer'].includes(f.type)?'number':f.format==='email'?'email':f.format==='date'?'date':'text'} step={f.type==='integer'?1:'any'} min={f.min} max={f.max} minLength={f.minLength} maxLength={f.maxLength??32000} value={String(content[f.id]??'')} autoComplete="off" onChange={e=>setContent(c=>({...c,[f.id]:['number','integer'].includes(f.type)?e.target.value===''?undefined:Number(e.target.value):e.target.value}))}/>}</label>)}</div>}
      {item.kind==='url'&&<div className="native-url-confirm"><code>{item.url}</code><button className="button secondary" disabled={busy} onClick={()=>api('session/interaction/open-url',{sessionId:session.id,requestId:item.id,receipt:item.receipt}).catch(e=>setError(errorText(e)))}>打开确认页面 ↗</button><small>完成外部操作后，再确认继续。打开链接不会自动批准。</small></div>}
      {item.kind==='permissions'&&<><pre className="native-request-details">{item.details}</pre><p className="native-interaction-note">仅授予上方列出的权限，有效期为本回合；原生安全限制仍然生效。</p></>}
    </>}
    {error&&<p className="native-interaction-error" role="alert">{error}</p>}
    <footer>{item.kind==='questions'&&!lastPage?<button className="button primary" data-testid="question-next" disabled={busy} onClick={()=>changePage(page+1)}>下一题</button>:<button className="button primary" data-testid="interaction-submit" disabled={busy||!valid} onClick={()=>respond('submit')}>{busy?'处理中…':item.kind==='questions'||item.kind==='form'?'发送回答':item.kind==='permissions'?'允许本回合':'已完成，继续'}</button>}<button className="text-button" disabled={busy} onClick={()=>respond('decline')}>{item.kind==='questions'?'忽略问题':'拒绝'}</button>{item.kind!=='questions'&&<button className="text-button" disabled={busy} onClick={()=>respond('cancel')}>取消请求</button>}{policy.enabled&&item.questions?.length&&<span className="native-translation-status">{item.questionTranslation?.status==='pending'?'翻译中…':item.questionTranslation?.status==='failed'?<button className="text-button" title={item.questionTranslation.error} onClick={()=>void api('interaction/translate',{sessionId:session.id,receipt:item.receipt}).catch(e=>setError(errorText(e)))}>译文未完成 · 重试</button>:null}</span>}</footer>
    {policy.enabled&&preview&&<PreviewModal id={preview.id} kind="answer" onConfirm={confirm} confirmDisabled={busy} busy={busy} className="native-answer-preview" content={[...(item.questions??[]).flatMap((q,i)=>[q.question,item.questionTranslation?.values?.[`q${i}.question`]??'']),...preview.answers.flatMap(a=>a.secret?['隐私回答']:[...a.original,...a.submitted])]} actions={<><button className="button secondary" disabled={busy} onClick={editAnswer}>返回修改</button><button className="button primary" data-testid="answer-confirm" data-autofocus disabled={busy} onClick={confirm}>{busy?'发送中…':'确认发送'}</button></>} title="回答预览" subtitle="译文显示在原稿下方；确认后回传当前提问。" onClose={editAnswer}><div data-testid="answer-preview">{preview.answers.map(a=><div className="native-answer-review" key={a.questionId}><p data-testid="answer-question"><span data-testid="answer-question-original">{item.questions?.find(q=>q.id===a.questionId)?.question}</span><Translated text={item.questionTranslation?.values?.[`q${item.questions?.findIndex(q=>q.id===a.questionId)}.question`]}/></p>{a.secret?<span>隐私回答 · 原样回传</span>:<><small>你的回答</small><p data-testid="answer-original">{a.original.join(' · ')}</p><small>实际发送</small><p className="native-answer-translation" data-testid="answer-translated">{a.submitted.join(' · ')}</p></>}</div>)}</div></PreviewModal>}
  </section>;
}
export function NativeInteractionHistory({item,session,state}:{item:NativeInteraction;session:Session;state:AppState|null}){return item.status==='pending'?null:<InteractionCard item={item} session={session} state={state}/>;}
export default function NativeInteractions({session,state,onReturnToQuestion}:{session:Session;state:AppState|null;onReturnToQuestion?:()=>void}){
  return <div className="native-interactions" aria-live="polite">{session.nativeInteractions?.filter(item=>item.status==='pending').map(item=><InteractionCard key={item.receipt??`${session.id}:${item.threadId}:${requestKey(item.id)}:${item.receivedAt}`} item={item} session={session} state={state} onReturnToQuestion={onReturnToQuestion}/>)}</div>;
}
export function NativePlanView({plan}:{plan?:NativePlan}){
  if(!plan?.steps.length)return null;
  return <RememberedDetails memoryId="NativeInteractions.details.2" className="native-plan" data-testid="native-plan"><summary>计划<span>{plan.steps.filter(s=>s.status==='completed').length} / {plan.steps.length}</span></summary>{plan.explanation&&<p>{plan.explanation}</p>}<ol>{plan.steps.map((step,index)=><li key={index} data-status={step.status}><span aria-label={{pending:'待处理',inProgress:'进行中',completed:'已完成'}[step.status]}>{step.status==='completed'?'✓':step.status==='inProgress'?'◌':'○'}</span>{step.step}</li>)}</ol></RememberedDetails>;
}
export function AsyncQuestions({items,session,messageId,state,active=true,disabled,translation,onTranslate,onBusyChange,onSent,onReturnToQuestion}:{items:NativeQuestion[];session:Session;messageId:string;state:AppState|null;active?:boolean;disabled:boolean;translation?:QuestionTranslation;onTranslate?:()=>Promise<unknown>;onBusyChange?:(busy:boolean)=>void;onSent?:()=>Promise<unknown>;onReturnToQuestion?:()=>void}){
  const cardRef=useRef<HTMLElement>(null),changePage=(value:number)=>{setPage(value);requestAnimationFrame(()=>focusQuestion(cardRef.current));};
  const [answers,setAnswers]=useState<Answers>({}),[page,setPage]=useState(0),[saving,setSaving]=useState(false);
  const reply=useAsyncQuestionReply({session,messageId,state,active,disabled,onBusyChange,onSent});
  useEffect(()=>{if(active)requestAnimationFrame(()=>focusQuestion(cardRef.current));},[active]);
  const locked=disabled||reply.busy||reply.sent||saving;
  let valid=true;try{validateAnswers(items,answers);}catch{valid=false;}
  const edit=()=>{if(reply.busy)return;reply.cancel();onReturnToQuestion?.();requestAnimationFrame(()=>focusQuestion(cardRef.current));};
  const presentation=async(action:'defer'|'dismiss')=>{if(locked)return;reply.cancel();setSaving(true);reply.setError('');try{await api('interaction/presentation',{sessionId:session.id,messageId,action});await onSent?.();}catch(e){reply.setError(errorText(e));}finally{setSaving(false);}};
  const advance=()=>{if(locked||reply.preview)return;if(page<items.length-1)changePage(page+1);else if(valid)void reply.prepare(answers);};
  return <section ref={cardRef} className="native-interaction" data-testid="native-async-question" hidden={!active}><header><span>补充回答</span><button className="text-button" disabled={locked} onClick={()=>void presentation('defer')}>稍后回应</button></header>
    <QuestionPager items={items} page={page} onPage={changePage} disabled={locked||!!reply.preview} answers={answers}/><QuestionFields items={items} page={page} value={answers} onChange={value=>{reply.cancel();reply.setError('');setAnswers(value);}} disabled={locked||!!reply.preview} translation={translation} onAdvance={advance}/>
    {reply.error&&<p className="native-interaction-error" role="alert">{reply.error}</p>}
    <footer>{page<items.length-1?<button className="button primary" data-testid="question-next" disabled={locked||!!reply.preview} onClick={advance}>下一题</button>:<button className="button primary" data-testid="async-question-submit" disabled={locked||!valid||!!reply.preview} onClick={advance}>{reply.sent?'已发送':reply.busy?'处理中…':'发送回答'}</button>}<button className="text-button" disabled={locked} onClick={()=>void presentation('dismiss')}>忽略问题</button>{reply.busy&&!reply.submitting&&<button className="text-button" onClick={reply.cancel}>取消准备</button>}{onTranslate&&<span className="native-translation-status">{translation?.status==='pending'?'翻译中…':translation?.status==='failed'?<button className="text-button" title={translation.error} onClick={()=>void onTranslate().catch(e=>reply.setError(errorText(e)))}>译文未完成 · 重试</button>:null}</span>}</footer>
    {active&&reply.preview&&<PreviewModal id={reply.preview.id} kind="answer" title="回答预览" subtitle="确认后发送到当前会话。" content={[reply.preview.original,reply.preview.translated]} onConfirm={reply.confirm} confirmDisabled={locked} busy={reply.busy} onClose={edit} actions={<><button className="button secondary" disabled={reply.busy} onClick={edit}>返回修改</button><button className="button primary" data-testid="answer-confirm" data-autofocus disabled={locked} onClick={reply.confirm}>确认发送</button></>}><div data-testid="answer-preview" className="review-content"><section><small>你的回答</small><pre data-testid="answer-original">{reply.preview.original}</pre></section><section><small>实际发送</small><pre data-testid="answer-translated">{reply.preview.translated}</pre></section></div></PreviewModal>}
  </section>;
}
