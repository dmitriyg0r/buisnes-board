import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { initials } from './settings';

interface Props {
  name: string;
  role: string;
  onProfile: () => void;
  onSettings: () => void;
  onLogout: () => void;
}

/** Меню пользователя в шапке: профиль, настройки, выход. */
export function ProfileMenu({ name, role, onProfile, onSettings, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="pmenu" ref={root}>
      <button
        ref={button}
        type="button"
        className={`profile-btn${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Меню пользователя"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar a1">{initials(name)}</span>
        <span className="profile-text">
          <b>{name || 'Без имени'}</b>
          <small>{role}</small>
        </span>
        <Icon name={open ? 'close' : 'menu'} size={16} />
      </button>

      {open && (
        <div className="ctx-menu pmenu-list" role="menu" aria-label="Меню пользователя">
          <button type="button" role="menuitem" className="ctx-item" onClick={pick(onProfile)}>
            <Icon name="user" size={15} />
            <span>Профиль</span>
          </button>
          <button type="button" role="menuitem" className="ctx-item" onClick={pick(onSettings)}>
            <Icon name="sliders" size={15} />
            <span>Настройки</span>
          </button>
          <div className="ctx-sep" role="separator" />
          <button type="button" role="menuitem" className="ctx-item danger" onClick={pick(onLogout)}>
            <Icon name="logout" size={15} />
            <span>Выйти из аккаунта</span>
          </button>
        </div>
      )}
    </div>
  );
}
