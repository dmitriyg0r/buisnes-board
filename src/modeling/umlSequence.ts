import type { Diagram, DiagramNotation, DiagramPoint } from './types';

/** Собственный формат, не являющийся XMI. Порядок массивов значим. */
export interface SequenceLifeline {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  endY: number;
}
export type SequenceMessageKind = 'sync' | 'async' | 'reply' | 'self';
export interface SequenceMessage {
  id: string;
  label: string;
  kind: SequenceMessageKind;
  send: { lifelineId: string; y: number };
  receive: { lifelineId: string; y: number };
}
export interface SequenceDocument {
  format: 'uml-sequence';
  version: 1;
  lifelines: SequenceLifeline[];
  messages: SequenceMessage[];
}

const kinds: SequenceMessageKind[] = ['sync', 'async', 'reply', 'self'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key)) && keys.every(key => key in value);
const text = (value: unknown): value is string => typeof value === 'string';
const id = (value: unknown): value is string => text(value) && value.trim().length > 0;
const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const fail = (message: string): never => { throw new Error(message); };

/** Строгая проверка предотвращает потерю неизвестных данных при изменениях. */
export function parseSequence(source: string): SequenceDocument {
  let value: unknown;
  try { value = JSON.parse(source); } catch { return fail('Некорректный JSON диаграммы последовательности.'); }
  if (!record(value) || !exact(value, ['format', 'version', 'lifelines', 'messages']) || value.format !== 'uml-sequence' || value.version !== 1 || !Array.isArray(value.lifelines) || !Array.isArray(value.messages)) return fail('Неподдерживаемый формат или версия диаграммы последовательности.');
  const ids = new Set<string>();
  const lifelines: SequenceLifeline[] = [];
  for (const item of value.lifelines) {
    if (!record(item) || !exact(item, ['id', 'label', 'x', 'y', 'width', 'height', 'endY']) || !id(item.id) || !text(item.label) || !num(item.x) || !num(item.y) || !num(item.width) || !num(item.height) || !num(item.endY) || item.width <= 0 || item.height <= 0 || item.endY <= item.y + item.height || ids.has(item.id)) return fail('Некорректная линия жизни или повтор идентификатора.');
    const previous = lifelines[lifelines.length - 1];
    if (previous && item.x + item.width / 2 <= previous.x + previous.width / 2) return fail('Порядок линий жизни должен соответствовать их положению слева направо.');
    ids.add(item.id);
    lifelines.push(item as unknown as SequenceLifeline);
  }
  const byId = new Map(lifelines.map(item => [item.id, item]));
  const messages: SequenceMessage[] = [];
  for (const item of value.messages) {
    if (!record(item) || !exact(item, ['id', 'label', 'kind', 'send', 'receive']) || !id(item.id) || ids.has(item.id) || !text(item.label) || !text(item.kind) || !kinds.includes(item.kind as SequenceMessageKind) || !record(item.send) || !record(item.receive) || !exact(item.send, ['lifelineId', 'y']) || !exact(item.receive, ['lifelineId', 'y']) || !id(item.send.lifelineId) || !id(item.receive.lifelineId) || !num(item.send.y) || !num(item.receive.y)) return fail('Некорректное сообщение или повтор идентификатора.');
    const from = byId.get(item.send.lifelineId), to = byId.get(item.receive.lifelineId);
    if (!from || !to) return fail('Сообщение ссылается на отсутствующую линию жизни.');
    if (item.send.y < from.y + from.height || item.send.y > from.endY || item.receive.y < to.y + to.height || item.receive.y > to.endY) return fail('Точка сообщения находится вне линии жизни.');
    const self = from.id === to.id;
    if (self !== (item.kind === 'self') || (self ? item.receive.y <= item.send.y : item.receive.y !== item.send.y)) return fail('Некорректная геометрия или тип сообщения.');
    if (messages.length && item.send.y < messages[messages.length - 1].send.y) return fail('Порядок сообщений должен соответствовать времени отправки.');
    ids.add(item.id);
    messages.push(item as unknown as SequenceMessage);
  }
  return { format: 'uml-sequence', version: 1, lifelines, messages };
}

