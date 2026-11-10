import { endpointsFaceOutward, routeBetweenNodes, segmentCrossesNode } from './diagramRouting';
import { hasSelfIntersections, simplifyRoute } from './orthogonalRouting';
import type { Diagram, DiagramBounds, DiagramEdge, DiagramNode, DiagramNotation, DiagramPoint, DiagramSymbol } from './types';

export interface GraphConfig {
  id: string;
  title: string;
  fileExtension: string;
  symbols: DiagramSymbol[];
  defaultLabel?: (symbol: DiagramSymbol) => string;
  connectionTypes: NonNullable<DiagramNotation['connectionTypes']>;
  edgeEndProperties?: string[];
  canConnect: (fromType: string, toType: string, edgeType: string) => boolean;
  defaultConnection: (fromType: string, toType: string) => string | undefined;
}

type Graph = { format: string; version: number; notation: string; nodes: DiagramNode[]; edges: DiagramEdge[] };
const FORMAT = 'business-board-graph';
const VERSION = 1;
const emptyDiagram = (): Diagram => ({ nodes: [], edges: [] });
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const isPoint = (value: unknown): value is DiagramPoint => isObject(value) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y);
const isBounds = (value: unknown): value is DiagramBounds => isPoint(value) && isObject(value) && typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0 && typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0;
const boundsKeys = ['x', 'y', 'width', 'height'];
const pointKeys = ['x', 'y'];
const validMultiplicity = (value: string) => {
  if (value === '' || value === '*') return true;
  const match = /^(\d+)(?:\.\.(\d+|\*))?$/.exec(value);
  return !!match && (!match[2] || match[2] === '*' || BigInt(match[1]) <= BigInt(match[2]));
};
const validEnd = (value: unknown): value is { role: string; multiplicity: string } => isObject(value) && hasOnly(value, ['role', 'multiplicity']) && typeof value.role === 'string' && typeof value.multiplicity === 'string' && validMultiplicity(value.multiplicity);

