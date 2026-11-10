import { getModelNotation, modelDefinitions } from '../src/modeling/registry';
import { canvasOverview, canvasContext, readCanvasObject } from '../src/aiCanvasContext';
import { emptyModel, type Model } from '../src/data';
import { planAiActions, exportCanvasObject } from '../src/aiCanvasTools';
import { runCanvasAgent } from '../src/aiCanvasAgent';
import { aiToolCatalog, validateAiActions, type AiAction, type AiEnvironment, type AiToolHost } from '../src/aiToolContract';
import { defaultSettings } from '../src/settings';
import type { ModelApi } from '../src/useModel';
import type { GenResult } from '../src/ai';
import { bpmnCollaborationFacade as bpmn } from '../src/modeling/bpmnCollaborationFacade';

const assert = (value: unknown, message = 'Проверка не пройдена'): asserts value => { if (!value) throw new Error(message); };
const equal = (a: unknown, b: unknown, message = 'Значения различаются') => assert(JSON.stringify(a) === JSON.stringify(b), message);
function rejects(fn: () => unknown) { let failed = false; try { fn(); } catch { failed = true; } assert(failed, 'Ожидался отказ'); }
const action = (tool: string, args: Record<string, unknown> = {}, key?: string): AiAction => ({ tool, arguments: args, ...(key ? { key } : {}) });
const env = (): AiEnvironment => ({ issues: [], settings: { ...defaultSettings }, view: { x: 0, y: 0, zoom: 1, width: 1000, height: 800, selectedIds: [], tree: true, panel: true, mode: 'select' }, canUndo: true, canRedo: true });
const seed = (): Model => ({ ...structuredClone(emptyModel), htmlObjects: [{ id: 'h', title: 'Виджет', html: '<button>Исходный код</button>' }], docs: [{ id: 'd', title: 'Документ', markdown: '# Документ\n\n## Раздел\nТекст', sections: [{ id: 's', title: 'Раздел' }] }], sources: [{ id: 'src', name: 'Источник', ext: 'PDF', pages: 4 }], gateways: [{ id: 'g', label: 'Решение' }] });
function memoryApi(initial: Model) {
  let model = structuredClone(initial);
  const past: Model[] = [], future: Model[] = [];
  const api: ModelApi = { get model() { return model; }, getModel: () => model, get canUndo() { return !!past.length; }, get canRedo() { return !!future.length; }, checkpoint() { past.push(model); future.length = 0; }, apply(fn) { api.checkpoint(); model = fn(model); }, applyLive(fn) { model = fn(model); }, undo() { const old = past.pop(); if (old) { future.push(model); model = old; return true; } return false; }, redo() { const next = future.pop(); if (next) { past.push(model); model = next; return true; } return false; }, bindExtra() {}, setRemote(next) { model = next; }, replace(next) { api.apply(() => next); } };
  return { api, past };
}

