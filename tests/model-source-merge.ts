import { blankXml } from '../src/bpmn';
import { emptyModel } from '../src/data';
import { mergeModel } from '../src/mergeModel';
import { getModelNotation, modelDefinitions } from '../src/modeling/registry';
import { bpmnCollaborationFacade } from '../src/modeling/bpmnCollaborationFacade';
import { mergeDiagramSource } from '../src/modeling/mergeSource';
import { endpointsFaceOutward } from '../src/modeling/diagramRouting';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
export function testSourceMerge() {
  const results: string[] = [];
  for (const definition of [...modelDefinitions, { id: 'bpmn', title: 'BPMN' }]) {
    const notation = definition.id === 'bpmn' ? bpmnCollaborationFacade : getModelNotation(definition.id)!;
    let base = definition.id === 'bpmn' ? blankXml('Совместная модель') : getModelNotation(definition.id)!.createEmpty();
    if (definition.id === 'bpmn') base = notation.remove(base, 'StartEvent_1');
    const type = definition.id === 'epc' ? 'function' : definition.id === 'bpmn' ? 'task' : notation.symbols[0].type;
    base = notation.addNode(base, type, { x: 100, y: 100 });
    base = notation.addNode(base, type, { x: 500, y: 300 });
    const [a, b] = notation.read(base).diagram.nodes;
    const local = notation.rename(base, a.id, 'Правка Анны'), remote = notation.rename(base, b.id, 'Правка Бориса');
    const merged = mergeDiagramSource(base, local, remote, definition.id);
    const parsed = notation.read(merged);
    assert(!parsed.readOnlyReason, `${definition.id}: объединение запретило редактирование`);
    assert(parsed.diagram.nodes.find(n => n.id === a.id)?.label === 'Правка Анны', `${definition.id}: потеря локальной правки`);
    assert(parsed.diagram.nodes.find(n => n.id === b.id)?.label === 'Правка Бориса', `${definition.id}: потеря чужой правки`);
    const undo = mergeDiagramSource(base, base, remote, definition.id);
    assert(notation.read(undo).diagram.nodes.find(n => n.id === b.id)?.label === 'Правка Бориса', `${definition.id}: отмена потеряла чужую правку`);
    const sameNode = mergeDiagramSource(base, notation.rename(base, a.id, 'Имя'), notation.moveNode(base, a.id, { x: 200, y: 100 }), definition.id);
    const changed = notation.read(sameNode).diagram.nodes.find(n => n.id === a.id)!;
    assert(changed.label === 'Имя' && changed.x === 200, `${definition.id}: независимые свойства одного узла`);
    if (definition.id !== 'uml-sequence') {
      const removed = mergeDiagramSource(base, notation.remove(base, a.id), remote, definition.id);
      const remaining = notation.read(removed).diagram.nodes;
      assert(!remaining.some(n => n.id === a.id) && remaining.find(n => n.id === b.id)?.label === 'Правка Бориса', `${definition.id}: удаление с чужой правкой`);
    }
    if (definition.id === 'bpmn' || definition.id === 'uml-class') {
      const connected = notation.connect(base, a.id, b.id);
      const left = notation.moveNode(connected, a.id, { x: 160, y: 120 });
      const right = notation.moveNode(connected, b.id, { x: 560, y: 330 });
      const diagram = notation.read(mergeDiagramSource(connected, left, right, definition.id)).diagram;
      const edge = diagram.edges[0];
      assert(endpointsFaceOutward(edge.points, diagram.nodes[0], diagram.nodes[1], node => notation.symbols.find(s => s.type === node.type)?.shape), `${definition.id}: связь оторвалась от перемещённых концов`);
    }
    const model = { ...structuredClone(emptyModel), ...(definition.id === 'bpmn' ? { processes: [{ id: 'p', title: 'Модель', xml: base }] } : { models: [{ id: 'm', title: 'Модель', notation: definition.id, source: base }] }) };
    const l = structuredClone(model), r = structuredClone(model);
    if (definition.id === 'bpmn') { l.processes[0].xml = local; r.processes[0].xml = remote; }
    else { l.models[0].source = local; r.models[0].source = remote; }
    const board = mergeModel(model, l, r);
    const content = definition.id === 'bpmn' ? board.processes[0].xml : board.models[0].source;
    assert(notation.read(content).diagram.nodes.every(n => n.label.startsWith('Правка')), `${definition.id}: синхронизация доски потеряла изменение`);
    results.push(`${definition.id}: разные элементы, свойства, удаление, история и слияние доски`);
  }
  return results;
}
