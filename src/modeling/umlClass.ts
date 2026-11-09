import { createGraphNotation } from './graphNotation';
import type { DiagramSymbol } from './types';

/** Разделы классификаторов хранятся как строки UML, без разбора сигнатур. */
export const umlClassSymbols: DiagramSymbol[] = [
  { type: 'class', title: 'Класс', shape: 'class-box', width: 180, height: 120 },
  { type: 'interface', title: 'Интерфейс', shape: 'class-box', stereotype: '«interface»', width: 180, height: 120 },
  { type: 'enumeration', title: 'Перечисление', shape: 'class-box', stereotype: '«enumeration»', width: 180, height: 120 },
  { type: 'data-type', title: 'Тип данных', shape: 'class-box', stereotype: '«dataType»', width: 180, height: 120 },
  { type: 'primitive-type', title: 'Примитивный тип', shape: 'class-box', stereotype: '«primitive»', width: 180, height: 120 },
];
export const umlClassConnectionTypes = [
  { id: 'association', title: 'Ассоциация', appearance: { lineStyle: 'solid', arrowEnd: false } },
  { id: 'navigable-association', title: 'Направленная ассоциация', appearance: { lineStyle: 'solid', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'generalization', title: 'Обобщение', appearance: { lineStyle: 'solid', arrowEnd: true, arrowStyle: 'triangle' } },
  { id: 'realization', title: 'Реализация', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'triangle' } },
  { id: 'dependency', title: 'Зависимость', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'aggregation', title: 'Агрегация', appearance: { lineStyle: 'solid', startMarker: 'diamond', arrowEnd: false } },
  { id: 'composition', title: 'Композиция', appearance: { lineStyle: 'solid', startMarker: 'diamond-filled', arrowEnd: false } },
] as const;
const classifiers = new Set(umlClassSymbols.map(symbol => symbol.type));
/** Направление обобщения и реализации: от потомка/реализации к родителю/интерфейсу. */
export function canConnectUmlClass(from: string, to: string, edge: string): boolean {
  if (!classifiers.has(from) || !classifiers.has(to)) return false;
  switch (edge) {
    case 'association': case 'navigable-association': case 'dependency': return true;
    case 'generalization': return from === to && from !== 'enumeration';
    case 'realization': return from === 'class' && to === 'interface';
    case 'aggregation': case 'composition': return from === 'class' && to === 'class';
    default: return false;
  }
}
export function defaultUmlClassConnection(from: string, to: string): string | undefined {
  return umlClassConnectionTypes.find(edge => canConnectUmlClass(from, to, edge.id))?.id;
}
export const umlClassNotation = createGraphNotation({
  id: 'uml-class', title: 'UML: диаграмма классов (частично)', fileExtension: 'uml-class',
  symbols: umlClassSymbols, connectionTypes: umlClassConnectionTypes.map(edge => ({ ...edge, appearance: { ...edge.appearance } })),
  edgeEndProperties: ['association', 'navigable-association', 'aggregation', 'composition'],
  canConnect: canConnectUmlClass, defaultConnection: defaultUmlClassConnection,
});
