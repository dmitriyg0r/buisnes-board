import assert from 'node:assert/strict';
import { routeVia } from '../src/Canvas';
import { hasSelfIntersections } from '../src/modeling/orthogonalRouting';

const saved = [{ x: 300, y: 200 }, { x: 300, y: 350 }, { x: 580, y: 350 }, { x: 580, y: 200 }];
const snapshot = structuredClone(saved);
const movedStart = routeVia({ x: 280, y: 220 }, { x: 600, y: 200 }, saved, 'right', 'left');
assert.deepEqual(movedStart, [{ x: 280, y: 220 }, { x: 300, y: 220 }, { x: 300, y: 350 }, { x: 580, y: 350 }, { x: 580, y: 200 }, { x: 600, y: 200 }], 'движение начала не создаёт разворот у первого изгиба');
const resizedEnd = routeVia({ x: 280, y: 200 }, { x: 600, y: 230 }, saved, 'right', 'left');
assert.equal(hasSelfIntersections(resizedEnd), false, 'изменение размера не создаёт петлю у конца');
assert.deepEqual(resizedEnd.at(-2), { x: 580, y: 230 }, 'последний изгиб следует за концом');
assert.deepEqual(routeVia({ x: 280, y: 200 }, { x: 600, y: 200 }, saved, 'right', 'left'),
  [{ x: 280, y: 200 }, ...saved, { x: 600, y: 200 }], 'неподвижный маршрут сохраняется');
const vertical = [{ x: 200, y: 300 }, { x: 350, y: 300 }, { x: 350, y: 580 }, { x: 200, y: 580 }];
const movedVertical = routeVia({ x: 220, y: 280 }, { x: 230, y: 600 }, vertical, 'bottom', 'top');
assert.equal(hasSelfIntersections(movedVertical), false, 'вертикальные порты не создают разворот');
assert.deepEqual(movedVertical, [{ x: 220, y: 280 }, { x: 220, y: 300 }, { x: 350, y: 300 }, { x: 350, y: 580 }, { x: 230, y: 580 }, { x: 230, y: 600 }]);
assert.deepEqual(saved, snapshot, 'исходные ручные точки не изменяются');
console.log('canvas-manual-route: все тесты пройдены');
