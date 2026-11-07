import { inspectDataModel, addDataStore, addDataAssociation, editDataAssociation, removeDataAssociation, removeDataConnectionsForNode } from './bpmnData';
import { createElement } from 'react';
import { BpmnEventGlyph } from './BpmnEventGlyph';
import { bpmnEventSymbols, bpmnEventElementNames, createBpmnEvent, inspectBpmnEvent, isBpmnEventDefinitionElement } from './bpmnEvents';
import type { EventMarker } from './bpmnEvents';
import type { Diagram, DiagramEdge, DiagramNode, DiagramNotation, DiagramPoint, DiagramRegion, DiagramSymbol } from './types';
import { bpmnCatalog } from './bpmnCatalog';

const BPMN = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMNDI = 'http://www.omg.org/spec/BPMN/20100524/DI';
const DC = 'http://www.omg.org/spec/DD/20100524/DC';
const DI = 'http://www.omg.org/spec/DD/20100524/DI';

const groupNames = { events: 'События', tasks: 'Задачи', gateways: 'Шлюзы', subprocesses: 'Подпроцессы', artifacts: 'Данные и аннотации' };
const eventKinds = new Set(['startEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'endEvent']);
const eventTitles: Record<string, string> = { startEvent: 'Начальное событие', intermediateCatchEvent: 'Промежуточное принимающее событие', intermediateThrowEvent: 'Промежуточное отправляющее событие', endEvent: 'Конечное событие' };
const markerTitles: Record<string, string> = { message: 'сообщение', timer: 'таймер', signal: 'сигнал', error: 'ошибка', escalation: 'эскалация', compensate: 'компенсация', terminate: 'завершение' };
// События, требующие ввода параметров, не предлагаются без соответствующего UI.
const availableEvents = bpmnEventSymbols.filter((event) => event.contexts.includes('process') && !['conditional', 'link', 'multiple'].includes(event.marker));
const eventKey = (type: string, marker: string) => marker === 'none' ? type : `${type}:${marker}`;
const symbols: DiagramSymbol[] = [
  ...bpmnCatalog.filter((symbol) => !eventKinds.has(symbol.type)).map((symbol) => ({ ...symbol, group: groupNames[symbol.group], glyph: symbol.marker === 'none' ? undefined : symbol.marker === 'user' ? 'person' as const : symbol.marker === 'exclusive' ? 'cross' as const : symbol.marker === 'parallel' ? 'plus' as const : symbol.marker })),
  ...availableEvents.map((event): DiagramSymbol => ({ type: eventKey(event.type, event.marker), title: `${eventTitles[event.type]}${event.marker === 'none' ? '' : `: ${markerTitles[event.marker]}`}`, group: groupNames.events, shape: event.outline === 'double' ? 'double-circle' : 'circle', outline: event.outline, width: 36, height: 36, detail: { marker: event.marker, filled: event.filled } })),
];
const nodeTypes = new Set([...bpmnCatalog.map((symbol) => symbol.type), ...eventKinds]);
const safeElements = new Set(['definitions', 'process', 'incoming', 'outgoing', 'sequenceFlow', 'laneSet', 'lane', 'flowNodeRef', 'dataObject', 'dataStore', 'ioSpecification', 'dataInput', 'dataOutput', 'inputSet', 'outputSet', 'dataInputRefs', 'dataOutputRefs', 'dataInputAssociation', 'dataOutputAssociation', 'sourceRef', 'targetRef', 'text', 'association', ...nodeTypes, ...bpmnEventElementNames]);
const baseType = (type: string) => type.split(':')[0];
function insertFlowRef(node: Element, item: Element, tag: string) {
  const before = Array.from(node.children).find((child) => child.namespaceURI === BPMN && ((tag === 'incoming' && child.localName === 'outgoing') || ['ioSpecification', 'dataInputAssociation', 'dataOutputAssociation'].includes(child.localName) || isBpmnEventDefinitionElement(child) || child.localName === 'eventDefinitionRef')) ?? null;
  node.insertBefore(item, before);
}
const element = (doc: Document, ns: string, name: string) => doc.createElementNS(ns, name);
const all = (doc: Document, ns: string, name: string) => Array.from(doc.getElementsByTagNameNS(ns, name));
const byId = (doc: Document, id: string) => Array.from(doc.getElementsByTagName('*')).find((item) => item.getAttribute('id') === id);
const ref = (doc: Document, tag: string, id: string) => all(doc, BPMNDI, tag).find((item) => item.getAttribute('bpmnElement') === id);
const number = (item: Element, key: string) => Number(item.getAttribute(key));
function labelBounds(di: Element | null | undefined) {
  const bounds = di?.getElementsByTagNameNS(BPMNDI, 'BPMNLabel')[0]?.getElementsByTagNameNS(DC, 'Bounds')[0];
  return bounds && ['x', 'y', 'width', 'height'].every((key) => bounds.hasAttribute(key) && Number.isFinite(number(bounds, key))) ? { x: number(bounds, 'x'), y: number(bounds, 'y'), width: number(bounds, 'width'), height: number(bounds, 'height') } : undefined;
}
const idFor = (doc: Document, prefix: string) => {
  let id = '';
  do { id = `${prefix}_${Math.random().toString(36).slice(2, 10)}`; } while (byId(doc, id) || byId(doc, `${id}_di`));
  return id;
};

function parse(source: string): Document {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.namespaceURI !== BPMN || doc.documentElement.localName !== 'definitions') throw new Error('Не удалось открыть файл: это не BPMN 2.0 XML.');
  return doc;
}

function inspect(doc: Document): { diagram: Diagram; readOnlyReason?: string } {
  const processes = all(doc, BPMN, 'process');
  const planes = all(doc, BPMNDI, 'BPMNPlane');
  if (!processes.length) throw new Error('В файле нет процесса BPMN.');
  const elements = all(doc, BPMN, '*');
  const unsupported = elements.some((item) => !safeElements.has(item.localName)) || processes.length !== 1 || planes.length !== 1 || all(doc, BPMNDI, 'BPMNDiagram').length !== 1;
  const ids = new Set<string>();
  let invalid = false;
  for (const item of Array.from(doc.getElementsByTagName('*'))) {
    const id = item.getAttribute('id');
    if (id && ids.has(id)) invalid = true;
    if (id) ids.add(id);
  }
  const eventInspections = elements.filter((item) => eventKinds.has(item.localName)).map((item) => ({ item, inspection: inspectBpmnEvent(item, 'process') }));
  const unsafeEvents = eventInspections.some(({ inspection }) => !inspection.editable || inspection.definitions.some((kind) => ['conditional', 'link'].includes(kind)) || inspection.definitions.length > 1);
  const nodes: DiagramNode[] = [];
  const regions: DiagramRegion[] = [];
  let invalidLaneGeometry = false;
  for (const lane of all(doc, BPMN, 'lane')) {
    const id = lane.getAttribute('id');
    const bounds = id ? ref(doc, 'BPMNShape', id)?.getElementsByTagNameNS(DC, 'Bounds')[0] : null;
    if (!id || !bounds || !['x', 'y', 'width', 'height'].every((key) => bounds.hasAttribute(key) && Number.isFinite(number(bounds, key))) || number(bounds, 'width') <= 0 || number(bounds, 'height') <= 0) { invalidLaneGeometry = true; continue; }
    regions.push({ id, label: lane.getAttribute('name') ?? '', x: number(bounds, 'x'), y: number(bounds, 'y'), width: number(bounds, 'width'), height: number(bounds, 'height') });
  }
  for (const item of elements) {
    if (!nodeTypes.has(item.localName)) continue;
    const id = item.getAttribute('id');
    const bounds = id ? ref(doc, 'BPMNShape', id)?.getElementsByTagNameNS(DC, 'Bounds')[0] : null;
    if (!id || !bounds || !['x', 'y', 'width', 'height'].every((key) => bounds.hasAttribute(key) && Number.isFinite(number(bounds, key)))) { invalid = true; continue; }
    const label = labelBounds(ref(doc, 'BPMNShape', id));
    const event = eventInspections.find((entry) => entry.item === item)?.inspection.symbol;
    const displayType = event && availableEvents.includes(event) ? eventKey(event.type, event.marker) : item.localName;
    nodes.push({ id, type: displayType, label: item.localName === 'textAnnotation' ? (Array.from(item.children).find((child) => child.namespaceURI === BPMN && child.localName === 'text')?.textContent ?? '') : item.getAttribute('name') ?? (['dataObjectReference', 'dataStoreReference'].includes(item.localName) ? byId(doc, item.getAttribute(item.localName === 'dataObjectReference' ? 'dataObjectRef' : 'dataStoreRef') ?? '')?.getAttribute('name') ?? '' : ''), x: number(bounds, 'x'), y: number(bounds, 'y'), width: number(bounds, 'width'), height: number(bounds, 'height'), ...(label ? { labelBounds: label } : {}) });
  }
  const edges: DiagramEdge[] = [];
  for (const item of elements.filter((entry) => entry.localName === 'sequenceFlow' || entry.localName === 'association')) {
    const id = item.getAttribute('id');
    const from = item.getAttribute('sourceRef') ?? '';
    const to = item.getAttribute('targetRef') ?? '';
    const di = id ? ref(doc, 'BPMNEdge', id) : null;
    const waypointElements = di ? Array.from(di.getElementsByTagNameNS(DI, 'waypoint')) : [];
    if (waypointElements.some((p) => !p.hasAttribute('x') || !p.hasAttribute('y'))) invalid = true;
    const points = waypointElements.map((p) => ({ x: number(p, 'x'), y: number(p, 'y') }));
    if (!id || points.length < 2 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || !nodes.some((n) => n.id === from) || !nodes.some((n) => n.id === to)) { invalid = true; continue; }
    const association = item.localName === 'association';
    const direction = item.getAttribute('associationDirection') ?? 'None';
    if (association && !['None', 'One', 'Both'].includes(direction)) invalid = true;
    const label = labelBounds(di);
    edges.push({ id, type: item.localName, label: association ? '' : item.getAttribute('name') ?? '', from, to, points, ...(label ? { labelBounds: label } : {}), ...(association ? { lineStyle: 'dotted' as const, arrowEnd: direction !== 'None', arrowStart: direction === 'Both', labelEditable: false } : {}) });
  }
  const dataInspection = inspectDataModel(serialize(doc));
  for (const edge of dataInspection.edges) { const di = ref(doc, 'BPMNEdge', edge.id); const label = labelBounds(di); edges.push({ id: edge.id, type: edge.type, label: '', from: edge.from, to: edge.to, points: edge.points, lineStyle: 'dotted', arrowEnd: true, labelEditable: false, ...(label ? { labelBounds: label } : {}) }); }
  // Неподдерживаемые конструкции нельзя сохранять через ограниченный редактор.
  const unsafeAttributes = elements.some((item) => ['default', 'attachedToRef', 'cancelActivity', 'triggeredByEvent', 'isForCompensation'].some((name) => item.hasAttribute(name)) || Array.from(item.attributes).some((attr) => /ref$/i.test(attr.localName) && !((['sequenceFlow', 'association'].includes(item.localName) && (attr.localName === 'sourceRef' || attr.localName === 'targetRef')) || (item.localName === 'dataObjectReference' && attr.localName === 'dataObjectRef') || (item.localName === 'dataStoreReference' && attr.localName === 'dataStoreRef'))));
  const process = processes[0];
  const outsideProcess = elements.some((item) => (nodeTypes.has(item.localName) || ['sequenceFlow', 'association', 'dataObject'].includes(item.localName)) && item.parentElement !== process);
  const unknownShapes = all(doc, BPMNDI, 'BPMNShape').some((shape) => !nodes.some((node) => node.id === shape.getAttribute('bpmnElement')) && !regions.some((region) => region.id === shape.getAttribute('bpmnElement')));
  const unknownEdges = all(doc, BPMNDI, 'BPMNEdge').some((edge) => !edges.some((item) => item.id === edge.getAttribute('bpmnElement')));
  const namespaces = new Set([BPMN, BPMNDI, DC, DI]);
  const foreignContent = Array.from(doc.getElementsByTagName('*')).some((item) => !item.namespaceURI || !namespaces.has(item.namespaceURI) || Array.from(item.attributes).some((attr) => attr.namespaceURI && attr.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && !namespaces.has(attr.namespaceURI)));
  const safeDiagramElements: Record<string, string[]> = { [BPMNDI]: ['BPMNDiagram', 'BPMNPlane', 'BPMNShape', 'BPMNEdge', 'BPMNLabel'], [DC]: ['Bounds'], [DI]: ['waypoint'] };
  const unknownDiagramContent = Array.from(doc.getElementsByTagName('*')).some((item) => item.namespaceURI !== BPMN && (!item.namespaceURI || !safeDiagramElements[item.namespaceURI]?.includes(item.localName)));
  const invalidLabels = all(doc, BPMNDI, 'BPMNLabel').some((label) => Array.from(label.getElementsByTagNameNS(DC, 'Bounds')).some((bounds) => !['x', 'y', 'width', 'height'].every((key) => bounds.hasAttribute(key) && Number.isFinite(number(bounds, key)))));
  const duplicateReferences = ['BPMNShape', 'BPMNEdge'].some((tag) => { const refs = all(doc, BPMNDI, tag).map((item) => item.getAttribute('bpmnElement')); return new Set(refs).size !== refs.length; });
  const planeMismatch = planes[0]?.getAttribute('bpmnElement') !== process.getAttribute('id');
  const expandedSubprocess = all(doc, BPMN, 'subProcess').some((item) => ref(doc, 'BPMNShape', item.getAttribute('id') ?? '')?.getAttribute('isExpanded') !== 'false');
  const hasLanes = all(doc, BPMN, 'laneSet').length > 0 || all(doc, BPMN, 'lane').length > 0 || all(doc, BPMN, 'flowNodeRef').length > 0;
  const laneSets = all(doc, BPMN, 'laneSet'); const lanes = all(doc, BPMN, 'lane');
  const laneReferences = all(doc, BPMN, 'flowNodeRef').map((item) => item.textContent?.trim() ?? '');
  const misplacedLaneNode = all(doc, BPMN, 'flowNodeRef').some((item) => {
    const region = regions.find((lane) => lane.id === item.parentElement?.getAttribute('id'));
    const node = nodes.find((entry) => entry.id === item.textContent?.trim());
    return region && node ? !insideRegion(node, region) : true;
  });
  const invalidFlowReferences = ['incoming', 'outgoing'].some((tag) => {
    const refs = all(doc, BPMN, tag);
    return refs.some((item) => {
      const id = item.textContent?.trim(); const node = item.parentElement?.getAttribute('id');
      const edge = edges.find((flow) => flow.id === id);
      return !edge || !node || (tag === 'incoming' ? edge.to !== node : edge.from !== node) || refs.filter((other) => other.parentElement === item.parentElement && other.textContent?.trim() === id).length !== 1;
    });
  });
  const invalidLanes = invalidLaneGeometry || laneSets.length > 1 || laneSets.some((set) => set.parentElement !== process) || lanes.some((lane) => lane.parentElement !== laneSets[0] || ref(doc, 'BPMNShape', lane.getAttribute('id') ?? '')?.getAttribute('isHorizontal') === 'false') || all(doc, BPMN, 'flowNodeRef').some((item) => !lanes.includes(item.parentElement!)) || laneReferences.some((id) => !nodes.some((node) => node.id === id && !['dataObjectReference', 'dataStoreReference', 'textAnnotation'].includes(node.type))) || new Set(laneReferences).size !== laneReferences.length || regions.some((a, i) => regions.slice(i + 1).some((b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y));
  const dataObjects = all(doc, BPMN, 'dataObject');
  const dataRefs = all(doc, BPMN, 'dataObjectReference');
  const invalidData = dataRefs.some((item) => { const id = item.getAttribute('dataObjectRef'); return !id || !dataObjects.some((data) => data.id === id); }) || dataObjects.some((item) => !item.id || item.children.length > 0 || item.getAttribute('isCollection') === 'true' || Array.from(item.attributes).some((a) => !['id', 'name', 'isCollection'].includes(a.name))) || all(doc, BPMN, 'textAnnotation').some((item) => item.hasAttribute('name') || (item.hasAttribute('textFormat') && item.getAttribute('textFormat') !== 'text/plain') || Array.from(item.children).filter((child) => child.localName === 'text').length > 1 || Array.from(item.children).some((child) => child.localName === 'text' && (child.children.length > 0 || child.attributes.length > 0))) || all(doc, BPMN, 'association').some((item) => item.hasAttribute('name'));
  const artifactAttributes: Record<string, string[]> = { dataObjectReference: ['id', 'name', 'dataObjectRef'], textAnnotation: ['id', 'textFormat'], text: [], association: ['id', 'sourceRef', 'targetRef', 'associationDirection'] };
  const unsafeArtifacts = elements.some((item) => artifactAttributes[item.localName] && Array.from(item.attributes).some((attr) => !attr.namespaceURI && !artifactAttributes[item.localName].includes(attr.localName)));
  const invalidEdgeTypes = edges.some((edge) => edge.type === 'sequenceFlow' && [edge.from, edge.to].some((id) => ['dataObjectReference', 'dataStoreReference', 'textAnnotation'].includes(nodes.find((node) => node.id === id)?.type ?? '')));
  const hasDataProfile = elements.some((item) => ['dataStore', 'dataStoreReference', 'ioSpecification', 'dataInput', 'dataOutput', 'inputSet', 'outputSet', 'dataInputAssociation', 'dataOutputAssociation'].includes(item.localName));
  const missingNamespace = !doc.documentElement.getAttribute('targetNamespace')?.trim();
  const readOnly = missingNamespace || (hasDataProfile && !dataInspection.editable) || unsafeEvents || invalidData || unsafeArtifacts || invalidEdgeTypes || unsupported || invalid || unsafeAttributes || outsideProcess || unknownShapes || unknownEdges || foreignContent || unknownDiagramContent || invalidLabels || duplicateReferences || planeMismatch || expandedSubprocess || invalidLanes || invalidFlowReferences || misplacedLaneNode;
  const reason = missingNamespace ? 'Модель доступна только для просмотра: отсутствует обязательный targetNamespace у definitions. Сохранение отключено.' : hasDataProfile && !dataInspection.editable ? `Модель доступна только для просмотра: ${dataInspection.reason} Сохранение отключено.` : hasLanes && (invalidLanes || misplacedLaneNode) ? 'Сложные дорожки или элементы за пределами назначенных дорожек пока доступны только для просмотра. Сохранение отключено; экспорт сохраняет исходный XML.' : 'В модели есть конструкции, которые новый редактор пока не поддерживает. Сохранение отключено; показаны только поддерживаемые элементы.';
  for (const region of regions) region.rowCount = contiguousRows(regions, region).length;
  return { diagram: { nodes, edges, regions }, ...(readOnly ? { readOnlyReason: reason } : {}) };
}

function writable(source: string): Document {
  const doc = parse(source);
  const result = inspect(doc);
  if (result.readOnlyReason) throw new Error(result.readOnlyReason);
  return doc;
}
function requireDataCompatibility(source: string) {
  const result = inspectDataModel(source);
  if (!result.editable) throw new Error(`Операция с данными недоступна: ${result.reason ?? 'модель не поддерживается'}. Исходный XML не изменён.`);
}
function serialize(doc: Document) { return new XMLSerializer().serializeToString(doc); }
function shapeNode(doc: Document, id: string): DiagramNode {
  const found = inspect(doc).diagram.nodes.find((item) => item.id === id);
  if (!found) throw new Error('Элемент диаграммы не найден.');
  return found;
}
function connectionPoints(a: DiagramNode, b: DiagramNode): DiagramPoint[] {
  const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  if (Math.abs(bc.x - ac.x) >= Math.abs(bc.y - ac.y)) {
    const start = { x: ac.x + (bc.x >= ac.x ? a.width / 2 : -a.width / 2), y: ac.y };
    const end = { x: bc.x + (bc.x >= ac.x ? -b.width / 2 : b.width / 2), y: bc.y };
    if (start.y === end.y) return [start, end];
    const mid = (start.x + end.x) / 2;
    return [start, { x: mid, y: start.y }, { x: mid, y: end.y }, end];
  }
  const start = { x: ac.x, y: ac.y + (bc.y >= ac.y ? a.height / 2 : -a.height / 2) };
  const end = { x: bc.x, y: bc.y + (bc.y >= ac.y ? -b.height / 2 : b.height / 2) };
  if (start.x === end.x) return [start, end];
  const mid = (start.y + end.y) / 2;
  return [start, { x: start.x, y: mid }, { x: end.x, y: mid }, end];
}
function setWaypoints(doc: Document, edge: Element, points: DiagramPoint[]) {
  const old = Array.from(edge.getElementsByTagNameNS(DI, 'waypoint'));
  const label = Array.from(edge.children).find((item) => item.namespaceURI === BPMNDI && item.localName === 'BPMNLabel') ?? null;
  points.forEach((point, index) => {
    const waypoint = old[index] ?? element(doc, DI, 'di:waypoint');
    waypoint.setAttribute('x', String(point.x)); waypoint.setAttribute('y', String(point.y));
    if (!waypoint.parentElement) edge.insertBefore(waypoint, label);
  });
  for (const waypoint of old.slice(points.length)) waypoint.remove();
}
function removeFlow(doc: Document, id: string) {
  for (const item of [...all(doc, BPMN, 'incoming'), ...all(doc, BPMN, 'outgoing')]) if (item.textContent?.trim() === id) item.remove();
  ref(doc, 'BPMNEdge', id)?.remove();
  byId(doc, id)?.remove();
}
function insideRegion(node: DiagramNode, lane: DiagramRegion) { const cx = node.x + node.width / 2; const cy = node.y + node.height / 2; return cx >= lane.x + 30 && cx <= lane.x + lane.width && cy >= lane.y && cy <= lane.y + lane.height; }
function assignLane(doc: Document, node: DiagramNode) {
  if (['dataObjectReference', 'dataStoreReference', 'textAnnotation'].includes(node.type)) return;
  for (const item of all(doc, BPMN, 'flowNodeRef')) if (item.textContent?.trim() === node.id) item.remove();
  const region = inspect(doc).diagram.regions?.find((lane) => insideRegion(node, lane));
  if (region) { const item = element(doc, BPMN, 'bpmn:flowNodeRef'); item.textContent = node.id; byId(doc, region.id)!.appendChild(item); }
}
function overlaps(a: DiagramRegion, b: DiagramRegion) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
function contiguousRows(regions: DiagramRegion[], selected: DiagramRegion): DiagramRegion[] {
  const aligned = regions.filter((item) => item.x === selected.x && item.width === selected.width).sort((a, b) => a.y - b.y);
  const index = aligned.findIndex((item) => item.id === selected.id);
  let start = index; let end = index;
  while (start > 0 && aligned[start - 1].y + aligned[start - 1].height === aligned[start].y) start--;
  while (end + 1 < aligned.length && aligned[end].y + aligned[end].height === aligned[end + 1].y) end++;
  return aligned.slice(start, end + 1);
}

export const bpmnNotation: DiagramNotation = {
  id: 'bpmn', title: 'BPMN 2.0', fileExtension: 'bpmn', fileAccept: '.bpmn,.xml,application/xml,text/xml', mimeType: 'application/xml', symbols,
  renderSymbolDetail: (symbol) => symbol.detail ? createElement(BpmnEventGlyph, { symbol: { marker: symbol.detail.marker as EventMarker, filled: symbol.detail.filled }, x: 0, y: 0, width: 24, height: 24 }) : null,
  connectionTypes: [
    { id: 'sequenceFlow', title: 'Поток управления', appearance: { lineStyle: 'solid', arrowEnd: true, arrowStyle: 'filled' } },
    { id: 'dataInputAssociation', title: 'Вход данных', appearance: { lineStyle: 'dotted', arrowEnd: true, arrowStyle: 'open' } },
    { id: 'dataOutputAssociation', title: 'Выход данных', appearance: { lineStyle: 'dotted', arrowEnd: true, arrowStyle: 'open' } },
    { id: 'association', title: 'Ассоциация', appearance: { lineStyle: 'dotted', arrowEnd: false } },
    { id: 'directedAssociation', title: 'Направленная ассоциация', appearance: { lineStyle: 'dotted', arrowEnd: true, arrowStyle: 'open' } },
  ],
  regionTitle: 'Дорожка',
  regionPlacementSize: { width: 800, height: 180 },
  read: (source) => inspect(parse(source)),
  addRegion: (source, at) => {
    const doc = writable(source); const diagram = inspect(doc).diagram;
    const area: DiagramRegion = { id: '', label: '', x: Math.round(at.x), y: Math.round(at.y), ...bpmnNotation.regionPlacementSize! };
    if (diagram.regions?.some((region) => overlaps(region, area))) throw new Error('Дорожки не должны пересекаться.');
    const process = all(doc, BPMN, 'process')[0];
    let set = all(doc, BPMN, 'laneSet')[0];
    if (!set) { set = element(doc, BPMN, 'bpmn:laneSet'); set.setAttribute('id', idFor(doc, 'LaneSet')); process.insertBefore(set, process.firstChild); }
    const id = idFor(doc, 'Lane'); const lane = element(doc, BPMN, 'bpmn:lane'); lane.setAttribute('id', id); lane.setAttribute('name', 'Новая дорожка'); set.appendChild(lane);
    const shape = element(doc, BPMNDI, 'bpmndi:BPMNShape'); shape.setAttribute('id', `${id}_di`); shape.setAttribute('bpmnElement', id); shape.setAttribute('isHorizontal', 'true');
    const bounds = element(doc, DC, 'dc:Bounds'); for (const key of ['x', 'y', 'width', 'height'] as const) bounds.setAttribute(key, String(area[key]));
    shape.appendChild(bounds); all(doc, BPMNDI, 'BPMNPlane')[0].insertBefore(shape, all(doc, BPMNDI, 'BPMNPlane')[0].firstChild);
    for (const node of diagram.nodes.filter((item) => insideRegion(item, area))) assignLane(doc, node);
    return serialize(doc);
  },
  resizeRegion: (source, id, width, height) => {
    const doc = writable(source); const diagram = inspect(doc).diagram; const region = diagram.regions?.find((item) => item.id === id);
    if (!region || !Number.isFinite(width) || !Number.isFinite(height) || width < 160 || height < 80) throw new Error('Минимальный размер дорожки: 160 × 80.');
    const next = { ...region, width: Math.round(width), height: Math.round(height) };
    if (diagram.regions?.some((item) => item.id !== id && overlaps(item, next))) throw new Error('Дорожки не должны пересекаться.');
    const bounds = ref(doc, 'BPMNShape', id)?.getElementsByTagNameNS(DC, 'Bounds')[0];
    if (!bounds) throw new Error('Дорожка не найдена.');
    bounds.setAttribute('width', String(next.width)); bounds.setAttribute('height', String(next.height));
    for (const node of diagram.nodes.filter((item) => insideRegion(item, region) !== insideRegion(item, next))) assignLane(doc, node);
    return serialize(doc);
  },
  moveRegion: (source, id, at) => {
    const doc = writable(source); const diagram = inspect(doc).diagram;
    const region = diagram.regions?.find((item) => item.id === id);
    if (!region || !Number.isFinite(at.x) || !Number.isFinite(at.y)) throw new Error('Некорректное положение дорожки.');
    const x = Math.round(at.x); const y = Math.round(at.y); const dx = x - region.x; const dy = y - region.y;
    const next = { ...region, x, y };
    if (diagram.regions?.some((item) => item.id !== id && overlaps(item, next))) throw new Error('Дорожки не должны пересекаться.');
    const moved = diagram.nodes.filter((node) => insideRegion(node, region));
    if (diagram.nodes.some((node) => !moved.includes(node) && insideRegion(node, next))) throw new Error('На новом месте дорожки находятся другие элементы.');
    const moveBounds = (bounds: Element) => { bounds.setAttribute('x', String(number(bounds, 'x') + dx)); bounds.setAttribute('y', String(number(bounds, 'y') + dy)); };
    for (const itemId of [id, ...moved.map((node) => node.id)]) {
      const shape = ref(doc, 'BPMNShape', itemId)!;
      const bounds = Array.from(shape.children).find((child) => child.namespaceURI === DC && child.localName === 'Bounds');
      if (!bounds) throw new Error('Не найдены границы элемента.');
      moveBounds(bounds);
      const label = shape.getElementsByTagNameNS(BPMNDI, 'BPMNLabel')[0]?.getElementsByTagNameNS(DC, 'Bounds')[0];
      if (label) moveBounds(label);
    }
    const ids = new Set(moved.map((node) => node.id));
    for (const flow of diagram.edges) {
      const from = ids.has(flow.from); const to = ids.has(flow.to);
      if (!from && !to) continue;
      const edge = ref(doc, 'BPMNEdge', flow.id)!;
      const points = flow.points.map((point, index) => from && to || (from && index === 0) || (to && index === flow.points.length - 1) ? { x: point.x + dx, y: point.y + dy } : { ...point });
      if (from !== to && points.length > 2) {
        const end = from ? 0 : points.length - 1; const adjacent = from ? 1 : points.length - 2;
        if (flow.points[end].x === flow.points[adjacent].x) points[adjacent].x = points[end].x;
        else if (flow.points[end].y === flow.points[adjacent].y) points[adjacent].y = points[end].y;
      }
      setWaypoints(doc, edge, points);
      const label = edge.getElementsByTagNameNS(BPMNDI, 'BPMNLabel')[0]?.getElementsByTagNameNS(DC, 'Bounds')[0];
      if (label && from && to) moveBounds(label);
    }
    if (inspect(doc).readOnlyReason) throw new Error('Перемещение нарушает принадлежность элементов дорожкам.');
    return serialize(doc);
  },
  setRegionRows: (source, id, count) => {
    const doc = writable(source); const diagram = inspect(doc).diagram;
    const region = diagram.regions?.find((item) => item.id === id);
    if (!region || !Number.isInteger(count) || count < 1 || count > 100) throw new Error('Число строк должно быть целым от 1 до 100.');
    // Каждая смежная строка — отдельная lane с собственным ID и именем роли.
    const rows = contiguousRows(diagram.regions ?? [], region);
    const first = rows[0];
    // При сокращении сохраняем выбранную строку, чтобы выделение оставалось валидным.
    const start = Math.max(0, rows.findIndex((row) => row.id === id) - count + 1);
    const retained = rows.slice(start, start + count);
    const removed = rows.filter((row) => !retained.includes(row));
    const set = byId(doc, id)!.parentElement!;
    for (const row of removed) {
      const lane = byId(doc, row.id)!; const shape = ref(doc, 'BPMNShape', row.id)!;
      const bounds = Array.from(shape.children).find((child) => child.namespaceURI === DC && child.localName === 'Bounds');
      if (diagram.nodes.some((node) => overlaps(node, row)) || lane.children.length || Array.from(lane.attributes).some((attr) => attr.name !== 'id' && !(attr.name === 'name' && !attr.value)) || shape.children.length !== 1 || !bounds || Array.from(shape.attributes).some((attr) => !['id', 'bpmnElement', 'isHorizontal'].includes(attr.name)) || Array.from(bounds.attributes).some((attr) => !['x', 'y', 'width', 'height'].includes(attr.name))) throw new Error('Нельзя удалить занятую строку или строку с дополнительными данными.');
    }
    const additions: DiagramRegion[] = [];
    while (rows.length + additions.length < count) {
      const last = additions[additions.length - 1] ?? rows[rows.length - 1];
      const next = { ...first, id: '', label: '', y: last.y + last.height, height: first.height };
      if (diagram.regions?.some((item) => overlaps(item, next)) || diagram.nodes.some((node) => overlaps(node, next))) throw new Error('Для новой строки недостаточно свободного места.');
      additions.push(next);
    }
    for (const row of removed) { ref(doc, 'BPMNShape', row.id)!.remove(); byId(doc, row.id)!.remove(); }
    const plane = all(doc, BPMNDI, 'BPMNPlane')[0];
    let after = byId(doc, retained[retained.length - 1].id)!;
    for (const row of additions) {
      const newId = idFor(doc, 'Lane'); const lane = element(doc, BPMN, 'bpmn:lane'); lane.setAttribute('id', newId);
      set.insertBefore(lane, after.nextSibling); after = lane;
      const shape = element(doc, BPMNDI, 'bpmndi:BPMNShape'); shape.setAttribute('id', `${newId}_di`); shape.setAttribute('bpmnElement', newId); shape.setAttribute('isHorizontal', 'true');
      const bounds = element(doc, DC, 'dc:Bounds'); for (const key of ['x', 'y', 'width', 'height'] as const) bounds.setAttribute(key, String(row[key]));
      shape.appendChild(bounds); plane.insertBefore(shape, plane.firstChild);
    }
    return serialize(doc);
  },
  resizeNode: (source, id, width, height) => {
    const doc = writable(source); const diagram = inspect(doc).diagram; const node = diagram.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'textAnnotation') throw new Error('Изменять размер можно только у текстовой аннотации.');
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 40 || height < 30 || node.width <= 0 || node.height <= 0) throw new Error('Минимальный размер аннотации: 40 × 30.');
    width = Math.round(width); height = Math.round(height);
    const bounds = ref(doc, 'BPMNShape', id)!.getElementsByTagNameNS(DC, 'Bounds')[0];
    bounds.setAttribute('width', String(width)); bounds.setAttribute('height', String(height));
    for (const flow of diagram.edges.filter((edge) => edge.from === id || edge.to === id)) {
      const points = flow.points.map((point) => ({ ...point }));
      for (const end of [flow.from === id ? 0 : -1, flow.to === id ? points.length - 1 : -1]) {
        if (end < 0) continue;
        const old = flow.points[end]; const adjacent = end === 0 ? 1 : points.length - 2;
        points[end] = { x: node.x + (old.x - node.x) * width / node.width, y: node.y + (old.y - node.y) * height / node.height };
        if (points.length > 2) {
          if (old.x === flow.points[adjacent].x) points[adjacent].x = points[end].x;
          else if (old.y === flow.points[adjacent].y) points[adjacent].y = points[end].y;
        }
      }
      setWaypoints(doc, ref(doc, 'BPMNEdge', flow.id)!, points);
    }
    return serialize(doc);
  },
  setLabelBounds: (source, id, bounds) => {
    const doc = writable(source); const diagram = inspect(doc).diagram;
    if (!diagram.nodes.some((node) => node.id === id) && !diagram.edges.some((edge) => edge.id === id && edge.type === 'sequenceFlow')) throw new Error('Подпись элемента не найдена.');
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) throw new Error('Некорректные границы подписи.');
    const di = ref(doc, 'BPMNShape', id) ?? ref(doc, 'BPMNEdge', id);
    if (!di) throw new Error('Подпись элемента не найдена.');
    let label = Array.from(di.children).find((child) => child.namespaceURI === BPMNDI && child.localName === 'BPMNLabel');
    if (!label) { label = element(doc, BPMNDI, 'bpmndi:BPMNLabel'); di.appendChild(label); }
    let rect = Array.from(label.children).find((child) => child.namespaceURI === DC && child.localName === 'Bounds');
    if (!rect) { rect = element(doc, DC, 'dc:Bounds'); label.appendChild(rect); }
    for (const key of ['x', 'y', 'width', 'height'] as const) rect.setAttribute(key, String(bounds[key]));
    return serialize(doc);
  },
  addNode: (source, type, at) => {
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) throw new Error('Некорректное положение элемента.');
    const doc = writable(source);
    const symbol = symbols.find((item) => item.type === type);
    if (!symbol) throw new Error('Неизвестный тип элемента.');
    if (type === 'dataStoreReference') { requireDataCompatibility(source); return addDataStore(source, '', { x: Math.round(at.x), y: Math.round(at.y), width: symbol.width, height: symbol.height }).xml; }
    const event = availableEvents.find((item) => eventKey(item.type, item.marker) === type);
    const localName = event?.type ?? type;
    const id = idFor(doc, localName);
    const node = event ? createBpmnEvent(doc, event.key, 'process', { id }) : element(doc, BPMN, `bpmn:${localName}`); node.setAttribute('id', id);
    if (type.endsWith('Task') || type === 'task') node.setAttribute('name', 'Новая задача');
    const process = all(doc, BPMN, 'process')[0];
    const artifact = Array.from(process.children).find((child) => ['association', 'textAnnotation'].includes(child.localName)) ?? null;
    if (type === 'dataObjectReference') { const data = element(doc, BPMN, 'bpmn:dataObject'); data.setAttribute('id', idFor(doc, 'DataObject')); process.insertBefore(data, artifact); node.setAttribute('dataObjectRef', data.id); }
    process.insertBefore(node, type === 'textAnnotation' ? null : artifact);
    const shape = element(doc, BPMNDI, 'bpmndi:BPMNShape'); shape.setAttribute('id', `${id}_di`); shape.setAttribute('bpmnElement', id);
    if (bpmnCatalog.find((item) => item.type === type)?.isExpanded === false) shape.setAttribute('isExpanded', 'false');
    const bounds = element(doc, DC, 'dc:Bounds');
    for (const [key, value] of Object.entries({ x: at.x, y: at.y, width: symbol.width, height: symbol.height })) bounds.setAttribute(key, String(Math.round(value)));
    shape.appendChild(bounds); all(doc, BPMNDI, 'BPMNPlane')[0].appendChild(shape);
    assignLane(doc, shapeNode(doc, id));
    return serialize(doc);
  },
  moveNode: (source, id, at) => {
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) throw new Error('Некорректное положение элемента.');
    const doc = writable(source);
    const shape = ref(doc, 'BPMNShape', id);
    const bounds = shape?.getElementsByTagNameNS(DC, 'Bounds')[0];
    if (!bounds) throw new Error('Элемент диаграммы не найден.');
    const x = Math.round(at.x); const y = Math.round(at.y);
    const dx = x - number(bounds, 'x'); const dy = y - number(bounds, 'y');
    const labelBounds = shape?.getElementsByTagNameNS(BPMNDI, 'BPMNLabel')[0]?.getElementsByTagNameNS(DC, 'Bounds')[0];
    if (labelBounds) { labelBounds.setAttribute('x', String(number(labelBounds, 'x') + dx)); labelBounds.setAttribute('y', String(number(labelBounds, 'y') + dy)); }
    bounds.setAttribute('x', String(x)); bounds.setAttribute('y', String(y));
    assignLane(doc, shapeNode(doc, id));
    const diagram = inspect(doc).diagram;
    for (const flow of diagram.edges.filter((edge) => edge.from === id || edge.to === id)) {
      const edge = ref(doc, 'BPMNEdge', flow.id); const from = diagram.nodes.find((n) => n.id === flow.from); const to = diagram.nodes.find((n) => n.id === flow.to);
      if (edge && from && to) {
        const points = flow.points.map((point, index) => (index === 0 && flow.from === id) || (index === flow.points.length - 1 && flow.to === id) ? { x: point.x + dx, y: point.y + dy } : { ...point });
        if (points.length > 2) {
          const adjust = (end: number, adjacent: number) => {
            const before = flow.points[end]; const next = flow.points[adjacent];
            if (before.x === next.x) points[adjacent].x = points[end].x;
            else if (before.y === next.y) points[adjacent].y = points[end].y;
          };
          if (flow.from === id) adjust(0, 1);
          if (flow.to === id) adjust(points.length - 1, points.length - 2);
        }
        setWaypoints(doc, edge, points);
      }
    }
    return serialize(doc);
  },
  rename: (source, id, name) => {
    const doc = writable(source); const item = byId(doc, id);
    if (!item || item.namespaceURI !== BPMN || (!nodeTypes.has(item.localName) && item.localName !== 'sequenceFlow' && item.localName !== 'lane')) throw new Error('Элемент диаграммы не найден.');
    if (item.localName === 'textAnnotation') { let text = Array.from(item.children).find((child) => child.namespaceURI === BPMN && child.localName === 'text'); if (!text) { text = element(doc, BPMN, 'bpmn:text'); item.appendChild(text); } text.textContent = name; } else item.setAttribute('name', name); return serialize(doc);
  },
  connect: (source, from, to, type) => {
    const doc = writable(source);
    if (from === to) throw new Error('Нельзя связать элемент с самим собой.');
    const a = shapeNode(doc, from); const b = shapeNode(doc, to);
    const dataTypes = ['dataObjectReference', 'dataStoreReference'];
    const activityTypes = ['task', 'userTask', 'serviceTask', 'manualTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'scriptTask', 'subProcess'];
    const inferred = dataTypes.includes(a.type) && activityTypes.includes(b.type) ? 'dataInputAssociation' : activityTypes.includes(a.type) && dataTypes.includes(b.type) ? 'dataOutputAssociation' : undefined;
    if (type === 'dataInputAssociation' || type === 'dataOutputAssociation' || (!type && inferred)) { requireDataCompatibility(source); return addDataAssociation(source, (type || inferred) as 'dataInputAssociation' | 'dataOutputAssociation', from, to, connectionPoints(a, b)).xml; }
    if (type && !['sequenceFlow', 'association', 'directedAssociation'].includes(type)) throw new Error('Неизвестный тип связи.');
    const artifacts = [a.type, b.type].some((nodeType) => ['dataObjectReference', 'dataStoreReference', 'textAnnotation'].includes(nodeType));
    const association = type ? type !== 'sequenceFlow' : artifacts;
    if (!association && artifacts) throw new Error('Поток управления нельзя подключить к объекту данных или аннотации.');
    if (!association && (baseType(a.type) === 'endEvent' || baseType(b.type) === 'startEvent')) throw new Error('Связь не может выходить из конечного или входить в начальное событие.');
    if (inspect(doc).diagram.edges.some((edge) => edge.from === from && edge.to === to)) throw new Error('Такая связь уже существует.');
    const id = idFor(doc, 'Flow');
    const flow = element(doc, BPMN, association ? 'bpmn:association' : 'bpmn:sequenceFlow'); flow.setAttribute('id', id); flow.setAttribute('sourceRef', from); flow.setAttribute('targetRef', to); if (type === 'directedAssociation') flow.setAttribute('associationDirection', 'One');
    const process = all(doc, BPMN, 'process')[0];
    process.insertBefore(flow, association ? null : Array.from(process.children).find((child) => ['association', 'textAnnotation'].includes(child.localName)) ?? null);
    if (!association) for (const [nodeId, tag] of [[from, 'outgoing'], [to, 'incoming']]) { const item = element(doc, BPMN, `bpmn:${tag}`); item.textContent = id; const node = byId(doc, nodeId)!; insertFlowRef(node, item, tag); }
    const edge = element(doc, BPMNDI, 'bpmndi:BPMNEdge'); edge.setAttribute('id', `${id}_di`); edge.setAttribute('bpmnElement', id);
    setWaypoints(doc, edge, connectionPoints(a, b)); all(doc, BPMNDI, 'BPMNPlane')[0].appendChild(edge);
    return serialize(doc);
  },
  editEdge: (source, id, from, to, points) => {
    const doc = writable(source); const diagram = inspect(doc).diagram;
    const old = diagram.edges.find((edge) => edge.id === id);
    const flow = byId(doc, id); const di = ref(doc, 'BPMNEdge', id);
    if (!old || !flow || !di) throw new Error('Связь не найдена.');
    const a = shapeNode(doc, from); const b = shapeNode(doc, to);
    if (old.type === 'dataInputAssociation' || old.type === 'dataOutputAssociation') return editDataAssociation(source, id, from, to, points);
    if (from === to) throw new Error('Нельзя связать элемент с самим собой.');
    const association = old.type === 'association';
    if (!association && [a.type, b.type].some((type) => ['dataObjectReference', 'dataStoreReference', 'textAnnotation'].includes(type))) throw new Error('Поток управления нельзя подключить к объекту данных или аннотации.');
    if (!association && (baseType(a.type) === 'endEvent' || baseType(b.type) === 'startEvent')) throw new Error('Связь не может выходить из конечного или входить в начальное событие.');
    if (diagram.edges.some((edge) => edge.id !== id && edge.from === from && edge.to === to)) throw new Error('Такая связь уже существует.');
    if (points.length < 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('Некорректный маршрут связи.');
    if (!association) for (const [previous, next, tag] of [[old.from, from, 'outgoing'], [old.to, to, 'incoming']]) {
      if (previous === next) continue;
      const oldNode = byId(doc, previous); const newNode = byId(doc, next)!;
      const refs = Array.from(oldNode?.children ?? []).filter((item) => item.namespaceURI === BPMN && item.localName === tag && item.textContent?.trim() === id);
      for (const ref of refs) {
        insertFlowRef(newNode, ref, tag);
      }
    }
    flow.setAttribute('sourceRef', from); flow.setAttribute('targetRef', to);
    setWaypoints(doc, di, points);
    return serialize(doc);
  },
  resetEdge: (source, id) => {
    const doc = writable(source); const edge = inspect(doc).diagram.edges.find((item) => item.id === id);
    const di = ref(doc, 'BPMNEdge', id);
    if (!edge || !di) throw new Error('Связь не найдена.');
    setWaypoints(doc, di, connectionPoints(shapeNode(doc, edge.from), shapeNode(doc, edge.to)));
    return serialize(doc);
  },
  remove: (source, id) => {
    const doc = writable(source); const item = byId(doc, id);
    if (!item || item.namespaceURI !== BPMN) throw new Error('Элемент диаграммы не найден.');
    if (['dataInputAssociation', 'dataOutputAssociation'].includes(item.localName)) return removeDataAssociation(source, id);
    if (nodeTypes.has(item.localName) && inspectDataModel(source).edges.some((edge) => edge.activityId === id || edge.dataId === id)) return bpmnNotation.remove(removeDataConnectionsForNode(source, id), id);
    if (item.localName === 'lane') { const parent = item.parentElement; ref(doc, 'BPMNShape', id)?.remove(); item.remove(); if (parent && !Array.from(parent.children).some((child) => child.localName === 'lane')) parent.remove(); }
    else if (['sequenceFlow', 'association'].includes(item.localName)) removeFlow(doc, id);
    else if (nodeTypes.has(item.localName)) {
      for (const edge of inspect(doc).diagram.edges.filter((flow) => flow.from === id || flow.to === id)) removeFlow(doc, edge.id);
      for (const ref of all(doc, BPMN, 'flowNodeRef')) if (ref.textContent?.trim() === id) ref.remove();
      // Определение данных остаётся в XML: на него могут ссылаться другие представления.
      ref(doc, 'BPMNShape', id)?.remove(); item.remove();
    } else throw new Error('Этот объект нельзя удалить.');
    return serialize(doc);
  },
};
