/**
 * Обход карточек при прокладке связи: маршрут не должен заходить ни на исходную, ни на целевую,
 * ни на другие карточки. Чистые функции без React, чтобы их можно было проверять отдельно.
 */

export type Pos = { x: number; y: number };
export type Box = Pos & { w: number; h: number };
export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Зазор между линией и карточкой, который обход старается соблюдать. */
export const ROUTE_GAP = 10;
/** Штраф за излом: из двух маршрутов равной длины побеждает тот, где поворотов меньше. */
const BEND = 30;
/**
 * Комфортное расстояние от линии до карточки. Обход ищет линии на этом расстоянии, а за проход вдоль
 * карточки ближе него берёт плату, растущую по мере приближения: линия не жмётся к краю, если есть место.
 */
export const COMFORT = 28;
/** Плата за единицу длины отрезка, идущего вплотную к карточке (у самого края). */
const CROWD = 1.5;
/** Слабое «дальнее притяжение»: из равных по длине маршрутов побеждает тот, что идёт подальше от карточек, посреди промежутка. */
const FAR = 150;
const FAR_WEIGHT = 0.03;
/** Обход смотрит только на карточки в этой окрестности связи, остальные не влияют. */
const WINDOW = 400;

export const rectOf = (b: Box, gap = ROUTE_GAP): Rect => ({ x0: b.x - gap, y0: b.y - gap, x1: b.x + b.w + gap, y1: b.y + b.h + gap });

/** Горизонтальный или вертикальный отрезок заходит внутрь прямоугольника (касание границы не считается). */
export const segHits = (p: Pos, q: Pos, r: Rect) => Math.max(p.x, q.x) > r.x0 && Math.min(p.x, q.x) < r.x1 && Math.max(p.y, q.y) > r.y0 && Math.min(p.y, q.y) < r.y1;

/**
 * Заходит ли маршрут на какую-либо из карточек. Первый отрезок (из карточки) и последний (в карточку)
 * не проверяются: они начинаются и кончаются на краю карточки.
 */
export function routeHits(route: Pos[], rects: Rect[]): boolean {
  for (let i = 1; i < route.length - 2; i++) if (rects.some((r) => segHits(route[i], route[i + 1], r))) return true;
  return false;
}

