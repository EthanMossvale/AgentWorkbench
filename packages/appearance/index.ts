/** Persisted local appearance contract. Never changes native runtime preferences. */
import { defaultPreset, validPresetId, type ThemePresetId } from './themes';
import { fontPresets, validFontFamily, validPluginFontId, type PluginFontId } from './fonts';
export { validFontFamily } from './fonts';
export type FontChoice = 'system' | 'claude' | 'serif' | 'mono' | 'inherit' | `local:${string}` | PluginFontId;
export interface AppearanceSettings {
  version: 1;
  revision: number;
  uiFont: FontChoice;
  contentFont: FontChoice;
  codeFont: FontChoice;
  uiSize: number;
  contentSize: number;
  codeSize: number;
  palette: 'warm' | 'neutral';
  lightPreset: ThemePresetId;
  darkPreset: ThemePresetId;
  accent: string | null;
  numericStyle: 'lining' | 'font';
  reducedMotion: 'system' | 'on' | 'off';
}
export type AppearancePatch = Partial<Omit<AppearanceSettings, 'version' | 'revision'>>;
/** Transient native window chrome; preferences remain in AppearanceSettings. */
export interface TitlebarAppearance { color:string; symbolColor:string }
export function validateTitlebarAppearance(value:unknown):TitlebarAppearance {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('APPEARANCE_INVALID_TITLEBAR');
  const input=value as Record<string,unknown>;
  if(Object.keys(input).some(key=>key!=='color'&&key!=='symbolColor')||
    ![input.color,input.symbolColor].every(color=>typeof color==='string'&&/^#[a-f\d]{6}$/i.test(color)))throw Error('APPEARANCE_INVALID_TITLEBAR');
  return {color:(input.color as string).toLowerCase(),symbolColor:(input.symbolColor as string).toLowerCase()};
}
export interface FontCatalog { status: 'ready' | 'unavailable'; families: string[]; reason?: 'unsupported-platform' | 'enumeration-failed'; claude?: {available:boolean;italicAvailable:boolean;source:'installed-claude';family:'Anthropic Serif';reason?:string} }
export const SYSTEM_FONT = '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif';
export const SERIF_FONT = 'Georgia, "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", SimSun, serif';
export const CLAUDE_READING_FONT = '"AWB Claude Serif", "Anthropic Serif Variable Text", "Anthropic Serif", Georgia, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", serif';
export const MONO_FONT = '"Cascadia Code", Consolas, "SFMono-Regular", monospace';
export const defaultAppearance = (): AppearanceSettings => ({version:1,revision:0,uiFont:'system',contentFont:'claude',codeFont:'mono',uiSize:13,contentSize:15,codeSize:13,palette:'warm',lightPreset:'builtin.paper',darkPreset:'builtin.charcoal',accent:null,numericStyle:'lining',reducedMotion:'system'});
export function fontStack(choice: FontChoice, fallback: string): string {
  if (choice === 'system') return SYSTEM_FONT;
  if (choice === 'serif') return SERIF_FONT;
  if (choice === 'claude') return CLAUDE_READING_FONT;
  if (choice === 'mono') return MONO_FONT;
  if (choice.startsWith('local:') && validFontFamily(choice.slice(6))) return `"${choice.slice(6)}", ${fallback}`;
  const preset=fontPresets.resolve(choice);
  if(preset)return `"${preset.family}", ${preset.fallback==='mono'?MONO_FONT:preset.fallback==='serif'?SERIF_FONT:SYSTEM_FONT}`;
  return fallback;
}
export function validateAppearancePatch(value: unknown): AppearancePatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('APPEARANCE_INVALID_PATCH');
  const result: Record<string, unknown> = {};
  const defaults = defaultAppearance();
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(defaults,key) || key === 'version' || key === 'revision') throw Error('APPEARANCE_INVALID_PATCH');
    if (['uiFont','contentFont','codeFont'].includes(key)) {
      if (typeof item !== 'string' || !(item === 'system' || item === 'claude' || item === 'serif' || item === 'mono' || key === 'contentFont' && item === 'inherit' || item.startsWith('local:') && validFontFamily(item.slice(6)) || validPluginFontId(item))) throw Error('APPEARANCE_INVALID_FONT');
    } else if (key.endsWith('Size')) {
      const [min,max] = key === 'uiSize' ? [11,18] : key === 'contentSize' ? [12,24] : [10,22];
      if (typeof item !== 'number' || !Number.isInteger(item) || item < min || item > max) throw Error('APPEARANCE_INVALID_SIZE');
    } else if (key==='lightPreset'||key==='darkPreset') {
      if(!validPresetId(item))throw Error('APPEARANCE_INVALID_PRESET');
    } else if (key === 'accent') {
      if (item !== null && (typeof item !== 'string' || !/^#[a-f\d]{6}$/i.test(item))) throw Error('APPEARANCE_INVALID_COLOR');
    } else if (typeof item !== 'string' || (key === 'palette' ? !['warm','neutral'].includes(item) : key === 'numericStyle' ? !['lining','font'].includes(item) : !['system','on','off'].includes(item))) throw Error('APPEARANCE_INVALID_PATCH');
    result[key] = item;
  }
  return result as AppearancePatch;
}
/** Missing settings migrate lazily; malformed fields fall back without overwriting the file. */
export function resolveAppearance(value?: Partial<AppearanceSettings>): AppearanceSettings {
  const result = defaultAppearance();
  if (!value || value.version !== 1) return result;
  if(value.palette==='neutral'){result.lightPreset=defaultPreset('light',true).id;result.darkPreset=defaultPreset('dark',true).id;}
  for (const [key,item] of Object.entries(value)) {
    if (key === 'version' || key === 'revision') continue;
    try { Object.assign(result, validateAppearancePatch({[key]:item})); } catch { /* Preserve valid independent settings. */ }
  }
  if (Number.isSafeInteger(value.revision) && value.revision! >= 0) result.revision=value.revision!;
  return result;
}
export function updateAppearance(current: Partial<AppearanceSettings> | undefined, revision: unknown, patch: unknown, reset = false): AppearanceSettings {
  const previous = resolveAppearance(current);
  if (revision !== previous.revision) throw Error('APPEARANCE_REVISION_CONFLICT');
  const valid=validateAppearancePatch(patch);
  const legacy=valid.palette?{lightPreset:defaultPreset('light',valid.palette==='neutral').id,darkPreset:defaultPreset('dark',valid.palette==='neutral').id}:{};
  return {...(reset ? defaultAppearance() : previous),...legacy,...valid,revision:previous.revision+1};
}
export function normalizeFontCatalog(families: unknown): FontCatalog {
  if (!Array.isArray(families)) return {status:'unavailable',families:[],reason:'enumeration-failed'};
  return {status:'ready',families:[...new Set(families.filter(validFontFamily))].sort((a,b)=>a.localeCompare(b)).slice(0,4000)};
}
