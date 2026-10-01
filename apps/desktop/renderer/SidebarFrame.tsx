import {useUiPreference} from './ui-preferences';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { sidebarMaxWidth, sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_RAIL_WIDTH, type SidebarLayout } from './sidebar-layout';
import './SidebarFrame.css';

export function useSidebarLayout() {
  const [width,setWidth]=useUiPreference<number>('sidebar.width'),[compact,setCompact]=useUiPreference<boolean>('sidebar.compact');
  return {layout:{width,compact},setWidth,setCompact};
}

export default function SidebarFrame({ layout, onWidth, hidden, children }: {
  layout: SidebarLayout; onWidth: (width: number) => void; hidden: boolean; children: ReactNode;
}) {
  const [viewport, setViewport] = useState(window.innerWidth);
  const [dragging, setDragging] = useState(false);
  const divider = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; width: number; previous: number } | null>(null);
  const width = sidebarWidth(layout.width, viewport);
  const finish = () => {
    const pointerId = drag.current?.pointerId;
    drag.current = null;
    setDragging(false);
    if (pointerId !== undefined && divider.current?.hasPointerCapture(pointerId)) divider.current.releasePointerCapture(pointerId);
  };
  useEffect(() => {
    const resize = () => { setViewport(window.innerWidth); finish(); };
    window.addEventListener('resize', resize);
    window.addEventListener('blur', finish);
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('blur', finish); };
  }, []);
  useEffect(() => { if (layout.compact || hidden) finish(); }, [layout.compact, hidden]);

  return <div id="conversation-sidebar" className={`sidebar-slot${layout.compact ? ' is-compact' : ''}${dragging ? ' is-resizing' : ''}`} hidden={hidden} style={{ width: layout.compact ? SIDEBAR_RAIL_WIDTH : width }}>
    {children}
    {!layout.compact && <div ref={divider} className="sidebar-resize-handle" data-testid="sidebar-divider" role="separator" tabIndex={0}
      aria-label="侧栏宽度" aria-orientation="vertical" aria-controls="conversation-sidebar"
      aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuemax={sidebarMaxWidth(viewport)} aria-valuenow={width} aria-valuetext={`${width} 像素`}
      title="拖动调整侧栏宽度；双击恢复最小宽度"
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.currentTarget.focus();
        drag.current = { pointerId: event.pointerId, startX: event.clientX, width, previous: layout.width };
        event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
      }}
      onPointerMove={event => {
        if (drag.current?.pointerId === event.pointerId) onWidth(sidebarWidth(drag.current.width + event.clientX - drag.current.startX, window.innerWidth));
      }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={() => onWidth(SIDEBAR_MIN_WIDTH)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape' && drag.current) { event.preventDefault(); onWidth(drag.current.previous); finish(); return; }
        const step = event.shiftKey ? 32 : 16;
        const next = event.key === 'ArrowLeft' ? width - step : event.key === 'ArrowRight' ? width + step : event.key === 'Home' ? SIDEBAR_MIN_WIDTH : event.key === 'End' ? sidebarMaxWidth(viewport) : undefined;
        if (next !== undefined) { event.preventDefault(); onWidth(sidebarWidth(next, viewport)); }
      }} />}
  </div>;
}
