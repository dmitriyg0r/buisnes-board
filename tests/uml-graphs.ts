import { canConnectUmlClass, defaultUmlClassConnection, umlClassNotation, umlClassSymbols, umlClassConnectionTypes } from '../src/modeling/umlClass';
import { canConnectUmlUseCase, defaultUmlUseCaseConnection, umlUseCaseNotation, umlUseCaseSymbols, umlUseCaseConnectionTypes } from '../src/modeling/umlUseCase';
import { canConnectUmlActivity, defaultUmlActivityConnection, umlActivityNotation, umlActivitySymbols, umlActivityConnectionTypes } from '../src/modeling/umlActivity';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const cases: [string, (a: string, b: string, e: string) => boolean, string, string, string, boolean][] = [
  ['Класс: ассоциация', canConnectUmlClass, 'class', 'interface', 'association', true],
  ['Класс: реализация', canConnectUmlClass, 'class', 'interface', 'realization', true],
  ['Класс: обратная реализация', canConnectUmlClass, 'interface', 'class', 'realization', false],
  ['Класс: обобщение', canConnectUmlClass, 'class', 'class', 'generalization', true],
  ['Класс: композиция', canConnectUmlClass, 'class', 'class', 'composition', true],
  ['Класс: композиция интерфейса', canConnectUmlClass, 'interface', 'class', 'composition', false],
  ['Вариант: ассоциация', canConnectUmlUseCase, 'actor', 'use-case', 'association', true],
  ['Вариант: включение', canConnectUmlUseCase, 'use-case', 'use-case', 'include', true],
  ['Вариант: расширение', canConnectUmlUseCase, 'use-case', 'use-case', 'extend', true],
  ['Вариант: включение актора', canConnectUmlUseCase, 'actor', 'use-case', 'include', false],
  ['Вариант: обобщение акторов', canConnectUmlUseCase, 'actor', 'actor', 'generalization', true],
  ['Вариант: разнородное обобщение', canConnectUmlUseCase, 'actor', 'use-case', 'generalization', false],
  ['Активность: управление', canConnectUmlActivity, 'initial', 'action', 'control-flow', true],
  ['Активность: вход в начало', canConnectUmlActivity, 'action', 'initial', 'control-flow', false],
  ['Активность: выход из конца', canConnectUmlActivity, 'flow-final', 'action', 'control-flow', false],
  ['Активность: поток объекта', canConnectUmlActivity, 'object', 'action', 'object-flow', true],
  ['Активность: объект в управлении', canConnectUmlActivity, 'object', 'action', 'control-flow', false],
  ['Активность: объект из начала', canConnectUmlActivity, 'initial', 'object', 'object-flow', false],
];
for (const [name, check, from, to, edge, expected] of cases) assert(check(from, to, edge) === expected, name);
for (const [check, fallback, symbols, edges] of [
  [canConnectUmlClass, defaultUmlClassConnection, umlClassSymbols, umlClassConnectionTypes],
  [canConnectUmlUseCase, defaultUmlUseCaseConnection, umlUseCaseSymbols, umlUseCaseConnectionTypes],
  [canConnectUmlActivity, defaultUmlActivityConnection, umlActivitySymbols, umlActivityConnectionTypes],
] as const) {
  assert(new Set(symbols.map(s => s.type)).size === symbols.length, 'Повтор символа');
  assert(new Set(edges.map(e => e.id)).size === edges.length, 'Повтор связи');
  for (const from of [...symbols.map(s => s.type), 'unknown']) for (const to of [...symbols.map(s => s.type), 'unknown']) {
    const selected = fallback(from, to);
    assert(selected === undefined || check(from, to, selected), 'Недопустимая связь по умолчанию');
    assert(!check(from, to, 'unknown'), 'Неизвестная связь');
  }
}
for (const [notation, fromType, toType, edgeType] of [
  [umlClassNotation, 'class', 'interface', 'realization'],
  [umlUseCaseNotation, 'actor', 'use-case', 'association'],
  [umlActivityNotation, 'initial', 'action', 'control-flow'],
] as const) {
  let source = notation.createEmpty();
  source = notation.addNode(source, fromType, { x: 20, y: 20 });
  source = notation.addNode(source, toType, { x: 300, y: 20 });
  const nodes = notation.read(source).diagram.nodes;
  const from = nodes.find(node => node.type === fromType)!;
  const to = nodes.find(node => node.type === toType)!;
  assert(from && to, 'Узлы не созданы');
  source = notation.connect(source, from.id, to.id, edgeType);
  const edge = notation.read(source).diagram.edges.find(e => e.from === from.id && e.to === to.id && e.type === edgeType);
  assert(edge, 'Связь не сохранена');
  const appearance = notation.connectionTypes?.find(item => item.id === edgeType)?.appearance;
  if (appearance) for (const [key, value] of Object.entries(appearance)) assert(edge && (edge as unknown as Record<string, unknown>)[key] === value, `Не спроецирован маркер ${key}`);
}
console.log(`UML: ${cases.length} проверок связей и проверки интеграции пройдены`);

