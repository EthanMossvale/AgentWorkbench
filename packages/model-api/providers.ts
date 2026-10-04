import { createHash, randomUUID } from 'node:crypto';
import type { Protocol } from '../contracts';
import type { ModelConnection } from './types';

const PROTOCOLS: readonly Protocol[] = ['chat-completions', 'responses', 'anthropic-messages'];
/** Headers owned by the core request path; a provider can never replace credentials or framing. */
const RESERVED = new Set(['authorization', 'x-api-key', 'content-type', 'content-length', 'anthropic-version', 'host', 'cookie', 'connection', 'transfer-encoding']);
const CORE_ID = /^core\.[a-z0-9][a-z0-9-]{0,62}$/, PLUGIN_ID = /^plugin:[^\s/]{1,120}\/[^\s]{1,120}$/;

export interface ModelProviderRequest {
  connection: ModelConnection; protocol: Protocol;
  /** Upstream model ID; absent for directory reads. */
  model?: string;
  /** Opaque routing ID: stable for one conversation, fresh for one-off requests. Never the raw session ID. */
  sessionId: string;
  clientVersion: string;
}
export interface ModelProviderDefinition {
  /** `core.<name>` for shipped presets, `plugin:<owner>/<name>` for plugin registrations. */
  id: string; label: string; description?: string; docsUrl?: string;
  baseUrl: string; modelsUrl?: string; protocol: Protocol;
  /** Wire protocol for an upstream model ID; undefined uses `protocol`. */
  modelProtocol?(model: string): Protocol | undefined;
  /** Extra request headers. Credential, content type and protocol version headers are rejected. */
  headers?(request: ModelProviderRequest): Record<string, string> | undefined;
  /** key: verified with a live key; endpoint: address answered without a key; docs: documented only. */
  verification: 'key' | 'endpoint' | 'docs';
  /** Layer over an existing provider ID until disposed; saved connections keep the original ID. */
  replaces?: string;
}
export interface ModelProviderSummary {
  id: string; label: string; description?: string; docsUrl?: string;
  baseUrl: string; modelsUrl?: string; protocol: Protocol; verification: ModelProviderDefinition['verification'];
  /** Registration that currently supplies this entry. */
  source: string;
}

export class ModelProviders {
  private entries: ModelProviderDefinition[] = [];
  private listeners = new Set<() => void>();
  /** Sent in provider-requested user agents; the core process sets the installed version. */
  clientVersion = '0.0.0';
  register(definition: ModelProviderDefinition): () => void {
    const entry = { ...definition };
    if (!CORE_ID.test(entry.id) && !PLUGIN_ID.test(entry.id)) throw Error('MODEL_PROVIDER_ID_INVALID');
    if (!entry.label?.trim() || !PROTOCOLS.includes(entry.protocol) || !['key', 'endpoint', 'docs'].includes(entry.verification)) throw Error('MODEL_PROVIDER_INVALID');
    for (const url of [entry.baseUrl, entry.modelsUrl]) if (url !== undefined && !/^https?:$/.test(new URL(url).protocol)) throw Error('MODEL_PROVIDER_URL_INVALID');
    if (entry.replaces !== undefined && (entry.replaces === entry.id || typeof entry.replaces !== 'string')) throw Error('MODEL_PROVIDER_INVALID');
    if (this.entries.some(item => item.id === entry.id)) throw Error('MODEL_PROVIDER_DUPLICATE');
    this.entries.push(entry); this.emit();
    return () => { const index = this.entries.indexOf(entry); if (index >= 0) { this.entries.splice(index, 1); this.emit(); } };
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of [...this.listeners]) try { listener(); } catch { /* A listener cannot block registration. */ } }
  /** The newest replacement wins; otherwise the original registration. */
  get(id: string | undefined): ModelProviderDefinition | undefined {
    if (!id) return;
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i]!.replaces === id) return this.entries[i];
    return this.entries.find(item => item.id === id);
  }
  list(): ModelProviderSummary[] {
    return this.entries.filter(item => item.replaces === undefined).map(item => {
      const active = this.get(item.id)!;
      return { id: item.id, label: active.label, ...(active.description ? { description: active.description } : {}), ...(active.docsUrl ? { docsUrl: active.docsUrl } : {}), baseUrl: active.baseUrl, ...(active.modelsUrl ? { modelsUrl: active.modelsUrl } : {}), protocol: active.protocol, verification: active.verification, source: active.id };
    });
  }
  /** Missing or disabled providers fall back to the saved connection protocol. */
  protocol(connection: Pick<ModelConnection, 'protocol' | 'providerId'>, model: string): Protocol {
    const value = this.get(connection.providerId)?.modelProtocol?.(model);
    return value !== undefined && PROTOCOLS.includes(value) ? value : connection.protocol;
  }
  /** Request view of a saved connection for one model; never persisted or used for credential scope. */
  resolve<T extends Pick<ModelConnection, 'protocol' | 'providerId'>>(connection: T, model: string): T {
    const protocol = this.protocol(connection, model);
    return protocol === connection.protocol ? connection : { ...connection, protocol };
  }
  headers(connection: ModelConnection, request: { model?: string; sessionId?: string } = {}): Record<string, string> {
    const provider = this.get(connection.providerId);
    if (!provider?.headers) return {};
    // Hash with the connection so the upstream never receives the workbench session ID.
    const sessionId = createHash('sha256').update(JSON.stringify([connection.id, request.sessionId ?? randomUUID()])).digest('hex').slice(0, 32);
    let value: Record<string, string> | undefined;
    try { value = provider.headers({ connection, protocol: connection.protocol, model: request.model, sessionId, clientVersion: this.clientVersion }); }
    catch { throw Error('MODEL_PROVIDER_HEADERS_FAILED'); }
    const result: Record<string, string> = {};
    for (const [name, header] of Object.entries(value ?? {})) {
      const key = name.toLowerCase();
      if (RESERVED.has(key) || !/^[a-z0-9-]{1,64}$/.test(key) || typeof header !== 'string' || header.length > 512 || /[\r\n\u0000]/.test(header)) throw Error('MODEL_PROVIDER_HEADER_INVALID');
      result[key] = header;
    }
    return result;
  }
}

