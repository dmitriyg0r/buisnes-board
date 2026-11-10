import { useCallback, useEffect, useRef, useState } from 'react';
import { acceptModelDrag, type ModelDragEvent, type ModelDragFrame } from './modeling/liveDrag';

export interface Peer {
  id: string;
  name: string;
  /** положение курсора в координатах доски; null — курсор вне доски */
  x: number | null;
  y: number | null;
  /** ID открытой модели; x/y заданы в её координатах, а не на доске. */
  editing?: string | null;
  color: string;
  seen: number;
}

export interface DragItem { id: string; x: number; y: number }

/** Чужая ИИ-генерация: начало, кусочки текста модели и конец. */
export interface AiEvent { k: 'start' | 'delta' | 'end'; user: string; name: string; text: string }

export interface Presence {
  peers: Peer[];
  /** сообщить своё положение (координаты доски) или null, если курсор ушёл */
  send: (x: number | null, y: number | null) => void;
  /** Сохранить признак открытого редактора даже при уходе курсора с диаграммы. */
  sendEditor?: (editing: string | null, x: number | null, y: number | null) => void;
  /** Живой предпросмотр жеста внутри модели, отдельно от сохранения документа. */
  sendModelDrag?: (frame: ModelDragFrame) => void;
  onModelDrag?: (fn: (frame: ModelDragEvent) => void) => () => void;
  /** сообщить положение карточек, которые тащим прямо сейчас */
  sendDrag: (items: DragItem[]) => void;
  /** подписка на чужие перетаскивания; возвращает отписку */
  onDrag: (fn: (items: DragItem[]) => void) => () => void;
  /** подписка на ИИ-генерацию коллег; возвращает отписку */
  onAi: (fn: (e: AiEvent) => void) => () => void;
}

const COLORS = ['#e5484d', '#f76b15', '#30a46c', '#0091ff', '#8e4ec6', '#d6409f', '#12a594', '#978365'];
export const peerColor = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
};

const STALE_MS = 12_000;
const HEARTBEAT_MS = 5_000;
const MIN_GAP_MS = 80;
const DRAG_GAP_MS = 40;

/**
 * Присутствие на доске: поток событий проекта (SSE) и отправка своего курсора.
 * Если поток недоступен, остальное (опрос версии) продолжает работать, просто курсоров нет.
 * Сигнал «модель изменилась» пробрасывается событием bb:model-hint, его ловит sync.ts.
 */
