import { strict as assert } from 'node:assert';
import { addSequenceExecution, parseSequence, projectSequence, serializeSequence, umlSequenceNotation as sequence } from '../src/modeling/umlSequence';

const at = { x: 15, y: 90 };
const operators = ['alt', 'opt', 'loop', 'par', 'break', 'critical', 'seq', 'strict', 'assert', 'neg', 'consider', 'ignore', 'ref'];
const timeline = sequence.timeline;
const empty = sequence.createEmpty();
assert.deepEqual(parseSequence(empty), { format: 'uml-sequence', version: 1, lifelines: [], messages: [] });

{
  const source = operators.reduce((value, operator) => sequence.addNode(value, `fragment-${operator}`, at), empty);
  const document = parseSequence(source);
  assert.deepEqual(parseSequence(serializeSequence(document)), document);
  assert.deepEqual(document.fragments?.map(frame => frame.operator), operators);
  const { nodes, edges } = sequence.read(source).diagram;
  assert.deepEqual(edges, []);
  assert.deepEqual(timeline.project(source).lifelines, []);
  for (const [index, operator] of operators.entries()) {
    const node = nodes[index];
    const symbol = sequence.symbols.find(item => item.type === `fragment-${operator}`);
    assert.equal(node.type, symbol?.type);
    assert.equal(symbol?.shape, 'interaction-frame');
    assert.equal(symbol?.container, true);
    assert.equal(symbol?.stereotype, operator);
    assert.equal(node.operands?.length, operator === 'ref' ? undefined : ['alt', 'par'].includes(operator) ? 2 : 1);
  }

  const alt = nodes[0], ref = nodes[nodes.length - 1];
  const operands = [{ y: 0, guard: 'доступно' }, { y: 53.5, guard: 'занято' }, { y: 112, guard: 'else' }];
  const guarded = sequence.setOperands!(source, alt.id, operands);
  const renamed = sequence.rename(guarded, ref.id, 'Авторизация');
  const moved = sequence.moveNode(renamed, alt.id, { x: 32, y: 120 });
  const resized = sequence.resizeNode!(moved, alt.id, 400, 250);
  const projected = sequence.read(resized).diagram.nodes;
  assert.deepEqual(projected[0], { ...alt, x: 32, y: 120, width: 400, height: 250, operands });
  assert.equal(projected.at(-1)?.label, 'Авторизация');
  assert(!('operands' in projected[projected.length - 1]));
  assert(!parseSequence(sequence.remove(resized, ref.id)).fragments?.some(frame => frame.id === ref.id));
  assert.throws(() => sequence.setOperands!(guarded, ref.id, []), /ref/);
  assert.throws(() => sequence.setOperands!(guarded, nodes[1].id, operands), /число операндов/);
  assert.throws(() => sequence.setOperands!(guarded, alt.id, [{ y: 1, guard: '' }]), /Границы/);
  assert.throws(() => sequence.setOperands!(guarded, alt.id, [{ y: 0, guard: '' }, { y: 0, guard: '' }]), /Границы/);
  assert.throws(() => sequence.setOperands!(guarded, alt.id, [{ y: 0, guard: '' }, { y: 80, guard: '' }, { y: 70, guard: '' }]), /Границы/);
  assert.throws(() => sequence.resizeNode!(guarded, alt.id, 300, 112), /Границы/);
  assert.throws(() => sequence.resizeNode!(guarded, ref.id, 0, 90), /рамка/);
  assert.throws(() => sequence.addNode(source, 'fragment-unknown', at), /Неизвестный/);

  for (const change of [
    { id: ref.id }, { operator: 'unknown' }, { width: -1 }, { operator: 'ref' },
    { operands: [{ y: 0, guard: false }] }, { operands: [{ y: 0, guard: '', extra: true }] },
  ]) {
    assert.throws(() => parseSequence(JSON.stringify({ ...document, fragments: [{ ...document.fragments![0], ...change }, document.fragments!.at(-1)] })));
  }
}

{
  const first = sequence.addNode(empty, 'lifeline', { x: 0, y: 0 });
  const two = sequence.addNode(first, 'lifeline', { x: 400, y: 0 });
  const [a, b] = parseSequence(two).lifelines.map(line => line.id);
  let source = addSequenceExecution(two, a, 150, 250);
  source = addSequenceExecution(source, a, 100, 300);
  source = addSequenceExecution(source, a, 150, 200); // Совпадающее начало вложенного интервала допустимо.
  assert.throws(() => addSequenceExecution(source, a, 180, 220), /перекрываться/);
  assert.throws(() => addSequenceExecution(source, a, 150, 250), /совпадать/);
  source = addSequenceExecution(source, a, 250, 300); // Касание соседнего интервала и совпадение конца допустимы.
  source = addSequenceExecution(source, b, 160);
  const legacy = source;
  assert.throws(() => timeline.addExecution(legacy, b, 180), /перекрываться/);
  source = timeline.addExecution(source, b, 180, 'nested');
  assert.equal(parseSequence(source).executions?.at(-1)?.endY, 220);
  assert.equal(parseSequence(timeline.addExecution(source, b, 165, 'nested')).executions?.at(-1)?.endY, 180);
  assert.equal(parseSequence(timeline.addExecution(source, b, 180, 'nested')).executions?.at(-1)?.endY, 200);
  source = timeline.addMessage(source, a, a, 130);
  source = timeline.addMessage(source, a, b, 190);
  source = timeline.addMessage(source, b, a, 195, 'reply');
  const { executions, messages } = projectSequence(parseSequence(source));
  const [outer, inner, deep, sibling] = executions.filter(item => item.lifelineId === a);
  assert.deepEqual([outer, inner, deep, sibling].map(item => [item.depth, item.x]), [[0, 63], [1, 70], [2, 77], [1, 70]]);
  assert.equal(messages[0].points[0].x, outer.x + outer.width);
  assert.equal(messages[0].points.at(-1)?.x, deep.x + deep.width);
  assert(messages[0].points[1].x > messages[0].points.at(-1)!.x);
  assert.equal(messages[1].points[0].x, deep.x + deep.width);
  assert.equal(messages[2].points.at(-1)?.x, deep.x + deep.width);
  assert.equal(messages[1].points.at(-1)?.x, executions.find(item => item.lifelineId === b && item.depth === 1)?.x);
  assert.equal(projectSequence(parseSequence(sequence.remove(source, inner.id))).executions.find(item => item.id === deep.id)?.depth, 1);
  assert.deepEqual(parseSequence(sequence.remove(source, b)).messages.map(message => message.kind), ['self']);
  const framed = sequence.addNode(source, 'fragment-opt', at);
  const frame = parseSequence(framed).fragments![0];
  const moved = sequence.moveNode(framed, frame.id, { x: 10, y: 250 });
  assert.deepEqual(parseSequence(moved).messages, parseSequence(source).messages);
  assert.deepEqual(parseSequence(moved).executions, parseSequence(source).executions);
  assert.deepEqual(parseSequence(sequence.remove(moved, a)).fragments, parseSequence(moved).fragments);
}

console.log('UML Sequence: рамки, условия, границы и вложенные активации — OK');
