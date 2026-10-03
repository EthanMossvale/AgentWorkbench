import { createHash } from 'node:crypto';

/** Secret-bearing host-only values. Never include these in state, events or errors. */
export interface CodexCredential { name?: string; auth?: Record<string, unknown>; refreshToken?: string }
const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const value = (...values: unknown[]) => values.find(v => typeof v === 'string' && v.trim()) as string | undefined;
function secret(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return;
  if (typeof v !== 'string' || v.length > 65536 || /[\x00-\x20\x7f]/.test(v)) throw Error('LOCAL_ACCOUNT_IMPORT_INVALID');
  return v;
}
function claims(token: string) {
  try { const parts = token.split('.'); if (parts.length !== 3 || parts.some(p => !/^[\w-]+$/.test(p))) throw 0; return object(JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))); }
  catch { throw Error('LOCAL_ACCOUNT_IMPORT_JWT_INVALID'); }
}
function one(input: unknown, mode: string): CodexCredential {
  if (typeof input === 'string') {
    const raw = secret(input.trim()); if (!raw) throw Error('LOCAL_ACCOUNT_IMPORT_INVALID');
    if (mode === 'refresh-token' || raw.startsWith('rt-')) return { refreshToken: raw };
    if (raw.startsWith('at-')) return { auth: { OPENAI_API_KEY: null, personal_access_token: raw } };
    const jwt = claims(raw);
    if (jwt.agent_runtime_id && jwt.agent_private_key) return { auth: { auth_mode: 'agentIdentity', OPENAI_API_KEY: null, agent_identity: raw } };
    return one({ access_token: raw }, 'auto');
  }
  const row = object(input), data = Object.keys(object(row.credentials)).length ? object(row.credentials) : row;
  if (!Object.keys(row).length || row.platform && !['openai','codex'].includes(row.platform) || row.type === 'apikey' || row.OPENAI_API_KEY || data.api_key) throw Error('LOCAL_ACCOUNT_IMPORT_NOT_CODEX');
  const name = value(row.name, row.account_name);
  const meta = name && name.length <= 100 && !/[\x00-\x1f]/.test(name) ? { name } : {};
  const identity = data.agent_identity ?? row.agent_identity ?? (data.agent_runtime_id ? data : undefined);
  if (identity !== undefined) {
    if (typeof identity === 'string') { const jwt = claims(secret(identity)!); if (!jwt.agent_runtime_id || !jwt.agent_private_key) throw Error('LOCAL_ACCOUNT_IMPORT_IDENTITY_INVALID'); return { ...meta, auth: { auth_mode: 'agentIdentity', OPENAI_API_KEY: null, agent_identity: identity } }; }
    const i = object(identity);
    for (const key of ['agent_runtime_id','agent_private_key','account_id','chatgpt_user_id']) if (typeof i[key] !== 'string' || !i[key].trim() || i[key].length > 65536 || i[key].includes('\0')) throw Error('LOCAL_ACCOUNT_IMPORT_IDENTITY_INVALID');
    const normalized: Record<string, unknown> = { agent_runtime_id: i.agent_runtime_id, agent_private_key: i.agent_private_key, account_id: i.account_id, chatgpt_user_id: i.chatgpt_user_id, email: value(i.email, row.email) ?? '', plan_type: value(i.plan_type, row.plan_type) ?? 'unknown', chatgpt_account_is_fedramp: i.chatgpt_account_is_fedramp === true };
    if (i.task_id) normalized.task_id = secret(i.task_id);
    return { ...meta, auth: { auth_mode: 'agentIdentity', OPENAI_API_KEY: null, agent_identity: normalized } };
  }
  const tokens = Object.keys(object(data.tokens)).length ? object(data.tokens) : data;
  const access = secret(value(tokens.personal_access_token, data.personal_access_token, tokens.access_token, tokens.accessToken));
  const refresh = secret(value(tokens.refresh_token, tokens.refreshToken));
  if (access?.startsWith('at-')) return { ...meta, auth: { OPENAI_API_KEY: null, personal_access_token: access } };
  if (!access) { if (refresh) return { ...meta, refreshToken: refresh }; throw Error('LOCAL_ACCOUNT_IMPORT_INVALID'); }
  const parsed = claims(access), authClaims = object(parsed['https://api.openai.com/auth']);
  const idToken = secret(value(tokens.id_token, tokens.idToken)); if (idToken) claims(idToken);
  const idClaims = idToken ? object(claims(idToken)['https://api.openai.com/auth']) : {};
  const accountId = secret(value(tokens.account_id, tokens.chatgpt_account_id, data.account_id, data.chatgpt_account_id, row.account_id, row.chatgpt_account_id, object(row.account).id, authClaims.chatgpt_account_id, idClaims.chatgpt_account_id));
  if (!accountId) throw Error('LOCAL_ACCOUNT_IMPORT_ACCOUNT_ID_REQUIRED');
  // Matches the native external-token representation: original JWT bytes, no invented claims.
  return { ...meta, auth: { auth_mode: refresh ? 'chatgpt' : 'chatgptAuthTokens', OPENAI_API_KEY: null, tokens: { id_token: idToken ?? access, access_token: access, refresh_token: refresh ?? '', account_id: accountId }, last_refresh: new Date().toISOString() } };
}
export function parseCodexCredentials(contents: unknown, mode = 'auto'): CodexCredential[] {
  if (typeof contents !== 'string' || !contents.trim()) throw Error('LOCAL_ACCOUNT_IMPORT_SIZE');
  const text = contents.replace(/^\uFEFF/, '').trim(); let parsed: unknown;
  if (/^[\[{\"]/.test(text)) { try { parsed = JSON.parse(text); } catch { throw Error('LOCAL_ACCOUNT_IMPORT_JSON_INVALID'); } }
  else parsed = text;
  const root = object(parsed);
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(root.accounts) ? root.accounts : [parsed];
  if (!rows.length) throw Error('LOCAL_ACCOUNT_IMPORT_LIMIT');
  const result = rows.map(row => one(row, mode));
  const seen = new Set<string>();
  for (const row of result) { const {last_refresh: _timestamp,...auth}=row.auth??{};const key = createHash('sha256').update(JSON.stringify(row.auth ? auth : row.refreshToken)).digest('hex'); if (seen.has(key)) throw Error('LOCAL_ACCOUNT_IMPORT_DUPLICATE'); seen.add(key); }
  return result;
}
/** Only a submitted refresh-token import invokes this endpoint; no retry or URL from the input. */
export async function resolveCodexCredential(row: CodexCredential, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (row.auth) return row.auth;
  if (!row.refreshToken) throw Error('LOCAL_ACCOUNT_IMPORT_INVALID');
  try {
    const response = await fetcher('https://auth.openai.com/oauth/token', { method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: 'app_EMoamEEZ73f0CkXaXp7hrann', grant_type: 'refresh_token', refresh_token: row.refreshToken }) });
    if (!response.ok) { await response.body?.cancel(); throw 0; }
    const reader = response.body?.getReader(); if (!reader) throw 0; const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1024 * 1024) throw 0; chunks.push(value); } } finally { await reader.cancel().catch(() => {}); }
    const tokens = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    return one({ ...tokens, refresh_token: tokens.refresh_token ?? row.refreshToken }, 'auto').auth!;
  } catch { throw Error('LOCAL_ACCOUNT_IMPORT_REFRESH_FAILED'); }
}
