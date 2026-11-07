import type { DiagramSymbol } from './types';

/** Категории палитры, независимые от структуры документа BPMN. */
export type BpmnSymbolGroup = 'events' | 'tasks' | 'gateways' | 'subprocesses' | 'artifacts';

/** Маркеры описывают изображение, а не дополнительные определения событий. */
export type BpmnMarker =
  | 'none'
  | 'user'
  | 'service'
  | 'manual'
  | 'send'
  | 'receive'
  | 'business-rule'
  | 'script'
  | 'exclusive'
  | 'parallel'
  | 'inclusive'
  | 'complex'
  | 'event-based-exclusive'
  | 'collapsed-subprocess';

/** Контур дополняет общую форму: у конечного события он толстый, а не двойной. */
export type BpmnOutline = 'single' | 'double' | 'thick';

export interface BpmnCatalogSymbol extends DiagramSymbol {
  /** Локальное имя элемента в пространстве имён BPMN MODEL. */
  type: BpmnLocalName;
  group: BpmnSymbolGroup;
  marker: BpmnMarker;
  outline: BpmnOutline;
  /** Для свёрнутого подпроцесса значение задаётся на BPMNShape, не на subProcess. */
  isExpanded?: false;
}

export type BpmnLocalName =
  | 'startEvent' | 'intermediateThrowEvent' | 'endEvent'
  | 'task' | 'userTask' | 'serviceTask' | 'manualTask' | 'sendTask'
  | 'receiveTask' | 'businessRuleTask' | 'scriptTask'
  | 'exclusiveGateway' | 'parallelGateway' | 'inclusiveGateway'
  | 'complexGateway' | 'eventBasedGateway' | 'subProcess' | 'dataObjectReference' | 'dataStoreReference' | 'textAnnotation';

/**
 * События без EventDefinition; промежуточное — none throw в основном потоке.
 * Шлюз по событиям — обычный исключающий, не создающий процесс.
 * Маркер свёрнутого подпроцесса не задаёт его внутреннее содержимое.
 */
export const bpmnCatalog: BpmnCatalogSymbol[] = [
  { type: 'startEvent', title: 'Начальное событие', group: 'events', shape: 'circle', outline: 'single', marker: 'none', width: 36, height: 36 },
  { type: 'intermediateThrowEvent', title: 'Промежуточное событие', group: 'events', shape: 'double-circle', outline: 'double', marker: 'none', width: 36, height: 36 },
  { type: 'endEvent', title: 'Конечное событие', group: 'events', shape: 'circle', outline: 'thick', marker: 'none', width: 36, height: 36 },
  { type: 'task', title: 'Задача', group: 'tasks', shape: 'rounded-rectangle', outline: 'single', marker: 'none', width: 100, height: 80 },
  { type: 'userTask', title: 'Пользовательская задача', group: 'tasks', shape: 'rounded-rectangle', outline: 'single', marker: 'user', width: 100, height: 80 },
  { type: 'serviceTask', title: 'Сервисная задача', group: 'tasks', shape: 'rounded-rectangle', outline: 'single', marker: 'service', width: 100, height: 80 },
  { type: 'manualTask', title: 'Ручная задача', group: 'tasks', shape: 'rounded-rectangle', outline: 'single', marker: 'manual', width: 100, height: 80 },
  { type: 'sendTask', title: 'Задача отправки', group: 'tasks', shape: 'rounded-rectangle', outline: 'single', marker: 'send', width: 100, height: 80 },
  { type: 'receiveTask', title: 'Задача получения', group: 'tasks', shape: 'rounded-rectangle', outline: 'single', marker: 'receive', width: 100, height: 80 },
  { type: 'businessRuleTask', title: 'Задача бизнес-правила', group: 'tasks', shape: 'rounded-rectangle', outline: 'single', marker: 'business-rule', width: 100, height: 80 },
  { type: 'scriptTask', title: 'Задача-сценарий', group: 'tasks', shape: 'rounded-rectangle', outline: 'single', marker: 'script', width: 100, height: 80 },
  { type: 'exclusiveGateway', title: 'Исключающий шлюз', group: 'gateways', shape: 'diamond', outline: 'single', marker: 'exclusive', width: 50, height: 50 },
  { type: 'parallelGateway', title: 'Параллельный шлюз', group: 'gateways', shape: 'diamond', outline: 'single', marker: 'parallel', width: 50, height: 50 },
  { type: 'inclusiveGateway', title: 'Включающий шлюз', group: 'gateways', shape: 'diamond', outline: 'single', marker: 'inclusive', width: 50, height: 50 },
  { type: 'complexGateway', title: 'Сложный шлюз', group: 'gateways', shape: 'diamond', outline: 'single', marker: 'complex', width: 50, height: 50 },
  { type: 'eventBasedGateway', title: 'Шлюз по событиям', group: 'gateways', shape: 'diamond', outline: 'single', marker: 'event-based-exclusive', width: 50, height: 50 },
  { type: 'dataObjectReference', title: 'Объект данных', group: 'artifacts', shape: 'document', outline: 'single', marker: 'none', width: 40, height: 55 },
  { type: 'dataStoreReference', title: 'Хранилище данных', group: 'artifacts', shape: 'data-store', outline: 'single', marker: 'none', width: 50, height: 50 },
  { type: 'textAnnotation', title: 'Текстовая аннотация', group: 'artifacts', shape: 'annotation', outline: 'single', marker: 'none', width: 130, height: 65 },
  { type: 'subProcess', title: 'Свёрнутый подпроцесс', group: 'subprocesses', shape: 'rounded-rectangle', outline: 'single', marker: 'collapsed-subprocess', isExpanded: false, width: 100, height: 80 },
];
