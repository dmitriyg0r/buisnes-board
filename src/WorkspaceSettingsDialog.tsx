import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { Workspace } from './workspaces';

interface Props {
  workspace: Workspace;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onExport: () => void;
}

export function WorkspaceSettingsDialog({ workspace, busy, error, onClose, onRename, onDelete, onExport }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(workspace.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const changed = name.trim() !== workspace.name;

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);

  return <dialog ref={dialog} className="ws-settings" aria-labelledby="ws-settings-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <header className="ws-settings-head">
      <div><h2 id="ws-settings-title">Настройки базы</h2><p>{workspace.name}</p></div>
      <button type="button" className="ws-settings-close" aria-label="Закрыть настройки" onClick={onClose}><Icon name="close" size={18}/></button>
    </header>
    <div className="ws-settings-body">
      {error && <p className="auth-error" role="alert">{error}</p>}
      <form className="ws-settings-section" onSubmit={(event) => { event.preventDefault(); const value = name.trim(); if (value && changed) void onRename(value).then((ok) => { if (ok) setName(value); }); }}>
        <label htmlFor="ws-settings-name">Название базы</label>
        <div className="ws-settings-name"><input id="ws-settings-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required autoFocus/><button type="submit" className="btn btn-dark" disabled={busy || !name.trim() || !changed}>Сохранить</button></div>
      </form>
      <section className="ws-settings-section">
        <h3>Экспорт</h3><p>Скачать базу в формате JSON вместе с папками, проектами и содержимым файлов. Файлы внутри экспорта закодированы; импорт пока не поддерживается.</p>
        <button type="button" className="btn" disabled={busy} onClick={onExport}>Экспортировать базу</button>
      </section>
      <section className="ws-settings-section ws-settings-danger">
        <h3>Удаление базы</h3>
        <p>{workspace.is_default ? 'Основную базу удалить нельзя.' : 'База и всё её содержимое будут удалены без возможности восстановления.'}</p>
        {confirmDelete ? <div className="ws-settings-confirm"><button type="button" className="btn btn-danger" disabled={busy} onClick={() => void onDelete().then((ok) => { if (ok) onClose(); })}>Удалить навсегда</button><button type="button" className="btn" disabled={busy} onClick={() => setConfirmDelete(false)}>Отмена</button></div> : <button type="button" className="btn btn-danger" disabled={busy || workspace.is_default} onClick={() => setConfirmDelete(true)}>Удалить базу</button>}
      </section>
    </div>
  </dialog>;
}
