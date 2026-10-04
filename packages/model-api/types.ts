import type { NativeModelSelection, Protocol, RuntimeKind, SessionBinding } from '../contracts';

export interface ApiModel {
  /** Stable local mapping key; never confused with the upstream model ID. */
  id: string; name: string; model: string; enabled: boolean;
  contextWindow?: number; maxOutputTokens?: number; efforts?: string[]; defaultEffort?: string;
  effortCandidates?: string[]; reasoningProbe?: import('./reasoning-info').ReasoningProbe;
  /** Explicit user configuration; not evidence that the upstream accepts these values. */
  manualEfforts?: string[];
  adaptiveThinking?: boolean; metadataSource?: 'upstream' | 'manual'; contextWindowSource?: 'upstream' | 'manual';
}
export interface ModelConnection {
  id: string; revision: string; name: string; baseUrl: string; protocol: Protocol;
  /** Optional model directory base when it differs from baseUrl; omitted means baseUrl. */
  modelsUrl?: string;
  enabled: boolean; auth: 'key' | 'none'; hasKey: boolean; credentialRef?: string;
  models: ApiModel[]; discoveredModels: ApiModel[]; discoveredAt?: string; discoveryError?: string;
  /** Legacy persisted fields, normalized to execution defaults on load/save. */
  tools: boolean; timeoutMs: number; maxOutputTokens: number;
}
export interface ModelTarget {
  id: string; name: string; description: string; runtime: RuntimeKind; ready: boolean;
  binding: SessionBinding; selection?: NativeModelSelection; contextWindow?: number;
  /** Display-only reason; never grants execution or supplies a model identity. */
  unavailableReason?: string;
}
export interface ModelTargetCatalog { list(refresh:boolean):Promise<ModelTarget[]> }
export interface ModelLane {
  permissionMode?:import('../contracts').PermissionMode;
  collaborationMode?:import('../session-core/planning').CollaborationMode;
  pluginRuntime?: import('../runtime-extensions/types').RuntimeSessionData;
  targetId: string; binding: SessionBinding; modelSelection?: NativeModelSelection;
  nativeEnvironmentReceipt?: { threadId: string; environmentId: string; cwd: string; runtimeVersion: string; accountRef: string };
  nativeFork?:import('../contracts').NativeForkSource;
  nativeContextUsage?:import('../contracts').NativeContextUsage;
  messageCursor: number;
}
export interface ApiUsage { inputTokens: number | null; outputTokens: number | null }
export interface ApiToolDefinition { name: string; description: string; inputSchema: Record<string, unknown> }
export interface ApiToolCall { id: string; name: string; arguments: string }
export interface ApiTurn { text: string; calls: ApiToolCall[]; usage: ApiUsage; raw: unknown; requestId?: string; completionOutcome?: import('./native-completion').NativeCompletionOutcome }
export interface ApiHistoryEntry { files?:import('../attachments/types').AttachmentPayload[]; role: 'user' | 'assistant'; content: string }
export const apiTargetId = (connectionId: string, modelId: string) => `api/${encodeURIComponent(connectionId)}/${encodeURIComponent(modelId)}`;
