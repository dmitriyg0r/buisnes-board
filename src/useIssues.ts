import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { http } from './api';
import type { HistoryEntry, Issue, IssueStatus } from './data';

export interface IssueFields {
  answer?: string;
  resolution?: string;
}

/** Строка таблицы issues. Ручное замечание хранит содержимое в data, автозамечание — только статус. */
interface Row {
  id: string;
  ref: string | null;
  title: string;
  status: IssueStatus;
  data: Record<string, unknown> & { auto?: boolean };
}

const toIssue = (r: Row): Issue => ({
  title: r.title,
  status: r.status,
  summary: '',
  question: '',
  ...(r.data as Partial<Issue>),
  id: r.ref ?? r.id,
});

export interface IssueStore {
  /** замечания, созданные вручную */
  manual: Issue[];
  /** сохранённое состояние автозамечаний по их ключу: статус, ответ, решение, история */
  autoState: Record<string, Partial<Issue>>;
  /** перевести замечание в новый статус; ответ и решение записываются вместе с историей */
  update: (issue: Issue, status: IssueStatus, fields?: IssueFields) => void;
  clear: () => void;
  /** Команды ИИ дожидаются подтверждения записи и возвращают ошибки в чат. */
  saveAi: (issue: Issue) => Promise<void>;
  removeAi: (issue: Issue) => Promise<void>;
}

/**
 * Замечания проекта. Локальное состояние обновляется сразу, запись в PostgreSQL идёт следом.
 * Пока проекта на сервере нет (нет связи), замечания живут только в памяти.
 */
export function useIssues(projectId: string | null): IssueStore {
  const [rows, setRows] = useState<Row[]>([]);
  const pid = useRef(projectId);
  pid.current = projectId;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (!projectId) return;
    let dead = false;
    http<Row[]>('GET', `/projects/${projectId}/issues`)
      .then((r) => !dead && setRows(r))
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [projectId]);

  const manual = useMemo(() => rows.filter((r) => !r.data.auto).map(toIssue), [rows]);
  const autoState = useMemo(
    () =>
      Object.fromEntries(
        rows.filter((r) => r.data.auto && r.ref).map((r) => [r.ref as string, { ...(r.data as Partial<Issue>), status: r.status }]),
      ),
    [rows],
  );

  const update = useCallback((issue: Issue, status: IssueStatus, f: IssueFields = {}) => {
    const p = pid.current;
    const row = rowsRef.current.find((r) => (r.ref ?? r.id) === issue.id);
    const prev = row?.data ?? (issue.auto ? { auto: true } : {});
    const entry: HistoryEntry = { status, at: new Date().toISOString(), note: f.answer || f.resolution || undefined };
    const data = {
      ...prev,
      ...(f.answer !== undefined ? { answer: f.answer } : {}),
      ...(f.resolution !== undefined ? { resolution: f.resolution } : {}),
      history: [...((prev.history as HistoryEntry[] | undefined) ?? []), entry],
    };

    if (issue.auto) {
      setRows((rs) =>
        rs.some((r) => r.ref === issue.id)
          ? rs.map((r) => (r.ref === issue.id ? { ...r, status, data } : r))
          : [...rs, { id: issue.id, ref: issue.id, title: issue.title, status, data }],
      );
      if (p) void http('PUT', `/projects/${p}/issues/by-ref/${encodeURIComponent(issue.id)}`, { title: issue.title, status, data }).catch(() => undefined);
      return;
    }
    if (!row) return;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status, data } : r)));
    if (p) void http('PATCH', `/issues/${row.id}`, { status, data }).catch(() => undefined);
  }, []);

  const clear = useCallback(() => {
    setRows([]);
    const p = pid.current;
    if (p) void http('DELETE', `/projects/${p}/issues`).catch(() => undefined);
  }, []);

  const saveAi = useCallback(async (issue: Issue) => {
    const project = pid.current;
    if (!project) throw new Error('Проект не открыт');
    const old = rowsRef.current.find((r) => (r.ref ?? r.id) === issue.id);
    const { id: _id, title, status, ...body } = issue;
    const data = { ...body, auto: !!issue.auto };
    const saved = old && !old.ref
      ? await http<Row>('PATCH', `/issues/${old.id}`, { title, status, data })
      : await http<Row>('PUT', `/projects/${project}/issues/by-ref/${encodeURIComponent(old?.ref ?? issue.id)}`, { title, status, data });
    if (pid.current !== project) return;
    setRows((previous) => {
      const next = previous.some((r) => r.id === saved.id || (r.ref && r.ref === saved.ref))
        ? previous.map((r) => r.id === saved.id || (r.ref && r.ref === saved.ref) ? saved : r)
        : [...previous, saved];
      rowsRef.current = next;
      return next;
    });
  }, []);
  const removeAi = useCallback(async (issue: Issue) => {
    if (issue.auto) throw new Error('Автозамечание нужно закрыть или устранить его причину');
    const row = rowsRef.current.find((r) => (r.ref ?? r.id) === issue.id);
    if (!row) throw new Error('Замечание не найдено');
    const project = pid.current;
    await http<void>('DELETE', `/issues/${row.id}`);
    if (pid.current !== project) return;
    setRows((previous) => { const next = previous.filter((r) => r.id !== row.id); rowsRef.current = next; return next; });
  }, []);

  return { manual, autoState, update, clear, saveAi, removeAi };
}
