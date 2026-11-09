import { hasSelfIntersections, simplifyRoute } from '../src/modeling/orthogonalRouting';
const result = document.querySelector<HTMLElement>('#result')!;
const wait = () => new Promise(resolve => setTimeout(resolve, 60));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const frame = document.createElement('iframe'); frame.style.cssText = 'width:1000px;height:700px'; document.body.append(frame);
try {
  frame.src = '/tests/editor.html'; await new Promise<void>(resolve => { frame.onload = () => resolve(); }); await wait();
  const win = frame.contentWindow! as Window & typeof globalThis, doc = win.document;
  const hit = doc.querySelector<SVGElement>('.diagram-edge-hit')!;
  hit.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait();
  for (let step = 0; step < 12; step++) {
    const handles = Array.from(doc.querySelectorAll<SVGElement>('.diagram-segment-handle'));
    const handle = handles[step % handles.length];
    handle.dispatchEvent(new win.KeyboardEvent('keydown', { key: ['ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight'][step % 4], shiftKey: true, bubbles: true })); await wait();
    const raw = doc.querySelector('.diagram-edge-hit')!.getAttribute('points')!;
    const points = simplifyRoute(raw.split(' ').map(p => { const [x, y] = p.split(',').map(Number); return { x, y }; }));
    assert(points.length <= 10 && !hasSelfIntersections(points), `Некорректный маршрут после шага ${step + 1}: ${raw}`);
  }
  result.textContent = 'Успешно: последовательные изменения не создают петель и избытка изгибов.'; result.dataset.status = 'passed';
} catch (error) { result.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`; result.dataset.status = 'failed'; }
