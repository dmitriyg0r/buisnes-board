import { createElement } from 'react';
import { createGraphNotation } from './graphNotation';
import type { DiagramNotation, DiagramSymbol } from './types';

// Семейства цветов из справочных карточек ArchiMate 3.2, приглушённые для полотна редактора.
const layers = {
  business: { title: 'Бизнес', fill: '#fbf1cf', stroke: '#91702f' },
  application: { title: 'Приложения', fill: '#e2f1fa', stroke: '#4b7488' },
  technology: { title: 'Технологии', fill: '#e2f1df', stroke: '#507a55' },
  physical: { title: 'Физический слой', fill: '#e9f0df', stroke: '#62794a' },
  strategy: { title: 'Стратегия', fill: '#f5e7ca', stroke: '#8b6741' },
  motivation: { title: 'Мотивация', fill: '#eeebfa', stroke: '#746297' },
  migration: { title: 'Внедрение и миграция', fill: '#f7e6e9', stroke: '#925865' },
  common: { title: 'Общие элементы', fill: '#f1f0ec', stroke: '#686967' },
} as const;
type Layer = keyof typeof layers;

// Пиктограммы нарисованы для редактора; формы и типы сверены со справочными карточками.
const icons = {
  actor: 'M12 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M12 10v6m-5-4 5-2 5 2m-8 9 3-5 3 5',
  role: 'M4 12c0-4 16-4 16 0s-16 4-16 0z M16 9v6',
  collaboration: 'M8.5 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z M15.5 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z',
  interface: 'M3 12h7m5-5a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  process: 'M3 9h10V5l8 7-8 7v-4H3z',
  function: 'M4 18V11l8-6 8 6v7l-8-6z',
  interaction: 'M10 5a7 7 0 0 0 0 14z M14 5a7 7 0 0 1 0 14z',
  event: 'M4 6h10a6 6 0 1 1 0 12H4l4-6z',
  service: 'M8 6h8a6 6 0 1 1 0 12H8A6 6 0 0 1 8 6z',
  object: 'M4 5h16v14H4z M4 9h16',
  contract: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 17h5',
  representation: 'M5 4h14v13c-6 6-8-4-14 1z',
  product: 'M3 7h18v12H3z M3 7V4h8v3',
  component: 'M7 4h13v16H7v-4m0-3v-2m0-3V4 M3 8h8v3H3z M3 13h8v3H3z',
  node: 'M3 8l5-4h13v12l-5 4H3z M3 8h13v12 M16 8l5-4',
  device: 'M5 4h14v12H5z M5 16l-2 4h18l-2-4',
  software: 'M8 6a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M16 8a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  path: 'M3 8h18m-18 8h18M6 6v12m12-12v12',
  network: 'M4 12h16m-12 0V6m8 6v6 M3 10h3v4H3z M18 10h3v4h-3z M7 3h3v3H7z M14 18h3v3h-3z',
  artifact: 'M5 3h9l5 5v13H5z M14 3v5h5 M8 13h8 M8 17h5',
  equipment: 'M4 5h16v14H4z M7 15v-3l3 3 4-5 3 2',
  facility: 'M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6',
  distribution: 'M3 7h18m-18 10h18M6 4v6m6 4v6m6-16v6',
  material: 'M12 3l8 4v10l-8 4-8-4V7z M4 7l8 4 8-4 M12 11v10',
  resource: 'M4 7h14v10H4z M18 10h2v4h-2 M7 10v4m3-4v4m3-4v4',
  capability: 'M3 20v-5h6V9h6V3h6v17z M9 15h12 M15 9h6 M9 15v5 M15 9v11',
  'value-stream': 'M3 6h9l9 6-9 6H3l8-6z',
  course: 'M16 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M16 7h.01 M4 20l7-8m-1 5 1-5-5 1',
  stakeholder: 'M7 5h10c5 0 5 14 0 14H7c-5 0-5-14 0-14z M17 5c-5 0-5 14 0 14',
  driver: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M12 2v20M2 12h20M5 5l14 14M19 5 5 19',
  assessment: 'M14 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12z M9 15l-5 5',
  goal: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 12h.01',
  outcome: 'M15 5a8 8 0 1 0 4 5 M13 9a4 4 0 1 0 2 4 M12 12l8-8m-4 0h4v4',
  principle: 'M5 5h14v14H5z M12 8v5m0 3h.01',
  requirement: 'M7 6h14l-4 12H3z',
  constraint: 'M7 6h14l-4 12H3z M11 6 7 18',
  meaning: 'M5 14a3 3 0 0 1 0-6 4 4 0 0 1 6-2 4 4 0 0 1 6 1 4 4 0 0 1 1 8H8l-4 4z',
  value: 'M12 6c11 0 11 12 0 12S1 6 12 6z',
  work: 'M12 18a7 7 0 1 1 5-3m-5 3h9m-4-4 4 4-4 3',
  deliverable: 'M4 5h16v12q-4-4-8 0t-8 0z',
  plateau: 'M8 5h12m-14 7h12m-14 7h12',
  gap: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M3 10h18m-18 4h18',
  group: 'M3 6h7l2 3h9v10H3z',
  location: 'M12 21s-6-6-6-11a6 6 0 1 1 12 0c0 5-6 11-6 11z M12 10h.01',
} as const;
type Icon = keyof typeof icons;
type Element = [id: string, title: string, icon: Icon, behavior?: true];
const elements: Record<Layer, Element[]> = {
  business: [
    ['business-actor', 'Бизнес-актор', 'actor'], ['business-role', 'Бизнес-роль', 'role'],
    ['business-collaboration', 'Бизнес-сотрудничество', 'collaboration'], ['business-interface', 'Бизнес-интерфейс', 'interface'],
    ['business-process', 'Бизнес-процесс', 'process', true], ['business-function', 'Бизнес-функция', 'function', true],
    ['business-interaction', 'Бизнес-взаимодействие', 'interaction', true], ['business-event', 'Бизнес-событие', 'event', true],
    ['business-service', 'Бизнес-сервис', 'service', true], ['business-object', 'Бизнес-объект', 'object'],
    ['contract', 'Договор', 'contract'], ['representation', 'Представление', 'representation'], ['product', 'Продукт', 'product'],
  ],
  application: [
    ['application-component', 'Компонент приложения', 'component'], ['application-collaboration', 'Сотрудничество приложений', 'collaboration'],
    ['application-interface', 'Интерфейс приложения', 'interface'], ['application-process', 'Процесс приложения', 'process', true],
    ['application-function', 'Функция приложения', 'function', true], ['application-interaction', 'Взаимодействие приложений', 'interaction', true],
    ['application-event', 'Событие приложения', 'event', true], ['application-service', 'Сервис приложения', 'service', true],
    ['data-object', 'Объект данных', 'object'],
  ],
  technology: [
    ['node', 'Узел', 'node'], ['device', 'Устройство', 'device'], ['system-software', 'Системное ПО', 'software'],
    ['technology-collaboration', 'Технологическое сотрудничество', 'collaboration'], ['technology-interface', 'Технологический интерфейс', 'interface'],
    ['path', 'Путь', 'path'], ['communication-network', 'Сеть связи', 'network'], ['technology-process', 'Технологический процесс', 'process', true],
    ['technology-function', 'Технологическая функция', 'function', true], ['technology-interaction', 'Технологическое взаимодействие', 'interaction', true],
    ['technology-event', 'Технологическое событие', 'event', true], ['technology-service', 'Технологический сервис', 'service', true], ['artifact', 'Артефакт', 'artifact'],
  ],
  physical: [
    ['equipment', 'Оборудование', 'equipment'], ['facility', 'Сооружение', 'facility'],
    ['distribution-network', 'Распределительная сеть', 'distribution'], ['material', 'Материал', 'material'],
  ],
  strategy: [
    ['resource', 'Ресурс', 'resource'], ['capability', 'Способность', 'capability', true],
    ['value-stream', 'Поток создания ценности', 'value-stream', true], ['course-of-action', 'Курс действий', 'course', true],
  ],
  motivation: [
    ['stakeholder', 'Заинтересованная сторона', 'stakeholder'], ['driver', 'Драйвер', 'driver'], ['assessment', 'Оценка', 'assessment'],
    ['goal', 'Цель', 'goal'], ['outcome', 'Результат', 'outcome'], ['principle', 'Принцип', 'principle'],
    ['requirement', 'Требование', 'requirement'], ['constraint', 'Ограничение', 'constraint'], ['meaning', 'Смысл', 'meaning'], ['value', 'Ценность', 'value'],
  ],
  migration: [
    ['work-package', 'Пакет работ', 'work', true], ['deliverable', 'Результат поставки', 'deliverable'],
    ['implementation-event', 'Событие внедрения', 'event', true], ['plateau', 'Плато', 'plateau'], ['gap', 'Разрыв', 'gap'],
  ],
  common: [['grouping', 'Группировка', 'group'], ['location', 'Местоположение', 'location']],
};

