import { strict as assert } from 'node:assert';
import { validateEpcDiagram } from '../src/modeling/epc';
import type { Diagram, DiagramNode, DiagramEdge } from '../src/modeling/types';
const node = (id: string, type: string): DiagramNode => ({ id, type, label: id, x: 0, y: 0, width: 100, height: 60 });
const flow = (from: string, to: string): DiagramEdge => ({ id: `${from}-${to}`, type: 'flow', label: '', from, to, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
const diagram: Diagram = { nodes: [node('a', 'event'), node('b', 'and'), node('c', 'event'), node('d', 'function')], edges: [flow('a', 'b'), flow('b', 'c'), flow('b', 'd')] };
assert.ok(validateEpcDiagram(diagram).some(item => item.id === 'a' && item.message.includes('чередование')));
assert.ok(!validateEpcDiagram(diagram).some(item => item.id === 'b'));
const incomplete = { ...diagram, edges: diagram.edges.slice(0, 2) };
assert.ok(validateEpcDiagram(incomplete).some(item => item.id === 'b'));
const cyclic = { ...diagram, edges: [...diagram.edges, flow('b', 'b')] };
assert.ok(validateEpcDiagram(cyclic).length > 0);
const check = (types: string[], links: [number, number][]) => validateEpcDiagram({
  nodes: types.map((type, i) => node(`${i}`, type)),
  edges: links.map(([from, to]) => flow(`${from}`, `${to}`)),
});
for (const op of ['xor', 'or']) {
  const warnings = check(['event', op, 'function', 'function'], [[0, 1], [1, 2], [1, 3]]);
  assert.ok(warnings.some(w => w.id === '1' && w.message.includes('событи')), `${op}: событие не выбирает ветвь`);
  assert.ok(!check(['function', op, 'event', 'event'], [[0, 1], [1, 2], [1, 3]]).some(w => w.id === '1'), `${op}: функция выбирает ветвь`);
}
assert.ok(!check(['event', 'and', 'function', 'function'], [[0, 1], [1, 2], [1, 3]]).some(w => w.id === '1'));
assert.ok(check(['event', 'and', 'xor', 'function', 'function'], [[0, 1], [1, 2], [2, 3], [2, 4]]).some(w => w.id === '2' && w.message.includes('событи')));
assert.ok(check(['event', 'function', 'function'], [[0, 1], [0, 2]]).some(w => w.id === '0' && w.message.includes('выход')));
assert.ok(check(['event', 'event', 'function'], [[0, 2], [1, 2]]).some(w => w.id === '2' && w.message.includes('вход')));
assert.ok(check(['function'], []).some(w => w.id === '0' && w.message.includes('вход')));
assert.ok(check(['xor'], []).some(w => w.id === '0'));
assert.ok(!check(['event'], []).some(w => w.id === '0'));
assert.ok(!check(['event', 'process-interface', 'event'], [[0, 1], [1, 2]]).some(w => w.message.includes('чередование')));
assert.ok(!check(['event', 'function', 'role'], [[0, 1]]).some(w => w.id === '0' && w.message.includes('более одного')));
console.log('EPC: предупреждения о чередовании и ветвлениях пройдены');
