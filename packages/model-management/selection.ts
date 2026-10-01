import type { NativeModelSelection, RuntimeKind } from '../contracts';
import type { ModelTarget } from '../model-api/types';

/** Official models are grouped within their own native runtime, never API aliases. */
export function officialModelGroups(targets: readonly ModelTarget[], runtime: RuntimeKind) {
  const groups = new Map<string, ModelTarget[]>();
  for (const target of targets) {
    if (target.runtime !== runtime || !target.binding.localAccountId || target.binding.hostId || target.binding.modelConnectionId || !target.selection) continue;
    const group = groups.get(target.selection.model) ?? [];
    group.push(target); groups.set(target.selection.model, group);
  }
  return [...groups].map(([model, accounts]) => ({ model, name: accounts[0]!.name, accounts }));
}

/** Called only after an explicit model choice. Stored unavailable choices are never replaced on load. */
export function chooseOfficialModel(accounts: readonly ModelTarget[], currentAccountId?: string) {
  return accounts.find(t => t.ready && t.binding.localAccountId === currentAccountId) ?? accounts.find(t => t.ready);
}

export function officialAccountTarget(targets: readonly ModelTarget[], runtime: RuntimeKind, model: string, id: string, selection?: NativeModelSelection) {
  const target = officialModelGroups(targets, runtime).find(g => g.model === model)?.accounts.find(t => t.binding.localAccountId === id && t.ready);
  if (!target) throw Error('LOCAL_ACCOUNT_MODEL_UNAVAILABLE');
  return { ...target, selection: selection?.model === model ? selection : target.selection };
}
