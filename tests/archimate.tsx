import { createRoot } from 'react-dom/client';
import { IndependentModelPreview } from '../src/Canvas';
import IndependentModelEditor from '../src/IndependentModelEditor';
import { AddMaterialDialog } from '../src/AddMaterialDialog';
import { archimateConnections, archimateNotation as n, archimateSymbols } from '../src/modeling/archimate';
import { endpointsFaceOutward, segmentCrossesNode } from '../src/modeling/diagramRouting';
import { hasSelfIntersections } from '../src/modeling/orthogonalRouting';
import { objectCatalog } from '../src/objectCatalog';
import { normalizeModel } from '../src/normalize';
import '../src/styles.css';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function add(source: string, rows: [string, number, number][]) {
  return rows.reduce((value, [type, x, y]) => n.addNode(value, type, { x, y }), source);
}
const result = document.querySelector<HTMLElement>('#result')!;
const root = createRoot(document.getElementById('root')!);
try {
  assert(objectCatalog.some(c => c.id === 'archimate' && c.types.some(t => t.id === n.id)), 'Нет ArchiMate в каталоге');
  const catalog = add(n.createEmpty(), archimateSymbols.map((s, i) => [s.type, i * 190, 0]));
  assert(n.read(catalog).diagram.nodes.length === archimateSymbols.length, 'Не все символы сохраняются');
  const base = add(n.createEmpty(), [['business-role', 100, 120], ['business-process', 620, 120], ['application-service', 350, 120], ['goal', 620, 350]]);
  const [a, b, obstacle, c] = n.read(base).diagram.nodes;
  for (const type of archimateConnections) {
    const linked = n.connect(base, a.id, b.id, type.id);
    const edge = n.read(linked).diagram.edges[0];
    assert(edge.type === type.id && endpointsFaceOutward(edge.points, a, b), `${type.id}: неверный конец связи`);
    assert(!hasSelfIntersections(edge.points) && !edge.points.slice(1).some((point, i) => segmentCrossesNode(edge.points[i], point, obstacle)), `${type.id}: не обходит препятствие`);
    for (const [key, value] of Object.entries(type.appearance ?? {})) assert(edge[key as keyof typeof edge] === value, `${type.id}: потерян вид связи ${key}`);
  }
  let linked = n.connect(base, a.id, b.id);
  const original = n.read(linked).diagram.edges[0];
  assert(original.type === 'association' && original.arrowEnd === false, 'Не та автоматическая связь');
  linked = n.rename(linked, original.id, 'Участие');
  const manual = [{ x: 180, y: 184 }, { x: 180, y: 274 }, { x: 700, y: 274 }, { x: 700, y: 350 }];
  linked = n.editEdge(linked, original.id, a.id, c.id, manual);
  const moved = n.moveNode(linked, a.id, { x: 630, y: 354 });
  const resized = n.resizeNode!(moved, a.id, 180, 90);
  const normalized = normalizeModel({ models: [{ id: 'test', title: 'Модель', notation: n.id, source: resized }] });
  assert(normalized.models[0].source === resized, 'Изменён исходник при чтении проекта');
  const saved = n.read(normalized.models[0].source).diagram.edges[0];
  assert(saved.id === original.id && saved.label === 'Участие' && saved.to === c.id && saved.from === a.id, 'Потеря ID, подписи или концов при наложении');
  assert(saved.points[0].x === 720 && saved.points[0].y === 444, 'Масштабирование сорвало привязку');
  result.textContent = `Пройдено: ${archimateSymbols.length} фигур, ${archimateConnections.length} вариантов связей, маршруты, наложение и чтение проекта.`;
  result.dataset.status = 'passed';

  let source = add(n.createEmpty(), [['business-role', 100, 130], ['business-process', 520, 130], ['application-service', 520, 350], ['node', 100, 350], ['goal', 810, 350]]);
  const [role, process, service] = n.read(source).diagram.nodes;
  source = n.rename(source, role.id, 'Менеджер');
  source = n.rename(source, process.id, 'Приём заказа');
  source = n.rename(source, service.id, 'Сервис заказов');
  source = n.connect(source, service.id, process.id, 'serving');
  const fixture = { id: 'archimate-demo', title: 'Обработка заказов', notation: n.id, source };
  const chooser = new URLSearchParams(location.search).has('chooser');
  function render(mode: 'editor' | 'preview' | 'chooser' = 'editor') {
    root.render(mode === 'chooser' ? <AddMaterialDialog counts={{ processes: 0, docs: 0, htmlObjects: 0 }} onAddModel={(title, type) => { assert(type === n.id, 'Выбран другой тип'); fixture.title = title; fixture.source = n.createEmpty(); }} onAddDoc={() => {}} onAddHtml={() => {}} onAddSource={() => {}} onClose={() => render()} /> : mode === 'preview' ? <div style={{ position: 'relative', width: 'min(94vw, 600px)', height: 340 }}><button onClick={() => render()}>Открыть редактор</button><IndependentModelPreview model={fixture} /></div> : <IndependentModelEditor model={fixture} onClose={() => render('preview')} onSave={(title, source) => { fixture.title = title; fixture.source = source; (window as Window & { savedNotationSource?: string }).savedNotationSource = source; render('preview'); }} />);
  }
  render(chooser ? 'chooser' : 'editor');
} catch (error) {
  result.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`;
  result.dataset.status = 'failed';
}
