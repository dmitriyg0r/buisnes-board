import type { Folder, LocatedProject, Workspace, WorkspaceFile } from './workspaces';

/** Подбирает совпадения и сохраняет путь к ним в дереве. */
export function searchTree(query: string, workspaces: Workspace[], folders: Folder[], projects: LocatedProject[], files: WorkspaceFile[]) {
  const term = query.trim().toLocaleLowerCase('ru-RU');
  const matches = (name: string) => name.toLocaleLowerCase('ru-RU').includes(term);
  const workspaceIds = new Set<string>();
  const folderIds = new Set<string>();
  const projectIds = new Set<string>();
  const fileIds = new Set<string>();
  if (!term) return { active: false, workspaceIds, folderIds, projectIds, fileIds };
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  const matchedWorkspaces = new Set(workspaces.filter((workspace) => matches(workspace.name)).map((workspace) => workspace.id));
  const matchedFolders = new Set(folders.filter((folder) => matches(folder.name)).map((folder) => folder.id));

  const ancestors = (id: string | null) => {
    const result: string[] = [];
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const folder = folderMap.get(id);
      if (!folder) break;
      result.push(id);
      id = folder.parent_id;
    }
    return result;
  };
  const includeAncestors = (workspaceId: string, parentId: string | null) => {
    workspaceIds.add(workspaceId);
    ancestors(parentId).forEach((id) => folderIds.add(id));
  };
  const inMatchedBranch = (workspaceId: string, folderId: string | null) =>
    matchedWorkspaces.has(workspaceId) || ancestors(folderId).some((id) => matchedFolders.has(id));

  for (const workspace of workspaces) if (matchedWorkspaces.has(workspace.id)) workspaceIds.add(workspace.id);
  for (const folder of folders) {
    if (matchedFolders.has(folder.id) || inMatchedBranch(folder.workspace_id, folder.parent_id)) {
      folderIds.add(folder.id);
      includeAncestors(folder.workspace_id, folder.parent_id);
    }
  }
  for (const project of projects) {
    if (matches(project.name) || inMatchedBranch(project.workspace_id, project.folder_id)) {
      projectIds.add(project.id);
      includeAncestors(project.workspace_id, project.folder_id);
    }
  }
  for (const file of files) {
    if (matches(file.name) || inMatchedBranch(file.workspace_id, file.folder_id)) {
      fileIds.add(file.id);
      includeAncestors(file.workspace_id, file.folder_id);
    }
  }
  return { active: Boolean(term), workspaceIds, folderIds, projectIds, fileIds };
}
