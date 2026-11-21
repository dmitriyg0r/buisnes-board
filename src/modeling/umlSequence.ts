import type { Diagram, DiagramBounds, DiagramNotation, DiagramPoint, DiagramSymbol } from './types';

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
export type SequenceMessageKind = 'sync' | 'async' | 'reply' | 'self' | 'create' | 'delete';
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
  executions?: SequenceExecution[];
  fragments?: SequenceFragment[];
}
export interface SequenceExecution { id: string; lifelineId: string; label: string; startY: number; endY: number }
/** Координата начала операнда относительно верха рамки. Первый операнд начинается с 0. */
export interface SequenceOperand { y: number; guard: string }

const fragmentTitles = {
  alt: 'Альтернатива', opt: 'Условный фрагмент', loop: 'Цикл', par: 'Параллельное выполнение',
  break: 'Прерывание', critical: 'Критическая область', seq: 'Слабое упорядочение', strict: 'Строгое упорядочение',
  assert: 'Утверждение', neg: 'Недопустимое взаимодействие', consider: 'Учитывать сообщения', ignore: 'Игнорировать сообщения',
  ref: 'Ссылка на взаимодействие',
} as const;
export type SequenceFragmentOperator = keyof typeof fragmentTitles;
export type SequenceFragment = DiagramBounds & { id: string; label: string } & (
  | { operator: Exclude<SequenceFragmentOperator, 'ref'>; operands: SequenceOperand[] }
  | { operator: 'ref'; operands?: never }
);

const fragmentOperators = Object.keys(fragmentTitles) as SequenceFragmentOperator[];
const singleOperand = new Set<SequenceFragmentOperator>(['opt', 'loop', 'break', 'assert', 'neg']);
const fragmentSymbols: DiagramSymbol[] = fragmentOperators.map(operator => ({
  type: `fragment-${operator}`, title: fragmentTitles[operator], stereotype: operator,
  shape: 'interaction-frame', container: true, group: 'Фрагменты', width: 300, height: operator === 'ref' ? 90 : 160,
}));

const selectableKinds = ['sync', 'async', 'reply', 'create', 'delete'] as const;
const isSelectableKind = (kind: unknown): kind is typeof selectableKinds[number] => selectableKinds.some(item => item === kind);
const kinds: readonly SequenceMessageKind[] = [...selectableKinds, 'self'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key)) && keys.every(key => key in value);
const text = (value: unknown): value is string => typeof value === 'string';
const id = (value: unknown): value is string => text(value) && value.trim().length > 0;
const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const fail = (message: string): never => { throw new Error(message); };

/** Время создания и уничтожения задаёт сообщение, а не дублирующие поля линии жизни. */
function lifetimeEvents(messages: readonly SequenceMessage[]) {
  const births = new Map<string, number>(), deaths = new Map<string, number>();
  for (const { kind, receive } of messages) {
    const times = kind === 'create' ? births : kind === 'delete' ? deaths : undefined;
    if (!times) continue;
    if (times.has(receive.lifelineId)) fail('У участника может быть не больше одного сообщения создания и одного сообщения уничтожения.');
    times.set(receive.lifelineId, receive.y);
  }
  return { births, deaths };
}

function lifetime(line: SequenceLifeline, { births, deaths }: ReturnType<typeof lifetimeEvents>) {
  const birth = births.get(line.id), death = deaths.get(line.id);
  const y = birth === undefined ? line.y : birth - line.height / 2;
  const start = y + line.height;
  return { birth, death, y, start, end: death ?? (birth === undefined ? line.endY : Math.max(line.endY, start + 80)) };
}

function containsExecution(outer: Pick<SequenceExecution, 'startY' | 'endY'>, inner: Pick<SequenceExecution, 'startY' | 'endY'>) {
  return outer.startY <= inner.startY && inner.endY <= outer.endY && (outer.startY < inner.startY || inner.endY < outer.endY);
}

