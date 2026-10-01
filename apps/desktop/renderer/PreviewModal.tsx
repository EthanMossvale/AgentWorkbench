import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from './ui';
import './PreviewModal.css';
import { previewController, previewEnter } from './preview-controller';

function contentSize(content: readonly string[]) {
  // Approximate rendered width, including wide characters and explicit line breaks.
  let units = 0;
  for (const text of content) for (const character of text) {
    units += character === '\n' ? 36 : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character) ? 2 : 1;
    if (units > 1800) return 'long';
  }
  return units > 500 ? 'medium' : 'short';
}

export default function PreviewModal({ id, kind, onConfirm, confirmDisabled = false, busy = false, title, subtitle, className = '', content, onClose, children, actions }: {
  id: string; kind: 'draft' | 'answer'; onConfirm: () => void; confirmDisabled?: boolean; busy?: boolean;
  title: string; subtitle?: string; className?: string; content: readonly string[];
  onClose: () => void; children: ReactNode; actions: ReactNode;
}) {
  useEffect(() => previewController.register({view:{id,kind,title,content,canConfirm:!confirmDisabled,canEdit:!busy},confirm:onConfirm,edit:onClose}), [id,kind,title,content,confirmDisabled,busy,onConfirm,onClose]);
  return createPortal(<div data-workbench-preview={kind} onKeyDownCapture={event => {
    const intent = previewEnter({...event, isComposing:event.nativeEvent.isComposing, keyCode:event.keyCode});
    if (!intent) return;
    event.preventDefault(); event.stopPropagation();
    if (intent === 'confirm' && !confirmDisabled) { try { previewController.confirm(id); } catch { /* Stale or already submitted. */ } }
  }}><Modal title={title} subtitle={subtitle} onClose={onClose} dismissible={!busy} className={`preview-modal preview-${contentSize(content)} ${className}`}>
    <div className="preview-modal-body">{children}</div>
    <footer className="preview-modal-actions">{actions}</footer>
  </Modal></div>, document.body);
}
