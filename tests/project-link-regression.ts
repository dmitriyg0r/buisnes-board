export {};
const result = document.querySelector<HTMLElement>('#result')!;
const frame = document.createElement('iframe'); frame.style.cssText = 'width:1400px;height:900px'; document.body.append(frame);
const pause = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const center = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
try {
  frame.src = '/tests/project-link-editor.html'; await new Promise<void>(resolve => { frame.onload = () => resolve(); }); await pause(400);
  const win = frame.contentWindow! as Window & typeof globalThis, doc = win.document;
  const model = () => JSON.parse(doc.querySelector('#model')!.textContent!);
  const first = doc.querySelector<HTMLButtonElement>('[data-card="doc:a"] [data-link-port="top"][data-link-offset="0.5"]')!;
  first.click(); await pause();
  const target = doc.querySelector<HTMLButtonElement>('[data-card="doc:b"] [data-link-port="top"][data-link-offset="0.5"]')!;
  const p = center(target), surface = doc.querySelector<HTMLElement>('.canvas')!;
  const pointer = (target: Element, type: string, x: number, y: number) => target.dispatchEvent(new win.PointerEvent(type, { bubbles: true, button: 0, pointerId: 11, clientX: x, clientY: y }));
  const bounds = surface.getBoundingClientRect();
  pointer(surface, 'pointermove', bounds.left + 390, bounds.top + 20); await pause();
  const free = doc.querySelector('.card-link-preview .clink')?.getAttribute('d') ?? '';
  assert((free.match(/[ML]/g) ?? []).length <= 4, 'Свободный предпросмотр образует лишнюю петлю');
  pointer(surface, 'pointermove', p.x, p.y - 12); await pause();
  const preview = doc.querySelector('.card-link-preview .clink')?.getAttribute('d');
  pointer(surface, 'pointerdown', p.x, p.y - 12); await pause();
  const link = model().cardLinks[0];
  const actual = doc.querySelector('.card-link-layer .clink')?.getAttribute('d');
  assert(link?.from === 'doc:a' && link.to === 'doc:b' && link.toSide === 'top' && link.toOffset === 0.5, 'Магнитная цель не сохранена');
  assert(preview && preview === actual, 'Предпросмотр отличается от итогового маршрута');
  const handles = [...doc.querySelectorAll<SVGCircleElement>('.clink-handle.endpoint')];
  assert(handles.length === 2, 'Концы связи недоступны');
  for (const handle of handles) {
    const at = center(handle);
    assert(doc.elementFromPoint(at.x, at.y) === handle, 'Конец связи перекрыт карточкой');
    assert(Math.abs(handle.getBoundingClientRect().width - 8) < .2, 'Размер концов связи отличается от движка');
  }
  frame.src = '/tests/project-link-editor.html?manual'; await new Promise<void>(resolve => { frame.onload = () => resolve(); }); await pause(400);
  const manualWin = frame.contentWindow! as Window & typeof globalThis, manualDoc = manualWin.document;
  // Синтетический указатель в браузерном стенде не создаёт системный захват.
  manualWin.Element.prototype.setPointerCapture = function () {};
  manualWin.Element.prototype.hasPointerCapture = function () { return false; };
  manualDoc.querySelector('.clink-hit')!.dispatchEvent(new manualWin.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause();
  const end = manualDoc.querySelector<SVGCircleElement>('[aria-label="Переподключить конец связи"]')!;
  const destination = manualDoc.querySelector<HTMLElement>('[data-card="doc:c"] [data-link-port="top"][data-link-offset="0.5"]')!;
  const startAt = center(end), endAt = center(destination);
  const event = (type: string, point: { x: number; y: number }) => end.dispatchEvent(new manualWin.PointerEvent(type, { bubbles: true, button: 0, pointerId: 13, clientX: point.x, clientY: point.y }));
  event('pointerdown', startAt); await pause(); event('pointermove', endAt); await pause();
  const reconnectPreview = manualDoc.querySelector('.clink-hit')!.getAttribute('d');
  event('pointerup', endAt); await pause();
  const reconnected = JSON.parse(manualDoc.querySelector('#model')!.textContent!).cardLinks[0];
  assert(reconnected.id === 'manual-link' && reconnected.label === 'Ручная связь' && reconnected.from === 'doc:a' && reconnected.to === 'doc:c' && reconnected.toSide === 'top', 'Переподключение изменило другие свойства связи');
  assert(!reconnected.routePoints?.length, 'Несовместимые ручные изгибы не должны создавать петлю');
  assert(reconnectPreview === manualDoc.querySelector('.clink-hit')!.getAttribute('d'), 'Переподключение отличается от предпросмотра');
  result.textContent = 'Пройдено: магнит, доступность концов и безопасное переподключение.'; result.dataset.status = 'passed';
} catch (error) { result.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`; result.dataset.status = 'failed'; }
