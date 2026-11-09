import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { blankXml } from './bpmn';
import { emptyModel, NO_ISSUE, type IssueStatus } from './data';
import { reconcileSections, sectionTitles, starterMarkdown } from './markdown';
import { autoIssues, coverage } from './coverage';
import { Tree } from './Tree';
import { Canvas } from './Canvas';
import { IssuePanel } from './IssuePanel';
import { Icon } from './Icon';
import { useModel } from './useModel';
import { initials, useSettings } from './settings';
import { SettingsDialog, type SettingsTab } from './SettingsDialog';
import { ProfileMenu } from './ProfileMenu';
import { useSync, type SyncState } from './sync';
import { adoptOwner, clearLocalCache, fetchMe, logout, updateMe, type User } from './auth';
import { AuthScreen } from './AuthScreen';
import { AddMaterialDialog } from './AddMaterialDialog';
import { ProjectsScreen } from './ProjectsScreen';
import { captureJoinToken, clearJoinToken, getProject, joinProject, patchProject, viewKey, type Project } from './projects';
import { HttpError } from './api';
import { usePresence } from './presence';
import { useIssues, type IssueFields } from './useIssues';

const DiagramModelEditor = lazy(() => import('./DiagramModelEditor'));
const DocEditorDialog = lazy(() => import('./DocEditorDialog'));

const rid = (p: string) => p + Math.random().toString(36).slice(2, 8);

const syncLabel: Record<SyncState, string> = {
  connecting: 'Подключение…',
  saving: 'Сохранение…',
  saved: 'Сохранено на сервере',
  offline: 'Нет связи с сервером',
  conflict: 'Обновлено с сервера',
  revoked: 'Доступ закрыт',
};
const syncHint: Record<SyncState, string> = {
  connecting: 'Подключаемся к бэкенду',
  saving: 'Изменения отправляются на сервер',
  saved: 'Последняя версия модели лежит в PostgreSQL',
  offline: 'Работаем локально, изменения отправятся при следующей попытке',
  conflict: 'Модель была изменена другим участником, правки объединены',
  revoked: 'Владелец закрыл вам доступ к проекту или удалил проект',
};

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined — идёт проверка сессии
  const [project, setProject] = useState<Project | null>(null);
  const [offline, setOffline] = useState(false);
  // токен из ссылки-приглашения: ждёт входа, затем присоединяет к проекту
  const [joinToken, setJoinToken] = useState<string | null>(() => captureJoinToken());
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    fetchMe()
      .then((u) => {
        if (u) adoptOwner(u.id);
        setUser(u);
      })
      .catch(() => {
        setOffline(true);
        setUser(null);
      });
    const out = () => {
      setProject(null);
      setUser(null);
    };
    window.addEventListener('bb:unauthorized', out);
    return () => window.removeEventListener('bb:unauthorized', out);
  }, []);

  useEffect(() => {
    if (!user || !joinToken) return;
    let dead = false;
    (async () => {
      try {
        const j = await joinProject(joinToken);
        const p = await getProject(j.project_id);
        if (dead) return;
        clearJoinToken();
        setJoinToken(null);
        setProject(p);
      } catch (e) {
        if (dead) return;
        if (e instanceof HttpError && e.status === 401) return; // сессия истекла: токен остаётся до нового входа
        clearJoinToken();
        setJoinToken(null);
        setJoinError(e instanceof HttpError && e.status === 429 ? 'Слишком много попыток. Попробуйте позже.' : 'Ссылка недействительна или доступ по ней отключён. Попросите владельца прислать новую.');
      }
    })();
    return () => { dead = true; };
  }, [user, joinToken]);

  const signOut = async () => {
    try {
      await logout();
    } catch {
      /* сессия всё равно будет забыта локально */
    }
    clearLocalCache();
    setProject(null);
    setUser(null);
  };

  if (user === undefined) return <div className="boot" role="status">Загрузка…</div>;
  if (!user) {
    return (
      <AuthScreen
        offline={offline}
        onAuth={(u) => {
          adoptOwner(u.id);
          setOffline(false);
          setUser(u);
        }}
      />
    );
  }
  if (joinToken) return <div className="boot" role="status">Присоединяемся к проекту…</div>;
  if (!project) return <>{joinError && <div className="auth-error" role="alert" style={{ margin: 12 }}>{joinError} <button type="button" onClick={() => setJoinError(null)}>Закрыть</button></div>}<ProjectsScreen key={user.id} user={user} onOpen={setProject} onLogout={signOut} /></>;
  return <Workspace key={project.id} user={user} project={project} onUser={setUser} onProject={setProject} onBack={() => setProject(null)} onLogout={signOut} />;
}

