export {};
const result = document.querySelector<HTMLElement>('#result')!;
const pause = () => new Promise(resolve => setTimeout(resolve, 120));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const frame = document.createElement('iframe'); frame.style.cssText = 'width:1000px;height:700px'; document.body.append(frame);
try {
  frame.src = '/tests/editor.html'; await new Promise<void>(resolve => { frame.onload = () => resolve(); }); await pause();
  const win = frame.contentWindow! as Window & typeof globalThis; const doc = win.document;
  const fixture = (win as unknown as Window & { editorFixture: { taskId: string; annotationId: string } }).editorFixture;
  const node = (id: string) => doc.querySelector<SVGGElement>(`[data-diagram-node="${id}"]`)!;
  const key = (target: Element, name: string, shiftKey = false) => target.dispatchEvent(new win.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, shiftKey }));
  const input = () => doc.querySelector<HTMLTextAreaElement>('textarea.diagram-inline-textarea')!;
  const setValue = (value: string) => { const el = input(); Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new win.Event('input', { bubbles: true })); };
  const edit = async (id: string) => { node(id).dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true })); await pause(); assert(input() && doc.activeElement === input(), 'Редактор не получил фокус'); };
  const boundsMatch = (id: string) => {
    const bounds = node(id).querySelector<SVGRectElement>('.diagram-label-bounds')!.getBoundingClientRect();
    const field = input().getBoundingClientRect();
    for (const fieldName of ['left', 'top', 'width', 'height'] as const) assert(Math.abs(bounds[fieldName] - field[fieldName]) < 1, `Границы ${fieldName}: ${bounds[fieldName]} != ${field[fieldName]}`);
    assert(getComputedStyle(input()).minHeight === '0px', 'Минимальная высота выходит за границы');
    assert(!node(id).querySelector('.diagram-node-label'), 'SVG-текст не скрыт');
  };
  await edit(fixture.taskId); boundsMatch(fixture.taskId);
  assert(input().getAttribute('title')?.includes('Shift+Enter'), 'Нет подсказки клавиатуры');
  assert(key(input(), 'Enter', true), 'Shift+Enter запрещён');
  setValue('Новая строка\nПродолжение'); await pause(); key(input(), 'Enter'); await pause();
  assert(!input() && node(fixture.taskId).getAttribute('aria-label')?.includes('Новая строка\nПродолжение'), 'Enter не сохранил многострочный текст');
  (doc.querySelector('[aria-label="Шаг назад"]') as HTMLButtonElement).click(); await pause();
  assert(node(fixture.taskId).getAttribute('aria-label')?.includes('Проверить заявку'), 'Undo не восстановил задачу');
  await edit(fixture.annotationId); boundsMatch(fixture.annotationId); setValue('Отменить'); await pause(); key(input(), 'Escape'); await pause();
  assert(node(fixture.annotationId).getAttribute('aria-label')?.includes('Комментарий'), 'Escape не отменил изменение');
  key(node(fixture.taskId), 'Enter'); await pause();
  key(doc.querySelector('.label-handle[data-resize-corner="se"]')!, 'ArrowRight', true); await pause();
  key(doc.querySelector('.label-handle[data-resize-corner="se"]')!, 'ArrowDown', true); await pause();
  (doc.querySelector('[aria-label="Увеличить"]') as HTMLButtonElement).click(); await pause();
  key(node(fixture.taskId), 'F2'); await pause(); boundsMatch(fixture.taskId);
  setValue('Изменённый размер'); await pause(); key(input(), 'Enter'); await pause();
  assert(node(fixture.taskId).getAttribute('aria-label')?.includes('Изменённый размер'), 'Не сохранено при масштабе');
  result.textContent = 'Успешно: задача, аннотация, точные границы, перенос, Escape, Enter, Undo, размер, Zoom, F2.'; result.dataset.status = 'passed';
} catch (error) { result.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`; result.dataset.status = 'failed'; }