function validateOperands(operator: Exclude<SequenceFragmentOperator, 'ref'>, operands: unknown, height: number) {
  if (!Array.isArray(operands) || !operands.length || (singleOperand.has(operator) && operands.length !== 1)) return fail('Недопустимое число операндов для оператора фрагмента.');
  let previous = 0;
  for (const [index, operand] of operands.entries()) {
    if (!record(operand) || !exact(operand, ['y', 'guard']) || !text(operand.guard) || !num(operand.y) || (index === 0 ? operand.y !== 0 : operand.y <= previous || operand.y >= height)) return fail('Границы операндов должны начинаться с 0 и строго возрастать внутри рамки; условие должно быть строкой.');
    previous = operand.y;
  }
}

/** Строгая проверка предотвращает потерю неизвестных данных при изменениях. */
export function parseSequence(source: string): SequenceDocument {
  let value: unknown;
  try { value = JSON.parse(source); } catch { return fail('Некорректный JSON диаграммы последовательности.'); }
  if (!record(value) || !exact(value, ['format', 'version', 'lifelines', 'messages', ...['executions', 'fragments'].filter(key => key in value)]) || value.format !== 'uml-sequence' || value.version !== 1 || !Array.isArray(value.lifelines) || !Array.isArray(value.messages) || ('executions' in value && !Array.isArray(value.executions)) || ('fragments' in value && !Array.isArray(value.fragments))) return fail('Неподдерживаемый формат или версия диаграммы последовательности.');
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
    const self = from.id === to.id;
    if (self !== (item.kind === 'self') || (self ? item.receive.y <= item.send.y : item.receive.y !== item.send.y)) return fail('Некорректная геометрия или тип сообщения.');
    if (messages.length && item.send.y < messages[messages.length - 1].send.y) return fail('Порядок сообщений должен соответствовать времени отправки.');
    ids.add(item.id);
    messages.push(item as unknown as SequenceMessage);
  }
  const events = lifetimeEvents(messages);
  const lifetimes = new Map(lifelines.map(line => {
    const life = lifetime(line, events);
    if (life.y < line.y || life.end <= life.start) fail('Создание или уничтожение находится вне допустимого диапазона линии жизни.');
    return [line.id, life];
  }));
  for (const item of messages) {
    const from = lifetimes.get(item.send.lifelineId)!, to = lifetimes.get(item.receive.lifelineId)!;
    if (item.send.y < from.start || item.send.y > from.end || (item.kind !== 'create' && (item.receive.y < to.start || item.receive.y > to.end))) fail('Точка сообщения находится вне линии жизни.');
    // Обычная линия должна оставаться корректной и после удаления специального сообщения.
    if (item.send.y > byId.get(item.send.lifelineId)!.endY || (item.kind !== 'create' && item.kind !== 'delete' && item.receive.y > byId.get(item.receive.lifelineId)!.endY)) fail('Точка сообщения находится вне линии жизни.');
  }
  const executions: SequenceExecution[] = [];
  for (const item of (value.executions as unknown[] | undefined) ?? []) {
    if (!record(item) || !exact(item, ['id', 'lifelineId', 'label', 'startY', 'endY']) || !id(item.id) || ids.has(item.id) || !id(item.lifelineId) || !text(item.label) || !num(item.startY) || !num(item.endY)) return fail('Некорректная активация или повтор идентификатора.');
    const line = lifetimes.get(item.lifelineId);
    if (!line || item.startY < line.start || item.endY > line.end || item.endY > byId.get(item.lifelineId)!.endY || item.endY <= item.startY) return fail('Активация должна находиться после заголовка и в пределах линии жизни.');
    const { startY, endY } = item;
    const interval = { startY, endY };
    if (executions.some(other => other.lifelineId === item.lifelineId && other.startY < endY && startY < other.endY && !containsExecution(other, interval) && !containsExecution(interval, other))) return fail('Активации на одной линии жизни не должны перекрываться частично или полностью совпадать.');
    ids.add(item.id);
    executions.push(item as unknown as SequenceExecution);
  }
  const fragments: SequenceFragment[] = [];
  for (const item of (value.fragments as unknown[] | undefined) ?? []) {
    if (!record(item) || !exact(item, ['id', 'label', 'operator', 'x', 'y', 'width', 'height', ...(item.operator === 'ref' ? [] : ['operands'])]) || !id(item.id) || ids.has(item.id) || !text(item.label) || !num(item.x) || !num(item.y) || !num(item.width) || !num(item.height) || item.width <= 0 || item.height <= 0 || !fragmentOperators.some(operator => operator === item.operator)) return fail('Некорректная рамка взаимодействия или повтор идентификатора.');
    const fragment = item as unknown as SequenceFragment;
    if (fragment.operator !== 'ref') validateOperands(fragment.operator, fragment.operands, fragment.height);
    ids.add(fragment.id);
    fragments.push(fragment);
  }
  return { format: 'uml-sequence', version: 1, lifelines, messages, ...(value.executions !== undefined ? { executions } : {}), ...(value.fragments !== undefined ? { fragments } : {}) };
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
  const ids = new Set([...document.lifelines, ...document.messages, ...(document.executions ?? []), ...(document.fragments ?? [])].map(item => item.id));
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
  const boundary = message.kind === 'create' || message.kind === 'delete';
  for (const point of boundary ? [message.send] : [message.send, message.receive]) {
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
  return mutate(source, document => moveLifeline(document, lifelineId, at));
}
function moveLifeline(document: SequenceDocument, lifelineId: string, at: DiagramPoint) {
  const item = document.lifelines.find(line => line.id === lifelineId) ?? fail('Линия жизни не найдена.');
  if (lifetimeEvents(document.messages).births.has(lifelineId)) {
    // Заголовок следует за сообщением создания; горизонтальное положение независимо от времени.
    item.x = at.x;
    document.lifelines.sort((a, b) => a.x + a.width / 2 - b.x - b.width / 2);
    return;
  }
  // Временные точки остаются на месте; нижний край не должен их обрезать.
  const endpoints = document.messages.flatMap(message => [message.send, message.receive]).filter(point => point.lifelineId === lifelineId);
  if (endpoints.some(point => point.y < at.y + item.height)) fail('Нельзя переместить участника ниже его сообщений.');
  item.endY = Math.max(item.endY + at.y - item.y, ...endpoints.map(point => point.y), ...(document.executions ?? []).filter(execution => execution.lifelineId === lifelineId).map(execution => execution.endY));
  item.x = at.x; item.y = at.y;
  document.lifelines.sort((a, b) => a.x + a.width / 2 - b.x - b.width / 2);
}

