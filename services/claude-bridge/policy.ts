/** Byte limits are separate for native wire envelopes and normalized tool results. */
export interface ClaudeMcpPolicy {
  frameBytes:number; outputWindowBytes:number; resultBytes:number; inlineBytes:number;
  storedBytes:number; catalogPages:number; catalogTools:number; commandConcurrency:number;
}
export const defaultClaudeMcpPolicy:Readonly<ClaudeMcpPolicy>=Object.freeze({
  frameBytes:16*1024*1024, outputWindowBytes:128*1024*1024, resultBytes:8*1024*1024,
  inlineBytes:1024*1024, storedBytes:256*1024*1024, catalogPages:32, catalogTools:512, commandConcurrency:4
});
export function claudeMcpPolicy(input:Partial<ClaudeMcpPolicy>={}):ClaudeMcpPolicy {
  const policy={...defaultClaudeMcpPolicy,...input};
  if(Object.values(policy).some(n=>!Number.isSafeInteger(n)||n<1)||policy.inlineBytes>policy.resultBytes||policy.resultBytes>=policy.frameBytes||policy.frameBytes>policy.outputWindowBytes||policy.resultBytes>policy.storedBytes)throw Error('CLAUDE_LOCAL_POLICY_INVALID');
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
