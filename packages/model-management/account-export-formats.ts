import type { AccountExportContext, AccountExportDefinition } from './account-export-types';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : undefined;
const compact = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
// Claims supply optional export metadata, never login verification or permissions.
function claims(value: unknown) { try { return object(JSON.parse(Buffer.from(String(value).split('.')[1] ?? '', 'base64url').toString('utf8'))); } catch { return {}; } }
function exportFileName({ account, credentials }: AccountExportContext, format: 'official' | 'sub2api' | 'cpa') {
  const native = object(account.provider === 'codex' ? credentials.tokens : credentials.claudeAiOauth);
  const identity = text(account.email) ?? text(claims(native.id_token).email)
    ?? text(object(claims(native.access_token ?? native.accessToken)['https://api.openai.com/profile']).email)
    ?? text(credentials.email) ?? text(native.email) ?? text(account.name) ?? 'account-' + account.id.slice(0, 8);
  const safe = identity.trim().normalize('NFC').replace(/[^\p{L}\p{N}\p{M}_.@+-]+/gu, '_').replace(/^[._-]+|[._-]+$/g, '');
  let prefix = '';
  for (const character of safe) { if (Buffer.byteLength(prefix + character) > 160) break; prefix += character; }
  if (/^(?:con|prn|aux|nul|com\d|lpt\d)\./i.test(prefix)) prefix = '_' + prefix;
  return `${prefix || 'account-' + account.id.slice(0, 8)}-${account.provider}-${format}.json`;
}
function instant(value: unknown, milliseconds = false) {
  const time = typeof value === 'number' ? value * (milliseconds ? 1 : 1000) : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > 0 && time <= 8640000000000000 ? new Date(time).toISOString() : undefined;
}
function oauth({ account, credentials }: AccountExportContext) {
  const native = object(account.provider === 'codex' ? credentials.tokens : credentials.claudeAiOauth);
  const access = text(native.access_token ?? native.accessToken), refresh = text(native.refresh_token ?? native.refreshToken);
  if (!access || account.provider === 'codex' && ['apikey', 'agent_identity', 'personal_access_token'].includes(String(credentials.auth_mode))) throw Error('ACCOUNT_EXPORT_FORMAT_UNSUPPORTED');
  const id = text(native.id_token), accessClaims = claims(access), idClaims = claims(id);
  const auth = { ...object(idClaims['https://api.openai.com/auth']), ...object(accessClaims['https://api.openai.com/auth']) };
  const profile = object(accessClaims['https://api.openai.com/profile']);
  return compact({ access_token: access, refresh_token: refresh, id_token: id,
    account_id: text(native.account_id) ?? text(auth.chatgpt_account_id), user_id: text(auth.chatgpt_user_id),
    email: text(idClaims.email) ?? text(profile.email) ?? account.email,
    plan: text(auth.chatgpt_plan_type) ?? text(native.subscriptionType) ?? account.plan,
    expired: instant(native.expiresAt, true) ?? instant(native.expires_at) ?? instant(accessClaims.exp),
    last_refresh: instant(credentials.last_refresh), scopes: Array.isArray(native.scopes) ? native.scopes : undefined,
  });
}
function official(context: AccountExportContext) {
  const { account, credentials } = context;
  if (account.provider === 'codex') {
    if (!text(credentials.OPENAI_API_KEY) && !text(object(credentials.tokens).access_token) && !credentials.agent_identity && !text(credentials.personal_access_token) && !credentials.bedrock_api_key && !credentials.bedrock_access_keys) throw Error('ACCOUNT_EXPORT_CREDENTIALS_INVALID');
    return { fileName: exportFileName(context, 'official'), value: credentials };
  }
  if (!text(object(credentials.claudeAiOauth).accessToken)) throw Error('ACCOUNT_EXPORT_CREDENTIALS_INVALID');
  return { fileName: exportFileName(context, 'official'), value: credentials };
}
function sub2api(context: AccountExportContext) {
  const { account, credentials, now } = context;
  let type = 'oauth', converted: Record<string, unknown>;
  if (account.provider === 'codex' && text(credentials.OPENAI_API_KEY) && (!credentials.auth_mode || credentials.auth_mode === 'apikey')) {
    type = 'apikey'; converted = { api_key: credentials.OPENAI_API_KEY };
  } else if (account.provider === 'codex' && credentials.auth_mode === 'agent_identity') {
    const agent = object(credentials.agent_identity);
    if (!text(agent.agent_runtime_id) || !text(agent.agent_private_key) || !text(agent.chatgpt_account_id)) throw Error('ACCOUNT_EXPORT_FORMAT_UNSUPPORTED');
    converted = compact({ auth_mode: 'agent_identity', agent_runtime_id: agent.agent_runtime_id, agent_private_key: agent.agent_private_key,
      chatgpt_account_id: agent.chatgpt_account_id, chatgpt_user_id: agent.chatgpt_user_id, chatgpt_account_is_fedramp: agent.chatgpt_account_is_fedramp,
      task_id: agent.task_id, email: account.email, plan_type: account.plan });
  } else {
    const token = oauth(context);
    converted = compact({ access_token: token.access_token, refresh_token: token.refresh_token, id_token: token.id_token,
      expires_at: token.expired, email: token.email,
      ...(account.provider === 'codex' ? { chatgpt_account_id: token.account_id, chatgpt_user_id: token.user_id, plan_type: token.plan } : { scopes: token.scopes }) });
  }
  return { fileName: exportFileName(context, 'sub2api'), value: { type: 'sub2api-data', version: 1, exported_at: now, proxies: [],
    accounts: [{ name: account.name, platform: account.provider === 'codex' ? 'openai' : 'anthropic', type, credentials: converted, concurrency: 1, priority: 0 }] } };
}
function cpa(context: AccountExportContext) {
  const token = oauth(context);
  return { fileName: exportFileName(context, 'cpa'), value: compact({ type: context.account.provider,
    access_token: token.access_token, refresh_token: token.refresh_token, id_token: token.id_token,
    ...(context.account.provider === 'codex' ? { account_id: token.account_id, plan_type: token.plan } : {}),
    email: token.email, expired: token.expired, last_refresh: token.last_refresh }) };
}
export const coreAccountExportFormats: readonly AccountExportDefinition[] = [
  { id: 'official', label: '官方auth.json', description: '保留此账号的官方原生 JSON 结构。', serialize: official },
  { id: 'sub2api', label: 'sub2api', description: 'sub2api 账号数据包，仅包含此账号。', serialize: sub2api },
  { id: 'cpa', label: 'cpa', description: 'CLIProxyAPI 的单账号 OAuth 凭据文件。', serialize: cpa },
];

/** Mask every string by default, including unknown future or plugin credential fields. */
export function redactAccountExport(value: unknown, key = ''): unknown {
  const publicStrings = new Set(['auth_mode', 'type', 'platform', 'exported_at', 'last_refresh', 'expired', 'expires_at']);
  const labels = new Set(['chatgpt', 'chatgptAuthTokens', 'apikey', 'oauth', 'agent_identity', 'personal_access_token', 'sub2api-data', 'codex', 'claude', 'openai', 'anthropic', 'bedrock']);
  if (typeof value === 'string') return publicStrings.has(key) && (labels.has(value) || /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) ? value : value ? '••••••••' : '';
  if (Array.isArray(value)) return value.map(item => redactAccountExport(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactAccountExport(item, name)]));
  return value;
}
