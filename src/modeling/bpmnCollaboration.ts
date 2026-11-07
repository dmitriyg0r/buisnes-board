import { bpmnNotation } from './bpmn';
import type { DiagramBounds, DiagramPoint } from './types';

const MODEL = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMNDI = 'http://www.omg.org/spec/BPMN/20100524/DI';
const DC = 'http://www.omg.org/spec/DD/20100524/DC';
const DI = 'http://www.omg.org/spec/DD/20100524/DI';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const reason = 'Эта модель пока доступна только для просмотра: на схеме показаны не все элементы. Сохранение отключено; экспорт содержит исходный XML.';
const all = (node: Document | Element, ns: string, name: string) => Array.from(node.getElementsByTagNameNS(ns, name));
const children = (node: Element) => Array.from(node.children);
const id = (node: Element) => node.getAttribute('id') ?? '';
const ref = (node: Element, name: string) => node.getAttribute(name) ?? '';
const serial = (doc: Document) => new XMLSerializer().serializeToString(doc);
function parse(source: string) {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.namespaceURI !== MODEL || doc.documentElement.localName !== 'definitions') throw new Error('Некорректный BPMN XML.');
  return doc;
}
function attrs(node: Element, names: string[]) {
  return Array.from(node.attributes).every(a => a.namespaceURI === XMLNS || (!a.namespaceURI && names.includes(a.localName)));
}
function uniqueId(doc: Document, prefix: string) {
  const used = new Set(all(doc, '*', '*').map(id));
  // Случайный ID не переиспользуется после удаления объекта и его DI.
  // При недоступности криптографического генератора операция должна завершиться ошибкой.
  if (!globalThis.crypto?.getRandomValues) throw new Error('Недоступен безопасный генератор идентификаторов.');
  for (let attempt = 0; attempt < 100; attempt++) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const value = `${prefix}_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
    if (!used.has(value) && !used.has(`${value}_di`)) return value;
  }
  throw new Error('Не удалось создать уникальный идентификатор.');
}
function bounds(shape: Element): DiagramBounds {
  const b = children(shape).find(c => c.namespaceURI === DC && c.localName === 'Bounds');
  if (!b || !['x', 'y', 'width', 'height'].every(k => b.hasAttribute(k) && Number.isFinite(Number(b.getAttribute(k))))) throw new Error(reason);
  const result = { x: Number(b.getAttribute('x')), y: Number(b.getAttribute('y')), width: Number(b.getAttribute('width')), height: Number(b.getAttribute('height')) };
  if (result.width <= 0 || result.height <= 0) throw new Error(reason);
  return result;
}
function shape(doc: Document, target: string) { return all(doc, BPMNDI, 'BPMNShape').find(s => ref(s, 'bpmnElement') === target); }
function makeShape(doc: Document, target: string, rect: DiagramBounds) {
  const s = doc.createElementNS(BPMNDI, 'bpmndi:BPMNShape'); s.setAttribute('id', `${target}_di`); s.setAttribute('bpmnElement', target); s.setAttribute('isHorizontal', 'true');
  const b = doc.createElementNS(DC, 'dc:Bounds'); for (const [key, value] of Object.entries(rect)) b.setAttribute(key, String(value)); s.appendChild(b); return s;
}
function validRect(r: DiagramBounds) { return [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0; }
function overlap(a: DiagramBounds, b: DiagramBounds) { return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height; }
function inside(inner: DiagramBounds, outer: DiagramBounds) { return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height; }
function points(edge: Element): DiagramPoint[] {
  return children(edge).filter(e => e.namespaceURI === DI && e.localName === 'waypoint').map(p => ({ x: Number(p.getAttribute('x')), y: Number(p.getAttribute('y')) }));
}
// Проверка открытого внутреннего прямоугольника для каждого сегмента.
function crossesInterior(a: DiagramPoint, b: DiagramPoint, r: DiagramBounds) {
  let low = 0, high = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, r.x, r.x + r.width], [a.y, b.y - a.y, r.y, r.y + r.height]]) {
    if (delta === 0) { if (start <= min || start >= max) return false; continue; }
    const t1 = (min - start) / delta, t2 = (max - start) / delta;
    low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
    if (low >= high) return false;
  }
  return low < high;
}
function safeRoute(route: DiagramPoint[], pools: { bounds: DiagramBounds }[]) {
  return route.slice(1).every((p, i) => pools.every(pool => !crossesInterior(route[i], p, pool.bounds)));
}
export function validProcessBooleans(doc: Document) {
  return all(doc, MODEL, 'process').every(p => !p.hasAttribute('isExecutable') || ['true', 'false', '1', '0'].includes(p.getAttribute('isExecutable')!.trim()));
}
function onBoundary(p: DiagramPoint, r: DiagramBounds) {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height && (p.x === r.x || p.x === r.x + r.width || p.y === r.y || p.y === r.y + r.height);
}

/** Только один раскрытый процесс и не более одного внешнего black-box пула.
 * Существующий bpmnNotation напрямую не редактирует collaboration: интеграция должна
 * вызывать эти функции отдельно и блокировать его методы для collaboration XML. */
export function inspectCollaboration(source: string): { editable: boolean; readOnlyReason?: string; processId?: string; participants: { id: string; name: string; processRef?: string; bounds: DiagramBounds }[]; messageFlows: { id: string; from: string; to: string; points: DiagramPoint[] }[] } {
  const empty = { editable: false, readOnlyReason: reason, participants: [], messageFlows: [] };
  try {
    const doc = parse(source); const processes = all(doc, MODEL, 'process'); const collaborations = all(doc, MODEL, 'collaboration'); const planes = all(doc, BPMNDI, 'BPMNPlane');
    if (!validProcessBooleans(doc) || processes.length !== 1 || collaborations.length !== 1 || planes.length !== 1 || all(doc, BPMNDI, 'BPMNDiagram').length !== 1) return empty;
    const process = processes[0], collab = collaborations[0], plane = planes[0];
    if (process.parentElement !== doc.documentElement || collab.parentElement !== doc.documentElement || !id(process) || !id(collab) || ref(plane, 'bpmnElement') !== id(collab) || !attrs(collab, ['id', 'name', 'isClosed'])) return empty;
    const ids = all(doc, '*', '*').map(id).filter(Boolean); if (new Set(ids).size !== ids.length) return empty;
    if (collab.hasAttribute('isClosed') && !['true', 'false', '1', '0'].includes(ref(collab, 'isClosed').trim())) return empty;
    const entries = children(collab); if (entries.some(e => e.namespaceURI !== MODEL || !['participant', 'messageFlow'].includes(e.localName))) return empty;
    const participants = entries.filter(e => e.localName === 'participant'); const flows = entries.filter(e => e.localName === 'messageFlow');
    if (participants.length < 1 || participants.length > 2 || participants.some(p => !id(p) || children(p).length || !attrs(p, ['id', 'name', 'processRef']))) return empty;
    if (participants.filter(p => ref(p, 'processRef') === id(process)).length !== 1 || participants.some(p => ref(p, 'processRef') && ref(p, 'processRef') !== id(process))) return empty;
    const poolShapes = participants.map(p => shape(doc, id(p)));
    if (poolShapes.some(s => !s || s.parentElement !== plane || !id(s) || !attrs(s, ['id', 'bpmnElement', 'isHorizontal']) || (s.hasAttribute('isHorizontal') && !['true', '1'].includes(ref(s, 'isHorizontal').trim())) || children(s).length !== 1 || children(s)[0].namespaceURI !== DC || children(s)[0].localName !== 'Bounds' || !attrs(children(s)[0], ['x', 'y', 'width', 'height']))) return empty;
    const pools = participants.map((p, i) => ({ id: id(p), name: ref(p, 'name'), ...(ref(p, 'processRef') ? { processRef: ref(p, 'processRef') } : {}), bounds: bounds(poolShapes[i]!) }));
    if (pools.length === 2 && overlap(pools[0].bounds, pools[1].bounds)) return empty;
    const messageFlows: { id: string; from: string; to: string; points: DiagramPoint[] }[] = [];
    for (const flow of flows) {
      const from = ref(flow, 'sourceRef'), to = ref(flow, 'targetRef');
      if (!id(flow) || !attrs(flow, ['id', 'name', 'sourceRef', 'targetRef']) || children(flow).length || from === to || !pools.some(p => p.id === from) || !pools.some(p => p.id === to)) return empty;
      const edges = all(doc, BPMNDI, 'BPMNEdge').filter(e => ref(e, 'bpmnElement') === id(flow)); const edge = edges[0];
      if (edges.length !== 1 || edge.parentElement !== plane || !id(edge) || !attrs(edge, ['id', 'bpmnElement']) || children(edge).length < 2 || children(edge).some(p => p.namespaceURI !== DI || p.localName !== 'waypoint' || !attrs(p, ['x', 'y']) || !p.hasAttribute('x') || !p.hasAttribute('y'))) return empty;
      const route = points(edge); if (route.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || !onBoundary(route[0], pools.find(p => p.id === from)!.bounds) || !onBoundary(route[route.length - 1], pools.find(p => p.id === to)!.bounds) || !safeRoute(route, pools)) return empty;
      messageFlows.push({ id: id(flow), from, to, points: route });
    }
    const clone = doc.cloneNode(true) as Document; const cloneCollab = all(clone, MODEL, 'collaboration')[0];
    for (const p of pools) shape(clone, p.id)?.remove();
    for (const f of messageFlows) all(clone, BPMNDI, 'BPMNEdge').find(e => ref(e, 'bpmnElement') === f.id)?.remove();
    cloneCollab.remove(); all(clone, BPMNDI, 'BPMNPlane')[0].setAttribute('bpmnElement', id(process));
    const base = bpmnNotation.read(serial(clone)); if (base.readOnlyReason) return empty;
    const expanded = pools.find(p => p.processRef)!;
    if ([...base.diagram.nodes, ...(base.diagram.regions ?? [])].some(item => !inside(item, expanded.bounds))) return empty;
    if (base.diagram.edges.some(edge => edge.points.some(p => p.x < expanded.bounds.x || p.x > expanded.bounds.x + expanded.bounds.width || p.y < expanded.bounds.y || p.y > expanded.bounds.y + expanded.bounds.height))) return empty;
    return { editable: true, processId: id(process), participants: pools, messageFlows };
  } catch { return empty; }
}
function writable(source: string) { const inspection = inspectCollaboration(source); if (!inspection.editable) throw new Error(inspection.readOnlyReason); return { doc: parse(source), inspection }; }
function finished(doc: Document) { const source = serial(doc); if (!inspectCollaboration(source).editable) throw new Error(reason); return source; }

/** Создаёт рамку вокруг существующих объектов без изменения их DI и привязок. */
export function convertToCollaboration(source: string): string {
  const doc = parse(source); const base = bpmnNotation.read(source);
  if (!validProcessBooleans(doc) || base.readOnlyReason || all(doc, MODEL, 'collaboration').length) throw new Error(reason);
  const process = all(doc, MODEL, 'process')[0], plane = all(doc, BPMNDI, 'BPMNPlane')[0];
  if (!process || !id(process) || process.parentElement !== doc.documentElement || !plane) throw new Error(reason);
  const rects = [...base.diagram.nodes, ...(base.diagram.regions ?? []), ...base.diagram.edges.flatMap(edge => edge.points.map(point => ({ ...point, width: 0, height: 0 })))];
  const x = rects.length ? Math.min(...rects.map(r => r.x)) - 40 : 0, y = rects.length ? Math.min(...rects.map(r => r.y)) - 20 : 0;
  const right = rects.length ? Math.max(...rects.map(r => r.x + r.width)) + 20 : 600, bottom = rects.length ? Math.max(...rects.map(r => r.y + r.height)) + 20 : 200;
  const collab = doc.createElementNS(MODEL, 'bpmn:collaboration'); const cid = uniqueId(doc, 'Collaboration'); collab.setAttribute('id', cid);
  const participant = doc.createElementNS(MODEL, 'bpmn:participant'); const pid = uniqueId(doc, 'Participant'); participant.setAttribute('id', pid); participant.setAttribute('processRef', id(process)); collab.appendChild(participant);
  doc.documentElement.insertBefore(collab, Array.from(doc.documentElement.children).find(e => e.namespaceURI === BPMNDI && e.localName === 'BPMNDiagram') ?? null);
  plane.setAttribute('bpmnElement', cid); plane.insertBefore(makeShape(doc, pid, { x, y, width: right - x, height: bottom - y }), plane.firstChild);
  return finished(doc);
}
export function addBlackBoxParticipant(source: string, name: string, rect: DiagramBounds): string {
  const { doc, inspection } = writable(source); if (inspection.participants.length !== 1 || !validRect(rect) || inspection.participants.some(p => overlap(p.bounds, rect))) throw new Error('Некорректное положение или число пулов.');
  const participant = doc.createElementNS(MODEL, 'bpmn:participant'); const pid = uniqueId(doc, 'Participant'); participant.setAttribute('id', pid); participant.setAttribute('name', name);
  const collab = all(doc, MODEL, 'collaboration')[0]; collab.insertBefore(participant, children(collab).find(e => e.localName === 'messageFlow') ?? null);
  all(doc, BPMNDI, 'BPMNPlane')[0].insertBefore(makeShape(doc, pid, rect), all(doc, BPMNDI, 'BPMNPlane')[0].firstChild); return finished(doc);
}
/** Потоки ограничены границами пулов: узлы событий и задач не поддерживаются. */
export function addMessageFlow(source: string, from: string, to: string, route: DiagramPoint[], name = ''): string {
  const { doc, inspection } = writable(source); const a = inspection.participants.find(p => p.id === from), b = inspection.participants.find(p => p.id === to);
  if (!a || !b || from === to || route.length < 2 || route.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || !onBoundary(route[0], a.bounds) || !onBoundary(route[route.length - 1], b.bounds) || !safeRoute(route, inspection.participants)) throw new Error('Поток должен соединять границы разных пулов.');
  if (inspection.messageFlows.some(f => f.from === from && f.to === to)) throw new Error('Такая связь уже существует.');
  const fid = uniqueId(doc, 'MessageFlow'); const flow = doc.createElementNS(MODEL, 'bpmn:messageFlow'); for (const [key, value] of Object.entries({ id: fid, sourceRef: from, targetRef: to, name })) flow.setAttribute(key, value); all(doc, MODEL, 'collaboration')[0].appendChild(flow);
  const edge = doc.createElementNS(BPMNDI, 'bpmndi:BPMNEdge'); edge.setAttribute('id', `${fid}_di`); edge.setAttribute('bpmnElement', fid);
  for (const point of route) { const p = doc.createElementNS(DI, 'di:waypoint'); p.setAttribute('x', String(point.x)); p.setAttribute('y', String(point.y)); edge.appendChild(p); }
  all(doc, BPMNDI, 'BPMNPlane')[0].appendChild(edge); return finished(doc);
}
export function renameParticipant(source: string, participantId: string, name: string): string {
  const { doc, inspection } = writable(source);
  if (!inspection.participants.some(p => p.id === participantId)) throw new Error('Пул не найден.');
  all(doc, MODEL, 'participant').find(p => id(p) === participantId)!.setAttribute('name', name);
  return finished(doc);
}
export function moveBlackBoxParticipant(source: string, participantId: string, at: DiagramPoint): string {
  const { doc, inspection } = writable(source); const pool = inspection.participants.find(p => p.id === participantId);
  if (!pool || pool.processRef || !Number.isFinite(at.x) || !Number.isFinite(at.y)) throw new Error('Переносится только внешний пул.');
  if (inspection.messageFlows.some(f => f.from === participantId || f.to === participantId)) throw new Error('Сначала удалите связанные потоки.');
  const next = { ...pool.bounds, x: at.x, y: at.y };
  if (inspection.participants.some(p => p.id !== participantId && overlap(p.bounds, next))) throw new Error('Пулы пересекаются.');
  const b = children(shape(doc, participantId)!)[0]; b.setAttribute('x', String(at.x)); b.setAttribute('y', String(at.y));
  return finished(doc);
}
/** Пустой основной пул можно убрать, сохранив исходный процесс и его ID. */
export function removeCollaborationElement(source: string, elementId: string): string {
  const { doc, inspection } = writable(source); const flow = inspection.messageFlows.find(f => f.id === elementId); const pool = inspection.participants.find(p => p.id === elementId);
  if (!flow && !pool) throw new Error('Элемент collaboration не найден.');
  if (pool && inspection.messageFlows.some(f => f.from === elementId || f.to === elementId)) throw new Error('Сначала удалите связанные с пулом потоки сообщений.');
  if (pool?.processRef) {
    if (inspection.participants.length !== 1) throw new Error('Сначала удалите остальные пулы.');
    const process = all(doc, MODEL, 'process').find(item => id(item) === pool.processRef)!;
    if (children(process).length) throw new Error('Основной пул можно удалить, только если в процессе нет элементов и дорожек.');
    const collaboration = all(doc, MODEL, 'collaboration')[0];
    if (Array.from(collaboration.attributes).some(attr => attr.namespaceURI !== XMLNS && (attr.namespaceURI || attr.localName !== 'id')) || Array.from(collaboration.childNodes).some(node => node.nodeType !== Node.ELEMENT_NODE && (node.nodeType !== Node.TEXT_NODE || node.textContent?.trim()))) throw new Error('В совместной модели есть дополнительные данные. Удаление пула отменено.');
    shape(doc, elementId)!.remove();
    collaboration.remove();
    all(doc, BPMNDI, 'BPMNPlane')[0].setAttribute('bpmnElement', pool.processRef);
    const result = serial(doc);
    if (bpmnNotation.read(result).readOnlyReason) throw new Error('Не удалось безопасно удалить пул.');
    return result;
  }
  const element = all(doc, MODEL, '*').find(e => id(e) === elementId)!;
  (flow ? all(doc, BPMNDI, 'BPMNEdge').find(e => ref(e, 'bpmnElement') === elementId) : shape(doc, elementId))!.remove(); element.remove(); return finished(doc);
}
