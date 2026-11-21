import { createGraphNotation } from './graphNotation';
import type { DiagramSymbol } from './types';
import { signalNotch } from './diagramRouting';

const actions = ['action', 'send-signal', 'accept-signal'] as const;
export const umlActivitySymbols: DiagramSymbol[] = [
  { type: 'action', title: 'Действие', shape: 'rounded-rectangle', width: 150, height: 65 },
  { type: 'object', title: 'Объект', shape: 'rectangle', width: 120, height: 60 },
  { type: 'central-buffer', title: 'Центральный буфер', shape: 'rectangle', stereotype: '«centralBuffer»', width: 144, height: 60 },
  { type: 'activity-data-store', title: 'Хранилище данных', shape: 'rectangle', stereotype: '«datastore»', width: 144, height: 60 },
  { type: 'partition', title: 'Дорожка', shape: 'partition', container: true, width: 560, height: 180 },
  { type: 'input-pin', title: 'Входной пин', shape: 'rectangle', width: 16, height: 16, ownerTypes: actions, singleConnectionPortPerSide: true },
  { type: 'output-pin', title: 'Выходной пин', shape: 'rectangle', width: 16, height: 16, ownerTypes: actions, singleConnectionPortPerSide: true },
  { type: 'initial', title: 'Начальный узел', shape: 'circle', glyph: 'filled', width: 30, height: 30 },
  { type: 'activity-final', title: 'Конец активности', shape: 'double-circle', glyph: 'filled', width: 36, height: 36 },
  { type: 'flow-final', title: 'Конец потока', shape: 'circle-cross', width: 36, height: 36 },
  { type: 'decision', title: 'Разветвление', shape: 'diamond', width: 55, height: 55 },
  { type: 'merge', title: 'Слияние', shape: 'diamond', width: 55, height: 55 },
  { type: 'fork', title: 'Распараллеливание', shape: 'bar', width: 120, height: 12 },
  { type: 'join', title: 'Синхронизация', shape: 'bar', width: 120, height: 12 },
  { type: 'send-signal', title: 'Отправить сигнал', shape: 'pointed-right', width: 150, height: 65 },
  { type: 'accept-signal', title: 'Принять сигнал', shape: 'notched-left', width: 150, height: 65 },
  { type: 'comment', title: 'Примечание', shape: 'annotation', width: 150, height: 70 },
];
export const umlActivityConnectionTypes = [
  { id: 'control-flow', title: 'Поток управления', appearance: { lineStyle: 'solid', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'object-flow', title: 'Поток объектов', appearance: { lineStyle: 'solid', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'comment-link', title: 'Связь с примечанием', appearance: { lineStyle: 'dashed', arrowEnd: false } },
] as const;
const control = new Set(['action', 'initial', 'activity-final', 'flow-final', 'decision', 'merge', 'fork', 'join', 'send-signal', 'accept-signal']);
const objectFlow = new Set(['action', 'object', 'decision', 'merge', 'fork', 'join', 'send-signal', 'accept-signal', 'central-buffer', 'activity-data-store', 'input-pin', 'output-pin']);
const nodes = new Set(umlActivitySymbols.filter(symbol => symbol.type !== 'comment').map(symbol => symbol.type));
/** Проверка типов и направления, без глобальных проверок кратности и достижимости. */
export function canConnectUmlActivity(from: string, to: string, edge: string): boolean {
  switch (edge) {
    case 'control-flow': return control.has(from) && control.has(to) && from !== 'activity-final' && from !== 'flow-final' && to !== 'initial';
    case 'object-flow': return objectFlow.has(from) && objectFlow.has(to) && from !== 'input-pin' && to !== 'output-pin';
    case 'comment-link': return (from === 'comment' && nodes.has(to)) || (to === 'comment' && nodes.has(from));
    default: return false;
  }
}
export function defaultUmlActivityConnection(from: string, to: string): string | undefined {
  return umlActivityConnectionTypes.find(edge => canConnectUmlActivity(from, to, edge.id))?.id;
}
const graph = createGraphNotation({
  id: 'uml-activity', title: 'UML: диаграмма активности (частично)', fileExtension: 'uml-activity',
  symbols: umlActivitySymbols, connectionTypes: umlActivityConnectionTypes.map(edge => ({ ...edge, appearance: { ...edge.appearance } })),
  editableEdgeTypes: true, guardTypes: ['control-flow', 'object-flow'],
  canConnect: canConnectUmlActivity, defaultConnection: defaultUmlActivityConnection,
});

export const umlActivityNotation = {
  ...graph,
  read: (source: string) => {
    const result = graph.read(source);
    const nodes = new Map(result.diagram.nodes.map(node => [node.id, node]));
    return { ...result, diagram: { ...result.diagram, edges: result.diagram.edges.map(edge => {
      const points = [...edge.points];
      // Старые схемы привязывались к прямоугольнику. Подводим линию к новому
      // контуру при отображении, не переписывая сохранённый маршрут.
      for (const [id, i, j] of [[edge.from, 0, 1], [edge.to, points.length - 1, points.length - 2]] as const) {
        const node = nodes.get(id), p = points[i], next = points[j];
        if (!node || p.y !== next.y || p.y < node.y || p.y > node.y + node.height) continue;
        const cut = signalNotch(node.width) * Math.max(0, 1 - Math.abs(2 * (p.y - node.y) / node.height - 1));
        if (node.type === 'accept-signal' && next.x < p.x && p.x === node.x) points[i] = { ...p, x: p.x + cut };
        if (node.type === 'send-signal' && next.x > p.x && p.x === node.x + node.width) points[i] = { ...p, x: p.x - (signalNotch(node.width) - cut) };
      }
      return { ...edge, points };
    }) } };
  },
};
