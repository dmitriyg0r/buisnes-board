import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '../src/Canvas';
import { emptyModel, type Issue } from '../src/data';
import { defaultSettings } from '../src/settings';
import { useModel } from '../src/useModel';
import { modelKey, viewKey } from '../src/projects';
import { routeOrthogonal } from '../src/modeling/orthogonalRouting';
import '../src/styles.css';

const issue: Issue = { id: 'check', title: 'Проверка канваса', status: 'open', summary: '', question: '' };
function Fixture() {
  const api = useModel('canvas-interactions');
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => api.setRemote({ ...structuredClone(emptyModel),
    docs: ['a', 'b', 'obstacle'].map(id => ({ id, title: id, markdown: '', sections: [] })),
    meta: { 'layout:pos': { 'doc:a': '40,100', 'doc:b': '1000,100', 'doc:obstacle': '520,80' },
      'layout:size': { 'doc:a': '360,400', 'doc:b': '360,400', 'doc:obstacle': '360,440' } },
  }), []);
  return <div className="app"><header className="topbar"><b>Перемещение и связи · локальная проверка</b>
    <button id="add" onClick={() => api.apply(m => ({ ...m, gateways: [...m.gateways, { id: 'extra', label: 'Новый шлюз' }] }))}>Добавить объект</button>
    <output id="result">Выполняется…</output>
    <output id="positions" hidden>{JSON.stringify(api.model.meta['layout:pos'])}</output>
  </header><div className="workspace" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
    <Canvas api={api} projectId="canvas-interactions" settings={{ ...defaultSettings, minimap: false }} onModel={() => {}} issues={[issue]} issue={issue} onSelect={() => {}} selCards={selected} onSelCards={setSelected} onAddMaterial={() => {}} onEditProcess={() => {}} onEditDoc={() => {}} onEditHtml={() => {}} onEditModel={() => {}} paused={false} aiPanels={{ tree: false, panel: false }} onAiWorkspaceEffect={async () => ({ ok: true, summary: '' })} />
  </div></div>;
}
// Убираем только сохранения этого стенда, чтобы ручная проверка не влияла на следующий запуск.
localStorage.removeItem(modelKey('canvas-interactions'));
localStorage.removeItem(viewKey('canvas-interactions'));
createRoot(document.getElementById('root')!).render(<Fixture />);
const pause = (ms = 70) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const card = (id: string) => document.querySelector<HTMLElement>(`[data-card="doc:${id}"]`)!;
// Синтетические события проверяют обработчики React; нативный pointer capture проверяется вручную.
const drag = async (element: HTMLElement, dx: number, dy: number) => {
  const capture = element.setPointerCapture;
  element.setPointerCapture = () => {};
  const r = element.getBoundingClientRect();
  const x = r.left + 40, y = r.top + 20;
  const send = (type: string, x: number, y: number) => element.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 9, clientX: x, clientY: y }));
  send('pointerdown', x, y); await pause();
  send('pointermove', x + dx, y + dy); await pause();
  send('pointerup', x + dx, y + dy); await pause(350);
  element.setPointerCapture = capture;
};
try {
  await pause(600);
  // Получаем текущий масштаб из отображаемых размеров, стенд работает при любом размере окна.
  const a = card('a'), b = card('b');
  const k = a.getBoundingClientRect().width / 360;
  const start = Number.parseFloat(a.style.left);
  await drag(a, 600 * k, 0);
  assert(Math.abs(Number.parseFloat(a.style.left) - start - 600) < 1, 'Карточка остановилась у препятствия');
  assert(Number.parseFloat(a.style.left) < 880 && Number.parseFloat(a.style.left) + 360 > 520, 'Нет наложения');
  document.querySelector<HTMLButtonElement>('#add')!.click(); await pause(400);
  assert(Math.abs(Number.parseFloat(a.style.left) - start - 600) < 1, 'Добавление раздвинуло наложенные карточки');
  assert(JSON.parse(document.querySelector('#positions')!.textContent!)['doc:a'] === '640,100', 'Координаты наложения не сохранены в модели');
  document.querySelector<HTMLButtonElement>('[aria-label="Шаг назад"]')!.click(); await pause();
  document.querySelector<HTMLButtonElement>('[aria-label="Шаг назад"]')!.click(); await pause();
  assert(Number.parseFloat(a.style.left) === start, 'Отмена не восстановила положение');
  document.querySelector<HTMLButtonElement>('[aria-label="Шаг вперёд"]')!.click(); await pause();
  assert(Number.parseFloat(a.style.left) === 640, 'Повтор не восстановил наложение');
  await drag(a, -600 * k, 0);
  // Клавиатурное создание через те же порты, что используются при перетаскивании.
  const port = (el: HTMLElement, side: string) => el.querySelector<HTMLButtonElement>(`[data-link-port="${side}"][data-link-offset="0.5"]`)!;
  port(a, 'bottom').click(); await pause(); port(b, 'bottom').click(); await pause();
  const path = document.querySelector<SVGPathElement>('.card-link-layer .clink')!;
  assert(path, 'Связь не создана');
  const actual = [...path.getAttribute('d')!.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map(m => ({ x: +m[1], y: +m[2] }));
  const expected = routeOrthogonal({ start: { point: { x: 220, y: 500 }, normal: 'down', bounds: { x: 40, y: 100, width: 360, height: 400 } }, end: { point: { x: 1180, y: 500 }, normal: 'down', bounds: { x: 1000, y: 100, width: 360, height: 400 } }, obstacles: [{ x: 520, y: 80, width: 360, height: 440 }] });
  assert(JSON.stringify(actual) === JSON.stringify(expected), 'Маршрут отличается от маршрутизатора EPC');
  assert(a.querySelectorAll('[data-link-port]').length === 12, 'Изменились точки прямоугольной карточки');
  const originalPath = path.getAttribute('d');
  await drag(b, -800 * k, 0);
  assert(document.querySelectorAll('.card-link-layer .clink').length === 1, 'Связь исчезла при частичном наложении');
  assert(document.querySelector<SVGPathElement>('.card-link-layer .clink')!.getTotalLength() > 100, 'Маршрут наложения невидим');
  await drag(b, -160 * k, 0);
  assert(Number.parseFloat(b.style.left) === Number.parseFloat(a.style.left), 'Не получено полное наложение');
  assert(document.querySelector<SVGPathElement>('.card-link-layer .clink')!.getTotalLength() > 100, 'Совпавшие порты скрыли связь');
  await drag(b, 960 * k, 0);
  assert(document.querySelector('.card-link-layer .clink')!.getAttribute('d') === originalPath, 'После разнесения не восстановился маршрут EPC');
  await drag(card('obstacle'), -480 * k, 20 * k);
  assert(document.querySelectorAll('.card-link-layer .clink').length === 1, 'Посторонняя карточка скрыла связь');
  port(card('obstacle'), 'bottom').click(); await pause(); port(a, 'bottom').click(); await pause();
  assert(document.querySelectorAll('.card-link-layer .clink').length === 2, 'Не создана связь уже наложенных карточек');

  const result = document.querySelector<HTMLOutputElement>('#result')!;
  result.textContent = 'Пройдено: перенос через объект, наложение, добавление, сохранение, отмена/повтор, связи при частичном/полном наложении и восстановление маршрута EPC.';
  result.dataset.status = 'passed';
} catch (error) {
  const result = document.querySelector<HTMLOutputElement>('#result')!;
  result.textContent = `Ошибка: ${error instanceof Error ? error.message : error}`; result.dataset.status = 'failed';
}