export function serializeSequence(document: SequenceDocument): string {
  const source = JSON.stringify(document, null, 2);
  parseSequence(source);
  return source;
}
export function createSequence(): string {
  return serializeSequence({ format: 'uml-sequence', version: 1, lifelines: [], messages: [] });
}
function mutate(source: string, action: (document: SequenceDocument) => void): string {
  const document = parseSequence(source);
  action(document);
  return serializeSequence(document);
}
function nextId(document: SequenceDocument, prefix: string): string {
  const ids = new Set([...document.lifelines, ...document.messages].map(item => item.id));
  if (!globalThis.crypto?.randomUUID) return fail('Недоступен безопасный генератор идентификаторов.');
  let candidate: string;
  do { candidate = `${prefix}_${globalThis.crypto.randomUUID()}`; } while (ids.has(candidate));
  return candidate;
}
export function addSequenceLifeline(source: string, at: DiagramPoint): string {
  return mutate(source, document => {
    const item: SequenceLifeline = { id: nextId(document, 'lifeline'), label: 'Участник', x: at.x, y: at.y, width: 140, height: 50, endY: at.y + 450 };
    document.lifelines.push(item);
    document.lifelines.sort((a, b) => a.x + a.width / 2 - b.x - b.width / 2);
  });
}
/** Новое сообщение может продлить линии жизни, но не попасть в заголовок. Импорт остаётся строгим. */
function extendLifelines(document: SequenceDocument, message: SequenceMessage | Omit<SequenceMessage, 'id'>) {
  for (const point of [message.send, message.receive]) {
    const line = document.lifelines.find(l => l.id === point.lifelineId) ?? fail('Линия жизни не найдена.');
    if (!num(point.y) || point.y < line.y + line.height) fail(`Сообщение должно находиться ниже заголовка участника: y >= ${line.y + line.height}.`);
    if (point.y > line.endY) line.endY = point.y + 80;
  }
}
export function addSequenceMessage(source: string, message: Omit<SequenceMessage, 'id'>): string {
  return mutate(source, document => {
    extendLifelines(document, message);
    document.messages.push({ ...message, send: { ...message.send }, receive: { ...message.receive }, id: nextId(document, 'message') });
    document.messages.sort((a, b) => a.send.y - b.send.y);
  });
}
/** Перемещение сообщения меняет порядок только при пересечении других отправок. */
export function moveSequenceMessage(source: string, messageId: string, sendY: number, receiveY: number): string {
  return mutate(source, document => {
    const item = document.messages.find(message => message.id === messageId) ?? fail('Сообщение не найдено.');
    item.send.y = sendY; item.receive.y = receiveY;
    extendLifelines(document, item);
    document.messages.sort((a, b) => a.send.y - b.send.y);
  });
}
export function moveSequenceLifeline(source: string, lifelineId: string, at: DiagramPoint): string {
  return mutate(source, document => {
    const item = document.lifelines.find(line => line.id === lifelineId) ?? fail('Линия жизни не найдена.');
    // Временные точки остаются на месте; нижний край не должен их обрезать.
    const endpoints = document.messages.flatMap(message => [message.send, message.receive]).filter(point => point.lifelineId === lifelineId);
    if (endpoints.some(point => point.y < at.y + item.height)) fail('Нельзя переместить участника ниже его сообщений.');
    item.endY = Math.max(item.endY + at.y - item.y, ...endpoints.map(point => point.y));
    item.x = at.x; item.y = at.y;
    document.lifelines.sort((a, b) => a.x + a.width / 2 - b.x - b.width / 2);
  });
}
/** Изменение размера головы не меняет время сообщений и конец линии жизни. */
export function resizeSequenceLifeline(source: string, lifelineId: string, width: number, height: number): string {
  return mutate(source, document => {
    const item = document.lifelines.find(line => line.id === lifelineId) ?? fail('Линия жизни не найдена.');
    if (!num(width) || !num(height) || width <= 0 || height <= 0) fail('Размеры участника должны быть положительными числами.');
    if (document.messages.some(message => [message.send, message.receive].some(point => point.lifelineId === lifelineId && point.y < item.y + height))) fail('Голова участника не должна перекрывать сообщения.');
    item.width = width; item.height = height;
    document.lifelines.sort((a, b) => a.x + a.width / 2 - b.x - b.width / 2);
  });
}

/** Атомарное изменение свойств сообщения с проверкой геометрии и ссылок. */
export function editSequenceMessage(source: string, messageId: string, changes: Partial<Omit<SequenceMessage, 'id'>>): string {
  return mutate(source, document => {
    const index = document.messages.findIndex(message => message.id === messageId);
    if (index < 0) return fail('Сообщение не найдено.');
    document.messages[index] = { ...document.messages[index], ...changes };
    extendLifelines(document, document.messages[index]);
    document.messages.sort((a, b) => a.send.y - b.send.y);
  });
}
export function renameSequenceElement(source: string, elementId: string, label: string): string {
  return mutate(source, document => { const item = [...document.lifelines, ...document.messages].find(entry => entry.id === elementId) ?? fail('Элемент не найден.'); item.label = label; });
}
export function removeSequenceElement(source: string, elementId: string): string {
  return mutate(source, document => {
    if (document.lifelines.some(line => line.id === elementId)) {
      document.lifelines = document.lifelines.filter(line => line.id !== elementId);
      document.messages = document.messages.filter(message => message.send.lifelineId !== elementId && message.receive.lifelineId !== elementId);
    } else if (document.messages.some(message => message.id === elementId)) document.messages = document.messages.filter(message => message.id !== elementId);
    else fail('Элемент не найден.');
  });
}

