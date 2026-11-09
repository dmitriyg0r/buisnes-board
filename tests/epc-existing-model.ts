import assert from 'node:assert/strict';
import { epcNotation } from '../src/modeling/epc';

// Данные, сохранённые до изменения палитры: оформления в модели нет.
const original = JSON.stringify({ format: 'business-board-graph', version: 1, notation: 'epc', nodes: [
  { id: 'event-1', type: 'event', label: 'Заявка получена', x: 10, y: 20, width: 150, height: 60 },
  { id: 'employee-1', type: 'internal-employee', label: 'Исполнитель', x: 320, y: 20, width: 70, height: 100 },
], edges: [] });
const before = epcNotation.read(original);
assert.equal(before.readOnlyReason, undefined);
assert.deepEqual(before.diagram.nodes.map(({ id, label, x, y, width, height }) => ({ id, label, x, y, width, height })), [
  { id: 'event-1', label: 'Заявка получена', x: 10, y: 20, width: 150, height: 60 },
  { id: 'employee-1', label: 'Исполнитель', x: 320, y: 20, width: 70, height: 100 },
]);
const updated = epcNotation.rename(original, 'event-1', 'Заявка зарегистрирована');
const reopened = epcNotation.read(updated);
assert.equal(reopened.readOnlyReason, undefined);
assert.deepEqual(reopened.diagram.nodes[1], before.diagram.nodes[1]);
assert.equal(reopened.diagram.nodes[0].label, 'Заявка зарегистрирована');
assert.equal(JSON.parse(original).nodes[0].label, 'Заявка получена');
console.log('EPC: существующие ID, подписи и геометрия сохранены');
