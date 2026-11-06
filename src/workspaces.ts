import { HttpError, http } from './api';
import type { Project } from './projects';

export interface Workspace { id: string; name: string; is_default: boolean }
export interface Folder { id: string; name: string; workspace_id: string; parent_id: string | null }
export interface WorkspaceFile { id: string; name: string; workspace_id: string; folder_id: string | null; updated_at: string }
export interface LocatedProject extends Project { workspace_id: string; folder_id: string | null }
export interface Location { workspace_id: string; folder_id: string | null }

export const listWorkspaces = () => http<Workspace[]>('GET', '/workspaces');
export const createWorkspace = (name: string) => http<Workspace>('POST', '/workspaces', { name });
export const renameWorkspace = (id: string, name: string) => http<Workspace>('PATCH', `/workspaces/${id}`, { name });
export const deleteWorkspace = (id: string) => http<void>('DELETE', `/workspaces/${id}`);
export async function exportWorkspace(id: string): Promise<void> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(id)}/export`);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('bb:unauthorized'));
    let detail: string | undefined;
    try { detail = ((await response.json()) as { error?: string }).error; } catch { /* нет тела ошибки */ }
    throw new HttpError(response.status, detail ?? 'Не удалось экспортировать базу. Попробуйте ещё раз.');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `workspace-${id}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export const listFolders = (workspace: string) => http<Folder[]>('GET', `/workspaces/${workspace}/folders`);
export const listTreeFiles = (workspace: string) => http<WorkspaceFile[]>('GET', `/workspaces/${workspace}/files`);
export const createFolder = (location: Location, name: string) => http<Folder>('POST', '/folders', { workspace_id: location.workspace_id, parent_id: location.folder_id, name });
export const renameFolder = (id: string, name: string) => http<Folder>('PATCH', `/folders/${id}`, { name });
export const moveFolder = (id: string, location: Location) => http<Folder>('POST', `/folders/${id}/move`, { workspace_id: location.workspace_id, parent_id: location.folder_id });
export const deleteFolder = (id: string) => http<void>('DELETE', `/folders/${id}`);
export const listWorkspaceProjects = () => http<LocatedProject[]>('GET', '/projects');
export const createWorkspaceProject = (location: Location, name: string) => http<LocatedProject>('POST', '/projects', { ...location, name });
export const moveProject = (id: string, location: Location) => http<LocatedProject>('POST', `/projects/${id}/move`, location);
export const listFiles = (location: Location) => {
  const query = new URLSearchParams({ workspace_id: location.workspace_id });
  if (location.folder_id) query.set('folder_id', location.folder_id);
  return http<WorkspaceFile[]>('GET', `/files?${query}`);
};
export const renameFile = (id: string, name: string) => http<WorkspaceFile>('PATCH', `/files/${id}`, { name });
export const deleteFile = (id: string) => http<void>('DELETE', `/files/${id}`);
export const moveFile = (id: string, location: Location) => http<WorkspaceFile>('POST', `/files/${id}/move`, location);
export const copyFile = (id: string, location: Location) => http<WorkspaceFile>('POST', `/files/${id}/copy`, location);
export const fileDownloadUrl = (id: string) => `/api/files/${encodeURIComponent(id)}/download`;

export async function uploadFile(location: Location, file: File): Promise<void> {
  const query = new URLSearchParams({ workspace_id: location.workspace_id, name: file.name });
  if (location.folder_id) query.set('folder_id', location.folder_id);
  const response = await fetch(`/api/files?${query}`, { method: 'POST', body: file });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('bb:unauthorized'));
    let detail: string | undefined;
    try { detail = ((await response.json()) as { error?: string }).error; } catch { /* нет тела ошибки */ }
    throw new HttpError(response.status, detail);
  }
}
