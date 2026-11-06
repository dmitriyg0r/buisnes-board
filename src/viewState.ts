import { viewKey } from './projects';

export interface Cam {
  x: number;
  y: number;
  k: number;
}
export type CardPos = Record<string, { x: number; y: number }>;

export type CardSizes = Record<string, { w: number; h: number }>;

interface Saved {
  cam: Cam;
  pos: CardPos;
  /** размеры хранятся только для карточек, которым их меняли */
  sizes?: CardSizes;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function loadView(id: string): Saved | null {
  try {
    const raw = localStorage.getItem(viewKey(id));
    if (!raw) return null;
    const v = JSON.parse(raw) as Saved;
    if (!num(v.cam?.x) || !num(v.cam?.y) || !num(v.cam?.k)) return null;
    // положения хранятся только для карточек, которые двигали
    if (!v.pos || typeof v.pos !== 'object') return null;
    // положения карточек из прежнего формата: модель и документ получили составные идентификаторы
    const names: Record<string, string> = { model: 'proc:main', doc: 'doc:main' };
    const pos = Object.fromEntries(Object.entries(v.pos).map(([k, p]) => [names[k] ?? k, p]));
    const sizes = Object.fromEntries(Object.entries(v.sizes ?? {}).filter(([, z]) => num(z?.w) && num(z?.h)));
    return { ...v, pos, sizes };
  } catch {
    return null;
  }
}

export function saveView(id: string, v: Saved) {
  try {
    localStorage.setItem(viewKey(id), JSON.stringify(v));
  } catch {
    /* хранилище недоступно — вид просто не запомнится */
  }
}
