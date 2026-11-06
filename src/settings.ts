import { useCallback, useState } from 'react';

const KEY = 'bb.settings.v1';

/** Модели для строки ИИ на доске */
export const aiModels = [
  { id: '6.1-sol', label: '6.1 sol' },
  { id: '6.1-terra', label: '6.1 terra' },
] as const;
export type AiModel = (typeof aiModels)[number]['id'];

export interface Settings {
  name: string;
  role: string;
  projectName: string;
  grid: boolean;
  snap: boolean;
  minimap: boolean;
  /** колёсико мыши масштабирует доску; выключено — колёсико и тачпад прокручивают её */
  wheelZoom: boolean;
  /** выбранная в строке ИИ модель */
  aiModel: AiModel;
}

export const roles = ['Бизнес-аналитик', 'Методолог', 'Владелец процесса'];

export const defaultSettings: Settings = {
  name: 'Аналитик',
  role: roles[0],
  projectName: '',
  grid: true,
  snap: true,
  minimap: true,
  wheelZoom: false,
  aiModel: aiModels[0].id,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) };
      // модель из старого или повреждённого хранилища заменяем на стандартную
      if (!aiModels.some((m) => m.id === saved.aiModel)) saved.aiModel = defaultSettings.aiModel;
      return saved;
    }
  } catch {
    /* хранилище недоступно */
  }
  return defaultSettings;
}

export function useSettings(): [Settings, (p: Partial<Settings>) => void] {
  const [s, setS] = useState<Settings>(load);
  const patch = useCallback((p: Partial<Settings>) => {
    setS((prev) => {
      const next = { ...prev, ...p };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return [s, patch];
}

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