/** Изменение размера головы не меняет время сообщений и конец линии жизни. */
export function resizeSequenceLifeline(source: string, lifelineId: string, width: number, height: number): string {
  return mutate(source, document => resizeLifeline(document, lifelineId, width, height));
}
function resizeLifeline(document: SequenceDocument, lifelineId: string, width: number, height: number) {
  const item = document.lifelines.find(line => line.id === lifelineId) ?? fail('Линия жизни не найдена.');
  if (!num(width) || !num(height) || width <= 0 || height <= 0) fail('Размеры участника должны быть положительными числами.');
  const birth = lifetimeEvents(document.messages).births.get(lifelineId);
  const start = birth === undefined ? item.y + height : birth + height / 2;
  if (document.messages.some(message => (message.kind === 'create' ? [message.send] : [message.send, message.receive]).some(point => point.lifelineId === lifelineId && point.y < start))) fail('Голова участника не должна перекрывать сообщения.');
  item.width = width; item.height = height;
  document.lifelines.sort((a, b) => a.x + a.width / 2 - b.x - b.width / 2);
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
  return mutate(source, document => { const item = [...document.lifelines, ...document.messages, ...(document.executions ?? []), ...(document.fragments ?? [])].find(entry => entry.id === elementId) ?? fail('Элемент не найден.'); item.label = label; });
}
function setExecutionInterval(document: SequenceDocument, execution: SequenceExecution, startY: number, endY: number) {
  const line = document.lifelines.find(item => item.id === execution.lifelineId) ?? fail('Линия жизни не найдена.');
  if (!num(startY) || !num(endY) || startY < line.y + line.height || endY <= startY) fail('Начало должно быть ниже заголовка и раньше окончания активации.');
  execution.startY = startY; execution.endY = endY;
  if (endY > line.endY) line.endY = endY + 80;
}
/** Режим nested подбирает длительность внутри самой глубокой активации в точке начала. */
export function addSequenceExecution(source: string, lifelineId: string, startY: number, end: number | 'nested' = startY + 60): string {
  return mutate(source, document => {
    let endY = startY + 60;
    if (end === 'nested') {
      const parent = (document.executions ?? []).reduce<SequenceExecution | undefined>((deepest, item) =>
        item.lifelineId === lifelineId && item.startY <= startY && startY < item.endY && (!deepest || containsExecution(deepest, item)) ? item : deepest, undefined);
      if (parent) {
        endY = Math.min(endY, parent.endY);
        if (parent.startY === startY && parent.endY === endY) endY = startY + (endY - startY) / 2;
      }
      // Автоматическое размещение не меняет вложенность уже существующих активаций.
      for (const item of document.executions ?? []) {
        if (item.lifelineId === lifelineId && startY < item.startY && item.startY < endY) endY = item.startY;
      }
    } else endY = end;
    const next = { id: nextId(document, 'execution'), lifelineId, label: '', startY, endY };
    setExecutionInterval(document, next, startY, endY);
    (document.executions ??= []).push(next);
  });
}
export function editSequenceExecution(source: string, executionId: string, startY: number, endY: number): string {
  return mutate(source, document => {
    const execution = document.executions?.find(item => item.id === executionId) ?? fail('Активация не найдена.');
    setExecutionInterval(document, execution, startY, endY);
  });
}