export async function runAiToolTests(dom = false) {
  const results: string[] = [];
  const test = async (name: string, fn: () => void | Promise<void>) => { await fn(); results.push(name); };
  await test('EPC/UML: создание, чтение, сохранение ID, связи, экспорт и удаление всех нотаций', () => {
    for (const definition of modelDefinitions) {
      const n = getModelNotation(definition.id)!;
      const first = planAiActions(seed(), [action('create_object', { kind: 'model', notation: n.id, title: `Проект: ${n.id}` }, 'm'), action('edit_model', { modelId: '$m', operations: [{ op: 'add_node', type: n.symbols[0].type, x: 120, y: 80, key: 'node' }, { op: 'rename', id: '$node', name: 'Актуальный элемент' }] }), action('connect_cards', { from: '$m', to: 'doc:d', label: 'Описывает' }), action('set_layout', { objects: [{ id: '$m', x: 30, y: 50, width: 600, height: 400 }] }), action('open_editor', { id: '$m' })], env());
      const id = first.aliases.get('m')!, nodeId = first.aliases.get('node')!, m = first.model.models[0];
      equal(n.read(m.source).diagram.nodes[0].label, 'Актуальный элемент');
      assert(first.refs.some((ref) => ref.kind === 'model' && ref.id === m.id));
      assert(canvasOverview(first.model).objects.some((o) => o.id === id));
      assert(canvasContext(first.model).includes('Актуальный элемент'));
      equal(readCanvasObject(first.model, id).content, m.source);
      equal(exportCanvasObject(first.model, id).content, m.source);
      equal(exportCanvasObject(first.model, id).filename, `Проект_ ${n.id}.${n.fileExtension}`);
      const next = planAiActions(first.model, [action('edit_model', { modelId: id, operations: [{ op: 'move_node', id: nodeId, x: 200, y: 100 }] })], env());
      equal(n.read(next.model.models[0].source).diagram.nodes[0].id, nodeId.slice(m.id.length + 1));
      const baseline = first.model, concurrent = structuredClone(baseline); concurrent.models[0].title = 'Правка коллеги';
      rejects(() => planAiActions(concurrent, [action('edit_model', { modelId: id, operations: [{ op: 'rename', id: nodeId, name: 'Потеря' }] })], env(), new Map(), baseline));
      const deleted = planAiActions(next.model, [action('delete_objects', { ids: [id] })], env());
      assert(!deleted.model.models.length && !deleted.model.cardLinks.length && !deleted.model.meta['layout:pos'][id]);
    }
  });
  await test('EPC: корректные потоки, исполнители, диагностика и атомарный отказ', () => {
    const initial = planAiActions(seed(), [action('create_object', { kind: 'model', notation: 'epc', title: 'Согласование' }, 'epc'), action('edit_model', { modelId: '$epc', operations: [{ op: 'add_node', type: 'event', x: 0, y: 0, key: 'start' }, { op: 'add_node', type: 'function', x: 0, y: 160, key: 'work' }, { op: 'add_node', type: 'event', x: 0, y: 320, key: 'end' }, { op: 'connect', from: '$start', to: '$work', type: 'flow', key: 'flow' }, { op: 'connect', from: '$work', to: '$end', type: 'flow' }, { op: 'add_node', type: 'role', x: 400, y: 160, key: 'role' }, { op: 'rename', id: '$role', name: 'Согласующий' }, { op: 'connect', from: '$role', to: '$work', type: 'resource' }] })], env());
    const data = initial.observations[1].result.data as { diagram: { edges: unknown[] }; validation: unknown[] };
    equal(data.diagram.edges.length, 3); assert(Array.isArray(data.validation));
    const id = initial.aliases.get('epc')!, before = JSON.stringify(initial.model);
    rejects(() => planAiActions(initial.model, [action('edit_model', { modelId: id, operations: [{ op: 'rename', id: initial.aliases.get('work'), name: 'Не сохранять' }, { op: 'connect', from: initial.aliases.get('start'), to: initial.aliases.get('end'), type: 'unknown' }] })], env()));
    equal(JSON.stringify(initial.model), before);
    rejects(() => planAiActions(initial.model, [action('edit_model', { modelId: id, operations: [{ op: 'rename', id: 'other:node', name: 'Чужой' }] })], env()));
  });
  await test('UML классы: атрибуты, операции, роли и кратности связей', () => {
    const plan = planAiActions(emptyModel, [action('create_object', { kind: 'model', notation: 'uml-class', title: 'Заказы' }, 'classes'), action('edit_model', { modelId: '$classes', operations: [{ op: 'add_node', type: 'class', x: 0, y: 0, key: 'order' }, { op: 'add_node', type: 'class', x: 400, y: 0, key: 'line' }, { op: 'set_compartments', id: '$order', attributes: ['+ id: UUID'], operations: ['+ submit(): void'] }, { op: 'connect', from: '$order', to: '$line', type: 'composition', key: 'items' }, { op: 'set_edge_ends', id: '$items', ends: { from: { role: 'заказ', multiplicity: '1' }, to: { role: 'позиции', multiplicity: '1..*' } } }] })], env());
    const diagram = getModelNotation('uml-class')!.read(plan.model.models[0].source).diagram;
    equal(diagram.nodes[0].compartments?.attributes, ['+ id: UUID']); equal(diagram.edges[0].ends?.to.multiplicity, '1..*');
  });
  await test('UML Sequence: сообщения, временные точки, переименование и удаление', () => {
    const plan = planAiActions(emptyModel, [action('create_object', { kind: 'model', notation: 'uml-sequence', title: 'Оформление заказа' }, 'seq'), action('edit_model', { modelId: '$seq', operations: [{ op: 'add_node', type: 'lifeline', x: 0, y: 0, key: 'client' }, { op: 'add_node', type: 'lifeline', x: 400, y: 0, key: 'server' }, { op: 'add_message', from: '$client', to: '$server', y: 150, type: 'sync', key: 'request' }, { op: 'rename', id: '$request', name: 'Создать заказ' }, { op: 'move_message', id: '$request', sendY: 180, receiveY: 180 }, { op: 'edit_message', id: '$request', type: 'async' }] })], env());
    const data = plan.observations[1].result.data as { timeline: { messages: { label: string; kind: string; send: { y: number } }[] } };
    equal(data.timeline.messages[0].label, 'Создать заказ'); equal(data.timeline.messages[0].kind, 'async');
    const id = plan.aliases.get('seq')!;
    assert(JSON.stringify(readCanvasObject(plan.model, id)).includes('Создать заказ'));
    rejects(() => planAiActions(plan.model, [action('edit_model', { modelId: id, operations: [{ op: 'connect', from: plan.aliases.get('client'), to: plan.aliases.get('server') }] })], env()));
    const removed = planAiActions(plan.model, [action('edit_model', { modelId: id, operations: [{ op: 'remove', id: plan.aliases.get('client') }] })], env());
    equal(getModelNotation('uml-sequence')!.timeline!.project(removed.model.models[0].source).messages.length, 0);
  });
  await test('EPC/UML: контракт отклоняет неизвестную нотацию, повторные ключи и неверные поля', () => {
    rejects(() => validateAiActions([action('create_object', { kind: 'model', notation: 'invented', title: 'x' }, 'm')]));
    rejects(() => validateAiActions([action('edit_model', { modelId: 'model:m', operations: [{ op: 'add_node', key: 'same' }, { op: 'add_message', key: 'same' }] })]));
    rejects(() => planAiActions(emptyModel, [action('create_object', { kind: 'model', title: 'x' }, 'm')], env()));
    rejects(() => planAiActions(emptyModel, [action('create_object', { kind: 'document', source: '{}', title: 'x' }, 'm')], env()));
    rejects(() => planAiActions(emptyModel, [action('create_object', { kind: 'model', notation: 'epc', source: '{}', title: 'x' }, 'm')], env()));
  });
  await test('EPC/UML: импорт, ограничения read-only, диагностика и ошибка в цикле агента', async () => {
    const n = getModelNotation('epc')!;
    let source = n.addNode(n.createEmpty(), 'function', { x: 100, y: 100 });
    const imported = planAiActions(emptyModel, [action('create_object', { kind: 'model', notation: 'epc', title: 'Импорт', source }, 'm')], env());
    equal(imported.model.models[0].source, source);
    const id = imported.aliases.get('m')!;
    const read = readCanvasObject(imported.model, id) as { model: { validation: unknown[] } };
    assert(read.model.validation.length > 0, 'Замечания EPC не возвращены модели');
    const frozen = structuredClone(imported.model), document = JSON.parse(source); document.version = 999;
    frozen.models[0].source = JSON.stringify(document);
    rejects(() => planAiActions(frozen, [action('edit_model', { modelId: id, operations: [{ op: 'rename', id: document.nodes[0].id, name: 'Потеря' }] })], env()));
    rejects(() => planAiActions(frozen, [action('update_object', { id, source })], env()));
    const { api } = memoryApi(imported.model);
    let round = 0;
    const result = await runCanvasAgent({ prompt: 'Переименовать функцию', model: '6.1-sol', history: [], projectId: 'test', api, signal: new AbortController().signal,
      host: () => ({ snapshot: env, execute: async () => ({ ok: true, summary: 'OK' }) }), onDelta() {}, render: async () => {},
      generate: async (_prompt, _model, _context, _history, _event, _signal, _project, observations) => {
        round++;
        if (round === 1) return { reply: '', actions: [action('edit_model', { modelId: id, operations: [{ op: 'add_message', from: 'x', to: 'y', y: 100 }] })] } as GenResult;
        if (round === 2) { assert(observations?.some(o => !o.result.ok && o.result.error?.includes('не поддерживает'))); return { reply: '', actions: [action('edit_model', { modelId: id, operations: [{ op: 'rename', id: document.nodes[0].id, name: 'Согласовать заказ' }] })] } as GenResult; }
        assert(observations?.some(o => o.action.tool === 'edit_model' && o.result.ok));
        return { reply: 'Функция переименована' } as GenResult;
      },
    });
    equal(n.read(api.model.models[0].source).diagram.nodes[0].label, 'Согласовать заказ');
    equal(result.reply, 'Функция переименована'); equal(round, 3);
  });
  await test('Уточнение во время ответа заменяет старый план и сохраняет исходную задачу', async () => {
    const { api } = memoryApi(emptyModel); let round = 0; const pending: string[] = [];
    const result = await runCanvasAgent({ prompt: 'Сделай модель БД телеграм-бота стоматологии', model: '6.1-sol', history: [], projectId: 'test', api, signal: new AbortController().signal,
      host: () => ({ snapshot: env, execute: async () => ({ ok: true, summary: 'OK' }) }), onDelta() {}, render: async () => {}, takeMessages: () => pending.splice(0),
      generate: async (prompt, _model, _context, history) => {
        round++;
        if (round === 1) { pending.push('используй UML', 'добавь пациента'); return { reply: '', actions: [action('create_object', { kind: 'document', title: 'Устаревший план' }, 'stale')] } as GenResult; }
        equal(prompt, 'добавь пациента');
        assert(history.some(t => t.text.includes('стоматологии')) && history.some(t => t.text === 'используй UML'));
        if (round === 2) return { reply: '', actions: [action('create_object', { kind: 'model', notation: 'uml-class', title: 'БД стоматологии' }, 'db')] } as GenResult;
        return { reply: 'Создана UML-модель БД стоматологии' } as GenResult;
      },
    });
    equal(api.model.docs.length, 0); equal(api.model.models.length, 1); equal(round, 3);
    assert(result.reply.includes('стоматологии'));
  });
  await test('Контракт: запрет неизвестных команд, лишних полей и некорректных координат', () => {
    assert(aiToolCatalog.length >= 20);
    for (const value of [[action('shell', {})], [action('read_canvas', { projectId: 'чужой' })], [action('set_view', { zoom: 99 })], [action('create_object', { kind: 'html', title: 'x' })], [action('set_properties', { targetType: 'card', id: 'html:h', values: JSON.parse('{"__proto__":"x"}') })]]) rejects(() => validateAiActions(value));
    rejects(() => validateAiActions([action('read_canvas'), action('clear_canvas')]));
    rejects(() => validateAiActions([action('history', { direction: 'undo' }), action('clear_canvas')]));
    rejects(() => validateAiActions([action('create_object', { kind: 'html', title: 'A' }, 'same'), action('create_object', { kind: 'document', title: 'B' }, 'same')]));
  });
  await test('Все типы карточек, точный HTML/Markdown и ссылки на результаты', () => {
    const result = planAiActions(emptyModel, [action('create_object', { kind: 'html', title: 'Счётчик', html: '\n<button>0</button>\n' }, 'widget'), action('create_object', { kind: 'document', title: 'Инструкция', markdown: '## Раздел\nТекст' }, 'doc'), action('create_object', { kind: 'source', title: 'Основание', ext: 'PDF', pages: 8 }, 'source'), action('create_object', { kind: 'gateway', title: 'Решение' }, 'gateway'), action('connect_cards', { from: '$widget', to: '$doc', label: 'Описывает', fromSide: 'right', fromOffset: 0.25 }, 'link'), action('set_layout', { objects: [{ id: '$widget', x: 20, y: 40, width: 500, height: 400 }] })], env());
    equal(result.model.htmlObjects[0].html, '\n<button>0</button>\n');
    assert(result.model.docs[0].sections.length === 1);
    assert(result.model.cardLinks[0].from === result.aliases.get('widget'));
    assert(result.model.meta['layout:pos'][result.aliases.get('widget')!] === '20,40');
    assert(result.model.meta['layout:size'][result.aliases.get('widget')!] === '500,400');
  });
  await test('Правки существующих объектов и стабильность ID пунктов', () => {
    const result = planAiActions(seed(), [action('update_object', { id: 'html:h', title: 'Готово', html: '<input value="новый">' }), action('update_object', { id: 'doc:d', markdown: '# Документ\n\n## Раздел\nНовый текст' }), action('update_object', { id: 'src:src', pages: 10, ext: 'DOCX' }), action('update_object', { id: 'gw:g', title: 'Условие' })], env());
    equal(result.model.htmlObjects[0].html, '<input value="новый">'); equal(result.model.docs[0].sections[0].id, 's'); equal(result.model.sources[0].pages, 10); equal(result.model.gateways[0].label, 'Условие');
    rejects(() => planAiActions(seed(), [action('update_object', { id: 'html:h', markdown: 'wrong' })], env()));
  });
  await test('Ошибка второго действия откатывает весь пакет до применения', () => {
    const before = seed(), json = JSON.stringify(before);
    rejects(() => planAiActions(before, [action('create_object', { kind: 'html', title: 'Не должен появиться' }, 'new'), action('connect_cards', { from: '$new', to: 'doc:foreign-project' })], env()));
    equal(JSON.stringify(before), json);
    rejects(() => planAiActions(before, [action('set_layout', { objects: [{ id: 'html:h', x: 10 }] })], env()));
  });
  await test('Свойства проверяют имена, варианты значений и удаление атрибутов', () => {
    const result = planAiActions(seed(), [action('set_properties', { targetType: 'card', id: 'html:h', values: { description: 'Пример', owner: 'Автор' } }), action('set_properties', { targetType: 'card', id: 'html:h', values: { owner: null } }), action('set_properties', { targetType: 'section', id: 's', values: { status: 'Согласован' } })], env());
    equal(result.model.meta['card:html:h'], { description: 'Пример' });
    rejects(() => planAiActions(seed(), [action('set_properties', { targetType: 'card', id: 'html:h', values: { 'layout:pos': 'x' } })], env()));
    rejects(() => planAiActions(seed(), [action('set_properties', { targetType: 'section', id: 's', values: { status: 'выдуман' } })], env()));
  });
  await test('Связи: подпись, переподключение, маршрут, удаление и защита от петель', () => {
    const result = planAiActions(seed(), [action('connect_cards', { from: 'html:h', to: 'doc:d', label: 'A' }, 'l'), action('update_card_link', { id: '$l', to: 'gw:g', label: 'B', routePoints: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }), action('update_card_link', { id: '$l', resetRoute: true })], env());
    equal(result.model.cardLinks[0].to, 'gw:g'); equal(result.model.cardLinks[0].label, 'B'); assert(!result.model.cardLinks[0].routePoints);
    const deleted = planAiActions(result.model, [action('delete_card_links', { ids: [result.model.cardLinks[0].id] })], env()); assert(!deleted.model.cardLinks.length);
    rejects(() => planAiActions(seed(), [action('connect_cards', { from: 'html:h', to: 'html:h' })], env()));
  });
  await test('Удаление карточки очищает её связи, свойства и раскладку', () => {
    const before = seed(); before.cardLinks = [{ id: 'l', from: 'html:h', to: 'doc:d', label: '' }]; before.meta = { 'card:html:h': { description: 'x' }, 'layout:pos': { 'html:h': '1,2', 'doc:d': '3,4' } };
    const result = planAiActions(before, [action('delete_objects', { ids: ['html:h'] })], env());
    assert(!result.model.htmlObjects.length && !result.model.cardLinks.length); assert(!result.model.meta['card:html:h']); equal(result.model.meta['layout:pos'], { 'doc:d': '3,4' });
    const cleared = planAiActions(before, [action('clear_canvas')], env()); equal(cleared.model, emptyModel);
  });
  await test('Чтение полного HTML частями и безопасный экспорт', () => {
    const before = seed(); before.htmlObjects[0].html = 'Ю'.repeat(25000);
    const read = planAiActions(before, [action('read_object', { id: 'html:h', offset: 12000, limit: 12000 }), action('read_canvas')], env());
    const value = read.observations[0].result.data as { content: string; truncated: boolean; nextOffset: number };
    equal(value.content.length, 12000); assert(value.truncated && value.nextOffset === 24000 && !read.changed);
    equal(exportCanvasObject(before, 'html:h').content, before.htmlObjects[0].html);
    equal(exportCanvasObject(before, 'doc:d').filename, 'Документ.md'); equal(exportCanvasObject(before, 'src:src').mime, 'application/json');
  });
  await test('Защита от перезаписи изменений, сделанных во время генерации', () => {
    const baseline = seed(), latest = seed(); latest.htmlObjects[0].html = 'Правка коллеги';
    rejects(() => planAiActions(latest, [action('update_object', { id: 'html:h', html: 'Старый текст' })], env(), new Map(), baseline));
    equal(latest.htmlObjects[0].html, 'Правка коллеги');
  });
  await test('Замечания: создание, статусы, история, выбор и закрытие автоматических', () => {
    const environment = env(); environment.issues = [{ id: 'auto-1', auto: true, title: 'Авто', status: 'open', summary: '', question: '' }];
    const result = planAiActions(seed(), [action('create_issue', { title: 'Ручное', summary: 'Проверить' }, 'issue'), action('update_issue', { id: '$issue', status: 'answered', answer: 'Ответ' }), action('select_issue', { id: '$issue' }), action('delete_issue', { id: 'auto-1' })], environment);
    const updated = result.effects[1].arguments.issue as { status: string; answer: string; history: unknown[] };
    equal((result.effects[0].arguments.issue as { status: string }).status, 'open');
    equal(updated.status, 'answered'); equal(updated.answer, 'Ответ'); equal(updated.history.length, 2); assert(result.effects[3].arguments.closeAuto);
    equal((result.effects[3].arguments.issue as { status: string }).status, 'closed');
    equal(environment.issues[0].status, 'open');
  });
  await test('Команды вида и редакторов проверяют объекты и передают актуальные ID', () => {
    const result = planAiActions(seed(), [action('set_view', { zoom: 0.75, fit: true, selectedIds: ['html:h'], panel: false }), action('open_editor', { id: 'html:h' }), action('show_properties', { targetType: 'section', id: 's' }), action('export_object', { id: 'doc:d' })], env());
    equal(result.effects.length, 4); equal(result.effects[0].arguments.selectedIds, ['html:h']);
    rejects(() => planAiActions(seed(), [action('open_editor', { id: 'src:src' })], env()));
    rejects(() => planAiActions(seed(), [action('show_properties', { targetType: 'card', id: 'gw:g' })], env()));
    equal(planAiActions(seed(), [action('history', { direction: 'undo' })], env()).effects[0].tool, 'history');
  });
  await test('Агент: прочитать два фрагмента и изменить полный текст без потерь', async () => {
    const { api, past } = memoryApi(seed()); const code = '<main>' + 'Данные'.repeat(3000) + '</main>'; api.applyLive((m) => ({ ...m, htmlObjects: [{ ...m.htmlObjects[0], html: code }] }));
    let calls = 0;
    const responses: GenResult[] = [{ reply: 'Читаю', actions: [action('read_object', { id: 'html:h', limit: 12000 })] }, { reply: 'Читаю продолжение', actions: [action('read_object', { id: 'html:h', offset: 12000, limit: 12000 })] }, { reply: 'Меняю', actions: [action('update_object', { id: 'html:h', html: code + '<!-- готово -->' })] }, { reply: 'Проверяю', actions: [action('read_html_test', { id: 'html:h', steps: [{ op: 'expect_text', selector: 'main', text: 'Данные'.repeat(3000).slice(0, 100) }] })] }, { reply: 'Изменено' }];
    const result = await runCanvasAgent({ prompt: 'Дополни код', model: '6.1-sol', history: [], projectId: 'test', signal: new AbortController().signal, api, host: () => ({ snapshot: env, execute: async () => ({ ok: true, summary: 'ok' }) }), onDelta() {}, render: async () => {}, generate: async (_p, _m, _c, _h, _ev, _s, _id, observations) => { if (calls) assert(observations!.length === calls); return responses[calls++]; } });
    equal(calls, 5); equal(api.getModel().htmlObjects[0].html, code + '<!-- готово -->'); equal(past.length, 1); api.undo(); equal(api.getModel().htmlObjects[0].html, code); equal(result.reply, 'Изменено');
  });
  await test('Агент: неверный пакет исправляется без частичных изменений', async () => {
    const { api, past } = memoryApi(emptyModel); let calls = 0;
    await runCanvasAgent({ prompt: 'Создай', model: '6.1-sol', history: [], projectId: 'test', signal: new AbortController().signal, api, host: () => ({ snapshot: env, execute: async () => ({ ok: true, summary: 'ok' }) }), onDelta() {}, render: async () => {}, generate: async (_p, _m, _c, _h, _ev, _s, _id, observations) => {
      calls++; if (calls === 1) return { reply: 'x', actions: [action('create_object', { kind: 'html', title: 'x' }, 'h'), action('update_object', { id: 'doc:foreign', title: 'bad' })] };
      if (calls > 3) return { reply: 'Готово' };
      if (calls === 3) return { reply: 'Проверяю', actions: [action('read_html_test', { id: '$h', steps: [{ op: 'expect_text', selector: 'h1', text: 'x' }] })] };
      equal(api.getModel().htmlObjects.length, 0); assert(observations![0].result.ok === false);
      return { reply: 'Готово', actions: [action('create_object', { kind: 'html', title: 'x' }, 'h')] };
    } });
    equal(api.getModel().htmlObjects.length, 1); equal(past.length, 1);
  });
  await test('Агент: ошибка внешнего действия не дублирует уже созданный объект', async () => {
    const { api } = memoryApi(emptyModel); let calls = 0, saved = 0;
    const host: AiToolHost = { snapshot: env, execute: async (effect) => { if (effect.tool === 'read_html_test') return { ok: true, summary: 'Проверено' }; if (!saved++) throw new Error('Нет связи'); return { ok: true, summary: 'Сохранено' }; } };
    await runCanvasAgent({ prompt: 'Создай виджет и замечание', model: '6.1-sol', history: [], projectId: 'test', signal: new AbortController().signal, api, host: () => host, onDelta() {}, render: async () => {}, generate: async () => { calls++; if (calls === 3) return { reply: 'Проверяю', actions: [action('read_html_test', { id: '$h', steps: [{ op: 'expect_text', selector: 'h1', text: 'x' }] })] }; return calls > 3 ? { reply: 'Готово' } : { reply: 'Создаю', actions: [action('create_object', { kind: 'html', title: 'x' }, 'h'), action('create_issue', { title: 'Проверить' }, 'issue')] }; } });
    equal(calls, 4); equal(api.getModel().htmlObjects.length, 1); equal(saved, 2);
  });
  await test('Отмена до ответа не меняет модель', async () => {
    const { api } = memoryApi(emptyModel), controller = new AbortController(); controller.abort(); let generated = false;
    try { await runCanvasAgent({ prompt: 'x', model: '6.1-sol', history: [], projectId: 'test', signal: controller.signal, api, host: () => ({ snapshot: env, execute: async () => ({ ok: true, summary: 'x' }) }), onDelta() {}, generate: async () => { generated = true; return { reply: 'x' }; } }); } catch { /* ожидаем AbortError */ }
    assert(!generated); equal(api.getModel(), emptyModel);
  });
  await test('HTML: проверка обязательна, ошибка возвращается ИИ, исправление требует нового теста', async () => {
    const { api } = memoryApi(emptyModel); let calls = 0, checks = 0;
    const host: AiToolHost = { snapshot: env, execute: async () => ++checks === 1 ? { ok: false, summary: 'Ошибка', error: 'Ожидалось 300,00, получено —' } : { ok: true, summary: '300,00 подтверждено' } };
    const check = { reply: 'Проверяю', actions: [action('read_html_test', { id: '$calc', steps: [{ op: 'click', selector: '#calc' }, { op: 'expect_text', selector: '#total', text: '300,00' }] })] };
    const responses: GenResult[] = [{ reply: 'Создаю', actions: [action('create_object', { kind: 'html', title: 'Расчёт', html: '<output id="total">—</output>' }, 'calc')] }, { reply: 'Всё работает' }, check, { reply: 'Исправляю', actions: [action('update_object', { id: '$calc', html: '<output id="total">300,00</output>' })] }, check, { reply: 'Проверено на 100 × 3' }];
    const result = await runCanvasAgent({ prompt: 'Калькулятор', model: '6.1-sol', history: [], projectId: 'test', signal: new AbortController().signal, api, host: () => host, onDelta() {}, render: async () => {}, generate: async (_p, _m, _c, _h, _ev, _s, _id, observations) => {
      if (calls === 2) assert(observations!.some((o) => o.result.error?.includes('ещё не проверен')));
      if (calls === 3) assert(observations!.some((o) => o.result.error?.includes('получено —')));
      return responses[calls++];
    } });
    equal(calls, 6); equal(checks, 2); equal(result.reply, 'Проверено на 100 × 3');
    rejects(() => planAiActions(api.getModel(), [action('read_html_test', { id: 'html:' + api.getModel().htmlObjects[0].id, steps: [{ op: 'click', selector: 'button' }] })], env()));
  });
  await test('HTML: успешный тест старого кода не подтверждает новую правку', async () => {
    const { api } = memoryApi(seed()); let calls = 0, checks = 0;
    const check = { reply: 'Проверяю', actions: [action('read_html_test', { id: 'html:h', steps: [{ op: 'expect_text', selector: 'output', text: '1' }] })] };
    const responses: GenResult[] = [{ reply: 'Правлю', actions: [action('update_object', { id: 'html:h', html: '<output>1</output>' })] }, check, { reply: 'Правлю снова', actions: [action('update_object', { id: 'html:h', html: '<output>2</output>' })] }, { reply: 'Готово' }, check, { reply: 'Повторно проверено' }];
    const result = await runCanvasAgent({ prompt: 'Правка', model: '6.1-sol', history: [], projectId: 'test', signal: new AbortController().signal, api, host: () => ({ snapshot: env, execute: async () => { checks++; return { ok: true, summary: 'Проверено' }; } }), onDelta() {}, render: async () => {}, generate: async () => responses[calls++] });
    equal(checks, 2); equal(result.reply, 'Повторно проверено');
  });

  if (dom) {
    await test('BPMN: изменение существующей схемы, все ссылки и привязка пункта', () => {
      const result = planAiActions(emptyModel, [action('create_object', { kind: 'process', title: 'Согласование' }, 'p'), action('create_object', { kind: 'document', title: 'Порядок', markdown: '## Проверка\nТекст' }, 'd'), action('edit_bpmn', { processId: '$p', operations: [{ op: 'add_node', type: 'userTask', x: 320, y: 140, key: 'task' }, { op: 'rename', id: '$task', name: 'Проверить заявку' }, { op: 'add_node', type: 'endEvent:message', x: 520, y: 162, key: 'end' }, { op: 'connect', from: 'StartEvent_1', to: '$task', type: 'sequenceFlow', key: 'flow' }, { op: 'connect', from: '$task', to: '$end', type: 'sequenceFlow' }] }), action('link_section', { nodeId: '$task', sectionId: '$d/section/1' }, 'coverage'), action('set_properties', { targetType: 'node', id: '$task', values: { executor: 'Менеджер' } })], env());
      const process = result.model.processes[0], diagram = bpmn.read(process.xml).diagram;
      assert(diagram.nodes.some((n) => n.type === 'userTask' && n.label === 'Проверить заявку'));
      equal(diagram.edges.length, 2); equal(result.model.links.length, 1);
      const second = planAiActions(result.model, [action('edit_bpmn', { processId: '$p', operations: [{ op: 'move_node', id: '$task', x: 340, y: 140 }, { op: 'add_node', type: 'textAnnotation', x: 650, y: 250, key: 'note' }, { op: 'resize_node', id: '$note', width: 140, height: 90 }, { op: 'rename', id: '$flow', name: 'Передать' }, { op: 'edit_edge', id: '$flow', from: 'StartEvent_1', to: '$task', points: [{ x: 218, y: 180 }, { x: 340, y: 180 }] }, { op: 'reset_edge', id: '$flow' }, { op: 'set_label_bounds', id: '$flow', x: 230, y: 180, width: 80, height: 20 }] }), action('unlink_section', { id: '$coverage' })], env(), result.aliases);
      equal(second.model.links.length, 0); equal(bpmn.read(second.model.processes[0].xml).diagram.nodes.find((n) => n.type === 'textAnnotation')!.width, 140);
      const removed = planAiActions(second.model, [action('edit_bpmn', { processId: '$p', operations: [{ op: 'remove', id: '$note' }] })], env(), second.aliases);
      assert(!bpmn.read(removed.model.processes[0].xml).diagram.nodes.some((n) => n.type === 'textAnnotation'));
      const state = JSON.stringify(second.model);
      rejects(() => planAiActions(second.model, [action('edit_bpmn', { processId: '$p', operations: [{ op: 'rename', id: '$task', name: 'Не сохранять' }, { op: 'connect', from: '$task', to: 'foreign', type: 'sequenceFlow' }] })], env(), result.aliases));
      equal(JSON.stringify(second.model), state);
    });
    await test('BPMN: дорожки, пулы, сообщения и геометрия', () => {
      const lane = planAiActions(emptyModel, [action('create_object', { kind: 'process', title: 'Дорожки' }, 'p'), action('edit_bpmn', { processId: '$p', operations: [{ op: 'add_region', x: 100, y: 100, key: 'lane' }, { op: 'rename', id: '$lane', name: 'Исполнитель' }, { op: 'resize_region', id: '$lane', width: 1000, height: 200 }, { op: 'set_region_rows', id: '$lane', count: 2 }] })], env());
      equal(bpmn.read(lane.model.processes[0].xml).diagram.regions!.length, 2);
      const pool = planAiActions(emptyModel, [action('create_object', { kind: 'process', title: 'Пулы' }, 'p'), action('edit_bpmn', { processId: '$p', operations: [{ op: 'add_pool', x: 100, y: 500, key: 'external' }, { op: 'rename', id: '$external', name: 'Поставщик' }, { op: 'move_region', id: '$external', x: 120, y: 550 }] })], env());
      const diagram = bpmn.read(pool.model.processes[0].xml).diagram;
      equal(diagram.regions!.length, 2); assert(diagram.regions!.some((r) => r.label === 'Поставщик'));
      const main = diagram.regions!.find((r) => r.label !== 'Поставщик')!.id;
      const connected = planAiActions(pool.model, [action('edit_bpmn', { processId: '$p', operations: [{ op: 'connect', from: main, to: '$external', type: 'messageFlow' }] })], env(), pool.aliases);
      assert(bpmn.read(connected.model.processes[0].xml).diagram.edges.some((e) => e.type === 'messageFlow'));
    });
    await test('BPMN: каждый символ палитры доступен ИИ через тот же адаптер', () => {
      for (const symbol of bpmn.symbols) {
        const result = planAiActions(emptyModel, [action('create_object', { kind: 'process', title: symbol.title }, 'p'), action('edit_bpmn', { processId: '$p', operations: [{ op: 'add_node', type: symbol.type, x: 400, y: 200, key: 'node' }] })], env());
        assert(bpmn.read(result.model.processes[0].xml).diagram.nodes.length >= 2, symbol.type);
      }
    });
  }
  return { status: 'passed', count: results.length, results };
}
