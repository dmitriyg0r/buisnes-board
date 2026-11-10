// Независимая геометрия ортогональных связей; координаты — в единицах диаграммы.
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type Direction = 'left' | 'right' | 'up' | 'down';
export interface RouteEndpoint { point: Point; normal: Direction; bounds: Rect }
export interface RouteOptions {
  start: RouteEndpoint;
  end: RouteEndpoint;
  obstacles?: readonly Rect[];
  /** Уже проложенные связи: наложения дороже пересечений. */
  routes?: readonly (readonly Point[])[];
  /** Расстояние до препятствий; граница расширенного прямоугольника допустима. */
  clearance?: number;
  /** Минимальная длина начального и конечного прямого участка. */
  stubLength?: number;
  /** Максимальное число поворотов, включая повороты у концов. */
  maxBends?: number;
}

const vectors: Record<Direction, Point> = {
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
};
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const finitePoint = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);
const between = (n: number, a: number, b: number) => n >= Math.min(a, b) && n <= Math.max(a, b);
const orthogonal = (a: Point, b: Point) => a.x === b.x || a.y === b.y;

/** Удаляет совпадающие точки и промежуточные точки одного направленного отрезка. */
export function simplifyRoute(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    if (result.length && same(result[result.length - 1], p)) continue;
    while (result.length >= 2) {
      const a = result[result.length - 2], b = result[result.length - 1];
      if ((a.x === b.x && b.x === p.x && between(b.y, a.y, p.y)) ||
          (a.y === b.y && b.y === p.y && between(b.x, a.x, p.x))) result.pop();
      else break;
    }
    result.push({ ...p });
  }
  return result;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  if (a.y === b.y && c.y === d.y) return a.y === c.y && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
  if (a.x === b.x && c.x === d.x) return a.x === c.x && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
  if (a.y === b.y && c.x === d.x) return between(c.x, a.x, b.x) && between(a.y, c.y, d.y);
  if (a.x === b.x && c.y === d.y) return between(a.x, c.x, d.x) && between(c.y, a.y, b.y);
  return false;
}

/** Проверяет касания, пересечения и наложения несоседних сегментов и развороты. */
export function hasSelfIntersections(points: readonly Point[]): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    if (!finitePoint(a) || !finitePoint(b) || same(a, b) || !orthogonal(a, b)) return true;
    if (i > 0) {
      const p = points[i - 1];
      if ((p.x === a.x && a.x === b.x && !between(a.y, p.y, b.y)) ||
          (p.y === a.y && a.y === b.y && !between(a.x, p.x, b.x))) return true;
    }
    for (let j = 0; j < i - 1; j++) if (segmentsIntersect(points[j], points[j + 1], a, b)) return true;
  }
  return false;
}

/** Штраф за общий участок и за пересечение внутренних точек отрезков. */
export function routeConflictCost(a: Point, b: Point, routes: readonly (readonly Point[])[]): number {
  let cost = 0;
  for (const route of routes) for (let i = 1; i < route.length; i++) {
    const c = route[i - 1], d = route[i];
    if (a.y === b.y && c.y === d.y && a.y === c.y) cost += Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))) * 12;
    else if (a.x === b.x && c.x === d.x && a.x === c.x) cost += Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))) * 12;
    else if (a.y === b.y && c.x === d.x && c.x > Math.min(a.x, b.x) && c.x < Math.max(a.x, b.x) && a.y > Math.min(c.y, d.y) && a.y < Math.max(c.y, d.y)) cost += 100;
    else if (a.x === b.x && c.y === d.y && a.x > Math.min(c.x, d.x) && a.x < Math.max(c.x, d.x) && c.y > Math.min(a.y, b.y) && c.y < Math.max(a.y, b.y)) cost += 100;
  }
  return cost;
}

