import { createGraphNotation } from './graphNotation';
import type { DiagramSymbol } from './types';

/** Граница системы — фоновый лист; акторы остаются снаружи. */
export const umlUseCaseSymbols: DiagramSymbol[] = [
  { type: 'actor', title: 'Актор', shape: 'actor', width: 80, height: 110 },
  { type: 'use-case', title: 'Вариант использования', shape: 'ellipse', width: 160, height: 80 },
  { type: 'system-boundary', title: 'Лист (граница системы)', shape: 'frame', container: true, width: 650, height: 500 },
  { type: 'comment', title: 'Примечание', shape: 'document', width: 160, height: 80, appearance: { fill: '#faf6e8', stroke: '#796e55', labelInside: true } },
];
export const umlUseCaseConnectionTypes = [
  { id: 'association', title: 'Ассоциация', appearance: { lineStyle: 'solid', arrowEnd: false } },
  { id: 'include', title: 'Включение «include»', stereotype: '«include»', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'extend', title: 'Расширение «extend»', stereotype: '«extend»', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'generalization', title: 'Обобщение', appearance: { lineStyle: 'solid', arrowEnd: true, arrowStyle: 'triangle' } },
  { id: 'dependency', title: 'Зависимость', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'comment-link', title: 'Связь с примечанием', appearance: { lineStyle: 'dashed', arrowEnd: false } },
] as const;
/** Include направлен к включаемому, extend — к расширяемому варианту. */
export function canConnectUmlUseCase(from: string, to: string, edge: string): boolean {
  const element = (type: string) => type === 'actor' || type === 'use-case';
  if (edge === 'comment-link') return (from === 'comment' && element(to)) || (to === 'comment' && element(from));
  if (!element(from) || !element(to)) return false;
  switch (edge) {
    case 'association': return (from === 'actor' && to === 'use-case') || (from === 'use-case' && to === 'actor');
    case 'include': case 'extend': return from === 'use-case' && to === 'use-case';
    case 'generalization': return from === to && (from === 'actor' || from === 'use-case');
    case 'dependency': return true;
    default: return false;
  }
}
export function defaultUmlUseCaseConnection(from: string, to: string): string | undefined {
  return umlUseCaseConnectionTypes.find(edge => canConnectUmlUseCase(from, to, edge.id))?.id;
}
export const umlUseCaseNotation = createGraphNotation({
  id: 'uml-use-case', title: 'UML: варианты использования (частично)', fileExtension: 'uml-use-case',
  symbols: umlUseCaseSymbols, connectionTypes: umlUseCaseConnectionTypes.map(edge => ({ ...edge, appearance: { ...edge.appearance } })),
  editableEdgeTypes: true, guardTypes: ['extend'], extensions: true,
  canConnect: canConnectUmlUseCase, defaultConnection: defaultUmlUseCaseConnection,
});
