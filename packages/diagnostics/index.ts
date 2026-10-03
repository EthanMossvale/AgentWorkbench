/** Keep useful diagnostics; redact values rather than entire messages containing field names. */
export function redactDiagnostic(text:string):string {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,'[private-key-redacted]')
    .replace(/\bBearer\s+[^\s"',;}]+/gi,'Bearer [redacted]')
    .replace(/\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g,'[redacted]')
    .replace(/((?:["']?)(?:authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie|set-cookie)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi,'$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[redacted]@');
}
export const errorDiagnostics={
  format(error:unknown):string {
    const message=redactDiagnostic(error instanceof Error?error.message:typeof error==='string'?error:'');
    if(error instanceof Error&&error.name==='TimeoutError')return '操作超时。'+(message?' '+message:'');
    if(error instanceof Error&&error.name==='AbortError')return '操作已取消。'+(message?' '+message:'');
    return message||'操作失败；没有自动重试原生任务。';
  }
};
