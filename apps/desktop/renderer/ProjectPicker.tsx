import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '../../../packages/contracts';
import { Icon } from './ui';
import './ProjectPicker.css';

interface Props {
  projects: Project[];
  projectId: string | null;
  disabled: boolean;
  onChange: (projectId: string | null) => void;
  onCreate: () => void;
}

export default function ProjectPicker({ projects, projectId, disabled, onChange, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const popupId = useId();
  const project = projects.find(item => item.id === projectId);
  const label = project?.name ?? '选择项目';
  const filtered = projects.filter(item => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus(); };
  const contains = (node: Node | null) => !!node && (!!root.current?.contains(node) || !!popup.current?.contains(node));
  const choose = (id: string | null) => { onChange(id); close(true); };

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    setQuery(''); search.current?.focus();
    const outside = (event: PointerEvent) => { if (!contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect(); if (!rect || !popup.current) return;
      const above = rect.top - 16, below = window.innerHeight - rect.bottom - 16;
      const upward = above >= below;
      const height = Math.max(160, upward ? above : below);
      const width = Math.min(272, window.innerWidth - 24);
      Object.assign(popup.current.style, { width: `${width}px`, left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`, top: upward ? 'auto' : `${rect.bottom + 7}px`, bottom: upward ? `${window.innerHeight - rect.top + 7}px` : 'auto' });
      popup.current.style.setProperty('--project-picker-height', `${height}px`);
    };
    position(); window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab') { close(true); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]') ?? []).filter(item => !item.disabled);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return <div className="project-picker" ref={root} onKeyDown={keys} onBlur={event => { if (!contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button type="button" className="composer-context-button project-picker-trigger" ref={trigger} data-testid="composer-project" aria-label="选择项目" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? popupId : undefined} disabled={disabled} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setOpen(true); } }}>
      <Icon name="folder" size={15} /><span>{label}</span><Icon name="chevron-down" size={12} />
    </button>
    {open && createPortal(<div className="project-picker-popover" ref={popup} id={popupId} data-testid="project-picker">
      <label className="project-picker-search"><Icon name="search" size={15} /><input ref={search} data-testid="project-search" aria-label="搜索项目" placeholder="搜索项目" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div role="menu" aria-label="选择或新建项目" className="project-picker-items">
        <button type="button" role="menuitemradio" aria-checked={!projectId} data-testid="project-option-none" className="project-picker-item" onClick={() => choose(null)}><Icon name="chat" size={15} /><span>不关联项目</span>{!projectId && <Icon name="check" size={14} />}</button>
        {filtered.map(item => <button key={item.id} type="button" role="menuitemradio" aria-checked={projectId === item.id} data-testid={`project-option-${item.id}`} className="project-picker-item" onClick={() => choose(item.id)}><Icon name="folder" size={15} /><span>{item.name}</span>{projectId === item.id && <Icon name="check" size={14} />}</button>)}
        {query.trim() && !filtered.length && <p className="project-picker-empty">没有匹配的项目</p>}
      </div>
      <div className="project-picker-actions" role="menu" aria-label="创建项目">
        <button type="button" role="menuitem" className="project-picker-item" data-testid="project-picker-create" onClick={() => { close(true); onCreate(); }}><Icon name="plus" size={15} /><span>新建项目…</span></button>
      </div>
    </div>, document.body)}
  </div>;
}
