import type { NativeModelSelection, RuntimeKind } from '../contracts';

/** Codex collaboration is independent of sandbox and approval permissions. */
export type CollaborationMode = 'default' | 'plan';
export function resolveCollaborationMode(runtime: RuntimeKind, value: unknown): CollaborationMode {
  if (value === undefined) return 'default';
  if (runtime !== 'codex' || value !== 'default' && value !== 'plan') throw Error('COLLABORATION_MODE_INVALID');
  return value;
}
export function codexCollaborationParams(mode: CollaborationMode | undefined, selection?: NativeModelSelection) {
  const resolved = resolveCollaborationMode('codex', mode);
  if (!selection?.model) {
    if (resolved === 'plan') throw Error('COLLABORATION_MODEL_REQUIRED');
    return {};
  }
  return { collaborationMode: { mode: resolved, settings: { model: selection.model, reasoning_effort: selection.effort ?? null, developer_instructions: null } } };
}
