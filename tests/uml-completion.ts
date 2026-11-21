import { strict as assert } from 'node:assert';
import { endpointsFaceOutward, routeBetweenNodes } from '../src/modeling/diagramRouting';
import { umlClassNotation as classes } from '../src/modeling/umlClass';
import { umlActivityNotation as activity } from '../src/modeling/umlActivity';
import { umlUseCaseNotation as cases } from '../src/modeling/umlUseCase';
import { umlSequenceNotation as sequence, parseSequence } from '../src/modeling/umlSequence';
import { mergeDiagramSource } from '../src/modeling/mergeSource';

type Adapter = typeof classes;
function pair(adapter: Adapter, from: string, to: string) {
  let source = adapter.addNode(adapter.createEmpty(), from, { x: 0, y: 0 });
  source = adapter.addNode(source, to, { x: 400, y: 0 });
  return { source, ids: adapter.read(source).diagram.nodes.map(n => n.id) as [string, string] };
}
{
  const { source, ids } = pair(classes, 'class', 'abstract-class');
  const linked = classes.connect(source, ...ids, 'association');
  const edge = classes.read(linked).diagram.edges[0];
  const named = classes.rename(linked, edge.id, 'запись');
  const withEnds = classes.setEdgeEnds!(named, edge.id, { from: { role: 'владелец', multiplicity: '1' }, to: { role: 'детали', multiplicity: '0..*' } });
  assert(!classes.allowedEdgeTypes!(withEnds, edge.id).includes('generalization'));
  assert.throws(() => classes.setEdgeType!(withEnds, edge.id, 'generalization'), /кратности/);
  const composition = classes.setEdgeType!(withEnds, edge.id, 'composition');
  const updated = classes.read(composition).diagram.edges[0];
  assert.equal(updated.startMarker, 'diamond-filled');
  assert.equal(updated.label, 'запись');
  assert.deepEqual(updated.points, edge.points);
  assert.deepEqual(updated.ends, classes.read(withEnds).diagram.edges[0].ends);
  assert.equal(updated.id, edge.id);
  assert.equal(classes.read(classes.setEdgeType!(named, edge.id, 'generalization')).diagram.edges[0].arrowStyle, 'triangle');
}
{
  const { source, ids } = pair(cases, 'use-case', 'use-case');
  const linked = cases.connect(source, ...ids, 'extend');
  const edge = cases.read(linked).diagram.edges[0];
  const guarded = cases.setEdgeGuard!(linked, edge.id, 'Промокод действителен');
  assert.equal(cases.read(guarded).diagram.edges[0].guard, 'Промокод действителен');
  assert.throws(() => cases.setEdgeType!(guarded, edge.id, 'include'), /условие/);
  const cleared = cases.setEdgeGuard!(guarded, edge.id, '');
  assert.equal(cases.read(cases.setEdgeType!(cleared, edge.id, 'include')).diagram.edges[0].stereotype, '«include»');
}
{
  const { source, ids } = pair(activity, 'send-signal', 'accept-signal');
  const linked = activity.connect(source, ...ids);
  const { nodes: [from, to], edges: [edge] } = activity.read(linked).diagram;
  const shape = (n: typeof from) => activity.symbols.find(s => s.type === n.type)?.shape;
  assert.deepEqual(edge.points.at(-1), { x: 418, y: 32.5 });
  const rebuilt = routeBetweenNodes([from, to], from, to, edge.points[0], edge.points.at(-1), shape);
  assert(rebuilt && endpointsFaceOutward(rebuilt, from, to, shape));
  const guarded = activity.setEdgeGuard!(linked, edge.id, 'доступно');
  const changed = activity.setEdgeType!(guarded, edge.id, 'object-flow');
  const moved = activity.resizeNode!(changed, to.id, 200, 65);
  assert.equal(activity.read(moved).diagram.edges[0].guard, 'доступно');
  assert.equal(activity.read(moved).diagram.edges[0].points.at(-1)?.x, 424);
  const old = JSON.parse(linked);
  old.edges[0].points.at(-1).x = 400;
  const legacy = JSON.stringify(old);
  assert.equal(activity.read(legacy).diagram.edges[0].points.at(-1)?.x, 418);
  assert.equal(JSON.parse(activity.rename(legacy, ids[0], 'Старое событие')).edges[0].points.at(-1).x, 400);
}
{
  const { source, ids } = pair(sequence, 'lifeline', 'lifeline');
  const timeline = sequence.timeline!;
  const messages = timeline.addMessage(source, ...ids, 160);
  const withExecution = timeline.addExecution!(messages, ids[1], 160);
  const { executions, messages: [msg] } = timeline.project(withExecution);
  if (!executions || executions.length !== 1) throw new Error('Активация не спроецирована');
  const id = executions[0].id;
  assert.equal(msg.points.at(-1)?.x, executions[0].x);
  assert.throws(() => timeline.addExecution!(withExecution, ids[1], 180), /перекрываться/);
  assert.throws(() => timeline.editExecution!(withExecution, id, 40, 80), /заголовка/);
  const extended = timeline.editExecution!(withExecution, id, 160, 600);
  assert(parseSequence(extended).lifelines[1].endY >= 600);
  const merged = mergeDiagramSource(withExecution, extended, sequence.rename(withExecution, id, 'Запрос'), sequence.id);
  assert.equal(timeline.project(merged).executions?.[0].label, 'Запрос');
  assert.equal(timeline.project(merged).executions?.[0].endY, 600);
  const shifted = sequence.moveNode(merged, ids[1], { x: 500, y: 0 });
  assert.equal(timeline.project(shifted).messages[0].points.at(-1)?.x, 563);
  assert.deepEqual(parseSequence(shifted).messages, parseSequence(messages).messages);
  assert.equal(timeline.project(sequence.remove(shifted, ids[1])).executions?.length, 0);
}
console.log('Доработка UML: смена типов, условия, привязки сигналов, активации, слияние и обратная совместимость — OK');
