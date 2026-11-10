import { snapRouteSegmentDelta } from './modeling/diagramRouteSnapping';
import { hasSelfIntersections, simplifyRoute } from './modeling/orthogonalRouting';
import type { Point, Rect } from './modeling/orthogonalRouting';
import type { CardSide } from './data';

export interface SegmentEdit {
  /** Полный видимый маршрут, включая оба закреплённых якоря. */
  points: readonly Point[];
  index: number;
  /** Перемещение указателя в мировых координатах. */
  dx: number;
  dy: number;
  /** Семь экранных пикселей, переведённые вызывающим кодом в мировые единицы. */
  tolerance: number;
  startBounds: Rect;
  endBounds: Rect;
  obstacles?: readonly Rect[];
}

const validRect = (r: Rect) => r && Number.isFinite(r.x) && Number.isFinite(r.y) &&
  Number.isFinite(r.width) && Number.isFinite(r.height) && r.width > 0 && r.height > 0 &&
  Number.isFinite(r.x + r.width) && Number.isFinite(r.y + r.height);
const sameDirection = (a: Point, b: Point, c: Point, d: Point) =>
  Math.sign(b.x - a.x) === Math.sign(d.x - c.x) && Math.sign(b.y - a.y) === Math.sign(d.y - c.y);

/** Интервал внутри карточки; касание границы не считается пересечением. */
function inside(a: Point, b: Point, r: Rect): [number, number] | null {
  if (a.y === b.y && a.y > r.y && a.y < r.y + r.height) {
    const lo = Math.max(Math.min(a.x, b.x), r.x), hi = Math.min(Math.max(a.x, b.x), r.x + r.width);
    return lo < hi ? [lo, hi] : null;
  }
  if (a.x === b.x && a.x > r.x && a.x < r.x + r.width) {
    const lo = Math.max(Math.min(a.y, b.y), r.y), hi = Math.min(Math.max(a.y, b.y), r.y + r.height);
    return lo < hi ? [lo, hi] : null;
  }
  return null;
}

/** Проверка перед применением маршрута или переподключением конца. */
export function validCardRoute(points: readonly Point[], fromSide: CardSide, toSide: CardSide,
  startBounds: Rect, endBounds: Rect, obstacles: readonly Rect[] = []): boolean {
  if (points.length < 2 || !validRect(startBounds) || !validRect(endBounds) || obstacles.some(r => !validRect(r)) || hasSelfIntersections(points)) return false;
  const outward = (at: Point, next: Point, side: CardSide) => side === 'left' ? next.y === at.y && next.x < at.x :
    side === 'right' ? next.y === at.y && next.x > at.x : side === 'top' ? next.x === at.x && next.y < at.y : next.x === at.x && next.y > at.y;
  if (!outward(points[0], points[1], fromSide) || !outward(points[points.length - 1], points[points.length - 2], toSide)) return false;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    if ((i !== 0 && inside(a, b, startBounds)) || (i !== points.length - 2 && inside(a, b, endBounds)) || obstacles.some(r => inside(a, b, r))) return false;
  }
  return true;
}

/** Новый проход внутри карточки допустим только на той же геометрии старого пути. */
function coveredByOld(a: Point, b: Point, r: Rect, old: readonly Point[], exempt: (i: number, count: number) => boolean): boolean {
  const hit = inside(a, b, r);
  if (!hit) return true;
  const horizontal = a.y === b.y;
  const intervals: [number, number][] = [];
  for (let i = 0; i + 1 < old.length; i++) {
    if (exempt(i, old.length - 1)) continue;
    const p = old[i], q = old[i + 1];
    if (horizontal ? p.y !== a.y || q.y !== a.y : p.x !== a.x || q.x !== a.x) continue;
    const part = inside(p, q, r);
    if (part) intervals.push(part);
  }
  intervals.sort((x, y) => x[0] - y[0]);
  let covered = hit[0];
  for (const [lo, hi] of intervals) {
    if (lo > covered) break;
    covered = Math.max(covered, hi);
  }
  return covered >= hit[1];
}

/**
 * Вычисляет безопасный маршрут без изменения аргументов либо null.
 * Магнит выбирает цель до проверки безопасности; опасная цель не подменяется
 * непривязанным вариантом. Первый/последний сегмент освобождён только от
 * проверки своей карточки; остальные исторические пересечения не расширяются.
 * Направления концевых сегментов и оба якоря сохраняются.
 */
export function editLinkSegment(options: SegmentEdit): Point[] | null {
  const { points, index, dx, dy, tolerance, startBounds, endBounds, obstacles = [] } = options;
  if (!Array.isArray(points) || points.length < 2 || !Number.isInteger(index) || index < 0 || index >= points.length - 1 ||
      !Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(tolerance) || tolerance < 0 ||
      !validRect(startBounds) || !validRect(endBounds) || !Array.isArray(obstacles) || obstacles.some(r => !validRect(r)) ||
      points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  // Исторические повторы и коллинеарные точки допустимы, диагонали — нет.
  for (let i = 0; i + 1 < points.length; i++) {
    if (points[i].x !== points[i + 1].x && points[i].y !== points[i + 1].y) return null;
  }
  const a = points[index], b = points[index + 1];
  const horizontal = a.y === b.y && a.x !== b.x;
  if (!horizontal && !(a.x === b.x && a.y !== b.y)) return null;
  const snapped = snapRouteSegmentDelta(points, index, dx, dy, tolerance);
  const delta = horizontal ? snapped.dy : snapped.dx;
  if (!Number.isFinite(delta)) return null;
  const shift = (p: Point): Point => horizontal ? { x: p.x, y: p.y + delta } : { x: p.x + delta, y: p.y };
  const sign = Math.sign(horizontal ? b.x - a.x : b.y - a.y);
  const stub = Math.min(24, (horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y)) / 3) * sign;
  const first = horizontal ? { x: a.x + stub, y: a.y } : { x: a.x, y: a.y + stub };
  const last = horizontal ? { x: b.x - stub, y: b.y } : { x: b.x, y: b.y - stub };
  const result = simplifyRoute([
    ...points.slice(0, index),
    ...(index === 0 ? [a, first, shift(first)] : [shift(a)]),
    ...(index + 1 === points.length - 1 ? [shift(last), last, b] : [shift(b)]),
    ...points.slice(index + 2),
  ]);
  const old = simplifyRoute(points);
  if (result.length < 2 || old.length < 2 || hasSelfIntersections(result) ||
      !sameDirection(old[0], old[1], result[0], result[1]) ||
      !sameDirection(old[old.length - 1], old[old.length - 2], result[result.length - 1], result[result.length - 2])) return null;
  const checks = [
    { r: startBounds, exempt: (i: number) => i === 0 },
    { r: endBounds, exempt: (i: number, count: number) => i === count - 1 },
    ...obstacles.map(r => ({ r, exempt: (_i: number, _count: number) => false })),
  ];
  for (const { r, exempt } of checks) {
    for (let i = 0; i + 1 < result.length; i++) {
      if (!exempt(i, result.length - 1) && !coveredByOld(result[i], result[i + 1], r, old, exempt)) return null;
    }
  }
  return result;
}
