import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { MessageTranslation } from '../../../packages/translation/display';
import MessageText, { type LinkActions } from './MessageText';
import { Icon } from './ui';
import './ReadingPane.css';

export function TranslationAction({value,enabled,complete=true,onTranslate,scope='message'}:{value:MessageTranslation;enabled:boolean;complete?:boolean;onTranslate:()=>void;scope?:'message'|'block'}) {
  const pending=value.translationStatus==='pending';
  const label=scope==='block'?(pending?'正在翻译本段':value.translation?'重新翻译本段':'翻译本段'):(pending?'正在翻译这条消息':value.translation?'重新翻译这条消息':'翻译这条消息');
  return <button className="icon-button translate-message-button" aria-label={label} title={!enabled?'请先开启双语工作流':!complete?'消息完成后可翻译':label} disabled={!enabled||!complete||pending} onClick={onTranslate}><Icon name="globe" size={14}/></button>;
}

export function InlineTranslation({value,actions,label='中文译文',showEmpty=false}:{value:MessageTranslation;actions:LinkActions;label?:string;showEmpty?:boolean}) {
  if(!value.translation&&!['pending','failed'].includes(value.translationStatus??'')&&!showEmpty)return null;
  return <section className="message-translation-note" data-testid="inline-translation" aria-label={label}>
    {value.translationStatus==='pending'&&<small className="translation-note-hint" role="status">{value.translation?'正在重译…':'翻译中…'}</small>}
    {value.translation&&<MessageText text={value.translation} {...actions}/>}
    {value.translationStatus==='failed'&&<p className="translation-note-error" role="status">{value.translation?'重译未完成，保留上一版。':'译文暂不可用。'}{value.translationError}</p>}
    {!value.translation&&!value.translationStatus&&showEmpty&&<p className="translation-note-hint">点击翻译图标可单独翻译。</p>}
  </section>;
}

/** Keep each copy action beside its own text; other actions stay in the final row. */
export function BilingualMessageActions({sourceCopy,value,actions,label,copyLabel='复制译文',copyTestId,onCopy,className,children,afterTranslation,iconSize=15,alignCopy=false,showCopy=true}:{sourceCopy:ReactNode;value?:MessageTranslation;actions:LinkActions;label?:string;copyLabel?:string;copyTestId?:string;onCopy:(text:string)=>void;className:string;children?:ReactNode;afterTranslation?:ReactNode;iconSize?:number;alignCopy?:boolean;showCopy?:boolean}) {
  const translated=!!value?.translation;
  const sourceRow=useRef<HTMLDivElement>(null),footer=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{
    const row=sourceRow.current,tail=footer.current,button=tail?.firstElementChild;
    if(!alignCopy||!row||!tail||!button)return;
    const align=()=>{row.style.paddingInlineEnd=Math.max(0,row.getBoundingClientRect().right-button.getBoundingClientRect().right)+'px';};
    align();const observer=new ResizeObserver(align);observer.observe(tail);observer.observe(button);
    return ()=>{observer.disconnect();row.style.removeProperty('padding-inline-end');};
  },[alignCopy,translated,children,showCopy]);
  return <>
    {showCopy&&translated&&<div ref={sourceRow} className={className} data-message-copy-region="source">{sourceCopy}</div>}
    {value&&<InlineTranslation value={value} actions={actions} label={label}/>}
    {afterTranslation}
    <footer ref={footer} className={className} data-message-copy-region={showCopy?(translated?'translation':'source'):undefined}>
      {showCopy&&(translated?<button className="icon-button" data-testid={copyTestId} aria-label={copyLabel} title={copyLabel} onClick={()=>onCopy(value!.translation!)}><Icon name="copy" size={iconSize}/></button>:sourceCopy)}
      {children}
    </footer>
  </>;
}
