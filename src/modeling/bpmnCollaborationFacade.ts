import { bpmnNotation } from './bpmn';
import { inspectCollaboration, convertToCollaboration, addBlackBoxParticipant, addMessageFlow, moveBlackBoxParticipant, removeCollaborationElement, renameParticipant, validProcessBooleans } from './bpmnCollaboration';
import type { DiagramBounds, DiagramNotation, DiagramPoint } from './types';

const MODEL = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const DC = 'http://www.omg.org/spec/DD/20100524/DC';
const DI = 'http://www.omg.org/spec/DD/20100524/DI';
const BPMNDI = 'http://www.omg.org/spec/BPMN/20100524/DI';
const all = (node: Document | Element, ns: string, name: string) => Array.from(node.getElementsByTagNameNS(ns, name));
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc);
function parse(source: string): Document {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.namespaceURI !== MODEL || doc.documentElement.localName !== 'definitions') throw new Error('Некорректный BPMN XML.');
  return doc;
}

/** Проекция не удаляет данные исходного документа: все изменения выполняются на копии. */
function project(source: string) {
  const inspection = inspectCollaboration(source);
  if (!inspection.editable || !inspection.processId) throw new Error(inspection.readOnlyReason ?? 'Collaboration недоступна для редактирования.');
  const doc = parse(source);
  const collaboration = all(doc, MODEL, 'collaboration')[0];
  const plane = all(doc, BPMNDI, 'BPMNPlane')[0];
  const protectedIds = new Set([...inspection.participants.map(p => p.id), ...inspection.messageFlows.map(f => f.id)]);
  const protectedDi = Array.from(plane.children).filter(e => protectedIds.has(e.getAttribute('bpmnElement') ?? ''));
  const collabNext = collaboration.nextElementSibling;
  const rootIndex = Array.from(doc.documentElement.children).indexOf(collaboration);
  const positions = protectedDi.map(e => ({ element: e.cloneNode(true) as Element, index: Array.from(plane.children).indexOf(e), next: e.nextElementSibling?.getAttribute('id') ?? null }));
  const saved = collaboration.cloneNode(true) as Element;
  collaboration.remove(); protectedDi.forEach(e => e.remove());
  plane.setAttribute('bpmnElement', inspection.processId);
  return { xml: serialize(doc), saved, positions, rootNextId: collabNext?.getAttribute('id') ?? null, rootIndex, collaborationId: saved.getAttribute('id')! };
}
function restore(source: string, projection: ReturnType<typeof project>): string {
  const doc = parse(source), root = doc.documentElement;
  const plane = all(doc, BPMNDI, 'BPMNPlane')[0];
  if (!plane || all(doc, MODEL, 'collaboration').length) throw new Error('Изменение нарушило структуру collaboration.');
  const rootChildren = Array.from(root.children);
  const next = (projection.rootNextId ? rootChildren.find(e => e.getAttribute('id') === projection.rootNextId) : undefined) ?? rootChildren[projection.rootIndex] ?? null;
  root.insertBefore(doc.importNode(projection.saved, true), next);
  plane.setAttribute('bpmnElement', projection.collaborationId);
  for (const item of projection.positions) {
    const children = Array.from(plane.children);
    const before = (item.next ? children.find(e => e.getAttribute('id') === item.next) : undefined) ?? children[item.index] ?? null;
    plane.insertBefore(doc.importNode(item.element, true), before);
  }
  const result = serialize(doc);
  const inspection = inspectCollaboration(result);
  if (!inspection.editable) throw new Error('Изменение нарушает границы пула или структуру collaboration.');
  const pool = inspection.participants.find(p => p.processRef)!.bounds;
  const before = bpmnNotation.read(projection.xml).diagram.edges;
  const after = bpmnNotation.read(source).diagram.edges;
  for (const edge of after) {
    const previous = before.find(e => e.id === edge.id);
    if (previous && JSON.stringify(previous.points) === JSON.stringify(edge.points)) continue;
    if (edge.points.some(p => p.x < pool.x || p.x > pool.x + pool.width || p.y < pool.y || p.y > pool.y + pool.height)) throw new Error('Маршрут связи выходит за границы пула.');
  }
  return result;
}
function mutate(source: string, action: (xml: string) => string): string {
  const doc = parse(source);
  if (!validProcessBooleans(doc)) throw new Error('Некорректное логическое значение isExecutable.');
  if (!all(doc, MODEL, 'collaboration').length) return action(source);
  const projection = project(source);
  return restore(action(projection.xml), projection);
}

