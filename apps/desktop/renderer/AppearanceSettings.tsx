import { useEffect, useRef, useState, type ReactNode } from 'react';
import { resolveAppearance, type AppearancePatch, type AppearanceSettings as Settings, type FontCatalog, type FontChoice } from '../../../packages/appearance';
import type { PageProps } from './Pages';
import { api } from './App';
import { Toggle } from './ui';
import SelectMenu from './SelectMenu';
import './Appearance.css';
import ThemePresets from './ThemePresets';
import AppearanceCodePreview from './AppearanceCodePreview';
import { themePresets } from '../../../packages/appearance/themes';
import { useFontPresets, useThemePresets } from './appearance';

function FontPicker({label,value,catalog,inherit,onChange,disabled,id}:{label:string;value:FontChoice;catalog:FontCatalog;inherit?:boolean;onChange:(value:FontChoice)=>void;disabled:boolean;id:string}) {
  const contributions=useFontPresets();
  const builtins=[...(inherit?[{value:'inherit',label:'与界面字体相同'}]:[]),{value:'system',label:'系统默认（无衬线）'},{value:'claude',label:'Claude 阅读（Anthropic Serif）'},{value:'serif',label:'文学阅读（衬线）'},{value:'mono',label:'系统等宽'}];
  const families=catalog.families;
  const options=[...builtins,...contributions.map(p=>({value:p.id,label:p.label,description:`插件 · ${p.owner}`})),...families.map(name=>({value:`local:${name}`,label:name})),...(value.startsWith('local:')&&!families.includes(value.slice(6))?[{value,label:catalog.status!=='ready'?value.slice(6):`${value.slice(6)}（不可用时回退）`}]:[]),...(value.startsWith('plugin:')&&!contributions.some(p=>p.id===value)?[{value,label:'插件字体暂不可用（选择已保留）'}]:[])];
  return <div className="appearance-font-control"><SelectMenu label={label} value={value} options={options} searchable onChange={v=>onChange(v as FontChoice)} disabled={disabled} testId={`appearance-${id}`}/></div>;
}
function SizeInput({label,value,min,max,onChange,disabled}:{label:string;value:number;min:number;max:number;onChange:(v:number)=>void;disabled:boolean}) {
  const [draft,setDraft]=useState(String(value));useEffect(()=>setDraft(String(value)),[value]);
  const commit=()=>{const number=Number(draft);if(Number.isInteger(number)&&number>=min&&number<=max){if(number!==value)onChange(number);}else setDraft(String(value));};
  return <label className="appearance-size"><input type="number" aria-label={label} min={min} max={max} step={1} value={draft} disabled={disabled} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){setDraft(String(value));e.preventDefault();}}}/><span>px</span></label>;
}
function AccentInput({value,fallback,onChange,disabled}:{value:string|null;fallback:string;onChange:(value:string|null)=>void;disabled:boolean}) {
  const [draft,setDraft]=useState(value??fallback);useEffect(()=>setDraft(value??fallback),[value,fallback]);
  const commit=()=>{if(/^#[a-f\d]{6}$/i.test(draft)){if(draft!==(value??fallback))onChange(draft);}else setDraft(value??fallback);};
  return <div className="appearance-accent"><input type="color" aria-label="强调色" value={/^#[a-f\d]{6}$/i.test(draft)?draft:fallback} disabled={disabled} onChange={e=>setDraft(e.target.value)} onBlur={commit}/><input className="appearance-color-hex" aria-label="强调色十六进制" value={draft} maxLength={7} disabled={disabled} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>{value&&<button type="button" className="text-button" disabled={disabled} onClick={()=>onChange(null)}>恢复</button>}</div>;
}
export default function AppearanceSettings({state,refresh}:PageProps) {
  const settings=resolveAppearance(state.appearance), current=useRef(settings);current.current=settings;
  const [systemDark,setSystemDark]=useState(()=>matchMedia('(prefers-color-scheme:dark)').matches);
  useThemePresets();
  const mode=(state.theme==='system'?systemDark:state.theme==='dark')?'dark':'light';
  const presetKey=mode==='light'?'lightPreset':'darkPreset',activePreset=themePresets.resolve(settings[presetKey],mode);
  useEffect(()=>{const query=matchMedia('(prefers-color-scheme:dark)'),changed=()=>setSystemDark(query.matches);query.addEventListener('change',changed);return()=>query.removeEventListener('change',changed);},[]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[fonts,setFonts]=useState<FontCatalog>({status:'unavailable',families:[]}),[loading,setLoading]=useState(true),[resetOpen,setResetOpen]=useState(false);
  const saving=useRef(false);
  const loadFonts=async()=>{setLoading(true);try{setFonts(await api<FontCatalog>('appearance/fonts'));}catch{setFonts({status:'unavailable',families:[],reason:'enumeration-failed'});}finally{setLoading(false);}};
  useEffect(()=>{void loadFonts();},[]);
  const save=async(patch:AppearancePatch={},reset=false)=>{if(saving.current)return;saving.current=true;setBusy(true);setError('');setSaved(false);try{await api('appearance/set',{revision:current.current.revision,patch,...(reset?{reset:true}:{})});await refresh();setSaved(true);setResetOpen(false);}catch(e){setError(String(e).includes('APPEARANCE_REVISION_CONFLICT')?'外观已在其他窗口更新，请重新选择。':'外观保存失败，请重试。');await refresh().catch(()=>{});}finally{saving.current=false;setBusy(false);}};
  const theme=async(value:string)=>{if(saving.current)return;saving.current=true;setBusy(true);setError('');setSaved(false);try{await api('theme/set',{theme:value});await refresh();setSaved(true);}catch{setError('主题保存失败，请重试。');}finally{saving.current=false;setBusy(false);}};
  const row=(label:string,control:ReactNode,hint?:string)=><div className="appearance-row"><span><strong>{label}</strong>{hint&&<small>{hint}</small>}</span>{control}</div>;
  return <section className="settings-section appearance-settings" data-testid="appearance-settings">
    <h2>视觉风格</h2>
    <div className="appearance-card">{row('模式',<div className="appearance-modes">{([['system','跟随系统'],['light','浅色'],['dark','深色']] as const).map(([id,label])=><button type="button" key={id} data-testid={`theme-${id}`} className={`theme-option ${id}`} aria-pressed={state.theme===id} aria-label={label} title={label} disabled={busy} onClick={()=>void theme(id)}><div className="theme-preview"><i/><div><span/><span/><span/></div></div><span>{label}</span></button>)}</div>)}</div>
    <div className="appearance-card">
      <ThemePresets mode={mode} selected={settings[presetKey]} disabled={busy} onSelect={id=>void save({[presetKey]:id,accent:null})}/>
      {row('强调色',<AccentInput value={settings.accent} fallback={activePreset.colors.accent} disabled={busy} onChange={accent=>void save({accent})}/>)}
      {row('界面字体',<FontPicker label="界面字体" id="ui-font" value={settings.uiFont} catalog={fonts} disabled={busy} onChange={uiFont=>void save({uiFont})}/>)}
    </div>
    <div className="appearance-font-status" data-workbench-font-discovery><small>{loading?'正在读取本机字体…':fonts.status==='ready'?`已发现 ${fonts.families.length} 种本机字体`:'暂时无法读取本机字体，可使用默认字体组合'}</small><button type="button" className="text-button" disabled={loading} onClick={()=>void loadFonts()}>刷新字体</button></div>
    {fonts.claude?.reason&&<p className="model-usage-note" role="status">Claude 字体读取失败：{fonts.claude.reason}。可点击“刷新字体”重试。</p>}
    <h2>文字与阅读</h2>
    <div className="appearance-card">
      {row('界面字号',<SizeInput label="界面字号" value={settings.uiSize} min={11} max={18} disabled={busy} onChange={uiSize=>void save({uiSize})}/>,'按比例调整菜单、侧栏和设置文字')}
      {row('正文字体',<FontPicker label="正文字体" id="content-font" value={settings.contentFont} catalog={fonts} inherit disabled={busy} onChange={contentFont=>void save({contentFont})}/>, '用于回复、译文和子会话')}
      {row('正文字号',<SizeInput label="正文字号" value={settings.contentSize} min={12} max={24} disabled={busy} onChange={contentSize=>void save({contentSize})}/>)}
      {row('代码字体',<FontPicker label="代码字体" id="code-font" value={settings.codeFont} catalog={fonts} disabled={busy} onChange={codeFont=>void save({codeFont})}/>,'建议选择等宽字体')}
      {row('代码字号',<SizeInput label="代码字号" value={settings.codeSize} min={10} max={22} disabled={busy} onChange={codeSize=>void save({codeSize})}/>)}
      <Toggle label="数字使用整齐等高样式" description="用量、金额和计数使用系统字体；正文数字保持等高。" checked={settings.numericStyle==='lining'} onChange={enabled=>{if(!busy)void save({numericStyle:enabled?'lining':'font'});}}/>
    </div>
    <div className="appearance-preview" aria-label="字体预览"><small>实时预览</small><p className="appearance-preview-ui">工作台 · Agent Workbench</p><p className="appearance-preview-content">让想法清晰呈现，让阅读自然舒适。<br/>The quick brown fox · 0123456789</p><AppearanceCodePreview/><div className="appearance-preview-numbers">506,000 <small>tokens</small><span>$2.0805</span><span>72%</span></div></div>
    <div className="appearance-card">{row('减少动态效果',<SelectMenu label="减少动态效果" value={settings.reducedMotion} options={[{value:'system',label:'跟随系统'},{value:'on',label:'开启'},{value:'off',label:'关闭'}]} onChange={reducedMotion=>void save({reducedMotion:reducedMotion as Settings['reducedMotion']})} disabled={busy} testId="appearance-motion"/>)}</div>
    <footer className="appearance-footer"><small role="status">{busy?'正在保存…':saved?'已保存，立即生效':'选择后自动保存；字体仅从本机读取。'}</small><button type="button" className="text-button" disabled={busy} onClick={()=>setResetOpen(v=>!v)}>恢复默认外观</button></footer>
    {resetOpen&&<div className="appearance-reset"><span>恢复默认配色、字体、字号和动态效果；保留当前浅深色模式。</span><button type="button" className="text-button" disabled={busy} onClick={()=>void save({},true)}>确认恢复</button><button type="button" className="text-button" disabled={busy} onClick={()=>setResetOpen(false)}>取消</button></div>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
  </section>;
}
