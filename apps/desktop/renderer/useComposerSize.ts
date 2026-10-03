import {useLayoutEffect,type RefObject} from 'react';
import {measureComposer} from './media-controller';
const contentSizing=typeof CSS!=='undefined'&&CSS.supports('field-sizing','content');
/**
 * Re-measure wrapping without replacing the input or disturbing its selection/IME.
 * With CSS content sizing the textarea grows by itself and typing does no layout
 * work in script; only the ceiling (registered sizing policy, viewport and the
 * surrounding composer) is recomputed when those actually resize.
 */
export function useComposerSize(ref:RefObject<HTMLTextAreaElement|null>,value:string,layoutKey:unknown){
 useLayoutEffect(()=>{
  const input=ref.current;if(!input||!contentSizing)return;
  input.style.setProperty('field-sizing','content');input.style.height='';input.style.overflowY='auto';
  const limit=()=>{if(!input.isConnected||!input.getClientRects().length)return;const area=input.closest('.composer-area'),chrome=(area?.getBoundingClientRect().height??input.offsetHeight+100)-input.offsetHeight;const max=measureComposer(Number.MAX_SAFE_INTEGER,window.innerHeight,chrome)+'px';if(input.style.maxHeight!==max)input.style.maxHeight=max;};
  limit();
  // Observer callbacks run after layout, so reading sizes there forces nothing.
  const observer=new ResizeObserver(limit);observer.observe(input);const area=input.closest('.composer-area');if(area)observer.observe(area);
  window.addEventListener('resize',limit);
  return()=>{observer.disconnect();window.removeEventListener('resize',limit);};
 },[ref,layoutKey]);
 useLayoutEffect(()=>{
  const input=ref.current;if(!input||contentSizing)return;
  const measure=()=>{if(!input.getClientRects().length)return;const old=input.offsetHeight,chrome=(input.closest('.composer-area')?.getBoundingClientRect().height??old+100)-old;input.style.height='0px';const height=measureComposer(input.scrollHeight,window.innerHeight,chrome);input.style.height=height+'px';input.style.overflowY=input.scrollHeight>height+1?'auto':'hidden';};
  measure();let width=input.clientWidth;const observer=new ResizeObserver(()=>{if(input.clientWidth!==width){width=input.clientWidth;measure();}});observer.observe(input);window.addEventListener('resize',measure);
  return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
 },[ref,value,layoutKey]);
}
