import { useEffect, useRef, useState } from 'react';
import { http, HttpError } from './api';
import { emptyModel, type Model } from './data';
import { normalizeModel } from './normalize';
import type { Settings } from './settings';
import type { ModelApi } from './useModel';

export type SyncState = 'connecting' | 'saved' | 'saving' | 'offline' | 'conflict';

interface ModelDto {
  data: Model;
  version: number;
}

const normalize = (m: Partial<Model>): Model => normalizeModel(m);

const hasContent = (m: Model) =>
  m.processes.length > 0 || m.docs.length > 0 || m.links.length > 0 || m.cardLinks.length > 0 || m.sources.length > 0 || Object.keys(m.meta).length > 0;

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

  const retryLater = () => setTimeout(() => setTick((t) => t + 1), 5000);

  /* ----- первичная загрузка ----- */
  useEffect(() => {
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
      } catch {
        if (dead) return;
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
          const res = await http<ModelDto>('PUT', `/projects/${projectId}/model`, { version: version.current, data: modelRef.current });
          version.current = res.version;
          lastModel.current = JSON.stringify(modelRef.current);
          setState(JSON.stringify(modelRef.current) === lastModel.current ? 'saved' : 'saving');
        } catch (e) {
          if (e instanceof HttpError && e.status === 409) {
            // модель изменена в другом месте: принимаем серверную версию
            try {
              const r = await http<ModelDto>('GET', `/projects/${projectId}/model`);
              const m = normalize(r.data);
              version.current = r.version;
              lastModel.current = JSON.stringify(m);
              mApi.setRemote(m);
              setState('conflict');
              setTimeout(() => setState('saved'), 4000);
            } catch {
              setState('offline');
              retryLater();
            }
          } else if (isOffline(e)) {
            setState('offline');
            retryLater();
          }
        }
      });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mApi.model, ready, tick]);

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
