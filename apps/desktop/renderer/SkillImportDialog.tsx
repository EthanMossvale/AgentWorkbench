import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { Icon, Modal, errorText } from './ui';
import ArchivePasswordPrompt from './ArchivePasswordPrompt';
import {isArchivePasswordRequest,type ArchivePasswordRequest,type ArchiveUnlock} from '../../../packages/native-resources/archive-types';

type Provider = 'codex' | 'claude';
const providers = ['codex', 'claude'] as const;
const providerName = (provider: Provider) => provider === 'codex' ? 'Codex' : 'Claude Code';
function importError(error: unknown) {
  const message = errorText(error);
  if (/already exists|appeared during import/i.test(message)) return '此处已安装同名 Skill，请更换安装位置或选择其他 ZIP。';
  if (/missing SKILL\.md/i.test(message)) return '这个 ZIP 中没有找到 SKILL.md，请选择完整的技能包。';
  if (/ZIP|archive|path|link/i.test(message)) return '无法读取这个 ZIP：'+message;
  return `导入失败：${message}`;
}

export default function SkillImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (provider: Provider, file?: File,unlock?:ArchiveUnlock) => Promise<boolean|ArchivePasswordRequest> }) {
  const [passwordRequest,setPasswordRequest]=useState<ArchivePasswordRequest|null>(null);
  const [provider, setProvider] = useState<Provider>('codex'), [busy, setBusy] = useState(false), [dragging, setDragging] = useState(false), [error, setError] = useState('');
  const working = useRef(false), depth = useRef(0), active = useRef(true), id = useId();
  useEffect(() => {
    active.current = true;
    const preventNavigation = (event: globalThis.DragEvent) => { if ([...event.dataTransfer?.types ?? []].includes('Files')) event.preventDefault(); };
    window.addEventListener('dragover', preventNavigation); window.addEventListener('drop', preventNavigation);
    return () => { active.current = false; window.removeEventListener('dragover', preventNavigation); window.removeEventListener('drop', preventNavigation); };
  }, []);
  const install = async (file?: File,unlock?:ArchiveUnlock) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { const result=await onImport(provider,file,unlock);if(active.current){if(isArchivePasswordRequest(result))setPasswordRequest(result);else if(result)onClose();} }
    catch (cause) { if (active.current) setError(importError(cause)); }
    finally { working.current = false; if (active.current) setBusy(false); }
  };
  const drop = (event: DragEvent) => {
    event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false);
    if (working.current) return;
    const files = [...event.dataTransfer.files];
    if (files.length !== 1) { setError('请一次拖入一个 Skill ZIP。'); return; }
    const file = files[0]!;
    if (!/\.(zip(?:\.\d+)?|z\d+)$/i.test(file.name)) { setError('请选择 ZIP 格式的技能包。'); return; }
    void install(file);
  };
  return <Modal title="导入 Skill" onClose={() => { if (!working.current) onClose(); }} className="skill-import-dialog" dismissible={!busy}>
    <div className="skill-import-tabs" role="tablist" aria-label="安装到" aria-busy={busy}>{providers.map(value => <button key={value} id={`${id}-${value}`} type="button" role="tab" aria-selected={provider === value} aria-controls={`${id}-panel`} tabIndex={provider === value ? 0 : -1} disabled={busy} onClick={() => { setProvider(value); setError(''); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 'codex' : event.key === 'End' ? 'claude' : provider === 'codex' ? 'claude' : 'codex'; setProvider(next); setError(''); document.getElementById(`${id}-${next}`)?.focus();
    }}>{providerName(value)}</button>)}</div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${provider}`} aria-busy={busy}>
      {passwordRequest?<ArchivePasswordPrompt request={passwordRequest} busy={busy} onUnlock={value=>void install(undefined,value)} onCancel={()=>{setPasswordRequest(null);setError('');}}/>:<>
      <button type="button" className={`skill-dropzone${dragging ? ' is-dragging' : ''}`} data-testid="skill-zip-dropzone" data-autofocus disabled={busy} onClick={() => void install()} onDragEnter={event => { event.preventDefault(); if (!working.current && event.dataTransfer.types.includes('Files')) { depth.current++; setDragging(true); } }} onDragLeave={event => { event.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = working.current ? 'none' : 'copy'; }} onDrop={drop} aria-describedby={`${id}-hint`}>
        <span className="skill-drop-icon"><Icon name="file-zip" size={29}/></span>
        <strong aria-live="polite">{busy ? '正在安装…' : dragging ? '松开即可安装' : '将 ZIP 拖到此处安装'}</strong>
        <span className="skill-drop-browse">{busy ? `安装到 ${providerName(provider)}` : '或点击选择文件'}</span>
      </button>
      <p id={`${id}-hint`} className="skill-import-hint">ZIP 内需包含 SKILL.md · 安装到个人技能</p>
      </>}
      {error && <p className="skill-import-error" role="alert">{error}</p>}
    </div>
  </Modal>;
}
