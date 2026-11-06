import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

interface Props {
  title: string;
  description?: string;
  label?: string;
  initialValue?: string;
  maxLength?: number;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (value: string) => Promise<boolean>;
}

export function WorkspaceActionDialog({ title, description, label, initialValue = '', maxLength = 200, confirmLabel, danger, busy, error, onClose, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const input = element?.querySelector<HTMLInputElement>('input');
    if (input) { input.focus(); input.select(); }
    else element?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    return () => { if (element?.open) element.close(); };
  }, []);

  const close = () => { if (!busy) onClose(); };
  return <dialog ref={dialog} className="ws-action-dialog" aria-labelledby="ws-action-title" aria-describedby={description ? 'ws-action-description' : undefined} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <form onSubmit={(event) => { event.preventDefault(); const trimmed = value.trim(); if (busy || (label && !trimmed)) return; void onConfirm(trimmed).then((ok) => { if (ok) onClose(); }); }}>
      <header className="ws-action-head">
        <h2 id="ws-action-title">{title}</h2>
        <button type="button" className="ws-settings-close" aria-label="Закрыть" disabled={busy} onClick={close}><Icon name="close" size={18}/></button>
      </header>
      <div className="ws-action-body">
        {description && <p id="ws-action-description">{description}</p>}
        {label && <label className="ws-action-field"><span>{label}</span><input value={value} onChange={(event) => setValue(event.target.value)} maxLength={maxLength} required disabled={busy}/></label>}
        {error && <p className="auth-error" role="alert">{error}</p>}
      </div>
      <footer className="ws-action-foot">
        <button type="button" className="btn" data-cancel onClick={close} disabled={busy}>Отмена</button>
        <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-dark'}`} disabled={busy || Boolean(label && !value.trim())}>{confirmLabel}</button>
      </footer>
    </form>
  </dialog>;
}
