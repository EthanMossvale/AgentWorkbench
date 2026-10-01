import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { Icon, Modal, errorText } from './ui';

function importError(error: unknown) {
  const message = errorText(error);
  if (/already exists|appeared during import/i.test(message)) return '已安装同名工作台插件，请选择其他 ZIP；现有插件不会被覆盖。';
  if (/missing workbench\.plugin\.json/i.test(message)) return '这个 ZIP 中没有找到 workbench.plugin.json，请选择完整的工作台插件包。';
  if (/too large|exceeds.*limits/i.test(message)) return '这个插件包过大，请缩小后重试。';
  if (/ZIP|archive|path|link|manifest|entry point/i.test(message)) return '无法读取这个插件 ZIP，请检查清单、入口和包内文件是否完整。';
  return `导入失败：${message}`;
}

export default function PluginImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (file?: File) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false), [dragging, setDragging] = useState(false), [error, setError] = useState('');
  const working = useRef(false), depth = useRef(0), active = useRef(true), id = useId();
  useEffect(() => {
    active.current = true;
    const preventNavigation = (event: globalThis.DragEvent) => { if ([...event.dataTransfer?.types ?? []].includes('Files')) event.preventDefault(); };
    window.addEventListener('dragover', preventNavigation); window.addEventListener('drop', preventNavigation);
    return () => { active.current = false; window.removeEventListener('dragover', preventNavigation); window.removeEventListener('drop', preventNavigation); };
  }, []);
  const install = async (file?: File) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { if (await onImport(file) && active.current) onClose(); }
    catch (cause) { if (active.current) setError(importError(cause)); }
    finally { working.current = false; if (active.current) setBusy(false); }
  };
  const drop = (event: DragEvent) => {
    event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false);
    if (working.current) return;
    const files = [...event.dataTransfer.files];
    if (files.length !== 1) { setError('请一次拖入一个插件 ZIP。'); return; }
    const file = files[0]!;
    if (!/\.zip$/i.test(file.name)) { setError('请选择 ZIP 格式的插件包。'); return; }
    if (file.size > 66 * 1024 * 1024) { setError('这个插件包过大，请缩小后重试。'); return; }
    void install(file);
  };
  return <Modal title="导入工作台插件" onClose={() => { if (!working.current) onClose(); }} className="skill-import-dialog plugin-import-dialog" dismissible={!busy}>
    <div aria-busy={busy}>
      <button type="button" className={`skill-dropzone${dragging ? ' is-dragging' : ''}`} data-testid="plugin-zip-dropzone" data-autofocus disabled={busy} onClick={() => void install()} onDragEnter={event => { event.preventDefault(); if (!working.current && event.dataTransfer.types.includes('Files')) { depth.current++; setDragging(true); } }} onDragLeave={event => { event.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = working.current ? 'none' : 'copy'; }} onDrop={drop} aria-describedby={`${id}-hint`}>
        <span className="skill-drop-icon"><Icon name="file-zip" size={29}/></span>
        <strong aria-live="polite">{busy ? '正在安装…' : dragging ? '松开即可安装' : '将 ZIP 拖到此处安装'}</strong>
        <span className="skill-drop-browse">{busy ? '安装到工作台' : '或点击选择文件'}</span>
      </button>
      <p id={`${id}-hint`} className="skill-import-hint">工作台插件 ZIP · 安装后默认关闭</p>
      {error && <p className="skill-import-error" role="alert">{error}</p>}
    </div>
  </Modal>;
}
