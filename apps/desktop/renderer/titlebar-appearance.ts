import type { TitlebarAppearance } from '../../../packages/appearance';

function opaqueHex(css:string):string|undefined {
  const match=/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*1)?\s*\)$/.exec(css);
  return match?'#'+match.slice(1,4).map(value=>Number(value).toString(16).padStart(2,'0')).join(''):undefined;
}

/** Share the rendered palette with native caption buttons, including removable plugin styles. */
export function syncTitlebarAppearance(element:HTMLElement,send:(value:TitlebarAppearance)=>Promise<unknown>,report:(error:unknown)=>void):()=>void {
  let stopped=false,frame=0,sending=false,last='',epoch=0,lastEpoch=-1,pending:TitlebarAppearance|undefined;
  const flush=async()=>{
    if(stopped||sending||!pending)return;
    const value=pending;pending=undefined;const key=JSON.stringify(value),version=epoch;
    if(key===last&&version===lastEpoch)return;
    sending=true;
    try {await send(value);last=key;lastEpoch=version;}catch(error){if(!stopped&&version===epoch)report(error);}
    finally {sending=false;if(!stopped)void flush();}
  };
  const apply=()=>{
    frame=0;if(stopped)return;
    const css=getComputedStyle(element),color=opaqueHex(css.backgroundColor),symbolColor=opaqueHex(css.color);
    if(color&&symbolColor){pending={color,symbolColor};void flush();}
  };
  const schedule=()=>{if(!stopped&&!frame)frame=requestAnimationFrame(apply);};
  const observer=new MutationObserver(schedule);
  observer.observe(document.head,{childList:true,subtree:true,characterData:true,attributes:true});
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-appearance','class','style']});
  observer.observe(element,{attributes:true,attributeFilter:['class','style']});
  // A host method replacement can alter native colors without changing CSS.
  const release=window.workbench.onExtensions?.(()=>{epoch++;schedule();});
  window.addEventListener('workbench-appearance',schedule);schedule();
  return()=>{stopped=true;pending=undefined;cancelAnimationFrame(frame);observer.disconnect();release?.();window.removeEventListener('workbench-appearance',schedule);};
}
