import { http } from './api';

export interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export const listProjects = () => http<Project[]>('GET', '/projects');
export const createProject = (name: string) => http<Project>('POST', '/projects', { name });
export const patchProject = (id: string, p: { name?: string }) => http<Project>('PATCH', `/projects/${id}`, p);
export const deleteProject = (id: string) => http<void>('DELETE', `/projects/${id}`);

/** Локальные копии проекта хранятся по его id. */
export const modelKey = (id: string) => `bb.model.v2.${id}`;
export const viewKey = (id: string) => `bb.view.v1.${id}`;

// Выбор принадлежит вкладке и аккаунту: соседние вкладки могут открыть другие проекты.
const ACTIVE_PROJECT_KEY = 'bb.active-project.v1';

export function activeProjectId(userId: string): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(ACTIVE_PROJECT_KEY) ?? 'null');
    return saved?.userId === userId && typeof saved.projectId === 'string' ? saved.projectId : null;
  } catch {
    return null;
  }
}

export function rememberActiveProject(userId: string, projectId: string) {
  try {
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, JSON.stringify({ userId, projectId }));
  } catch {
    /* хранилище может быть недоступно */
  }
}

export function clearActiveProject() {
  try { sessionStorage.removeItem(ACTIVE_PROJECT_KEY); } catch { /* хранилище недоступно */ }
}

export function forgetProject(id: string) {
  try {
    localStorage.removeItem(modelKey(id));
    localStorage.removeItem(viewKey(id));
  } catch {
    /* ignore */
  }
}

/* ----- общий доступ ----- */
export interface SharedProject extends Project { owner_name: string }
export interface Member { user_id: string; name: string; email: string; role: string; joined_at: string }
export interface Sharing { enabled: boolean; members: Member[] }

export const getProject = (id: string) => http<Project>('GET', `/projects/${id}`);
export const listSharedProjects = () => http<SharedProject[]>('GET', '/projects/shared');
export const getSharing = (id: string) => http<Sharing>('GET', `/projects/${id}/sharing`);
/** Включает доступ или перевыпускает ссылку; токен возвращается один раз. */
export const enableSharing = (id: string) => http<{ token: string }>('POST', `/projects/${id}/sharing/link`);
export const disableSharing = (id: string) => http<void>('DELETE', `/projects/${id}/sharing/link`);
export const removeMember = (id: string, userId: string) => http<void>('DELETE', `/projects/${id}/members/${userId}`);
export const joinProject = (token: string) => http<{ project_id: string; name: string }>('POST', '/invites/join', { token });
export const inviteUrl = (token: string) => `${window.location.origin}/join/${token}`;

/* Токен из ссылки хранится только до входа и присоединения. Ключ без префикса bb., чтобы его не стирала смена пользователя. */
const JOIN_KEY = 'join.pending';
export function captureJoinToken(): string | null {
  try {
    const m = window.location.pathname.match(/^\/join\/([A-Za-z0-9_-]{8,128})\/?$/);
    if (m) {
      sessionStorage.setItem(JOIN_KEY, m[1]);
      window.history.replaceState(null, '', '/');
    }
    return sessionStorage.getItem(JOIN_KEY);
  } catch {
    return null;
  }
}
export function clearJoinToken() {
  try { sessionStorage.removeItem(JOIN_KEY); } catch { /* ignore */ }
}
