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

export function forgetProject(id: string) {
  try {
    localStorage.removeItem(modelKey(id));
    localStorage.removeItem(viewKey(id));
  } catch {
    /* ignore */
  }
}