export function addSequenceFragment(source: string, operator: SequenceFragmentOperator, at: DiagramPoint): string {
  const symbol = fragmentSymbols.find(item => item.type === `fragment-${operator}`) ?? fail('Неизвестный оператор фрагмента.');
  return mutate(source, document => {
    const frame = { id: nextId(document, 'fragment'), label: '', x: at.x, y: at.y, width: symbol.width, height: symbol.height };
    const operands = [{ y: 0, guard: '' }];
    if (operator === 'alt' || operator === 'par') operands.push({ y: frame.height / 2, guard: '' });
    (document.fragments ??= []).push(operator === 'ref' ? { ...frame, operator } : { ...frame, operator, operands });
  });
}

export function setSequenceOperands(source: string, fragmentId: string, operands: SequenceOperand[]): string {
  return mutate(source, document => {
    const fragment = document.fragments?.find(item => item.id === fragmentId) ?? fail('Фрагмент не найден.');
    if (fragment.operator === 'ref') return fail('Рамка ref не имеет операндов.');
    validateOperands(fragment.operator, operands, fragment.height);
    fragment.operands = operands;
  });
}

function moveSequenceNode(source: string, elementId: string, at: DiagramPoint): string {
  return mutate(source, document => {
    const fragment = document.fragments?.find(item => item.id === elementId);
    if (fragment) { fragment.x = at.x; fragment.y = at.y; }
    else moveLifeline(document, elementId, at);
  });
}

function resizeSequenceNode(source: string, elementId: string, width: number, height: number): string {
  return mutate(source, document => {
    const fragment = document.fragments?.find(item => item.id === elementId);
    if (fragment) { fragment.width = width; fragment.height = height; }
    else resizeLifeline(document, elementId, width, height);
  });
}