for (const [name, edges, ids] of [
  ['Класс', umlClassConnectionTypes, ['association', 'aggregation', 'composition']],
  ['Вариант использования', umlUseCaseConnectionTypes, ['association']],
] as const) for (const id of ids) {
  const edge = edges.find(item => item.id === id);
  assert(edge && 'arrowEnd' in edge.appearance && edge.appearance.arrowEnd === false, `${name}: ${id} не должен иметь конечной стрелки`);
}

let classSource = umlClassNotation.createEmpty();
classSource = umlClassNotation.addNode(classSource, 'class', { x: 0, y: 0 });
const classId = umlClassNotation.read(classSource).diagram.nodes[0].id;
classSource = umlClassNotation.setNodeCompartments!(classSource, classId, { attributes: ['- age: Integer'], operations: ['+ save(): Boolean'] });
classSource = umlClassNotation.moveNode(classSource, classId, { x: 32, y: 40 });
const savedClass = umlClassNotation.read(classSource).diagram.nodes[0];
assert(savedClass.id === classId && savedClass.compartments?.attributes[0] === '- age: Integer' && savedClass.compartments.operations[0] === '+ save(): Boolean', 'Секции класса не сохранены после перемещения');
let useSource = umlUseCaseNotation.createEmpty();
useSource = umlUseCaseNotation.addNode(useSource, 'use-case', { x: 0, y: 0 });
useSource = umlUseCaseNotation.addNode(useSource, 'use-case', { x: 300, y: 0 });
const uses = umlUseCaseNotation.read(useSource).diagram.nodes;
useSource = umlUseCaseNotation.connect(useSource, uses[0].id, uses[1].id, 'include');
assert(umlUseCaseNotation.read(useSource).diagram.edges[0].stereotype === '«include»', 'Стереотип включения не отображается');

// Новые классификаторы и связи проходят те же реальные операции, что и старые.
for (const type of ['data-type', 'primitive-type']) {
  let source = umlClassNotation.createEmpty();
  source = umlClassNotation.addNode(source, type, { x: 0, y: 0 });
  source = umlClassNotation.addNode(source, 'class', { x: 400, y: 0 });
  const [node, other] = umlClassNotation.read(source).diagram.nodes;
  source = umlClassNotation.rename(source, node.id, 'Значение');
  source = umlClassNotation.setNodeCompartments!(source, node.id, { attributes: ['+ value: String'], operations: ['+ format(): String'] });
  source = umlClassNotation.connect(source, other.id, node.id, 'navigable-association');
  const edge = umlClassNotation.read(source).diagram.edges[0];
  assert(edge.arrowStyle === 'open' && edge.arrowEnd === true && edge.lineStyle === 'solid', 'Неверная навигация ассоциации');
  source = umlClassNotation.rename(source, edge.id, 'использует');
  source = umlClassNotation.moveNode(source, node.id, { x: 0, y: 200 });
  const restored = umlClassNotation.read(source);
  assert(!restored.readOnlyReason && restored.diagram.nodes[0].label === 'Значение', 'Тип данных не сохранён');
  assert(restored.diagram.nodes[0].compartments?.operations[0] === '+ format(): String', 'Операция типа данных не сохранена');
  assert(restored.diagram.edges[0].label === 'использует' && restored.diagram.edges[0].type === 'navigable-association', 'Ассоциация не сохранена');
  source = umlClassNotation.remove(source, node.id);
  assert(umlClassNotation.read(source).diagram.edges.length === 0, 'Удаление классификатора не удалило связь');
}
assert(canConnectUmlUseCase('actor', 'use-case', 'dependency'), 'Зависимость актора и варианта');
assert(!canConnectUmlUseCase('unknown', 'actor', 'dependency'), 'Неизвестный элемент зависимости');
assert(defaultUmlUseCaseConnection('actor', 'use-case') === 'association', 'Зависимость изменила связь по умолчанию');
let dependencySource = umlUseCaseNotation.createEmpty();
dependencySource = umlUseCaseNotation.addNode(dependencySource, 'use-case', { x: 0, y: 0 });
dependencySource = umlUseCaseNotation.addNode(dependencySource, 'use-case', { x: 400, y: 0 });
const dependencyNodes = umlUseCaseNotation.read(dependencySource).diagram.nodes;
dependencySource = umlUseCaseNotation.connect(dependencySource, dependencyNodes[0].id, dependencyNodes[1].id, 'dependency');
const dependency = umlUseCaseNotation.read(dependencySource).diagram.edges[0];
assert(dependency.lineStyle === 'dashed' && dependency.arrowStyle === 'open' && dependency.arrowEnd === true && !dependency.stereotype, 'Неверный вид зависимости');
assert(!umlUseCaseNotation.read(dependencySource).readOnlyReason, 'Зависимость не читается после сохранения');
console.log('UML: новые типы, навигация, зависимость и сохранение проверены');
