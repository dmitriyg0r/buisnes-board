import assert from 'node:assert/strict';
import { editLinkSegment, validCardRoute } from '../src/canvasLinkEditing';
import type { SegmentEdit } from '../src/canvasLinkEditing';

const base: SegmentEdit = {
  points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 80, y: 30 }, { x: 80, y: 60 }, { x: 110, y: 60 }],
  index: 2, dx: 0, dy: 10, tolerance: 7,
  startBounds: { x: -20, y: -10, width: 20, height: 20 },
  endBounds: { x: 110, y: 50, width: 20, height: 20 },
};
const edit = (patch: Partial<SegmentEdit>) => editLinkSegment({ ...base, ...patch });
const copy = JSON.stringify(base);
assert.deepEqual(edit({}), [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }, { x: 80, y: 40 }, { x: 80, y: 60 }, { x: 110, y: 60 }]);
assert.equal(JSON.stringify(base), copy, 'вход не меняется');
assert.deepEqual(edit({ index: 1, dx: 10, dy: 999 }), [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 80, y: 30 }, { x: 80, y: 60 }, { x: 110, y: 60 }]);
assert.deepEqual(edit({ dy: -23 }), [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 60 }, { x: 110, y: 60 }], 'магнит включён на границе 7');
assert.equal(edit({ dy: -22 })?.[2].y, 8, 'вне допуска');
assert.equal(edit({ index: 1, dx: -40, tolerance: 0 }), null, 'разворот концевой нормали запрещён');
assert.equal(edit({ points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 50 }, { x: 10, y: 50 }, { x: 10, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 60 }, { x: 110, y: 60 }], index: 3, dx: 55, tolerance: 0 }), null, 'самопересечение запрещено');
assert.equal(edit({ obstacles: [{ x: 40, y: 35, width: 20, height: 10 }] }), null, 'новое препятствие');
assert.ok(edit({ obstacles: [{ x: 40, y: 40, width: 20, height: 10 }] }), 'граница карточки допустима');
const existing = { x: 5, y: -5, width: 10, height: 10 };
assert.ok(edit({ obstacles: [existing] }), 'неизменённое историческое пересечение допустимо');
assert.equal(edit({ index: 0, dy: 10, tolerance: 0, obstacles: [{ x: 20, y: -5, width: 5, height: 20 }] }), null, 'историческое пересечение не переносится на новую геометрию');
assert.ok(edit({ index: 0, dy: 10, tolerance: 0 }), 'концевой сегмент сохраняет нормаль и якорь');
assert.ok(edit({ index: 4, dy: -10, tolerance: 0 }), 'конечный сегмент сохраняет нормаль и якорь');
assert.equal(edit({ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }), null, 'диагональная историческая порча');
assert.equal(edit({ index: 99 }), null);
assert.equal(edit({ dx: Infinity }), null);
assert.equal(edit({ tolerance: -1 }), null);
assert.equal(edit({ obstacles: [{ x: 0, y: 0, width: -1, height: 2 }] }), null);
assert.equal(edit({ dy: -23, obstacles: [{ x: 50, y: -5, width: 10, height: 10 }] }), null, 'опасная магнитная цель не заменяется тайно');
const start = { x: 0, y: 0, width: 100, height: 100 }, end = { x: 300, y: 0, width: 100, height: 100 };
assert.ok(validCardRoute([{ x: 100, y: 50 }, { x: 300, y: 50 }], 'right', 'left', start, end));
assert.equal(validCardRoute([{ x: 100, y: 50 }, { x: 80, y: 50 }, { x: 80, y: 150 }, { x: 300, y: 150 }, { x: 300, y: 50 }], 'right', 'bottom', start, end), false, 'выход внутрь карточки запрещён');
assert.equal(validCardRoute([{ x: 100, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 150 }, { x: 150, y: 150 }, { x: 150, y: 20 }, { x: 250, y: 20 }, { x: 250, y: 50 }, { x: 300, y: 50 }], 'right', 'left', start, end), false, 'самопересекающийся маршрут запрещён');
assert.equal(validCardRoute([{ x: 100, y: 50 }, { x: 300, y: 50 }], 'right', 'left', start, end, [{ x: 180, y: 20, width: 40, height: 60 }]), false, 'пересечение препятствия запрещено');
console.log('canvas-link-editing: все тесты пройдены');
