import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Tree } from '../src/Tree';
import { useTreeWidth } from '../src/TreeResizeHandle';
import '../src/styles.css';

const storageKey = 'bb.tree.width.fixture.v1';
const name = 'Очень длинное название объекта навигатора для проверки обрезки на одной строке';
function Fixture() {
  const [width, setWidth] = useTreeWidth(storageKey);
  const [collapsed, setCollapsed] = useState(false);
  return <div className="workspace" style={{ gridTemplateColumns: `${collapsed ? '44px' : `clamp(192px, ${width}px, calc(100% - 320px))`} minmax(0, 1fr)` }}>
    <Tree width={width} onWidthChange={setWidth} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} sources={[{ id: 'source', name, ext: 'PDF', pages: 1 }]} docs={[{ id: 'doc', title: name, markdown: '', sections: [] }]} processes={[{ id: 'proc', title: name, xml: '' }]} models={[{ id: 'epc', title: name, notation: 'epc', source: '' }, { id: 'uml', title: name, notation: 'uml-class', source: '' }]} htmlObjects={[{ id: 'html', title: name, html: '' }]} onEditModel={() => {}} onFindCard={() => {}} onDeleteCard={() => {}} onEditHtml={() => {}} selectedCards={[]} onAddMaterial={() => {}} />
    <main style={{ minWidth: 320, padding: 24 }}>Канвас · локальный стенд без записи на сервер</main>
  </div>;
}
function Root() {
  const [version, setVersion] = useState(0);
  return <div className="app"><header className="topbar"><button id="remount" onClick={() => setVersion(value => value + 1)}>Пересоздать панель</button><output id="result">Выполняется…</output></header><Fixture key={version} /></div>;
}
createRoot(document.getElementById('root')!).render(<Root />);
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const pane = () => document.querySelector<HTMLElement>('.tree-pane')!;
const handle = () => document.querySelector<HTMLElement>('[aria-label="Ширина навигатора"]')!;
const key = async (value: string) => { handle().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })); await pause(); };
const width = () => pane().getBoundingClientRect().width;
try {
  await pause(); await pause();
  await key('Home');
  assert(width() === 192, 'Минимальная ширина не соблюдена');
  const labels = Array.from(document.querySelectorAll<HTMLElement>('.tree-label, .tree-model-title'));
  assert(labels.length === 6, 'Не все виды объектов проверены');
  for (const label of labels) {
    const css = getComputedStyle(label);
    assert(css.whiteSpace === 'nowrap' && css.textOverflow === 'ellipsis' && css.overflow === 'hidden', 'Название не обрезается с многоточием');
    assert(label.scrollWidth > label.clientWidth && label.getBoundingClientRect().height <= 20, 'Название не осталось в одной строке');
    assert(label.title === name, 'Полное название недоступно при наведении');
  }
  assert(Array.from(document.querySelectorAll<SVGSVGElement>('.tree-row > svg')).every(icon => icon.getBoundingClientRect().width === 16), 'Значок сжался');
  await key('ArrowRight'); assert(width() === 208, 'Клавиатурное растягивание не работает');
  await key('ArrowLeft'); assert(width() === 192, 'Клавиатурное сужение не работает');
  // Синтетический жест проверяет обработчики; реальный pointer capture проверяется мышью.
  const el = handle(), capture = el.setPointerCapture;
  el.setPointerCapture = () => {};
  const send = (type: string, x: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, button: 0, clientX: x, bubbles: true }));
  send('pointerdown', 192); send('pointermove', 342); await pause(); send('pointerup', 342); await pause();
  el.setPointerCapture = capture;
  assert(width() === 342, 'Ширина не изменилась при перетаскивании');
  document.querySelector<HTMLButtonElement>('#remount')!.click(); await pause();
  assert(width() === 342, 'Ширина не восстановилась из хранилища');
  document.querySelector<HTMLButtonElement>('[aria-label="Свернуть структуру проекта"]')!.click(); await pause();
  assert(!handle() && document.querySelector('.tree.rail')!.getBoundingClientRect().width === 44, 'Свёрнутая панель изменилась');
  document.querySelector<HTMLButtonElement>('[aria-label="Развернуть структуру проекта"]')!.click(); await pause();
  assert(width() === 342, 'После разворачивания ширина не восстановилась');
  handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await pause();
  assert(width() === 232, 'Двойной щелчок не сбросил ширину');
  const result = document.querySelector<HTMLOutputElement>('#result')!;
  result.textContent = 'Пройдено: одна строка с многоточием, полные названия при наведении, значки, растягивание, клавиатура, сохранение ширины, сворачивание и сброс.'; result.dataset.status = 'passed';
} catch (error) {
  const result = document.querySelector<HTMLOutputElement>('#result')!;
  result.textContent = `Ошибка: ${error instanceof Error ? error.message : error}`; result.dataset.status = 'failed';
}