export function removeSequenceElement(source: string, elementId: string): string {
  return mutate(source, document => {
    if (document.lifelines.some(line => line.id === elementId)) {
      document.lifelines = document.lifelines.filter(line => line.id !== elementId);
      document.messages = document.messages.filter(message => message.send.lifelineId !== elementId && message.receive.lifelineId !== elementId);
      if (document.executions) document.executions = document.executions.filter(execution => execution.lifelineId !== elementId);
    } else if (document.messages.some(message => message.id === elementId)) document.messages = document.messages.filter(message => message.id !== elementId);
    else if (document.executions?.some(item => item.id === elementId)) document.executions = document.executions.filter(item => item.id !== elementId);
    else if (document.fragments?.some(item => item.id === elementId)) document.fragments = document.fragments.filter(item => item.id !== elementId);
    else fail('Элемент не найден.');
  });
}

/** Отдельная проекция для специализированного рендерера: время не является узлом графа. */
export function projectSequence(document: SequenceDocument) {
  const validated = parseSequence(serializeSequence(document));
  const lines = new Map(validated.lifelines.map(line => [line.id, line]));
  const events = lifetimeEvents(validated.messages);
  const width = 14;
  const stacks = new Map<string, SequenceExecution[]>();
  const executions = [...(validated.executions ?? [])].sort((a, b) => a.startY - b.startY || b.endY - a.endY).map(item => {
    const stack = stacks.get(item.lifelineId) ?? [];
    while (stack.length && !containsExecution(stack[stack.length - 1], item)) stack.pop();
    const depth = stack.length;
    stack.push(item);
    stacks.set(item.lifelineId, stack);
    const line = lines.get(item.lifelineId)!;
    return { ...item, depth, x: line.x + (line.width - width) / 2 + depth * width / 2, y: item.startY, width, height: item.endY - item.startY };
  });
  const attachedX = (lineId: string, x: number, y: number, direction: number, receive: boolean) => {
    let active: typeof executions[number] | undefined;
    for (const item of executions) {
      if (item.lifelineId !== lineId || y < item.startY || y > item.endY) continue;
      if (!active || item.depth > active.depth || (item.depth === active.depth && receive)) active = item;
    }
    return active ? active.x + (direction > 0 ? active.width : 0) : x;
  };
  return {
    lifelines: validated.lifelines.map(line => {
      const life = lifetime(line, events), x = line.x + line.width / 2;
      return { ...line, y: life.y, lineStart: { x, y: life.start }, lineEnd: { x, y: life.end }, ...(life.death !== undefined ? { destruction: { x, y: life.death } } : {}) };
    }),
    executions,
    messages: validated.messages.map(message => {
      const from = lines.get(message.send.lifelineId)!, to = lines.get(message.receive.lifelineId)!;
      const a = { x: from.x + from.width / 2, y: message.send.y }, b = { x: to.x + to.width / 2, y: message.receive.y };
      const loop = message.kind === 'self', direction = loop || b.x > a.x ? 1 : -1;
      const start = { ...a, x: attachedX(from.id, a.x, a.y, direction, false) };
      const end = { ...b, x: message.kind === 'create' ? b.x - direction * to.width / 2 : message.kind === 'delete' ? b.x : attachedX(to.id, b.x, b.y, loop ? 1 : -direction, true) };
      const bendX = Math.max(a.x + 40, start.x + 24, end.x + 24);
      return { ...message, points: loop ? [start, { x: bendX, y: a.y }, { x: bendX, y: b.y }, end] : (end.x - start.x) * direction > 0 ? [start, end] : [a, end], lineStyle: message.kind === 'reply' || message.kind === 'create' ? 'dashed' as const : 'solid' as const, arrowStyle: message.kind === 'sync' || loop ? 'filled' as const : 'open' as const };
    }),
  };
}

