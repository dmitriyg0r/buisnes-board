import { useCallback, useEffect, useRef, useState } from 'react';

export interface Peer {
  id: string;
  name: string;
  /** положение курсора в координатах доски; null — курсор вне доски */
  x: number | null;
  y: number | null;
  color: string;
  seen: number;
}

export interface DragItem { id: string; x: number; y: number }

export interface Presence {
  peers: Peer[];
  /** сообщить своё положение (координаты доски) или null, если курсор ушёл */
  send: (x: number | null, y: number | null) => void;
  /** сообщить положение карточек, которые тащим прямо сейчас */
  sendDrag: (items: DragItem[]) => void;
  /** подписка на чужие перетаскивания; возвращает отписку */
  onDrag: (fn: (items: DragItem[]) => void) => () => void;
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
  const last = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });
  const lastSent = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout>>();
  const dragListeners = useRef(new Set<(items: DragItem[]) => void>());
  const dragPending = useRef<Record<string, DragItem>>({});
  const dragSent = useRef(0);
  const dragTimer = useRef<ReturnType<typeof setTimeout>>();

  const flushDrag = useCallback(() => {
    dragTimer.current = undefined;
    const items = Object.values(dragPending.current);
    dragPending.current = {};
    if (!items.length) return;
    dragSent.current = Date.now();
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/presence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drag: items }),
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

  const onDrag = useCallback((fn: (items: DragItem[]) => void) => {
    dragListeners.current.add(fn);
    return () => { dragListeners.current.delete(fn); };
  }, []);

  const post = useCallback(
    (x: number | null, y: number | null) => {
      lastSent.current = Date.now();
      void fetch(`/api/projects/${encodeURIComponent(projectId)}/presence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x, y }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [projectId],
  );

  const send = useCallback(
    (x: number | null, y: number | null) => {
      last.current = { x, y };
      const wait = MIN_GAP_MS - (Date.now() - lastSent.current);
      if (wait <= 0) {
        clearTimeout(trailing.current);
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

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let dead = false;

    const connect = () => {
      es = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/events`);
      es.onmessage = (m) => {
        let ev: { t: string; u?: string; n?: string; x?: number | null; y?: number | null; d?: DragItem[] };
        try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.t === 'drag' && Array.isArray(ev.d)) dragListeners.current.forEach((fn) => fn(ev.d!));
        else if (ev.t === 'model') window.dispatchEvent(new Event('bb:model-hint'));
        else if (ev.t === 'cursor' && ev.u) {
          const id = ev.u;
          setPeers((p) => ({ ...p, [id]: { id, name: ev.n ?? 'Участник', x: ev.x ?? null, y: ev.y ?? null, color: peerColor(id), seen: Date.now() } }));
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

    const beat = setInterval(() => post(last.current.x, last.current.y), HEARTBEAT_MS);
    const prune = setInterval(() => {
      const now = Date.now();
      setPeers((p) => (Object.values(p).some((x) => now - x.seen > STALE_MS) ? Object.fromEntries(Object.entries(p).filter(([, x]) => now - x.seen <= STALE_MS)) : p));
    }, 3000);
    const leave = () => post(null, null);
    window.addEventListener('pagehide', leave);
    return () => {
      dead = true;
      es?.close();
      clearTimeout(retry);
      clearTimeout(trailing.current);
      trailing.current = undefined;
      clearInterval(beat);
      clearInterval(prune);
      window.removeEventListener('pagehide', leave);
      post(null, null);
    };
  }, [projectId, post]);

  return { peers: Object.values(peers), send, sendDrag, onDrag };
}
