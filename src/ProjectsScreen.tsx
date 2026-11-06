import { useEffect, useRef, useState } from 'react';
import { HttpError } from './api';
import type { User } from './auth';
import { Icon } from './Icon';
import { createProject, deleteProject, forgetProject, listProjects, type Project } from './projects';
import { initials } from './settings';

interface Props {
  user: User;
  onOpen: (p: Project) => void;
  onLogout: () => void;
}

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function ProjectsScreen({ user, onOpen, onLogout }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let dead = false;
    listProjects()
      .then((p) => !dead && setProjects(p))
      .catch(() => !dead && setError('Не удалось загрузить проекты. Проверьте, что бэкенд запущен.'));
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    if (creating) input.current?.focus();
  }, [creating]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    try {
      onOpen(await createProject(n));
    } catch (err) {
      setError(err instanceof HttpError && err.detail ? err.detail : 'Не удалось создать проект');
      setBusy(false);
    }
  };

  const remove = async (p: Project) => {
    try {
      await deleteProject(p.id);
      forgetProject(p.id);
      setProjects((list) => (list ?? []).filter((x) => x.id !== p.id));
    } catch {
      setError('Не удалось удалить проект');
    }
    setConfirm(null);
  };

  return (
    <div className="app plain">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="#fff">
              <rect x="3" y="3" width="8" height="8" rx="2" />
              <rect x="13" y="3" width="8" height="8" rx="2" opacity=".6" />
              <rect x="3" y="13" width="8" height="8" rx="2" opacity=".6" />
              <rect x="13" y="13" width="8" height="8" rx="2" />
            </svg>
          </div>
          <span className="brand-name">buisnes board</span>
        </div>
        <div className="grow" />
        <div className="profile-btn static">
          <span className="avatar a1">{initials(user.name)}</span>
          <span className="profile-text">
            <b>{user.name}</b>
            <small>{user.role}</small>
          </span>
        </div>
        <button type="button" className="btn" onClick={onLogout}>Выйти</button>
      </header>

      <main className="projects">
        <div className="projects-head">
          <div>
            <h1>Проекты</h1>
            <p>{projects === null ? 'Загрузка…' : projects.length ? `Всего: ${projects.length}` : 'Здесь появятся ваши проекты'}</p>
          </div>
          {!creating && (
            <button type="button" className="btn btn-dark create-btn" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} stroke={2.4} />
              Создать проект
            </button>
          )}
        </div>

        {creating && (
          <form className="create-form" onSubmit={create}>
            <label>
              <span>Название проекта</span>
              <input ref={input} className="pinput" value={name} onChange={(e) => setName(e.target.value)} placeholder="Название проекта" maxLength={200} />
            </label>
            <div className="pactions">
              <button type="submit" className="btn btn-dark" disabled={busy || !name.trim()}>{busy ? 'Создаём…' : 'Создать'}</button>
              <button type="button" className="btn" disabled={busy} onClick={() => { setCreating(false); setName(''); }}>Отмена</button>
            </div>
          </form>
        )}

        {error && <div className="auth-error" role="alert">{error}</div>}

        {projects && projects.length === 0 && !creating && (
          <div className="projects-empty">
            <b>У вас пока нет проектов</b>
            <span>Создайте первый: в нём будут модель процесса, регламент и замечания.</span>
            <button type="button" className="btn btn-dark" onClick={() => setCreating(true)}>Создать проект</button>
          </div>
        )}

        {projects && projects.length > 0 && (
          <ul className="pgrid">
            {projects.map((p) => (
              <li key={p.id} className="pcard">
                <button type="button" className="pcard-open" onClick={() => onOpen(p)}>
                  <span className="pcard-icon"><Icon name="model" size={20} /></span>
                  <b>{p.name}</b>
                  <small>Изменён {fmt(p.updated_at)}</small>
                </button>
                {confirm === p.id ? (
                  <div className="pcard-confirm">
                    <span>Удалить проект и все его данные?</span>
                    <button type="button" className="btn btn-danger" onClick={() => void remove(p)}>Да, удалить</button>
                    <button type="button" className="btn" onClick={() => setConfirm(null)}>Отмена</button>
                  </div>
                ) : (
                  <button type="button" className="icon-btn pcard-del" aria-label={`Удалить проект «${p.name}»`} onClick={() => setConfirm(p.id)}>
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
