import { strict as assert } from 'node:assert';
import { canConnectUmlActivity as can, defaultUmlActivityConnection as fallback, umlActivityNotation as notation, umlActivitySymbols as symbols } from '../src/modeling/umlActivity';

const oldControl = ['action', 'initial', 'activity-final', 'flow-final', 'decision', 'merge', 'fork', 'join'];
const oldObjects = ['action', 'object', 'decision', 'merge', 'fork', 'join'];
const oldTypes = [...new Set([...oldControl, ...oldObjects])];
for (const from of oldTypes) for (const to of oldTypes) {
  const control = oldControl.includes(from) && oldControl.includes(to) && !['activity-final', 'flow-final'].includes(from) && to !== 'initial';
  const objects = oldObjects.includes(from) && oldObjects.includes(to);
  assert.equal(can(from, to, 'control-flow'), control, `${from} → ${to}: управление`);
  assert.equal(can(from, to, 'object-flow'), objects, `${from} → ${to}: объекты`);
  assert.equal(fallback(from, to), control ? 'control-flow' : objects ? 'object-flow' : undefined);
}
for (const type of ['send-signal', 'accept-signal']) {
  assert(can('initial', type, 'control-flow'));
  assert(can(type, 'activity-final', 'control-flow'));
  assert(can('object', type, 'object-flow'));
  assert(can(type, 'object', 'object-flow'));
  assert(!can(type, 'initial', 'control-flow'));
  assert(!can('flow-final', type, 'control-flow'));
}
for (const symbol of symbols) {
  if (symbol.type === 'comment') continue;
  assert(can('comment', symbol.type, 'comment-link'));
  assert(can(symbol.type, 'comment', 'comment-link'));
  assert.equal(fallback(symbol.type, 'comment'), 'comment-link');
  assert(!can(symbol.type, 'comment', 'control-flow'));
}
assert(!can('comment', 'comment', 'comment-link'));
assert(!can('comment', 'unknown', 'comment-link'));
assert(!can('action', 'action', 'comment-link'));
assert(!can('action', 'action', 'unknown'));

// Диаграмма версии 1, созданная до добавления новых типов.
const legacy = JSON.stringify({ format: 'business-board-graph', version: 1, notation: 'uml-activity', nodes: [
  { id: 'i', type: 'initial', label: '', x: 0, y: 0, width: 30, height: 30 },
  { id: 'a', type: 'action', label: 'Обработать', x: 200, y: 0, width: 150, height: 65 },
  { id: 'o', type: 'object', label: 'Документ', x: 450, y: 0, width: 120, height: 60 },
], edges: [
  { id: 'e1', type: 'control-flow', label: '', from: 'i', to: 'a', points: [{ x: 30, y: 15 }, { x: 200, y: 15 }] },
  { id: 'e2', type: 'object-flow', label: '[готов]', from: 'a', to: 'o', points: [{ x: 350, y: 30 }, { x: 450, y: 30 }] },
] });
assert.equal(notation.read(legacy).readOnlyReason, undefined);
const edited = notation.rename(legacy, 'a', 'Проверить');
assert.equal(notation.read(edited).diagram.edges.length, 2);
assert.equal(notation.read(edited).diagram.nodes.find(node => node.id === 'a')?.label, 'Проверить');
assert.deepEqual(JSON.parse(edited).edges, JSON.parse(legacy).edges);

let source = notation.createEmpty();
for (const [i, type] of ['initial', 'send-signal', 'accept-signal', 'object', 'comment'].entries()) source = notation.addNode(source, type, { x: i * 250, y: 100 });
let diagram = notation.read(source).diagram;
const id = (type: string) => diagram.nodes.find(node => node.type === type)!.id;
source = notation.connect(source, id('initial'), id('send-signal'));
source = notation.connect(source, id('send-signal'), id('accept-signal'), 'control-flow');
source = notation.connect(source, id('accept-signal'), id('object'), 'object-flow');
source = notation.connect(source, id('object'), id('comment'));
diagram = notation.read(source).diagram;
assert.deepEqual(diagram.edges.map(edge => edge.type), ['control-flow', 'control-flow', 'object-flow', 'comment-link']);
assert.equal(diagram.edges[3].lineStyle, 'dashed');
assert.equal(diagram.edges[3].arrowEnd, false);
source = notation.rename(source, id('comment'), 'Условие обработки');
assert.equal(notation.read(source).readOnlyReason, undefined);
assert.equal(notation.read(source).diagram.nodes.find(node => node.type === 'comment')?.label, 'Условие обработки');
assert.throws(() => notation.connect(source, id('comment'), id('initial'), 'object-flow'));
source = notation.remove(source, id('comment'));
assert.equal(notation.read(source).diagram.edges.length, 3);
console.log('UML Activity: совместимость, правила и операции пройдены');
