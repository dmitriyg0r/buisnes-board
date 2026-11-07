import { runBpmnDataTests } from './bpmn-data';

const result = document.getElementById('result');
if (!result) throw new Error('Не найден контейнер результатов');
try {
  const report = runBpmnDataTests();
  result.textContent = `Проверки данных BPMN: ${report.results.length} пройдено. Ошибок: 0\n${report.results.join('\n')}`;
  result.dataset.status = 'passed';
} catch (error) {
  result.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`;
  result.dataset.status = 'failed';
}
