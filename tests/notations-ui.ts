import { getModelNotation } from '../src/modeling/registry';
const result = document.querySelector<HTMLElement>('#result')!;
const pause = () => new Promise(resolve => setTimeout(resolve, 150));
const assert = (v:unknown, message:string) => { if (!v) throw new Error(message); };
const frame = document.createElement('iframe'); frame.style.cssText = 'width:1000px;height:700px'; document.body.append(frame);
try {
  for (const [type, first, second] of [['uml-class','Класс','Класс'],['uml-use-case','Актор','Вариант использования'],['uml-activity','Начальный узел','Действие'],['epc','Событие','Функция']]) {
    frame.src = `/tests/notation-editor.html?type=${type}`; await new Promise<void>(resolve => { frame.onload = () => resolve(); }); await pause();
    const win=frame.contentWindow! as Window & typeof globalThis, doc=win.document;
    const svg=doc.querySelector<SVGSVGElement>('.diagram-surface')!;
    assert(svg, `${type}: редактор не открыт`);
    svg.setPointerCapture=()=>{}; svg.hasPointerCapture=()=>false;
    const world = (x:number,y:number) => { const p=svg.createSVGPoint(); p.x=x;p.y=y;return p.matrixTransform(svg.getScreenCTM()!); };
    const send=(el:Element,kind:string,p:{x:number;y:number})=>el.dispatchEvent(new win.PointerEvent(kind,{bubbles:true,pointerId:9,button:0,buttons:kind==='pointerup'?0:1,clientX:p.x,clientY:p.y}));
    for (const [title,x] of [[first,220],[second,520]] as const) {
      const button=[...doc.querySelectorAll<HTMLButtonElement>('.diagram-tool')].find(el=>el.textContent?.trim()===title);
      assert(button, `${type}: нет символа ${title}`); button!.click(); await pause();
      const p=world(Number(x),220);send(svg,'pointermove',p);await pause();
      assert(doc.querySelector('[data-placement-preview]'), `${type}: нет предпросмотра`);
      send(svg,'pointerdown',p);await pause();
    }
    const nodes=[...doc.querySelectorAll<SVGGElement>('[data-diagram-node]')];
    assert(nodes.length===2, `${type}: не созданы два объекта`);
    if (type === 'uml-class') {
      nodes[0].dispatchEvent(new win.KeyboardEvent('keydown', { key:'ContextMenu', bubbles:true })); await pause();
      const properties = [...doc.querySelectorAll<HTMLButtonElement>('[role=menu] button')].find(button => button.textContent?.includes('Свойства'));
      assert(properties, 'Нет свойств класса'); properties!.click(); await pause();
      const fields = [...doc.querySelectorAll<HTMLTextAreaElement>('.diagram-compartment-input')];
      assert(fields.length === 2, 'Нет разделов класса');
      const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(fields[0], '- id: Integer'); fields[0].dispatchEvent(new win.Event('input', { bubbles:true })); fields[0].dispatchEvent(new win.FocusEvent('focusout', { bubbles:true })); await pause();
      setter.call(fields[1], '+ save(): Boolean'); fields[1].dispatchEvent(new win.Event('input', { bubbles:true })); fields[1].dispatchEvent(new win.FocusEvent('focusout', { bubbles:true })); await pause();
      assert(nodes[0].textContent?.includes('- id: Integer') && nodes[0].textContent?.includes('+ save(): Boolean'), 'Содержимое секций класса не показано');
      (doc.querySelector('.diagram-properties button') as HTMLButtonElement).click(); await pause();
    }
    (doc.querySelector('[aria-label="Связь"]') as HTMLButtonElement).click();await pause();
    for (const node of nodes) { const r=node.getBoundingClientRect();send(node,'pointerdown',{x:r.x+r.width/2,y:r.y+r.height/2});await pause(); }
    assert(doc.querySelectorAll('[data-diagram-edge]').length===1, `${type}: связь не создана: ${doc.querySelector('.diagram-alert')?.textContent}`);
    if (type === 'uml-class') {
      const edge = doc.querySelector('[data-diagram-edge] [role=button]')!;
      edge.dispatchEvent(new win.KeyboardEvent('keydown', { key:'ContextMenu', bubbles:true })); await pause();
      [...doc.querySelectorAll<HTMLButtonElement>('[role=menu] button')].find(button => button.textContent?.includes('Свойства'))!.click(); await pause();
      const field = [...doc.querySelectorAll<HTMLLabelElement>('.diagram-properties label')].find(label => label.textContent?.includes('Кратность: конец'))?.querySelector('input');
      assert(field, 'Нет поля кратности');
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(field, '0..*');
      field!.dispatchEvent(new win.Event('input', { bubbles:true })); field!.dispatchEvent(new win.FocusEvent('focusout', { bubbles:true })); await pause();
      assert(doc.querySelector('[data-diagram-edge]')?.textContent?.includes('0..*'), 'Кратность не показана');
      (doc.querySelector('.diagram-properties button') as HTMLButtonElement).click(); await pause();
    }
    (Array.from(doc.querySelectorAll<HTMLButtonElement>('button')).find(el=>el.textContent==='Сохранить'))!.click();await pause();
    const saved=(win as Window & {savedNotationSource?:string}).savedNotationSource;
    assert(saved,`${type}: не получены сохранённые данные`);
    const parsed=getModelNotation(type)!.read(saved!);
    assert(!parsed.readOnlyReason && parsed.diagram.nodes.length===2 && parsed.diagram.edges.length===1,`${type}: ошибка повторного чтения`);
    if (type === 'uml-class') assert(parsed.diagram.nodes.some(n => n.compartments?.attributes.includes('- id: Integer') && n.compartments.operations.includes('+ save(): Boolean')), 'Секции класса не сохранились');
    if (type === 'uml-class') assert(parsed.diagram.edges[0].ends?.to.multiplicity === '0..*', 'Кратность не сохранилась');
    assert(doc.querySelectorAll('[data-diagram-node]').length===2 && doc.querySelectorAll('[data-diagram-edge]').length===1,`${type}: диаграмма не открылась повторно`);
  }
  result.textContent='Успешно: создание, связи, сохранение и повторное открытие UML и EPC через общий редактор.';result.dataset.status='passed';
} catch(e) { result.textContent=`Ошибка: ${e instanceof Error ? e.message : String(e)}`;result.dataset.status='failed'; }
export {};
