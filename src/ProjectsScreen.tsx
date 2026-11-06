import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HttpError } from './api';
import type { User } from './auth';
import { Icon } from './Icon';
import { deleteProject, forgetProject, patchProject, type Project } from './projects';
import { initials } from './settings';
import * as api from './workspaces';
import { WorkspaceGrid } from './WorkspaceGrid';
import { ProjectThumbnail } from './ProjectThumbnail';
import { WorkspaceContextMenu } from './WorkspaceContextMenu';
import { WorkspaceSettingsDialog } from './WorkspaceSettingsDialog';
import { searchTree } from './treeSearch';

interface Props { user: User; onOpen: (p: Project) => void; onLogout: () => void }
type Item = { kind: 'folder'; data: api.Folder } | { kind: 'project'; data: api.LocatedProject } | { kind: 'file'; data: api.WorkspaceFile };
type Clipboard = { item: Item; mode: 'copy' | 'cut' };

export function ProjectsScreen({ user, onOpen, onLogout }: Props) {
  const [workspaces, setWorkspaces] = useState<api.Workspace[]>([]);
  const [folders, setFolders] = useState<api.Folder[]>([]);
  const [projects, setProjects] = useState<api.LocatedProject[]>([]);
  const [files, setFiles] = useState<api.WorkspaceFile[]>([]);
  const [treeFiles, setTreeFiles] = useState<api.WorkspaceFile[]>([]);
  const [location, setLocation] = useState<api.Location | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [menu, setMenu] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [baseMenu, setBaseMenu] = useState<{ workspace: api.Workspace; x: number; y: number } | null>(null);
  const [backgroundMenu, setBackgroundMenu] = useState<{ destination: api.Location; x: number; y: number } | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<api.Location | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const search = useMemo(() => searchTree(query, workspaces, folders, projects, treeFiles), [query, workspaces, folders, projects, treeFiles]);
  const refresh = useCallback(async () => {
    const [w, p] = await Promise.all([api.listWorkspaces(), api.listWorkspaceProjects()]);
    const [folderLists, fileLists] = await Promise.all([
      Promise.all(w.map((base) => api.listFolders(base.id))),
      Promise.all(w.map((base) => api.listTreeFiles(base.id))),
    ]);
    const d = folderLists.flat();
    setWorkspaces(w); setFolders(d); setProjects(p); setTreeFiles(fileLists.flat());
    setLocation((current) => {
      const workspace = w.find((x) => x.id === current?.workspace_id) ?? w.find((x) => x.is_default) ?? w[0];
      if (!workspace) return null;
      return { workspace_id: workspace.id, folder_id: current?.workspace_id === workspace.id && d.some((x) => x.id === current.folder_id && x.workspace_id === workspace.id) ? current.folder_id : null };
    });
  }, []);
  useEffect(() => { void refresh().catch(() => setError('Не удалось загрузить базы. Проверьте подключение и попробуйте снова.')).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => {
    if (!location) { setFiles([]); return; }
    let cancelled = false;
    setFiles([]);
    void api.listFiles(location).then((f) => { if (!cancelled) setFiles(f); }).catch(() => { if (!cancelled) setError('Не удалось загрузить файлы. Повторите загрузку.'); });
    return () => { cancelled = true; };
  }, [location?.workspace_id, location?.folder_id, revision]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return false;
    setBusy(true); setError(null);
    try { await action(); await refresh(); setRevision((r) => r + 1); return true; } catch (e) { setError(e instanceof HttpError && e.detail ? e.detail : 'Не удалось выполнить действие. Попробуйте ещё раз.'); return false; } finally { setBusy(false); }
  };
  const choose = (workspace_id: string, folder_id: string | null) => { setLocation({ workspace_id, folder_id }); setSelected(null); setMenu(null); };
  const named = (title: string, initial = '') => window.prompt(title, initial)?.trim() || null;
  const workspace = workspaces.find((w) => w.id === location?.workspace_id);
  const settingsWorkspace = workspaces.find((w) => w.id === settingsId);
  const openBaseSettings = (id: string) => { setError(null); setSettingsId(id); };
  const currentFolder = folders.find((f) => f.id === location?.folder_id);
  const items: Item[] = location ? [
    ...folders.filter((f) => f.workspace_id === location.workspace_id && f.parent_id === location.folder_id).map((data): Item => ({ kind: 'folder', data })),
    ...projects.filter((p) => p.workspace_id === location.workspace_id && p.folder_id === location.folder_id).map((data): Item => ({ kind: 'project', data })),
    ...files.filter((f) => f.workspace_id === location.workspace_id && f.folder_id === location.folder_id).map((data): Item => ({ kind: 'file', data })),
  ] : [];
  const ancestors: api.Folder[] = [];
  let cursor = currentFolder;
  while (cursor && !ancestors.some((f) => f.id === cursor?.id)) { ancestors.unshift(cursor); cursor = folders.find((f) => f.id === cursor?.parent_id); }
  const createBase = () => { const name = named('Название базы'); if (name) void run(async () => { const w = await api.createWorkspace(name); choose(w.id, null); }); };
  const createFolder = (destination: api.Location | null = location) => { if (!destination) return; const name = named('Название папки'); if (name) void run(async () => { await api.createFolder(destination, name); const parentId = destination.folder_id; if (parentId) setCollapsed((old) => { const next = new Set(old); next.delete(parentId); return next; }); }); };
  const createProject = (destination: api.Location | null = location) => { if (!destination) return; const name = named('Название проекта'); if (name) void run(async () => { onOpen(await api.createWorkspaceProject(destination, name)); }); };
  const uploadTo = (destination: api.Location | null = location) => { if (!destination) return; uploadTarget.current = destination; upload.current?.click(); };
  const rename = (item: Item) => {
    const name = named('Новое название', item.data.name); if (!name || name === item.data.name) return;
    void run(async () => { if (item.kind === 'folder') await api.renameFolder(item.data.id, name); else if (item.kind === 'project') await patchProject(item.data.id, { name }); else await api.renameFile(item.data.id, name); setSelected(null); });
  };
  const remove = (item: Item) => {
    const detail = item.kind === 'folder' ? ' Папка и всё её содержимое будут удалены.' : item.kind === 'project' ? ' Все данные проекта будут удалены.' : '';
    if (!window.confirm(`Удалить «${item.data.name}»?${detail}`)) return;
    void run(async () => { if (item.kind === 'folder') await api.deleteFolder(item.data.id); else if (item.kind === 'project') { await deleteProject(item.data.id); forgetProject(item.data.id); } else await api.deleteFile(item.data.id); setSelected(null); setClipboard((c) => c?.item.data.id === item.data.id ? null : c); });
  };
  const paste = (destination: api.Location | null = location) => {
    if (!clipboard || !destination) return;
    const { item, mode } = clipboard;
    if (item.kind === 'folder') {
      let parent = destination.folder_id;
      while (parent) { if (parent === item.data.id) { setError('Нельзя переместить папку внутрь неё самой.'); return; } parent = folders.find((f) => f.id === parent)?.parent_id ?? null; }
    }
    void run(async () => { if (item.kind === 'folder') await api.moveFolder(item.data.id, destination); else if (item.kind === 'project') await api.moveProject(item.data.id, destination); else if (mode === 'copy') await api.copyFile(item.data.id, destination); else await api.moveFile(item.data.id, destination); if (mode === 'cut') setClipboard(null); });
  };
  const creationActions = (destination: api.Location) => [
    { label: 'Создать проект', disabled: busy, run: () => createProject(destination) },
    { label: 'Создать папку', disabled: busy, run: () => createFolder(destination) },
    { label: 'Загрузить файл', disabled: busy, run: () => uploadTo(destination) },
    ...(clipboard ? [{ label: 'Вставить', disabled: busy, run: () => paste(destination) }] : []),
  ];
  const openBackgroundMenu = (destination: api.Location, x: number, y: number) => { setSelected(null); setMenu(null); setBaseMenu(null); setBackgroundMenu({ destination, x, y }); };
  const moveTo = (item: Item, destination: api.Location) => {
    if (busy || !location) return;
    if (location.workspace_id === destination.workspace_id && location.folder_id === destination.folder_id) return;
    if (item.kind === 'folder') {
      let parent = destination.folder_id;
      while (parent) { if (parent === item.data.id) { setError('Нельзя переместить папку внутрь неё самой.'); return; } parent = folders.find((f) => f.id === parent)?.parent_id ?? null; }
    }
    void run(async () => {
      if (item.kind === 'folder') await api.moveFolder(item.data.id, destination);
      else if (item.kind === 'project') await api.moveProject(item.data.id, destination);
      else await api.moveFile(item.data.id, destination);
      setSelected(null);
      setClipboard((old) => old?.item.kind === item.kind && old.item.data.id === item.data.id ? null : old);
    });
  };
  const openItem = (item: Item) => { if (item.kind === 'folder') choose(item.data.workspace_id, item.data.id); else if (item.kind === 'project') onOpen(item.data); else window.location.assign(api.fileDownloadUrl(item.data.id)); };
  const selectTreeFile = (file: api.WorkspaceFile) => {
    choose(file.workspace_id, file.folder_id);
    setSelected({ kind: 'file', data: file });
  };
  const selectTreeProject = (project: api.LocatedProject) => {
    choose(project.workspace_id, project.folder_id);
    setSelected({ kind: 'project', data: project });
  };
  const renderTreeProjects = (workspaceId: string, folderId: string | null, depth: number) => projects
    .filter((project) => project.workspace_id === workspaceId && project.folder_id === folderId && (!search.active || search.projectIds.has(project.id)))
    .map((project) => <div key={project.id} className="ws-tree-row ws-tree-project-row" style={{ paddingLeft: 34 + depth * 16 }}>
      <button type="button" className={`ws-tree-file ws-tree-project ${selected?.kind === 'project' && selected.data.id === project.id ? 'active' : ''}`}
        title={project.name} onClick={() => selectTreeProject(project)} onDoubleClick={() => onOpen(project)}
        onContextMenu={(event) => { event.preventDefault(); selectTreeProject(project); setMenu({ item: { kind: 'project', data: project }, x: event.clientX, y: event.clientY }); }}
        onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); selectTreeProject(project); setMenu({ item: { kind: 'project', data: project }, x: rect.left, y: rect.bottom }); } }}>
        <Icon name="model" size={15}/><span>{project.name}</span>
      </button>
    </div>);
  const renderTreeFiles = (workspaceId: string, folderId: string | null, depth: number) => treeFiles
    .filter((file) => file.workspace_id === workspaceId && file.folder_id === folderId && (!search.active || search.fileIds.has(file.id)))
    .map((file) => <div key={file.id} className="ws-tree-row ws-tree-file-row" style={{ paddingLeft: 34 + depth * 16 }}>
      <button type="button" className={`ws-tree-file ${selected?.kind === 'file' && selected.data.id === file.id ? 'active' : ''}`}
        title={file.name} onClick={() => selectTreeFile(file)} onDoubleClick={() => openItem({ kind: 'file', data: file })}
        onContextMenu={(event) => { event.preventDefault(); selectTreeFile(file); setMenu({ item: { kind: 'file', data: file }, x: event.clientX, y: event.clientY }); }}
        onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); selectTreeFile(file); setMenu({ item: { kind: 'file', data: file }, x: rect.left, y: rect.bottom }); } }}>
        <Icon name="file" size={15}/><span>{file.name}</span>
      </button>
    </div>);
  const treeFolders = (workspaceId: string, parentId: string | null, depth: number, seen: Set<string>): React.ReactNode => folders.filter((f) => f.workspace_id === workspaceId && f.parent_id === parentId && !seen.has(f.id) && (!search.active || search.folderIds.has(f.id))).map((folder) => {
    const closed = !search.active && collapsed.has(folder.id); const children = folders.some((f) => f.parent_id === folder.id && f.workspace_id === workspaceId && (!search.active || search.folderIds.has(f.id))) || treeFiles.some((f) => f.folder_id === folder.id && f.workspace_id === workspaceId && (!search.active || search.fileIds.has(f.id))) || projects.some((p) => p.folder_id === folder.id && p.workspace_id === workspaceId && (!search.active || search.projectIds.has(p.id)));
    return <div key={folder.id}><div className="ws-tree-row" style={{ paddingLeft: 12 + depth * 16 }}>
      {children ? <button className="ws-expander" type="button" aria-label={`${closed ? 'Развернуть' : 'Свернуть'} папку ${folder.name}`} aria-expanded={!closed} disabled={search.active} title={search.active ? 'Результаты поиска раскрыты' : undefined} onClick={() => setCollapsed((old) => { const next = new Set(old); if (closed) next.delete(folder.id); else next.add(folder.id); return next; })}><Icon name={closed ? 'chevronRight' : 'chevronDown'} size={14}/></button> : <span className="ws-expander"/>}
      <button type="button" className={`ws-tree-button ${location?.folder_id === folder.id ? 'active' : ''}`} data-workspace-drop data-workspace-id={workspaceId} data-folder-id={folder.id} aria-current={location?.folder_id === folder.id ? 'location' : undefined} onClick={() => choose(workspaceId, folder.id)} onContextMenu={(event) => { event.preventDefault(); setBaseMenu(null); setBackgroundMenu(null); setMenu({ item: { kind: 'folder', data: folder }, x: event.clientX, y: event.clientY }); }} onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setBaseMenu(null); setBackgroundMenu(null); setMenu({ item: { kind: 'folder', data: folder }, x: rect.left, y: rect.bottom }); } }}><Icon name="folder" size={15}/><span>{folder.name}</span></button></div>
      {!closed && <>{treeFolders(workspaceId, folder.id, depth + 1, new Set([...seen, folder.id]))}{renderTreeProjects(workspaceId, folder.id, depth + 1)}{renderTreeFiles(workspaceId, folder.id, depth + 1)}</>}</div>;
  });
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, dialog, [role="menu"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'v' && clipboard) { e.preventDefault(); paste(); }
    else if (selected && mod && e.key.toLowerCase() === 'c' && selected.kind === 'file') { e.preventDefault(); setClipboard({ item: selected, mode: 'copy' }); }
    else if (selected && mod && e.key.toLowerCase() === 'x') { e.preventDefault(); setClipboard({ item: selected, mode: 'cut' }); }
    else if (selected && e.key === 'F2') { e.preventDefault(); rename(selected); }
    else if (selected && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); remove(selected); }
  };
  return <div className="app plain" onKeyDown={onKeyDown}>
    <header className="topbar"><div className="brand"><div className="brand-mark"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="#fff"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2" opacity=".6"/><rect x="3" y="13" width="8" height="8" rx="2" opacity=".6"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg></div><span className="brand-name">buisnes board</span></div><div className="grow"/><div className="profile-btn static"><span className="avatar a1">{initials(user.name)}</span><span className="profile-text"><b>{user.name}</b><small>{user.role}</small></span></div><button type="button" className="btn" onClick={onLogout}>Выйти</button></header>
    <main className="ws-browser"><aside className="ws-sidebar" aria-label="Дерево баз и папок"><div className="ws-sidebar-head"><strong>Базы</strong><button type="button" className="btn" onClick={createBase} disabled={busy}>Новая база</button></div>
      <div className="ws-tree-search"><Icon name="search" size={16}/><input ref={searchInput} type="search" aria-label="Поиск по базам, папкам, проектам и файлам" placeholder="Поиск по базам и файлам" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); setQuery(''); } }}/>{query && <button type="button" aria-label="Очистить поиск" onClick={() => { setQuery(''); searchInput.current?.focus(); }}><Icon name="close" size={14}/></button>}</div>
      {search.active && !search.workspaceIds.size && !loading && <p className="ws-tree-search-empty" role="status">Ничего не найдено</p>}
      {workspaces.filter((w) => !search.active || search.workspaceIds.has(w.id)).map((w) => <div key={w.id} className="ws-tree-base"><button type="button" className={`ws-base-button ${location?.workspace_id === w.id && !location.folder_id ? 'active' : ''}`} data-workspace-drop data-workspace-id={w.id} data-folder-id="" aria-current={location?.workspace_id === w.id && !location.folder_id ? 'location' : undefined} onClick={() => choose(w.id, null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null); setBackgroundMenu(null); setBaseMenu({ workspace: w, x: event.clientX, y: event.clientY }); }} onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu(null); setBackgroundMenu(null); setBaseMenu({ workspace: w, x: rect.left, y: rect.bottom }); } }}>{w.name}</button>{treeFolders(w.id, null, 0, new Set())}{renderTreeProjects(w.id, null, 0)}{renderTreeFiles(w.id, null, 0)}</div>)}</aside>
    <section className="ws-content" aria-label="Содержимое базы" tabIndex={0} onContextMenu={(event) => { const target = event.target as Element; if (!location || event.defaultPrevented || target.closest('button, input, textarea, select, a, .ws-toolbar, .ws-breadcrumbs, .ws-heading, .ws-clipboard, .auth-error')) return; event.preventDefault(); openBackgroundMenu(location, event.clientX, event.clientY); }} onKeyDown={(event) => { if (event.target !== event.currentTarget || !location || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); openBackgroundMenu(location, rect.left + 16, rect.top + 16); }}>
      {error && <div className="auth-error" role="alert">{error} <button type="button" onClick={() => void run(async () => {})}>Повторить загрузку</button></div>}
      {loading ? <p>Загрузка…</p> : !workspace ? <div className="ws-empty"><b>Нет баз</b><span>Создайте базу для проектов и файлов.</span><button type="button" className="btn btn-dark" onClick={createBase}>Создать базу</button></div> : <>
      <nav className="ws-breadcrumbs" aria-label="Путь"><button type="button" data-workspace-drop data-workspace-id={workspace.id} data-folder-id="" aria-label={`Корень базы «${workspace.name}»`} onClick={() => choose(workspace.id, null)}>/</button>{ancestors.map((f, index) => <span key={f.id}>{index > 0 && <span aria-hidden="true"> / </span>}<button type="button" data-workspace-drop data-workspace-id={workspace.id} data-folder-id={f.id} onClick={() => choose(workspace.id, f.id)}>{f.name}</button></span>)}</nav>
      <div className="ws-heading"><h1>{currentFolder?.name ?? workspace.name}</h1></div>
      <WorkspaceGrid
        key={`${user.id}:${location?.workspace_id}:${location?.folder_id ?? 'root'}`}
        storageKey={`bb.workspace-layout.v1.${user.id}.${location?.workspace_id}.${location?.folder_id ?? 'root'}`}
        selected={selected ? `${selected.kind}:${selected.data.id}` : null}
        toolbar={<><button type="button" className="btn btn-dark" onClick={() => createProject()} disabled={busy} title="Создать проект"><Icon name="plus" size={16}/>Создать</button><button type="button" className="btn" onClick={() => createFolder()} disabled={busy}>Создать папку</button><button type="button" className="btn" onClick={() => uploadTo()} disabled={busy}>Загрузить файл</button><input ref={upload} type="file" multiple hidden onChange={(e) => { const chosen = Array.from(e.target.files ?? []); const destination = uploadTarget.current; uploadTarget.current = null; e.target.value = ''; if (destination && chosen.length) void run(async () => { for (const file of chosen) await api.uploadFile(destination, file); }); }}/>{clipboard && <button type="button" className="btn" onClick={() => paste()} disabled={busy}>Вставить</button>}</>}
        toolbarEnd={<button type="button" className="ws-settings-trigger" aria-label="Настройки базы" title="Настройки базы" onClick={() => openBaseSettings(workspace.id)}><Icon name="settings" size={19}/></button>}
        notice={clipboard && <p className="ws-clipboard" role="status">{clipboard.mode === 'copy' ? 'Скопирован' : 'Вырезан'}: {clipboard.item.data.name}. Выберите папку и нажмите «Вставить». <button type="button" onClick={() => setClipboard(null)}>Отменить</button></p>}
        items={items.map((item) => ({
          key: `${item.kind}:${item.data.id}`,
          label: item.data.name,
          target: item.kind === 'folder' ? { workspaceId: item.data.workspace_id, folderId: item.data.id } : undefined,
          visual: item.kind === 'folder' ? <svg className="ws-folder-icon" viewBox="0 0 80 64" aria-hidden="true"><path d="M5 13a5 5 0 0 1 5-5h18l6 6h36a5 5 0 0 1 5 5v31a6 6 0 0 1-6 6H11a6 6 0 0 1-6-6z" fill="#80aacc"/><path d="M5 24a5 5 0 0 1 5-5h60a5 5 0 0 1 5 5v26a6 6 0 0 1-6 6H11a6 6 0 0 1-6-6z" fill="#a7cbe6" stroke="#719dbf" strokeWidth="1.5"/></svg> : item.kind === 'project' ? <span className="ws-project-preview"><ProjectThumbnail projectId={item.data.id}/></span> : <span className="ws-generic-icon"><Icon name="file" size={30}/></span>,
        }))}
        onSelect={(key) => { const item = items.find((entry) => `${entry.kind}:${entry.data.id}` === key); if (item) setSelected(item); }}
        onOpen={(key) => { const item = items.find((entry) => `${entry.kind}:${entry.data.id}` === key); if (item) openItem(item); }}
        onContextMenu={(key, x, y) => { const item = items.find((entry) => `${entry.kind}:${entry.data.id}` === key); if (item) { setSelected(item); setMenu({ item, x, y }); } }}
        onMove={(key, workspaceId, folderId) => { const item = items.find((entry) => `${entry.kind}:${entry.data.id}` === key); if (item) moveTo(item, { workspace_id: workspaceId, folder_id: folderId }); }}
      />
      </>}
    </section></main>
    {menu && <WorkspaceContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} actions={[
      { label: menu.item.kind === 'file' ? 'Скачать' : 'Открыть', run: () => openItem(menu.item) },
      ...(menu.item.kind === 'folder' ? creationActions({ workspace_id: menu.item.data.workspace_id, folder_id: menu.item.data.id }) : []),
      { label: 'Переименовать', shortcut: 'F2', disabled: busy, run: () => rename(menu.item) },
      ...(menu.item.kind === 'file' ? [{ label: 'Копировать', shortcut: 'Ctrl/⌘ C', disabled: busy, run: () => setClipboard({ item: menu.item, mode: 'copy' as const }) }] : []),
      { label: 'Вырезать', shortcut: 'Ctrl/⌘ X', disabled: busy, run: () => setClipboard({ item: menu.item, mode: 'cut' }) },
      { label: 'Удалить', shortcut: 'Delete', danger: true, disabled: busy, run: () => remove(menu.item) },
    ]} />}
    {baseMenu && <WorkspaceContextMenu x={baseMenu.x} y={baseMenu.y} onClose={() => setBaseMenu(null)} actions={[
      { label: 'Открыть базу', run: () => choose(baseMenu.workspace.id, null) },
      ...creationActions({ workspace_id: baseMenu.workspace.id, folder_id: null }),
      { label: 'Настройки базы', run: () => openBaseSettings(baseMenu.workspace.id) },
    ]} />}
    {backgroundMenu && <WorkspaceContextMenu x={backgroundMenu.x} y={backgroundMenu.y} onClose={() => setBackgroundMenu(null)} actions={creationActions(backgroundMenu.destination)} />}
    {settingsWorkspace && <WorkspaceSettingsDialog key={settingsWorkspace.id} workspace={settingsWorkspace} busy={busy} error={error} onClose={() => { setSettingsId(null); setError(null); }} onRename={(name) => run(async () => { await api.renameWorkspace(settingsWorkspace.id, name); })} onDelete={() => run(async () => { await api.deleteWorkspace(settingsWorkspace.id); })} onExport={() => void run(async () => { await api.exportWorkspace(settingsWorkspace.id); })}/>}
  </div>;
}
