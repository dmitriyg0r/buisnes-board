import { strict as assert } from 'node:assert';
import { umlClassNotation as classes } from '../src/modeling/umlClass';
import { umlUseCaseNotation as cases } from '../src/modeling/umlUseCase';
import { umlActivityNotation as activity } from '../src/modeling/umlActivity';
import { endpointsFaceOutward } from '../src/modeling/diagramRouting';

const get = (notation: typeof classes, source: string, type: string) => notation.read(source).diagram.nodes.find(node => node.type === type)!;
{
  let source = classes.addNode(classes.createEmpty(), 'package', { x: 0, y: 0 });
  const pkg = get(classes, source, 'package');
  source = classes.addNode(source, 'class', { x: 30, y: 60 });
  source = classes.addNode(source, 'abstract-class', { x: 460, y: 60 });
  source = classes.addNode(source, 'association-class', { x: 235, y: 220 });
  source = classes.connect(source, get(classes, source, 'class').id, get(classes, source, 'abstract-class').id, 'association');
  const edge = classes.read(source).diagram.edges[0];
  const item = get(classes, source, 'association-class');
  source = classes.setAssociationClassLink!(source, item.id, edge.id);
  assert.throws(() => classes.setEdgeType!(source, edge.id, 'dependency'), /привязку/);
  source = classes.moveNode(source, pkg.id, { x: 20, y: 15 });
  assert.equal(get(classes, source, 'class').x, 50);
  assert.equal(get(classes, source, 'association-class').associationId, edge.id);
  assert.notDeepEqual(classes.read(source).diagram.edges[0].points, edge.points);
  assert.equal(classes.read(source).readOnlyReason, undefined);
  assert.equal(get(classes, classes.remove(source, edge.id), 'association-class').associationId, undefined);
  const more = classes.addNode(source, 'package', { x: 800, y: 0 });
  const target = classes.read(more).diagram.nodes.find(n => n.type === 'package' && n.id !== pkg.id)!;
  assert.equal(classes.read(classes.connect(more, pkg.id, target.id, 'package-import')).diagram.edges.at(-1)?.stereotype, '«import»');
}
{
  let source = cases.addNode(cases.createEmpty(), 'use-case', { x: 0, y: 0 });
  source = cases.addNode(source, 'use-case', { x: 400, y: 0 });
  const [a, b] = cases.read(source).diagram.nodes;
  source = cases.connect(source, a.id, b.id, 'extend');
  const edge = cases.read(source).diagram.edges[0];
  source = cases.setExtensionPoints!(source, b.id, ['Подтверждение', 'Оповещение']);
  source = cases.setExtensionPoint!(source, edge.id, 'Подтверждение');
  assert.equal(cases.read(source).diagram.edges[0].extensionPoint, 'Подтверждение');
  assert.deepEqual(cases.read(source).diagram.edges[0].points, edge.points);
  assert.throws(() => cases.setExtensionPoints!(source, b.id, ['Оповещение']), /привязку/);
  assert.throws(() => cases.setExtensionPoint!(source, edge.id, 'Несуществующая точка'), /целевом/);
  assert(!cases.allowedEdgeTypes!(source, edge.id).includes('include'));
  assert.equal(cases.read(source).readOnlyReason, undefined);
}
{
  let source = activity.addNode(activity.createEmpty(), 'partition', { x: -40, y: -70 });
  source = activity.addNode(source, 'action', { x: 0, y: 0 });
  source = activity.addNode(source, 'object', { x: 310, y: 12 });
  const owner = get(activity, source, 'action'), lane = get(activity, source, 'partition'), object = get(activity, source, 'object');
  assert.throws(() => activity.addNode(source, 'input-pin', { x: 0, y: 12 }, object.id), /принадлежит/);
  source = activity.addNode(source, 'output-pin', { x: 6, y: 28 }, owner.id);
  source = activity.addNode(source, 'input-pin', { x: 0, y: 4 }, owner.id);
  const pin = get(activity, source, 'output-pin');
  assert.equal(pin.x, owner.x + owner.width - pin.width / 2);
  assert.equal(pin.ownerId, owner.id);
  assert.throws(() => activity.connect(source, object.id, pin.id, 'object-flow'));
  source = activity.connect(source, pin.id, object.id, 'object-flow');
  const before = activity.read(source).diagram.edges[0];
  source = activity.moveNode(source, lane.id, { x: -30, y: -50 });
  assert.equal(get(activity, source, 'output-pin').y, pin.y + 20);
  assert.deepEqual(activity.read(source).diagram.edges[0].points, before.points.map(p => ({ x: p.x + 10, y: p.y + 20 })));
  source = activity.resizeNode!(source, owner.id, 179, 100);
  const updated = get(activity, source, 'output-pin');
  const diagram = activity.read(source).diagram;
  assert.equal(updated.x, get(activity, source, 'action').x + 179 - pin.width / 2);
  assert(endpointsFaceOutward(diagram.edges[0].points, updated, get(activity, source, 'object')));
  assert.equal(activity.read(source).readOnlyReason, undefined);
  const after = activity.read(activity.remove(source, owner.id)).diagram;
  assert.equal(after.edges.length, 0);
  assert(!after.nodes.some(node => node.ownerId === owner.id));
}
console.log('UML: пакеты, классы ассоциаций, точки расширения, дорожки и пины — OK');
