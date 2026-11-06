import { http, HttpError } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

/** Текущий пользователь или null, если не вошли. Другие ошибки (нет связи) пробрасываются. */
export async function fetchMe(): Promise<User | null> {
  try {
    return await http<User>('GET', '/auth/me');
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) return null;
    throw e;
  }
}

export const login = (email: string, password: string) => http<User>('POST', '/auth/login', { email, password });
export const register = (b: { email: string; password: string; name: string; role: string }) => http<User>('POST', '/auth/register', b);
export const logout = () => http<void>('POST', '/auth/logout');
export const updateMe = (p: { name?: string; role?: string }) => http<User>('PATCH', '/auth/me', p);

/* Локальные копии модели, настроек и вида принадлежат одному пользователю браузера:
   при смене пользователя и при выходе они стираются, чтобы данные не попали в чужой аккаунт. */
export function clearLocalCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('bb.'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function adoptOwner(userId: string) {
  try {
    const prev = localStorage.getItem('bb.owner');
    if (prev && prev !== userId) clearLocalCache();
    localStorage.setItem('bb.owner', userId);
  } catch {
    /* ignore */
  }
}
