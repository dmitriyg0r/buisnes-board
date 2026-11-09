import assert from 'node:assert/strict';
import { emptyModel } from '../src/data';
import { htmlPreviewDocument, starterHtml } from '../src/html';
import { mergeModel } from '../src/mergeModel';
import { normalizeModel } from '../src/normalize';

const object = { id: 'h1', title: 'Калькулятор', html: '<button onclick="this.textContent++">0</button>' };

// Старые проекты остаются совместимы, новый тип переживает серверный JSON и нормализацию.
assert.deepEqual(normalizeModel({}).htmlObjects, []);
const model = normalizeModel(JSON.parse(JSON.stringify({ ...emptyModel, htmlObjects: [object] })));
assert.deepEqual(model.htmlObjects, [object]);
assert.deepEqual(normalizeModel({ htmlObjects: [null, 42, object] } as never).htmlObjects, [object]);

// Одновременные правки разных виджетов не перезаписывают друг друга.
const second = { ...object, id: 'h2', title: 'Форма' };
const base = { ...emptyModel, htmlObjects: [object, second] };
const local = { ...base, htmlObjects: [{ ...object, html: '<input value="Локально">' }, second] };
const remote = { ...base, htmlObjects: [object, { ...second, title: 'Серверная правка' }] };
const merged = mergeModel(base, local, remote);
assert.equal(merged.htmlObjects[0].html, '<input value="Локально">');
assert.equal(merged.htmlObjects[1].title, 'Серверная правка');
assert.deepEqual(mergeModel(base, base, { ...base, htmlObjects: [] }).htmlObjects, []);
assert.equal(mergeModel(base, { ...base, htmlObjects: [] }, remote).htmlObjects[0].title, 'Серверная правка');

// Политика размещается до пользовательского HTML; название шаблона остаётся обычным текстом.
const preview = htmlPreviewDocument('<script>document.body.textContent = "Работает"</script>');
assert.ok(preview.indexOf('Content-Security-Policy') < preview.indexOf('<script>'));
for (const rule of ["default-src 'none'", "script-src 'unsafe-inline'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(preview.includes(rule));
assert.ok(starterHtml('<img src=x onerror=alert(1)>').includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(!starterHtml('<img src=x>').includes('<img src=x>'));

console.log('HTML-объекты: совместимость, сохранение, слияние и документ предпросмотра — OK');
