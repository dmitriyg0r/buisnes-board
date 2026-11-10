import { strict as assert } from 'node:assert';
import { snapRouteSegmentDelta } from '../src/modeling/diagramRouteSnapping';
import { simplifyRoute, type Point } from '../src/modeling/orthogonalRouting';

const horizontal = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 50 }, { x: 50, y: 50 }];
assert.deepEqual(snapRouteSegmentDelta(horizontal, 2, 7, -17, 3), { dx: 7, dy: -20 });
assert.deepEqual(snapRouteSegmentDelta(horizontal, 2, 7, -16.99, 3), { dx: 7, dy: -16.99 });
assert.deepEqual(snapRouteSegmentDelta(horizontal, 2, 0, 28, 2), { dx: 0, dy: 30 });
const vertical = horizontal.map(({ x, y }) => ({ x: y, y: x }));
assert.deepEqual(snapRouteSegmentDelta(vertical, 2, -17, 9, 3), { dx: -20, dy: 9 });
assert.deepEqual(snapRouteSegmentDelta(vertical, 2, 28, 9, 2), { dx: 30, dy: 9 });

// При одинаковом расстоянии выбирается предыдущий соседний участок.
assert.deepEqual(snapRouteSegmentDelta(horizontal, 2, 0, 5, 25), { dx: 0, dy: -20 });
// Один и тот же экранный допуск при двух масштабах передаётся уже в единицах диаграммы.
assert.deepEqual(snapRouteSegmentDelta(horizontal, 2, 0, -16, 8), { dx: 0, dy: -20 });
assert.deepEqual(snapRouteSegmentDelta(horizontal, 2, 0, -16, 2), { dx: 0, dy: -16 });

const anchors = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }, { x: 8, y: 10 }, { x: 8, y: 0 }, { x: 15, y: 0 }];
assert.deepEqual(snapRouteSegmentDelta(anchors, 2, 0, -9, 1), { dx: 0, dy: -10 });
// Прямая между якорями работает и при отсутствии соседних параллельных отрезков.
const anchorLine = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }];
assert.deepEqual(snapRouteSegmentDelta(anchorLine, 1, 0, -9, 1), { dx: 0, dy: -10 });
const remote = [{ x: 0, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 30 }, { x: 6, y: 30 }, { x: 6, y: 10 }, { x: 9, y: 10 }, { x: 9, y: 40 }, { x: 12, y: 40 }];
assert.deepEqual(snapRouteSegmentDelta(remote, 4, 0, -8, 2), { dx: 0, dy: -8 });
assert.deepEqual(snapRouteSegmentDelta(horizontal, 2, 0, 0, -1), { dx: 0, dy: 0 });
assert.deepEqual(snapRouteSegmentDelta([{ x: 0, y: 0 }, { x: 0, y: 0 }], 0, 2, 3, 10), { dx: 2, dy: 3 });

// Геометрия повторяет вызов moveRouteSegment: якоря не сдвигаются,
// даже когда короткий первый или последний отрезок упрощается.
function moveLikeEditor(points: Point[], index: number, dx: number, dy: number): Point[] {
  const next = points.map(p => ({ ...p }));
  const a = next[index], b = next[index + 1];
  const shift = (p: Point) => a.y === b.y ? { x: p.x, y: p.y + dy } : { x: p.x + dx, y: p.y };
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length) return points;
  const fraction = Math.min(16 / length, 1 / 3);
  const start = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
  const end = { x: b.x + (a.x - b.x) * fraction, y: b.y + (a.y - b.y) * fraction };
  next.splice(index, 2, ...(index === 0 ? [a, start, shift(start)] : [shift(a)]), ...(index + 1 === points.length - 1 ? [shift(end), end, b] : [shift(b)]));
  return simplifyRoute(next);
}
for (const i of [0, anchors.length - 2]) {
  const delta = snapRouteSegmentDelta(anchors, i, 0, 9, 1);
  const result = moveLikeEditor(anchors, i, delta.dx, delta.dy);
  assert.deepEqual(result[0], anchors[0]);
  assert.deepEqual(result[result.length - 1], anchors[anchors.length - 1]);
}
const delta = snapRouteSegmentDelta(anchorLine, 1, 0, -9, 1);
assert.deepEqual(moveLikeEditor(anchorLine, 1, delta.dx, delta.dy), [anchorLine[0], anchorLine[3]]);
const before = JSON.stringify(horizontal);
const unsnapped = snapRouteSegmentDelta(horizontal, 2, 4, 3, 1);
assert.deepEqual(moveLikeEditor(horizontal, 2, unsnapped.dx, unsnapped.dy), moveLikeEditor(horizontal, 2, 4, 3));
assert.equal(JSON.stringify(horizontal), before);
console.log('diagram-route-snapping: все проверки пройдены');