// Маршрут проходит по промежутку между пулами.
function routeBetween(a: DiagramBounds, b: DiagramBounds): DiagramPoint[] {
  let start: DiagramPoint, end: DiagramPoint, middle: DiagramPoint[];
  if (a.x + a.width <= b.x || b.x + b.width <= a.x) {
    const forward = a.x + a.width <= b.x;
    start = { x: forward ? a.x + a.width : a.x, y: a.y + a.height / 2 };
    end = { x: forward ? b.x : b.x + b.width, y: b.y + b.height / 2 };
    const x = (start.x + end.x) / 2;
    middle = [{ x, y: start.y }, { x, y: end.y }];
  } else {
    const forward = a.y + a.height <= b.y;
    start = { x: a.x + a.width / 2, y: forward ? a.y + a.height : a.y };
    end = { x: b.x + b.width / 2, y: forward ? b.y : b.y + b.height };
    const y = (start.y + end.y) / 2;
    middle = [{ x: start.x, y }, { x: end.x, y }];
  }
  let result = [start, ...middle, end].filter((p, i, arr) => !i || p.x !== arr[i - 1].x || p.y !== arr[i - 1].y);
  if (result.length < 2) {
    // При совпадении середин сторон используем общий участок границы.
    if (a.x + a.width === b.x || b.x + b.width === a.x) {
      const delta = Math.min(a.height, b.height) / 4;
      result = [{ x: start.x, y: start.y - delta }, { x: end.x, y: end.y + delta }];
    } else {
      const delta = Math.min(a.width, b.width) / 4;
      result = [{ x: start.x - delta, y: start.y }, { x: end.x + delta, y: end.y }];
    }
  }
  return result;
}

