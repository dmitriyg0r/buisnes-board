import { strict as assert } from 'node:assert';
import { alignDiagramBox } from '../src/modeling/diagramAlignment.ts';

const a = { x: 0, y: 0, width: 20, height: 20 };
const b = { x: 40, y: 0, width: 20, height: 20 };
let result = alignDiagramBox({ x: 79, y: 2, width: 20, height: 20 }, [a, b], 5);
assert.equal(result.offset.x, 1, 'равный интервал');
assert.equal(result.offset.y, -2, 'общий верх');
assert.equal(result.guides.filter(g => g.kind === 'spacing').length, 2, 'две подсказки равного интервала');
result = alignDiagramBox({ x: 22, y: 30, width: 20, height: 20 }, [a], 4);
assert.equal(result.offset.x, -2, 'выравнивание по краям');
assert(result.guides.some(g => g.kind === 'alignment'));
result = alignDiagramBox({ x: 0, y: 0, width: 20, height: 20 }, [{ x: 1, y: 40, width: 20, height: 20 }], .5);
assert(!result.snappedX, 'вне экранного допуска не притягивается');
result = alignDiagramBox({ x: 39, y: 0, width: 20, height: 20 }, [a, { x: 80, y: 0, width: 20, height: 20 }], 4);
assert.equal(result.offset.x, 1, 'распределение объекта между соседями');
assert(result.guides.some(g => g.kind === 'spacing'));
console.log('diagram-alignment: выравнивание и равные интервалы работают');
