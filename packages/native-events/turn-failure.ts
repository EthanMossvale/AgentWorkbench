/** Classify native terminal metadata without persisting raw errors or private URLs. */
export function nativeTurnFailure(runtime: 'codex' | 'claude', value: unknown): string {
  const record = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
  const root = record(value), error = record(root.error ?? root), info = error.codexErrorInfo ?? error.codex_error_info;
  const subtype = runtime === 'claude' ? root.subtype : undefined;
  const known: Record<string, string> = {
    error_max_turns: 'Claude 原生运行时达到回合数限制。',
    error_max_budget_usd: 'Claude 原生运行时达到其预算限制。',
    error_max_structured_output_retries: 'Claude 原生结构化输出重试次数耗尽。',
  };
  if (typeof subtype === 'string' && known[subtype]) return known[subtype];
  const code = typeof info === 'string' ? info : Object.keys(record(info))[0] ?? '';
  const label = code.replace(/_/g, '').toLowerCase();
  if (label === 'contextwindowexceeded') return '原生运行时报告上下文窗口已超限。';
  if (label === 'usagelimitexceeded' || label === 'ratelimitexceeded') return '原生运行时报告额度或速率限制。';
  const details = record(record(info)[code]);
  const status = details.httpStatusCode ?? details.http_status_code ?? details.status;
  if (Number.isInteger(status) && status >= 400 && status <= 599) return `原生运行时报告 HTTP ${status} 请求失败。`;
  const messages = [error.message, ...(Array.isArray(root.errors) ? root.errors.slice(0, 8) : [])].filter(v => typeof v === 'string').join('\n').slice(0, 8192);
  if (/timed? ?out|timeout/i.test(messages)) return '原生运行时报告请求超时。';
  if (/context.{0,24}(length|limit|window)|too many tokens/i.test(messages)) return '原生运行时报告上下文窗口已超限。';
  if (/rate.?limit|quota|usage.?limit/i.test(messages)) return '原生运行时报告额度或速率限制。';
  const http = /(?:HTTP|status(?: code)?)\s*[:=]?\s*([45]\d{2})\b/i.exec(messages);
  if (http) return `原生运行时报告 HTTP ${http[1]} 请求失败。`;
  return '原生运行时已确认本回合失败，未提供可安全分类的原因。';
}
