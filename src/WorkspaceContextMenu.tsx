import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type WorkspaceMenuAction = { label: string; shortcut?: string; danger?: boolean; disabled?: boolean; run: () => void };

interface Props {
  x: number;
  y: number;
  actions: WorkspaceMenuAction[];
  onClose: () => void;
}

/** Меню находится вне прокручиваемых панелей, чтобы не обрезаться их краями. */
export function WorkspaceContextMenu({ x, y, actions, onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const rect = menu.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) });
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) closeRef.current(); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      if (!buttons.length) return;
      event.preventDefault();
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    };
    const close = () => closeRef.current();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keydown); window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true); };
  }, []);

  return createPortal(<div ref={menu} className="ws-context-menu" role="menu" aria-label="Действия с элементом" style={{ left: position.x, top: position.y }}>
    {actions.map((action) => <button type="button" role="menuitem" key={action.label} className={action.danger ? 'danger' : undefined} disabled={action.disabled} onClick={() => { closeRef.current(); action.run(); }}>
      <span>{action.label}</span>{action.shortcut && <span className="ws-context-shortcut">{action.shortcut}</span>}
    </button>)}
  </div>, document.body);
}
