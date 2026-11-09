import { runAiToolTests } from './ai-tools';
const result = document.getElementById('result')!;
try {
  const report = await runAiToolTests(true);
  result.textContent = `Инструменты ИИ: ${report.count} сценариев пройдено\n\n${report.results.join('\n')}`;
  result.dataset.status = 'passed';
} catch (error) {
  result.textContent = `Ошибка: ${error instanceof Error ? error.stack : String(error)}`;
  result.dataset.status = 'failed';
}
