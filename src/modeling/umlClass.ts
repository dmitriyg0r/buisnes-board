import { createGraphNotation } from './graphNotation';
import type { DiagramSymbol } from './types';

/** Разделы классификаторов хранятся как строки UML, без разбора сигнатур. */
export const umlClassSymbols: DiagramSymbol[] = [
  { type: 'class', title: 'Класс', shape: 'class-box', width: 180, height: 120 },
  { type: 'abstract-class', title: 'Абстрактный класс', shape: 'class-box', italicLabel: true, width: 180, height: 120 },
  { type: 'interface', title: 'Интерфейс', shape: 'class-box', stereotype: '«interface»', width: 180, height: 120 },
  { type: 'enumeration', title: 'Перечисление', shape: 'class-box', stereotype: '«enumeration»', width: 180, height: 120 },
  { type: 'data-type', title: 'Тип данных', shape: 'class-box', stereotype: '«dataType»', width: 180, height: 120 },
  { type: 'primitive-type', title: 'Примитивный тип', shape: 'class-box', stereotype: '«primitive»', width: 180, height: 120 },
  { type: 'association-class', title: 'Класс ассоциации', shape: 'class-box', width: 180, height: 120 },
  { type: 'signal', title: 'Сигнал', shape: 'class-box', stereotype: '«signal»', width: 180, height: 120 },
  { type: 'instance', title: 'Экземпляр', shape: 'class-box', width: 180, height: 120 },
  { type: 'package', title: 'Пакет', shape: 'package', container: true, width: 420, height: 290 },
  { type: 'comment', title: 'Примечание', shape: 'document', width: 160, height: 80, appearance: { fill: '#faf6e8', stroke: '#796e55', labelInside: true } },
];
export const umlClassConnectionTypes = [
  { id: 'association', title: 'Ассоциация', appearance: { lineStyle: 'solid', arrowEnd: false } },
  { id: 'navigable-association', title: 'Направленная ассоциация', appearance: { lineStyle: 'solid', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'generalization', title: 'Обобщение', appearance: { lineStyle: 'solid', arrowEnd: true, arrowStyle: 'triangle' } },
  { id: 'realization', title: 'Реализация', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'triangle' } },
  { id: 'dependency', title: 'Зависимость', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'aggregation', title: 'Агрегация', appearance: { lineStyle: 'solid', startMarker: 'diamond', arrowEnd: false } },
  { id: 'composition', title: 'Композиция', appearance: { lineStyle: 'solid', startMarker: 'diamond-filled', arrowEnd: false } },
  { id: 'usage', title: 'Использование', stereotype: '«use»', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'package-import', title: 'Импорт пакета', stereotype: '«import»', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'package-access', title: 'Закрытый импорт пакета', stereotype: '«access»', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'package-merge', title: 'Слияние пакетов', stereotype: '«merge»', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'comment-link', title: 'Связь с примечанием', appearance: { lineStyle: 'dashed', arrowEnd: false } },
] as const;
const classifiers = new Set(umlClassSymbols.filter(symbol => symbol.shape === 'class-box' && symbol.type !== 'instance').map(symbol => symbol.type));
const concreteKind = (type: string) => type === 'abstract-class' || type === 'association-class' ? 'class' : type;
/** Направление обобщения и реализации: от потомка/реализации к родителю/интерфейсу. */
export function canConnectUmlClass(from: string, to: string, edge: string): boolean {
  if (edge === 'comment-link') return (from === 'comment' && (classifiers.has(to) || to === 'package' || to === 'instance')) || (to === 'comment' && (classifiers.has(from) || from === 'package' || from === 'instance'));
  if (edge === 'package-import' || edge === 'package-access' || edge === 'package-merge') return from === 'package' && to === 'package';
  if (edge === 'dependency' && (from === 'package' || to === 'package')) return from !== 'comment' && to !== 'comment';
  if (from === 'instance' || to === 'instance') return from === to && edge === 'association';
  if (!classifiers.has(from) || !classifiers.has(to)) return false;
  from = concreteKind(from); to = concreteKind(to);
  switch (edge) {
    case 'association': case 'navigable-association': case 'dependency': case 'usage': return true;
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
  editableEdgeTypes: true, associationClass: true,
  canConnect: canConnectUmlClass, defaultConnection: defaultUmlClassConnection,
});
