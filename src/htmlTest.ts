import { htmlPreviewDocument } from './html';
import type { AiToolResult } from './aiToolContract';

export interface HtmlTestStep { op: 'fill' | 'click' | 'expect_text' | 'expect_value'; selector: string; value?: string; text?: string }

/** Проверка работает в отдельной копии виджета, с той же политикой, что и карточка. */
export function testHtml(id: string, html: string, steps: HtmlTestStep[]): Promise<AiToolResult> {
  return new Promise((resolve) => {
    const token = crypto.randomUUID();
    const frame = document.createElement('iframe');
    frame.title = 'Проверка HTML'; frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;pointer-events:none';
    let finished = false;
    const finish = (result: AiToolResult) => {
      if (finished) return;
      finished = true; clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, summary: 'Проверка HTML не завершилась', error: 'Виджет не ответил за 10 секунд', data: { id } }), 10_000);
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token) return;
      if (event.data.ready) { frame.contentWindow?.postMessage({ token, steps }, '*'); return; }
      const result = event.data.result;
      if (!result || typeof result.ok !== 'boolean') return;
      const assertions = Number(result.assertions);
      const ok = result.ok && assertions > 0 && assertions === steps.filter((step) => step.op.startsWith('expect_')).length;
      const results = Array.isArray(result.results) ? result.results.slice(0, 20).map((entry: Record<string, unknown> | null) => ({ op: String(entry?.op ?? '').slice(0, 30), selector: String(entry?.selector ?? '').slice(0, 240), actual: String(entry?.actual ?? '').slice(0, 1000) })) : [];
      finish({ ok, summary: ok ? `HTML проверен: ${assertions} проверок результата` : 'Проверка HTML выявила ошибку', ...(ok ? {} : { error: String(result.error ?? 'Не подтверждены все ожидаемые результаты').slice(0, 2000) }), data: { id, assertions: Number.isFinite(assertions) ? assertions : 0, results } });
    };
    window.addEventListener('message', receive);
    frame.srcdoc = htmlPreviewDocument(html, `(${htmlTestRuntime.toString()})(${JSON.stringify(token)});`);
    document.body.append(frame);
  });
}

/** Эта функция сериализуется внутрь sandbox; она не получает ни модель, ни полномочия приложения. */
function htmlTestRuntime(token: string) {
  const errors: string[] = [];
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  window.addEventListener('error', (event) => errors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
  let started = false;
  window.addEventListener('message', async (event) => {
    if (event.source !== parent || event.data?.token !== token || started) return;
    started = true;
    const results: { op: string; selector: string; actual?: string }[] = [];
    let assertions = 0;
    try {
      await Promise.resolve();
      if (errors.length) throw new Error(errors.join('; ').slice(0, 2000));
      for (const step of event.data.steps as HtmlTestStep[]) {
        const matches = document.querySelectorAll(step.selector);
        if (matches.length !== 1) throw new Error(`Селектор ${step.selector}: найдено элементов ${matches.length}, нужен один`);
        const element = matches[0];
        if (!(element instanceof HTMLElement)) throw new Error(`Элемент не найден: ${step.selector}`);
        if (step.op === 'fill' || step.op === 'click') {
          const style = getComputedStyle(element);
          let hidden = false;
          for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) if (getComputedStyle(parent).display === 'none') hidden = true;
          if (hidden || element.closest('[hidden],[inert]') || style.visibility === 'hidden' || style.pointerEvents === 'none' || element.matches(':disabled')) throw new Error(`Элемент недоступен пользователю: ${step.selector}`);
        }
        if (step.op === 'fill') {
          if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new Error(`Нельзя ввести значение: ${step.selector}`);
          element.value = step.value ?? '';
          element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (step.op === 'click') element.click();
        else {
          const actual = step.op === 'expect_value' && 'value' in element ? String(element.value) : element.textContent ?? '';
          results.push({ op: step.op, selector: step.selector, actual: actual.slice(0, 1000) });
          if (normalize(actual) !== normalize(step.op === 'expect_value' ? step.value ?? '' : step.text ?? '')) throw new Error(`${step.selector}: ожидалось «${step.text ?? step.value ?? ''}», получено «${actual.slice(0, 500)}»`);
          assertions++;
        }
        await Promise.resolve();
      }
      if (errors.length) throw new Error(errors.join('; ').slice(0, 2000));
      if (!assertions) throw new Error('Не задана проверка ожидаемого результата');
      parent.postMessage({ token, result: { ok: true, assertions, results } }, '*');
    } catch (error) { parent.postMessage({ token, result: { ok: false, assertions, results, error: error instanceof Error ? error.message : String(error) } }, '*'); }
  });
  window.addEventListener('DOMContentLoaded', () => parent.postMessage({ token, ready: true }, '*'), { once: true });
}
