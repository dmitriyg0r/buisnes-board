import { routeOrthogonal, routeConflictCost, simplifyRoute, type Direction, type RouteEndpoint } from './orthogonalRouting';
import type { DiagramNode, DiagramPoint, DiagramShape } from './types';

const directions: Direction[] = ['right', 'left', 'down', 'up'];
const center = (n: DiagramNode) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
function endpoint(n: DiagramNode, side: Direction, point?: DiagramPoint, shape?: DiagramShape): { endpoint: RouteEndpoint; actual: DiagramPoint } {
  const c = center(n);
  const actual = point ?? (side === 'left' ? { x: n.x, y: c.y } : side === 'right' ? { x: n.x + n.width, y: c.y } : side === 'up' ? { x: c.x, y: n.y + (shape === 'data-store' ? 0.5 : 0) } : { x: c.x, y: n.y + n.height - (shape === 'data-store' ? 0.5 : 0) });
  const projected = side === 'left' ? { x: n.x, y: actual.y } : side === 'right' ? { x: n.x + n.width, y: actual.y } : side === 'up' ? { x: actual.x, y: n.y } : { x: actual.x, y: n.y + n.height };
  return { endpoint: { point: projected, normal: side, bounds: n }, actual };
}
function pointSides(n: DiagramNode, p: DiagramPoint): Direction[] {
  const c = center(n); const dx = (p.x - c.x) / (n.width / 2); const dy = (p.y - c.y) / (n.height / 2);
  if (![dx, dy].every(Number.isFinite) || Math.abs(dx) > 1.000001 || Math.abs(dy) > 1.000001 || (!dx && !dy)) return [];
  return Math.abs(dx) >= Math.abs(dy) ? [dx < 0 ? 'left' : 'right'] : [dy < 0 ? 'up' : 'down'];
}
/** Первый и последний сегменты направлены наружу от соответствующей фигуры. */
export function endpointsFaceOutward(points: readonly DiagramPoint[], from: DiagramNode, to: DiagramNode, shapeOf?: (node: DiagramNode) => DiagramShape | undefined): boolean {
  if (points.length < 2) return false;
  const outward = (node: DiagramNode, at: DiagramPoint, next: DiagramPoint) => {
    if (shapeOf?.(node) === 'hexagon') {
      const cx = node.x + node.width / 2, cy = node.y + node.height / 2;
      const dx = (at.x - cx) / (node.width / 2), dy = (at.y - cy) / (node.height / 2);
      const onBoundary = Math.abs(dy) <= 1 + 1e-6 && Math.abs(dx) + .4 * Math.abs(dy) <= 1 + 1e-6 && (Math.abs(Math.abs(dy) - 1) < 1e-6 || Math.abs(Math.abs(dx) + .4 * Math.abs(dy) - 1) < 1e-6);
      if (onBoundary) return (next.y === at.y && (next.x - at.x) * dx > 0) || (next.x === at.x && (next.y - at.y) * dy > 0);
    }
    const side = pointSides(node, at)[0];
    return side === 'left' ? next.y === at.y && next.x < at.x : side === 'right' ? next.y === at.y && next.x > at.x : side === 'up' ? next.x === at.x && next.y < at.y : side === 'down' ? next.x === at.x && next.y > at.y : false;
  };
  return outward(from, points[0], points[1]) && outward(to, points[points.length - 1], points[points.length - 2]);
}
/** Проверяет пересечение внутренности прямоугольника, его граница допустима. */
export function segmentCrossesNode(a: DiagramPoint, b: DiagramPoint, n: DiagramNode): boolean {
  if (a.x === b.x) return a.x > n.x && a.x < n.x + n.width && Math.max(a.y, b.y) > n.y && Math.min(a.y, b.y) < n.y + n.height;
  if (a.y === b.y) return a.y > n.y && a.y < n.y + n.height && Math.max(a.x, b.x) > n.x && Math.min(a.x, b.x) < n.x + n.width;
  let low = 0, high = 1;
  for (const [origin, delta, min, max] of [[a.x, b.x - a.x, n.x, n.x + n.width], [a.y, b.y - a.y, n.y, n.y + n.height]]) {
    if (delta === 0) { if (origin <= min || origin >= max) return false; continue; }
    const u = (min - origin) / delta, v = (max - origin) / delta;
    low = Math.max(low, Math.min(u, v)); high = Math.min(high, Math.max(u, v));
  }
  return low < high;
}
/** Маршрут с необязательными точными точками привязки; null означает отказ без небезопасного fallback. */
export function routeBetweenNodes(nodes: readonly DiagramNode[], from: DiagramNode, to: DiagramNode, start?: DiagramPoint, end?: DiagramPoint, shapeOf?: (node: DiagramNode) => DiagramShape | undefined, routes?: readonly (readonly DiagramPoint[])[]): DiagramPoint[] | null {
  if (from.id === to.id) return null;
  const obstacles = nodes.filter(n => n.id !== from.id && n.id !== to.id);
  const starts = start ? pointSides(from, start) : shapeOf?.(from) === 'annotation' ? ['left' as const] : directions;
  const ends = end ? pointSides(to, end) : shapeOf?.(to) === 'annotation' ? ['left' as const] : directions;
  let best: DiagramPoint[] | null = null; let bestCost = Infinity;
  for (const a of starts) for (const b of ends) {
    const s = endpoint(from, a, start, shapeOf?.(from)), t = endpoint(to, b, end, shapeOf?.(to));
    if ([...obstacles, to].some(n => segmentCrossesNode(s.actual, s.endpoint.point, n)) || [...obstacles, from].some(n => segmentCrossesNode(t.actual, t.endpoint.point, n))) continue;
    try {
      const route = routeOrthogonal({ start: s.endpoint, end: t.endpoint, obstacles, routes });
      if (!route) continue;
      const points = simplifyRoute([s.actual, ...route, t.actual]);
      const length = points.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y), 0);
      const cost = (points.length - 2) * (routes ? 60 : 10000) + length + (routes ? points.slice(1).reduce((sum, p, i) => sum + routeConflictCost(points[i], p, routes), 0) : 0);
      if (cost < bestCost) { bestCost = cost; best = points; }
    } catch (error) { if (!(error instanceof RangeError)) throw error; }
  }
  return best;
}