export const archimateSymbols: DiagramSymbol[] = (Object.keys(layers) as Layer[]).flatMap(layer => {
  const { title: group, fill, stroke } = layers[layer];
  return elements[layer].map(([type, title, icon, behavior]): DiagramSymbol => ({
    type, title, group, width: 160, height: 64,
    shape: layer === 'motivation' ? 'chamfered-rectangle' : behavior ? 'rounded-rectangle' : 'rectangle',
    appearance: { fill: type === 'location' ? '#f4e6f0' : fill, stroke: type === 'location' ? '#805675' : stroke,
      icon, labelInside: true, emptyLabel: title, textColor: '#18212b', ...(type === 'grouping' ? { outlineDash: '5 3' } : {}) },
  }));
});
for (const [type, title, fill] of [['and-junction', 'Соединитель И (AND)', '#424858'], ['or-junction', 'Соединитель ИЛИ (OR)', '#fff']]) {
  archimateSymbols.push({ type, title, group: layers.common.title, width: 40, height: 40, shape: 'circle', singleConnectionPortPerSide: true, appearance: { fill, stroke: '#424858' } });
}

export const archimateConnections: NonNullable<DiagramNotation['connectionTypes']> = [
  { id: 'association', title: 'Ассоциация', appearance: { arrowEnd: false } },
  { id: 'directed-association', title: 'Направленная ассоциация', appearance: { arrowEnd: true, arrowStyle: 'half-open' } },
  { id: 'composition', title: 'Композиция', appearance: { startMarker: 'diamond-filled', arrowEnd: false } },
  { id: 'aggregation', title: 'Агрегация', appearance: { startMarker: 'diamond', arrowEnd: false } },
  { id: 'assignment', title: 'Назначение', appearance: { startMarker: 'circle-filled', arrowEnd: true, arrowStyle: 'filled' } },
  { id: 'realization', title: 'Реализация', appearance: { lineStyle: 'dotted', arrowEnd: true, arrowStyle: 'triangle' } },
  { id: 'serving', title: 'Обслуживание', appearance: { arrowEnd: true, arrowStyle: 'open' } },
  { id: 'access', title: 'Доступ', appearance: { lineStyle: 'dotted', arrowEnd: false } },
  { id: 'access-read', title: 'Доступ: чтение', appearance: { lineStyle: 'dotted', arrowStart: true, arrowEnd: false } },
  { id: 'access-write', title: 'Доступ: запись', appearance: { lineStyle: 'dotted', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'access-read-write', title: 'Доступ: чтение и запись', appearance: { lineStyle: 'dotted', arrowStart: true, arrowEnd: true, arrowStyle: 'open' } },
  { id: 'influence', title: 'Влияние', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'triggering', title: 'Инициация', appearance: { arrowEnd: true, arrowStyle: 'filled' } },
  { id: 'flow', title: 'Поток', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'filled' } },
  { id: 'specialization', title: 'Специализация', appearance: { arrowEnd: true, arrowStyle: 'triangle' } },
];

