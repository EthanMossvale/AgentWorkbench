import { visualizationPresentation } from '../visualizations/instructions';
import type { ApiModel } from './types';
import type { NativeForkSource, NativeModelSelection, PermissionMode, Protocol } from '../contracts';
import { codexThreadPermissionParams } from '../runtime-codex';
import { claudePermissionMode } from '../runtime-claude';
import { nativeContextSettings, claudeContextModel } from './native-context';

/** Provider settings apply only to the owned child process; no native config is rewritten. */
export function nativeProviderLaunch(runtime: 'codex' | 'claude', model: ApiModel, gateway: { baseUrl: string; token: string }, permission: PermissionMode, selection: NativeModelSelection | undefined, sourceEnv: NodeJS.ProcessEnv, resume?: string, protocol: Protocol = 'responses', catalogPath?: string, fork?:NativeForkSource, forkId?:string) {
  const env = { ...sourceEnv }, context = nativeContextSettings(model);
  for (const key of Object.keys(env)) if (/^(OPENAI_|ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_|CLAUDE_CODE_API_KEY_HELPER|CODEX_API_KEY)/.test(key)) delete env[key];
  if (runtime === 'codex') {
    env.AWB_PROVIDER_TOKEN = gateway.token;
    // This host implements request_user_input. Enable its native Default-mode entry;
    // the CLI retains tool execution and permission policy. No user config is rewritten.
    const config: Record<string, unknown> = { model: model.model, model_provider: 'workbench', check_for_update_on_startup: false, 'features.default_mode_request_user_input': true, 'model_providers.workbench.name': 'Workbench', 'model_providers.workbench.base_url': gateway.baseUrl + '/v1', 'model_providers.workbench.env_key': 'AWB_PROVIDER_TOKEN', 'model_providers.workbench.wire_api': 'responses', 'model_providers.workbench.requires_openai_auth': false, ...(context ? { model_context_window: context.window, model_auto_compact_token_limit: context.compactAt } : {}) };
    // Hosted Responses search has no Chat/Messages wire equivalent; local native tools remain available.
    if (protocol !== 'responses') config.web_search = 'disabled';
    if (catalogPath) config.model_catalog_json = catalogPath;
    const args = Object.entries(config).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]);
    return { args: [...args, 'app-server', '--listen', 'stdio://'], env, thread: { developerInstructions:visualizationPresentation.instructions(runtime), ...codexThreadPermissionParams(permission), model: model.model, modelProvider: 'workbench' } };
  }
  const runtimeModel = claudeContextModel(model);
  Object.assign(env, { ANTHROPIC_BASE_URL: gateway.baseUrl, ANTHROPIC_AUTH_TOKEN: gateway.token, ANTHROPIC_MODEL: runtimeModel, ANTHROPIC_DEFAULT_OPUS_MODEL: runtimeModel, ANTHROPIC_DEFAULT_SONNET_MODEL: runtimeModel, ANTHROPIC_DEFAULT_HAIKU_MODEL: runtimeModel, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });
  // The verified CLI ignores percentage/compact-window overrides for custom IDs.
  // Bound its proactive budget to 90% while retaining the full upstream capacity in model metadata.
  if(context){env.CLAUDE_CODE_MAX_CONTEXT_TOKENS=String(context.compactAt);env.CLAUDE_CODE_AUTO_COMPACT_WINDOW=String(Math.max(100000,Math.min(1000000,context.compactAt)));}
  // Third-party providers do not establish compatibility with Claude's safety classifier.
  // Keep native manual approval, including during planning, for this owned process only.
  const args = ['--append-system-prompt',visualizationPresentation.instructions(runtime),'--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--replay-user-messages', '--permission-prompt-tool', 'stdio', '--allow-dangerously-skip-permissions', '--settings', JSON.stringify({ permissions: { disableAutoMode: 'disable' }, useAutoModeDuringPlan: false }), '--model', runtimeModel, '--permission-mode', claudePermissionMode(permission), '--mcp-config', JSON.stringify({ mcpServers: { workbench: { type: 'http', url: gateway.baseUrl + '/mcp', headers: { Authorization: `Bearer ${gateway.token}` } } } })];
  if (resume) args.push('--resume', resume);
  else if(fork){
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if(fork.runtime!=='claude'||!uuid.test(fork.threadId)||!uuid.test(fork.lastMessageId??'')||!uuid.test(forkId??'')||forkId===fork.threadId)throw Error('NATIVE_FORK_BOUNDARY_UNVERIFIED');
    args.push('--resume',fork.threadId,'--fork-session','--resume-session-at',fork.lastMessageId!,'--session-id',forkId!);
  }
  // The gateway applies the exact upstream effort. CLI-specific enums must not truncate its range.
  if (selection?.effort && ['low', 'medium', 'high', 'xhigh', 'max'].includes(selection.effort)) args.push('--effort', selection.effort);
  return { args, env, thread: undefined, runtimeModel };
}
