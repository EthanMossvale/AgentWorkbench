export interface ClaudeRetryNotice {
  attempt: number; maxRetries: number; delayMs: number; status: number | null; error: string;
}
const categories = new Set(['authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'billing_error', 'rate_limit', 'overloaded', 'invalid_request', 'model_not_found', 'server_error', 'max_output_tokens', 'cloud_credential_error', 'unknown']);

/** Public system/api_retry only. User text, tool results and HTTP-looking prose are not signals. */
export function claudeRetryNotice(message: Readonly<Record<string, unknown>>): Readonly<ClaudeRetryNotice> | undefined {
  if (message.type !== 'system' || message.subtype !== 'api_retry') return;
  const { attempt, max_retries: maxRetries, retry_delay_ms: delayMs, error_status: status, error } = message;
  if (!Number.isSafeInteger(attempt) || (attempt as number) < 1
    || !Number.isSafeInteger(maxRetries) || (maxRetries as number) < 1
    || !Number.isSafeInteger(delayMs) || (delayMs as number) < 0
    || (status !== null && (!Number.isSafeInteger(status) || (status as number) < 100 || (status as number) > 599))) return;
  return Object.freeze({ attempt: attempt as number, maxRetries: maxRetries as number, delayMs: delayMs as number, status: status as number | null, error: typeof error === 'string' && categories.has(error) ? error : 'unknown' });
}

export function claudeRetryText(notice: Readonly<ClaudeRetryNotice>): string {
  return `Native Claude retry ${notice.attempt}/${notice.maxRetries}: ${notice.error}${notice.status === null ? '' : ` (HTTP ${notice.status})`}; native delay ${notice.delayMs} ms. The workbench has not added a retry or switched accounts.`;
}
