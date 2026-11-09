import { canConnectEpc, defaultEpcConnection, epcSilaConnectionCandidate, epcConnectionTypes, epcNotation, epcSymbols } from '../src/modeling/epc';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
export function runEpcTests() {
  const results: string[] = [];
  const test = (name: string, run: () => void) => { run(); results.push(name); };
  test('Каталог и изображения', () => {
    assert(new Set(epcSymbols.map(s => s.type)).size === epcSymbols.length, 'Дубликат символа');
    assert(epcSymbols.find(s => s.type === 'event')?.shape === 'hexagon', 'Неверная форма события');
    assert(epcSymbols.find(s => s.type === 'or')?.glyph === 'or' && epcSymbols.find(s => s.type === 'xor')?.glyph === 'xor', 'Неверные маркеры операторов');
    assert(new Set(epcConnectionTypes.map(e => e.id)).size === epcConnectionTypes.length, 'Дубликат связи');
  });
  test('Управляющий поток', () => {
    for (const from of ['event', 'function', 'process-interface', 'and', 'or', 'xor']) {
      for (const to of ['event', 'function', 'process-interface', 'and', 'or', 'xor']) {
        assert(canConnectEpc(from, to, 'flow') && defaultEpcConnection(from, to) === 'flow', `Поток ${from} → ${to}`);
      }
    }
    assert(!canConnectEpc('document', 'function', 'flow'), 'Документ не является узлом потока');
  });
  test('Направленные связи и выбор по умолчанию', () => {
    const cases = [
      ['document', 'function', 'input'], ['data', 'function', 'input'],
      ['function', 'document', 'output'], ['function', 'data', 'output'],
      ...['role', 'position', 'organization', 'application'].map(type => [type, 'function', 'resource']),
      ['risk', 'function', 'risk'], ['control', 'risk', 'control'], ['control', 'function', 'control'],
    ];
    for (const [from, to, edge] of cases) {
      assert(canConnectEpc(from, to, edge) && defaultEpcConnection(from, to) === edge, `Нет связи ${from} → ${to}: ${edge}`);
      assert(!canConnectEpc(to, from, edge), `Обратное направление ${edge} разрешено`);
    }
    assert(!canConnectEpc('risk', 'control', 'control') && !canConnectEpc('unknown', 'function', 'resource'), 'Неизвестные или неверные связи разрешены');
    assert(!canConnectEpc('event', 'function', 'unknown') && defaultEpcConnection('role', 'event') === undefined, 'Неизвестный тип принят');
  });
  test('Кандидаты сопоставления с SILA', () => {
    assert(epcSilaConnectionCandidate('document', 'function', 'input') === 'c_sila_is_input', 'Вход');
    assert(epcSilaConnectionCandidate('function', 'document', 'output') === 'c_sila_is_output', 'Выход');
    assert(epcSilaConnectionCandidate('role', 'function', 'resource') === 'c_sila_exec', 'Исполнитель');
    assert(epcSilaConnectionCandidate('application', 'function', 'resource') === 'c_sila_supports', 'Приложение');
    assert(epcSilaConnectionCandidate('event', 'function', 'flow') === undefined, 'Поток не имеет единого типа SILA');
    assert(epcSilaConnectionCandidate('function', 'document', 'input') === undefined, 'Направление не проверено');
    assert(epcSilaConnectionCandidate('risk', 'function', 'risk') === undefined, 'Риск не сопоставлен');
  });
  test('Расширенный каталог и правила', () => {
    const cases = [
      ...['digital-document', 'file', 'email', 'technical-term', 'product'].flatMap(type => [[type, 'function', 'input'], ['function', type, 'output']]),
      ...['group', 'internal-employee', 'external-employee', 'screen'].map(type => [type, 'function', 'resource']),
      ...['role', 'position', 'organization', 'group', 'internal-employee', 'external-employee'].flatMap(type => ['responsible', 'consults', 'informs'].map(edge => [type, 'function', edge])),
      ['application', 'function', 'supports'], ['screen', 'function', 'supports'],
      ['function', 'kpi', 'measured-by'], ['function', 'goal', 'contributes-to'],
    ];
    for (const [from, to, edge] of cases) {
      assert(epcSymbols.some(s => s.type === from) && epcSymbols.some(s => s.type === to), `Нет узла ${from} или ${to}`);
      assert(canConnectEpc(from, to, edge), `Нет связи ${from} → ${to}: ${edge}`);
      assert(!canConnectEpc(to, from, edge), `Неверное направление ${edge}`);
      assert(defaultEpcConnection(from, to) !== undefined, `Нет связи по умолчанию ${from} → ${to}`);
    }
    assert(!canConnectEpc('application', 'function', 'responsible'), 'Система не может быть ответственным');
    assert(!canConnectEpc('role', 'function', 'supports'), 'Роль не является системой');
    assert(epcConnectionTypes.filter(edge => edge.id !== 'flow').every(edge => 'stereotype' in edge && edge.stereotype), 'Семантика связи не отображается');
    for (const type of ['process-interface', 'control']) {
      const symbol = epcSymbols.find(item => item.type === type)!;
      assert(symbol.appearance?.icon === type && epcNotation.renderSymbolDetail(symbol), `${type}: нет собственной пиктограммы`);
    }
  });
  test('Сериализация новых связей и совместимость старых JSON', () => {
    let source = epcNotation.createEmpty();
    for (const [type, x, y] of [['function', 300, 200], ['internal-employee', 50, 50], ['kpi', 550, 200], ['goal', 300, 450]] as const) source = epcNotation.addNode(source, type, {x, y});
    const nodes = epcNotation.read(source).diagram.nodes;
    const id = (type: string) => nodes.find(node => node.type === type)!.id;
    source = epcNotation.connect(source, id('internal-employee'), id('function'), 'responsible');
    source = epcNotation.connect(source, id('function'), id('kpi'), 'measured-by');
    source = epcNotation.connect(source, id('function'), id('goal'), 'contributes-to');
    const result = epcNotation.read(source);
    assert(!result.readOnlyReason && result.diagram.edges.length === 3, 'Новые связи не читаются');
    assert(result.diagram.edges.every(edge => !!edge.stereotype), 'Не отображается смысл связи');
    source = epcNotation.rename(source, id('function'), 'Проверить заявку');
    assert(epcNotation.read(source).diagram.edges.length === 3, 'Связи потеряны при редактировании');
    const old = JSON.stringify({ format: 'business-board-graph', version: 1, notation: 'epc', nodes: [
      {id:'a', type:'function', label:'Старый', x:0, y:0, width:150, height:70},
      {id:'b', type:'function', label:'Шаг', x:300, y:0, width:150, height:70}
    ], edges: [{id:'e', type:'flow', label:'', from:'a', to:'b', points:[{x:150,y:35},{x:300,y:35}]}] });
    assert(!epcNotation.read(old).readOnlyReason, 'Старый поток стал недопустим');
    const changed = epcNotation.rename(old, 'a', 'Переименован');
    assert(epcNotation.read(changed).diagram.edges[0]?.id === 'e', 'Старый поток потерян');
    const future = JSON.stringify({...JSON.parse(old), extra: {important:true}});
    assert(!!epcNotation.read(future).readOnlyReason, 'Неизвестные данные должны оставаться защищены');
    let rejected = false; try { epcNotation.rename(future, 'a', 'x'); } catch { rejected = true; }
    assert(rejected, 'Неизвестные данные могут быть потеряны');
  });
  test('Создание модели, узлов и связи', () => {
    let source = epcNotation.createEmpty();
    source = epcNotation.addNode(source, 'event', { x: 10, y: 20 });
    source = epcNotation.addNode(source, 'function', { x: 250, y: 20 });
    let diagram = epcNotation.read(source).diagram;
    const event = diagram.nodes.find(node => node.type === 'event');
    const fn = diagram.nodes.find(node => node.type === 'function');
    assert(event && fn, 'Узлы не созданы');
    source = epcNotation.connect(source, event!.id, fn!.id, 'flow');
    diagram = epcNotation.read(source).diagram;
    assert(diagram.edges.some(edge => edge.type === 'flow' && edge.from === event!.id && edge.to === fn!.id), 'Поток не сохранён');
  });
  return results;
}

console.log(`EPC: ${runEpcTests().length} групп проверок пройдено`);
