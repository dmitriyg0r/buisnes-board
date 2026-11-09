export {};
const result = document.querySelector<HTMLElement>('#result')!;
const pause = () => new Promise(resolve => setTimeout(resolve, 120));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const frame = document.createElement('iframe'); frame.style.cssText = 'width:1000px;height:700px'; document.body.append(frame);
try {
  frame.src = '/tests/editor.html'; await new Promise<void>(resolve => { frame.onload = () => resolve(); }); await pause();
  const win = frame.contentWindow!; const doc = win.document;
  const key = (target: Element, name: string, shiftKey = false) => target.dispatchEvent(new (win as Window & typeof globalThis).KeyboardEvent('keydown', { key: name, bubbles: true, shiftKey }));
  const node = () => doc.querySelector<SVGGElement>('[data-diagram-node][aria-label*="Проверить заявку"]')!;
  const select = async () => { key(node(), 'Enter'); await pause(); };
  const geometry = () => ({ at: node().getAttribute('transform'), width: Number(node().querySelector('.diagram-shape')!.getAttribute('width')) });
  for (const [corner, direction, position] of [['nw', 'ArrowLeft', 'translate(340 145)'], ['ne', 'ArrowRight', 'translate(350 145)'], ['sw', 'ArrowLeft', 'translate(340 145)'], ['se', 'ArrowRight', 'translate(350 145)']] as const) {
    await select();
    assert(doc.querySelectorAll('.diagram-resize-handle:not(.label-handle)').length === 4 && doc.querySelectorAll('.label-handle').length === 4, 'Количество углов не равно четырём');
    key(doc.querySelector(`.diagram-resize-handle:not(.label-handle)[data-resize-corner="${corner}"]`)!, direction, true); await pause();
    assert(geometry().width === 110 && geometry().at === position, `Неверный размер или противоположный угол: ${corner}`);
    (doc.querySelector('[aria-label="Шаг назад"]') as HTMLButtonElement).click(); await pause();
    assert(geometry().width === 100 && geometry().at === 'translate(350 145)', `Отмена ${corner}`);
  }
  await select();
  key(doc.querySelector('.label-handle[data-resize-corner="nw"]')!, 'ArrowLeft', true); await pause();
  assert(doc.querySelector('.diagram-label-bounds')?.getAttribute('width') === '94' && geometry().width === 100, 'Отдельный размер текста не изменён');
  result.textContent = 'Успешно: четыре угла элемента и текста, закрепление противоположного угла, Undo.'; result.dataset.status = 'passed';
} catch (error) { result.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`; result.dataset.status = 'failed'; }
