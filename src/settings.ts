import { useCallback, useState } from 'react';

const KEY = 'bb.settings.v1';

export interface Settings {
  name: string;
  role: string;
  projectName: string;
  grid: boolean;
  snap: boolean;
  minimap: boolean;
  /** колёсико мыши масштабирует доску; выключено — колёсико и тачпад прокручивают её */
  wheelZoom: boolean;
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
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) };
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
