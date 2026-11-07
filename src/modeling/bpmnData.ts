/** Редактор ограниченного профиля BPMN Data Association; XML — источник истины. */
import { inspectBpmnEvent, bpmnEventElementNames } from './bpmnEvents';
const M = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const B = 'http://www.omg.org/spec/BPMN/20100524/DI';
const D = 'http://www.omg.org/spec/DD/20100524/DI';
const C = 'http://www.omg.org/spec/DD/20100524/DC';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const validId = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
export interface DataPoint { x: number; y: number }
export interface DataBounds extends DataPoint { width: number; height: number }
export interface DataNode { id: string; type: 'dataObjectReference' | 'dataStoreReference'; name: string; bounds: DataBounds }
export interface DataEdge { id: string; type: 'dataInputAssociation' | 'dataOutputAssociation'; from: string; to: string; activityId: string; dataId: string; portId: string; points: DataPoint[] }
export interface DataInspection { editable: boolean; reason?: string; nodes: DataNode[]; edges: DataEdge[] }
type Kind = DataEdge['type'];
const kids = (e: Element) => Array.from(e.children);
const named = (e: Element, name: string) => kids(e).filter(x => x.namespaceURI === M && x.localName === name);
const elements = (d: Document, ns: string, name: string) => Array.from(d.getElementsByTagNameNS(ns, name));
const one = <T>(a: T[], message: string): T => { if (a.length !== 1) throw new Error(message); return a[0]; };
function fail(message: string): never { throw new Error(message); }
const id = (e: Element) => e.getAttribute('id') || fail('Отсутствует ID.');
const refText = (e: Element) => { const text = e.textContent?.trim() ?? ''; if (!validId.test(text)) fail('Некорректная ссылка.'); return text; };
const create = (d: Document, ns: string, name: string) => d.createElementNS(ns, `${ns === M ? 'bpmn' : ns === B ? 'bpmndi' : ns === C ? 'dc' : 'di'}:${name}`);
const allElements = (d: Document) => Array.from(d.getElementsByTagName('*'));
const byId = (d: Document, value: string) => allElements(d).find(e => e.getAttribute('id') === value);
const fresh = (d: Document, prefix: string) => { let value: string; do { value = `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; } while (byId(d, value) || byId(d, `${value}_di`)); return value; };
const numeric = (value: string) => /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.test(value.trim()) && Number.isFinite(Number(value));
const pointCheck = (points: readonly DataPoint[]) => { if (points.length < 2 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) fail('Некорректный маршрут.'); };
const activities = ['task', 'userTask', 'serviceTask', 'manualTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'scriptTask', 'subProcess'];
const events = ['startEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'endEvent'];
const gateways = ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'complexGateway', 'eventBasedGateway'];
const flowNodes = [...activities, ...events, ...gateways];
const visibleNodes = [...flowNodes, 'dataObjectReference', 'dataStoreReference', 'textAnnotation'];
const attributes: Record<string, string[]> = {
  ...Object.fromEntries(bpmnEventElementNames.map(type => [type, ['id']])),
  definitions: ['id', 'targetNamespace', 'name', 'exporter', 'exporterVersion'], process: ['id', 'name', 'isExecutable'],
  ...Object.fromEntries(flowNodes.map(type => [type, ['id', 'name']])), laneSet: ['id', 'name'], lane: ['id', 'name'], flowNodeRef: [], sequenceFlow: ['id', 'name', 'sourceRef', 'targetRef'], incoming: [], outgoing: [],
  startEvent: ['id', 'name', 'isInterrupting', 'parallelMultiple'], intermediateCatchEvent: ['id', 'name', 'parallelMultiple'],
  dataObject: ['id', 'name', 'isCollection'], dataObjectReference: ['id', 'name', 'dataObjectRef'], dataStore: ['id', 'name', 'capacity', 'isUnlimited'], dataStoreReference: ['id', 'name', 'dataStoreRef'],
  textAnnotation: ['id', 'textFormat'], text: [], association: ['id', 'sourceRef', 'targetRef', 'associationDirection'],
  ioSpecification: ['id'], dataInput: ['id', 'name'], dataOutput: ['id', 'name'], inputSet: ['id'], outputSet: ['id'], dataInputRefs: [], dataOutputRefs: [],
  dataInputAssociation: ['id'], dataOutputAssociation: ['id'], sourceRef: [], targetRef: [],
};
const diAttrs: Record<string, string[]> = { BPMNDiagram: ['id', 'name'], BPMNPlane: ['id', 'bpmnElement'], BPMNShape: ['id', 'bpmnElement', 'isHorizontal', 'isExpanded'], BPMNEdge: ['id', 'bpmnElement'], BPMNLabel: ['id'], Bounds: ['x', 'y', 'width', 'height'], waypoint: ['x', 'y'] };
const parent: Record<string, string[]> = {
  ...Object.fromEntries(bpmnEventElementNames.map(type => [type, events])),
  process: ['definitions'], dataStore: ['definitions'], ...Object.fromEntries(flowNodes.map(type => [type, ['process']])), laneSet: ['process'], lane: ['laneSet'], flowNodeRef: ['lane'], sequenceFlow: ['process'], dataObject: ['process'], dataObjectReference: ['process'], dataStoreReference: ['process'], textAnnotation: ['process'], association: ['process'], text: ['textAnnotation'], incoming: flowNodes, outgoing: flowNodes,
  ioSpecification: activities, dataInput: ['ioSpecification'], dataOutput: ['ioSpecification'], inputSet: ['ioSpecification'], outputSet: ['ioSpecification'], dataInputRefs: ['inputSet'], dataOutputRefs: ['outputSet'], dataInputAssociation: activities, dataOutputAssociation: activities, sourceRef: ['dataInputAssociation', 'dataOutputAssociation'], targetRef: ['dataInputAssociation', 'dataOutputAssociation'],
};
function parse(source: string): Document {
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(source)) fail('DTD и сущности запрещены.');
  const d = new DOMParser().parseFromString(source, 'application/xml');
  if (d.querySelector('parsererror') || d.doctype || d.documentElement.namespaceURI !== M || d.documentElement.localName !== 'definitions' || Array.from(d.childNodes).some(n => n.nodeType === 7)) fail('Некорректный BPMN XML.');
  return d;
}
function validate(d: Document): { nodes: DataNode[]; edges: DataEdge[] } {
  const seen = new Set<string>();
  for (const e of allElements(d)) {
    const ns = e.namespaceURI; const a = ns === M ? attributes[e.localName] : (ns === B || ns === C || ns === D) ? diAttrs[e.localName] : undefined;
    if (!a || (ns === B && !['BPMNDiagram', 'BPMNPlane', 'BPMNShape', 'BPMNEdge', 'BPMNLabel'].includes(e.localName)) || (ns === C && e.localName !== 'Bounds') || (ns === D && e.localName !== 'waypoint')) fail('Неподдерживаемый элемент XML.');
    if (events.includes(e.localName) && e.namespaceURI === M) { const result = inspectBpmnEvent(e, 'process'); if (!result.editable || result.definitions.length > 1 || result.definitions.some(x => ['conditional', 'link'].includes(x))) fail(result.reason ?? 'Событие не поддерживается.'); }
    if (Array.from(e.attributes).some(x => x.namespaceURI !== XMLNS && (x.namespaceURI || !a.includes(x.localName)))) fail('Неподдерживаемый атрибут XML.');
    if (Array.from(e.childNodes).some(n => n.nodeType === 7)) fail('Инструкции обработки XML не поддерживаются.');
    for (const key of ['isExecutable', 'isCollection', 'isUnlimited']) if (e.hasAttribute(key) && !['true', 'false', '1', '0'].includes(e.getAttribute(key)!)) fail('Некорректное логическое значение.');
    if (e.hasAttribute('capacity') && !/^[+-]?\d+$/.test(e.getAttribute('capacity')!)) fail('Некорректная ёмкость хранилища.');
    if (e.localName === 'association' && e.hasAttribute('associationDirection') && !['None', 'One', 'Both'].includes(e.getAttribute('associationDirection')!)) fail('Некорректное направление ассоциации.');
    const value = e.getAttribute('id'); if (value !== null) { if (!validId.test(value) || seen.has(value)) fail('Некорректный или повторяющийся ID.'); seen.add(value); }
    if (ns === M && e !== d.documentElement && (!e.parentElement || e.parentElement.namespaceURI !== M || !parent[e.localName]?.includes(e.parentElement.localName))) fail('Недопустимый контекст элемента BPMN.');
    if (Array.from(e.childNodes).some(n => n.nodeType === 3 && n.textContent?.trim()) && !(ns === M && ['text', 'incoming', 'outgoing', 'sourceRef', 'targetRef', 'dataInputRefs', 'dataOutputRefs', 'flowNodeRef'].includes(e.localName))) fail('Неожиданный текст.');
  }
  const eventDefinitions = [...bpmnEventElementNames];
  const order: Record<string, string[]> = { ...Object.fromEntries(activities.map(type => [type, ['incoming', 'outgoing', 'ioSpecification', 'dataInputAssociation', 'dataOutputAssociation']])), ...Object.fromEntries([...events, ...gateways].map(type => [type, ['incoming', 'outgoing', ...eventDefinitions]])), ioSpecification: ['dataInput', 'dataOutput', 'inputSet', 'outputSet'], dataInputAssociation: ['sourceRef', 'targetRef'], dataOutputAssociation: ['sourceRef', 'targetRef'] };
  for (const e of allElements(d).filter(x => x.namespaceURI === M && order[x.localName])) {
    const positions = kids(e).map(x => order[e.localName].indexOf(x.localName));
    if (positions.some((n, i) => n < 0 || (i > 0 && n < positions[i - 1]))) fail('Недопустимый порядок элементов BPMN.');
  }
  const root = d.documentElement;
  const namespace = root.getAttribute('targetNamespace')?.trim() ?? '';
  if (!namespace || /[\s<>"{}|\\^`]/.test(namespace) || /%(?![\da-fA-F]{2})/.test(namespace)) fail('Некорректный targetNamespace.');
  const process = one(named(root, 'process'), 'Требуется один процесс.'); id(process);
  const processChildren = kids(process); const laneIndex = processChildren.findIndex(e => e.localName === 'laneSet');
  if (laneIndex > 0) fail('Недопустимый порядок дорожек в процессе.');
  let artifactSeen = false; for (const child of processChildren) { if (['association', 'textAnnotation'].includes(child.localName)) artifactSeen = true; else if (artifactSeen) fail('Недопустимый порядок элементов процесса.'); }
  const diagram = one(elements(d, B, 'BPMNDiagram'), 'Требуется одна диаграмма.');
  if (diagram.parentElement !== root) fail('Некорректный контекст диаграммы.');
  const plane = one(kids(diagram).filter(e => e.namespaceURI === B && e.localName === 'BPMNPlane'), 'Требуется одна плоскость.');
  if (elements(d, B, 'BPMNPlane').length !== 1 || plane.getAttribute('bpmnElement') !== id(process)) fail('Плоскость не соответствует процессу.');
  const diRefs = new Set<string>();
  for (const e of allElements(d).filter(e => e.namespaceURI !== M)) {
    if (e === diagram || e === plane) continue;
    const p = e.parentElement;
    const ok = (e.namespaceURI === B && ['BPMNShape', 'BPMNEdge'].includes(e.localName) && p === plane) || (e.namespaceURI === B && e.localName === 'BPMNLabel' && p?.namespaceURI === B && ['BPMNShape', 'BPMNEdge'].includes(p.localName)) || (e.namespaceURI === C && e.localName === 'Bounds' && p?.namespaceURI === B && ['BPMNShape', 'BPMNLabel'].includes(p.localName)) || (e.namespaceURI === D && p?.namespaceURI === B && p.localName === 'BPMNEdge');
    if (!ok) fail('Недопустимая структура DI.');
    if (e.namespaceURI === B && ['BPMNShape', 'BPMNEdge'].includes(e.localName)) { const r = e.getAttribute('bpmnElement') ?? ''; if (!validId.test(r) || !byId(d, r) || diRefs.has(r)) fail('Некорректная ссылка DI.'); diRefs.add(r); }
  }
  const shape = (value: string) => one(elements(d, B, 'BPMNShape').filter(e => e.getAttribute('bpmnElement') === value), 'Не найдена единственная фигура.');
  const bounds = (s: Element): DataBounds => { const b = one(kids(s).filter(e => e.namespaceURI === C && e.localName === 'Bounds'), 'Некорректные границы.'); const number = (k: string) => { const v = b.getAttribute(k); if (v === null || !numeric(v)) fail('Некорректные границы.'); return Number(v); }; const r = { x: number('x'), y: number('y'), width: number('width'), height: number('height') }; if (r.width <= 0 || r.height <= 0) fail('Некорректный размер.'); return r; };
  for (const s of elements(d, B, 'BPMNShape')) {
    const children = kids(s);
    if (children.filter(e => e.namespaceURI === B && e.localName === 'BPMNLabel').length > 1 || children.some((e, i) => e.namespaceURI === C && children.slice(0, i).some(x => x.localName === 'BPMNLabel'))) fail('Некорректный порядок фигуры DI.');
  }
  for (const e of elements(d, M, 'dataObject')) if (e.getAttribute('isCollection') === 'true' || e.getAttribute('isCollection') === '1') fail('Коллекции данных не поддерживаются.');
  for (const tag of ['incoming', 'outgoing']) {
    const refs = elements(d, M, tag);
    if (refs.some((item, i) => refs.slice(0, i).some(other => other.parentElement === item.parentElement && refText(other) === refText(item)))) fail('Повторная ссылка потока.');
  }
  const lanes = elements(d, M, 'lane');
  if (elements(d, M, 'laneSet').length > 1) fail('Сложные дорожки не поддерживаются.');
  const laneRefs = new Set<string>();
  const laneBounds = lanes.map(lane => {
    const s = shape(id(lane));
    if (s.getAttribute('isHorizontal') === 'false' || s.getAttribute('isHorizontal') === '0') fail('Вертикальные дорожки не поддерживаются.');
    const area = bounds(s);
    for (const ref of named(lane, 'flowNodeRef')) {
      const r = refText(ref); const node = byId(d, r);
      if (laneRefs.has(r) || !node || node.parentElement !== process || !flowNodes.includes(node.localName)) fail('Некорректная ссылка дорожки.');
      laneRefs.add(r);
      const box = bounds(shape(r)); const x = box.x + box.width / 2; const y = box.y + box.height / 2;
      if (x < area.x + 30 || x > area.x + area.width || y < area.y || y > area.y + area.height) fail('Узел находится за пределами дорожки.');
    }
    return area;
  });
  if (laneBounds.some((a, i) => laneBounds.slice(i + 1).some(b => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y))) fail('Дорожки пересекаются.');
  for (const item of named(process, 'subProcess')) if (shape(id(item)).getAttribute('isExpanded') !== 'false') fail('Развёрнутые подпроцессы не поддерживаются.');
  for (const item of elements(d, B, 'BPMNShape')) {
    const target = byId(d, item.getAttribute('bpmnElement') ?? '');
    for (const key of ['isHorizontal', 'isExpanded']) if (item.hasAttribute(key) && !['true', 'false', '1', '0'].includes(item.getAttribute(key)!)) fail('Некорректный атрибут DI.');
    if (item.hasAttribute('isHorizontal') && target?.localName !== 'lane' || item.hasAttribute('isExpanded') && target?.localName !== 'subProcess') fail('Недопустимый атрибут DI.');
  }
  for (const label of elements(d, B, 'BPMNLabel')) {
    if (kids(label).length > 1) fail('Некорректная подпись DI.');
    if (kids(label).length) bounds(label);
  }
  for (const edge of elements(d, B, 'BPMNEdge')) {
    const points = kids(edge).filter(e => e.namespaceURI === D && e.localName === 'waypoint').map(p => {
      const x = p.getAttribute('x'); const y = p.getAttribute('y');
      if (x === null || y === null || !numeric(x) || !numeric(y)) fail('Некорректная точка.');
      return { x: Number(x), y: Number(y) };
    });
    pointCheck(points);
    if (kids(edge).filter(e => e.namespaceURI === B && e.localName === 'BPMNLabel').length > 1 || kids(edge).some((e, i, a) => e.localName === 'waypoint' && a.slice(0, i).some(x => x.localName === 'BPMNLabel'))) fail('Некорректный порядок DI.');
  }
  const nodes: DataNode[] = [];
  for (const e of kids(process)) {
    if (visibleNodes.includes(e.localName)) bounds(shape(id(e)));
    if (e.localName === 'dataObjectReference' || e.localName === 'dataStoreReference') {
      const type = e.localName; const r = e.getAttribute(type === 'dataObjectReference' ? 'dataObjectRef' : 'dataStoreRef') ?? '';
      const target = byId(d, r); if (!validId.test(r) || !target || target.namespaceURI !== M || target.localName !== (type === 'dataObjectReference' ? 'dataObject' : 'dataStore') || target.parentElement !== (type === 'dataObjectReference' ? process : root)) fail('Некорректное определение данных.');
      nodes.push({ id: id(e), type, name: e.getAttribute('name') ?? target.getAttribute('name') ?? '', bounds: bounds(shape(id(e))) });
    }
  }
  for (const e of elements(d, B, 'BPMNShape')) if (![...visibleNodes, 'lane'].includes(byId(d, e.getAttribute('bpmnElement') ?? '')?.localName ?? '')) fail('Неизвестная фигура.');
  const edges: DataEdge[] = [];
  for (const task of kids(process).filter(e => activities.includes(e.localName))) {
    const specs = named(task, 'ioSpecification'); const assocs = kids(task).filter(e => ['dataInputAssociation', 'dataOutputAssociation'].includes(e.localName));
    if (!specs.length && !assocs.length) continue;
    const spec = one(specs, 'Требуется одна спецификация входов и выходов.');
    const input = one(named(spec, 'inputSet'), 'Требуется один inputSet.'); const output = one(named(spec, 'outputSet'), 'Требуется один outputSet.');
    const ports = [...named(spec, 'dataInput'), ...named(spec, 'dataOutput')];
    const used = new Set<string>();
    for (const a of assocs) {
      const type = a.localName as Kind; const isInput = type === 'dataInputAssociation';
      const s = refText(one(named(a, 'sourceRef'), 'Требуется один sourceRef.')); const t = refText(one(named(a, 'targetRef'), 'Требуется один targetRef.'));
      const dataId = isInput ? s : t; const portId = isInput ? t : s;
      if (!nodes.some(n => n.id === dataId) || !ports.some(p => id(p) === portId && p.localName === (isInput ? 'dataInput' : 'dataOutput')) || used.has(portId)) fail('Некорректные ссылки ассоциации данных.');
      used.add(portId);
      const di = one(elements(d, B, 'BPMNEdge').filter(e => e.getAttribute('bpmnElement') === id(a)), 'Не найдена единственная DI-связь.');
      const points = kids(di).filter(e => e.namespaceURI === D && e.localName === 'waypoint').map(p => { const x = p.getAttribute('x'); const y = p.getAttribute('y'); if (x === null || y === null || !numeric(x) || !numeric(y)) fail('Некорректная точка.'); return { x: Number(x), y: Number(y) }; }); pointCheck(points);
      edges.push({ id: id(a), type, activityId: id(task), dataId, portId, from: isInput ? dataId : id(task), to: isInput ? id(task) : dataId, points });
    }
    // Свободные порты сохраняются: их происхождение и внешние привязки неизвестны.
    for (const [set, tag, kind] of [[input, 'dataInputRefs', 'dataInput'], [output, 'dataOutputRefs', 'dataOutput']] as const) {
      const refs = named(set, tag).map(refText); const expected = ports.filter(p => p.localName === kind).map(id);
      if (refs.length !== expected.length || new Set(refs).size !== refs.length || refs.some(r => !expected.includes(r))) fail('Некорректный состав набора входов/выходов.');
    }
  }
  for (const e of elements(d, B, 'BPMNEdge')) { const item = byId(d, e.getAttribute('bpmnElement') ?? ''); if (!item || !['sequenceFlow', 'association', 'dataInputAssociation', 'dataOutputAssociation'].includes(item.localName)) fail('Неизвестная DI-связь.'); }
  for (const e of kids(process).filter(e => ['sequenceFlow', 'association'].includes(e.localName))) {
    const from = byId(d, e.getAttribute('sourceRef') ?? ''); const to = byId(d, e.getAttribute('targetRef') ?? '');
    if (!from || !to || from.parentElement !== process || to.parentElement !== process || !visibleNodes.includes(from.localName) || !visibleNodes.includes(to.localName)) fail('Некорректные концы связи.');
    if (e.localName === 'sequenceFlow' && (![from, to].every(n => flowNodes.includes(n.localName)) || from.localName === 'endEvent' || to.localName === 'startEvent')) fail('Некорректный поток управления.');
    one(elements(d, B, 'BPMNEdge').filter(x => x.getAttribute('bpmnElement') === id(e)), 'Не найдена DI-связь.');
  }
  for (const e of [...elements(d, M, 'incoming'), ...elements(d, M, 'outgoing')]) { const f = byId(d, refText(e)); if (!f || f.localName !== 'sequenceFlow' || f.getAttribute(e.localName === 'incoming' ? 'targetRef' : 'sourceRef') !== e.parentElement?.getAttribute('id')) fail('Некорректная ссылка потока.'); }
  return { nodes, edges };
}
// Консервативная проекция не участвует в проверке разрешения записи.
function project(d: Document): { nodes: DataNode[]; edges: DataEdge[] } {
  const nodes: DataNode[] = []; const edges: DataEdge[] = [];
  const root = d.documentElement; const processes = named(root, 'process');
  if (processes.length !== 1) return { nodes, edges };
  const process = processes[0];
  const ids = new Map<string, Element[]>();
  for (const e of allElements(d)) { const value = e.getAttribute('id'); if (value) ids.set(value, [...(ids.get(value) ?? []), e]); }
  const uniqueId = (e: Element) => { const value = e.getAttribute('id') ?? ''; return validId.test(value) && ids.get(value)?.length === 1 ? value : ''; };
  const lookup = (value: string) => validId.test(value) && ids.get(value)?.length === 1 ? ids.get(value)![0] : undefined;
  const diagrams = namedDi(root, 'BPMNDiagram');
  const planes = diagrams.length === 1 ? namedDi(diagrams[0], 'BPMNPlane') : [];
  const processId = uniqueId(process);
  if (!processId || planes.length !== 1 || planes[0].getAttribute('bpmnElement') !== processId) return { nodes, edges };
  const plane = planes[0];
  const diFor = (tag: string, value: string) => {
    const refs = kids(plane).filter(e => e.namespaceURI === B && ['BPMNShape', 'BPMNEdge'].includes(e.localName) && e.getAttribute('bpmnElement') === value);
    return refs.length === 1 && refs[0].localName === tag ? refs : [];
  };
  const geometry = (e: Element): DataBounds | undefined => {
    const shapes = diFor('BPMNShape', uniqueId(e)); if (!uniqueId(e) || shapes.length !== 1) return;
    const boxes = kids(shapes[0]).filter(x => x.namespaceURI === C && x.localName === 'Bounds'); if (boxes.length !== 1) return;
    const values = ['x', 'y', 'width', 'height'].map(k => boxes[0].getAttribute(k));
    if (values.some(v => v === null || !numeric(v))) return;
    const [x, y, width, height] = values.map(Number); if (width <= 0 || height <= 0) return;
    return { x, y, width, height };
  };
  for (const e of kids(process)) {
    if (e.namespaceURI !== M || !['dataObjectReference', 'dataStoreReference'].includes(e.localName)) continue;
    const type = e.localName as DataNode['type']; const nodeId = uniqueId(e); const bounds = geometry(e);
    const target = lookup(e.getAttribute(type === 'dataObjectReference' ? 'dataObjectRef' : 'dataStoreRef') ?? '');
    if (!nodeId || !bounds || !target || target.namespaceURI !== M || target.localName !== (type === 'dataObjectReference' ? 'dataObject' : 'dataStore') || target.parentElement !== (type === 'dataObjectReference' ? process : root)) continue;
    nodes.push({ id: nodeId, type, name: e.getAttribute('name') ?? target.getAttribute('name') ?? '', bounds });
  }
  for (const task of kids(process).filter(e => e.namespaceURI === M && activities.includes(e.localName))) {
    const activityId = uniqueId(task); if (!activityId || !geometry(task)) continue;
    for (const a of kids(task).filter(e => e.namespaceURI === M && ['dataInputAssociation', 'dataOutputAssociation'].includes(e.localName))) {
      const associationId = uniqueId(a); const children = kids(a); const sources = named(a, 'sourceRef'); const targets = named(a, 'targetRef');
      if (!associationId || sources.length !== 1 || targets.length !== 1 || children.length !== 2 || kids(sources[0]).length || kids(targets[0]).length) continue;
      const s = sources[0].textContent?.trim() ?? ''; const t = targets[0].textContent?.trim() ?? '';
      const type = a.localName as Kind; const isInput = type === 'dataInputAssociation'; const dataId = isInput ? s : t; const portId = isInput ? t : s;
      const port = lookup(portId); const spec = port?.parentElement;
      if (!nodes.some(n => n.id === dataId) || !port || port.namespaceURI !== M || port.localName !== (isInput ? 'dataInput' : 'dataOutput') || spec?.namespaceURI !== M || spec.localName !== 'ioSpecification' || spec.parentElement !== task) continue;
      const diagrams = diFor('BPMNEdge', associationId); if (diagrams.length !== 1) continue;
      const waypoints = kids(diagrams[0]).filter(e => e.namespaceURI === D && e.localName === 'waypoint');
      const points: DataPoint[] = []; let valid = true;
      for (const p of waypoints) { const x = p.getAttribute('x'); const y = p.getAttribute('y'); if (x === null || y === null || !numeric(x) || !numeric(y)) { valid = false; break; } points.push({ x: Number(x), y: Number(y) }); }
      if (!valid || points.length < 2) continue;
      edges.push({ id: associationId, type, activityId, dataId, portId, from: isInput ? dataId : activityId, to: isInput ? activityId : dataId, points });
    }
  }
  return { nodes, edges };
}
const namedDi = (e: Element, name: string) => kids(e).filter(x => x.namespaceURI === B && x.localName === name);
export function inspectDataModel(source: string): DataInspection {
  let d: Document;
  try { d = parse(source); } catch (error) { return { editable: false, reason: error instanceof Error ? error.message : String(error), nodes: [], edges: [] }; }
  try { return { editable: true, ...validate(d) }; }
  catch (error) { return { editable: false, reason: error instanceof Error ? error.message : String(error), ...project(d) }; }
}
function editable(source: string) { const d = parse(source); validate(d); return d; }
function finish(d: Document) { validate(d); const xml = new XMLSerializer().serializeToString(d); validate(parse(xml)); return xml; }
function writePoints(d: Document, edge: Element, points: readonly DataPoint[]) {
  pointCheck(points); for (const p of kids(edge).filter(e => e.namespaceURI === D && e.localName === 'waypoint')) p.remove();
  const label = kids(edge).find(e => e.namespaceURI === B && e.localName === 'BPMNLabel') ?? null;
  for (const p of points) { const w = create(d, D, 'waypoint'); w.setAttribute('x', String(p.x)); w.setAttribute('y', String(p.y)); edge.insertBefore(w, label); }
}
/** Создаёт общее root-определение и визуальную ссылку. Возвращает новый XML и ID. */
export function addDataStore(source: string, name: string, bounds: DataBounds): { xml: string; id: string; storeId: string } {
  const d = editable(source); if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) fail('Некорректные границы.');
  const root = d.documentElement; const process = one(named(root, 'process'), 'Нет процесса.');
  const store = create(d, M, 'dataStore'); const storeId = fresh(d, 'DataStore'); store.setAttribute('id', storeId); store.setAttribute('name', name);
  const diagram = one(elements(d, B, 'BPMNDiagram'), 'Нет диаграммы.'); root.insertBefore(store, diagram);
  const node = create(d, M, 'dataStoreReference'); const nodeId = fresh(d, 'DataStoreReference'); node.setAttribute('id', nodeId); node.setAttribute('dataStoreRef', storeId); node.setAttribute('name', name);
  process.insertBefore(node, kids(process).find(e => ['association', 'textAnnotation'].includes(e.localName)) ?? null);
  const s = create(d, B, 'BPMNShape'); s.setAttribute('id', `${nodeId}_di`); s.setAttribute('bpmnElement', nodeId); const b = create(d, C, 'Bounds'); for (const k of ['x', 'y', 'width', 'height'] as const) b.setAttribute(k, String(bounds[k])); s.appendChild(b); one(elements(d, B, 'BPMNPlane'), 'Нет плоскости.').appendChild(s);
  return { xml: finish(d), id: nodeId, storeId };
}
/** Создаёт связь и собственный порт активности. from/to — видимые узлы, не ID порта. */
export function addDataAssociation(source: string, type: Kind, from: string, to: string, points: readonly DataPoint[]): { xml: string; id: string } {
  const d = editable(source); pointCheck(points); if (!['dataInputAssociation', 'dataOutputAssociation'].includes(type)) fail('Неизвестный тип связи.');
  const isInput = type === 'dataInputAssociation'; const activityId = isInput ? to : from; const dataId = isInput ? from : to;
  const task = byId(d, activityId); const data = byId(d, dataId); if (!task || task.namespaceURI !== M || !activities.includes(task.localName) || !data || !['dataObjectReference', 'dataStoreReference'].includes(data.localName)) fail('Связь должна соединять задачу и объект данных.');
  if (validate(d).edges.some(e => e.type === type && e.activityId === activityId && e.dataId === dataId)) fail('Такая связь уже существует.');
  let spec = named(task, 'ioSpecification')[0];
  if (!spec) { spec = create(d, M, 'ioSpecification'); spec.setAttribute('id', fresh(d, 'IOSpecification')); task.appendChild(spec); for (const tag of ['inputSet', 'outputSet']) { const set = create(d, M, tag); set.setAttribute('id', fresh(d, tag)); spec.appendChild(set); } }
  const port = create(d, M, isInput ? 'dataInput' : 'dataOutput'); const portId = fresh(d, isInput ? 'DataInput' : 'DataOutput'); port.setAttribute('id', portId);
  spec.insertBefore(port, kids(spec).find(e => isInput ? ['dataOutput', 'inputSet', 'outputSet'].includes(e.localName) : ['inputSet', 'outputSet'].includes(e.localName)) ?? null);
  const set = one(named(spec, isInput ? 'inputSet' : 'outputSet'), 'Нет набора.'); const portRef = create(d, M, isInput ? 'dataInputRefs' : 'dataOutputRefs'); portRef.textContent = portId; set.appendChild(portRef);
  const a = create(d, M, type); const associationId = fresh(d, 'DataAssociation'); a.setAttribute('id', associationId);
  for (const [tag, value] of [['sourceRef', isInput ? dataId : portId], ['targetRef', isInput ? portId : dataId]]) { const r = create(d, M, tag); r.textContent = value; a.appendChild(r); }
  task.insertBefore(a, isInput ? named(task, 'dataOutputAssociation')[0] ?? null : null);
  const edge = create(d, B, 'BPMNEdge'); edge.setAttribute('id', `${associationId}_di`); edge.setAttribute('bpmnElement', associationId); writePoints(d, edge, points); one(elements(d, B, 'BPMNPlane'), 'Нет плоскости.').appendChild(edge);
  return { xml: finish(d), id: associationId };
}
/** Переподключение к другому объекту данных той же задачи; перенос на другую задачу запрещён. */
export function editDataAssociation(source: string, associationId: string, from: string, to: string, points: readonly DataPoint[]): string {
  const d = editable(source); const state = validate(d); const edge = state.edges.find(e => e.id === associationId) ?? fail('Связь не найдена.');
  const isInput = edge.type === 'dataInputAssociation'; if ((isInput ? to : from) !== edge.activityId) fail('Перенос связи на другую задачу не поддерживается.');
  const dataId = isInput ? from : to; if (!state.nodes.some(n => n.id === dataId)) fail('Объект данных не найден.');
  if (state.edges.some(e => e.id !== edge.id && e.type === edge.type && e.activityId === edge.activityId && e.dataId === dataId)) fail('Такая связь уже существует.');
  const a = byId(d, edge.id)!; one(named(a, isInput ? 'sourceRef' : 'targetRef'), 'Нет ссылки.').textContent = dataId;
  writePoints(d, one(elements(d, B, 'BPMNEdge').filter(x => x.getAttribute('bpmnElement') === edge.id), 'Нет DI.'), points); return finish(d);
}
function removeEdge(d: Document, edge: DataEdge) {
  const a = byId(d, edge.id)!;
  // Порт и ссылка в наборе могут принадлежать импортированной модели; сохраняем их.
  one(elements(d, B, 'BPMNEdge').filter(x => x.getAttribute('bpmnElement') === edge.id), 'Нет DI.').remove(); a.remove();
  // Даже пустая спецификация могла существовать до нашей операции: не удаляем её.
}
export function removeDataAssociation(source: string, associationId: string): string { const d = editable(source); const edge = validate(d).edges.find(e => e.id === associationId) ?? fail('Связь не найдена.'); removeEdge(d, edge); return finish(d); }
/** Удаляет только связи данных узла и их собственные порты/DI; сам узел не удаляется. */
export function removeDataConnectionsForNode(source: string, nodeId: string): string { const d = editable(source); const node = byId(d, nodeId); if (!node || ![...activities, 'dataObjectReference', 'dataStoreReference'].includes(node.localName)) fail('Узел не найден.'); for (const edge of validate(d).edges.filter(e => e.activityId === nodeId || e.dataId === nodeId)) removeEdge(d, edge); return finish(d); }
/** Удаляет визуальную ссылку хранилища, каскадно связи данных; определение сохраняется. Обычные связи блокируют удаление. */
export function removeDataStoreReference(source: string, nodeId: string): string {
  const d = editable(source); const node = byId(d, nodeId); if (!node || node.namespaceURI !== M || node.localName !== 'dataStoreReference') fail('Ссылка на хранилище не найдена.');
  if (elements(d, M, 'association').some(e => e.getAttribute('sourceRef') === nodeId || e.getAttribute('targetRef') === nodeId)) fail('Сначала удалите обычные ассоциации.');
  for (const edge of validate(d).edges.filter(e => e.dataId === nodeId)) removeEdge(d, edge);
  one(elements(d, B, 'BPMNShape').filter(e => e.getAttribute('bpmnElement') === nodeId), 'Нет DI.').remove(); node.remove(); return finish(d);
}
