import { useEffect, useRef, useState } from 'react';
import { http, HttpError } from './api';
import { emptyModel, type Model } from './data';
import { mergeModel } from './mergeModel';
import { DiagramMergeError } from './modeling/mergeSource';
import { InvalidModelsError, normalizeModel } from './normalize';
import type { Settings } from './settings';
import type { ModelApi } from './useModel';

export type SyncState = 'connecting' | 'saved' | 'saving' | 'offline' | 'conflict' | 'revoked' | 'error';

interface ModelDto {
  data: Model;
  version: number;
}

const normalize = (m: Partial<Model>): Model => normalizeModel(m);

const hasContent = (m: Model) =>
  m.models.length > 0 || m.processes.length > 0 || m.docs.length > 0 || m.htmlObjects.length > 0 || m.links.length > 0 || m.cardLinks.length > 0 || m.sources.length > 0 || Object.keys(m.meta).length > 0;

type Prefs = Pick<Settings, 'grid' | 'snap' | 'minimap' | 'wheelZoom'>;
const pickPrefs = (s: Partial<Settings>): Partial<Prefs> => {
  const out: Partial<Prefs> = {};
  for (const k of ['grid', 'snap', 'minimap', 'wheelZoom'] as const) if (typeof s[k] === 'boolean') out[k] = s[k];
  return out;
};
const prefsKey = (s: Partial<Settings>) => JSON.stringify([s.grid, s.snap, s.minimap, s.wheelZoom]);

const isOffline = (e: unknown) => !(e instanceof HttpError) || e.status >= 500;

/**
 * Синхронизирует модель открытого проекта и настройки полотна с бэкендом. Локальная копия в
 * localStorage остаётся запасной: если сервер недоступен, работа продолжается, а изменения
 * отправятся при следующей попытке.
 */
export function useSync(mApi: ModelApi, settings: Settings, patch: (p: Partial<Settings>) => void, projectId: string): SyncState {
  const [state, setState] = useState<SyncState>('connecting');
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  const version = useRef(0);
  const lastModel = useRef('');
  const lastPrefs = useRef('');
  const queue = useRef<Promise<void>>(Promise.resolve());
  const modelRef = useRef(mApi.model);
  modelRef.current = mApi.model;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const revoked = useRef(false);

  /** Подтянуть модель с сервера и слить с локальными несохранёнными правками. */
  const pull = async () => {
    const r = await http<ModelDto>('GET', `/projects/${projectId}/model`);
    if (r.version === version.current) return false;
    const remote = normalize(r.data);
    const base = normalize(JSON.parse(lastModel.current || '{}'));
    const local = modelRef.current;
    const hasLocal = JSON.stringify(local) !== lastModel.current;
    const next = hasLocal ? mergeModel(base, local, remote) : remote;
    version.current = r.version;
    lastModel.current = JSON.stringify(remote);
    mApi.setRemote(next);
    return hasLocal;
  };

  const retryLater = () => setTimeout(() => setTick((t) => t + 1), 5000);

  /* ----- первичная загрузка ----- */
  useEffect(() => {
    // Повтор отправки после сетевого сбоя не должен заново загружать сервер поверх локальных правок.
    if (ready) return;
    let dead = false;
    (async () => {
      try {
        const remote = await http<ModelDto>('GET', `/projects/${projectId}/model`);
        const remotePrefs = pickPrefs(await http<Partial<Settings>>('GET', '/settings'));
        if (dead) return;

        const remoteModel = normalize(remote.data);
        if (hasContent(remoteModel)) {
          // на сервере уже есть данные — они главнее локальных
          mApi.setRemote(remoteModel);
          lastModel.current = JSON.stringify(remoteModel);
        } else {
          // сервер пуст: если локально что-то есть, оно уйдёт на сервер как первая версия
          lastModel.current = JSON.stringify(emptyModel);
        }

        patch(remotePrefs);
        lastPrefs.current = prefsKey({ ...pickPrefs(settingsRef.current), ...remotePrefs });

        version.current = remote.version;
        setReady(true);
        setState('saved');
      } catch (error) {
        if (dead) return;
        if (error instanceof InvalidModelsError || error instanceof DiagramMergeError) { setState('error'); return; }
        setState('offline');
        retryLater();
      }
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, projectId]);

  /* ----- сохранение модели ----- */
  useEffect(() => {
    if (!ready) return;
    const json = JSON.stringify(mApi.model);
    if (json === lastModel.current) return;
    setState('saving');
    const t = setTimeout(() => {
      queue.current = queue.current.then(async () => {
        try {
          const sent = JSON.stringify(modelRef.current);
          const res = await http<ModelDto>('PUT', `/projects/${projectId}/model`, { version: version.current, data: JSON.parse(sent) });
          version.current = res.version;
          lastModel.current = sent;
          setState(JSON.stringify(modelRef.current) === lastModel.current ? 'saved' : 'saving');
        } catch (e) {
          if (e instanceof HttpError && e.status === 409) {
            // модель изменена другим участником: сливаем его правки с моими, мои уйдут следующей записью
            try {
              await pull();
              setState('conflict');
              setTimeout(() => setState((st) => (st === 'conflict' ? 'saved' : st)), 4000);
            } catch (error) {
              if (error instanceof InvalidModelsError || error instanceof DiagramMergeError) { setState('error'); return; }
              setState('offline');
              retryLater();
            }
          } else if (e instanceof HttpError && e.status === 404) {
            revoked.current = true;
            setState('revoked');
          } else if (isOffline(e)) {
            setState('offline');
            retryLater();
          } else setState('error');
        }
      });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mApi.model, ready, tick]);

  /* ----- изменения других участников: сигнал по потоку событий, опрос версии как запасной путь ----- */
  useEffect(() => {
    if (!ready) return;
    const poll = () => {
      if (revoked.current) return;
      queue.current = queue.current.then(async () => {
        try {
          const { version: v } = await http<{ version: number }>('GET', `/projects/${projectId}/model/version`);
          if (v === version.current) return;
          if (await pull()) setState('saving');
        } catch (e) {
          if (e instanceof InvalidModelsError || e instanceof DiagramMergeError) { setState('error'); return; }
          if (e instanceof HttpError && (e.status === 404 || e.status === 403)) {
            revoked.current = true;
            setState('revoked');
          }
          // сетевые сбои игнорируем: следующий опрос повторит попытку
        }
      });
    };
    const timer = setInterval(() => { if (!document.hidden) poll(); }, 4000);
    window.addEventListener('bb:model-hint', poll);
    return () => {
      clearInterval(timer);
      window.removeEventListener('bb:model-hint', poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, projectId]);

  /* ----- сохранение настроек полотна ----- */
  useEffect(() => {
    if (!ready) return;
    const key = prefsKey(settings);
    if (key === lastPrefs.current) return;
    const t = setTimeout(async () => {
      try {
        await http('PUT', '/settings', { grid: settings.grid, snap: settings.snap, minimap: settings.minimap, wheelZoom: settings.wheelZoom });
        lastPrefs.current = key;
      } catch (e) {
        if (isOffline(e)) {
          setState('offline');
          retryLater();
        }
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.grid, settings.snap, settings.minimap, settings.wheelZoom, ready, tick]);

  return state;
}
