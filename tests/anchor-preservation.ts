const result = document.querySelector<HTMLElement>('#result')!;
const pause = () => new Promise(resolve => setTimeout(resolve, 150));
const assert = (v: unknown, message: string) => { if (!v) throw new Error(message); };
const frame = document.createElement('iframe'); frame.style.cssText = 'width:1000px;height:700px'; document.body.append(frame);
try {
  frame.src = '/tests/editor.html'; await new Promise<void>(resolve => { frame.onload = () => resolve(); }); await pause();
  const win = frame.contentWindow! as Window & typeof globalThis, doc = win.document;
  const task = doc.querySelector<SVGGElement>('[data-diagram-node][aria-label*="Проверить заявку"]')!;
  const points = () => Array.from(doc.querySelectorAll<SVGPolylineElement>('[data-diagram-edge] .diagram-edge')).map(el => el.getAttribute('points')!.split(' ').map(p => { const [x,y] = p.split(',').map(Number); return { x,y }; }));
  const at = () => { const t = task.transform.baseVal.consolidate()!.matrix; return { x: t.e, y: t.f }; };
  const initial = points(), position = at(), r = task.getBoundingClientRect();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  task.setPointerCapture = () => {}; task.hasPointerCapture = () => false;
  const dispatch = (type: string, dx: number, dy: number) => task.dispatchEvent(new win.PointerEvent(type, { bubbles: true, pointerId: 42, button: 0, clientX: x + dx, clientY: y + dy }));
  dispatch('pointerdown',0,0); dispatch('pointermove',35,25); await pause(); dispatch('pointerup',35,25); await pause();
  const moved = points(), pos = at(), dx = pos.x - position.x, dy = pos.y - position.y;
  assert(dx || dy, 'Элемент не переместился');
  const near = (a: {x:number;y:number}, b: {x:number;y:number}) => Math.abs(a.x-b.x)<.01 && Math.abs(a.y-b.y)<.01;
  assert(near(moved[0][0], initial[0][0]) && near(moved[0].at(-1)!, { x: initial[0].at(-1)!.x + dx, y: initial[0].at(-1)!.y + dy }), 'Сменилась привязка входящей связи');
  assert(near(moved[1][0], { x: initial[1][0].x + dx, y: initial[1][0].y + dy }) && near(moved[1].at(-1)!, initial[1].at(-1)!), 'Сменилась привязка исходящей связи');
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key:'z', code:'KeyZ', metaKey:true, bubbles:true })); await pause();
  assert(JSON.stringify(points()) === JSON.stringify(initial), 'Undo не восстановил исходные привязки');
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key:'z', code:'KeyZ', metaKey:true, shiftKey:true, bubbles:true })); await pause();
  assert(JSON.stringify(points()) === JSON.stringify(moved), 'Redo не восстановил привязки');
  result.textContent = 'Успешно: обе привязки при перемещении, Undo и Redo (синтетические pointer-события).'; result.dataset.status = 'passed';
} catch (e) { result.textContent = `Ошибка: ${e instanceof Error ? e.message : String(e)}`; result.dataset.status = 'failed'; }
export {};
