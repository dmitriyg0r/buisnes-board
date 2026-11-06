import { useState } from 'react';
import { HttpError } from './api';
import { login, register, type User } from './auth';
import { roles } from './settings';

interface Props {
  onAuth: (u: User) => void;
  /** сервер не ответил при проверке сессии */
  offline: boolean;
}

export function AuthScreen({ onAuth, offline }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState(roles[0]);
  const [error, setError] = useState<string | null>(offline ? 'Нет связи с сервером. Проверьте, что бэкенд запущен.' : null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = mode === 'login' ? await login(email, password) : await register({ email, password, name, role });
      onAuth(u);
    } catch (err) {
      setError(err instanceof HttpError && err.detail ? err.detail : 'Нет связи с сервером. Проверьте, что бэкенд запущен.');
      setBusy(false);
    }
  };

  const reg = mode === 'register';

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="brand auth-brand">
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

        <h1>{reg ? 'Создайте аккаунт' : 'Войдите в проект'}</h1>
        <p className="auth-sub">{reg ? 'Модель, регламент и замечания будут храниться в вашем аккаунте.' : 'Работа с моделью и замечаниями доступна после входа.'}</p>

        {reg && (
          <label className="auth-field">
            <span>Имя</span>
            <input className="pinput" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </label>
        )}
        <label className="auth-field">
          <span>Почта</span>
          <input className="pinput" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
        </label>
        <label className="auth-field">
          <span>Пароль</span>
          <input
            className="pinput"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={reg ? 'new-password' : 'current-password'}
            placeholder={reg ? 'не короче 8 символов' : undefined}
            required
          />
        </label>
        {reg && (
          <label className="auth-field">
            <span>Роль</span>
            <select className="pinput" value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        )}

        {error && <div className="auth-error" role="alert">{error}</div>}

        <button type="submit" className="btn btn-dark auth-submit" disabled={busy || !email || !password || (reg && !name.trim())}>
          {busy ? 'Подождите…' : reg ? 'Создать аккаунт' : 'Войти'}
        </button>

        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode(reg ? 'login' : 'register');
            setError(null);
          }}
        >
          {reg ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
        </button>
      </form>
    </main>
  );
}
