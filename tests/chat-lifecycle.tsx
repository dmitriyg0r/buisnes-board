import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AiChat } from '../src/AiChat';
import { useModel } from '../src/useModel';
import { defaultSettings } from '../src/settings';
import type { AiEnvironment } from '../src/aiToolContract';
import '../src/styles.css';

type Request = { prompt: string; history: { role: string; text: string }[]; observations: unknown[] };
const calls: Request[] = [];
let answer: (() => void) | undefined;
const nativeFetch = window.fetch;
window.fetch = async (url, options) => {
  if (url !== '/api/ai/generate') return nativeFetch(url, options);
  const request = JSON.parse(String(options?.body)) as Request; calls.push(request);
  const data = request.prompt.includes('UML') && !request.observations.length
    ? { reply: 'Создаю UML', actions: [{ tool: 'create_object', key: 'db', arguments: { kind: 'model', notation: 'uml-class', title: 'БД стоматологии' } }] }
    : request.observations.length ? { reply: 'Готова UML-модель БД стоматологии' }
    : { reply: 'Устаревший план', actions: [{ tool: 'create_object', key: 'old', arguments: { kind: 'document', title: 'Не должен появиться' } }] };
  if (request.observations.length) return new Response(JSON.stringify({ type: 'result', data }) + '\n');
  return new Promise<Response>((resolve, reject) => {
    const abort = () => { answer = undefined; setTimeout(() => reject(new DOMException('Отменено', 'AbortError')), 80); };
    if (options?.signal?.aborted) { abort(); return; }
    options?.signal?.addEventListener('abort', abort, { once: true });
    answer = () => { options?.signal?.removeEventListener('abort', abort); answer = undefined; resolve(new Response(JSON.stringify({ type: 'result', data }) + '\n')); };
  });
};
const env = (): AiEnvironment => ({ issues: [], settings: defaultSettings, view: { x: 0, y: 0, zoom: 1, width: 1000, height: 800, selectedIds: [], tree: false, panel: false, mode: 'select' }, canUndo: true, canRedo: true });
const projectId = `chat-lifecycle-${crypto.randomUUID()}`;
function Fixture() {
  const api = useModel(projectId);
  const [model, setModel] = useState(defaultSettings.aiModel);
  return <div style={{ padding: 24 }}><h1>Проверка уточнений чата</h1><p>Настоящие компоненты чата и агент; генератор подставной, записи на сервер нет.</p><pre id="report">Проверки выполняются…</pre><p>Моделей: {api.model.models.length}; документов: {api.model.docs.length}</p>
    <AiChat projectId={projectId} api={api} aiModel={model} onModel={setModel} onReveal={() => {}} onFocusCard={() => {}} tools={{ snapshot: env, execute: async () => ({ ok: true, summary: 'OK' }) }} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
const wait = async (condition: () => unknown) => { const start = Date.now(); while (!condition()) { if (Date.now() - start > 5000) throw new Error('Таймаут сценария'); await new Promise(r => setTimeout(r, 20)); } };
const send = async (text: string) => {
  const input = document.querySelector('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(requestAnimationFrame);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
};
const results: string[] = [];
try {
  await wait(() => document.querySelector('textarea'));
  await send('Сделай модель БД телеграм-бота стоматологии');
  await wait(() => calls.length === 1);
  await send('используй UML');
  await wait(() => document.body.textContent?.includes('Уточнение принято'));
  if (calls.length !== 1) throw new Error('Запросы генерации выполняются параллельно');
  answer!(); await wait(() => calls.length === 2 && answer);
  if (calls[1].prompt !== 'используй UML' || !calls[1].history.some(t => t.text.includes('стоматологии'))) throw new Error('Потеряна исходная задача');
  answer!(); await wait(() => document.body.textContent?.includes('Готова UML-модель'));
  if (!document.body.textContent?.includes('Моделей: 1; документов: 0')) throw new Error('Применён устаревший план');
  results.push('Уточнение принято во время работы; исходная задача сохранена; старый план не применён.');
  const clear = document.querySelector<HTMLButtonElement>('[aria-label="Очистить чат"]')!; await wait(() => !clear.disabled); clear.click();
  await send('Сделай модель БД стоматологии после остановки'); await wait(() => calls.length === 4);
  const stop = document.querySelector<HTMLButtonElement>('.ai-cancel');
  if (!stop) throw new Error('Кнопка остановки не найдена');
  stop.click(); await send('используй UML');
  await wait(() => calls.length === 5 && answer);
  if (!calls[4].history.some(t => t.text.includes('после остановки'))) throw new Error('После остановки потеряна задача');
  answer!(); await wait(() => calls.length === 6 && document.body.textContent?.includes('Готова UML-модель'));
  results.push('Уточнение сразу после остановки ждёт отмены и продолжает исходную задачу без параллельного запроса.');
  document.getElementById('report')!.textContent = `Пройдено: ${results.length}\n${results.join('\n')}`;
} catch (error) { document.getElementById('report')!.textContent = `ОШИБКА: ${error}`; }
