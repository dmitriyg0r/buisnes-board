import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyModel, type Model } from './data';
import { normalizeModel } from './normalize';

import { modelKey } from './projects';

function load(KEY: string): Model {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const m = JSON.parse(raw) as Model;
      return normalizeModel(m);
    }
  } catch {
    /* хранилище недоступно — начинаем с исходной модели */
  }
  return emptyModel;
}

export interface ModelApi {
  model: Model;
  /** изменение с записью в историю */
  apply: (fn: (m: Model) => Model) => void;
  /** изменение без записи (перетаскивание); перед ним вызывается checkpoint */
  applyLive: (fn: (m: Model) => Model) => void;
  checkpoint: () => void;
  undo: () => void;
  canUndo: boolean;
  /** вернуть отменённое */
  redo: () => void;
  canRedo: boolean;
  /** Canvas сообщает, как снять и вернуть положение и размеры карточек: они входят в историю вместе с моделью */
  bindExtra: (get: () => unknown, set: (v: unknown) => void) => void;
  /** принять модель с сервера: без записи в историю отмены */
  setRemote: (m: Model) => void;
  /** заменить модель целиком (с записью в историю) */
  replace: (m: Model) => void;
}

export function useModel(projectId: string): ModelApi {
  const KEY = modelKey(projectId);
  const [model, setModel] = useState<Model>(() => load(KEY));
  const ref = useRef(model);
  type Snap = { model: Model; extra: unknown };
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const extra = useRef<{ get: () => unknown; set: (v: unknown) => void } | null>(null);
  const bindExtra = useCallback((get: () => unknown, set: (v: unknown) => void) => {
    extra.current = { get, set };
  }, []);
  const snap = (): Snap => ({ model: ref.current, extra: extra.current?.get() });
  const sync = () => {
    setCanUndo(past.current.length > 0);
    setCanRedo(future.current.length > 0);
  };

  useEffect(() => {
    ref.current = model;
    try {
      localStorage.setItem(KEY, JSON.stringify(model));
    } catch {
      /* ignore */
    }
  }, [model, KEY]);

  const checkpoint = useCallback(() => {
    past.current.push(snap());
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    sync();
  }, []);

  const applyLive = useCallback((fn: (m: Model) => Model) => {
    const next = fn(ref.current);
    ref.current = next;
    setModel(next);
  }, []);

  const apply = useCallback(
    (fn: (m: Model) => Model) => {
      checkpoint();
      applyLive(fn);
    },
    [checkpoint, applyLive],
  );

  const restore = (v: Snap) => {
    ref.current = v.model;
    setModel(v.model);
    if (v.extra !== undefined) extra.current?.set(v.extra);
  };
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(snap());
    restore(prev);
    sync();
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(snap());
    restore(next);
    sync();
  }, []);

  const setRemote = useCallback((m: Model) => {
    ref.current = m;
    setModel(m);
  }, []);

  const replace = useCallback((m: Model) => apply(() => m), [apply]);

  return { model, apply, applyLive, checkpoint, undo, canUndo, redo, canRedo, bindExtra, setRemote, replace };
}
