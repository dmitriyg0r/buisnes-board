import { strict as assert } from 'node:assert';
import { createGraphNotation } from '../src/modeling/graphNotation';

const notation = createGraphNotation({
  id: 'test', title: 'Тест', fileExtension: 'json',
  symbols: [{ type: 'item', title: 'Объект', shape: 'rectangle', width: 100, height: 60 }],
  connectionTypes: [{ id: 'association', title: 'Связь' }, { id: 'dependency', title: 'Зависимость' }],
  edgeEndProperties: ['association'],
  canConnect: () => true, defaultConnection: () => 'association',
});
let source = notation.createEmpty();
source = notation.addNode(source, 'item', { x: 0, y: 0 });
source = notation.addNode(source, 'item', { x: 300, y: 0 });
const [a, b] = notation.read(source).diagram.nodes;
source = notation.connect(source, a.id, b.id);
const edge = notation.read(source).diagram.edges[0];
assert.equal(edge.ends, undefined, 'Старые связи открываются без новых полей');
assert.equal(notation.edgeEndProperties?.(edge), true);
const ends = { from: { role: 'владелец', multiplicity: '1' }, to: { role: 'товары', multiplicity: '0..*' } };
source = notation.setEdgeEnds!(source, edge.id, ends);
assert.deepEqual(notation.read(source).diagram.edges[0].ends, ends);
source = notation.moveNode(source, b.id, { x: 400, y: 0 });
assert.deepEqual(notation.read(source).diagram.edges[0].ends, ends);
const before = source;
assert.throws(() => notation.setEdgeEnds!(source, edge.id, { ...ends, to: { ...ends.to, multiplicity: '3..1' } }));
assert.equal(source, before);
const tampered = JSON.parse(source); tampered.edges[0].ends.extra = 1;
assert.ok(notation.read(JSON.stringify(tampered)).readOnlyReason);
console.log('Свойства концов связи: создание, валидация и повторное открытие пройдены');
