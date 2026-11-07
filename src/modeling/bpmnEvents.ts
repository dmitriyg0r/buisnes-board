/** События BPMN: XML остаётся источником данных; ключ символа не является именем XML-тега. */
export const BPMN_EVENT_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
export type EventKind = 'startEvent' | 'intermediateCatchEvent' | 'intermediateThrowEvent' | 'endEvent';
export type EventDefinitionKind = 'message' | 'timer' | 'signal' | 'error' | 'escalation' | 'conditional' | 'link' | 'cancel' | 'compensate' | 'terminate';
export type EventMarker = EventDefinitionKind | 'none' | 'multiple';
export type EventSymbolKey = `${EventKind}:${EventMarker}`;
export type EventContext = 'process' | 'eventSubprocess' | 'transaction';
export interface EventSymbol {
  key: EventSymbolKey;
  type: EventKind;
  marker: EventMarker;
  outline: 'single' | 'double' | 'thick';
  filled: boolean;
  contexts: readonly EventContext[];
}

const normal = ['process', 'eventSubprocess', 'transaction'] as const;
const eventSubprocess = ['eventSubprocess'] as const;
const transaction = ['transaction'] as const;
const definitions: Record<EventDefinitionKind, string> = {
  message: 'messageEventDefinition', timer: 'timerEventDefinition', signal: 'signalEventDefinition',
  error: 'errorEventDefinition', escalation: 'escalationEventDefinition', conditional: 'conditionalEventDefinition',
  link: 'linkEventDefinition', cancel: 'cancelEventDefinition', compensate: 'compensateEventDefinition', terminate: 'terminateEventDefinition',
};
const rows: Array<[EventKind, EventMarker, readonly EventContext[]]> = [
  ['startEvent', 'none', ['process', 'transaction']],
  ...(['message', 'timer', 'signal', 'conditional', 'multiple'] as const).map((m): [EventKind, EventMarker, readonly EventContext[]] => ['startEvent', m, normal]),
  ...(['error', 'escalation', 'compensate'] as const).map((m): [EventKind, EventMarker, readonly EventContext[]] => ['startEvent', m, eventSubprocess]),
  ...(['message', 'timer', 'signal', 'conditional', 'link', 'multiple'] as const).map((m): [EventKind, EventMarker, readonly EventContext[]] => ['intermediateCatchEvent', m, normal]),
  ...(['none', 'message', 'signal', 'escalation', 'link', 'compensate', 'multiple'] as const).map((m): [EventKind, EventMarker, readonly EventContext[]] => ['intermediateThrowEvent', m, normal]),
  ...(['none', 'message', 'signal', 'error', 'escalation', 'compensate', 'terminate', 'multiple'] as const).map((m): [EventKind, EventMarker, readonly EventContext[]] => ['endEvent', m, normal]),
  ['endEvent', 'cancel', transaction],
];
export const bpmnEventSymbols: readonly EventSymbol[] = rows.map(([type, marker, contexts]) => ({
  key: `${type}:${marker}`, type, marker, contexts,
  outline: type === 'startEvent' ? 'single' : type === 'endEvent' ? 'thick' : 'double',
  filled: type === 'endEvent' || type === 'intermediateThrowEvent',
}));
export function eventSymbol(key: string): EventSymbol | undefined { return bpmnEventSymbols.find((item) => item.key === key); }

export interface EventInspection { symbol?: EventSymbol; editable: boolean; reason?: string; definitions: readonly EventDefinitionKind[] }
const fail = (reason: string, found: EventDefinitionKind[] = []): EventInspection => ({ editable: false, reason, definitions: found });
const children = (el: Element) => Array.from(el.children);
const xmlNamespace = 'http://www.w3.org/2000/xmlns/';

const allowedAttrs = (el: Element, allowed: string[]) => Array.from(el.attributes).every((a) => a.namespaceURI === xmlNamespace || (!a.namespaceURI && allowed.includes(a.localName)));

