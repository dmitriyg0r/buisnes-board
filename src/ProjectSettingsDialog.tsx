import { useCallback, useEffect, useRef, useState } from 'react';
import { HttpError } from './api';
import { Icon } from './Icon';
import { initials } from './settings';
import { disableSharing, enableSharing, getSharing, inviteUrl, removeMember, type Sharing } from './projects';

interface Props {
  project: { id: string; name: string };
  onClose: () => void;
}

/** Настройки проекта: доступ по ссылке и участники. Доступно только владельцу. */
export function ProjectSettingsDialog({ project, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [sharing, setSharing] = useState<Sharing | null>(null);
  const [link, setLink] = useState<string | null>(null); // показывается один раз: сервер хранит только хеш
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try { setSharing(await getSharing(project.id)); } catch { setError('Не удалось загрузить настройки доступа.'); }
  }, [project.id]);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    void load();
    return () => { if (element?.open) element.close(); };
  }, [load]);

  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); await load(); } catch (e) { setError(e instanceof HttpError && e.detail ? e.detail : 'Не удалось выполнить действие.'); } finally { setBusy(false); }
  };
  const enable = () => act(async () => { const { token } = await enableSharing(project.id); setLink(inviteUrl(token)); setCopied(false); });
  const disable = () => act(async () => { await disableSharing(project.id); setLink(null); });
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError('Не удалось скопировать. Выделите ссылку и скопируйте вручную.'); }
  };

  const enabled = Boolean(sharing?.enabled);
  const toggle = () => void (enabled ? disable() : enable());

  return <dialog ref={dialog} className="ws-settings ps-dialog" aria-labelledby="ps-title" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <header className="ws-settings-head">
      <div><h2 id="ps-title">Поделиться «{project.name}»</h2></div>
      <button type="button" className="ws-settings-close" aria-label="Закрыть настройки" onClick={onClose}><Icon name="close" size={18}/></button>
    </header>
    <div className="ws-settings-body">
      {error && <p className="auth-error" role="alert">{error}</p>}
      <ul className="ps-people" aria-label="Участники">
        <li><span className="ps-avatar ps-owner"><Icon name="user" size={16}/></span><span className="ps-who"><b>Вы</b><small>Владелец проекта</small></span><span className="ps-role">Владелец</span></li>
        {sharing?.members.map((m) => <li key={m.user_id}>
          <span className="ps-avatar">{initials(m.name)}</span>
          <span className="ps-who"><b>{m.name}</b><small>{m.email}</small></span>
          <span className="ps-role">Редактор</span>
          <button type="button" className="ps-remove" aria-label={`Убрать участника ${m.name}`} title="Убрать из проекта" disabled={busy} onClick={() => void act(() => removeMember(project.id, m.user_id))}><Icon name="close" size={14}/></button>
        </li>)}
        {sharing && sharing.members.length === 0 && <li className="ps-empty">Пока никто не присоединился</li>}
      </ul>
      <section className="ps-link">
        <div className="ps-link-row">
          <span className="ps-avatar ps-linkicon"><Icon name="link" size={16}/></span>
          <span className="ps-who"><b>Доступ по ссылке</b><small>{enabled ? 'Любой вошедший пользователь со ссылкой может редактировать' : 'Выключен: присоединиться по ссылке нельзя'}</small></span>
          <button type="button" role="switch" aria-checked={enabled} aria-label="Доступ по ссылке" className={`ps-switch ${enabled ? 'on' : ''}`} disabled={busy || !sharing} onClick={toggle}><span/></button>
        </div>
        {enabled && (link
          ? <div className="ps-copy"><input readOnly value={link} aria-label="Ссылка-приглашение" onFocus={(e) => e.currentTarget.select()}/><button type="button" className="btn btn-dark" onClick={() => void copy()}><Icon name="link" size={14}/>{copied ? 'Скопировано' : 'Копировать ссылку'}</button></div>
          : <p className="ps-note">Сервер хранит только хеш ссылки, поэтому показать её повторно нельзя. Нажмите «Новая ссылка», чтобы получить её: прежняя перестанет работать.</p>)}
        {enabled && <button type="button" className="btn ps-reissue" disabled={busy} onClick={() => void enable()}>Новая ссылка</button>}
      </section>
      <p className="ps-note">Редактор видит и меняет только этот проект. Удалять проект и управлять доступом может только владелец.</p>
    </div>
  </dialog>;
}
