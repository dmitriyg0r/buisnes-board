import { createGraphNotation } from './graphNotation';
import type { DiagramSymbol } from './types';

/** Разделы активности, вложенные пины и специфические контуры сигналов пока не поддерживаются. */
export const umlActivitySymbols: DiagramSymbol[] = [
  { type: 'action', title: 'Действие', shape: 'rounded-rectangle', width: 150, height: 65 },
  { type: 'object', title: 'Объект', shape: 'rectangle', width: 120, height: 60 },
  { type: 'initial', title: 'Начальный узел', shape: 'circle', glyph: 'filled', width: 30, height: 30 },
  { type: 'activity-final', title: 'Конец активности', shape: 'double-circle', glyph: 'filled', width: 36, height: 36 },
  { type: 'flow-final', title: 'Конец потока', shape: 'circle-cross', width: 36, height: 36 },
  { type: 'decision', title: 'Разветвление', shape: 'diamond', width: 55, height: 55 },
  { type: 'merge', title: 'Слияние', shape: 'diamond', width: 55, height: 55 },
  { type: 'fork', title: 'Распараллеливание', shape: 'bar', width: 120, height: 12 },
  { type: 'join', title: 'Синхронизация', shape: 'bar', width: 120, height: 12 },
  // Значки конвертов — приближение в рамках текущего рендерера, а не UML-контуры сигналов.
  { type: 'send-signal', title: 'Отправить сигнал', shape: 'rounded-rectangle', glyph: 'send', width: 150, height: 65 },
  { type: 'accept-signal', title: 'Принять сигнал', shape: 'rounded-rectangle', glyph: 'receive', width: 150, height: 65 },
  { type: 'comment', title: 'Примечание', shape: 'annotation', width: 150, height: 70 },
];
export const umlActivityConnectionTypes = [
  { id: 'control-flow', title: 'Поток управления', appearance: { lineStyle: 'solid', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'object-flow', title: 'Поток объектов', appearance: { lineStyle: 'solid', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'comment-link', title: 'Связь с примечанием', appearance: { lineStyle: 'dashed', arrowEnd: false } },
] as const;
const control = new Set(['action', 'initial', 'activity-final', 'flow-final', 'decision', 'merge', 'fork', 'join', 'send-signal', 'accept-signal']);
const objectFlow = new Set(['action', 'object', 'decision', 'merge', 'fork', 'join', 'send-signal', 'accept-signal']);
const nodes = new Set(umlActivitySymbols.filter(symbol => symbol.type !== 'comment').map(symbol => symbol.type));
/** Проверка типов и направления, без глобальных проверок кратности и достижимости. */
export function canConnectUmlActivity(from: string, to: string, edge: string): boolean {
  switch (edge) {
    case 'control-flow': return control.has(from) && control.has(to) && from !== 'activity-final' && from !== 'flow-final' && to !== 'initial';
    case 'object-flow': return objectFlow.has(from) && objectFlow.has(to);
    case 'comment-link': return (from === 'comment' && nodes.has(to)) || (to === 'comment' && nodes.has(from));
    default: return false;
  }
}
export function defaultUmlActivityConnection(from: string, to: string): string | undefined {
  return umlActivityConnectionTypes.find(edge => canConnectUmlActivity(from, to, edge.id))?.id;
}
export const umlActivityNotation = createGraphNotation({
  id: 'uml-activity', title: 'UML: диаграмма активности (частично)', fileExtension: 'uml-activity',
  symbols: umlActivitySymbols, connectionTypes: umlActivityConnectionTypes.map(edge => ({ ...edge, appearance: { ...edge.appearance } })),
  canConnect: canConnectUmlActivity, defaultConnection: defaultUmlActivityConnection,
});
