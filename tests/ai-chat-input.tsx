import React from 'react';
import { createRoot } from 'react-dom/client';
import { AiChat } from '../src/AiChat';
import { emptyModel } from '../src/data';
import { defaultSettings } from '../src/settings';
import type { ModelApi } from '../src/useModel';
import '../src/styles.css';

// Только транспорт модели подставной; поле, отправка, история и цикл агента настоящие.
const projectId = 'test-long-chat-input';
localStorage.removeItem(`bb.chat.${projectId}`);
localStorage.setItem('bb.chat.open', '1');
const requests: { prompt: string; history: { text: string }[] }[] = [];
window.fetch = async (_input, init) => {
  requests.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ type: 'result', data: { reply: 'Принято' } }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
};
const api = { getModel: () => emptyModel } as ModelApi;
createRoot(document.getElementById('root')!).render(<AiChat projectId={projectId} api={api} aiModel="6.1-sol" onModel={() => {}} onReveal={() => {}} onFocusCard={() => {}} tools={{ snapshot: () => ({ issues: [], settings: defaultSettings, view: { x: 0, y: 0, zoom: 1, width: 1000, height: 800, selectedIds: [], tree: false, panel: false, mode: 'select' }, canUndo: false, canRedo: false }), execute: async () => ({ ok: true, summary: 'OK' }) }} />);
const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function input(text: string) {
  const field = document.querySelector('textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await wait();
  return field;
}
async function run() {
  await wait();
  const text = 'Требование к демостенду. '.repeat(1500) + 'КОНЕЦ: калькулятор и замечания';
  const field = await input(text);
  assert(field.maxLength === -1, 'Поле молча ограничивает вставку через maxLength');
  document.querySelector<HTMLButtonElement>('.ai-send')!.click();
  await wait();
  assert(requests[0]?.prompt === text, 'Длинный запрос передан не полностью');
  await input('Продолжай');
  document.querySelector<HTMLButtonElement>('.ai-send')!.click();
  await wait();
  assert(requests[1]?.history.some(turn => turn.text === text), 'Длинный запрос потерян в истории');
  const excessive = 'я'.repeat(100001);
  await input(excessive);
  assert(document.querySelector('[role="alert"]')?.textContent?.includes('100'), 'Нет явной ошибки превышения лимита');
  assert(document.querySelector<HTMLButtonElement>('.ai-send')!.disabled, 'Слишком длинный запрос можно отправить');
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait();
  assert(requests.length === 2 && field.value === excessive, 'Enter отправил превышение или потерял черновик');
  await input('Исправленный запрос');
  assert(!document.querySelector('[role="alert"]'), 'Ошибка не исчезла после исправления');
  document.querySelector<HTMLButtonElement>('.ai-send')!.click();
  await wait();
  assert(requests[2]?.prompt === 'Исправленный запрос', 'Повторная отправка не работает');
  document.getElementById('report')!.textContent = 'PASS: полный длинный запрос, история, предупреждение, защита Enter, сохранение черновика и повторная отправка';
}
run().catch(error => { document.getElementById('report')!.textContent = `FAIL: ${error.message}`; console.error(error); });
