import type { DiagramNotation } from './types';
import { epcNotation } from './epc';
import { umlClassNotation } from './umlClass';
import { umlUseCaseNotation } from './umlUseCase';
import { umlActivityNotation } from './umlActivity';
import { umlSequenceNotation, createSequence } from './umlSequence';

type RegisteredNotation = DiagramNotation & { createEmpty: () => string };
/** Один реестр для доступных адаптеров и каталога создания. */
const registered: { notation: RegisteredNotation; title: string; description: string; format: string }[] = [
  { notation: umlClassNotation, title: 'Диаграмма классов', description: 'Классы и отношения между ними.', format: 'UML' },
  { notation: umlUseCaseNotation, title: 'Диаграмма вариантов использования', description: 'Акторы и варианты использования системы.', format: 'UML' },
  { notation: umlActivityNotation, title: 'Диаграмма деятельности', description: 'Действия и потоки управления.', format: 'UML' },
  { notation: { ...umlSequenceNotation, createEmpty: createSequence }, title: 'Диаграмма последовательности', description: 'Участники и последовательность сообщений.', format: 'UML' },
  { notation: epcNotation, title: 'Событийная цепочка процесса', description: 'События, функции, операторы и ресурсы процесса.', format: 'EPC' },
];

export const modelDefinitions = registered.map(({ notation, title, description, format }) => ({ id: notation.id, title, description, format }));

export function getModelNotation(id: string): RegisteredNotation | undefined {
  return registered.find(entry => entry.notation.id === id)?.notation;
}