const DIRS: Pos[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
const dirIndex = (v: Pos) => DIRS.findIndex((d) => d.x === Math.sign(v.x) && d.y === Math.sign(v.y));
const rd = (n: number) => Math.round(n * 100) / 100;

/**
 * Кратчайший ортогональный маршрут от точки выхода `out` до точки входа `into`, не заходящий в прямоугольники.
 * Узлы сетки: координаты выхода, входа и краёв прямоугольников. Движение по сетке, цена: длина плюс штраф за излом.
 * `first` задаёт направление, в котором связь уходит с карточки, `last` направление, в котором входит в неё.
 * Возвращает точки от `out` до `into` включительно или null, если пути нет.
 */
export function routeAround(out: Pos, into: Pos, rects: Rect[], first: Pos, last: Pos): Pos[] | null {
  const near = rects.filter((r) => r.x1 > Math.min(out.x, into.x) - WINDOW && r.x0 < Math.max(out.x, into.x) + WINDOW && r.y1 > Math.min(out.y, into.y) - WINDOW && r.y0 < Math.max(out.y, into.y) + WINDOW);
  const uniq = (v: number[]) => [...new Set(v.map(rd))].sort((a, b) => a - b);
  // между соседними координатами добавляем середину: по ней линия идёт посреди промежутка между карточками
  const withMid = (v: number[]) => v.flatMap((n, i) => (i + 1 < v.length ? [n, rd((n + v[i + 1]) / 2)] : [n]));
  // сами карточки (прямоугольники пришли с зазором ROUTE_GAP)
  const boxes: Rect[] = near.map((r) => ({ x0: r.x0 + ROUTE_GAP, y0: r.y0 + ROUTE_GAP, x1: r.x1 - ROUTE_GAP, y1: r.y1 - ROUTE_GAP }));
  // линии сетки: края с зазором, а также линии на комфортном расстоянии от карточек
  const xs = withMid(uniq([out.x, into.x, ...near.flatMap((r) => [r.x0, r.x1]), ...boxes.flatMap((b) => [b.x0 - COMFORT, b.x1 + COMFORT])]));
  const ys = withMid(uniq([out.y, into.y, ...near.flatMap((r) => [r.y0, r.y1]), ...boxes.flatMap((b) => [b.y0 - COMFORT, b.y1 + COMFORT])]));
  /**
   * Плата за тесноту: отрезок идёт сбоку от карточки ближе COMFORT. Для отрезка, который подходит к карточке
   * торцом (проходит в её полосе), тесноты нет, это обычный заход.
   */
  const crowd = (p: Pos, q: Pos) => {
    let extra = 0;
    const add = (d: number, overlap: number) => {
      if (overlap <= 0) return;
      if (d < COMFORT) extra += overlap * CROWD * (1 - d / COMFORT);
      if (d < FAR) extra += overlap * FAR_WEIGHT * (1 - d / FAR);
    };
    for (const b of boxes) {
      if (p.x === q.x) {
        const d = p.x < b.x0 ? b.x0 - p.x : p.x > b.x1 ? p.x - b.x1 : -1;
        if (d >= 0) add(d, Math.min(Math.max(p.y, q.y), b.y1 + FAR) - Math.max(Math.min(p.y, q.y), b.y0 - FAR));
      } else {
        const d = p.y < b.y0 ? b.y0 - p.y : p.y > b.y1 ? p.y - b.y1 : -1;
        if (d >= 0) add(d, Math.min(Math.max(p.x, q.x), b.x1 + FAR) - Math.max(Math.min(p.x, q.x), b.x0 - FAR));
      }
    }
    return extra;
  };
  const si = xs.indexOf(rd(out.x));
  const sj = ys.indexOf(rd(out.y));
  const ei = xs.indexOf(rd(into.x));
  const ej = ys.indexOf(rd(into.y));
  const startDir = dirIndex(first);
  const endDir = dirIndex(last);
  if (si < 0 || sj < 0 || ei < 0 || ej < 0 || startDir < 0) return null;

  const id = (i: number, j: number, d: number) => (i * ys.length + j) * 4 + d;
  const cost = new Map<number, number>();
  const from = new Map<number, number>();
  const done = new Set<number>();
  const open: { i: number; j: number; d: number; c: number }[] = [{ i: si, j: sj, d: startDir, c: 0 }];
  cost.set(id(si, sj, startDir), 0);
  let best = Infinity;
  let bestState = -1;

  while (open.length) {
    let m = 0;
    for (let k = 1; k < open.length; k++) if (open[k].c < open[m].c) m = k;
    const cur = open.splice(m, 1)[0];
    if (cur.c >= best) break;
    const key = id(cur.i, cur.j, cur.d);
    if (done.has(key)) continue;
    done.add(key);
    if (cur.i === ei && cur.j === ej) {
      const total = cur.c + (endDir >= 0 && cur.d !== endDir ? BEND : 0);
      if (total < best) {
        best = total;
        bestState = key;
      }
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (cur.d + 2) % 4) continue; // разворот на месте не нужен
      const ni = cur.i + DIRS[nd].x;
      const nj = cur.j + DIRS[nd].y;
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue;
      const p = { x: xs[cur.i], y: ys[cur.j] };
      const q = { x: xs[ni], y: ys[nj] };
      if (near.some((r) => segHits(p, q, r))) continue;
      const c = cur.c + Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + (nd !== cur.d ? BEND : 0) + crowd(p, q);
      const nk = id(ni, nj, nd);
      if (c < (cost.get(nk) ?? Infinity)) {
        cost.set(nk, c);
        from.set(nk, key);
        open.push({ i: ni, j: nj, d: nd, c });
      }
    }
  }
  if (bestState < 0) return null;

  const path: Pos[] = [];
  for (let k: number | undefined = bestState; k !== undefined; k = from.get(k)) {
    const cell = Math.floor(k / 4);
    path.push({ x: xs[Math.floor(cell / ys.length)], y: ys[cell % ys.length] });
  }
  return path.reverse();
}
