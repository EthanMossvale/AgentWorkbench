import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';

export interface MenuOption { value: string; label: string; description?: string; disabled?: boolean; icon?: string }
interface Props { label: string; value: string; options: MenuOption[]; onChange: (value: string) => void; disabled?: boolean; placeholder?: string; testId: string; icon?: string; footer?: ReactNode; searchable?: boolean }

/** Compact, theme-aware selection with one keyboard focus path and a viewport-bound popup. */
export default function SelectMenu({ label, value, options, onChange, disabled, placeholder, testId, icon, footer, searchable }: Props) {
  const [open, setOpen] = useState(false);
  const [search,setSearch] = useState('');
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const id = useId(), selected = options.find(option => option.value === value);
  const visibleOptions = searchable ? options.filter(option=>option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())) : options;
  const close = (focus = false) => { setOpen(false); setSearch(''); if (focus) trigger.current?.focus(); };
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent | FocusEvent) => { const target = event.target as Node; if (!trigger.current?.contains(target) && !panel.current?.contains(target)) close(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect(), width = Math.min(284, innerWidth - 24);
      const above = rect.top - 20, below = innerHeight - rect.bottom - 20;
      const height = panel.current!.scrollHeight + 2, upward = height > below && above > below;
      const maxHeight = Math.max(80, upward ? above : below);
      setPosition({ width, left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)), top: upward ? rect.top - Math.min(height, maxHeight) - 6 : rect.bottom + 6, maxHeight });
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    (panel.current?.querySelector<HTMLInputElement>('input[type=search]') ?? panel.current?.querySelector<HTMLButtonElement>('[aria-checked=true]:not(:disabled)') ?? panel.current?.querySelector<HTMLButtonElement>('[role=menuitemradio]:not(:disabled)'))?.focus({ preventScroll: true });
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="compact-select-trigger" data-testid={testId} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key) && !event.nativeEvent.isComposing) { event.preventDefault(); setOpen(true); } }}>
      {icon && <Icon name={icon} size={14} />}<span>{selected?.label ?? placeholder ?? label}</span><Icon name="chevron-down" size={12} />
    </button>
    {open && createPortal(<div className="compact-select-menu" id={id} style={position} ref={panel} role="menu" aria-label={label} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      if (event.key === 'Tab') close(true);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (!(event.target instanceof HTMLInputElement) || ['ArrowDown','ArrowUp'].includes(event.key))) {
        event.preventDefault(); const items = [...panel.current!.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index < 0 ? (event.key==='ArrowDown'?0:items.length-1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      <div className="compact-menu-label">{label}</div>
      {searchable&&<input className="compact-menu-search" type="search" aria-label={`搜索${label}`} placeholder="搜索字体" value={search} onChange={event=>setSearch(event.target.value)}/>}
      {visibleOptions.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value} disabled={option.disabled} data-value={option.value} onClick={() => { close(true); onChange(option.value); }}>
        {option.icon && <Icon name={option.icon} size={16} />}<span>{option.label}{option.description && <small>{option.description}</small>}</span>{option.value === value && <Icon name="check" size={14} />}
      </button>)}
      {searchable&&!visibleOptions.length&&<p className="compact-menu-empty">没有匹配的字体</p>}
      {footer && <div className="compact-menu-footer" onClick={event => { if ((event.target as HTMLElement).closest('button')) close(true); }}>{footer}</div>}
    </div>, document.body)}
  </>;
}
