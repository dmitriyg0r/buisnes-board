import { BPMN_EVENT_NS, bpmnEventSymbols, createBpmnEvent, inspectBpmnEvent, type EventContext, type EventDefinitionInput } from '../src/modeling/bpmnEvents';

export function runBpmnEventTests() {
  let count = 0;
  const assert = (condition: unknown, message: string) => { count++; if (!condition) throw new Error(message); };
  const throws = (action: () => unknown, message: string) => { let caught = false; try { action(); } catch { caught = true; } assert(caught, message); };
  const doc = new DOMParser().parseFromString(`<b:definitions xmlns:b="${BPMN_EVENT_NS}"/>`, 'application/xml');
  const serial = new XMLSerializer();
  for (const symbol of bpmnEventSymbols) {
    const context = symbol.contexts[0];
    const definitions: EventDefinitionInput[] | undefined = symbol.marker === 'multiple' ? [{ kind: 'message' }, { kind: 'signal' }] : symbol.marker === 'conditional' ? [{ kind: 'conditional', condition: 'x > 1' }] : symbol.marker === 'link' ? [{ kind: 'link', linkName: 'A' }] : undefined;
    const event = createBpmnEvent(doc, symbol.key, context, { id: 'event', definitions });
    const xml = serial.serializeToString(event);
    const parsed = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
    const inspected = inspectBpmnEvent(parsed, context);
    assert(inspected.editable && inspected.symbol?.key === symbol.key, `Не прошёл round-trip ${symbol.key}`);
    assert(serial.serializeToString(parsed) === xml, `Изменён XML ${symbol.key}`);
  }
  const xmlEvent = (xml: string) => new DOMParser().parseFromString(`<b:startEvent xmlns:b="${BPMN_EVENT_NS}" id="x">${xml}</b:startEvent>`, 'application/xml').documentElement;
  for (const fragment of ['<b:eventDefinitionRef>foo</b:eventDefinitionRef>', '<b:messageEventDefinition messageRef="m"/>', '<b:timerEventDefinition><b:timeDuration>PT5M</b:timeDuration></b:timerEventDefinition>', '<b:messageEventDefinition/><b:messageEventDefinition/>', '<b:conditionalEventDefinition/>', '<b:unknownEventDefinition/>']) {
    const event = xmlEvent(fragment); const before = serial.serializeToString(event);
    assert(!inspectBpmnEvent(event, 'process').editable, `Не отклонено: ${fragment}`);
    assert(serial.serializeToString(event) === before, 'Инспекция изменила исходный XML');
  }
  const parallel = xmlEvent('<b:messageEventDefinition/><b:signalEventDefinition/>'); parallel.setAttribute('parallelMultiple', 'true');
  assert(!inspectBpmnEvent(parallel, 'process').editable, 'Параллельное событие должно быть только для чтения');
  throws(() => createBpmnEvent(doc, 'startEvent:error', 'process', { id: 'x' }), 'Ошибка недопустима на старте процесса');
  throws(() => createBpmnEvent(doc, 'endEvent:cancel', 'process', { id: 'x' }), 'Отмена допустима только в транзакции');
  throws(() => createBpmnEvent(doc, 'startEvent:multiple', 'process', { id: 'x' }), 'Multiple требует определения');
  throws(() => createBpmnEvent(doc, 'startEvent:conditional', 'process', { id: 'x' }), 'Требуется условие');
  throws(() => createBpmnEvent(doc, 'intermediateCatchEvent:link', 'process', { id: 'x' }), 'Требуется имя link');
  const contexts: EventContext[] = ['process', 'eventSubprocess', 'transaction'];
  for (const symbol of bpmnEventSymbols.filter((item) => item.marker === 'none')) for (const context of contexts.filter((value) => !symbol.contexts.includes(value))) throws(() => createBpmnEvent(doc, symbol.key, context, { id: 'x' }), 'Недопустимый контекст');
  return count;
}
