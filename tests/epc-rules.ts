import { strict as assert } from 'node:assert';
import { validateEpcDiagram } from '../src/modeling/epcValidation';
import type { Diagram, DiagramNode, DiagramEdge } from '../src/modeling/types';

const node = (id: string, type: string): DiagramNode => ({ id, type, label: id, x: 0, y: 0, width: 100, height: 60 });
const edge = (from: string, to: string, type = 'flow'): DiagramEdge => ({ id: `${type}-${from}-${to}`, from, to, type, label: '', points: [] });
const graph = (types: string[], links: [number, number][]): Diagram => ({ nodes: types.map((type, i) => node(String(i), type)), edges: links.map(([a, b]) => edge(String(a), String(b))) });
const validate = (types: string[], links: [number, number][]) => validateEpcDiagram(graph(types, links));
const has = (warnings: ReturnType<typeof validateEpcDiagram>, id: string, text: string) => warnings.some(w => w.id === id && w.message.includes(text));

assert.deepEqual(validate([], []), []);
assert.deepEqual(validate(['event'], []), []);
assert.ok(has(validate(['function'], []), '0', 'вход'));
assert.ok(has(validate(['xor'], []), '0', 'ветвления'));
assert.deepEqual(validate(['event', 'function', 'event'], [[0, 1], [1, 2]]), []);
assert.deepEqual(validate(['process-interface', 'function', 'process-interface'], [[0, 1], [1, 2]]), []);
assert.deepEqual(validate(['event', 'process-interface', 'event'], [[0, 1], [1, 2]]), []);

for (const op of ['and', 'or', 'xor']) {
  const complete = graph(['event', 'function', op, 'event', 'event', 'function', 'function', 'event', 'event', op, 'function', 'event'],
    [[0,1],[1,2],[2,3],[2,4],[3,5],[4,6],[5,7],[6,8],[7,9],[8,9],[9,10],[10,11]]);
  assert.deepEqual(validateEpcDiagram(complete), [], `${op}: полный процесс`);
  assert.ok(has(validate(['event', op, 'function', 'function'], [[0,1],[1,2],[1,3]]), '1', 'событи') === (op !== 'and'));
  assert.ok(!has(validate(['event', 'event', op, 'function', 'event'], [[0,2],[1,2],[2,3],[3,4]]), '2', 'выбор ветви'), `${op}: слияние после события`);
  assert.ok(has(validate([op], []), '0', 'ветвления'));
  assert.ok(has(validate(['event', op, 'function'], [[0,1],[1,2]]), '1', 'ветвления'));
}
assert.ok(has(validate(['event','and','xor','function','function'], [[0,1],[1,2],[2,3],[2,4]]), '2', 'выбор ветви'));
assert.ok(has(validate(['event','event'], [[0,1]]), '0', 'чередование'));
assert.ok(has(validate(['function','and','function'], [[0,1],[1,2]]), '0', 'чередование'));
assert.ok(has(validate(['event','function','function'], [[0,1],[0,2]]), '0', 'выход'));
assert.ok(has(validate(['event','event','function'], [[0,2],[1,2]]), '2', 'вход'));
assert.ok(has(validate(['function','event'], [[0,1]]), '0', 'начальное событие'));
assert.ok(has(validate(['event','function'], [[0,1]]), '0', 'конечное событие'));

// Цикл с выходом: XOR-слияние, функция, XOR-ветвление и повтор.
const loop = graph(['event','xor','function','xor','event','function','event','event'], [[0,1],[1,2],[2,3],[3,4],[3,7],[4,5],[5,6],[6,1]]);
assert.deepEqual(validateEpcDiagram(loop), []);
const closed = validate(['event','function'], [[0,1],[1,0]]);
assert.ok(closed.some(w => w.message.includes('начальное событие')));
assert.ok(closed.some(w => w.message.includes('конечное событие')));
const disconnected = graph(['event','function','event','event','function'], [[0,1],[1,2],[3,4],[4,3]]);
const disconnectedWarnings = validateEpcDiagram(disconnected);
assert.ok(has(disconnectedWarnings, '3', 'нет пути от начального'));
assert.ok(has(disconnectedWarnings, '4', 'нет пути к конечному'));

const extra = graph(['event','function','event','role','document'], [[0,1],[1,2]]);
extra.edges.push(edge('3','1','resource'), edge('1','4','output'));
assert.deepEqual(validateEpcDiagram(extra), []);
const dangling = graph(['event','function'], [[0,1]]);
dangling.edges.push(edge('1', 'unknown'));
assert.ok(!validateEpcDiagram(dangling).some(w => w.message.includes('Не найдено')));
const snapshot = JSON.stringify(extra);
validateEpcDiagram(extra);
assert.equal(JSON.stringify(extra), snapshot, 'Валидатор не должен менять модель');
console.log('EPC: проверки правил, циклов, интерфейсов и частичных моделей пройдены');
