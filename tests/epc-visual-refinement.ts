import assert from 'node:assert/strict';
import { epcNotation, epcSymbols } from '../src/modeling/epc';

for (const symbol of epcSymbols) {
  const operator = ['and', 'or', 'xor'].includes(symbol.type);
  assert.deepEqual([symbol.width, symbol.height], operator ? [50, 50] : [160, 64]);
  assert.equal(symbol.shape, operator ? 'circle' : symbol.type === 'event' ? 'hexagon' : symbol.type === 'file' ? 'rectangle' : 'rounded-rectangle');
  if (!operator) assert.equal(symbol.appearance?.icon, symbol.type);
}
let source = epcNotation.createEmpty();
source = epcNotation.addNode(source, 'event', { x: 10, y: 20 });
source = epcNotation.addNode(source, 'function', { x: 300, y: 20 });
const [event, fn] = epcNotation.read(source).diagram.nodes;
source = epcNotation.connect(source, event.id, fn.id, 'flow');
const edge = epcNotation.read(source).diagram.edges[0];
assert.deepEqual(edge.points[0], { x: event.x + event.width, y: event.y + event.height / 2 });
const before = JSON.parse(source);
source = epcNotation.rename(source, fn.id, 'Заявка обработана');
const after = JSON.parse(source);
assert.deepEqual(after.edges, before.edges);
assert.deepEqual(after.nodes[0], before.nodes[0]);
source = epcNotation.moveNode(source, event.id, { x: 20, y: 30 });
const moved = epcNotation.read(source).diagram;
assert.deepEqual(moved.edges[0].points[0], { x: 180, y: 62 });
assert.equal(moved.edges[0].id, edge.id);
assert.equal(moved.nodes[1].label, 'Заявка обработана');
console.log('EPC: размеры, контуры, пиктограммы, связь и перемещение проверены');