function blocked(a: Point, b: Point, boxes: readonly Rect[]): boolean {
  return boxes.some(r => a.y === b.y
    ? a.y > r.y && a.y < r.y + r.height && Math.max(Math.min(a.x, b.x), r.x) < Math.min(Math.max(a.x, b.x), r.x + r.width)
    : a.x > r.x && a.x < r.x + r.width && Math.max(Math.min(a.y, b.y), r.y) < Math.min(Math.max(a.y, b.y), r.y + r.height));
}
function direction(a: Point, b: Point): Direction {
  return a.x === b.x ? (b.y > a.y ? 'down' : 'up') : (b.x > a.x ? 'right' : 'left');
}
function opposite(a: Direction, b: Direction): boolean {
  return vectors[a].x === -vectors[b].x && vectors[a].y === -vectors[b].y;
}
function add(p: Point, v: Point, length: number): Point { return { x: p.x + v.x * length, y: p.y + v.y * length }; }

/**
 * Возвращает маршрут либо null, если найденного допустимого маршрута нет.
 * Прямоугольники обоих концов задаются в start.bounds и end.bounds.
 * Выход и вход разрешены только через указанные точки и внешние нормали.
 * Граница расширенного препятствия допустима, его внутренняя область — нет.
 * Поиск детерминированный, ограничен сеткой и не гарантирует полноту.
 * Некорректные аргументы вызывают RangeError.
 */
