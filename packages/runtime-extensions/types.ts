import type { DraftPreview, NativeContextUsage, NativeModelOption, PermissionMode, Session } from '../contracts';
import type { ApprovalOption, ApprovalReply } from '../native-approvals';
import type { InteractionReply, NativeInteraction, RequestId } from '../native-interactions';

export type PluginRuntimeId = `plugin:${string}`;
export const isPluginRuntime = (value: unknown): value is PluginRuntimeId => typeof value === 'string' && /^plugin:[a-z][a-z0-9./-]{0,119}$/.test(value);
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface RuntimePermission { value: PermissionMode; label: string; description: string }
export interface RuntimeDefinition {
  apiVersion: 1; id: PluginRuntimeId; name: string; description: string;
  permissions: RuntimePermission[];
  /** Public metadata only. Credentials belong in the host secret service. */
  models?: NativeModelOption[];
}
export interface RuntimeCapabilities { fork: boolean; resume: boolean; steer: boolean; approvals: boolean; interactions: boolean; permissions: boolean }
export interface RuntimeCatalogEntry extends RuntimeDefinition {
  owner: string; ready: boolean; reason?: string; capabilities: RuntimeCapabilities;
}
export interface RuntimeSessionData { owner: string; version: 1; name: string; permissions: RuntimePermission[]; capabilities: RuntimeCapabilities; state: JsonValue }
export type RuntimeEvent =
  | { type: 'title'; title: string }
  | { type: 'message'; id: string; text: string; phase?: 'commentary' | 'final' }
  | { type: 'checkpoint'; state: JsonValue }
  | { type: 'context'; usage: NativeContextUsage }
  | { type: 'usage'; usage: import('../session-metrics').UsageSample }
  | { type: 'approval'; id: RequestId; kind: 'command' | 'file' | 'tool' | 'plan'; details: string; options: ApprovalOption[] }
  | { type: 'interaction'; item: Omit<NativeInteraction, 'receipt' | 'receivedAt' | 'status' | 'threadId'> };
export interface RuntimeContext {
  readonly signal: AbortSignal;
  /** Fresh cloned session, including the last persisted checkpoint. */
  session(): Session;
  /** Await events to preserve ordering and surface persistence errors. */
  emit(event: RuntimeEvent): Promise<void>;
}
export interface RuntimeAdapter {
  /** Discovery must not start a model turn or modify a native installation. */
  discover?(): Promise<{ ready: boolean; reason?: string; models?: NativeModelOption[] }>;
  /** Optional initialization on explicit session creation. Never starts a turn. */
  create?(session: Session, signal: AbortSignal): Promise<JsonValue>;
  /** Resolves only when this turn finishes. Output is delivered through emit. */
  run(context: RuntimeContext, input: DraftPreview): Promise<void>;
  /** Returning confirms cancellation; rejection leaves the result uncertain. */
  stop(context: RuntimeContext): Promise<void>;
  /** Explicit recovery only: inspect/reattach; never replay an old submission. */
  resume?(context: RuntimeContext): Promise<void>;
  fork?(source: Session, destination: Session, signal: AbortSignal): Promise<JsonValue>;
  steer?(context: RuntimeContext, input: DraftPreview): Promise<void>;
  approval?(context: RuntimeContext, id: RequestId, reply: ApprovalReply): Promise<void>;
  interaction?(context: RuntimeContext, id: RequestId, reply: InteractionReply): Promise<void>;
  permissions?(context: RuntimeContext, mode: PermissionMode): Promise<void>;
  dispose?(): void | Promise<void>;
}
export interface PluginRuntimes {
  register(definition: RuntimeDefinition, adapter: RuntimeAdapter): () => Promise<void>;
  list(): RuntimeCatalogEntry[];
}
