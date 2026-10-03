/** Explicit limits use 0 for unlimited; inlineBytes is a paging threshold. */
export interface ClaudeMcpPolicy {
  frameBytes:number; outputWindowBytes:number; resultBytes:number; inlineBytes:number;
  storedBytes:number; catalogPages:number; catalogTools:number; commandConcurrency:number;
}
export const defaultClaudeMcpPolicy:Readonly<ClaudeMcpPolicy>=Object.freeze({
  frameBytes:0, outputWindowBytes:0, resultBytes:0,
  inlineBytes:1024*1024, storedBytes:0, catalogPages:0, catalogTools:0, commandConcurrency:4
});
export function claudeMcpPolicy(input:Partial<ClaudeMcpPolicy>={}):ClaudeMcpPolicy {
  const policy={...defaultClaudeMcpPolicy,...input};
  if(Object.values(policy).some(n=>!Number.isSafeInteger(n)||n<0))throw Error('CLAUDE_LOCAL_POLICY_INVALID');
  return Object.freeze(policy);
}
export interface ClaudeToolDiagnostic {
  code:string; tool?:string; callId?:string; stage:'catalog'|'execute'|'transport'|'delivery';
  elapsedMs?:number; bytes?:number; outcome:'not-started'|'unknown'|'returned';
}
export class ClaudeToolError extends Error {
  constructor(readonly diagnostic:ClaudeToolDiagnostic){super(diagnostic.code);this.name='ClaudeToolError';}
}
export function claudeToolFailure(error:unknown):{code:string;diagnostic?:ClaudeToolDiagnostic} {
  if(error instanceof ClaudeToolError)return {code:error.message,diagnostic:error.diagnostic};
  const message=error instanceof Error?error.message:'';
  return {code:/^(?:CLAUDE_LOCAL|LOCAL_(?:CONTEXT|SKILL|TASK|TASKS|RESULT))_[A-Z_]+$/.test(message)?message:'CLAUDE_LOCAL_TOOL_UNCONFIRMED'};
}

export interface ClaudeToolPolicySource {id:`plugin:${string}`;resolve(input:Partial<ClaudeMcpPolicy>):Partial<ClaudeMcpPolicy>|undefined}
export class ClaudeToolPolicies {
 private sources=new Map<string,ClaudeToolPolicySource>();
 register(source:ClaudeToolPolicySource):()=>void {if(this.sources.has(source.id))throw Error('CLAUDE_LOCAL_POLICY_DUPLICATE');const entry={...source};this.sources.set(entry.id,entry);return ()=>{if(this.sources.get(entry.id)===entry)this.sources.delete(entry.id);};}
 resolve(input:Partial<ClaudeMcpPolicy>={}):ClaudeMcpPolicy {for(const source of [...this.sources.values()].reverse()){const value=source.resolve(input);if(value!==undefined)return claudeMcpPolicy({...value,...input});}return claudeMcpPolicy(input);}
}
export const claudeToolPolicies=new ClaudeToolPolicies();
