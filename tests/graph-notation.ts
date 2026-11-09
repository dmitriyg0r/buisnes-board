import { strict as assert } from 'node:assert';
import { createGraphNotation } from '../src/modeling/graphNotation';

const notation = createGraphNotation({
  id: 'test', title: 'Тест', fileExtension: 'test',
  symbols: [{ type: 'box', title: 'Блок', shape: 'rectangle', width: 100, height: 60 }, { type: 'other', title: 'Другой', shape: 'rectangle', width: 100, height: 60 }],
  connectionTypes: [{ id: 'flow', title: 'Поток', appearance: { lineStyle: 'dashed', startMarker: 'diamond-filled', arrowStyle: 'triangle', arrowEnd: true } }],
  canConnect: (a, b, edge) => a === 'box' && b === 'box' && edge === 'flow',
  defaultConnection: (a, b) => a === 'box' && b === 'box' ? 'flow' : undefined,
});
let source = notation.createEmpty();
assert.deepEqual(notation.read(source).diagram, { nodes: [], edges: [] });
source = notation.addNode(source, 'box', { x: 0, y: 0 });
source = notation.addNode(source, 'box', { x: 300, y: 0 });
source = notation.addNode(source, 'other', { x: 600, y: 0 });
const [a, b, c] = notation.read(source).diagram.nodes;
assert.equal(new Set([a.id, b.id, c.id]).size, 3);
assert.throws(() => notation.connect(source, a.id, c.id));
assert.throws(() => notation.connect(source, a.id, b.id, 'bad'));
assert.throws(() => notation.connect(source, a.id, a.id));
source = notation.connect(source, a.id, b.id);
let edge = notation.read(source).diagram.edges[0];
assert.equal(edge.type, 'flow'); assert.equal(edge.startMarker, 'diamond-filled'); assert.equal(edge.arrowStyle, 'triangle');
source = notation.rename(source, edge.id, 'Метка');
source = notation.rename(source, a.id, 'Узел');
source = notation.setLabelBounds!(source, a.id, { x: 10, y: 10, width: 30, height: 20 });
source = notation.setLabelBounds!(source, edge.id, { x: 150, y: 10, width: 30, height: 20 });
source = notation.moveNode(source, a.id, { x: 20, y: 30 });
assert.deepEqual(notation.read(source).diagram.nodes[0].labelBounds, { x: 30, y: 40, width: 30, height: 20 });
source = notation.resizeNode!(source, a.id, 200, 120);
assert.deepEqual(notation.read(source).diagram.nodes[0].labelBounds, { x: 40, y: 50, width: 60, height: 40 });
edge = notation.read(source).diagram.edges[0];
assert.equal(edge.label, 'Метка'); assert.equal(edge.id, notation.read(source).diagram.edges[0].id);
assert.throws(() => notation.editEdge(source, edge.id, a.id, c.id, edge.points));
source = notation.editEdge(source, edge.id, a.id, b.id, edge.points);
source = notation.resetEdge(source, edge.id);
assert.equal(notation.read(source).diagram.edges[0].label, 'Метка');
assert.throws(() => notation.resizeNode!(source, a.id, -1, 20));
assert.throws(() => notation.remove(source, 'нет'));
for (const mutate of [
  (g: any) => { g.version = 99; },
  (g: any) => { g.extra = { future: true }; },
  (g: any) => { g.nodes[0].extra = { nested: true }; },
  (g: any) => { g.edges[0].points[0].extra = true; },
  (g: any) => { g.edges[0].labelBounds.extra = true; },
  (g: any) => { g.nodes[0].labelBounds.extra = true; },
  (g: any) => { g.edges[0].extra = true; },
]) {
  const graph = JSON.parse(source); mutate(graph); const original = JSON.stringify(graph);
  assert.ok(notation.read(original).readOnlyReason);
  assert.throws(() => notation.rename(original, a.id, 'Изменение'));
  assert.deepEqual(JSON.parse(original), graph);
}
assert.ok(notation.read('{').readOnlyReason);
// Ручные точки и привязки переживают движение, масштабирование и повторное открытие.
{
  let manual = notation.createEmpty();
  for (const at of [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 400 }, { x: 400, y: 400 }]) manual = notation.addNode(manual, 'box', at);
  const [one, two, three, four] = notation.read(manual).diagram.nodes;
  manual = notation.connect(manual, one.id, two.id);
  manual = notation.connect(manual, three.id, four.id);
  const [first, unrelated] = notation.read(manual).diagram.edges;
  const points = [{ x: 100, y: 20 }, { x: 260, y: 20 }, { x: 260, y: 120 }, { x: 350, y: 120 }, { x: 350, y: 40 }, { x: 400, y: 40 }];
  manual = notation.editEdge(manual, first.id, one.id, two.id, points);
  manual = notation.rename(manual, first.id, 'Ручная связь');
  const beforeMove = manual;
  assert.equal(notation.moveNode(manual, one.id, { x: 0, y: 0 }), manual);
  assert.equal(notation.resizeNode!(manual, one.id, 100, 60), manual);
  assert.throws(() => notation.moveNode(manual, one.id, { x: Infinity, y: 0 }));
  assert.throws(() => notation.editEdge(manual, first.id, one.id, two.id, [{ x: NaN, y: 0 }, { x: 1, y: 1 }]));
  assert.throws(() => notation.editEdge(manual, first.id, one.id, two.id, [{ x: 100, y: 20 }, { x: 400, y: 40 }]));
  const movedTarget = notation.moveNode(beforeMove, two.id, { x: 420, y: 10 });
  const targetPoints = notation.read(movedTarget).diagram.edges[0].points;
  assert.deepEqual(targetPoints[0], points[0]);
  assert.deepEqual(targetPoints.at(-1), { x: 420, y: 50 });
  for (const waypoint of points.slice(1, -1)) assert.ok(targetPoints.some(p => p.x === waypoint.x && p.y === waypoint.y));
  const untouched = JSON.stringify(JSON.parse(manual).edges[1]);
  manual = notation.moveNode(manual, one.id, { x: 20, y: 10 });
  let reopened = notation.read(manual);
  assert.deepEqual(reopened.diagram.edges[0].points[0], { x: 120, y: 30 });
  assert.deepEqual(reopened.diagram.edges[0].points.at(-1), points.at(-1));
  for (const waypoint of points.slice(1, -1)) assert.ok(reopened.diagram.edges[0].points.some(p => p.x === waypoint.x && p.y === waypoint.y));
  assert.equal(JSON.stringify(JSON.parse(manual).edges[1]), untouched);
  assert.throws(() => notation.resizeNode!(manual, one.id, 380, 120));
  manual = notation.resizeNode!(beforeMove, one.id, 200, 120);
  reopened = notation.read(JSON.stringify(JSON.parse(manual)));
  assert.deepEqual(reopened.diagram.edges[0].points[0], { x: 200, y: 40 });
  for (const waypoint of points.slice(1, -1)) assert.ok(reopened.diagram.edges[0].points.some(p => p.x === waypoint.x && p.y === waypoint.y));
  assert.equal(reopened.diagram.edges[0].id, first.id);
  assert.equal(reopened.diagram.edges[0].label, 'Ручная связь');
  assert.equal(reopened.diagram.edges[1].id, unrelated.id);
  assert.equal(JSON.stringify(JSON.parse(manual).edges[1]), untouched);
}
source = notation.remove(source, a.id);
assert.equal(notation.read(source).diagram.edges.length, 0);
assert.equal(notation.read(source).diagram.nodes.length, 2);
console.log('GraphNotation: проверки пройдены');
