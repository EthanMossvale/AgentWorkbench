import { useEffect, useRef } from 'react';
import type { AppState } from '../../../packages/contracts';
import type { SettingsContribution, SettingsPageContext } from './plugin-settings';
import { mountPluginContent } from './plugin-lifecycle';

export function PluginSettingsPage({entry,state}: {entry:SettingsContribution;state:AppState}) {
  const root = useRef<HTMLDivElement>(null), current = useRef(state); current.current = state;
  useEffect(() => {
    if (!root.current) return;
    return mountPluginContent<SettingsPageContext>({root:root.current,state:()=>structuredClone(current.current)},entry.definition.render,entry.failed);
  },[entry]);
  return <div ref={root} data-plugin-settings={entry.id} data-plugin-mount={entry.owner}/>;
}
