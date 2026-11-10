import { blankXml } from '../src/bpmn';
import { getModelNotation, modelDefinitions } from '../src/modeling/registry';
import { bpmnCollaborationFacade } from '../src/modeling/bpmnCollaborationFacade';
import { acceptModelDrag, modelDragMatches, previewModelDrag, type ModelDragEvent } from '../src/modeling/liveDrag';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
try {
  const results: string[] = [];
  for (const { id } of [...modelDefinitions, { id: 'bpmn' }]) {
    const notation = id === 'bpmn' ? bpmnCollaborationFacade : getModelNotation(id)!;
    let source = id === 'bpmn' ? blankXml('Проверка движения') : notation.createEmpty();
    if (id === 'bpmn') source = notation.remove(source, 'StartEvent_1');
    const type = id === 'epc' ? 'function' : id === 'bpmn' ? 'task' : notation.symbols[0].type;
    source = notation.addNode(source, type, { x: 100, y: 100 });
    source = notation.addNode(source, type, { x: 500, y: 300 });
    const original = notation.read(source).diagram;
    if (id !== 'uml-sequence') source = notation.connect(source, original.nodes[0].id, original.nodes[1].id);
    const changes = notation.read(source).diagram.nodes.map(n => ({ id: n.id, kind: 'node' as const, x: n.x + 40, y: n.y + 24 }));
    const preview = previewModelDrag(notation, source, changes);
    const diagram = notation.read(preview).diagram;
    assert(!modelDragMatches(notation.read(source).diagram, changes), `${id}: предпросмотр изменил исходник`);
    assert(modelDragMatches(diagram, changes), `${id}: группа не переместилась`);
    assert(diagram.nodes.every(n => original.nodes.some(o => o.id === n.id)), `${id}: ID изменились`);
    assert(diagram.edges.length === notation.read(source).diagram.edges.length, `${id}: связь потеряна`);
    if (notation.resizeNode && id !== 'uml-sequence') {
      const n = diagram.nodes[0];
      const resized = previewModelDrag(notation, preview, [{ id: n.id, kind: 'resize', x: n.x, y: n.y, width: n.width + 40, height: n.height + 20 }]);
      assert(notation.read(resized).diagram.nodes[0].width > n.width, `${id}: размер не передан`);
    }
    results.push(`${id}: движение группы, сохранение ID/связей, исходник не меняется — OK`);
  }
  const versions = new Map<string, number>();
  const frame: ModelDragEvent = { user: 'a', session: 's', seq: 2, model: 'model:epc', gesture: 'g', phase: 'end', changes: [] };
  assert(acceptModelDrag(versions, frame), 'Завершение отклонено');
  assert(!acceptModelDrag(versions, { ...frame, seq: 1, phase: 'move' }), 'Запоздалое движение вернуло завершённый жест');
  assert(!acceptModelDrag(versions, frame), 'Дубль принят');
  assert(acceptModelDrag(versions, { ...frame, session: 'new', seq: 1 }), 'Новая сессия отклонена');
  results.push('Порядок кадров, дубли, завершение, новая сессия — OK');
  document.querySelector('#result')!.textContent = results.join('\n');
} catch (error) {
  document.querySelector('#result')!.textContent = `FAIL: ${error instanceof Error ? error.message : error}`;
  throw error;
}