const graph = createGraphNotation({
  id: 'archimate', title: 'ArchiMate', fileExtension: 'archimate.json',
  symbols: archimateSymbols, connectionTypes: archimateConnections,
  defaultLabel: symbol => symbol.type.endsWith('-junction') ? '' : symbol.title,
  canConnect: () => true, // Проверка метамодели намеренно не включена.
  defaultConnection: () => 'association',
});

export const archimateNotation = {
  ...graph,
  fileAccept: '.json',
  automaticConnectionType: 'association',
  paletteViews: [
    ...(['business', 'application', 'technology', 'physical', 'strategy', 'motivation', 'migration'] as const).map(layer => ({
      id: layer, title: layers[layer].title, groups: [layers[layer].title, layers.common.title],
    })),
    { id: 'layered', title: 'Межслойная архитектура', groups: (['business', 'application', 'technology', 'physical', 'common'] as const).map(layer => layers[layer].title) },
    { id: 'roadmap', title: 'Дорожная карта изменений', groups: (['strategy', 'motivation', 'migration', 'common'] as const).map(layer => layers[layer].title) },
  ],
  renderSymbolDetail: (symbol: DiagramSymbol) => {
    const path = icons[symbol.appearance?.icon as Icon];
    return path ? createElement('path', { d: path, fill: 'none', stroke: symbol.appearance?.textColor, strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round' }) : null;
  },
} satisfies DiagramNotation & { createEmpty: () => string };
