import {useEffect,useRef,useState} from 'react';
import type {Session} from '../../../packages/contracts';
import {planDocument,type PlanReference} from '../../../packages/session-core/plan-review';
import {api} from './App';
import MessageText,{type LinkActions} from './MessageText';
import {Icon,errorText} from './ui';
import {InlineTranslation,TranslationAction} from './TranslationDisplay';
import './PlanReader.css';

export default function PlanReader({session,reference,enabled,onClose,actions,copy}:{session:Session;reference:PlanReference;enabled:boolean;onClose:()=>void;actions:LinkActions;copy:(text:string)=>void}){
  const document=planDocument(session,reference),dock=useRef<HTMLElement>(null),[error,setError]=useState('');
  useEffect(()=>{dock.current?.focus();},[reference.receipt]);
  useEffect(()=>{if(!document)onClose();},[!!document]);
  const translate=(blockIndex?:number)=>{setError('');return api('plan/translate',{sessionId:session.id,reference,...(blockIndex===undefined?{}:{blockIndex})}).catch(e=>setError(errorText(e)));};
  useEffect(()=>{if(document&&enabled&&(!document.translationStatus||document.translationStatus==='off'||document.translationStatus==='complete'&&!document.planTranslationBlocks))void translate();},[reference.receipt,enabled,document?.translationStatus]);
  if(!document)return null;
  return <aside className="plan-reader" data-testid="plan-reader" aria-label="完整计划" tabIndex={-1} ref={dock} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}}>
    <header><strong>完整计划</strong><span>{document.runtime==='claude'?'Claude Code':'Codex'}</span><button className="icon-button" aria-label="复制计划原文" title="复制计划原文" onClick={()=>copy(document.text)}><Icon name="copy" size={14}/></button>{enabled&&document.translation&&<button className="icon-button" aria-label="复制计划译文" title="复制计划译文" onClick={()=>copy(document.translation!)}><Icon name="globe" size={14}/></button>}<button className="icon-button" data-testid="close-plan-reader" aria-label="关闭计划面板" onClick={onClose}><Icon name="close" size={16}/></button></header>
    <div className="plan-reader-body">
      {document.blocks.map((block,index)=>{const value=document.planTranslationBlocks?.[index]??{translationStatus:document.translationStatus??'pending',translationError:document.translationError};return <section className="plan-block" data-testid="plan-block" key={index}><div data-testid="plan-source"><MessageText text={block.source} {...actions}/></div>{enabled&&block.translatable&&<><div data-testid="plan-translation"><InlineTranslation value={value} actions={actions} label="本段译文" showEmpty/></div><footer className="plan-block-actions"><TranslationAction scope="block" value={value} enabled={enabled} onTranslate={()=>void translate(index)}/></footer></>}</section>;})}
      {error&&<p role="alert">{error}</p>}
    </div>
  </aside>;
}

export function CodexPlanActions({session,reference,onOpen,onRevise,disabled=false}:{session:Session;reference:PlanReference;onOpen:()=>void;onRevise:()=>void;disabled?:boolean}){
  const [busy,setBusy]=useState(false),sending=useRef(false),[error,setError]=useState(''),document=planDocument(session,reference);
  if(!document)return null;
  const respond=async(action:'implement'|'revise')=>{if(sending.current)return;sending.current=true;setBusy(true);setError('');try{await api('session/plan/respond',{sessionId:session.id,reference,action});if(action==='revise')onRevise();}catch(e){setError(errorText(e));}finally{sending.current=false;setBusy(false);}};
  return <div className="codex-plan-review" data-testid="codex-plan-review"><button className="text-button" data-testid="open-plan" onClick={onOpen}>查看完整计划</button>{document.canRespond&&<><button className="text-button" data-testid="codex-plan-revise" disabled={busy||disabled} onClick={()=>void respond('revise')}>继续修改计划</button><button className="button primary" data-testid="codex-plan-implement" disabled={busy||disabled} onClick={()=>void respond('implement')}>{busy?'处理中…':'按计划执行'}</button></>}{error&&<p role="alert">{error}</p>}</div>;
}
