export {};
const result = document.querySelector<HTMLElement>('#result')!;
const frame = document.createElement('iframe'); frame.style.cssText = 'width:1000px;height:700px'; document.body.append(frame);
const pause = () => new Promise(resolve => setTimeout(resolve, 150));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function load(query = '') {
  frame.src = `/tests/connection-edit-browser.html${query}`;
  await new Promise<void>(resolve => { frame.onload = () => resolve(); }); await pause();
  return frame.contentWindow! as Window & typeof globalThis;
}
function point(win: Window, target: Element, type: string, x: number, y: number) {
  target.dispatchEvent(new (win as Window & typeof globalThis).PointerEvent(type, { bubbles: true, pointerId: 42, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
}
function center(element: Element) { const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
async function select(win: Window & typeof globalThis) {
  const hit = win.document.querySelector<SVGElement>('.diagram-edge-hit')!;
  hit.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause();
}
try {
  let win = await load('?short'); let doc = win.document;
  await select(win);
  const handles = [...doc.querySelectorAll<SVGCircleElement>('.diagram-edge-handle')];
  assert(handles.length === 2 && !doc.querySelector('.diagram-segment-handle'), 'Неверные маркеры короткой связи');
  for (const handle of handles) {
    const p = center(handle);
    assert(doc.elementFromPoint(p.x, p.y) === handle, 'Конец связи перекрыт фигурой');
    assert(Math.abs(handle.getBoundingClientRect().width - 8) < .2, 'Маркеры слишком велики');
  }
  const a = center(handles[0]), b = center(handles[1]);
  assert(Math.hypot(a.x - b.x, a.y - b.y) > 8, 'Маркеры короткой связи перекрываются');
  win = await load('?bent'); doc = win.document; await select(win);
  const segment = doc.querySelector<SVGLineElement>('[data-diagram-edge-controls] g:nth-child(3) line')!;
  assert(segment, 'Нет участка для редактирования');
  segment.setPointerCapture = () => {}; segment.hasPointerCapture = () => false;
  const at = center(segment); const scale = Math.abs(segment.getScreenCTM()!.a);
  point(win, segment, 'pointerdown', at.x, at.y);
  point(win, segment, 'pointermove', at.x, at.y - 32 * scale); await pause();
  const preview = doc.querySelector('.diagram-edge-hit')!.getAttribute('points');
  point(win, segment, 'pointerup', at.x, at.y - 32 * scale); await pause();
  const saved = doc.querySelector('.diagram-edge-hit')!.getAttribute('points');
  assert(preview === '260,132 350,132' && saved === preview, 'Магнит не выровнял участок или предпросмотр не совпал');
  result.textContent = 'Успешно: короткая связь, доступность концов, малые маркеры и магнитное выравнивание.'; result.dataset.status = 'passed';
} catch (error) { result.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`; result.dataset.status = 'failed'; }
