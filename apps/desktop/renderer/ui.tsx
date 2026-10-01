import { useEffect, useRef, type ReactNode } from 'react';
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 5 5 3-3 4 4"/></>,
    layers: <><path d="m3 7 9-4 9 4-9 4ZM3 12l9 4 9-4M3 17l9 4 9-4"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    package: <><path d="m12 3 7 4v10l-7 4-7-4V7ZM5 7l7 4 7-4M12 11v10M8.5 5l7 4v4"/></>,
    'file-zip': <><path d="M14 3H5v18h14V8ZM14 3v5h5M10 3v2m0 2v2m0 2v2"/><rect x="8.5" y="15" width="3" height="3" rx=".5"/></>,
    export: <><path d="M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></>,
    plus: <path d="M12 5v14M5 12h14" />,
    branch: <><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10M18 7v2a5 5 0 0 1-5 5H6"/></>,
    compose: <><path d="M13 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8" /><path d="m16 3 5 5M10 14l-1 5 5-1L22 6a2.1 2.1 0 0 0-3-3Z" /></>,
    'chevron-down': <path d="m6 9 6 6 6-6" />,
    alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 3v1" /></>,
    unread: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></>,
    trash: <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></>,
    document: <><path d="M14 3H5v18h14V8ZM14 3v6h5M8 13h8m-8 4h6" /></>,
    desktop: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    split: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" /></>,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
    chat: <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 3-2Z" />,
    folder: <path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3Z" />,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
    link: <><path d="M9 15l6-6M8 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 7l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(0 -1) scale(.95)" /></>,
    shield: <><path d="M12 3l8 3v6c0 5-8 9-8 9S4 17 4 12V6Z" /><path d="m8 12 3 3 5-6" /></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    arrow: <><path d="M12 19V5m-6 6 6-6 6 6" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>,
    edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-4-4L5 15Z"/></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    archive: <><path d="M4 8v12h16V8M2 3h20v5H2Z" /><path d="M9 12h6" /></>,
    pin: <><path d="m9 3 9 3-3 6 2 4-7-2-4 2 2-7ZM8 16l-5 5" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    terminal: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3m6 0h4" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
    sparkle: <path d="m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6Z" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.chat}</svg>;
}
export function Modal({ title, children, onClose, subtitle, className = '', dismissible = true }: { title: string; children: ReactNode; onClose: () => void; subtitle?: string; className?: string; dismissible?: boolean }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ((panel.current?.querySelector('[data-autofocus]') ?? panel.current?.querySelector('input,select,textarea,button')) as HTMLElement | null)?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => { if (!dismissible) panel.current?.focus(); }, [dismissible]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); if (dismissible) onClose(); } }}><section ref={panel} tabIndex={-1} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); if (dismissible) onClose(); }
    if (e.key === 'Tab') {
      const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]:not([disabled])') ?? []);
      if (!elements.length) { e.preventDefault(); return; }
      const first = elements[0], last = elements[elements.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }}><header className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="关闭窗口" disabled={!dismissible} onClick={onClose}><Icon name="close" /></button></header>{children}</section></div>;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string }) {
  return <label className="toggle-row"><span><strong>{label}</strong>{description && <small>{description}</small>}</span><input type="checkbox" aria-label={label} checked={checked} onChange={e => onChange(e.target.checked)} /><i aria-hidden="true" /></label>;
}
export {Mark} from './BrandMark';
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
