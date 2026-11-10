import type { Point } from './orthogonalRouting';

/**
 * Корректирует только поперечное смещение перетаскиваемого отрезка.
 * Цели — ближайшие по маршруту параллельные отрезки через один поворот
 * и прямая между концевыми якорями, если она параллельна отрезку.
 * tolerance задан в координатах диаграммы; граница допуска включена.
 * При равном расстоянии приоритет у предшествующего участка.
 * Упрощение маршрута и проверка его допустимости остаются за вызывающим кодом.
 */
export function snapRouteSegmentDelta(
  points: readonly Point[], index: number, dx: number, dy: number, tolerance: number,
): { dx: number; dy: number } {
  const unchanged = { dx, dy };
  if (!Number.isInteger(index) || index < 0 || index + 1 >= points.length ||
      !Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(tolerance) || tolerance < 0) return unchanged;
  const a = points[index], b = points[index + 1];
  const horizontal = a.y === b.y && a.x !== b.x;
  const vertical = a.x === b.x && a.y !== b.y;
  if (!horizontal && !vertical) return unchanged;
  const coordinate = horizontal ? 'y' : 'x';
  const moved = a[coordinate] + (horizontal ? dy : dx);
  if (!Number.isFinite(moved)) return unchanged;
  const candidates: number[] = [];
  for (const i of [index - 2, index + 2]) {
    const p = points[i], q = points[i + 1];
    if (!p || !q) continue;
    if (horizontal ? p.y === q.y && p.x !== q.x : p.x === q.x && p.y !== q.y) candidates.push(p[coordinate]);
  }
  const start = points[0], end = points[points.length - 1];
  if (horizontal ? start.y === end.y && start.x !== end.x : start.x === end.x && start.y !== end.y) candidates.push(start[coordinate]);
  let bestDistance = Infinity;
  let target: number | undefined;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - moved);
    if (Number.isFinite(candidate) && distance <= tolerance && distance < bestDistance) {
      bestDistance = distance;
      target = candidate;
    }
  }
  if (target === undefined) return unchanged;
  return horizontal ? { dx, dy: target - a.y } : { dx: target - a.x, dy };
}
