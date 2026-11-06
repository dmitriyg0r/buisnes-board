import type { NodeKind } from './bpmn';

export type FieldDef = {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'select';
  options?: string[];
  placeholder?: string;
};

const description: FieldDef = { key: 'description', label: 'Описание', kind: 'textarea', placeholder: 'Что происходит на этом шаге' };

export const nodeFields: Record<NodeKind, FieldDef[]> = {
  task: [
    { key: 'executor', label: 'Исполнитель', kind: 'text', placeholder: 'по умолчанию — дорожка шага' },
    { key: 'deadline', label: 'Срок выполнения', kind: 'text', placeholder: 'например, 3 рабочих дня' },
    { key: 'system', label: 'Система или инструмент', kind: 'text', placeholder: 'например, портал закупок' },
    description,
  ],
  gateway: [
    { key: 'criterion', label: 'Критерий решения', kind: 'text', placeholder: 'по какому признаку выбирается ветка' },
    { key: 'executor', label: 'Кто принимает решение', kind: 'text', placeholder: 'по умолчанию — дорожка шага' },
    description,
  ],
  start: [{ key: 'trigger', label: 'Триггер', kind: 'text', placeholder: 'что запускает процесс' }, description],
  end: [{ key: 'result', label: 'Результат', kind: 'text', placeholder: 'чем заканчивается процесс' }, description],
  event: [description],
};

/** Значение поля «Связь с моделью» для пунктов, которым шаг модели не нужен: цель, участники, определения. */
export const INFO_SECTION = 'Справочный пункт';

export const sectionFields: FieldDef[] = [
  { key: 'status', label: 'Статус пункта', kind: 'select', options: ['Черновик', 'Согласован', 'Устарел'] },
  { key: 'coverage', label: 'Связь с моделью', kind: 'select', options: ['Описывает шаги модели', INFO_SECTION] },
];

export const fileFields: FieldDef[] = [
  { key: 'docKind', label: 'Вид источника', kind: 'select', options: ['Соглашение', 'Интервью', 'Регламент', 'Другое'] },
  { key: 'owner', label: 'Владелец', kind: 'text', placeholder: 'кто предоставил материал' },
  { key: 'note', label: 'Комментарий', kind: 'textarea' },
];

export const modelFields: FieldDef[] = [
  { key: 'version', label: 'Версия', kind: 'text', placeholder: '0.1' },
  { key: 'status', label: 'Статус', kind: 'select', options: ['Черновик', 'На согласовании', 'Утверждена'] },
  { key: 'owner', label: 'Владелец процесса', kind: 'text' },
  { key: 'description', label: 'Описание', kind: 'textarea' },
];

export const docFields: FieldDef[] = [
  { key: 'version', label: 'Версия', kind: 'text', placeholder: '0.3' },
  { key: 'status', label: 'Статус', kind: 'select', options: ['Черновик', 'На согласовании', 'Утверждён'] },
  { key: 'owner', label: 'Автор', kind: 'text' },
  { key: 'description', label: 'Описание', kind: 'textarea' },
];

export const defaults: Record<string, Record<string, string>> = {
  'card:model': { status: 'Черновик' },
  'card:doc': { status: 'Черновик' },
};

export const key = {
  node: (id: string) => `node:${id}`,
  edge: (id: string) => `edge:${id}`,
  section: (id: string) => `section:${id}`,
  card: (id: string) => `card:${id}`,
};
