import {useUiPreference} from './ui-preferences';
import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {clampPane, connectionPaneSizes, defaultConnectionPanes, paneGap} from './connection-panes';

export default function ConnectionLayout({navigation, children, files, filesOpen}: {navigation: ReactNode; children: ReactNode; files?: ReactNode; filesOpen: boolean}) {
  const element = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0), [preferred, setPreferred] = useUiPreference<typeof defaultConnectionPanes>('connections.panes');
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{pointer: number; start: number; value: number; kind: 'navigation'|'files'; element: HTMLDivElement} | null>(null);
  const sizes = connectionPaneSizes(width, filesOpen, preferred);
  const finish = () => {
    const previous = drag.current; drag.current = null; setDragging(false);
    if (previous?.element.hasPointerCapture(previous.pointer)) previous.element.releasePointerCapture(previous.pointer);
  };
  useLayoutEffect(() => {
    const node = element.current!;
    const observer = new ResizeObserver(() => {setWidth(node.clientWidth); finish();});
    setWidth(node.clientWidth); observer.observe(node); window.addEventListener('blur', finish);
    return () => {observer.disconnect(); window.removeEventListener('blur', finish);};
  }, []);
  useLayoutEffect(finish, [filesOpen]);
  const limit = (kind: 'navigation'|'files') => kind === 'navigation'
    ? {min: 140, max: sizes.sideBySide ? sizes.navigation + sizes.details - 300 : Math.min(400, width - 316), value: sizes.navigation}
    : {min: 300, max: width - sizes.navigation - 312, value: sizes.details};
  const resize = (kind: 'navigation'|'files', requested: number) => {
    const {min,max} = limit(kind), value = clampPane(requested, min, max);
    setPreferred(previous => kind === 'files' ? {...previous, details: value} : sizes.sideBySide
      ? {...previous, navigation: value, details: sizes.details + sizes.navigation - value}
      : {...previous, navigationRatio: value / width});
  };
  const separator = (kind: 'navigation'|'files') => {
    const {min,max,value} = limit(kind);
    return <div className={'connection-divider '+kind} data-testid={'connection-divider-'+kind} role="separator" tabIndex={0}
      aria-label={kind === 'navigation' ? '调整连接目录与详情宽度' : '调整详情与远端文件宽度'} aria-orientation="vertical"
      aria-valuemin={min} aria-valuemax={Math.max(min,max)} aria-valuenow={value} aria-valuetext={`${Math.round(value)} 像素`}
      title="拖动调整宽度；方向键微调，双击恢复默认"
      onPointerDown={event => {if (event.button !== 0 || !event.isPrimary) return; event.preventDefault(); event.currentTarget.focus(); drag.current = {pointer:event.pointerId,start:event.clientX,value,kind,element:event.currentTarget}; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);}}
      onPointerMove={event => {if (drag.current?.pointer === event.pointerId) resize(drag.current.kind, drag.current.value + event.clientX - drag.current.start);}}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={() => setPreferred(defaultConnectionPanes)}
      onKeyDown={event => {if (event.nativeEvent.isComposing) return; const next = event.key === 'ArrowLeft' ? value - 16 : event.key === 'ArrowRight' ? value + 16 : event.key === 'Home' ? min : event.key === 'End' ? max : undefined; if (next !== undefined) {event.preventDefault(); resize(kind,next);} if (event.key === 'Escape') finish();}}/>;
  };
  const columns = sizes.stacked ? 'minmax(0,1fr)' : sizes.sideBySide
    ? `${sizes.navigation}px ${paneGap}px ${sizes.details}px ${paneGap}px minmax(280px,1fr)`
    : `${sizes.navigation}px ${paneGap}px minmax(0,1fr)`;
  return <div ref={element} className={`connection-layout connection-panes${filesOpen?' has-remote-files':''}${sizes.stacked?' is-stacked':''}${sizes.sideBySide?' files-beside':''}${dragging?' is-resizing':''}`} style={{gridTemplateColumns:columns}}>
    {navigation}{!sizes.stacked && separator('navigation')}{children}
    {sizes.sideBySide && separator('files')}
    {files && <div className="remote-file-dock" hidden={!filesOpen}>{files}</div>}
  </div>;
}
