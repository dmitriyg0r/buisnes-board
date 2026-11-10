import { getModelNotation } from './registry';
import { bpmnCollaborationFacade } from './bpmnCollaborationFacade';
import { routeBetweenNodes } from './diagramRouting';
import type { DiagramNode } from './types';

type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
type RecordValue = { [key: string]: Value };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (v: Value | undefined): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const keyOf = (v: Value) => object(v) && (typeof v.id === 'string' ? v.id : typeof v._key === 'string' ? v._key : undefined);

/** Независимые свойства объединяются; одновременная правка одного свойства — как в модели доски, локальная. */
function merge(base: Value | undefined, local: Value | undefined, remote: Value | undefined): Value | undefined {
  if (same(local, base)) return remote;
  if (same(remote, base) || same(local, remote)) return local;
  if (local === undefined) return remote; // Изменение коллеги важнее удаления.
  if (remote === undefined) return local;
  if (object(local) && object(remote)) {
    const b = object(base) ? base : {};
    const keys = new Set([...Object.keys(remote), ...Object.keys(local), ...Object.keys(b)]);
    return Object.fromEntries([...keys].flatMap(key => {
      const value = merge(b[key], local[key], remote[key]);
      return value === undefined ? [] : [[key, value]];
    }));
  }
  if (Array.isArray(local) && Array.isArray(remote) && [...local, ...remote, ...(Array.isArray(base) ? base : [])].every(v => keyOf(v) !== undefined)) {
    const index = (list: Value[]) => new Map(list.map(v => [keyOf(v)!, v]));
    const b = index(Array.isArray(base) ? base : []), l = index(local), r = index(remote);
    return [...new Set([...r.keys(), ...l.keys()])].flatMap(key => {
      const value = merge(b.get(key), l.get(key), r.get(key));
      return value === undefined ? [] : [value];
    });
  }
  return local;
}

function xmlValue(source: string): RecordValue {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Не удалось объединить повреждённый XML модели.');
  const read = (node: Node, key: string): RecordValue => {
    if (node.nodeType !== Node.ELEMENT_NODE) return { _key: key, kind: node.nodeType, text: node.nodeValue ?? '' };
    const el = node as Element;
    const counts = new Map<string, number>();
    const children = Array.from(el.childNodes).filter(child => child.nodeType !== Node.TEXT_NODE || child.nodeValue?.trim() || !el.children.length).map(child => {
      const item = child as Element;
      const tag = child.nodeType === Node.ELEMENT_NODE ? `${item.namespaceURI}:${item.localName}` : `text:${child.nodeType}`;
      const ordinal = counts.get(tag) ?? 0; counts.set(tag, ordinal + 1);
      const id = child.nodeType === Node.ELEMENT_NODE ? item.getAttribute('id') : null;
      const reference = child.nodeType === Node.ELEMENT_NODE && ['incoming', 'outgoing', 'flowNodeRef'].includes(item.localName) ? item.textContent : null;
      return read(child, id ? `id:${id}` : reference ? `${tag}:${reference}` : `${tag}:${ordinal}`);
    });
    return { _key: key, kind: Node.ELEMENT_NODE, name: el.tagName, ns: el.namespaceURI, attrs: Object.fromEntries(Array.from(el.attributes).map(attr => [attr.name, { ns: attr.namespaceURI, value: attr.value }])), children };
  };
  return read(doc.documentElement, 'root');
}

function xmlSource(value: RecordValue): string {
  const doc = document.implementation.createDocument(null, null);
  const write = (item: RecordValue): Node => {
    if (item.kind === Node.TEXT_NODE) return doc.createTextNode(String(item.text));
    if (item.kind === Node.CDATA_SECTION_NODE) return doc.createCDATASection(String(item.text));
    if (item.kind === Node.COMMENT_NODE) return doc.createComment(String(item.text));
    if (item.kind !== Node.ELEMENT_NODE) throw new Error('Неизвестный элемент XML при объединении модели.');
    const el = doc.createElementNS(item.ns as string | null, String(item.name));
    for (const [name, data] of Object.entries(item.attrs as RecordValue)) {
      const attr = data as RecordValue;
      el.setAttributeNS(attr.ns as string | null, name, String(attr.value));
    }
    for (const child of item.children as RecordValue[]) el.appendChild(write(child));
    return el;
  };
  doc.appendChild(write(value));
  return new XMLSerializer().serializeToString(doc);
}

