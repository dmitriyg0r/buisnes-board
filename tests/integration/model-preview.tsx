import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { IndependentModelPreview } from '../../src/Canvas';
import { getModelNotation } from '../../src/modeling/registry';
const notation = getModelNotation('epc')!;
let source = notation.createEmpty();
source = notation.addNode(source, 'event', { x: 20, y: 30 });
source = notation.addNode(source, 'function', { x: 240, y: 130 });
const nodes = notation.read(source).diagram.nodes;
source = notation.connect(source, nodes[0].id, nodes[1].id);
const original = source;
flushSync(() => createRoot(document.getElementById('root')!).render(<><div id="valid" style={{position:'relative', width:400,height:300}}><IndependentModelPreview model={{ id:'a', title:'EPC', notation:'epc', source }} /></div><div id="unknown"><IndependentModelPreview model={{ id:'b', title:'Неизвестная', notation:'future', source:'raw' }} /></div><div id="broken"><IndependentModelPreview model={{ id:'c', title:'Ошибка', notation:'epc', source:'{broken' }} /></div><output id="unchanged">{String(source === original)}</output></>));

{
  const svg = document.querySelector<SVGSVGElement>('#valid svg');
  const checks = [svg && svg.viewBox.baseVal.width > 0 && svg.viewBox.baseVal.height > 0,
    document.querySelectorAll('#valid svg polygon, #valid svg rect, #valid svg ellipse').length === 2,
    document.querySelectorAll('#valid svg polyline').length === 1,
    document.querySelector('#unknown')?.textContent?.includes('Неизвестная нотация'),
    document.querySelector('#broken')?.textContent?.includes('Предпросмотр недоступен'),
    document.querySelector('#unchanged')?.textContent === 'true'];
  document.body.dataset.testResult = checks.every(Boolean) ? 'passed' : 'failed';
  if (!checks.every(Boolean)) throw new Error('Проверка предпросмотра модели не пройдена');
}
