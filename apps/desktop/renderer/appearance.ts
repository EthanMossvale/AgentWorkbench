import { useLayoutEffect, useSyncExternalStore } from 'react';
import { fontPresets } from '../../../packages/appearance/fonts';
import { accentInk, themePresets, themeVariables } from '../../../packages/appearance/themes';
import { fontStack, resolveAppearance, SYSTEM_FONT, MONO_FONT, SERIF_FONT, type AppearanceSettings } from '../../../packages/appearance';
import './Appearance.css';

export function appearanceVariables(value?: Partial<AppearanceSettings>): Record<string,string> {
  const settings=resolveAppearance(value), ui=fontStack(settings.uiFont,SYSTEM_FONT);
  return {'--font-ui':ui,'--font-content':fontStack(settings.contentFont,settings.contentFont==='inherit'?ui:SERIF_FONT),'--font-mono':fontStack(settings.codeFont,MONO_FONT),'--font-numeric':settings.numericStyle==='lining'?SYSTEM_FONT:ui,'--numeric-variant':settings.numericStyle==='lining'?'lining-nums tabular-nums':'normal','--ui-font-size':`${settings.uiSize}px`,'--content-font-size':`${settings.contentSize}px`,'--code-font-size':`${settings.codeSize}px`};
}
/** A removable stylesheet lets approved plugin CSS remain a separate override layer. */
export function applyAppearance(value?: Partial<AppearanceSettings>, doc: Document = document): () => void {
  const settings=resolveAppearance(value), sheet=doc.createElement('style'), root=doc.documentElement;
  sheet.dataset.workbenchAppearance='';
  const variables=Object.entries(appearanceVariables(settings)).map(([key,value])=>`${key}:${value}`).join(';');
  let css=`:root[data-appearance]{${variables};font-variant-numeric:${settings.numericStyle==='lining'?'lining-nums':'normal'}}`;
  for(const mode of ['light','dark'] as const){const theme=themePresets.resolve(settings[mode==='light'?'lightPreset':'darkPreset'],mode),vars=themeVariables(theme);if(settings.accent){vars['--accent']=settings.accent;vars['--accent-contrast']=accentInk(settings.accent);}css+=`:root[data-appearance]${mode==='dark'?':where([data-theme=dark])':':where(:not([data-theme=dark]))'}{${Object.entries(vars).map(([key,value])=>`${key}:${value}`).join(';')}}`;}
  const reduce=':root[data-appearance] *, :root[data-appearance] *::before, :root[data-appearance] *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}';
  if(settings.reducedMotion==='on')css+=reduce;
  else if(settings.reducedMotion==='system')css+=`@media(prefers-reduced-motion:reduce){${reduce}}`;
  sheet.textContent=css;doc.head.insertBefore(sheet,doc.head.querySelector('style[data-plugin]'));root.dataset.appearance='enabled';
  const event=()=>doc.defaultView?.dispatchEvent(new Event('workbench-appearance'));
  event();return()=>{sheet.remove();if(!doc.querySelector('style[data-workbench-appearance]'))delete root.dataset.appearance;event();};
}
export function useAppearance(value?: Partial<AppearanceSettings>) {
  const catalog=useThemePresets(),fonts=useFontPresets();
  const key=JSON.stringify(value);
  useLayoutEffect(()=>applyAppearance(value),[key,catalog,fonts]);
}
export const useThemePresets=()=>useSyncExternalStore(themePresets.subscribe,themePresets.getSnapshot);
export const useFontPresets=()=>useSyncExternalStore(fontPresets.subscribe,fontPresets.getSnapshot);
export function codeAppearance() {
  const css=getComputedStyle(document.documentElement);
  const size=parseInt(css.getPropertyValue('--code-font-size'),10)||13;
  return {fontFamily:css.getPropertyValue('--font-mono').trim()||MONO_FONT,fontSize:size,lineHeight:Math.round(size*1.7)};
}