/** Отдельная проекция для специализированного рендерера: время не является узлом графа. */
export function projectSequence(document: SequenceDocument) {
  const validated = parseSequence(serializeSequence(document));
  const lines = new Map(validated.lifelines.map(line => [line.id, line]));
  return {
    lifelines: validated.lifelines.map(line => ({ ...line, lineStart: { x: line.x + line.width / 2, y: line.y + line.height }, lineEnd: { x: line.x + line.width / 2, y: line.endY } })),
    messages: validated.messages.map(message => {
      const from = lines.get(message.send.lifelineId)!, to = lines.get(message.receive.lifelineId)!;
      const a = { x: from.x + from.width / 2, y: message.send.y }, b = { x: to.x + to.width / 2, y: message.receive.y };
      return { ...message, points: message.kind === 'self' ? [a, { x: a.x + 40, y: a.y }, { x: a.x + 40, y: b.y }, b] : [a, b], lineStyle: message.kind === 'reply' ? 'dashed' as const : 'solid' as const, arrowStyle: message.kind === 'sync' || message.kind === 'self' ? 'filled' as const : 'open' as const };
    }),
  };
}

const unavailable = (): never => fail('Сообщения создаются на линиях жизни, а не как связи графа.');
/** Сообщения остаются временными точками и не попадают в граф связей. */
export const umlSequenceNotation: DiagramNotation & { createEmpty: () => string } = {
  id: 'uml-sequence', title: 'UML Sequence', fileExtension: 'sequence.json', fileAccept: '.sequence.json,application/json', mimeType: 'application/json',
  createEmpty: createSequence,
  timeline: {
    project: source => projectSequence(parseSequence(source)),
    addMessage: (source, from, to, y, type) => {
      if (type !== undefined && type !== 'sync' && type !== 'async' && type !== 'reply') return fail('Неизвестный тип сообщения.');
      if (from === to && type && type !== 'sync') return fail('Сообщение себе поддерживается только как синхронный вызов.');
      return addSequenceMessage(source, { label: '', kind: from === to ? 'self' : type ?? 'sync', send: { lifelineId: from, y }, receive: { lifelineId: to, y: from === to ? y + 30 : y } });
    },
    moveMessage: moveSequenceMessage,
    editMessage: (source, id, changes) => {
      const message = parseSequence(source).messages.find(item => item.id === id) ?? fail('Сообщение не найдено.');
      const from = changes.from ?? message.send.lifelineId, to = changes.to ?? message.receive.lifelineId;
      const requested = changes.kind ?? (message.kind === 'self' ? 'sync' : message.kind);
      if (requested !== 'sync' && requested !== 'async' && requested !== 'reply') return fail('Неизвестный тип сообщения.');
      if (from === to && requested !== 'sync') return fail('Сообщение себе поддерживается только как синхронный вызов.');
      return editSequenceMessage(source, id, { kind: from === to ? 'self' : requested, send: { lifelineId: from, y: message.send.y }, receive: { lifelineId: to, y: from === to ? message.send.y + 30 : message.send.y } });
    },
  },
  symbols: [{ type: 'lifeline', title: 'Участник', shape: 'rectangle', width: 140, height: 50 }],
  connectionTypes: [
    { id: 'sync', title: 'Синхронное сообщение', appearance: { arrowStyle: 'filled' } },
    { id: 'async', title: 'Асинхронное сообщение', appearance: { arrowStyle: 'open' } },
    { id: 'reply', title: 'Ответ', appearance: { lineStyle: 'dashed', arrowStyle: 'open' } },
  ],
  read(source) {
    const document = parseSequence(source);
    const diagram: Diagram = { nodes: document.lifelines.map(line => ({ id: line.id, type: 'lifeline', label: line.label, x: line.x, y: line.y, width: line.width, height: line.height })), edges: [] };
    return { diagram };
  },
  addNode: (source, type, at) => type === 'lifeline' ? addSequenceLifeline(source, at) : fail('Неизвестный элемент.'),
  moveNode: moveSequenceLifeline, resizeNode: resizeSequenceLifeline, rename: renameSequenceElement, remove: removeSequenceElement,
  connect: unavailable, editEdge: unavailable, resetEdge: unavailable,
};
