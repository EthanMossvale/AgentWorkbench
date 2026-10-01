import type {AppState} from '../contracts';
import {annotationDraft,annotationNeedsDisplayTranslation,validateAnnotations,type AnnotationChange,type AnnotationService} from './index';

export function createAnnotationService(host:{snapshot():AppState;update(change:(state:AppState)=>void):Promise<unknown>;translate?(values:Record<string,string>,sessionId:string):Promise<{value:Record<string,string>;assertCurrent():void}>}):AnnotationService {
  const session=(state:AppState,id:string)=>{const found=state.sessions.find(item=>item.id===id);if(!found)throw Error('ANNOTATION_SESSION_MISSING');return found;};
  return {
    read:sessionId=>annotationDraft(session(host.snapshot(),sessionId).annotationDraft),
    update:async(change:AnnotationChange)=>{
      if(!change||typeof change.sessionId!=='string'||!Number.isSafeInteger(change.revision)||change.revision<0)throw Error('ANNOTATION_INVALID');
      const items=validateAnnotations(change.items).map(({id,text,source})=>({id,text,source}));
      let result=annotationDraft(undefined);
      await host.update(state=>{
        const target=session(state,change.sessionId),current=annotationDraft(target.annotationDraft);
        if(current.revision!==change.revision)throw Error('ANNOTATION_CONFLICT');
        result={version:1,revision:current.revision+1,items:items.map(item=>{const saved=current.items.find(old=>old.id===item.id&&old.text===item.text);return {...item,...(saved?.displayTranslation?{displayTranslation:saved.displayTranslation}:{})};})};target.annotationDraft=result;
      });
      return structuredClone(result);
    },
    translate:async({sessionId,revision})=>{
      const draft=annotationDraft(session(host.snapshot(),sessionId).annotationDraft);
      if(draft.revision!==revision)throw Error('ANNOTATION_CONFLICT');
      const pending=draft.items.filter(annotationNeedsDisplayTranslation);
      if(!pending.length)return draft;
      if(!host.translate)throw Error('ANNOTATION_TRANSLATION_UNAVAILABLE');
      const result=await host.translate(Object.fromEntries(pending.map((item,index)=>['annotation_'+index,item.text])),sessionId);
      const translated=new Map(pending.map((item,index)=>{const value=result.value['annotation_'+index];if(typeof value!=='string'||!value.trim()||value.length>64000)throw Error('ANNOTATION_TRANSLATION_INVALID');return [item.id,value] as const;}));
      let saved=draft;
      await host.update(state=>{
        result.assertCurrent();const target=session(state,sessionId),current=annotationDraft(target.annotationDraft);
        if(current.revision!==revision||JSON.stringify(current.items.map(({id,text})=>({id,text})))!==JSON.stringify(draft.items.map(({id,text})=>({id,text}))))throw Error('ANNOTATION_CONFLICT');
        saved={...current,items:current.items.map(item=>translated.has(item.id)?{...item,displayTranslation:translated.get(item.id)!}:item)};target.annotationDraft=saved;
      });
      return structuredClone(saved);
    },
  };
}
