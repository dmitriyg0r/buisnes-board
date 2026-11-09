import type { DiagramPoint } from './types';

/** Шаг сетки совпадает с привязкой на основном полотне приложения. */
export const DIAGRAM_GRID_STEP = 8;

export function snapDiagramPoint(point: DiagramPoint): DiagramPoint {
  return {
    x: Math.round(point.x / DIAGRAM_GRID_STEP) * DIAGRAM_GRID_STEP,
    y: Math.round(point.y / DIAGRAM_GRID_STEP) * DIAGRAM_GRID_STEP,
  };
}