export function routeOrthogonal(options: RouteOptions): Point[] | null {
  const { start, end, obstacles = [], clearance = 8, stubLength = 16, maxBends = 8 } = options;
  const validRect = (r: Rect) => r && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height) && r.width > 0 && r.height > 0 && Number.isFinite(r.x + r.width) && Number.isFinite(r.y + r.height);
  if (!start || !end || !start.point || !end.point || !finitePoint(start.point) || !finitePoint(end.point) || !vectors[start.normal] || !vectors[end.normal] ||
      !validRect(start.bounds) || !validRect(end.bounds) || !Number.isFinite(clearance) || clearance < 0 || !Number.isFinite(stubLength) || stubLength <= 0 ||
      !Number.isInteger(maxBends) || maxBends < 0 || maxBends > 32 || obstacles.some(r => !validRect(r))) throw new RangeError('Некорректные параметры маршрута.');
  const onSide = ({ point: p, bounds: r, normal }: RouteEndpoint) => normal === 'left' ? p.x === r.x && between(p.y, r.y, r.y + r.height) : normal === 'right' ? p.x === r.x + r.width && between(p.y, r.y, r.y + r.height) : normal === 'up' ? p.y === r.y && between(p.x, r.x, r.x + r.width) : p.y === r.y + r.height && between(p.x, r.x, r.x + r.width);
  if (!onSide(start) || !onSide(end)) throw new RangeError('Точка должна находиться на указанной стороне фигуры.');
  const boxes = [start.bounds, end.bounds, ...obstacles].map(r => ({ x: r.x - clearance, y: r.y - clearance, width: r.width + clearance * 2, height: r.height + clearance * 2 }));
  if (boxes.some(r => !finitePoint(r) || !Number.isFinite(r.width) || !Number.isFinite(r.height) || !Number.isFinite(r.x + r.width) || !Number.isFinite(r.y + r.height))) throw new RangeError('Слишком большие координаты препятствия.');
  const exitLength = Math.max(stubLength, clearance);
  const s = add(start.point, vectors[start.normal], exitLength), t = add(end.point, vectors[end.normal], exitLength);
  if (!finitePoint(s) || !finitePoint(t) || same(start.point, s) || same(end.point, t)) throw new RangeError('Некорректная длина выхода.');
  if (same(start.point, end.point) || blocked(start.point, s, boxes.slice(1)) || blocked(t, end.point, [boxes[0], ...boxes.slice(2)])) return null;
  const margin = Math.max(1, stubLength, clearance);
  let xs = [...new Set([s.x, t.x, s.x - margin, s.x + margin, t.x - margin, t.x + margin, ...boxes.flatMap(r => [r.x, r.x + r.width]), ...(options.routes ?? []).flatMap(r => r.flatMap(p => [p.x - 20, p.x + 20]))])].sort((a, b) => a - b);
  let ys = [...new Set([s.y, t.y, s.y - margin, s.y + margin, t.y - margin, t.y + margin, ...boxes.flatMap(r => [r.y, r.y + r.height]), ...(options.routes ?? []).flatMap(r => r.flatMap(p => [p.y - 20, p.y + 20]))])].sort((a, b) => a - b);
  // На больших схемах не раздуваем сетку координатами всех прежних связей.
  if (xs.length * ys.length > 10000 && options.routes?.length) {
    xs = [...new Set([s.x, t.x, s.x - margin, s.x + margin, t.x - margin, t.x + margin, ...boxes.flatMap(r => [r.x, r.x + r.width])])].sort((a, b) => a - b);
    ys = [...new Set([s.y, t.y, s.y - margin, s.y + margin, t.y - margin, t.y + margin, ...boxes.flatMap(r => [r.y, r.y + r.height])])].sort((a, b) => a - b);
  }
  if (xs.some(x => !Number.isFinite(x)) || ys.some(y => !Number.isFinite(y)) || xs.length * ys.length > 10000) throw new RangeError('Сетка маршрута слишком велика.');
  type State = { p: Point; dir: Direction; bends: number; length: number; path: Point[] };
  const queue: State[] = [{ p: s, dir: start.normal, bends: 0, length: stubLength, path: [start.point, s] }];
  const less = (a: State, b: State) => options.routes ? a.length + a.bends * 60 < b.length + b.bends * 60 : a.bends < b.bends || (a.bends === b.bends && a.length < b.length);
  const push = (item: State) => {
    queue.push(item); let i = queue.length - 1;
    while (i > 0) { const parent = Math.floor((i - 1) / 2); if (!less(queue[i], queue[parent])) break; [queue[i], queue[parent]] = [queue[parent], queue[i]]; i = parent; }
  };
  const pop = () => {
    const first = queue[0], last = queue.pop()!;
    if (queue.length) {
      queue[0] = last; let i = 0;
      while (true) { const left = i * 2 + 1, right = left + 1; let smallest = i; if (left < queue.length && less(queue[left], queue[smallest])) smallest = left; if (right < queue.length && less(queue[right], queue[smallest])) smallest = right; if (smallest === i) break; [queue[i], queue[smallest]] = [queue[smallest], queue[i]]; i = smallest; }
    }
    return first;
  };
  const best = new Map<string, number>();
  while (queue.length) {
    const cur = pop();
    const key = `${cur.p.x},${cur.p.y},${cur.dir},${cur.bends}`;
    if ((best.get(key) ?? Infinity) < cur.length) continue;
    if (same(cur.p, t)) {
      const lastDir = direction(t, end.point);
      const bends = cur.bends + (cur.dir === lastDir ? 0 : 1);
      const result = simplifyRoute([...cur.path, end.point]);
      if (!opposite(cur.dir, lastDir) && bends <= maxBends && !hasSelfIntersections(result)) return result;
    }
    const xi = xs.indexOf(cur.p.x), yi = ys.indexOf(cur.p.y);
    const neighbors = [xi > 0 ? { x: xs[xi - 1], y: cur.p.y } : null, xi + 1 < xs.length ? { x: xs[xi + 1], y: cur.p.y } : null, yi > 0 ? { x: cur.p.x, y: ys[yi - 1] } : null, yi + 1 < ys.length ? { x: cur.p.x, y: ys[yi + 1] } : null];
    for (const p of neighbors) {
      if (!p || blocked(cur.p, p, boxes)) continue;
      const dir = direction(cur.p, p);
      if (opposite(cur.dir, dir)) continue;
      const bends = cur.bends + (dir === cur.dir ? 0 : 1);
      if (bends > maxBends) continue;
      const path = simplifyRoute([...cur.path, p]);
      if (hasSelfIntersections(path)) continue;
      const length = cur.length + Math.abs(p.x - cur.p.x) + Math.abs(p.y - cur.p.y) + (options.routes ? routeConflictCost(cur.p, p, options.routes) : 0);
      const nextKey = `${p.x},${p.y},${dir},${bends}`;
      if ((best.get(nextKey) ?? Infinity) <= length) continue;
      best.set(nextKey, length);
      push({ p, dir, bends, length, path });
    }
  }
  return null;
}
