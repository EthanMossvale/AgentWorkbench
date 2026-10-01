import { useSyncExternalStore } from 'react';
import { shortcutLabel } from '../../../packages/shortcuts';
import { shortcuts } from './shortcuts';
export function useShortcutTitle() {
  const entries=useSyncExternalStore(shortcuts.subscribe,shortcuts.getSnapshot);
  return (id: string, title: string) => {
    const bindings=entries.find(entry=>entry.id===id)?.bindings;
    return bindings?.length?`${title} · ${bindings.map(key=>shortcutLabel(key,shortcuts.mac)).join(' / ')}`:title;
  };
}
