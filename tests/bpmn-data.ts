// Запуск: npm run dev; в консоли страницы Vite:
// import('/tests/bpmn-data.ts').then(m => console.log(m.runBpmnDataTests())).
import { addDataAssociation, addDataStore, editDataAssociation, inspectDataModel, removeDataAssociation, removeDataConnectionsForNode, removeDataStoreReference } from '../src/modeling/bpmnData';

const assert = (value: unknown, text: string) => { if (!value) throw new Error(text); };
const throws = (f: () => unknown) => { let rejected = false; try { f(); } catch { rejected = true; } assert(rejected, 'Ожидался отказ'); };
const points = [{ x: 10, y: 20 }, { x: 100, y: 20 }];
const base = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Defs" targetNamespace="urn:test"><bpmn:process id="Process" isExecutable="false"><bpmn:task id="Task"/><bpmn:dataObject id="Object"/><bpmn:dataObjectReference id="Ref" dataObjectRef="Object"/></bpmn:process><bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Process"><bpmndi:BPMNShape id="Task_di" bpmnElement="Task"><dc:Bounds x="100" y="0" width="100" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="Ref_di" bpmnElement="Ref"><dc:Bounds x="0" y="0" width="40" height="50"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
export function runBpmnDataTests() {
  const results: string[] = [];
  function test(name: string, f: () => void) { f(); results.push(name); }
  let xml = base; let store = ''; let input = ''; let output = '';
  test('Исходная модель', () => assert(inspectDataModel(xml).editable, inspectDataModel(xml).reason ?? 'Ошибка'));
  test('Создание хранилища', () => { const r = addDataStore(xml, 'Данные & записи', { x: 250, y: 0, width: 50, height: 60 }); xml = r.xml; store = r.id; assert(inspectDataModel(xml).nodes.length === 2, 'Нет хранилища'); });
  test('Вход и выход', () => { const a = addDataAssociation(xml, 'dataInputAssociation', 'Ref', 'Task', points); xml = a.xml; input = a.id; const b = addDataAssociation(xml, 'dataOutputAssociation', 'Task', store, points); xml = b.xml; output = b.id; const s = inspectDataModel(xml); assert(s.editable && s.edges.length === 2 && s.edges[0].from === 'Ref' && s.edges[1].to === store, 'Неверные связи'); });
  const validXml = xml;
  test('Обязательное корректное пространство имён', () => {
    for (const invalid of [validXml.replace(' targetNamespace="urn:test"', ''), validXml.replace('urn:test', '   '), validXml.replace('urn:test', 'urn:bad%zz')]) {
      assert(!inspectDataModel(invalid).editable, 'Некорректный targetNamespace принят');
      throws(() => addDataStore(invalid, 'x', { x: 0, y: 0, width: 1, height: 1 }));
    }
  });
  test('Read-only: неизвестный атрибут не скрывает связи', () => {
    const invalid = validXml.replace('id="Task"', 'id="Task" custom="x"');
    const state = inspectDataModel(invalid); const original = inspectDataModel(validXml);
    assert(!state.editable && JSON.stringify(state.nodes) === JSON.stringify(original.nodes) && JSON.stringify(state.edges) === JSON.stringify(original.edges), 'Проекция потеряла данные');
    assert(invalid === validXml.replace('id="Task"', 'id="Task" custom="x"'), 'Источник изменён');
    throws(() => removeDataAssociation(invalid, input));
  });
  test('Read-only: сложный IO и битые ссылки', () => {
    const complex = validXml.replace('</bpmn:ioSpecification>', '<bpmn:inputSet id="Extra"/></bpmn:ioSpecification>');
    const projection = inspectDataModel(complex);
    assert(!projection.editable && projection.edges.length === 2, 'Сложный IO скрыл представимые связи');
    const broken = validXml.replace('>Ref</bpmn:sourceRef>', '>Missing</bpmn:sourceRef>');
    const state = inspectDataModel(broken);
    assert(!state.editable && state.edges.length === 1 && state.edges[0].id === output && !state.edges.some(e => e.from === 'Missing' || e.to === 'Missing'), 'Спроецирована несуществующая связь');
    throws(() => removeDataAssociation(complex, input));
  });
  test('Read-only: неоднозначные и отсутствующие концы не отображаются', () => {
    const original = inspectDataModel(validXml); const inputEdge = original.edges.find(e => e.id === input)!;
    const cases = [
      validXml.replace(`>${inputEdge.portId}</bpmn:targetRef>`, '>MissingPort</bpmn:targetRef>'),
      validXml.replace('>Ref</bpmn:sourceRef>', '>Ref</bpmn:sourceRef><bpmn:sourceRef>Ref</bpmn:sourceRef>'),
      validXml.replace(`id="${inputEdge.portId}"`, `id="${inputEdge.portId}"/><bpmn:dataInput id="${inputEdge.portId}"`),
      validXml.replace('</bpmndi:BPMNPlane>', `<bpmndi:BPMNShape id="DuplicateDI" bpmnElement="${input}"/></bpmndi:BPMNPlane>`),
    ];
    for (const invalid of cases) { const state = inspectDataModel(invalid); assert(!state.editable && state.edges.length === 1 && state.edges[0].id === output, 'Неоднозначная связь отображена'); }
    const missingNode = validXml.replace('dataObjectRef="Object"', 'dataObjectRef="Missing"');
    const state = inspectDataModel(missingNode);
    assert(!state.editable && !state.nodes.some(n => n.id === 'Ref') && state.edges.length === 1 && state.edges[0].id === output, 'Узел или связь с неверным определением отображены');
  });
  test('Переподключение и маршрут', () => { xml = editDataAssociation(xml, input, store, 'Task', [{ x: 0, y: 0 }, { x: 30, y: 30 }]); assert(inspectDataModel(xml).edges.find(e => e.id === input)?.dataId === store, 'Неверный источник'); throws(() => editDataAssociation(xml, input, store, 'Ref', points)); });
  test('Отказ от дубликатов и неверных направлений', () => { throws(() => addDataAssociation(xml, 'dataInputAssociation', store, 'Task', points)); throws(() => addDataAssociation(xml, 'dataOutputAssociation', store, 'Task', points)); throws(() => editDataAssociation(xml, output, 'Task', store, [{ x: NaN, y: 0 }, { x: 0, y: 0 }])); });
  test('Удаление связи с сохранением портов', () => { xml = removeDataAssociation(xml, input); assert(inspectDataModel(xml).edges.length === 1 && !xml.includes(`>${input}</`), 'Связь сохранилась'); });
  test('Каскад при удалении хранилища', () => { xml = removeDataStoreReference(xml, store); assert(inspectDataModel(xml).editable && !inspectDataModel(xml).edges.length && xml.includes('DataStore_'), 'Нарушено удаление'); });
  test('Очистка перед удалением задачи', () => { const r = removeDataConnectionsForNode(validXml, 'Task'); assert(inspectDataModel(r).edges.length === 0 && r.includes('id="Task"'), 'Задача удалена или связи остались'); });
  test('Несколько связей и независимое удаление', () => { const extra = addDataAssociation(validXml, 'dataInputAssociation', store, 'Task', points); const state = inspectDataModel(extra.xml); assert(state.editable && state.edges.length === 3 && new Set(state.edges.map(e => e.portId)).size === 3, 'Порты не независимы'); const removed = removeDataAssociation(extra.xml, extra.id); assert(inspectDataModel(removed).edges.length === 2, 'Удалены чужие связи'); });
  test('Обычная ассоциация блокирует удаление', () => { const mixed = validXml.replace('</bpmn:process>', `<bpmn:association id="Other" sourceRef="Task" targetRef="${store}"/></bpmn:process>`).replace('</bpmndi:BPMNPlane>', '<bpmndi:BPMNEdge id="Other_di" bpmnElement="Other"><di:waypoint x="1" y="2"/><di:waypoint x="3" y="4"/></bpmndi:BPMNEdge></bpmndi:BPMNPlane>'); assert(inspectDataModel(mixed).editable, 'Обычная association не распознана'); throws(() => removeDataStoreReference(mixed, store)); });
  test('XML и неподдерживаемые конструкции', () => { assert(!inspectDataModel('<!DOCTYPE x [<!ENTITY x "boom">]>' + base).editable, 'DTD принят'); assert(!inspectDataModel(validXml.replace('<bpmn:targetRef>', '<bpmn:sourceRef>Ref</bpmn:sourceRef><bpmn:targetRef>')).editable, 'Несколько источников приняты'); assert(!inspectDataModel(validXml.replace('</bpmn:ioSpecification>', '<bpmn:inputSet/></bpmn:ioSpecification>')).editable, 'Сложный IO принят'); assert(!inspectDataModel(validXml.replace('dataObjectRef="Object"', 'dataObjectRef="Missing"')).editable, 'Битая ссылка принята'); assert(!inspectDataModel(validXml.replace('id="Ref"', 'id="Task"')).editable, 'Дубликат ID принят'); assert(!inspectDataModel(validXml.replace('</bpmn:task>', '<bpmn:property id="P"/></bpmn:task>')).editable, 'Property принята'); });
  let mixedXml = '';
  test('Смешанная модель: дорожка, задачи, шлюзы и подпроцесс', () => {
    const kinds = ['userTask', 'serviceTask', 'manualTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'scriptTask', 'intermediateThrowEvent', 'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'complexGateway', 'eventBasedGateway', 'subProcess'];
    const flows = kinds.map((kind, i) => `<bpmn:${kind} id="N${i}" name="Узел ${i}"/>`).join('');
    const refs = ['Task', ...kinds.map((_, i) => `N${i}`)].map(id => `<bpmn:flowNodeRef>${id}</bpmn:flowNodeRef>`).join('');
    const shapes = kinds.map((kind, i) => `<bpmndi:BPMNShape id="N${i}_di" bpmnElement="N${i}"${kind === 'subProcess' ? ' isExpanded="false"' : ''}><dc:Bounds x="${200 + i * 100}" y="20" width="60" height="60"/></bpmndi:BPMNShape>`).join('');
    mixedXml = base.replace('<bpmn:task id="Task"/>', `<bpmn:laneSet id="LaneSet"><bpmn:lane id="Lane" name="Роль">${refs}</bpmn:lane></bpmn:laneSet><bpmn:task id="Task"><bpmn:outgoing>Flow</bpmn:outgoing></bpmn:task>${flows}<bpmn:sequenceFlow id="Flow" sourceRef="Task" targetRef="N0"/ >`.replace('/ >', '/>')).replace('<bpmndi:BPMNShape id="Task_di"', `<bpmndi:BPMNShape id="Lane_di" bpmnElement="Lane" isHorizontal="true"><dc:Bounds x="0" y="0" width="2000" height="180"/></bpmndi:BPMNShape>${shapes}<bpmndi:BPMNEdge id="Flow_di" bpmnElement="Flow"><di:waypoint x="1" y="2"/><di:waypoint x="3" y="4"/></bpmndi:BPMNEdge><bpmndi:BPMNShape id="Task_di"`);
    assert(inspectDataModel(mixedXml).editable, inspectDataModel(mixedXml).reason ?? 'Смешанная модель отклонена');
    const storeResult = addDataStore(mixedXml, 'Хранилище & архив', { x: 50, y: 200, width: 50, height: 60 });
    mixedXml = storeResult.xml;
    for (let i = 0; i < 7; i++) mixedXml = addDataAssociation(mixedXml, 'dataInputAssociation', 'Ref', `N${i}`, points).xml;
    mixedXml = addDataAssociation(mixedXml, 'dataOutputAssociation', 'N13', storeResult.id, points).xml;
    const state = inspectDataModel(mixedXml);
    assert(state.editable && state.edges.length === 8 && mixedXml.includes('isHorizontal="true"') && mixedXml.includes('isExpanded="false"') && mixedXml.includes('Хранилище &amp; архив'), state.reason ?? 'Потеря данных');
    const parsed = new DOMParser().parseFromString(mixedXml, 'application/xml');
    const round = new XMLSerializer().serializeToString(parsed);
    assert(inspectDataModel(round).editable && inspectDataModel(round).edges.length === 8, 'Ошибка round-trip');
    const edge = state.edges[0];
    const moved = editDataAssociation(round, edge.id, edge.from, edge.to, [{ x: 30, y: 40 }, { x: 200, y: 40 }]);
    assert(inspectDataModel(moved).edges.find(e => e.id === edge.id)?.points[0].x === 30, 'Маршрут не перемещён');
    const removed = removeDataConnectionsForNode(moved, 'N0');
    assert(inspectDataModel(removed).edges.length === 7 && removed.includes('id="Lane"') && removed.includes('id="N0"') && removed.includes('id="Flow"') && removed.includes('id="Flow_di"'), 'Каскад повредил модель');
    const removedStore = removeDataStoreReference(removed, storeResult.id);
    assert(inspectDataModel(removedStore).edges.length === 6 && removedStore.includes(`id="${storeResult.storeId}"`), 'Определение хранилища потеряно');
  });
  test('Смешанная модель: небезопасные конструкции блокируются', () => {
    const bad = [
      mixedXml.replace('isHorizontal="true"', 'isHorizontal="false"'),
      mixedXml.replace('isExpanded="false"', 'isExpanded="true"'),
      mixedXml.replace('<bpmn:flowNodeRef>Task</bpmn:flowNodeRef>', '<bpmn:flowNodeRef>Missing</bpmn:flowNodeRef>'),
      mixedXml.replace('id="N0"', 'id="N0" custom="x"'),
      mixedXml.replace('</bpmn:userTask>', '<bpmn:extensionElements/></bpmn:userTask>'),
      mixedXml.replace('</bpmn:userTask>', '<bpmn:ioSpecification/></bpmn:userTask>'),
      mixedXml.replace('</bpmn:process>', '<bpmn:timerEventDefinition id="Timer"/></bpmn:process>'),
      mixedXml.replace('bpmnElement="N0"', 'bpmnElement="Missing"'),
    ];
    for (const invalid of bad) { assert(!inspectDataModel(invalid).editable, 'Недопустимая смешанная модель принята'); throws(() => addDataStore(invalid, 'x', { x: 0, y: 0, width: 1, height: 1 })); }
  });
  test('Импортированный порт сохраняется после удаления связи', () => { const state = inspectDataModel(validXml); const port = state.edges[0].portId; const imported = validXml.replace(`id="${port}"`, `id="${port}" name="Внешний порт"`); const removed = removeDataAssociation(imported, state.edges[0].id); assert(inspectDataModel(removed).editable && removed.includes('Внешний порт') && removed.includes(`>${port}</`), 'Порт или набор утрачен'); });
  test('Порядок дорожек и числовой формат', () => { assert(!inspectDataModel(base.replace('<bpmn:task id="Task"/>', '<bpmn:task id="Task"/><bpmn:laneSet id="Late"/>')).editable, 'Поздний laneSet принят'); assert(!inspectDataModel(base.replace('x="100"', 'x="0x64"')).editable, 'Некорректное число принято'); });
  return { results, validXml, mixedXml, finalXml: xml };
}