/** Слияние по ID узлов/связей и отдельным атрибутам XML/JSON, без замены модели целиком. */
function mergeSource(base: string, local: string, remote: string, notationId: string): string {
  if (local === base) return remote;
  if (remote === base || local === remote) return local;
  const notation = notationId === 'bpmn' ? bpmnCollaborationFacade : getModelNotation(notationId);
  if (!notation) return local;
  const xml = local.trimStart().startsWith('<');
  const value = xml ? merge(xmlValue(base), xmlValue(local), xmlValue(remote)) : merge(JSON.parse(base), JSON.parse(local), JSON.parse(remote));
  if (object(value) && value.format === 'uml-sequence' && Array.isArray(value.lifelines)) value.lifelines.sort((a, b) => Number((a as RecordValue).x) - Number((b as RecordValue).x));
  let result = xml ? xmlSource(value as RecordValue) : JSON.stringify(value, null, 2);
  let parsed = notation.read(result);
  if (parsed.readOnlyReason) throw new Error(`Не удалось безопасно объединить модель: ${parsed.readOnlyReason}`);
  // Два участника могли двигать разные концы одной связи. Обновляем её маршрут по объединённой геометрии.
  const b = notation.read(base).diagram, l = notation.read(local).diagram, r = notation.read(remote).diagram;
  const boundsChanged = (a: DiagramNode, b: DiagramNode) => a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height;
  for (const edge of parsed.diagram.edges) {
    if (edge.routeEditable === false) continue;
    const own = l.edges.find(e => e.id === edge.id), original = b.edges.find(e => e.id === edge.id);
    const previous = own && !same(own.points, original?.points) ? l : r;
    const previousEdge = previous.edges.find(e => e.id === edge.id);
    if (!previousEdge) continue;
    const oldFrom = previous.nodes.find(n => n.id === previousEdge.from), oldTo = previous.nodes.find(n => n.id === previousEdge.to);
    const from = parsed.diagram.nodes.find(n => n.id === edge.from), to = parsed.diagram.nodes.find(n => n.id === edge.to);
    if (!oldFrom || !oldTo || !from || !to || (!boundsChanged(from, oldFrom) && !boundsChanged(to, oldTo))) continue;
    const translate = (point: { x: number; y: number }, old: DiagramNode, next: DiagramNode) => ({ x: next.x + (point.x - old.x) * next.width / old.width, y: next.y + (point.y - old.y) * next.height / old.height });
    const points = routeBetweenNodes(parsed.diagram.nodes.filter(node => !notation.symbols.find(symbol => symbol.type === node.type)?.container), from, to, translate(previousEdge.points[0], oldFrom, from), translate(previousEdge.points[previousEdge.points.length - 1], oldTo, to), n => notation.symbols.find(s => s.type === n.type)?.shape);
    if (!points) throw new Error(`Не удалось объединить одновременное перемещение концов связи (${notationId}).`);
    result = notation.editEdge(result, edge.id, edge.from, edge.to, points);
    parsed = notation.read(result);
  }
  return result;
}

/** Ошибка безопасного слияния: локальная копия остаётся доступной для экспорта и исправления. */
export class DiagramMergeError extends Error {}

export function mergeDiagramSource(base: string, local: string, remote: string, notationId: string): string {
  try { return mergeSource(base, local, remote, notationId); }
  catch (error) { throw new DiagramMergeError(error instanceof Error ? error.message : 'Не удалось объединить модель.'); }
}
