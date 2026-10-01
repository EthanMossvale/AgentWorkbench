const results=new Set(['success','error_during_execution','error_max_turns','error_max_budget_usd','error_max_structured_output_retries']);
/** Unknown future result variants must never be interpreted as successful completion. */
export function claudeResultOutcome(value:Readonly<Record<string,unknown>>):'completed'|'failed'|undefined {
  if(value.type!=='result'||typeof value.is_error!=='boolean'||value.subtype!==undefined&&!results.has(String(value.subtype)))return;
  return value.is_error||value.subtype!==undefined&&value.subtype!=='success'?'failed':'completed';
}