const opencodeSession = (request: ModelProviderRequest) => ({ 'user-agent': `AgentWorkbench/${request.clientVersion}`, 'x-opencode-session': request.sessionId });
const family = (rules: [RegExp, Protocol][]) => (model: string) => rules.find(([pattern]) => pattern.test(model))?.[1];
/** Shipped presets. Addresses follow each provider's public documentation. */
export const coreModelProviders: ModelProviderDefinition[] = [
  { id: 'core.opencode-go', label: 'OpenCode Go', description: 'OpenCode Go 订阅；按模型自动选择接口协议', docsUrl: 'https://opencode.ai/docs/go/', baseUrl: 'https://opencode.ai/zen/go/v1', protocol: 'chat-completions', verification: 'key',
    modelProtocol: family([[/^(gpt-|grok-|muse-)/, 'responses'], [/^(minimax-|qwen)/, 'anthropic-messages']]), headers: opencodeSession },
  { id: 'core.opencode-zen', label: 'OpenCode Zen', description: 'OpenCode 按量付费；按模型自动选择接口协议，Gemini 模型暂不支持', docsUrl: 'https://opencode.ai/docs/zen/', baseUrl: 'https://opencode.ai/zen/v1', protocol: 'chat-completions', verification: 'endpoint',
    modelProtocol: family([[/^(gpt-|grok-|muse-)/, 'responses'], [/^qwen3\.8-max$/, 'chat-completions'], [/^(claude-|qwen)/, 'anthropic-messages']]) },
  { id: 'core.deepseek', label: 'DeepSeek', docsUrl: 'https://api-docs.deepseek.com/', baseUrl: 'https://api.deepseek.com', protocol: 'chat-completions', verification: 'endpoint' },
  { id: 'core.openai', label: 'OpenAI', docsUrl: 'https://platform.openai.com/docs/api-reference', baseUrl: 'https://api.openai.com/v1', protocol: 'responses', verification: 'endpoint' },
  { id: 'core.anthropic', label: 'Anthropic', docsUrl: 'https://docs.anthropic.com/en/api/overview', baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic-messages', verification: 'endpoint' },
  { id: 'core.openrouter', label: 'OpenRouter', docsUrl: 'https://openrouter.ai/docs', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'chat-completions', verification: 'endpoint' },
  { id: 'core.moonshot', label: 'Kimi（Moonshot 国际）', docsUrl: 'https://platform.moonshot.ai/docs', baseUrl: 'https://api.moonshot.ai/v1', protocol: 'chat-completions', verification: 'endpoint' },
  { id: 'core.moonshot-cn', label: 'Kimi（Moonshot 中国）', docsUrl: 'https://platform.moonshot.cn/docs', baseUrl: 'https://api.moonshot.cn/v1', protocol: 'chat-completions', verification: 'endpoint' },
  { id: 'core.zai', label: 'Z.ai', docsUrl: 'https://docs.z.ai/', baseUrl: 'https://api.z.ai/api/paas/v4', protocol: 'chat-completions', verification: 'endpoint' },
  { id: 'core.zai-coding', label: 'Z.ai Coding Plan', docsUrl: 'https://docs.z.ai/devpack/overview', baseUrl: 'https://api.z.ai/api/coding/paas/v4', protocol: 'chat-completions', verification: 'endpoint' },
  { id: 'core.zhipu-cn', label: '智谱 BigModel（中国）', docsUrl: 'https://docs.bigmodel.cn/', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'chat-completions', verification: 'endpoint' },
  { id: 'core.zhipu-coding-cn', label: '智谱 Coding Plan（中国）', docsUrl: 'https://docs.bigmodel.cn/', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', protocol: 'chat-completions', verification: 'endpoint' },
  { id: 'core.minimax', label: 'MiniMax（国际）', docsUrl: 'https://platform.minimax.io/docs', baseUrl: 'https://api.minimax.io/v1', protocol: 'chat-completions', verification: 'endpoint' },
  { id: 'core.minimax-cn', label: 'MiniMax（中国）', docsUrl: 'https://platform.minimaxi.com/docs', baseUrl: 'https://api.minimaxi.com/v1', protocol: 'chat-completions', verification: 'endpoint' },
  { id: 'core.qwen', label: '通义千问 DashScope（国际）', docsUrl: 'https://www.alibabacloud.com/help/en/model-studio/', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', protocol: 'chat-completions', verification: 'endpoint' },
  { id: 'core.qwen-cn', label: '通义千问 DashScope（中国）', docsUrl: 'https://help.aliyun.com/zh/model-studio/', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'chat-completions', verification: 'endpoint' },
];
export const modelProviders = new ModelProviders();
for (const provider of coreModelProviders) modelProviders.register(provider);
