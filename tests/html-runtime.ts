import { htmlPreviewDocument } from '../src/html';
import { testHtml } from '../src/htmlTest';

const target = document.getElementById('result')!;
const results: string[] = [];
const calculator = `<form id="form"><label>Цена<input id="price" type="number" min="0" step="0.01" value="0" required></label><label>Количество<input id="qty" type="number" min="0" step="1" value="1" required></label><button id="calc" type="submit">Рассчитать</button></form><output id="total">0,00</output><script>const form=document.getElementById('form');form.addEventListener('submit',e=>{e.preventDefault();document.getElementById('total').textContent=(document.getElementById('price').valueAsNumber*document.getElementById('qty').valueAsNumber).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})});</script>`;
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
try {
  for (const [price, qty, total] of [['100', '3', '300,00'], ['19.99', '3', '59,97'], ['0', '3', '0,00']]) {
    const test = await testHtml('html:calc', calculator, [{ op: 'fill', selector: '#price', value: price }, { op: 'fill', selector: '#qty', value: qty }, { op: 'click', selector: '#calc' }, { op: 'expect_text', selector: '#total', text: total }]);
    assert(test.ok, JSON.stringify(test)); results.push(`${price} × ${qty} = ${total}: локальная форма работает`);
  }
  const invalid = await testHtml('html:calc', calculator, [{ op: 'fill', selector: '#price', value: '-1' }, { op: 'click', selector: '#calc' }, { op: 'expect_text', selector: '#total', text: '0,00' }]);
  assert(invalid.ok, 'HTML-валидация не остановила отрицательную цену'); results.push('Валидация формы сохранена');
  const wrong = await testHtml('html:bad', '<output id="answer">—</output><button id="calc">Расчёт</button>', [{ op: 'click', selector: '#calc' }, { op: 'expect_text', selector: '#answer', text: '300,00' }]);
  assert(!wrong.ok && wrong.error?.includes('получено'), `Неработающий калькулятор принят: ${JSON.stringify(wrong)}`); results.push('Неверный результат возвращается ИИ как ошибка');
  const broken = await testHtml('html:broken', '<output>0</output><script>throw new Error("Ошибка виджета")</script>', [{ op: 'expect_text', selector: 'output', text: '0' }]);
  assert(!broken.ok && broken.error?.includes('Ошибка виджета'), 'Ошибка JavaScript скрыта'); results.push('Ошибка JavaScript обнаружена');
  const isolation = await testHtml('html:isolated', `<output id="parent"></output><output id="storage"></output><output id="network"></output><script>try{parent.document.body;document.getElementById('parent').textContent='open'}catch{document.getElementById('parent').textContent='closed'}try{localStorage.length;document.getElementById('storage').textContent='open'}catch{document.getElementById('storage').textContent='closed'}fetch('https://example.invalid/').then(()=>document.getElementById('network').textContent='open').catch(()=>document.getElementById('network').textContent='closed');</script>`, [{ op: 'expect_text', selector: '#parent', text: 'closed' }, { op: 'expect_text', selector: '#storage', text: 'closed' }, { op: 'expect_text', selector: '#network', text: 'closed' }]);
  assert(isolation.ok, JSON.stringify(isolation)); results.push('Доступ к приложению, хранилищу и сети остался закрыт');
  assert(!document.querySelector('iframe[title="Проверка HTML"]'), 'Тестовый iframe не удалён'); results.push('Тестовые iframe и обработчики убраны');
  target.textContent = results.join('\n'); target.dataset.status = 'passed';
  // Видимый стенд для ручной проверки Enter и клика внутри Codex.
  const frame = document.createElement('iframe'); frame.title = 'Локальная форма'; frame.setAttribute('sandbox', 'allow-scripts'); frame.style.cssText = 'width:600px;height:260px'; frame.srcdoc = htmlPreviewDocument(calculator); document.body.append(frame);
} catch (error) { target.textContent = `${results.join('\n')}\nОшибка: ${error instanceof Error ? error.stack : String(error)}`; target.dataset.status = 'failed'; }
