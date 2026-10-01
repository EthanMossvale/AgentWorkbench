import {createContext,useContext,useEffect,useRef,type ComponentProps} from 'react';
import {uiPreferences,useUiPreference,useUiPreferenceRead} from './ui-preferences';

/** Stable, explicit identity; native details semantics and existing handlers stay intact. */
export const UiMemoryScope=createContext('');
export function RememberedDetails({memoryId,scope='',open=false,forceOpen=false,onToggle,body,...props}:ComponentProps<'details'>&{memoryId:string;scope?:string;forceOpen?:boolean;body?:()=>React.ReactNode}){
  const parent=useContext(UiMemoryScope);
  const key=JSON.stringify([parent,memoryId,scope]),read=useUiPreferenceRead('disclosure.open',key),effective=forceOpen||(read.saved?read.value as boolean:open);
  return <details {...props} data-ui-memory={memoryId} open={effective} onToggle={event=>{
    if(event.target!==event.currentTarget)return;
    if(!forceOpen&&event.currentTarget.open!==effective)uiPreferences.change('disclosure.open',event.currentTarget.open,key);
    onToggle?.(event);
  }}>{props.children}{effective&&body?.()}</details>;
}
/** Persist only the resize handle's geometry, never textarea contents. */
export function RememberedTextarea({memoryId,scope='',style,...props}:ComponentProps<'textarea'>&{memoryId:string;scope?:string}){
  const parent=useContext(UiMemoryScope);
  const key=JSON.stringify([parent,memoryId,scope]),[height,setHeight]=useUiPreference<number>('editor.height',key),ref=useRef<HTMLTextAreaElement>(null),resizing=useRef(false);
  const saved=uiPreferences.get('editor.height',key).saved;
  useEffect(()=>{const finish=()=>{if(resizing.current&&ref.current){resizing.current=false;const value=parseFloat(ref.current.style.height);if(Number.isFinite(value))setHeight(Math.max(60,Math.min(2000,value)));}};window.addEventListener('pointerup',finish);window.addEventListener('blur',finish);return()=>{window.removeEventListener('pointerup',finish);window.removeEventListener('blur',finish);};},[key]);
  return <textarea {...props} ref={ref} data-ui-memory={memoryId} style={{...style,...(saved?{height}:{} )}} onPointerDown={event=>{const box=event.currentTarget.getBoundingClientRect();resizing.current=event.clientY>=box.bottom-18&&event.clientX>=box.right-22;props.onPointerDown?.(event);}}/>;
}
