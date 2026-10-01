import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { PermissionMode, RuntimeKind } from '../../../packages/contracts';
import { Icon } from './ui';
import './PermissionSelector.css';

export interface PermissionSelectorProps {
  runtime: RuntimeKind;
  extension?: {name:string;permissions:import('../../../packages/runtime-extensions/types').RuntimePermission[]};
  value: PermissionMode;
  disabled?: boolean;
  pending?: boolean;
  onChange: (value: PermissionMode) => void;
}

interface PermissionOption { value: PermissionMode; label: string; description: string }
const codexOptions: readonly PermissionOption[] = [
  { value: 'default', label: '默认权限', description: '写操作需原生批准。' },
  { value: 'read-only', label: '只读', description: '禁止写入，不升级权限。' },
  { value: 'full-access', label: '完全访问', description: '关闭原生沙箱与审批限制。' },
];
const claudeOptions: readonly PermissionOption[] = [
  { value: 'default', label: '默认权限', description: '遵循原生规则，需要授权的操作会询问。' },
  { value: 'accept-edits', label: '自动批准编辑', description: '文件编辑无需逐次批准。' },
  { value: 'plan', label: '计划模式', description: '分析和规划，暂不执行修改。' },
  { value: 'full-access', label: '完全访问', description: '跳过原生权限询问。' },
];
const apiOptions:readonly PermissionOption[]=[{value:'default',label:'默认权限',description:'文件编辑和命令需要批准。'},{value:'read-only',label:'只读',description:'仅文件读取、目录浏览和协作。'},{value:'full-access',label:'自动批准编辑',description:'同所有者文件编辑自动批准，命令仍逐次确认。'}];
const runtimeNames: Record<RuntimeKind, string> = { codex: 'Codex', claude: 'Claude', demo: '离线示例', api:'模型 API' };

export default function PermissionSelector({ runtime, extension, value, disabled = false, pending = false, onChange }: PermissionSelectorProps) {
  const options = extension?.permissions ?? (runtime === 'api' ? apiOptions : runtime === 'claude' ? claudeOptions : codexOptions);
  const selected = options.find(option => option.value === value) ?? options[0]!;
  const selectedIndex = options.indexOf(selected);
  const blocked = disabled || pending;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const initialFocus = useRef(selectedIndex);
  const menuId = useId();

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const openMenu = (index = selectedIndex) => {
    if (blocked) return;
    initialFocus.current = index;
    setActiveIndex(index);
    setPosition(null);
    setOpen(true);
  };

  useEffect(() => { setOpen(false); }, [runtime, blocked]);
  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) => target instanceof Node
      && !rootRef.current?.contains(target) && !menuRef.current?.contains(target);
    const onPointerDown = (event: PointerEvent) => { if (outside(event.target)) setOpen(false); };
    const onFocus = (event: FocusEvent) => { if (outside(event.target)) setOpen(false); };
    const onWindowBlur = () => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocus);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || blocked) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      if (!rect.width || !rect.height) { closeMenu(); return; }
      const margin = 12, gap = 7;
      const width = Math.min(280, window.innerWidth - margin * 2);
      const above = Math.max(0, rect.top - margin - gap);
      const below = Math.max(0, window.innerHeight - rect.bottom - margin - gap);
      const height = menu.scrollHeight + 2;
      const placeAbove = above >= height || above >= below;
      const maxHeight = Math.max(0, placeAbove ? above : below);
      setPosition({
        width,
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
        top: placeAbove ? rect.top - gap - Math.min(height, maxHeight) : rect.bottom + gap,
        maxHeight,
      });
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (menuRef.current) observer.observe(menuRef.current);
    if (triggerRef.current) observer.observe(triggerRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, blocked, runtime]);

  const positioned = position !== null;
  useLayoutEffect(() => {
    if (open && positioned && !blocked) optionRefs.current[initialFocus.current]?.focus({ preventScroll: true });
  }, [open, positioned, blocked]);

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (event.key === 'Tab') {
      // Return to the trigger before the browser advances to its next tab stop.
      closeMenu(true);
      return;
    }
    const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : direction ? (activeIndex + direction + options.length) % options.length : null;
    if (next !== null) {
      event.preventDefault();
      setActiveIndex(next);
      optionRefs.current[next]?.focus();
    }
  };

  return <div className="permission-selector" data-permission-selector data-runtime={runtime} ref={rootRef}>
    <button
      ref={triggerRef}
      type="button"
      className="permission-selector-trigger"
      data-testid="composer-permission"
      disabled={blocked}
      aria-label={`权限：${selected.label}`}
      aria-haspopup="menu"
      aria-expanded={open && !blocked}
      aria-controls={open && !blocked ? menuId : undefined}
      aria-busy={pending || undefined}
      onClick={() => open ? closeMenu() : openMenu()}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          openMenu(event.key === 'ArrowUp' ? options.length - 1 : selectedIndex);
        } else if (event.key === 'Escape' && open) {
          event.preventDefault();
          closeMenu(true);
        }
      }}
    >
      <Icon name="shield" size={13} />
      <span>{selected.label}</span>
      <span className="permission-selector-chevron"><Icon name="chevron" size={10} /></span>
    </button>
    {open && !blocked && createPortal(<div
      ref={menuRef}
      id={menuId}
      className="permission-selector-menu"
      role="menu"
      aria-label={`${(extension?.name??runtimeNames[runtime]??runtime)} 权限`}
      data-testid="permission-menu"
      style={position ?? { visibility: 'hidden' }}
      onKeyDown={navigate}
    >
      <div className="permission-selector-heading">{(extension?.name??runtimeNames[runtime]??runtime)} 权限</div>
      {options.map((option, index) => <button
        key={option.value}
        ref={element => { optionRefs.current[index] = element; }}
        type="button"
        role="menuitemradio"
        aria-checked={value === option.value}
        tabIndex={index === activeIndex ? 0 : -1}
        className="permission-selector-option"
        data-testid={`permission-option-${option.value}`}
        onFocus={() => setActiveIndex(index)}
        onClick={() => {
          closeMenu(true);
          if (option.value !== value) onChange(option.value);
        }}
      >
        <span className="permission-selector-copy"><strong>{option.label}</strong><small>{runtime === 'demo' ? '仅保存选择；离线示例不执行工具。' : option.description}</small></span>
        <span className="permission-selector-check">{value === option.value && <Icon name="check" size={15} />}</span>
      </button>)}

    </div>, document.body)}
  </div>;
}