/** Проверяет только локальное событие. Проверки всего документа, ссылок и DI остаются за адаптером. */
export function inspectBpmnEvent(event: Element, context: EventContext): EventInspection {
  if (event.namespaceURI !== BPMN_EVENT_NS || !['startEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'endEvent'].includes(event.localName)) return fail('Неизвестный тип события.');
  const type = event.localName as EventKind;
  if (!allowedAttrs(event, ['id', 'name', ...(type === 'startEvent' ? ['isInterrupting', 'parallelMultiple'] : type === 'intermediateCatchEvent' ? ['parallelMultiple'] : [])])) return fail('Атрибут события не поддерживается.');
  if (event.hasAttribute('parallelMultiple') && !['false', '0'].includes(event.getAttribute('parallelMultiple')!)) return fail('Параллельное множественное событие не поддерживается.');
  if (type === 'startEvent' && event.hasAttribute('isInterrupting') && !['true', '1'].includes(event.getAttribute('isInterrupting')!)) return fail('Непрерывающее начальное событие не поддерживается.');
  const found: EventDefinitionKind[] = [];
  for (const child of children(event)) {
    if (child.namespaceURI !== BPMN_EVENT_NS) return fail('Расширение события не поддерживается.', found);
    if (['incoming', 'outgoing'].includes(child.localName)) continue;
    const entry = (Object.entries(definitions) as Array<[EventDefinitionKind, string]>).find(([, name]) => name === child.localName);
    if (!entry) return fail('Содержимое или ссылка на определение события не поддерживается.', found);
    const kind = entry[0]; found.push(kind);
    // Ссылки и сложные выражения не теряются: их исходный XML доступен только для чтения.
    const permitted = kind === 'link' ? ['id', 'name'] : ['id'];
    if (!allowedAttrs(child, permitted)) return fail('Атрибут определения события не поддерживается.', found);
    if (kind === 'link' && !child.getAttribute('name')?.trim()) return fail('У linkEventDefinition отсутствует имя.', found);
    const nested = children(child);
    if (kind === 'conditional') {
      if (nested.length !== 1 || nested[0].namespaceURI !== BPMN_EVENT_NS || nested[0].localName !== 'condition' || children(nested[0]).length || !allowedAttrs(nested[0], [])) return fail('Условие события не поддерживается.', found);
    } else if (nested.length) return fail('Содержимое определения события не поддерживается.', found);
    if (Array.from(child.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim())) return fail('Неожиданный текст определения события.', found);
  }
  if (new Set(found).size !== found.length) return fail('Повторяющиеся определения события не поддерживаются.', found);
  if (found.length > 1 && found.includes('link')) return fail('Link в составе множественного события не поддерживается.', found);
  const marker: EventMarker = found.length > 1 ? 'multiple' : found[0] ?? 'none';
  const symbol = eventSymbol(`${type}:${marker}`);
  if (!symbol || !symbol.contexts.includes(context)) return fail('Тип события недопустим в данном контексте.', found);
  if (found.length > 1 && found.some((kind) => !eventSymbol(`${type}:${kind}`)?.contexts.includes(context))) return fail('Состав множественного события недопустим в данном контексте.', found);
  return { symbol, editable: true, definitions: found };
}

export interface EventDefinitionInput { kind: EventDefinitionKind; condition?: string; linkName?: string }
/** Создаёт только новое событие; существующее событие и его определения не перезаписываются. */
export function createBpmnEvent(doc: Document, key: EventSymbolKey, context: EventContext, options: { id: string; name?: string; definitions?: readonly EventDefinitionInput[] }): Element {
  const symbol = eventSymbol(key);
  if (!symbol || !symbol.contexts.includes(context)) throw new Error('Недопустимый символ события или контекст.');
  if (!options.id || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(options.id)) throw new Error('Некорректный идентификатор события.');
  if (Array.from(doc.getElementsByTagName('*')).some((item) => item.getAttribute('id') === options.id)) throw new Error('Идентификатор уже используется.');
  const inputs = options.definitions ?? (symbol.marker === 'none' ? [] : symbol.marker === 'multiple' ? [] : [{ kind: symbol.marker }]);
  if ((symbol.marker === 'none' && inputs.length !== 0) || (symbol.marker === 'multiple' && inputs.length < 2) || (symbol.marker !== 'none' && symbol.marker !== 'multiple' && (inputs.length !== 1 || inputs[0].kind !== symbol.marker))) throw new Error('Определения не соответствуют символу события.');
  if (new Set(inputs.map((input) => input.kind)).size !== inputs.length) throw new Error('Повторяющиеся определения события не поддерживаются.');
  if (inputs.length > 1 && inputs.some((input) => input.kind === 'link')) throw new Error('Link в составе множественного события не поддерживается.');
  const event = doc.createElementNS(BPMN_EVENT_NS, 'bpmn:' + symbol.type);
  event.setAttribute('id', options.id);
  if (options.name !== undefined) event.setAttribute('name', options.name);
  for (const input of inputs) {
    if (!definitions[input.kind] || !eventSymbol(`${symbol.type}:${input.kind}`)?.contexts.includes(context)) throw new Error('Недопустимое определение события.');
    if ((input.condition !== undefined && input.kind !== 'conditional') || (input.linkName !== undefined && input.kind !== 'link')) throw new Error('Параметры не соответствуют определению.');
    const definition = doc.createElementNS(BPMN_EVENT_NS, 'bpmn:' + definitions[input.kind]);
    if (input.kind === 'conditional') {
      if (input.condition === undefined) throw new Error('Для события условия необходимо выражение.');
      const condition = doc.createElementNS(BPMN_EVENT_NS, 'bpmn:condition'); condition.textContent = input.condition; definition.appendChild(condition);
    }
    if (input.kind === 'link') {
      if (!input.linkName?.trim()) throw new Error('Для события-ссылки необходимо имя.');
      definition.setAttribute('name', input.linkName);
    }
    event.appendChild(definition);
  }
  return event;
}

/** Имена известных элементов для общей проверки адаптера, не разрешение на их изменение. */
export const bpmnEventElementNames = [...Object.values(definitions), 'condition'] as readonly string[];
export function isBpmnEventDefinitionElement(element: Element): boolean { return element.namespaceURI === BPMN_EVENT_NS && Object.values(definitions).includes(element.localName); }
