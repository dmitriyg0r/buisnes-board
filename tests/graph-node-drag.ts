import assert from 'node:assert/strict';
import { epcNotation } from '../src/modeling/epc';
import { umlClassNotation } from '../src/modeling/umlClass';
import { umlActivityNotation } from '../src/modeling/umlActivity';
import { umlUseCaseNotation } from '../src/modeling/umlUseCase';
import type { DiagramNotation } from '../src/modeling/types';

function create(notation: DiagramNotation & { createEmpty: () => string }, first: string, second: string) {
  let source = notation.addNode(notation.createEmpty(), first, { x: 100, y: 100 });
  source = notation.addNode(source, second, { x: 500, y: 100 });
  const [a, b] = notation.read(source).diagram.nodes;
  source = notation.connect(source, a.id, b.id);
  return { source, a, b };
}
for (const [notation, first, second] of [[epcNotation, 'event', 'function'], [umlClassNotation, 'class', 'class'], [umlActivityNotation, 'action', 'action'], [umlUseCaseNotation, 'actor', 'use-case']] as const) {
  let { source, a, b } = create(notation, first, second);
  const initial = notation.read(source).diagram.edges[0];
  const start = initial.points[0], finish = initial.points[initial.points.length - 1];
  for (const at of [{x:100,y:200}, {x:100,y:300}, {x:150,y:300}, {x:100,y:200}, {x:100,y:100}]) {
    source = notation.moveNode(source, a.id, at);
    const edge = notation.read(source).diagram.edges[0];
    assert.equal(edge.id, initial.id);
    assert.ok(edge.points.length <= 6, `${notation.id}: накопились лишние изгибы: ${JSON.stringify(edge.points)}`);
    assert.deepEqual(edge.points[edge.points.length - 1], finish);
  }
  const restored = notation.read(source).diagram.edges[0];
  assert.deepEqual(restored.points[0], start);
  assert.ok(restored.points.length <= Math.max(4, initial.points.length), `${notation.id}: лишние изгибы не исчезли`);
  source = notation.moveNode(source, b.id, { x: 500, y: 230 });
  const afterTarget = notation.read(source).diagram.edges[0];
  assert.deepEqual(afterTarget.points[0], start);
  assert.deepEqual(afterTarget.points.at(-1), { x: finish.x, y: finish.y + 130 });
  assert.ok(afterTarget.points.length <= 6);
  const reopened = notation.read(JSON.stringify(JSON.parse(source))).diagram.edges[0];
  assert.deepEqual(reopened.points, afterTarget.points);
  const resized = notation.resizeNode!(source, b.id, b.width * 1.2, b.height * 1.2);
  const resizedEdge = notation.read(resized).diagram.edges[0];
  assert.deepEqual(resizedEdge.points[0], start);
  assert.ok(resizedEdge.points.length <= 6);
}
// Связанные элементы можно перекрывать и разносить, не теряя ID или якоря.
for (const [notation, first, second] of [[epcNotation, 'event', 'function'], [umlClassNotation, 'class', 'class'], [umlActivityNotation, 'action', 'action'], [umlUseCaseNotation, 'actor', 'use-case']] as const) {
  let { source, a, b } = create(notation, first, second);
  const edge = notation.read(source).diagram.edges[0];
  const fixed = edge.points.at(-1);
  source = notation.moveNode(source, a.id, { x: b.x, y: b.y });
  let diagram = notation.read(source).diagram;
  assert.deepEqual({ x: diagram.nodes[0].x, y: diagram.nodes[0].y }, { x: b.x, y: b.y }, `${notation.id}: полное наложение`);
  assert.equal(diagram.edges[0].id, edge.id);
  assert.deepEqual(diagram.edges[0].points.at(-1), fixed);
  source = notation.resizeNode!(source, a.id, a.width + 150, a.height + 100);
  diagram = notation.read(JSON.stringify(JSON.parse(source))).diagram;
  assert.equal(diagram.nodes[0].width, a.width + 150);
  assert.equal(diagram.edges[0].id, edge.id);
  assert.deepEqual(diagram.edges[0].points.at(-1), fixed);
  source = notation.moveNode(source, a.id, { x: 100, y: 100 });
  diagram = notation.read(source).diagram;
  assert.equal(diagram.nodes[0].x, 100);
  assert.equal(diagram.edges[0].id, edge.id);
}
{
  const n = epcNotation;
  let { source, a, b } = create(n, 'event', 'function');
  const edge = n.read(source).diagram.edges[0];
  const manual = [{x:260,y:132},{x:300,y:132},{x:300,y:260},{x:460,y:260},{x:460,y:132},{x:500,y:132}];
  source = n.editEdge(source, edge.id, a.id, b.id, manual);
  source = n.rename(source, edge.id, 'ручной маршрут');
  source = n.moveNode(source, a.id, { x: 100, y: 150 });
  const moved = n.read(source).diagram.edges[0];
  assert.equal(moved.label, 'ручной маршрут');
  assert.ok(moved.points.some(p => p.x === 300 && p.y === 260), 'Потерян ручной промежуточный изгиб');
  assert.ok(moved.points.some(p => p.x === 460 && p.y === 260), 'Потерян ручной промежуточный изгиб');
  assert.deepEqual(moved.points.at(-1), {x:500,y:132});
}
console.log('EPC и UML: движение концов и сохранение ручных маршрутов — OK');