/** Совместимый API core и отдельные явные операции collaboration. */
export const bpmnCollaborationFacade: DiagramNotation & {
  convertToCollaboration: typeof convertToCollaboration;
  addBlackBoxParticipant: typeof addBlackBoxParticipant;
  addMessageFlow: typeof addMessageFlow;
  moveBlackBoxParticipant: typeof moveBlackBoxParticipant;
  removeCollaborationElement: typeof removeCollaborationElement;
} = {
  ...bpmnNotation,
  poolPlacementSize: { width: 400, height: 120 },
  connectionTypes: [...(bpmnNotation.connectionTypes ?? []), { id: 'messageFlow', title: 'Поток сообщений', appearance: { lineStyle: 'dashed', startMarker: 'circle', arrowEnd: true, arrowStyle: 'open' } }],
  read(source) {
    const doc = parse(source);
    if (!all(doc, MODEL, 'collaboration').length) {
      const result = bpmnNotation.read(source);
      return validProcessBooleans(doc) ? result : { ...result, readOnlyReason: 'Некорректное логическое значение isExecutable.' };
    }
    const inspection = inspectCollaboration(source);
    // Неподдерживаемую модель показываем только частично и без права записи.
    let base: ReturnType<typeof bpmnNotation.read>;
    if (inspection.editable) base = bpmnNotation.read(project(source).xml);
    else if (all(doc, MODEL, 'process').length) base = bpmnNotation.read(source);
    else base = { diagram: { nodes: [], edges: [], regions: [] } };
    const participants = all(doc, MODEL, 'participant');
    const regions = participants.flatMap(p => {
      const id = p.getAttribute('id');
      const shape = all(doc, BPMNDI, 'BPMNShape').find(e => e.getAttribute('bpmnElement') === id);
      const b = shape && all(shape, DC, 'Bounds')[0];
      if (!id || !b || !['x', 'y', 'width', 'height'].every(k => b.hasAttribute(k) && Number.isFinite(Number(b.getAttribute(k))))) return [];
      return [{ kind: 'pool' as const, id, label: p.getAttribute('name') ?? '', x: Number(b.getAttribute('x')), y: Number(b.getAttribute('y')), width: Number(b.getAttribute('width')), height: Number(b.getAttribute('height')) }];
    });
    const flows = all(doc, MODEL, 'messageFlow').flatMap(f => {
      const id = f.getAttribute('id'), from = f.getAttribute('sourceRef'), to = f.getAttribute('targetRef');
      const edge = all(doc, BPMNDI, 'BPMNEdge').find(e => e.getAttribute('bpmnElement') === id);
      const points = edge ? all(edge, DI, 'waypoint').filter(p => p.hasAttribute('x') && p.hasAttribute('y')).map(p => ({ x: Number(p.getAttribute('x')), y: Number(p.getAttribute('y')) })) : [];
      if (!id || !from || !to || points.length < 2 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return [];
      return [{ id, type: 'messageFlow', label: f.getAttribute('name') ?? '', from, to, points, lineStyle: 'dashed' as const, startMarker: 'circle' as const, arrowEnd: true, arrowStyle: 'open' as const, labelEditable: false, routeEditable: false }];
    });
    return { diagram: { ...base.diagram, regions: [...regions, ...(base.diagram.regions ?? []).map(r => ({ ...r, kind: 'lane' as const }))], edges: [...base.diagram.edges, ...flows] }, ...(inspection.editable ? {} : { readOnlyReason: inspection.readOnlyReason }) };
  },
  autoLayout: source => {
    if (!all(parse(source), MODEL, 'collaboration').length) return bpmnNotation.autoLayout!(source);
    const projection = project(source), laidOut = bpmnNotation.autoLayout!(projection.xml);
    const diagram = bpmnNotation.read(laidOut).diagram;
    const content = [...diagram.nodes, ...(diagram.regions ?? [])];
    const inspection = inspectCollaboration(source);
    const primary = inspection.participants.find(p => p.processRef)!;
    const boxes = new Map(inspection.participants.map(p => [p.id, { ...p.bounds }]));
    if (content.length) boxes.set(primary.id, {
      x: Math.min(...content.map(n => n.x)) - 40, y: Math.min(...content.map(n => n.y)) - 40,
      width: Math.max(...content.map(n => n.x + n.width)) - Math.min(...content.map(n => n.x)) + 80,
      height: Math.max(...content.map(n => n.y + n.height)) - Math.min(...content.map(n => n.y)) + 80,
    });
    const pool = boxes.get(primary.id)!; let y = pool.y + pool.height + 80;
    for (const participant of inspection.participants.filter(p => !p.processRef)) { const box = boxes.get(participant.id)!; box.x = pool.x; box.y = y; y += box.height + 80; }
    for (const item of projection.positions) {
      const id = item.element.getAttribute('bpmnElement')!, box = boxes.get(id);
      if (box) { const bounds = all(item.element, DC, 'Bounds')[0]; for (const key of ['x', 'y', 'width', 'height'] as const) bounds.setAttribute(key, String(box[key])); }
      else {
        const flow = inspection.messageFlows.find(f => f.id === id);
        if (flow) {
          all(item.element, DI, 'waypoint').forEach(p => p.remove());
          for (const point of routeBetween(boxes.get(flow.from)!, boxes.get(flow.to)!)) {
            const waypoint = item.element.ownerDocument.createElementNS(DI, 'di:waypoint'); waypoint.setAttribute('x', String(point.x)); waypoint.setAttribute('y', String(point.y)); item.element.appendChild(waypoint);
          }
        }
      }
    }
    return restore(laidOut, projection);
  },
  addNode: (s, type, at) => mutate(s, xml => bpmnNotation.addNode(xml, type, at)),
  addPool: (s, at) => {
    const xml = all(parse(s), MODEL, 'collaboration').length ? s : convertToCollaboration(s);
    return addBlackBoxParticipant(xml, 'Внешний участник', { x: at.x, y: at.y, ...bpmnCollaborationFacade.poolPlacementSize! });
  },
  addRegion: (s, at) => mutate(s, xml => bpmnNotation.addRegion!(xml, at)),
  resizeRegion: (s, id, width, height) => mutate(s, xml => bpmnNotation.resizeRegion!(xml, id, width, height)),
  moveRegion: (s, id, at) => inspectCollaboration(s).participants.some(p => p.id === id) ? moveBlackBoxParticipant(s, id, at) : mutate(s, xml => bpmnNotation.moveRegion!(xml, id, at)),
  setRegionRows: (s, id, count) => mutate(s, xml => bpmnNotation.setRegionRows!(xml, id, count)),
  resizeNode: (s, id, width, height) => mutate(s, xml => bpmnNotation.resizeNode!(xml, id, width, height)),
  setLabelBounds: (s, id, bounds) => mutate(s, xml => bpmnNotation.setLabelBounds!(xml, id, bounds)),
  moveNode: (s, id, at) => mutate(s, xml => bpmnNotation.moveNode(xml, id, at)),
  rename: (s, id, name) => inspectCollaboration(s).participants.some(p => p.id === id) ? renameParticipant(s, id, name) : mutate(s, xml => bpmnNotation.rename(xml, id, name)),
  connect: (s, from, to, type) => {
    const state = inspectCollaboration(s), a = state.participants.find(p => p.id === from), b = state.participants.find(p => p.id === to);
    if (a || b || type === 'messageFlow') {
      if (!state.editable || !a || !b || from === to || (type && type !== 'auto' && type !== 'messageFlow')) throw new Error('Поток сообщений соединяет два разных пула.');
      return addMessageFlow(s, from, to, routeBetween(a.bounds, b.bounds));
    }
    return mutate(s, xml => bpmnNotation.connect(xml, from, to, type === 'auto' ? undefined : type));
  },
  editEdge: (s, id, from, to, points) => mutate(s, xml => bpmnNotation.editEdge(xml, id, from, to, points)),
  resetEdge: (s, id) => mutate(s, xml => bpmnNotation.resetEdge(xml, id)),
  remove: (s, id) => { const state = inspectCollaboration(s); return state.participants.some(p => p.id === id) || state.messageFlows.some(f => f.id === id) ? removeCollaborationElement(s, id) : mutate(s, xml => bpmnNotation.remove(xml, id)); },
  convertToCollaboration, addBlackBoxParticipant, addMessageFlow, moveBlackBoxParticipant, removeCollaborationElement,
};
