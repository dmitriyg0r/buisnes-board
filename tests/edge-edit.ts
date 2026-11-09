export {};
const result = document.querySelector<HTMLElement>('#result')!;
const pause = () => new Promise((resolve) => setTimeout(resolve, 120));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const frame = document.createElement('iframe');
frame.style.cssText = 'width:1000px;height:700px'; document.body.append(frame);
const load = async (query = '') => { frame.src = `/tests/editor.html${query}`; await new Promise<void>((resolve) => { frame.onload = () => resolve(); }); await pause(); return frame.contentWindow!; };
const key = (win: Window, target: Element | Window, code: string, options: KeyboardEventInit = {}) => target.dispatchEvent(new (win as Window & typeof globalThis).KeyboardEvent('keydown', { key: code, bubbles: true, ...options }));
const route = (doc: Document) => doc.querySelector('.diagram-edge-hit')!.getAttribute('points')!;
const isOrthogonal = (value: string) => { const points = value.split(' ').map((pair) => pair.split(',').map(Number)); return points.slice(1).every((p, i) => p[0] === points[i][0] || p[1] === points[i][1]); };
const select = async (win: Window) => { const hit = win.document.querySelector('.diagram-edge-hit')!; (hit as SVGElement).focus(); key(win, hit, 'Enter'); await pause(); return hit; };

try {
  let win = await load(); let doc = win.document;
  const hit = await select(win); const original = route(doc);
  assert(win.getComputedStyle(hit).outlineStyle === 'none', 'На связи осталась рамка фокуса');
  const point = doc.querySelector('[aria-label^="Точка маршрута"]')!;
  assert(point, 'Нет клавиатурной точки маршрута');
  key(win, point, 'ArrowUp'); await pause(); const changed = route(doc);
  assert(changed !== original && isOrthogonal(changed), 'Точка создала диагональный маршрут');
  key(win, win, 'z', { code: 'KeyZ', metaKey: true }); await pause();
  assert(route(doc) === original, 'Отмена не восстановила маршрут');
  key(win, win, 'z', { code: 'KeyZ', metaKey: true, shiftKey: true }); await pause();
  assert(route(doc) === changed, 'Повтор не восстановил изменение');
  await select(win); const segment = doc.querySelector('.diagram-segment-handle')!;
  key(win, segment, 'ArrowDown', { shiftKey: true }); await pause();
  assert(isOrthogonal(route(doc)), 'Сегмент создал диагональный маршрут');
  await select(win);
  const dragHandle = doc.querySelector<SVGElement>('.diagram-segment-handle')!;
  const rect = dragHandle.getBoundingClientRect(); const x = rect.x + rect.width / 2; const y = rect.y + rect.height / 2;
  dragHandle.setPointerCapture = () => {}; dragHandle.hasPointerCapture = () => false;
  const pointer = (type: string, delta: number) => dragHandle.dispatchEvent(new (win as Window & typeof globalThis).PointerEvent(type, { bubbles: true, pointerId: 42, button: 0, clientX: x + delta, clientY: y + delta }));
  const beforeDrag = route(doc); pointer('pointerdown', 0); pointer('pointermove', 30); pointer('pointerup', 30); await pause();
  assert(route(doc) !== beforeDrag && isOrthogonal(route(doc)), 'Перетаскивание сегмента не сохранило ортогональный маршрут');
  win = await load('?diagonal'); doc = win.document;
  const imported = route(doc); assert(!isOrthogonal(imported), 'Не создан произвольный маршрут');
  await select(win);
  assert(route(doc) === imported && !doc.querySelector('.diagram-edge-handle'), 'Импортированный маршрут изменён или доступен для случайного редактирования');
  result.textContent = 'Успешно: точка, сегмент, фокус, Undo/Redo, сохранение импортированного маршрута.';
  result.dataset.status = 'passed';
} catch (error) {
  result.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`;
  result.dataset.status = 'failed';
}
