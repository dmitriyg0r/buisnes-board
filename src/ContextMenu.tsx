import { useEffect, useRef } from 'react';
import { Icon } from './Icon';

export type MenuTarget = { type: 'node' | 'section' | 'card' | 'canvas'; id: string };
/** Минимум от события мыши, который нужен меню: подходит и React-событию, и нативному. */
export interface MenuEvent {
  clientX: number;
  clientY: number;
  preventDefault(): void;
  stopPropagation(): void;
}
export type ContextOpener = (t: MenuTarget, ev: MenuEvent) => void;

export type MenuItem =
  | { sep: true }
  | { label: string; icon?: 'sliders' | 'pencil' | 'trash' | 'plus'; danger?: boolean; onClick: () => void };

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('wheel', onClose);
    };
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left: x, top: y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        'sep' in it ? (
          <div key={i} className="ctx-sep" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`ctx-item${it.danger ? ' danger' : ''}`}
            onClick={() => {
              onClose();
              it.onClick();
            }}
          >
            {it.icon ? <Icon name={it.icon} size={15} /> : <span className="ctx-gap" />}
            <span>{it.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
