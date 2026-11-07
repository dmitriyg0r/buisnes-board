import { runBpmnEventTests } from './bpmn-events';

const result = document.getElementById('result');
if (!result) throw new Error('Не найден контейнер результатов');
try {
  const count = runBpmnEventTests();
  result.textContent = `Проверки событий BPMN: ${count} утверждений пройдено. Ошибок: 0`;
  result.dataset.status = 'passed';
} catch (error) {
  result.textContent = `Ошибка: ${error instanceof Error ? error.message : String(error)}`;
  result.dataset.status = 'failed';
}
