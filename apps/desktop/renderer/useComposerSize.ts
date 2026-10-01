import {useLayoutEffect,type RefObject} from 'react';
import {measureComposer} from './media-controller';
/** Re-measure wrapping without replacing the input or disturbing its selection/IME. */
export function useComposerSize(ref:RefObject<HTMLTextAreaElement|null>,value:string,layoutKey:unknown){
 useLayoutEffect(()=>{
  const input=ref.current;if(!input)return;
  const measure=()=>{if(!input.getClientRects().length)return;const old=input.offsetHeight,chrome=(input.closest('.composer-area')?.getBoundingClientRect().height??old+100)-old;input.style.height='0px';const height=measureComposer(input.scrollHeight,window.innerHeight,chrome);input.style.height=height+'px';input.style.overflowY=input.scrollHeight>height+1?'auto':'hidden';};
  measure();let width=input.clientWidth;const observer=new ResizeObserver(()=>{if(input.clientWidth!==width){width=input.clientWidth;measure();}});observer.observe(input);window.addEventListener('resize',measure);
  return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
 },[ref,value,layoutKey]);
}
