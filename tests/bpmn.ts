import { blankXml, parseProcess } from '../src/bpmn';
import { bpmnNotation } from '../src/modeling/bpmn';

const results: string[] = [];
let failed = 0;
function check(name: string, test: () => void) {
  try { test(); results.push(`✓ ${name}`); }
  catch (error) { failed++; results.push(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function assertThrows(fn: () => unknown, message: string) { try { fn(); } catch { return; } throw new Error(message); }

check('Создание, сохранение и повторное чтение модели', () => {
  let xml = blankXml('Проверка');
  xml = bpmnNotation.addNode(xml, 'task', { x: 350, y: 150 });
  let diagram = bpmnNotation.read(xml).diagram;
  assert(diagram.nodes.length === 2, 'Задача не добавлена');
  const task = diagram.nodes.find((node) => node.type === 'task');
  assert(task, 'Задача не найдена');
  xml = bpmnNotation.rename(xml, task.id, 'Обработать заявку');
  xml = bpmnNotation.connect(xml, diagram.nodes[0].id, task.id);
  xml = bpmnNotation.moveNode(xml, task.id, { x: 500, y: 250 });
  diagram = bpmnNotation.read(xml).diagram;
  assert(diagram.nodes.find((node) => node.id === task.id)?.label === 'Обработать заявку', 'Название или ID потеряны');
  assert(diagram.edges.length === 1 && diagram.edges[0].to === task.id, 'Поток не сохранён');
  assert(parseProcess(xml).nodes.some((node) => node.id === task.id), 'Существующий парсер не видит задачу');
  assert(!new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror'), 'Получен некорректный XML');
  xml = bpmnNotation.remove(xml, task.id);
  assert(bpmnNotation.read(xml).diagram.edges.length === 0, 'После удаления задачи остался поток');
});

check('Неизвестное содержимое не разрешает изменение', () => {
  const original = blankXml('Проверка').replace('</bpmn:process>', '<bpmn:documentation>Не терять</bpmn:documentation></bpmn:process>');
  assert(bpmnNotation.read(original).readOnlyReason, 'Нет предупреждения об ограничении');
  assertThrows(() => bpmnNotation.addNode(original, 'task', { x: 10, y: 10 }), 'Не заблокирована операция');
  assert(original.includes('Не терять'), 'Исходная строка изменилась');
});

check('Повреждённый и не-BPMN XML отклоняются', () => {
  assertThrows(() => bpmnNotation.read('<broken>'), 'Повреждённый XML принят');
  assertThrows(() => bpmnNotation.read('<definitions/>'), 'XML без BPMN namespace принят');
});

check('Переходы к отсутствующим узлам не становятся редактируемыми', () => {
  let xml = blankXml('Проверка');
  xml = bpmnNotation.addNode(xml, 'task', { x: 350, y: 150 });
  const nodes = bpmnNotation.read(xml).diagram.nodes;
  xml = bpmnNotation.connect(xml, nodes[0].id, nodes[1].id);
  const broken = xml.replace(`targetRef="${nodes[1].id}"`, 'targetRef="Несуществующий"');
  assert(bpmnNotation.read(broken).readOnlyReason, 'Повреждённые ссылки не обнаружены');
  assertThrows(() => bpmnNotation.remove(broken, nodes[0].id), 'Повреждённую модель можно изменить');
});

check('Запрет самосвязи и повторной связи', () => {
  let xml = blankXml('Проверка');
  xml = bpmnNotation.addNode(xml, 'task', { x: 350, y: 150 });
  const nodes = bpmnNotation.read(xml).diagram.nodes;
  assertThrows(() => bpmnNotation.connect(xml, nodes[0].id, nodes[0].id), 'Самосвязь разрешена');
  xml = bpmnNotation.connect(xml, nodes[0].id, nodes[1].id);
  assertThrows(() => bpmnNotation.connect(xml, nodes[0].id, nodes[1].id), 'Повторная связь разрешена');
});

check('Редактирование маршрута и переподключение сохраняют ID и название', () => {
  let xml = blankXml('Проверка');
  xml = bpmnNotation.addNode(xml, 'task', { x: 350, y: 150 });
  xml = bpmnNotation.addNode(xml, 'task', { x: 550, y: 150 });
  let diagram = bpmnNotation.read(xml).diagram;
  xml = bpmnNotation.connect(xml, diagram.nodes[0].id, diagram.nodes[1].id);
  const edge = bpmnNotation.read(xml).diagram.edges[0];
  xml = bpmnNotation.rename(xml, edge.id, 'Передать');
  const route = [{ x: 218, y: 180 }, { x: 260, y: 180 }, { x: 260, y: 100 }, { x: 550, y: 100 }, { x: 550, y: 190 }];
  xml = bpmnNotation.editEdge(xml, edge.id, edge.from, diagram.nodes[2].id, route);
  diagram = bpmnNotation.read(xml).diagram;
  const saved = diagram.edges[0];
  assert(saved.id === edge.id && saved.label === 'Передать', 'Потеряны ID или название');
  assert(saved.to === diagram.nodes[2].id && saved.points.length === route.length, 'Конец или маршрут не сохранены');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const refs = Array.from(doc.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'incoming'));
  assert(refs.some((ref) => ref.parentElement?.getAttribute('id') === saved.to && ref.textContent === edge.id), 'Не перенесён incoming');
  assert(!refs.some((ref) => ref.parentElement?.getAttribute('id') === edge.to && ref.textContent === edge.id), 'Старая ссылка не удалена');
  xml = bpmnNotation.moveNode(xml, diagram.nodes[2].id, { x: 650, y: 200 });
  assert(bpmnNotation.read(xml).diagram.edges[0].points.length === route.length, 'Промежуточные точки потеряны');
});

check('Все символы каталога сохраняются и снова открываются', () => {
  let xml = blankXml('Каталог');
  for (const [index, symbol] of bpmnNotation.symbols.entries()) xml = bpmnNotation.addNode(xml, symbol.type, { x: index * 120, y: 300 });
  const result = bpmnNotation.read(xml);
  assert(!result.readOnlyReason, 'Новые символы заблокировали собственную модель');
  for (const symbol of bpmnNotation.symbols) assert(result.diagram.nodes.some((node) => node.type === symbol.type), `Не найден символ ${symbol.type}`);
});

check('Дорожка сохраняет назначение элементов и допускает перенос', () => {
  let xml = blankXml('Дорожки');
  assert(bpmnNotation.addRegion && bpmnNotation.resizeRegion, 'Дорожки не подключены');
  xml = bpmnNotation.addRegion(xml, { x: 120, y: 120 });
  let diagram = bpmnNotation.read(xml).diagram;
  assert(diagram.regions?.length === 1 && !bpmnNotation.read(xml).readOnlyReason, 'Дорожка не открылась для правки');
  assert(xml.includes('>StartEvent_1</bpmn:flowNodeRef>'), 'Начальное событие не назначено');
  xml = bpmnNotation.addNode(xml, 'task', { x: 350, y: 150 });
  diagram = bpmnNotation.read(xml).diagram;
  const node = diagram.nodes.find((item) => item.type === 'task');
  assert(node && xml.includes(`>${node.id}</bpmn:flowNodeRef>`), 'Задача не назначена дорожке');
  xml = bpmnNotation.moveNode(xml, node.id, { x: 1200, y: 400 });
  assert(!xml.includes(`>${node.id}</bpmn:flowNodeRef>`), 'Перенос не изменил принадлежность');
  const lane = diagram.regions![0];
  xml = bpmnNotation.rename(xml, lane.id, 'Исполнитель');
  xml = bpmnNotation.resizeRegion(xml, lane.id, 1000, 200);
  assert(bpmnNotation.read(xml).diagram.regions?.[0].label === 'Исполнитель', 'Название дорожки потеряно');
  assert(bpmnNotation.read(xml).diagram.regions?.[0].width === 1000, 'Размер дорожки потерян');
  xml = bpmnNotation.remove(xml, lane.id);
  assert(!xml.includes('flowNodeRef') && bpmnNotation.read(xml).diagram.nodes.length === 2, 'Удаление дорожки повредило узлы');
});

check('Объекты данных и аннотации соединяются ассоциациями', () => {
  let xml = blankXml('Данные');
  xml = bpmnNotation.addNode(xml, 'task', { x: 350, y: 150 });
  xml = bpmnNotation.addNode(xml, 'dataObjectReference', { x: 550, y: 150 });
  xml = bpmnNotation.addNode(xml, 'textAnnotation', { x: 650, y: 250 });
  const nodes = bpmnNotation.read(xml).diagram.nodes;
  const task = nodes.find((node) => node.type === 'task');
  const data = nodes.find((node) => node.type === 'dataObjectReference');
  const annotation = nodes.find((node) => node.type === 'textAnnotation');
  assert(task && data && annotation, 'Элементы не созданы');
  xml = bpmnNotation.rename(xml, data.id, 'Заявка');
  xml = bpmnNotation.rename(xml, annotation.id, 'Проверить сведения');
  xml = bpmnNotation.connect(xml, task.id, data.id);
  xml = bpmnNotation.connect(xml, annotation.id, task.id);
  const diagram = bpmnNotation.read(xml).diagram;
  assert(diagram.edges.length === 2 && diagram.edges.some((edge) => edge.type === 'dataOutputAssociation') && diagram.edges.some((edge) => edge.type === 'association'), 'Неверный тип связи');
  assert(diagram.nodes.find((node) => node.id === data.id)?.label === 'Заявка', 'Подпись данных потеряна');
  assert(diagram.nodes.find((node) => node.id === annotation.id)?.label === 'Проверить сведения', 'Текст аннотации потерян');
  xml = bpmnNotation.remove(xml, data.id);
  assert(bpmnNotation.read(xml).diagram.edges.length === 1, 'Ассоциация удалённого объекта осталась');
  assert(xml.includes('dataObject'), 'Исходное определение данных потеряно');
});

check('Неизвестные ссылочные атрибуты и неверные входы блокируют запись', () => {
  let xml = blankXml('Проверка');
  xml = bpmnNotation.addNode(xml, 'task', { x: 350, y: 150 });
  const nodes = bpmnNotation.read(xml).diagram.nodes;
  xml = bpmnNotation.connect(xml, nodes[0].id, nodes[1].id);
  const missing = xml.replace(/<bpmn:incoming>[^<]+<\/bpmn:incoming>/, '<bpmn:incoming>MissingFlow</bpmn:incoming>');
  assert(bpmnNotation.read(missing).readOnlyReason, 'Несуществующая ссылка incoming не обнаружена');
  const unknown = xml.replace(`<bpmn:task id="${nodes[1].id}"`, `<bpmn:task operationRef="ExternalOperation" id="${nodes[1].id}"`);
  assert(unknown !== xml && bpmnNotation.read(unknown).readOnlyReason, 'Неизвестный ссылочный атрибут не заблокирован');
});

check('Несовпадение дорожки и положения не позволяет перезаписать модель', () => {
  assert(bpmnNotation.addRegion, 'Дорожки не подключены');
  const xml = bpmnNotation.addRegion(blankXml('Проверка'), { x: 120, y: 120 });
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const shapes = Array.from(doc.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/DI', 'BPMNShape'));
  const shape = shapes.find((item) => item.getAttribute('bpmnElement') === 'StartEvent_1');
  const bounds = shape?.getElementsByTagNameNS('http://www.omg.org/spec/DD/20100524/DC', 'Bounds')[0];
  assert(bounds, 'Фигура не найдена'); bounds.setAttribute('x', '5000');
  const inconsistent = new XMLSerializer().serializeToString(doc);
  assert(bpmnNotation.read(inconsistent).readOnlyReason, 'Некорректная принадлежность не обнаружена');
  assertThrows(() => bpmnNotation.rename(inconsistent, 'StartEvent_1', 'Другое'), 'Повреждённая модель изменена');
});

check('Перемещение дорожки переносит элементы, подписи и маршруты без потери связей', () => {
  assert(bpmnNotation.addRegion && bpmnNotation.moveRegion && bpmnNotation.setLabelBounds, 'Операции дорожек не подключены');
  let xml = bpmnNotation.addRegion(blankXml('Перенос'), { x: 120, y: 120 });
  xml = bpmnNotation.addNode(xml, 'task', { x: 350, y: 150 });
  xml = bpmnNotation.addNode(xml, 'task', { x: 1200, y: 150 });
  let diagram = bpmnNotation.read(xml).diagram;
  const lane = diagram.regions![0];
  const inside = diagram.nodes.find((node) => node.type === 'task' && node.x === 350)!;
  const outside = diagram.nodes.find((node) => node.type === 'task' && node.x === 1200)!;
  const start = diagram.nodes.find((node) => node.id === 'StartEvent_1')!;
  xml = bpmnNotation.connect(xml, start.id, inside.id);
  xml = bpmnNotation.connect(xml, inside.id, outside.id);
  diagram = bpmnNotation.read(xml).diagram;
  const internal = diagram.edges.find((edge) => edge.from === start.id)!;
  const crossing = diagram.edges.find((edge) => edge.to === outside.id)!;
  xml = bpmnNotation.setLabelBounds(xml, inside.id, { x: 350, y: 130, width: 100, height: 20 });
  xml = bpmnNotation.setLabelBounds(xml, internal.id, { x: 250, y: 130, width: 80, height: 20 });
  const before = bpmnNotation.read(xml).diagram;
  xml = bpmnNotation.moveRegion(xml, lane.id, { x: 220, y: 220 });
  const result = bpmnNotation.read(xml);
  assert(!result.readOnlyReason, 'Перемещение создало несохраняемую модель');
  diagram = result.diagram;
  const moved = diagram.nodes.find((node) => node.id === inside.id)!;
  assert(moved.x === inside.x + 100 && moved.y === inside.y + 100, 'Задача не перемещена вместе с дорожкой');
  assert(moved.labelBounds?.x === 450 && moved.labelBounds.y === 230, 'Подпись задачи не перемещена');
  assert(diagram.nodes.find((node) => node.id === outside.id)?.x === outside.x, 'Внешняя задача перемещена');
  const movedInternal = diagram.edges.find((edge) => edge.id === internal.id)!;
  assert(movedInternal.points.every((point, i) => point.x === internal.points[i].x + 100 && point.y === internal.points[i].y + 100), 'Внутренний маршрут не перемещён целиком');
  assert(movedInternal.labelBounds?.x === 350 && movedInternal.labelBounds.y === 230, 'Подпись внутренней связи не перемещена');
  const movedCrossing = diagram.edges.find((edge) => edge.id === crossing.id)!;
  assert(movedCrossing.points[0].x === crossing.points[0].x + 100 && movedCrossing.points[0].y === crossing.points[0].y + 100, 'Начало внешней связи не перемещено');
  assert(JSON.stringify(movedCrossing.points[movedCrossing.points.length - 1]) === JSON.stringify(crossing.points[crossing.points.length - 1]), 'Внешний конец связи перемещён');
  assert(before.nodes.length === diagram.nodes.length && xml.includes(`>${inside.id}</bpmn:flowNodeRef>`), 'Потеряны элементы или принадлежность дорожке');
});

check('Перемещение дорожки отклоняет пересечение и занятое место', () => {
  assert(bpmnNotation.addRegion && bpmnNotation.moveRegion, 'Операции дорожек не подключены');
  let xml = bpmnNotation.addRegion(blankXml('Защита'), { x: 120, y: 120 });
  xml = bpmnNotation.addRegion(xml, { x: 1200, y: 120 });
  xml = bpmnNotation.addNode(xml, 'task', { x: 350, y: 500 });
  const lane = bpmnNotation.read(xml).diagram.regions![0];
  const original = xml;
  assertThrows(() => bpmnNotation.moveRegion!(xml, lane.id, { x: 1200, y: 120 }), 'Пересечение дорожек разрешено');
  assertThrows(() => bpmnNotation.moveRegion!(xml, lane.id, { x: 120, y: 480 }), 'Перемещение на занятые элементы разрешено');
  assertThrows(() => bpmnNotation.moveRegion!(xml, lane.id, { x: NaN, y: 120 }), 'Некорректные координаты разрешены');
  assert(xml === original && !bpmnNotation.read(xml).readOnlyReason, 'Исходная модель повреждена');
});

check('Размер аннотации и концы связей сохраняются после повторного чтения', () => {
  assert(bpmnNotation.resizeNode, 'Изменение размера не подключено');
  let xml = bpmnNotation.addNode(blankXml('Аннотация'), 'textAnnotation', { x: 400, y: 150 });
  const annotation = bpmnNotation.read(xml).diagram.nodes.find((node) => node.type === 'textAnnotation')!;
  xml = bpmnNotation.rename(xml, annotation.id, 'Важное примечание');
  xml = bpmnNotation.connect(xml, annotation.id, 'StartEvent_1');
  const edge = bpmnNotation.read(xml).diagram.edges[0];
  xml = bpmnNotation.resizeNode(xml, annotation.id, annotation.width * 2, annotation.height * 2);
  const result = bpmnNotation.read(xml);
  const saved = result.diagram.nodes.find((node) => node.id === annotation.id)!;
  const savedEdge = result.diagram.edges.find((item) => item.id === edge.id)!;
  assert(!result.readOnlyReason && saved.label === 'Важное примечание', 'Аннотация не сохранилась для редактирования');
  assert(saved.width === annotation.width * 2 && saved.height === annotation.height * 2, 'Размер аннотации не сохранился');
  assert(savedEdge.points[0].x === annotation.x + (edge.points[0].x - annotation.x) * 2 && savedEdge.points[0].y === annotation.y + (edge.points[0].y - annotation.y) * 2, 'Конец связи не масштабирован');
  assert(JSON.stringify(savedEdge.points[savedEdge.points.length - 1]) === JSON.stringify(edge.points[edge.points.length - 1]), 'Противоположный конец связи изменился');
  assertThrows(() => bpmnNotation.resizeNode!(xml, 'StartEvent_1', 100, 100), 'Разрешено изменять размер события');
  assertThrows(() => bpmnNotation.resizeNode!(xml, annotation.id, 39, 30), 'Разрешён слишком малый размер');
  assertThrows(() => bpmnNotation.resizeNode!(xml, annotation.id, Infinity, 50), 'Разрешён бесконечный размер');
});

check('Именованные смежные дорожки считаются отдельными строками ролей', () => {
  assert(bpmnNotation.addRegion && bpmnNotation.setRegionRows, 'Строки дорожек не подключены');
  let xml = bpmnNotation.addRegion(blankXml('Роли'), { x: 120, y: 120 });
  xml = bpmnNotation.addRegion(xml, { x: 120, y: 300 });
  let rows = bpmnNotation.read(xml).diagram.regions!;
  const [first, second] = rows;
  xml = bpmnNotation.rename(xml, first.id, 'Заказчик');
  xml = bpmnNotation.rename(xml, second.id, 'Исполнитель');
  rows = bpmnNotation.read(xml).diagram.regions!;
  assert(rows.every((row) => row.rowCount === 2), 'Имена разделили смежные строки');
  xml = bpmnNotation.setRegionRows(xml, second.id, 3);
  const result = bpmnNotation.read(xml);
  rows = result.diagram.regions!;
  assert(!result.readOnlyReason && rows.length === 3 && rows.every((row) => row.rowCount === 3), 'Третья строка не добавлена к общей группе');
  assert(rows.find((row) => row.id === first.id)?.label === 'Заказчик' && rows.find((row) => row.id === second.id)?.label === 'Исполнитель', 'Имена или ID ролей потеряны');
  assert(rows.some((row) => row.y === 480 && row.label === ''), 'Новая строка создана не в конце группы');
  xml = bpmnNotation.setRegionRows(xml, second.id, 2);
  assert(bpmnNotation.read(xml).diagram.regions?.length === 2, 'Пустая строка не удалена');
  assertThrows(() => bpmnNotation.setRegionRows!(xml, first.id, 1), 'Именованная роль удалена с потерей имени');
  for (const count of [0, 101, 1.5, NaN]) assertThrows(() => bpmnNotation.setRegionRows!(xml, first.id, count), 'Недопустимое число строк принято');
});

check('Удаление и добавление строк не теряют занятые области и дополнительные данные', () => {
  assert(bpmnNotation.addRegion && bpmnNotation.setRegionRows, 'Строки дорожек не подключены');
  let xml = bpmnNotation.addRegion(blankXml('Защита строк'), { x: 120, y: 120 });
  const first = bpmnNotation.read(xml).diagram.regions![0];
  xml = bpmnNotation.setRegionRows(xml, first.id, 2);
  const second = bpmnNotation.read(xml).diagram.regions!.find((row) => row.id !== first.id)!;
  const withNode = bpmnNotation.addNode(xml, 'task', { x: 350, y: 330 });
  assertThrows(() => bpmnNotation.setRegionRows!(withNode, first.id, 1), 'Занятая строка удалена');
  assert(bpmnNotation.read(withNode).diagram.nodes.some((node) => node.x === 350 && node.y === 330), 'Задача потеряна');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const shape = Array.from(doc.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/DI', 'BPMNShape')).find((item) => item.getAttribute('bpmnElement') === second.id)!;
  const label = doc.createElementNS('http://www.omg.org/spec/BPMN/20100524/DI', 'bpmndi:BPMNLabel');
  shape.appendChild(label);
  const withLabel = new XMLSerializer().serializeToString(doc);
  assertThrows(() => bpmnNotation.setRegionRows!(withLabel, first.id, 1), 'Строка с дополнительными данными удалена');
  assert(bpmnNotation.read(withLabel).diagram.regions?.length === 2, 'Дорожка с данными потеряна');
  const occupied = bpmnNotation.addNode(xml, 'task', { x: 350, y: 510 });
  assertThrows(() => bpmnNotation.setRegionRows!(occupied, first.id, 3), 'Строка добавлена поверх задачи');
});

check('Сложная спецификация входов и выходов блокирует редактирование без потери XML', () => {
  let xml = bpmnNotation.addNode(blankXml('Входы и выходы'), 'task', { x: 350, y: 150 });
  const task = bpmnNotation.read(xml).diagram.nodes.find((node) => node.type === 'task')!;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const ns = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
  const activity = Array.from(doc.getElementsByTagNameNS(ns, 'task')).find((item) => item.getAttribute('id') === task.id)!;
  const io = doc.createElementNS(ns, 'bpmn:ioSpecification');
  const input = doc.createElementNS(ns, 'bpmn:dataInput'); input.setAttribute('id', 'ExternalInput');
  const inputSet = doc.createElementNS(ns, 'bpmn:inputSet'); inputSet.setAttribute('id', 'ExternalInputSet');
  const optional = doc.createElementNS(ns, 'bpmn:optionalInputRefs'); optional.textContent = 'ExternalInput'; inputSet.appendChild(optional);
  const outputSet = doc.createElementNS(ns, 'bpmn:outputSet'); outputSet.setAttribute('id', 'ExternalOutputSet');
  io.append(input, inputSet, outputSet); activity.appendChild(io);
  xml = new XMLSerializer().serializeToString(doc);
  assert(bpmnNotation.read(xml).readOnlyReason, 'Сложная спецификация не заблокирована');
  assertThrows(() => bpmnNotation.rename(xml, task.id, 'Новое имя'), 'Модель со сложной спецификацией изменена');
  assert(xml.includes('optionalInputRefs') && xml.includes('ExternalInput'), 'Исходные данные спецификации потеряны');
});

check('Старая association между задачей и данными сохраняет тип при редактировании', () => {
  let xml = bpmnNotation.addNode(blankXml('Старая связь'), 'task', { x: 350, y: 150 });
  xml = bpmnNotation.addNode(xml, 'dataObjectReference', { x: 550, y: 150 });
  const nodes = bpmnNotation.read(xml).diagram.nodes;
  const task = nodes.find((node) => node.type === 'task')!;
  const data = nodes.find((node) => node.type === 'dataObjectReference')!;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const ns = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
  const di = 'http://www.omg.org/spec/BPMN/20100524/DI';
  const dd = 'http://www.omg.org/spec/DD/20100524/DI';
  const association = doc.createElementNS(ns, 'bpmn:association');
  association.setAttribute('id', 'LegacyAssociation'); association.setAttribute('sourceRef', task.id); association.setAttribute('targetRef', data.id);
  association.setAttribute('associationDirection', 'One'); doc.getElementsByTagNameNS(ns, 'process')[0].appendChild(association);
  const edge = doc.createElementNS(di, 'bpmndi:BPMNEdge'); edge.setAttribute('id', 'LegacyAssociation_di'); edge.setAttribute('bpmnElement', 'LegacyAssociation');
  for (const [x, y] of [[450, 190], [550, 177]]) { const point = doc.createElementNS(dd, 'di:waypoint'); point.setAttribute('x', String(x)); point.setAttribute('y', String(y)); edge.appendChild(point); }
  doc.getElementsByTagNameNS(di, 'BPMNPlane')[0].appendChild(edge);
  xml = new XMLSerializer().serializeToString(doc);
  assert(!bpmnNotation.read(xml).readOnlyReason, 'Старая ассоциация заблокирована');
  xml = bpmnNotation.moveNode(xml, task.id, { x: 400, y: 200 });
  const saved = bpmnNotation.read(xml).diagram.edges.find((item) => item.id === 'LegacyAssociation');
  assert(saved?.type === 'association' && saved.arrowEnd && saved.to === data.id, 'Старая ассоциация изменила тип или направление');
  assert(xml.includes('associationDirection="One"'), 'Направление ассоциации потеряно');
});

check('Выбранный тип связи и автоматический режим сохраняют тип и направление', () => {
  let base = bpmnNotation.addNode(blankXml('Типы связей'), 'task', { x: 350, y: 150 });
  base = bpmnNotation.addNode(base, 'dataObjectReference', { x: 550, y: 150 });
  const nodes = bpmnNotation.read(base).diagram.nodes;
  const task = nodes.find((item) => item.type === 'task')!;
  const data = nodes.find((item) => item.type === 'dataObjectReference')!;
  const automatic = bpmnNotation.read(bpmnNotation.connect(base, 'StartEvent_1', task.id)).diagram.edges[0];
  assert(automatic.type === 'sequenceFlow', 'Автоматический режим не выбрал поток управления');
  const artifact = bpmnNotation.read(bpmnNotation.connect(base, task.id, data.id)).diagram.edges[0];
  assert(artifact.type === 'dataOutputAssociation' && artifact.lineStyle === 'dotted', 'Для данных не выбрана ассоциация');
  const directedXml = bpmnNotation.connect(base, task.id, data.id, 'directedAssociation');
  const directed = bpmnNotation.read(directedXml).diagram.edges[0];
  assert(directed.type === 'association' && directed.arrowEnd && !directed.arrowStart, 'Направленная ассоциация не сохранилась');
  assertThrows(() => bpmnNotation.connect(base, task.id, data.id, 'sequenceFlow'), 'Поток управления разрешён к объекту данных');
  assertThrows(() => bpmnNotation.connect(base, task.id, data.id, 'unknown'), 'Неизвестный тип связи разрешён');
});

check('Варианты событий: создание, маркеры, связи и повторное открытие', () => {
  let xml = blankXml('События');
  const variants = bpmnNotation.symbols.filter((symbol) => symbol.detail);
  assert(variants.length > 10 && new Set(variants.map((symbol) => symbol.type)).size === variants.length, 'Неполная или повторяющаяся палитра');
  for (const [i, symbol] of variants.entries()) {
    const before = xml;
    xml = bpmnNotation.addNode(xml, symbol.type, { x: 300 + i * 50, y: 350 });
    assert(bpmnNotation.read(before).diagram.nodes.length + 1 === bpmnNotation.read(xml).diagram.nodes.length, 'Снимок для undo изменён');
    assert(bpmnNotation.renderSymbolDetail?.(symbol), 'Нет контракта маркера');
  }
  let result = bpmnNotation.read(xml);
  assert(!result.readOnlyReason, 'Созданные события заблокированы');
  for (const symbol of variants) assert(result.diagram.nodes.some((node) => node.type === symbol.type), `Потерян ${symbol.type}`);
  const start = result.diagram.nodes.find((node) => node.type === 'startEvent:message')!;
  const middle = result.diagram.nodes.find((node) => node.type === 'intermediateCatchEvent:timer')!;
  const end = result.diagram.nodes.find((node) => node.type === 'endEvent:signal')!;
  xml = bpmnNotation.connect(xml, start.id, middle.id);
  xml = bpmnNotation.connect(xml, middle.id, end.id);
  assertThrows(() => bpmnNotation.connect(xml, end.id, middle.id), 'Поток из конечного события разрешён');
  assertThrows(() => bpmnNotation.connect(xml, middle.id, start.id), 'Поток в начальное событие разрешён');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const id of [start.id, middle.id, end.id]) {
    const event = Array.from(doc.getElementsByTagName('*')).find((el) => el.id === id)!;
    const names = Array.from(event.children).map((el) => el.localName);
    const def = names.findIndex((name) => name.endsWith('EventDefinition'));
    assert(def >= 0 && names.every((name, index) => !['incoming', 'outgoing'].includes(name) || index < def), 'Нарушен порядок ссылок и определения');
  }
  const edge = bpmnNotation.read(xml).diagram.edges.find((item) => item.to === end.id)!;
  const other = result.diagram.nodes.find((node) => node.type === 'intermediateThrowEvent:signal')!;
  xml = bpmnNotation.editEdge(xml, edge.id, other.id, end.id, edge.points);
  result = bpmnNotation.read(xml);
  assert(!result.readOnlyReason && result.diagram.edges.some((item) => item.id === edge.id && item.from === other.id), 'Переподключение не сохранилось');
  const reopened = new XMLSerializer().serializeToString(new DOMParser().parseFromString(xml, 'application/xml'));
  assert(!bpmnNotation.read(reopened).readOnlyReason, 'Повторное открытие не удалось');
  for (const key of ['startEvent:conditional', 'intermediateCatchEvent:link', 'endEvent:multiple', 'endEvent:cancel']) assertThrows(() => bpmnNotation.addNode(xml, key, { x: 0, y: 0 }), `Недопустимый вариант ${key} доступен`);
});

check('События сохраняют назначение дорожке и запреты при переподключении', () => {
  assert(bpmnNotation.addRegion, 'Дорожки не подключены');
  let xml = bpmnNotation.addRegion(blankXml('Дорожка события'), { x: 120, y: 120 });
  xml = bpmnNotation.addNode(xml, 'intermediateThrowEvent:message', { x: 350, y: 150 });
  xml = bpmnNotation.addNode(xml, 'endEvent:error', { x: 550, y: 150 });
  const diagram = bpmnNotation.read(xml).diagram;
  const middle = diagram.nodes.find((node) => node.type === 'intermediateThrowEvent:message')!;
  const end = diagram.nodes.find((node) => node.type === 'endEvent:error')!;
  assert(xml.includes(`>${middle.id}</bpmn:flowNodeRef>`) && xml.includes(`>${end.id}</bpmn:flowNodeRef>`), 'События не назначены дорожке');
  xml = bpmnNotation.connect(xml, middle.id, end.id);
  const edge = bpmnNotation.read(xml).diagram.edges[0];
  assertThrows(() => bpmnNotation.editEdge(xml, edge.id, end.id, middle.id, edge.points), 'Переподключение из конечного события разрешено');
  assertThrows(() => bpmnNotation.editEdge(xml, edge.id, middle.id, 'StartEvent_1', edge.points), 'Переподключение в начальное событие разрешено');
  xml = bpmnNotation.moveNode(xml, middle.id, { x: 1200, y: 500 });
  assert(!xml.includes(`>${middle.id}</bpmn:flowNodeRef>`) && !bpmnNotation.read(xml).readOnlyReason, 'Принадлежность после переноса не обновилась');
});

check('Ссылочные и сложные события не перезаписываются', () => {
  let xml = bpmnNotation.addNode(blankXml('Защита'), 'startEvent:message', { x: 350, y: 150 });
  const node = bpmnNotation.read(xml).diagram.nodes.find((item) => item.type === 'startEvent:message')!;
  const complex = xml.replace('<bpmn:messageEventDefinition/>', '<bpmn:messageEventDefinition messageRef="ExternalMessage"/>');
  assert(complex !== xml && bpmnNotation.read(complex).readOnlyReason, 'Ссылочное событие не заблокировано');
  assertThrows(() => bpmnNotation.rename(complex, node.id, 'Изменение'), 'Ссылочное событие изменено');
  const withId = xml.replace('<bpmn:messageEventDefinition/>', '<bpmn:messageEventDefinition id="Definition_1"/>');
  assert(!bpmnNotation.read(withId).readOnlyReason, 'Определение с ID заблокировано');
  xml = bpmnNotation.rename(withId, node.id, 'Новое имя');
  assert(xml.includes('id="Definition_1"'), 'ID определения потерян');
});

check('Дорожка, события, пользовательская задача, шлюз и данные: операции', () => {
  let xml = bpmnNotation.addRegion!(blankXml('Смешанная'), { x: 120, y: 120 });
  for (const [type, x, y] of [['userTask', 300, 160], ['exclusiveGateway', 500, 160], ['startEvent:message', 600, 160], ['intermediateCatchEvent:timer', 700, 160], ['dataObjectReference', 300, 300], ['dataStoreReference', 500, 300]] as const) xml = bpmnNotation.addNode(xml, type, { x, y });
  let diagram = bpmnNotation.read(xml).diagram;
  const task = diagram.nodes.find(n => n.type === 'userTask')!; const data = diagram.nodes.find(n => n.type === 'dataObjectReference')!; const store = diagram.nodes.find(n => n.type === 'dataStoreReference')!;
  xml = bpmnNotation.connect(xml, data.id, task.id);
  xml = bpmnNotation.connect(xml, task.id, store.id, 'dataOutputAssociation');
  diagram = bpmnNotation.read(xml).diagram;
  assert(!bpmnNotation.read(xml).readOnlyReason && diagram.edges.length === 2, 'Смешанная модель не редактируется');
  const input = diagram.edges.find(e => e.type === 'dataInputAssociation')!; const output = diagram.edges.find(e => e.type === 'dataOutputAssociation')!;
  xml = bpmnNotation.editEdge(xml, input.id, store.id, task.id, input.points);
  xml = bpmnNotation.moveNode(xml, task.id, { x: 350, y: 180 });
  assert(bpmnNotation.read(xml).diagram.edges.find(e => e.id === input.id)?.from === store.id, 'Переподключение утрачено');
  xml = bpmnNotation.resetEdge(xml, output.id);
  xml = bpmnNotation.remove(xml, input.id);
  xml = bpmnNotation.remove(xml, store.id);
  assert(!bpmnNotation.read(xml).readOnlyReason && bpmnNotation.read(xml).diagram.edges.length === 0 && xml.includes('messageEventDefinition') && xml.includes('timerEventDefinition'), 'Удаление повредило события или связи');
});

check('Все поддерживаемые события совместимы с профилем данных', () => {
  let xml = bpmnNotation.addNode(blankXml('События и данные'), 'dataStoreReference', { x: 50, y: 50 });
  for (const [i, symbol] of bpmnNotation.symbols.filter(s => s.detail).entries()) {
    xml = bpmnNotation.addNode(xml, symbol.type, { x: 300 + i * 50, y: 300 });
    assert(!bpmnNotation.read(xml).readOnlyReason, `Событие ${symbol.type} заблокировало модель данных`);
  }
});

const target = document.getElementById('results');
if (target) { target.textContent = `${results.join('\n')}\n\nОшибок: ${failed}`; target.dataset.failed = String(failed); }
if (failed) console.error(results.filter((line) => line.startsWith('✗')).join('\n'));
