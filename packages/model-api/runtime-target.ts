import type { AppState, NativeModelSelection, RuntimeKind, Session } from '../contracts';
import type { ModelTarget } from './types';

export interface RuntimeModelChoice { targetId?: string; hostId?: string; selection?: NativeModelSelection }
export interface RuntimeModelPreferences { version: 1; entries: Partial<Record<RuntimeKind, RuntimeModelChoice>> }

/** Preserve each explicit lane; temporary availability never deletes a choice. */
export function rememberRuntimeModel(state: AppState) {
  const runtime = state.lastSelectedRuntime;
  if (!runtime || runtime === 'demo' || !state.lastModelTargetId && !state.lastModelSelection) return;
  if (state.runtimeModelPreferences && state.runtimeModelPreferences.version !== 1) throw Error('RUNTIME_MODEL_PREFERENCES_VERSION');
  state.runtimeModelPreferences ??= { version: 1, entries: {} };
  state.runtimeModelPreferences.entries[runtime] = structuredClone({...(state.lastModelTargetId?{targetId:state.lastModelTargetId}:{}),...(state.lastModelHostId?{hostId:state.lastModelHostId}:{}),...(state.lastModelSelection?{selection:state.lastModelSelection}:{})});
}

/** Runtime changes restore the destination model, never require the outgoing model. */
export function runtimeTarget(targets: ModelTarget[], runtime: RuntimeKind, session: Session, preferred?: RuntimeModelChoice): ModelTarget | undefined {
  const candidates = targets.filter(target => target.runtime === runtime && target.ready);
  const lanes = [...session.modelLanes ?? []].reverse();
  const saved = lanes.map(lane => candidates.find(target => target.id === lane.targetId)).find(Boolean);
  if (saved) return saved;
  const remembered = candidates.find(target => target.id === preferred?.targetId);
  if (remembered) return remembered;
  const binding = session.binding;
  const sameSource = candidates.filter(target => binding.hostId ? target.binding.hostId === binding.hostId :
    binding.modelConnectionId ? target.binding.modelConnectionId === binding.modelConnectionId :
    binding.localAccountId ? !!target.binding.localAccountId : target.runtime.startsWith('plugin:'));
  return sameSource.find(target => target.selection) ?? sameSource[0] ??
    candidates.find(target => !target.binding.hostId && !!target.selection) ??
    (runtime.startsWith('plugin:') ? candidates[0] : undefined);
}