function Workspace({
  user,
  project,
  onUser,
  onProject,
  onBack,
  onLogout,
}: {
  user: User;
  project: Project;
  onUser: (u: User) => void;
  onProject: (p: Project) => void;
  onBack: () => void;
  onLogout: () => void;
}) {
  const api = useModel(project.id);
  const [stored, patch] = useSettings();
  // имя и роль принадлежат аккаунту, название — проекту, остальное — браузеру
  const settings = useMemo(
    () => ({ ...stored, name: user.name, role: user.role, projectName: project.name }),
    [stored, user.name, user.role, project.name],
  );
  const projectTimer = useRef<ReturnType<typeof setTimeout>>();
  const profileTimer = useRef<ReturnType<typeof setTimeout>>();
  const patchSettings = (p: Partial<typeof settings>) => {
    const { name, role, projectName, ...rest } = p;
    if (projectName !== undefined) {
      const next = { ...project, name: projectName };
      onProject(next);
      clearTimeout(projectTimer.current);
      projectTimer.current = setTimeout(
        () => void patchProject(project.id, { name: next.name.trim() || 'Без названия' }).catch(() => undefined),
        500,
      );
    }
    if (name !== undefined || role !== undefined) {
      const next = { ...user, ...(name !== undefined ? { name } : {}), ...(role !== undefined ? { role } : {}) };
      onUser(next);
      clearTimeout(profileTimer.current);
      profileTimer.current = setTimeout(() => void updateMe({ name: next.name, role: next.role }).catch(() => undefined), 500);
    }
    if (Object.keys(rest).length) patch(rest);
  };
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  /** выделенные на полотне карточки: подсвечиваются и в дереве слева */
  const [selCards, setSelCards] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  // что сейчас открыто в редакторе: модель или документ
  const [editing, setEditing] = useState<{ type: 'process' | 'doc'; id: string } | null>(null);
  // свёрнутые боковые панели запоминаются в браузере
  const [layout, setLayout] = useState<{ tree: boolean; panel: boolean }>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('bb.layout.v2') ?? '{}') as { tree?: boolean; panel?: boolean };
      return { tree: v.tree !== false, panel: v.panel !== false };
    } catch {
      return { tree: true, panel: true };
    }
  });
  const toggleSide = (side: 'tree' | 'panel') =>
    setLayout((l) => {
      const next = { ...l, [side]: !l[side] };
      try {
        localStorage.setItem('bb.layout.v2', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  const sync = useSync(api, settings, patch, project.id);
  const presence = usePresence(project.id);
  const online = presence.peers.filter((p) => Date.now() - p.seen < 12_000);
  const store = useIssues(project.id);
  const [selectedId, setSelectedId] = useState('i1');

  const auto = useMemo(() => autoIssues(api.model), [api.model]);
  const issues = useMemo(
    () => [...store.manual, ...auto.map((i) => ({ ...i, ...store.autoState[i.id], id: i.id }))],
    [store.manual, store.autoState, auto],
  );
  const cover = useMemo(() => coverage(api.model), [api.model]);

  const found = issues.findIndex((i) => i.id === selectedId);
  const index = found < 0 ? 0 : found;
  const selected = issues[index] ?? NO_ISSUE;

  useEffect(() => {
    document.title = `buisnes board — ${settings.projectName}`;
  }, [settings.projectName]);

  const step = (delta: number) => {
    if (!issues.length) return;
    const next = (index + delta + issues.length) % issues.length;
    setSelectedId(issues[next].id);
  };

  const selectCanvasIssue = (id: string) => { setSelectedId(id); if (!layout.panel) toggleSide('panel'); };
  const transition = (id: string, status: IssueStatus, fields?: IssueFields) => {
    const issue = issues.find((i) => i.id === id);
    if (issue) store.update(issue, status, fields);
  };

  return (
    <div className="app">
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
        <div className="sep" />
        <div className="crumbs">
          <button type="button" className="crumb-link" onClick={onBack}>Проекты</button>
          <Icon name="chevronRight" size={14} />
          <strong>{settings.projectName || 'Без названия'}</strong>
        </div>
        <span className={`chip ${sync === 'offline' || sync === 'conflict' ? 'chip-amber' : 'chip-neutral'}`} title={syncHint[sync]} role="status">
          <Icon name={sync === 'saved' ? 'check' : 'sparkle'} size={13} stroke={2.2} />
          {syncLabel[sync]}
        </span>
        <div className="grow" />
        {online.length > 0 && <div className="peer-avatars" aria-label="Сейчас на доске">{online.map((p) => <span key={p.id} className="peer-avatar" style={{ background: p.color }} title={p.name}>{initials(p.name)}</span>)}</div>}
        <ProfileMenu
          name={settings.name}
          role={settings.role}
          onProfile={() => setSettingsTab('profile')}
          onSettings={() => setSettingsTab('project')}
          onLogout={onLogout}
        />
      </header>

      {sync === 'revoked' && <div className="auth-error" role="alert" style={{ margin: 12 }}>Доступ к проекту закрыт: владелец отозвал его или удалил проект. Ваши последние правки не сохранены. <button type="button" onClick={onBack}>К списку проектов</button></div>}
      <div className="workspace" style={{ gridTemplateColumns: `${layout.tree ? 232 : 44}px minmax(0, 1fr) ${layout.panel ? 300 : 44}px` }}>
        <Tree
          activeSourceId={selected.basis?.sourceId}
          sources={api.model.sources}
          docs={api.model.docs}
          processes={api.model.processes}
          selectedCards={selCards}
          onAddMaterial={() => setAddOpen(true)}
          collapsed={!layout.tree}
          onToggle={() => toggleSide('tree')}
        />
        <Canvas issues={issues} issue={selected} onSelect={selectCanvasIssue} api={api} settings={settings} onModel={(aiModel) => patchSettings({ aiModel })} projectId={project.id}
          selCards={selCards}
          onSelCards={setSelCards}
          onAddMaterial={() => setAddOpen(true)}
          onEditProcess={(id) => setEditing({ type: 'process', id })}
          onEditDoc={(id) => setEditing({ type: 'doc', id })}
          paused={editing !== null || addOpen || settingsTab !== null}
          presence={presence}
        />
        <IssuePanel
          issues={issues}
          cover={cover}
          onSelect={setSelectedId}
          issue={issues.length ? selected : null}
          index={index}
          total={issues.length}
          onStep={step}
          onTransition={transition}
          collapsed={!layout.panel}
          onToggle={() => toggleSide('panel')}
          openCount={issues.filter((i) => i.status !== 'fixed' && i.status !== 'closed').length}
        />
      </div>

      {editing?.type === 'process' && api.model.processes.find((p) => p.id === editing.id) && (
        <Suspense fallback={<div className="bpmn-editor boot" role="status">Загрузка редактора…</div>}>
          <DiagramModelEditor
            key={editing.id}
            title={api.model.processes.find((p) => p.id === editing.id)!.title}
            xml={api.model.processes.find((p) => p.id === editing.id)!.xml}
            processId={editing.id}
            links={api.model.links}
            onClose={() => setEditing(null)}
            onSave={(title, xml, removeLinkIds) => {
              const pid = editing.id;
              const removeIds = new Set(removeLinkIds);
              api.apply((m) => {
                return {
                  ...m,
                  processes: m.processes.map((p) => (p.id === pid ? { ...p, title, xml } : p)),
                  links: m.links.filter((link) => !removeIds.has(link.id)),
                };
              });
              setEditing(null);
            }}
          />
        </Suspense>
      )}

      {editing?.type === 'doc' && api.model.docs.find((d) => d.id === editing.id) && (
        <Suspense fallback={<div className="doc-editor boot" role="status">Загрузка редактора…</div>}>
          <DocEditorDialog
            key={editing.id}
            title={api.model.docs.find((d) => d.id === editing.id)!.title}
            markdown={api.model.docs.find((d) => d.id === editing.id)!.markdown}
            onClose={() => setEditing(null)}
            onSave={(title, markdown) => {
              const did = editing.id;
              api.apply((m) => {
                const old = m.docs.find((d) => d.id === did);
                const sections = reconcileSections(old?.sections ?? [], sectionTitles(markdown));
                const keep = new Set(sections.map((s) => s.id));
                const gone = new Set((old?.sections ?? []).filter((s) => !keep.has(s.id)).map((s) => s.id));
                return {
                  ...m,
                  docs: m.docs.map((d) => (d.id === did ? { ...d, title, markdown, sections } : d)),
                  // связи с пунктами, которых больше нет в тексте, удаляются
                  links: m.links.filter((l) => !gone.has(l.sectionId)),
                };
              });
              setEditing(null);
            }}
          />
        </Suspense>
      )}

      {addOpen && (
        <AddMaterialDialog
          counts={{ processes: api.model.processes.length, docs: api.model.docs.length }}
          onAddModel={(title) => {
            const id = rid('p');
            api.apply((m) => ({ ...m, processes: [...m.processes, { id, title, xml: blankXml(title) }] }));
            setEditing({ type: 'process', id });
          }}
          onClose={() => setAddOpen(false)}
          onAddDoc={(title) => {
            const id = rid('d');
            api.apply((m) => ({ ...m, docs: [...m.docs, { id, title, markdown: starterMarkdown(title), sections: [] }] }));
            setEditing({ type: 'doc', id });
          }}
          onAddSource={(s) => api.apply((m) => ({ ...m, sources: [...m.sources, { ...s, id: rid('f') }] }))}
        />
      )}

      {settingsTab && (
        <SettingsDialog
          settings={settings}
          initialTab={settingsTab}
          email={user.email}
          onLogout={onLogout}
          patch={patchSettings}
          onClose={() => setSettingsTab(null)}
          onClear={() => {
            api.replace(emptyModel);
            store.clear();
          }}
          onResetView={() => {
            try {
              localStorage.removeItem(viewKey(project.id));
            } catch {
              /* ignore */
            }
            location.reload();
          }}
        />
      )}
    </div>
  );
}
