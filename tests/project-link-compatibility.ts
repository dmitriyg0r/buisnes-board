import assert from 'node:assert/strict';
import { emptyModel } from '../src/data';
import { normalizeModel } from '../src/normalize';
import { mergeModel } from '../src/mergeModel';
import { endpointsFaceOutward, routeBetweenNodes, segmentCrossesNode } from '../src/modeling/diagramRouting';
import type { DiagramNode } from '../src/modeling/types';

// Старые идентификаторы и отсутствие геометрии не требуют миграции хранилища.
const legacy = normalizeModel({ cardLinks: [{ id: 'old', from: 'model', to: 'doc', label: 'Старая' }] });
assert.deepEqual(legacy.cardLinks, [{ id: 'old', from: 'proc:main', to: 'doc:main', label: 'Старая' }]);

const manual = { id: 'manual', from: 'doc:a', to: 'doc:b', label: 'Связь', fromSide: 'right' as const, toSide: 'left' as const, fromOffset: 0.25, toOffset: 0.75, routePoints: [{ x: 120, y: 25 }, { x: 120, y: 180 }, { x: 280, y: 180 }] };
const base = { ...structuredClone(emptyModel), cardLinks: [manual], meta: { 'layout:pos': { 'doc:a': '0,0', 'doc:b': '300,0' } } };
const restored = normalizeModel(JSON.parse(JSON.stringify(base)));
assert.deepEqual(restored.cardLinks, [manual], 'ручной маршрут и привязки переживают JSON и нормализацию');
const local = structuredClone(base);
local.meta['layout:pos']['doc:a'] = '20,30';
const remote = structuredClone(base);
remote.meta['layout:pos']['doc:b'] = '320,30';
const merged = mergeModel(base, local, remote);
assert.deepEqual(merged.cardLinks, [manual], 'движение не переписывает ручной маршрут');
assert.deepEqual(merged.meta['layout:pos'], { 'doc:a': '20,30', 'doc:b': '320,30' }, 'независимые перемещения сливаются');
const remoteEdit = structuredClone(base);
remoteEdit.cardLinks[0].routePoints[1].y = 220;
assert.deepEqual(mergeModel(base, local, remoteEdit).cardLinks, remoteEdit.cardLinks, 'удалённое изменение маршрута не теряется при перемещении');

const node = (id: string, x: number, y: number): DiagramNode => ({ id, type: 'card', label: '', x, y, width: 100, height: 80 });
const from = node('from', 0, 0), to = node('to', 400, 0), obstacle = node('obstacle', 200, -10);
const assertRoute = (a: DiagramNode, b: DiagramNode, block: DiagramNode) => {
  const points = routeBetweenNodes([a, b, block], a, b);
  assert.ok(points && points.length >= 2, 'общий маршрутизатор нашёл обход');
  assert.ok(endpointsFaceOutward(points, a, b), 'концы выходят наружу');
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i - 1].x === points[i].x || points[i - 1].y === points[i].y, 'маршрут ортогонален');
    assert.equal(segmentCrossesNode(points[i - 1], points[i], block), false, 'маршрут обходит препятствие');
  }
  return points;
};
const before = assertRoute(from, to, obstacle);
const after = assertRoute({ ...from, y: 100 }, to, obstacle);
assert.notDeepEqual(after[0], before[0], 'при движении карточки пересчитывается якорь');
assert.equal(routeBetweenNodes([from], from, from), null, 'связь с собой не маршрутизируется');
console.log('project-link-compatibility: все тесты пройдены');
