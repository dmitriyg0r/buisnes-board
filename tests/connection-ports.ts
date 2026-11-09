const result = document.querySelector<HTMLElement>('#result')!;
const pause = () => new Promise(resolve => setTimeout(resolve, 150));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const frame = document.createElement('iframe'); frame.style.cssText = 'width:1000px;height:700px'; document.body.append(frame);
try {
  frame.src = '/tests/editor.html?wide-ports'; await new Promise<void>(resolve => { frame.onload = () => resolve(); }); await pause();
  const win = frame.contentWindow!; const doc = win.document;
  const node = doc.querySelector<SVGGElement>('[data-diagram-node][aria-label*="Проверить заявку"]')!;
  const rect = node.querySelector('.diagram-shape')!.getBoundingClientRect();
  assert(doc.querySelectorAll('[data-connection-port]').length === 0, 'Точки видны до наведения');
  node.dispatchEvent(new (win as Window & typeof globalThis).PointerEvent('pointermove', { bubbles: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 })); await pause();
  assert(node.querySelectorAll('[data-connection-port]').length === 12 && !node.querySelector('.selected'), 'Точки не появились при наведении без выделения');
  node.dispatchEvent(new (win as Window & typeof globalThis).MouseEvent('contextmenu', { bubbles: true, clientX: rect.x, clientY: rect.y, button: 2 })); await pause();
  (doc.querySelector('[role=menuitem]') as HTMLButtonElement).click(); await pause();
  for (const [label, value] of [['Ширина элемента', '350'], ['Высота элемента', '220']]) {
    const input = Array.from(doc.querySelectorAll('label')).find(e => e.textContent === label)!.querySelector('input')!;
    input.focus(); Object.getOwnPropertyDescriptor((win as Window & typeof globalThis).HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new (win as Window & typeof globalThis).Event('input', { bubbles: true })); input.dispatchEvent(new (win as Window & typeof globalThis).FocusEvent('focusout', { bubbles: true })); await pause();
  }
  for (const [side, expected] of [['top', 3], ['right', 3], ['bottom', 3], ['left', 3]] as const) assert(node.querySelectorAll(`[data-port-side="${side}"]`).length === expected, `Число точек ${side}`);
  assert(Array.from(node.querySelectorAll('circle')).filter(el => el.closest('[data-connection-port]')).every(el => el.getAttribute('r') === '4'), 'Маркеры не уменьшены');
  result.textContent = 'Успешно: наведение, три точки на каждой стороне до и после изменения размера, уменьшенные маркеры.'; result.dataset.status = 'passed';
} catch (error) { result.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`; result.dataset.status = 'failed'; }