const unavailable = (): never => fail('Сообщения создаются на линиях жизни, а не как связи графа.');
/** Сообщения остаются временными точками и не попадают в граф связей. */
export const umlSequenceNotation: DiagramNotation & {
  createEmpty: () => string;
  timeline: NonNullable<DiagramNotation['timeline']> & { addExecution: typeof addSequenceExecution };
} = {
  id: 'uml-sequence', title: 'UML Sequence', fileExtension: 'sequence.json', fileAccept: '.sequence.json,application/json', mimeType: 'application/json',
  createEmpty: createSequence,
  timeline: {
    project: source => projectSequence(parseSequence(source)),
    addExecution: addSequenceExecution,
    editExecution: editSequenceExecution,
    addMessage: (source, from, to, y, type) => {
      if (type !== undefined && !isSelectableKind(type)) return fail('Неизвестный тип сообщения.');
      if (from === to && type && type !== 'sync') return fail('Сообщение себе поддерживается только как синхронный вызов.');
      return addSequenceMessage(source, { label: '', kind: from === to ? 'self' : type ?? 'sync', send: { lifelineId: from, y }, receive: { lifelineId: to, y: from === to ? y + 30 : y } });
    },
    moveMessage: moveSequenceMessage,
    editMessage: (source, id, changes) => {
      const message = parseSequence(source).messages.find(item => item.id === id) ?? fail('Сообщение не найдено.');
      const from = changes.from ?? message.send.lifelineId, to = changes.to ?? message.receive.lifelineId;
      const requested = changes.kind ?? (message.kind === 'self' ? 'sync' : message.kind);
      if (!isSelectableKind(requested)) return fail('Неизвестный тип сообщения.');
      if (from === to && requested !== 'sync') return fail('Сообщение себе поддерживается только как синхронный вызов.');
      return editSequenceMessage(source, id, { kind: from === to ? 'self' : requested, send: { lifelineId: from, y: message.send.y }, receive: { lifelineId: to, y: from === to ? message.send.y + 30 : message.send.y } });
    },
  },
  symbols: [{ type: 'lifeline', title: 'Участник', shape: 'rectangle', width: 140, height: 50 }, ...fragmentSymbols],
  connectionTypes: [
    { id: 'sync', title: 'Синхронное сообщение', appearance: { arrowStyle: 'filled' } },
    { id: 'async', title: 'Асинхронное сообщение', appearance: { arrowStyle: 'open' } },
    { id: 'reply', title: 'Ответ', appearance: { lineStyle: 'dashed', arrowStyle: 'open' } },
    { id: 'create', title: 'Создание участника', appearance: { lineStyle: 'dashed', arrowStyle: 'open' } },
    { id: 'delete', title: 'Уничтожение участника', appearance: { lineStyle: 'solid', arrowStyle: 'open' } },
  ],
  read(source) {
    const document = parseSequence(source);
    const events = lifetimeEvents(document.messages);
    const diagram: Diagram = { nodes: [
      ...document.lifelines.map(line => ({ id: line.id, type: 'lifeline', label: line.label, x: line.x, y: lifetime(line, events).y, width: line.width, height: line.height })),
      ...(document.fragments ?? []).map(({ operator, ...frame }) => ({ ...frame, type: `fragment-${operator}` })),
    ], edges: [] };
    return { diagram };
  },
  addNode: (source, type, at) => {
    if (type === 'lifeline') return addSequenceLifeline(source, at);
    const operator = fragmentOperators.find(key => type === `fragment-${key}`) ?? fail('Неизвестный элемент.');
    return addSequenceFragment(source, operator, at);
  },
  moveNode: moveSequenceNode, resizeNode: resizeSequenceNode, setOperands: setSequenceOperands, rename: renameSequenceElement, remove: removeSequenceElement,
  connect: unavailable, editEdge: unavailable, resetEdge: unavailable,
};