export function createGraphNotation(config: GraphConfig): DiagramNotation & { createEmpty: () => string } {
  const shapeOf = (node: DiagramNode) => config.symbols.find(symbol => symbol.type === node.type)?.shape;
  const serialize = (graph: Graph) => {
    const result = JSON.stringify(graph, null, 2);
    if (inspect(result).readOnlyReason) throw new Error('Изменение привело к некорректной геометрии диаграммы.');
    return result;
  };
  const inspect = (source: string): { graph?: Graph; diagram: Diagram; readOnlyReason?: string } => {
    let data: unknown;
    try { data = JSON.parse(source); } catch { return { diagram: emptyDiagram(), readOnlyReason: 'Некорректный JSON диаграммы.' }; }
    const refuse = (reason: string) => ({ diagram: emptyDiagram(), readOnlyReason: reason });
    if (!isObject(data) || data.format !== FORMAT || data.notation !== config.id) return refuse('Неверный формат или нотация диаграммы.');
    if (data.version !== VERSION) return refuse('Неподдерживаемая версия диаграммы.');
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return refuse('Некорректная структура диаграммы.');
    let unknown = !hasOnly(data, ['format', 'version', 'notation', 'nodes', 'edges']);
    const ids = new Set<string>();
    for (const node of data.nodes) {
      if (!isObject(node) || typeof node.id !== 'string' || !node.id || ids.has(node.id) || typeof node.type !== 'string' || !config.symbols.some(s => s.type === node.type) || typeof node.label !== 'string' || !isBounds(node) || (node.labelBounds !== undefined && !isBounds(node.labelBounds))) return refuse('Некорректный или неизвестный элемент диаграммы.');
      ids.add(node.id);
      unknown ||= !hasOnly(node, ['id', 'type', 'label', ...boundsKeys, 'labelBounds', 'compartments']);
      if (isObject(node.labelBounds)) unknown ||= !hasOnly(node.labelBounds, boundsKeys);
      if (node.compartments !== undefined) {
        if (config.symbols.find(symbol => symbol.type === node.type)?.shape !== 'class-box' || !isObject(node.compartments) || !Array.isArray(node.compartments.attributes) || !Array.isArray(node.compartments.operations) || !node.compartments.attributes.every(value => typeof value === 'string') || !node.compartments.operations.every(value => typeof value === 'string')) return refuse('Некорректные разделы элемента диаграммы.');
        unknown ||= !hasOnly(node.compartments, ['attributes', 'operations']);
      }
    }
    const nodes = data.nodes as DiagramNode[];
    const nodeIds = new Set(nodes.map(node => node.id));
    for (const edge of data.edges) {
      if (!isObject(edge) || typeof edge.id !== 'string' || !edge.id || ids.has(edge.id) || typeof edge.type !== 'string' || !config.connectionTypes.some(t => t.id === edge.type) || typeof edge.label !== 'string' || typeof edge.from !== 'string' || typeof edge.to !== 'string' || !nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to || !Array.isArray(edge.points) || edge.points.length < 2 || !edge.points.every(isPoint) || (edge.labelBounds !== undefined && !isBounds(edge.labelBounds))) return refuse('Некорректная или неизвестная связь диаграммы.');
      const from = nodes.find(node => node.id === edge.from)!; const to = nodes.find(node => node.id === edge.to)!;
      if (!config.canConnect(from.type, to.type, edge.type)) return refuse('Недопустимая связь диаграммы.');
      ids.add(edge.id);
      unknown ||= !hasOnly(edge, ['id', 'type', 'label', 'from', 'to', 'points', 'labelBounds', 'ends']);
      if (edge.ends !== undefined && (!config.edgeEndProperties?.includes(edge.type) || !isObject(edge.ends) || !hasOnly(edge.ends, ['from', 'to']) || !validEnd(edge.ends.from) || !validEnd(edge.ends.to))) return refuse('Некорректные свойства концов связи.');
      if (isObject(edge.labelBounds)) unknown ||= !hasOnly(edge.labelBounds, boundsKeys);
      for (const point of edge.points) if (isObject(point)) unknown ||= !hasOnly(point, pointKeys);
    }
    const graph = data as unknown as Graph;
    const diagram: Diagram = { nodes: graph.nodes, edges: graph.edges.map(edge => { const type = config.connectionTypes.find(item => item.id === edge.type); return { ...edge, ...type?.appearance, ...(type?.stereotype ? { stereotype: type.stereotype } : {}) }; }) };
    return { graph, diagram, ...(unknown ? { readOnlyReason: 'Диаграмма содержит неподдерживаемые данные; редактирование отключено для их сохранения.' } : {}) };
  };
  const writable = (source: string): Graph => {
    const result = inspect(source);
    if (result.readOnlyReason || !result.graph) throw new Error(result.readOnlyReason ?? 'Диаграмма недоступна для редактирования.');
    return result.graph;
  };
  const nodeById = (graph: Graph, id: string) => {
    const node = graph.nodes.find(item => item.id === id);
    if (!node) throw new Error('Элемент диаграммы не найден.');
    return node;
  };
  const edgeById = (graph: Graph, id: string) => {
    const edge = graph.edges.find(item => item.id === id);
    if (!edge) throw new Error('Связь не найдена.');
    return edge;
  };
  const itemById = (graph: Graph, id: string) => graph.nodes.find(item => item.id === id) ?? graph.edges.find(item => item.id === id) ?? (() => { throw new Error('Элемент диаграммы не найден.'); })();
  const newId = (graph: Graph) => {
    if (!globalThis.crypto?.randomUUID) throw new Error('Недоступен безопасный генератор идентификаторов.');
    let id: string;
    do { id = globalThis.crypto.randomUUID(); } while (graph.nodes.some(n => n.id === id) || graph.edges.some(e => e.id === id));
    return id;
  };
  const route = (graph: Graph, from: DiagramNode, to: DiagramNode, start?: DiagramPoint, end?: DiagramPoint) => {
    const points = routeBetweenNodes(graph.nodes, from, to, start, end, shapeOf);
    if (!points) throw new Error('Не удалось построить маршрут связи.');
    return points;
  };
  const validateConnection = (graph: Graph, from: string, to: string, type: string, except?: string) => {
    const a = nodeById(graph, from); const b = nodeById(graph, to);
    if (from === to) throw new Error('Нельзя связать элемент с самим собой.');
    if (!config.connectionTypes.some(item => item.id === type) || !config.canConnect(a.type, b.type, type)) throw new Error('Недопустимый тип связи.');
    if (graph.edges.some(edge => edge.id !== except && edge.from === from && edge.to === to && edge.type === type)) throw new Error('Такая связь уже существует.');
    return [a, b] as const;
  };
  const validRoute = (graph: Graph, from: DiagramNode, to: DiagramNode, candidate: DiagramPoint[]) => {
    const cleaned = simplifyRoute(candidate);
    if (cleaned.length < 2 || cleaned.slice(1).some((p, i) => p.x !== cleaned[i].x && p.y !== cleaned[i].y) || hasSelfIntersections(cleaned) || !endpointsFaceOutward(cleaned, from, to, shapeOf)) return false;
    return cleaned.slice(1).every((end, i) => graph.nodes.every(n =>
      (i === 0 && n.id === from.id) || (i === cleaned.length - 2 && n.id === to.id) || !segmentCrossesNode(cleaned[i], end, n)));
  };
  const reroute = (graph: Graph, id: string, before: DiagramBounds) => {
    const node = nodeById(graph, id);
    for (const edge of graph.edges) {
      if (edge.from !== id && edge.to !== id) continue;
      const from = nodeById(graph, edge.from), to = nodeById(graph, edge.to);
      const reverse = edge.to === id;
      const points = (reverse ? [...edge.points].reverse() : edge.points).map(point => ({ ...point }));
      const old = points[0];
      const anchor = { x: node.x + (old.x - before.x) / before.width * node.width, y: node.y + (old.y - before.y) / before.height * node.height };
      if (!isPoint(anchor)) throw new Error('Некорректная привязка связи.');
      if (points.length === 2) {
        const start = reverse ? points[1] : anchor, end = reverse ? anchor : points[1];
        const clear = routeBetweenNodes(graph.nodes, from, to, start, end, shapeOf);
        // При наложении фигур свободного обхода может не быть. Сохраняем обе
        // привязки и даём объекту двигаться; пересечение временно допустимо.
        const horizontal = points[0].y === points[1].y;
        const middle = horizontal ? (start.x + end.x) / 2 : (start.y + end.y) / 2;
        const fallback = horizontal ? [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end]
          : [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
        const projected = simplifyRoute(fallback);
        edge.points = clear ?? (projected.length >= 2 ? projected : [start, end]);
        continue;
      }
      const next = points[1];
      if (old.x === next.x) next.x = anchor.x;
      else if (old.y === next.y) next.y = anchor.y;
      // Импортированный диагональный участок не перестраиваем без запроса.
      points[0] = anchor;
      const ordered = reverse ? points.reverse() : points;
      const simplified = simplifyRoute(ordered);
      const candidate = simplified.length >= 2 ? simplified : [ordered[0], ordered[ordered.length - 1]];
      if (validRoute(graph, from, to, candidate)) edge.points = candidate;
      else if (points.length <= 4) edge.points = routeBetweenNodes(graph.nodes, from, to, candidate[0], candidate[candidate.length - 1], shapeOf) ?? candidate;
      // Ручные изгибы не удаляем: если путь перекрыт, сохраняем его как есть
      // и позволяем разнести объекты позже.
      else edge.points = candidate;
    }
  };
  return {
    id: config.id, title: config.title, fileExtension: config.fileExtension, fileAccept: `.${config.fileExtension}`, mimeType: 'application/json',
    symbols: config.symbols, connectionTypes: config.connectionTypes,
    ...(config.edgeEndProperties ? {
      edgeEndProperties: (edge: DiagramEdge) => config.edgeEndProperties!.includes(edge.type),
      setEdgeEnds: (source: string, id: string, ends: NonNullable<DiagramEdge['ends']>) => {
        const graph = writable(source); const edge = edgeById(graph, id);
        if (!config.edgeEndProperties!.includes(edge.type) || !isObject(ends) || !hasOnly(ends, ['from', 'to']) || !validEnd(ends.from) || !validEnd(ends.to)) throw new Error('Укажите кратность, например 1, *, 0..1 или 1..*.');
        edge.ends = { from: { ...ends.from }, to: { ...ends.to } }; return serialize(graph);
      },
    } : {}),
    createEmpty: () => serialize({ format: FORMAT, version: VERSION, notation: config.id, nodes: [], edges: [] }),
    read: source => { const { diagram, readOnlyReason } = inspect(source); return { diagram, ...(readOnlyReason ? { readOnlyReason } : {}) }; },
    addNode: (source, type, at) => {
      const graph = writable(source); const symbol = config.symbols.find(item => item.type === type);
      if (!symbol) throw new Error('Неизвестный тип элемента.');
      if (!isPoint(at) || !Number.isFinite(symbol.width) || !Number.isFinite(symbol.height) || symbol.width <= 0 || symbol.height <= 0) throw new Error('Некорректная геометрия элемента.');
      graph.nodes.push({ id: newId(graph), type, label: config.defaultLabel?.(symbol) ?? '', x: at.x, y: at.y, width: symbol.width, height: symbol.height });
      return serialize(graph);
    },
    moveNode: (source, id, at) => {
      const graph = writable(source); const node = nodeById(graph, id);
      if (!isPoint(at)) throw new Error('Некорректное положение элемента.');
      if (at.x === node.x && at.y === node.y) return source;
      const before = { x: node.x, y: node.y, width: node.width, height: node.height };
      if (node.labelBounds) { node.labelBounds.x += at.x - node.x; node.labelBounds.y += at.y - node.y; }
      node.x = at.x; node.y = at.y; reroute(graph, id, before); return serialize(graph);
    },
    resizeNode: (source, id, width, height) => {
      const graph = writable(source); const node = nodeById(graph, id);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Некорректный размер элемента.');
      if (width === node.width && height === node.height) return source;
      const before = { x: node.x, y: node.y, width: node.width, height: node.height };
      if (node.labelBounds) { node.labelBounds.x = node.x + (node.labelBounds.x - node.x) * width / node.width; node.labelBounds.y = node.y + (node.labelBounds.y - node.y) * height / node.height; node.labelBounds.width *= width / node.width; node.labelBounds.height *= height / node.height; }
      node.width = width; node.height = height; reroute(graph, id, before); return serialize(graph);
    },
    setLabelBounds: (source, id, bounds) => {
      const graph = writable(source); const item = itemById(graph, id);
      if (!isBounds(bounds)) throw new Error('Некорректные границы подписи.');
      item.labelBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }; return serialize(graph);
    },
    setNodeCompartments: (source, id, sections) => {
      const graph = writable(source); const node = nodeById(graph, id);
      if (shapeOf(node) !== 'class-box' || !Array.isArray(sections.attributes) || !Array.isArray(sections.operations) || !sections.attributes.every(value => typeof value === 'string') || !sections.operations.every(value => typeof value === 'string')) throw new Error('Некорректные разделы элемента.');
      node.compartments = { attributes: [...sections.attributes], operations: [...sections.operations] }; return serialize(graph);
    },
    rename: (source, id, name) => {
      const graph = writable(source); if (typeof name !== 'string') throw new Error('Некорректное имя элемента.');
      itemById(graph, id).label = name; return serialize(graph);
    },
    connect: (source, from, to, type) => {
      const graph = writable(source); const a = nodeById(graph, from); const b = nodeById(graph, to);
      const selected = type ?? config.defaultConnection(a.type, b.type);
      if (!selected) throw new Error('Для этих элементов нет допустимой связи.');
      validateConnection(graph, from, to, selected);
      graph.edges.push({ id: newId(graph), type: selected, label: '', from, to, points: route(graph, a, b) }); return serialize(graph);
    },
    editEdge: (source, id, from, to, points) => {
      const graph = writable(source); const edge = edgeById(graph, id);
      const [a, b] = validateConnection(graph, from, to, edge.type, id);
      if (!Array.isArray(points) || points.length < 2 || !points.every(isPoint)) throw new Error('Некорректный маршрут связи.');
      if (!validRoute(graph, a, b, points)) throw new Error('Небезопасный маршрут связи.');
      edge.from = from; edge.to = to; edge.points = points.map(point => ({ x: point.x, y: point.y })); return serialize(graph);
    },
    resetEdge: (source, id) => {
      const graph = writable(source); const edge = edgeById(graph, id);
      edge.points = route(graph, nodeById(graph, edge.from), nodeById(graph, edge.to), edge.points[0], edge.points[edge.points.length - 1]); return serialize(graph);
    },
    remove: (source, id) => {
      const graph = writable(source); itemById(graph, id);
      graph.nodes = graph.nodes.filter(node => node.id !== id);
      graph.edges = graph.edges.filter(edge => edge.id !== id && edge.from !== id && edge.to !== id); return serialize(graph);
    },
  };
}
