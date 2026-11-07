import { blankXml } from '../src/bpmn';
import { bpmnNotation } from '../src/modeling/bpmn';
import { runCollaborationTests } from './bpmn-collaboration';
import { convertToCollaboration, inspectCollaboration } from '../src/modeling/bpmnCollaboration';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function rejected(fn: () => unknown, message?: string) { try { fn(); } catch (e) { if (message) assert(String(e).includes(message), `Неясная ошибка: ${String(e)}`); return; } throw new Error('Ожидался отказ'); }
export function runIntegrationRegression() {
  const base = blankXml('Проверка');
  const missing = base.replace(/\s+targetNamespace="[^"]*"/, '');
  assert(bpmnNotation.read(missing).readOnlyReason?.includes('targetNamespace'), 'Отсутствие targetNamespace разрешено');
  rejected(() => bpmnNotation.addNode(missing, 'task', { x: 300, y: 100 }));
  let xml = bpmnNotation.addNode(base, 'task', { x: 400, y: 100 });
  xml = xml.replace(/(<bpmn:task\s)/, '$1custom="x" ');
  assert(!bpmnNotation.read(xml).readOnlyReason, 'Исходный процесс должен оставаться редактируемым');
  rejected(() => bpmnNotation.addNode(xml, 'dataStoreReference', { x: 600, y: 100 }), 'Операция с данными недоступна');
  assert(bpmnNotation.read(bpmnNotation.addNode(xml, 'task', { x: 600, y: 100 })).diagram.nodes.length > bpmnNotation.read(xml).diagram.nodes.length, 'Редактирование обычных узлов заблокировано');
  let lanes = bpmnNotation.addRegion!(base, { x: 1000, y: 1000 });
  const first = bpmnNotation.read(lanes).diagram.regions![0].id;
  lanes = bpmnNotation.rename(lanes, first, '');
  lanes = bpmnNotation.setRegionRows!(lanes, first, 2);
  const second = bpmnNotation.read(lanes).diagram.regions!.find(r => r.id !== first)!.id;
  lanes = bpmnNotation.setRegionRows!(lanes, second, 1);
  const remaining = bpmnNotation.read(lanes);
  assert(!remaining.readOnlyReason && remaining.diagram.regions?.length === 1 && remaining.diagram.regions[0].id === second, 'Выбранная дорожка не сохранена');
  let mixed = bpmnNotation.addNode(base, 'task', { x: 400, y: 100 });
  mixed = bpmnNotation.addNode(mixed, 'dataObjectReference', { x: 300, y: 200 });
  mixed = bpmnNotation.addNode(mixed, 'endEvent:message', { x: 600, y: 100 });
  const state = bpmnNotation.read(mixed).diagram;
  const task = state.nodes.find(n => n.type === 'task')!;
  const data = state.nodes.find(n => n.type === 'dataObjectReference')!;
  mixed = bpmnNotation.connect(mixed, data.id, task.id, 'dataInputAssociation');
  const edge = bpmnNotation.read(mixed).diagram.edges.find(e => e.type === 'dataInputAssociation')!;
  const unsupported = mixed.replace(/(<bpmn:task\s)/, '$1custom="x" ');
  const preview = bpmnNotation.read(unsupported);
  assert(preview.readOnlyReason && preview.diagram.edges.some(e => e.id === edge.id), 'Read-only скрыл связь данных');
  rejected(() => bpmnNotation.remove(unsupported, edge.id));
  const converted = convertToCollaboration(mixed);
  assert(inspectCollaboration(converted).editable && bpmnNotation.read(converted).readOnlyReason, 'Смешанная collaboration должна быть защищена от редактирования');
  const beforeProcess = new DOMParser().parseFromString(mixed, 'application/xml').getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'process')[0];
  const afterProcess = new DOMParser().parseFromString(converted, 'application/xml').getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'process')[0];
  assert(new XMLSerializer().serializeToString(beforeProcess) === new XMLSerializer().serializeToString(afterProcess), 'Конверсия изменила смешанный процесс');
  const collaboration = runCollaborationTests();
  return { status: 'passed', validatedXml: collaboration.validatedXml, mixedXml: converted };
}
