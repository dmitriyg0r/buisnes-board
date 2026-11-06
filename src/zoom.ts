import { createContext } from 'react';

/** Текущий масштаб полотна: нужен, чтобы перевести пиксели экрана в координаты мира. */
export const ZoomCtx = createContext(1);

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
