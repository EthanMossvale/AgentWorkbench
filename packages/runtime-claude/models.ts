import type {NativeModelOption} from '../contracts';

/** Project official initialize metadata without deriving capabilities from model names. */
export function parseClaudeModels(value:unknown):NativeModelOption[]{
  if(!Array.isArray(value)||!value.length||value.length>100)throw Error('CLAUDE_MODELS_INVALID');
  const safe=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value);
  const seen=new Set<string>();
  return value.map(row=>{
    if(!row||!safe(row.value)||seen.has(row.value))throw Error('CLAUDE_MODELS_INVALID');
    seen.add(row.value);
    const efforts=row.supportedEffortLevels??[];
    if(!Array.isArray(efforts)||efforts.length>32||!efforts.every(safe))throw Error('CLAUDE_MODELS_INVALID');
    const extended=/\[1m\]$/i.test(row.value),name=safe(row.displayName)?row.displayName:row.value;
    const capacity=Number.isSafeInteger(row.contextWindow)&&row.contextWindow>0&&row.contextWindow<=100000000?row.contextWindow:extended?1000000:undefined;
    return {id:row.value,model:row.value,name:extended&&!/1m/i.test(name)?name+' (1M)':name,isDefault:seen.size===1,efforts:[...new Set<string>(efforts)],
      serviceTiers:row.supportsFastMode===true?[{id:'priority',name:'Fast',description:'Native Claude fast mode; availability and additional usage charges are controlled by the native account.'}]:[],
      ...(capacity?{contextWindow:capacity}:{}),
      ...(safe(row.defaultEffort)&&efforts.includes(row.defaultEffort)?{defaultEffort:row.defaultEffort}:{})};
  });
}
