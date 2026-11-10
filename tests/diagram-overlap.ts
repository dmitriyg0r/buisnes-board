export {};
const result = document.querySelector<HTMLElement>('#result')!;
const frame = document.createElement('iframe'); frame.style.cssText = 'width:1400px;height:900px'; document.body.append(frame);
const wait = (ms = 150) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const center = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
try {
  frame.src = '/tests/graph-node-drag.html'; await new Promise<void>(resolve => { frame.onload = () => resolve(); }); await wait(500);
  const win = frame.contentWindow! as Window & typeof globalThis & { savedNotationSource?: string }, doc = win.document;
  // Синтетический указатель не обладает настоящим захватом мыши.
  win.Element.prototype.setPointerCapture = function () {};
  win.Element.prototype.hasPointerCapture = function () { return false; };
  const nodes = () => [...doc.querySelectorAll<SVGGElement>('[data-diagram-node]')];
  const drag = async (element: Element, dx: number, dy: number) => {
    const at = center(element);
    const send = (type: string, x: number, y: number) => element.dispatchEvent(new win.PointerEvent(type, { bubbles: true, button: 0, buttons: type === 'pointermove' ? 1 : 0, pointerId: 17, clientX: x, clientY: y }));
    send('pointerdown', at.x, at.y); await wait(); send('pointermove', at.x + dx, at.y + dy); await wait(); send('pointerup', at.x + dx, at.y + dy); await wait();
  };
  const first = nodes()[0], second = nodes()[1];
  const a = center(first), b = center(second);
  await drag(first, b.x - a.x, b.y - a.y);
  assert(nodes()[0].getAttribute('transform') === nodes()[1].getAttribute('transform'), 'Связанный элемент нельзя наложить на соседний');
  assert(!doc.querySelector('.diagram-alert'), 'При наложении возникла ошибка');
  (doc.querySelector('[aria-label="Шаг назад"]') as HTMLButtonElement).click(); await wait();
  assert(nodes()[0].getAttribute('transform') !== nodes()[1].getAttribute('transform'), 'Отмена не восстановила положение');
  (doc.querySelector('[aria-label="Шаг вперёд"]') as HTMLButtonElement).click(); await wait();
  assert(nodes()[0].getAttribute('transform') === nodes()[1].getAttribute('transform'), 'Повтор не восстановил наложение');
  (doc.querySelector('[aria-label="Шаг назад"]') as HTMLButtonElement).click(); await wait();
  const current = nodes()[0];
  const at = center(current);
  current.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 18, clientX: at.x, clientY: at.y }));
  current.dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 18, clientX: at.x, clientY: at.y })); await wait();
  const handle = doc.querySelector<SVGRectElement>('[aria-label="Изменить размер элемента: нижний правый угол"]')!;
  const scale = handle.ownerSVGElement!.getScreenCTM()!.a;
  await drag(handle, 380 * scale, 40 * scale);
  assert(!doc.querySelector('.diagram-alert'), 'Изменение размера через соседний элемент вызвало ошибку');
  [...doc.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Сохранить')!.click(); await wait();
  const saved = JSON.parse(win.savedNotationSource!);
  assert(Math.abs(saved.nodes[0].width - 540) < 0.01 && Math.abs(saved.nodes[0].height - 104) < 0.01, 'Изменённые размеры не попали в сохранённую модель');
  assert(saved.edges.length === 1 && saved.edges[0].from === saved.nodes[0].id && saved.edges[0].to === saved.nodes[1].id, 'Связь потеряна при наложении');
  result.textContent = 'Пройдено: наложение, изменение размера, отмена, повтор и сохранение EPC.'; result.dataset.status = 'passed';
} catch (error) { result.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`; result.dataset.status = 'failed'; }
