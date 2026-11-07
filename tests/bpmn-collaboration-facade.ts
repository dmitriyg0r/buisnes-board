import { blankXml } from '../src/bpmn';
import { bpmnNotation } from '../src/modeling/bpmn';
import { bpmnCollaborationFacade as facade } from '../src/modeling/bpmnCollaborationFacade';
import { inspectCollaboration } from '../src/modeling/bpmnCollaboration';

const model = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const di = 'http://www.omg.org/spec/BPMN/20100524/DI';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function fails(fn: () => unknown) { let failed = false; try { fn(); } catch { failed = true; } assert(failed, 'Ожидался отказ'); }
function parse(xml: string) { return new DOMParser().parseFromString(xml, 'application/xml'); }
function protectedSnapshot(xml: string) {
  const doc = parse(xml), state = inspectCollaboration(xml);
  const ids = new Set([...state.participants.map(p => p.id), ...state.messageFlows.map(f => f.id)]);
  const nodes = [doc.getElementsByTagNameNS(model, 'collaboration')[0], ...Array.from(doc.getElementsByTagNameNS(di, 'BPMNPlane')[0].children).filter(e => ids.has(e.getAttribute('bpmnElement') ?? ''))];
  return nodes.map(n => new XMLSerializer().serializeToString(n)).sort().join('\n');
}
export function runCollaborationFacadeTests() {
  let xml = blankXml('Проверка');
  xml = bpmnNotation.addRegion!(xml, { x: 120, y: 120 });
  xml = bpmnNotation.addNode(xml, 'task', { x: 350, y: 150 });
  xml = bpmnNotation.addNode(xml, 'dataObjectReference', { x: 510, y: 150 });
  let diagram = bpmnNotation.read(xml).diagram;
  const task = diagram.nodes.find(n => n.type === 'task')!, data = diagram.nodes.find(n => n.type === 'dataObjectReference')!;
  xml = bpmnNotation.connect(xml, task.id, data.id, 'dataOutputAssociation');
  xml = facade.convertToCollaboration(xml);
  let state = inspectCollaboration(xml); const main = state.participants[0];
  xml = facade.addBlackBoxParticipant(xml, 'Внешний', { x: main.bounds.x, y: main.bounds.y + main.bounds.height + 100, width: 400, height: 100 });
  state = inspectCollaboration(xml); const external = state.participants.find(p => !p.processRef)!;
  xml = facade.addMessageFlow(xml, main.id, external.id, [{ x: main.bounds.x + 50, y: main.bounds.y + main.bounds.height }, { x: external.bounds.x + 50, y: external.bounds.y }], 'Сообщение');
  state = inspectCollaboration(xml);
  const original = xml, saved = protectedSnapshot(xml);
  const cases: string[] = [], outputs: string[] = [xml];
  const check = (name: string, fn: (source: string) => string) => {
    const result = fn(original); assert(inspectCollaboration(result).editable, `${name}: collaboration повреждена`);
    assert(protectedSnapshot(result) === saved, `${name}: изменены collaboration или DI`);
    const doc = parse(result);
    const planeChildren = Array.from(doc.getElementsByTagNameNS(di, 'BPMNPlane')[0].children);
    const laneElement = doc.getElementsByTagNameNS(model, 'lane')[0];
    const poolIndex = planeChildren.findIndex(e => e.getAttribute('bpmnElement') === main.id);
    const laneIndex = planeChildren.findIndex(e => e.getAttribute('bpmnElement') === laneElement.id);
    assert(poolIndex >= 0 && laneIndex > poolIndex, `${name}: слой пула должен быть позади дорожки`);
    assert(doc.getElementById(task.id) && doc.getElementById(data.id), `${name}: потеряны ID`);
    assert(doc.getElementsByTagNameNS(model, 'lane').length === 1 && doc.getElementsByTagNameNS(model, 'dataOutputAssociation').length === 1, `${name}: потеряна дорожка или данные`);
    cases.push(name); outputs.push(result);
  };
  diagram = facade.read(original).diagram;
  assert(diagram.regions?.filter(r => r.kind === 'pool').length === 2, 'Оба пула должны отображаться');
  assert(diagram.edges.some(e => e.type === 'messageFlow' && e.label === 'Сообщение' && e.lineStyle === 'dashed'), 'Поток должен отображаться');
  const lane = diagram.regions!.find(r => r.kind !== 'pool')!, start = diagram.nodes.find(n => n.type === 'startEvent')!;
  check('rename', s => facade.rename(s, task.id, 'Изменено'));
  check('moveNode', s => facade.moveNode(s, task.id, { x: task.x + 10, y: task.y }));
  check('addNode', s => facade.addNode(s, 'task', { x: 700, y: 150 }));
  check('setLabelBounds', s => facade.setLabelBounds!(s, task.id, { x: 350, y: 150, width: 80, height: 20 }));
  check('resizeRegion', s => facade.resizeRegion!(s, lane.id, lane.width - 10, lane.height));
  check('moveRegion', s => facade.moveRegion!(s, lane.id, { x: lane.x, y: lane.y + 5 }));
  check('setRegionRows', s => facade.setRegionRows!(s, lane.id, 1));
  check('connect', s => facade.connect(s, start.id, task.id));
  let connected = facade.connect(original, start.id, task.id); const edge = facade.read(connected).diagram.edges.find(e => e.type === 'sequenceFlow')!;
  for (const [name, fn] of [
    ['editEdge', (s: string) => facade.editEdge(s, edge.id, edge.from, edge.to, edge.points)],
    ['resetEdge', (s: string) => facade.resetEdge(s, edge.id)],
    ['remove', (s: string) => facade.remove(s, edge.id)],
  ] as const) { const result = fn(connected); assert(inspectCollaboration(result).editable && protectedSnapshot(result) === saved, name); cases.push(name); outputs.push(result); }
  fails(() => facade.moveNode(original, task.id, { x: external.bounds.x, y: external.bounds.y }));
  fails(() => facade.addNode(original, 'task', { x: external.bounds.x, y: external.bounds.y }));
  fails(() => facade.connect(original, task.id, external.id));
  fails(() => facade.remove(original, external.id));
  fails(() => facade.editEdge(connected, edge.id, edge.from, edge.to, [{ x: main.bounds.x - 1, y: main.bounds.y }, edge.points[1]]));
  fails(() => facade.addRegion!(original, { x: external.bounds.x, y: external.bounds.y }));
  fails(() => facade.resizeNode!(original, task.id, 200, 200));
  assert(facade.read(original).readOnlyReason === undefined, 'Чтение collaboration');
  const invalidBoolean = original.replace('isExecutable="false"', 'isExecutable="bogus"');
  assert(facade.read(invalidBoolean).readOnlyReason, 'Неверный isExecutable');
  fails(() => facade.rename(invalidBoolean, task.id, 'ошибка'));
  const vertical = original.replace('isHorizontal="true"', 'isHorizontal="0"');
  assert(facade.read(vertical).readOnlyReason, 'Вертикальный пул только для чтения');
  fails(() => facade.moveBlackBoxParticipant(vertical, external.id, { x: 0, y: 0 }));
  const noProcessDoc = parse(original);
  noProcessDoc.getElementsByTagNameNS(model, 'process')[0].remove();
  const firstParticipant = noProcessDoc.getElementsByTagNameNS(model, 'participant')[0];
  firstParticipant.removeAttribute('processRef');
  const noProcess = new XMLSerializer().serializeToString(noProcessDoc);
  const partial = facade.read(noProcess);
  assert(partial.readOnlyReason && partial.diagram.regions?.filter(r => r.kind === 'pool').length === 2 && partial.diagram.edges.some(e => e.type === 'messageFlow'), 'Black-box должен открываться частично');
  fails(() => facade.removeCollaborationElement(noProcess, external.id));
  assert(facade.read(original.replace('<bpmn:participant ', '<bpmn:participant custom="x" ')).readOnlyReason, 'Неподдерживаемые атрибуты');
  let spacious = blankXml('Просторный процесс');
  spacious = bpmnNotation.addNode(spacious, 'task', { x: 1100, y: 600 });
  spacious = bpmnNotation.addNode(spacious, 'textAnnotation', { x: 500, y: 200 });
  spacious = facade.convertToCollaboration(spacious);
  const snap = protectedSnapshot(spacious);
  const annotation = facade.read(spacious).diagram.nodes.find(n => n.type === 'textAnnotation')!;
  const resized = facade.resizeNode!(spacious, annotation.id, 160, 90);
  assert(protectedSnapshot(resized) === snap && facade.read(resized).diagram.nodes.find(n => n.id === annotation.id)?.width === 160, 'resizeNode');
  outputs.push(resized); cases.push('resizeNode');
  const regionAdded = facade.addRegion!(spacious, { x: 250, y: 320 });
  assert(protectedSnapshot(regionAdded) === snap && facade.read(regionAdded).diagram.regions?.filter(r => r.kind === 'lane').length === 1, 'addRegion');
  outputs.push(regionAdded); cases.push('addRegion');
  // Интеграционный контракт палитры и операций над пулами.
  let ui = facade.addPool!(bpmnNotation.addNode(blankXml('UI'), 'task', { x: 400, y: 200 }), { x: 1000, y: 500 });
  let uiState = inspectCollaboration(ui);
  const uiMain = uiState.participants.find(p => p.processRef)!, uiExternal = uiState.participants.find(p => !p.processRef)!;
  assert(uiExternal.bounds.width === 400 && uiExternal.bounds.height === 120, 'Размер внешнего пула');
  ui = facade.rename(ui, uiExternal.id, 'Контрагент');
  assert(inspectCollaboration(ui).participants.find(p => p.id === uiExternal.id)?.name === 'Контрагент', 'Имя пула');
  ui = facade.moveRegion!(ui, uiExternal.id, { x: 1100, y: 600 });
  fails(() => facade.moveRegion!(ui, uiMain.id, { x: 0, y: 0 }));
  fails(() => facade.addPool!(ui, { x: 2000, y: 2000 }));
  ui = facade.connect(ui, uiMain.id, uiExternal.id);
  uiState = inspectCollaboration(ui);
  const uiFlow = uiState.messageFlows[0];
  assert(uiFlow && uiFlow.points.slice(1).every((p, i) => p.x === uiFlow.points[i].x || p.y === uiFlow.points[i].y), 'Ортогональный поток');
  const uiEdge = facade.read(ui).diagram.edges.find(e => e.id === uiFlow.id);
  assert(uiEdge?.routeEditable === false && uiEdge.labelEditable === false && uiEdge.lineStyle === 'dashed' && uiEdge.startMarker === 'circle' && uiEdge.arrowEnd === true && uiEdge.arrowStyle === 'open', 'Контракт отображения потока сообщений');
  fails(() => facade.connect(ui, uiMain.id, uiExternal.id, 'messageFlow'));
  fails(() => facade.moveRegion!(ui, uiExternal.id, { x: 1200, y: 700 }));
  fails(() => facade.remove(ui, uiExternal.id));
  const roundTrip = new XMLSerializer().serializeToString(parse(ui));
  assert(inspectCollaboration(roundTrip).editable && facade.read(roundTrip).diagram.edges.some(e => e.id === uiFlow.id), 'XML round-trip');
  outputs.push(roundTrip);
  ui = facade.remove(ui, uiFlow.id);
  ui = facade.remove(ui, uiExternal.id);
  assert(inspectCollaboration(ui).participants.length === 1, 'Удаление потока и пула');
  cases.push('UI pool and messageFlow'); outputs.push(ui);
  assert(facade.connectionTypes?.some(t => t.id === 'messageFlow' && t.appearance?.lineStyle === 'dashed' && t.appearance.startMarker === 'circle' && t.appearance.arrowStyle === 'open'), 'Стиль потока сообщений');
  const mixedBase = facade.remove(facade.remove(original, state.messageFlows[0].id), external.id);
  const mb = inspectCollaboration(mixedBase).participants[0].bounds;
  const positions = [
    { x: mb.x - 500, y: mb.y }, { x: mb.x + mb.width + 100, y: mb.y },
    { x: mb.x, y: mb.y - 220 }, { x: mb.x, y: mb.y + mb.height + 100 },
    { x: mb.x - 500, y: mb.y - 220 }, { x: mb.x + mb.width + 100, y: mb.y + mb.height + 100 },
  ];
  for (const at of positions) {
    let sample = facade.addPool!(mixedBase, at);
    const participant = inspectCollaboration(sample).participants.find(p => !p.processRef)!;
    sample = facade.connect(sample, participant.id, main.id, 'messageFlow');
    const st = inspectCollaboration(sample), flow = st.messageFlows[0];
    assert(st.editable && flow.points.slice(1).every((p, i) => p.x === flow.points[i].x || p.y === flow.points[i].y), 'Маршрут разных расположений');
    assert(facade.read(sample).diagram.nodes.some(n => n.id === task.id) && parse(sample).getElementsByTagNameNS(model, 'dataOutputAssociation').length === 1, 'Смешанная модель и IO');
    outputs.push(sample);
  }
  const touchingAt = { x: mb.x + mb.width, y: mb.y + mb.height / 2 - 60 };
  let touching = facade.addPool!(mixedBase, touchingAt);
  const touchingId = inspectCollaboration(touching).participants.find(p => !p.processRef)!.id;
  touching = facade.connect(touching, main.id, touchingId, 'auto');
  assert(inspectCollaboration(touching).editable, 'Связь соприкасающихся пулов');
  outputs.push(touching);
  fails(() => facade.addPool!(mixedBase, { x: mb.x, y: mb.y }));
  fails(() => facade.connect(mixedBase, main.id, main.id, 'messageFlow'));
  const hidden = parse(original);
  const taskShape = Array.from(hidden.getElementsByTagNameNS(di, 'BPMNShape')).find(e => e.getAttribute('bpmnElement') === task.id)!;
  taskShape.remove();
  const hiddenXml = new XMLSerializer().serializeToString(hidden);
  assert(facade.read(hiddenXml).readOnlyReason, 'Скрытый узел запрещает запись');
  fails(() => facade.rename(hiddenXml, external.id, 'Ошибка'));
  const hiddenFlow = parse(original);
  Array.from(hiddenFlow.getElementsByTagNameNS(di, 'BPMNEdge')).find(e => e.getAttribute('bpmnElement') === state.messageFlows[0].id)!.remove();
  const hiddenFlowXml = new XMLSerializer().serializeToString(hiddenFlow);
  assert(facade.read(hiddenFlowXml).readOnlyReason, 'Скрытая связь запрещает запись');
  fails(() => facade.remove(hiddenFlowXml, external.id));
  cases.push('mixed models, routing and hidden elements');
  return { cases, outputs };
}