export function usePresence(projectId: string): Presence {
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const last = useRef<{ x: number | null; y: number | null; editing: string | null }>({ x: null, y: null, editing: null });
  const lastSent = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout>>();
  const dragListeners = useRef(new Set<(items: DragItem[]) => void>());
  const aiListeners = useRef(new Set<(e: AiEvent) => void>());
  const dragPending = useRef<Record<string, DragItem>>({});
  const dragSent = useRef(0);
  const dragTimer = useRef<ReturnType<typeof setTimeout>>();
  const [modelSession] = useState(() => crypto.randomUUID());
  const modelSeq = useRef(0);
  const modelVersions = useRef(new Map<string, number>());
  const modelListeners = useRef(new Set<(frame: ModelDragEvent) => void>());
  const modelPending = useRef<ModelDragFrame | null>(null);
  const modelActive = useRef<ModelDragFrame | null>(null);
  const modelTimer = useRef<ReturnType<typeof setTimeout>>();
  const modelSent = useRef(0);

  const postModelDrag = useCallback((frame: ModelDragFrame) => {
    modelSent.current = Date.now();
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/presence`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: frame.phase !== 'move',
      body: JSON.stringify({ model_drag: { ...frame, session: modelSession, seq: ++modelSeq.current } }),
    }).catch(() => undefined);
  }, [projectId, modelSession]);
  const sendModelDrag = useCallback((frame: ModelDragFrame) => {
    modelActive.current = frame.phase === 'move' ? frame : null;
    const wait = DRAG_GAP_MS - (Date.now() - modelSent.current);
    if (frame.phase !== 'move' || wait <= 0) {
      clearTimeout(modelTimer.current); modelTimer.current = undefined; modelPending.current = null;
      postModelDrag(frame);
    } else {
      modelPending.current = frame;
      if (!modelTimer.current) modelTimer.current = setTimeout(() => {
        modelTimer.current = undefined;
        const pending = modelPending.current; modelPending.current = null;
        if (pending) postModelDrag(pending);
      }, wait);
    }
  }, [postModelDrag]);
  const onModelDrag = useCallback((fn: (frame: ModelDragEvent) => void) => {
    modelListeners.current.add(fn);
    return () => { modelListeners.current.delete(fn); };
  }, []);


  const flushDrag = useCallback(() => {
    dragTimer.current = undefined;
    const items = Object.values(dragPending.current);
    dragPending.current = {};
    if (!items.length) return;
    dragSent.current = Date.now();
    // Сервер принимает до 64 карточек в одном кадре, в том числе при групповом переносе.
    for (let offset = 0; offset < items.length; offset += 64) void fetch(`/api/projects/${encodeURIComponent(projectId)}/presence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drag: items.slice(offset, offset + 64) }),
    }).catch(() => undefined);
  }, [projectId]);

  const sendDrag = useCallback(
    (items: DragItem[]) => {
      for (const i of items) dragPending.current[i.id] = i;
      const wait = DRAG_GAP_MS - (Date.now() - dragSent.current);
      if (wait <= 0) { clearTimeout(dragTimer.current); flushDrag(); }
      else if (!dragTimer.current) dragTimer.current = setTimeout(flushDrag, wait);
    },
    [flushDrag],
  );

  const onAi = useCallback((fn: (e: AiEvent) => void) => {
    aiListeners.current.add(fn);
    return () => { aiListeners.current.delete(fn); };
  }, []);

  const onDrag = useCallback((fn: (items: DragItem[]) => void) => {
    dragListeners.current.add(fn);
    return () => { dragListeners.current.delete(fn); };
  }, []);

  const post = useCallback(
    (x: number | null, y: number | null, editing: string | null = last.current.editing) => {
      lastSent.current = Date.now();
      void fetch(`/api/projects/${encodeURIComponent(projectId)}/presence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x, y, editing }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [projectId],
  );

  const send = useCallback(
    (x: number | null, y: number | null) => {
      if (last.current.editing) return;
      last.current = { x, y, editing: null };
      const wait = MIN_GAP_MS - (Date.now() - lastSent.current);
      if (wait <= 0) {
        clearTimeout(trailing.current); trailing.current = undefined;
        post(x, y);
      } else if (!trailing.current) {
        // последнее положение уйдёт, когда пройдёт пауза между отправками
        trailing.current = setTimeout(() => {
          trailing.current = undefined;
          post(last.current.x, last.current.y);
        }, wait);
      }
    },
    [post],
  );

  const sendEditor = useCallback((editing: string | null, x: number | null, y: number | null) => {
    const changedScope = last.current.editing !== editing;
    last.current = { x, y, editing };
    const wait = MIN_GAP_MS - (Date.now() - lastSent.current);
    if (changedScope || wait <= 0) {
      clearTimeout(trailing.current); trailing.current = undefined;
      post(x, y, editing);
    } else if (!trailing.current) trailing.current = setTimeout(() => {
      trailing.current = undefined;
      post(last.current.x, last.current.y, last.current.editing);
    }, wait);
  }, [post]);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let dead = false;

    const connect = () => {
      es = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/events`);
      es.onmessage = (m) => {
        let ev: { t: string; u?: string; n?: string; x?: number | null; y?: number | null; mx?: number | null; my?: number | null; editing?: string | null; d?: DragItem[] | string; model_drag?: Omit<ModelDragEvent, 'user'>; k?: string };
        try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.t === 'model_drag' && ev.u && ev.model_drag) {
          const frame = { ...ev.model_drag, user: ev.u };
          if (acceptModelDrag(modelVersions.current, frame)) modelListeners.current.forEach(fn => fn(frame));
        }
        else if (ev.t === 'drag' && Array.isArray(ev.d)) dragListeners.current.forEach((fn) => fn(ev.d as DragItem[]));
        else if (ev.t === 'ai' && ev.u && (ev.k === 'start' || ev.k === 'delta' || ev.k === 'end')) {
          const e: AiEvent = { k: ev.k, user: ev.u, name: ev.n ?? 'Коллега', text: typeof ev.d === 'string' ? ev.d : '' };
          aiListeners.current.forEach((fn) => fn(e));
        }
        else if (ev.t === 'model') window.dispatchEvent(new Event('bb:model-hint'));
        else if (ev.t === 'cursor' && ev.u) {
          const id = ev.u;
          setPeers((p) => ({ ...p, [id]: { id, name: ev.n ?? 'Участник', x: (ev.editing ? ev.mx : ev.x) ?? null, y: (ev.editing ? ev.my : ev.y) ?? null, editing: typeof ev.editing === 'string' ? ev.editing : null, color: peerColor(id), seen: Date.now() } }));
        } else if (ev.t === 'left' && ev.u) {
          const id = ev.u;
          setPeers((p) => { const { [id]: _gone, ...rest } = p; return rest; });
        }
      };
      es.onerror = () => {
        // браузер сам переподключается на обрывах; при закрытом потоке (например, доступ закрыт) пробуем позже
        if (es && es.readyState === EventSource.CLOSED && !dead) {
          es.close();
          retry = setTimeout(connect, 10_000);
        }
      };
      // новый подписчик ещё не знает, кто на доске: объявляем себя
      es.onopen = () => post(last.current.x, last.current.y);
    };
    connect();

    const beat = setInterval(() => {
      post(last.current.x, last.current.y);
      if (modelActive.current) sendModelDrag(modelActive.current);
    }, HEARTBEAT_MS);
    const prune = setInterval(() => {
      const now = Date.now();
      setPeers((p) => (Object.values(p).some((x) => now - x.seen > STALE_MS) ? Object.fromEntries(Object.entries(p).filter(([, x]) => now - x.seen <= STALE_MS)) : p));
    }, 3000);
    const leave = () => {
      if (modelActive.current) sendModelDrag({ ...modelActive.current, phase: 'cancel', changes: [] });
      post(null, null, null);
    };
    window.addEventListener('pagehide', leave);
    return () => {
      dead = true;
      es?.close();
      clearTimeout(retry);
      clearTimeout(trailing.current);
      trailing.current = undefined;
      clearTimeout(dragTimer.current); dragTimer.current = undefined; dragPending.current = {};
      clearInterval(beat);
      clearInterval(prune);
      window.removeEventListener('pagehide', leave);
      leave();
      clearTimeout(modelTimer.current); modelTimer.current = undefined; modelPending.current = null;
    };
  }, [projectId, post, sendModelDrag]);

  return { peers: Object.values(peers), send, sendEditor, sendModelDrag, onModelDrag, sendDrag, onDrag, onAi };
}
