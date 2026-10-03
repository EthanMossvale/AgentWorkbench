import type {ApiModel} from './types';
import {reasoningEfforts,availableReasoningEfforts} from './reasoning-info';
import {isModelId} from '../translation/config';
export interface ReasoningOptionSource {id:`plugin:${string}`;levels(model:ApiModel):readonly string[]}
export class ReasoningOptionCatalog {
 private sources=new Map<string,ReasoningOptionSource>();
 register(source:ReasoningOptionSource):()=>void{
  if(!/^plugin:[a-z\d][a-z\d._-]*\/[a-z\d][a-z\d._-]*$/i.test(source.id)||typeof source.levels!=='function')throw Error('REASONING_OPTION_SOURCE_INVALID');
  if(this.sources.has(source.id))throw Error('REASONING_OPTION_SOURCE_DUPLICATE');const entry={...source};this.sources.set(entry.id,entry);return()=>{if(this.sources.get(entry.id)===entry)this.sources.delete(entry.id);};
 }
 list(model:ApiModel):string[]{return [...new Set([...reasoningEfforts,...availableReasoningEfforts(model),...(model.manualEfforts??[]),...[...this.sources.values()].flatMap(source=>source.levels(model))])].filter(isModelId);}
}
