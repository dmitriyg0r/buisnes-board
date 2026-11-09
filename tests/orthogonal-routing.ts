import assert from 'node:assert/strict';
import { hasSelfIntersections, routeOrthogonal, simplifyRoute } from '../src/modeling/orthogonalRouting.ts';
import type { Point, RouteOptions } from '../src/modeling/orthogonalRouting.ts';

const base: RouteOptions = { start: { point: { x: 0, y: 0 }, normal: 'right', bounds: { x: -20, y: -10, width: 20, height: 20 } }, end: { point: { x: 100, y: 0 }, normal: 'left', bounds: { x: 100, y: -10, width: 20, height: 20 } }, clearance: 0, stubLength: 10 };
const segments = (p: Point[]) => p.slice(1).map((end, i) => [p[i], end] as const);
const bends = (p: Point[]) => p.length - 2;
function valid(p: Point[] | null, options: RouteOptions) {
  assert.ok(p);
  assert.deepEqual(p[0], options.start.point);
  assert.deepEqual(p[p.length - 1], options.end.point);
  assert.equal(hasSelfIntersections(p), false);
  assert.ok(segments(p).every(([a, b]) => a.x === b.x || a.y === b.y));
  assert.ok(bends(p) <= (options.maxBends ?? 8));
  const vector = (normal: string) => ({ right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] })[normal]!;
  const [sx, sy] = vector(options.start.normal), [ex, ey] = vector(options.end.normal);
  assert.ok((p[1].x - p[0].x) * sx + (p[1].y - p[0].y) * sy >= (options.stubLength ?? 16));
  assert.ok((p[p.length - 2].x - p[p.length - 1].x) * ex + (p[p.length - 2].y - p[p.length - 1].y) * ey >= (options.stubLength ?? 16));
  for (const [index, r] of [options.start.bounds, options.end.bounds, ...(options.obstacles ?? [])].entries()) {
    const c = options.clearance ?? 8;
    for (const [segmentIndex, [a, b]] of segments(p).entries()) {
      if ((index === 0 && segmentIndex === 0) || (index === 1 && segmentIndex === p.length - 2)) continue;
      const hit = a.y === b.y ? a.y > r.y - c && a.y < r.y + r.height + c && Math.max(Math.min(a.x, b.x), r.x - c) < Math.min(Math.max(a.x, b.x), r.x + r.width + c) : a.x > r.x - c && a.x < r.x + r.width + c && Math.max(Math.min(a.y, b.y), r.y - c) < Math.min(Math.max(a.y, b.y), r.y + r.height + c);
      assert.equal(hit, false, 'Маршрут пересекает препятствие');
    }
  }
}
assert.deepEqual(routeOrthogonal(base), [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
const obstacle: RouteOptions = { ...base, clearance: 5, obstacles: [{ x: 40, y: -10, width: 20, height: 20 }] };
valid(routeOrthogonal(obstacle), obstacle);
assert.equal(routeOrthogonal({ ...obstacle, maxBends: 1 }), null);
const staggered: RouteOptions = { ...base, end: { point: { x: 100, y: 60 }, normal: 'up', bounds: { x: 90, y: 60, width: 20, height: 20 } }, obstacles: [{ x: 40, y: -10, width: 20, height: 50 }, { x: 70, y: 40, width: 15, height: 15 }], clearance: 3 };
valid(routeOrthogonal(staggered), staggered);
const behind: RouteOptions = { ...base, clearance: 5, end: { point: { x: 120, y: 0 }, normal: 'right', bounds: { x: 100, y: -10, width: 20, height: 20 } } };
valid(routeOrthogonal(behind), behind);
assert.throws(() => routeOrthogonal({ ...base, end: { ...base.end, normal: 'right' } }), RangeError);
assert.equal(routeOrthogonal({ ...base, obstacles: [{ x: 3, y: -2, width: 4, height: 4 }] }), null);
assert.deepEqual(simplifyRoute([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }]), [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }]);
assert.equal(hasSelfIntersections([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 10 }, { x: 5, y: -5 }]), true);
assert.equal(hasSelfIntersections([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }]), true);
assert.equal(hasSelfIntersections([{ x: 0, y: 0 }, { x: 1, y: 1 }]), true);
assert.throws(() => routeOrthogonal({ ...base, maxBends: -1 }), RangeError);
assert.throws(() => routeOrthogonal({ ...base, obstacles: [{ x: 0, y: 0, width: Infinity, height: 5 }] }), RangeError);
console.log('orthogonal-routing: все проверки пройдены');
