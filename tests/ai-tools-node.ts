import { runAiToolTests } from './ai-tools';
const report = await runAiToolTests();
console.log(`Инструменты ИИ: ${report.count} сценариев пройдено`);
console.log(report.results.join('\n'));
