/** Timers longer than one native timer interval retain the user's actual deadline. */
export function translationDeadline(milliseconds:number,parent?:AbortSignal){
 const controller=new AbortController(),started=performance.now();let timer:ReturnType<typeof setTimeout>|undefined;
 const dispose=()=>{clearTimeout(timer);parent?.removeEventListener('abort',dispose);};
 const schedule=()=>{const remaining=milliseconds-(performance.now()-started);if(remaining<=0)controller.abort(new DOMException('Translation deadline reached.','TimeoutError'));else{timer=setTimeout(schedule,Math.min(remaining,2147483647));timer.unref();}};
 if(milliseconds&&!parent?.aborted)schedule();parent?.addEventListener('abort',dispose,{once:true});
 return {signal:parent?AbortSignal.any([controller.signal,parent]):controller.signal,dispose};
}
