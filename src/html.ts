const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Код выполняется только в iframe с непрозрачным origin, без доступа к приложению и сети. */
export function htmlPreviewDocument(html: string): string {
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{color-scheme:light}body{margin:0;font-family:system-ui,sans-serif}*,*::before,*::after{box-sizing:border-box}</style></head><body>${html}</body></html>`;
}

/** Пример сразу показывает, что на доске работают кнопки и JavaScript. */
export function starterHtml(title: string): string {
  return `<style>
  body { padding: 32px; background: #f8faff; color: #202838; }
  main { max-width: 420px; margin: auto; }
  h1 { margin: 0 0 12px; font-size: 24px; }
  p { color: #667085; line-height: 1.5; }
  .counter { display: flex; align-items: center; gap: 20px; margin-top: 28px; }
  button { width: 44px; height: 44px; border: 0; border-radius: 12px; background: #2563eb; color: white; font-size: 24px; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  output { min-width: 48px; text-align: center; font-size: 32px; font-weight: 600; }
</style>

<main>
  <h1>${escapeHtml(title)}</h1>
  <p>Это интерактивный объект. Измените HTML, стили и скрипт под свою задачу.</p>
  <div class="counter">
    <button type="button" id="minus" aria-label="Уменьшить счётчик">−</button>
    <output id="count" aria-live="polite">0</output>
    <button type="button" id="plus" aria-label="Увеличить счётчик">+</button>
  </div>
</main>

<script>
  let count = 0;
  const output = document.getElementById('count');
  document.getElementById('minus').onclick = () => { output.textContent = --count; };
  document.getElementById('plus').onclick = () => { output.textContent = ++count; };
</script>`;
}
