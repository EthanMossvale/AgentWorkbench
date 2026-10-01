import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { themePresets, type ThemeMode, type ThemePreset, type ThemePresetId } from '../../../packages/appearance/themes';
import { useThemePresets } from './appearance';
import { Icon } from './ui';

type Group = 'builtin' | 'plugin';
const badge = (preset: ThemePreset) => <span className="appearance-theme-badge" aria-hidden="true" style={{background:preset.colors.bg,color:preset.colors.accent,borderColor:preset.colors.line}}>Aa</span>;

/** Theme contributions share the compact picker; no gallery is mounted when closed. */
export default function ThemePresets({mode,selected,disabled,onSelect}:{mode:ThemeMode;selected:ThemePresetId;disabled:boolean;onSelect:(id:ThemePresetId)=>void}) {
  const all=useThemePresets(),presets=all.filter(p=>p.mode===mode),current=presets.find(p=>p.id===selected),fallback=themePresets.resolve(selected,mode);
  const [open,setOpen]=useState(false),[group,setGroup]=useState<Group|null>(null),[position,setPosition]=useState<CSSProperties>({}),[childPosition,setChildPosition]=useState<CSSProperties>({});
  const trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null),child=useRef<HTMLDivElement>(null),pendingFocus=useRef<'root'|'child'|null>(null),id=useId();
  const groups:Group[]=presets.some(p=>p.owner)?['builtin','plugin']:['builtin'];
  const close=(focus=false)=>{pendingFocus.current=null;setOpen(false);setGroup(null);if(focus)trigger.current?.focus();};
  const show=()=>{pendingFocus.current='root';setOpen(true);};
  const back=()=>{setGroup(null);menu.current?.querySelector<HTMLButtonElement>(`[data-theme-group="${group}"]`)?.focus();};
  useEffect(()=>{close();},[mode,disabled]);
  useEffect(()=>{if(group==='plugin'&&!presets.some(p=>p.owner)){setGroup(null);menu.current?.querySelector<HTMLButtonElement>('button')?.focus();}},[all,group,mode]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:Event)=>{const target=event.target as Node;if(!trigger.current?.contains(target)&&!menu.current?.contains(target)&&!child.current?.contains(target))close();};
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);};
  },[open]);
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      if(!trigger.current||!menu.current)return;
      const rect=trigger.current.getBoundingClientRect(),width=Math.min(220,innerWidth-24),left=Math.max(12,Math.min(rect.right-width,innerWidth-width-12));
      const height=Math.min(menu.current.scrollHeight+2,innerHeight-24),top=Math.max(12,Math.min(rect.bottom+6,innerHeight-height-12));
      setPosition({visibility:'visible',width,left,top,maxHeight:innerHeight-24});
      if(group&&child.current){
        const childWidth=Math.min(240,innerWidth-24),item=menu.current.querySelector<HTMLButtonElement>(`[data-theme-group="${group}"]`),itemTop=top+(item?.offsetTop??0);
        const right=left+width+4,childLeft=right+childWidth<=innerWidth-12?right:left-childWidth-4>=12?left-childWidth-4:Math.max(12,Math.min(left,innerWidth-childWidth-12));
        const maxHeight=Math.min(340,innerHeight-24),childHeight=Math.min(child.current.scrollHeight+2,maxHeight);
        setChildPosition({visibility:'visible',width:childWidth,left:childLeft,top:Math.max(12,Math.min(itemTop,innerHeight-childHeight-12)),maxHeight});
      }
    };
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open,group,all]);
  // Layout placement commits before paint; focus never targets a hidden popup.
  useLayoutEffect(()=>{
    if(!open)return;
    const panel=pendingFocus.current==='child'?child.current:pendingFocus.current==='root'?menu.current:null;
    if(!panel||panel.style.visibility!=='visible')return;
    (panel.querySelector<HTMLButtonElement>('[aria-checked=true]')??panel.querySelector<HTMLButtonElement>('[role^=menuitem]'))?.focus({preventScroll:true});pendingFocus.current=null;
  },[open,group,position,childPosition]);
  const keys=(event:KeyboardEvent<HTMLDivElement>,submenu=false)=>{
    if(event.nativeEvent.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(submenu)back();else close(true);}
    if(event.key==='Tab')close(true);
    if(submenu&&event.key==='ArrowLeft'){event.preventDefault();back();}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^=menuitem]')],index=items.indexOf(document.activeElement as HTMLButtonElement);
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();
    }
  };
  const enter=(value:Group,focus=false)=>{if(focus)pendingFocus.current='child';setGroup(value);if(focus&&group===value){(child.current?.querySelector<HTMLButtonElement>('[aria-checked=true]')??child.current?.querySelector<HTMLButtonElement>('[role=menuitemradio]'))?.focus({preventScroll:true});pendingFocus.current=null;}};
  return <div className="appearance-row appearance-theme-row" data-workbench-theme-picker data-testid="appearance-presets">
    <span><strong>主题</strong>{!current&&<small className="appearance-preset-unavailable" role="status">所选主题暂不可用，暂用「{fallback.label}」；选择已保留。</small>}</span>
    <button ref={trigger} type="button" className="compact-select-trigger appearance-theme-trigger" data-testid="appearance-theme" aria-label="主题" title={`${mode==='light'?'浅色':'深色'}主题；分别保存，跟随系统自动切换`} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} disabled={disabled} onClick={()=>open?close():show()} onKeyDown={event=>{if(['ArrowDown','ArrowUp'].includes(event.key)&&!event.nativeEvent.isComposing){event.preventDefault();show();}}}>
      {badge(current??fallback)}<span>{current?.label??`${fallback.label}（暂用）`}</span><Icon name="chevron-down" size={12}/>
    </button>
    {open&&createPortal(<>
      <div ref={menu} id={id} className="compact-select-menu appearance-theme-menu" style={position} role="menu" aria-label="主题来源" onKeyDown={event=>keys(event)}>
        <div className="compact-menu-label">{mode==='light'?'浅色':'深色'}主题</div>
        {groups.map(value=><button key={value} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={group===value} aria-controls={group===value?`${id}-presets`:undefined} data-theme-group={value} onPointerEnter={event=>{if(event.pointerType==='mouse')enter(value);}} onClick={()=>enter(value,true)} onKeyDown={event=>{if(event.key==='ArrowRight'){event.preventDefault();enter(value,true);}}}>
          {badge(value==='builtin'?presets.find(p=>!p.owner)!:presets.find(p=>p.owner)!)}<span>{value==='builtin'?'内置主题':'插件主题'}</span><Icon name="chevron" size={12}/>
        </button>)}
      </div>
      {group&&<div ref={child} id={`${id}-presets`} className="compact-select-menu appearance-theme-submenu" style={childPosition} role="menu" aria-label={group==='builtin'?'内置主题':'插件主题'} onKeyDown={event=>keys(event,true)}>
        <button className="appearance-theme-back" type="button" aria-label="返回主题来源" onClick={back}><Icon name="chevron" size={12}/>{group==='builtin'?'内置主题':'插件主题'}</button>
        {presets.filter(p=>group==='plugin'?!!p.owner:!p.owner).map(p=><button type="button" key={p.id} role="menuitemradio" aria-checked={selected===p.id} title={p.description||p.owner} data-preset={p.id} data-testid={`preset-${p.id}`} onClick={()=>{close(true);onSelect(p.id);}}>
          {badge(p)}<span>{p.label}{p.owner&&<small>{p.owner}</small>}</span>{selected===p.id&&<Icon name="check" size={14}/>}</button>)}
      </div>}
    </>,document.body)}
  </div>;
}
