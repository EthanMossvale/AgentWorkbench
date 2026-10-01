import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { composerQuery, composerScopeKey, matchesComposer, type ComposerCommand } from '../../../packages/composer-core';
import type { ComposerSkill, SkillInvocation } from '../../../packages/native-skills/invocation';
import { api } from './App';
import { Icon, errorText } from './ui';
import './ComposerMenu.css';

export function SkillTokens({skills,onRemove,disabled=false}:{skills:(SkillInvocation&{icon?:string})[];onRemove?:(id:string)=>void;disabled?:boolean}) {
  if(!skills.length)return null;
  return <div className="composer-skill-tokens" data-testid="skill-tokens">{skills.map(skill=><span className="composer-skill-token" key={skill.id} title={`${skill.runtime==='claude'?'/':'$'}${skill.name}`}>
    {skill.icon?<img src={skill.icon} alt=""/>:<Icon name="package" size={14}/>}<span>{skill.displayName}</span>{onRemove&&<button type="button" disabled={disabled} aria-label={`移除技能 ${skill.displayName}`} onClick={()=>onRemove(skill.id)}><Icon name="close" size={12}/></button>}
  </span>)}</div>;
}

export function useComposerMenu({runtime,sessionId,directory,targetId,revision,text,input,disabled,selected,onText,onSkill,onAction}:{runtime:string;sessionId?:string;directory:string;targetId?:string;revision?:string;text:string;input:RefObject<HTMLTextAreaElement|null>;disabled:boolean;selected:SkillInvocation[];onText:(text:string)=>void;onSkill:(skill:ComposerSkill)=>void;onAction:(command:ComposerCommand,scope:string)=>void}) {
  const [open,setOpen]=useState(false),[onlySkills,setOnlySkills]=useState(false),[trigger,setTrigger]=useState<ReturnType<typeof composerQuery>>(null),[index,setIndex]=useState(0);
  const scope=composerScopeKey({runtime,sessionId,directory,targetId});
  const [catalog,setCatalog]=useState<{scope:string;commands:ComposerCommand[];skills:ComposerSkill[]}>({scope:'',commands:[],skills:[]}),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const latestScope=useRef(scope);latestScope.current=scope;
  const [refreshKey,setRefreshKey]=useState(0);
  const panel=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),id=useId(),generation=useRef(0);
  const close=()=>{setOpen(false);setTrigger(null);};
  useEffect(()=>{
    generation.current++;setCatalog({scope:'',commands:[],skills:[]});setError('');setIndex(0);
    const next=composerQuery(text,input.current===document.activeElement?input.current?.selectionStart??text.length:text.length);
    setTrigger(next);setOnlySkills(next?.skillsOnly??false);
    if(!disabled&&next)setOpen(true);
  },[scope]);
  useEffect(()=>{if(!open)return;let timer:ReturnType<typeof setTimeout>|undefined;const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>setRefreshKey(value=>value+1),60);},off=window.workbench.onExtensions?.(refresh),offState=window.workbench.onState?.(refresh);window.addEventListener('focus',refresh);window.addEventListener('local-cli-changed',refresh);return()=>{clearTimeout(timer);off?.();offState?.();window.removeEventListener('focus',refresh);window.removeEventListener('local-cli-changed',refresh);};},[open]);
  useEffect(()=>{if(disabled)close();},[disabled]);
  useEffect(()=>{if(!open)return;let live=true;const seq=++generation.current;setLoading(true);setError('');setCatalog({scope:'',commands:[],skills:[]});
    const current=()=>live&&seq===generation.current&&latestScope.current===scope;
    void api<{scope?:string;commands:ComposerCommand[];skills:ComposerSkill[]}>('composer/catalog',{sessionId,runtime,projectPath:directory,targetId,scope}).then(value=>{if(current()){if(value.scope!==undefined&&value.scope!==scope)throw Error('COMPOSER_SCOPE_CHANGED');setCatalog({...value,scope});}}).catch(e=>{if(current())setError(errorText(e));}).finally(()=>{if(current())setLoading(false);});
    return()=>{live=false;};
  },[open,scope,revision,refreshKey]);
  useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node)&&!button.current?.contains(event.target as Node)&&event.target!==input.current)close();};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
  const query=trigger?.query??'',atSkillLimit=runtime!=='claude'&&selected.length>=6;
  const ready=catalog.scope===scope&&!loading&&!error;
  const rows=ready?[...(!onlySkills?catalog.commands.filter(c=>matchesComposer(query,c.id,c.label,c.description,...(c.aliases??[]))).map(command=>({key:'command:'+command.id,command,skill:undefined as ComposerSkill|undefined})):[]),...catalog.skills.filter(s=>s.runtime===runtime&&(onlySkills||!!trigger)&&!atSkillLimit&&!selected.some(v=>v.id===s.id)&&matchesComposer(query,s.name,s.displayName,s.description)).map(skill=>({key:'skill:'+skill.id,skill,command:undefined as ComposerCommand|undefined}))]:[];
  useEffect(()=>{setIndex(0);},[query,onlySkills,rows.length]);
  useEffect(()=>{panel.current?.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});},[index]);
  const detect=(value:string,cursor:number)=>{if(disabled)return;const next=composerQuery(value,cursor);setTrigger(next);setOnlySkills(next?.skillsOnly??false);setOpen(!!next);};
  const choose=(row:typeof rows[number])=>{
    if(disabled||!ready||catalog.scope!==latestScope.current||row.command?.disabledReason)return;
    if(row.command?.action==='skills'){setOnlySkills(true);setTrigger(trigger?{...trigger,query:''}:null);setIndex(0);return;}
    const position=trigger?.start??input.current?.selectionStart??text.length;
    if(trigger)onText(text.slice(0,trigger.start)+text.slice(trigger.end));
    close();
    if(row.skill)onSkill(row.skill);else if(row.command)onAction(row.command,scope);
    if(row.skill||row.command?.action==='plan')requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(position,position);});
  };
  const keyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{
    if(event.nativeEvent.isComposing||event.keyCode===229)return false;
    if(!open)return false;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return true;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setIndex(value=>(value+(event.key==='ArrowDown'?1:-1)+Math.max(rows.length,1))%Math.max(rows.length,1));return true;}
    if((event.key==='Enter'&&!event.shiftKey)||event.key==='Tab'){if(rows[index]){event.preventDefault();choose(rows[index]!);return true;}if(event.key==='Enter'){event.preventDefault();return true;}}
    return false;
  };
  return {detect,keyDown,close,inputProps:{'aria-expanded':open,'aria-controls':open?id:undefined,'aria-activedescendant':open&&rows[index]?`${id}-${index}`:undefined},
    button:<button ref={button} type="button" className="icon-button attachment-add" data-testid="composer-add" aria-label="添加内容与工具" aria-expanded={open} disabled={disabled} onClick={()=>{setTrigger(null);setOnlySkills(false);setOpen(!open);setIndex(0);requestAnimationFrame(()=>input.current?.focus());}}><Icon name="plus" size={18}/></button>,
    menu:open&&<div ref={panel} className="composer-menu" data-testid="composer-menu" id={id} role="listbox" aria-label={onlySkills?'选择技能':'添加内容与工具'} onMouseDown={e=>e.preventDefault()}>
      <div className="composer-menu-heading">{onlySkills?(runtime==='claude'&&selected.length?'替换技能':'技能'):'命令与技能'}<span>{runtime==='claude'?'Claude Code':runtime==='codex'?'Codex':''}</span></div>
      {loading&&<p role="status">正在读取…</p>}{error&&<p role="alert">无法读取菜单，请关闭后重试。</p>}
      {rows.map((row,i)=><Fragment key={row.key}>{row.skill&&!onlySkills&&!rows[i-1]?.skill&&<div className="composer-menu-heading">技能</div>}{row.command&&(!rows[i-1]?.command||rows[i-1]?.command?.source!==row.command.source)&&<div className="composer-menu-heading">{row.command.source==='runtime'?'运行时能力':'工作台'}</div>}<button type="button" role="option" disabled={!!row.command?.disabledReason} aria-disabled={!!row.command?.disabledReason} data-command={row.command?.id} aria-selected={index===i} id={`${id}-${i}`} title={row.skill?`${row.skill.displayName}\n${row.skill.description}`:row.command?.disabledReason??row.command?.description} className={row.skill?'composer-menu-skill':''} onMouseMove={()=>setIndex(i)} onClick={()=>choose(row)} tabIndex={-1}>
        {row.skill?.icon?<img src={row.skill.icon} alt=""/>:<Icon name={row.skill?'package':row.command!.icon} size={16}/>}<span className="composer-menu-label">{row.skill?.displayName??row.command!.label}</span><span className="composer-menu-description">{row.skill?.description??row.command!.disabledReason??row.command!.description}</span>{row.command&&<small>/{row.command.id}</small>}{row.skill&&<small>{row.skill.source}</small>}
      </button></Fragment>)}{!loading&&!error&&!rows.length&&<p>{atSkillLimit?'本次最多选择 6 项技能；可先移除已选项。':`没有匹配项${onlySkills?'；可在设置中管理当前运行时的技能':''}`}</p>}
    </div>};
}
