import { createGraphNotation } from './graphNotation';
import type { DiagramSymbol } from './types';
import { validateEpcDiagram } from './epcValidation';
import { renderEpcSymbolDetail } from './epcSymbolDetail';
import { projectEpcEventEndpoints } from './epcProjection';
export { validateEpcDiagram } from './epcValidation';

/** Рабочее подмножество EPC, не полный каталог пресета m_sila_eEPC. */
export const epcSymbols: DiagramSymbol[] = [
  { type: 'function', title: 'Функция', shape: 'rounded-rectangle', group: 'Управляющий поток', width: 150, height: 70 },
  { type: 'event', title: 'Событие', shape: 'hexagon', group: 'Управляющий поток', width: 150, height: 60 },
  { type: 'process-interface', title: 'Интерфейс процесса', shape: 'rounded-rectangle', glyph: 'collapsed-subprocess', group: 'Управляющий поток', width: 150, height: 70 },
  { type: 'and', title: 'И (AND)', shape: 'circle', glyph: 'plus', group: 'Операторы', width: 50, height: 50 },
  { type: 'or', title: 'ИЛИ (OR)', shape: 'circle', glyph: 'or', group: 'Операторы', width: 50, height: 50 },
  { type: 'xor', title: 'Исключающее ИЛИ (XOR)', shape: 'circle', glyph: 'xor', group: 'Операторы', width: 50, height: 50 },
  { type: 'role', title: 'Роль', shape: 'rounded-rectangle', glyph: 'person', group: 'Ресурсы', width: 140, height: 60 },
  { type: 'position', title: 'Должность', shape: 'rounded-rectangle', glyph: 'business-rule', group: 'Ресурсы', width: 140, height: 60 },
  { type: 'organization', title: 'Организационная единица', shape: 'rounded-rectangle', group: 'Ресурсы', width: 150, height: 60 },
  { type: 'application', title: 'Прикладная система', shape: 'rounded-rectangle', glyph: 'service', group: 'Ресурсы', width: 150, height: 60 },
  { type: 'document', title: 'Документ', shape: 'document', group: 'Информация', width: 110, height: 80 },
  { type: 'data', title: 'Данные', shape: 'data-store', group: 'Информация', width: 110, height: 80 },
  { type: 'group', title: 'Группа', shape: 'ellipse', group: 'Ресурсы', width: 140, height: 60 },
  { type: 'internal-employee', title: 'Внутренний сотрудник', shape: 'rounded-rectangle', glyph: 'person', group: 'Ресурсы', width: 150, height: 60 },
  { type: 'external-employee', title: 'Внешний сотрудник', shape: 'rounded-rectangle', glyph: 'manual', group: 'Ресурсы', width: 150, height: 60 },
  { type: 'screen', title: 'Экранный интерфейс', shape: 'rounded-rectangle', glyph: 'script', group: 'Ресурсы', width: 150, height: 60 },
  { type: 'digital-document', title: 'Электронный документ', shape: 'rounded-rectangle', glyph: 'script', group: 'Информация', width: 150, height: 60 },
  { type: 'file', title: 'Файл', shape: 'rectangle', group: 'Информация', width: 130, height: 65 },
  { type: 'email', title: 'Электронная почта', shape: 'rounded-rectangle', glyph: 'send', group: 'Информация', width: 150, height: 60 },
  { type: 'technical-term', title: 'Технический термин', shape: 'annotation', group: 'Информация', width: 140, height: 60 },
  { type: 'product', title: 'Продукт/услуга', shape: 'ellipse', group: 'Результаты', width: 140, height: 70 },
  { type: 'goal', title: 'Цель', shape: 'ellipse', group: 'Результаты', width: 140, height: 60 },
  { type: 'kpi', title: 'Ключевой показатель результативности', shape: 'rounded-rectangle', glyph: 'business-rule', group: 'Результаты', width: 160, height: 70 },
  { type: 'risk', title: 'Риск', shape: 'diamond', group: 'Управление рисками', width: 110, height: 80 },
  { type: 'control', title: 'Контроль', shape: 'rounded-rectangle', glyph: 'business-rule', group: 'Управление рисками', width: 140, height: 60 },
].map(symbol => {
  const colors: Record<string, string> = {
    function: '#00ab44', event: '#c837ab', 'process-interface': '#a6aaab',
    and: '#cdcdcd', or: '#cdcdcd', xor: '#cdcdcd', role: '#edbd42', position: '#ffd429',
    organization: '#ff7e29', application: '#204378', document: '#a6aaab', data: '#a6aaab',
    group: '#c2963e', 'internal-employee': '#ffd429', 'external-employee': '#a6aaab',
    screen: '#8ed45f', 'digital-document': '#a6aaab', file: '#a6aaab', email: '#a6aaab',
    'technical-term': '#666666', product: '#9c926b', goal: '#ff7e29', kpi: '#3670c7', risk: '#d40000', control: '#d40000',
  };
  const operators = ['and', 'or', 'xor'];
  const operator = operators.includes(symbol.type);
  const color = colors[symbol.type];
  return { ...symbol, shape: operator ? 'circle' : symbol.type === 'event' ? 'hexagon' : symbol.type === 'file' ? 'rectangle' : 'rounded-rectangle',
    width: operator ? 50 : 160, height: operator ? 50 : 64,
    glyph: operator ? symbol.glyph : undefined,
    appearance: { fill: `color-mix(in srgb, ${color} 25%, white)`, stroke: operator ? '#444b55' : `color-mix(in srgb, ${color} 65%, #26313d)`,
      textColor: '#18212b', labelInside: !operator,
      ...(!operator ? { emptyLabel: symbol.title, icon: symbol.type } : {}) } };
}) as DiagramSymbol[];

export const epcConnectionTypes = [
  { id: 'flow', title: 'Управляющий поток', appearance: { lineStyle: 'solid', arrowEnd: true, arrowStyle: 'filled' } },
  { id: 'input', stereotype: '«вход»', title: 'Вход информации', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'output', stereotype: '«выход»', title: 'Выход информации', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'resource', stereotype: '«выполняет»', title: 'Ресурс выполняет функцию', appearance: { lineStyle: 'dotted', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'risk', stereotype: '«риск»', title: 'Риск функции', appearance: { lineStyle: 'dotted', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'control', stereotype: '«контроль»', title: 'Контроль риска или функции', appearance: { lineStyle: 'dotted', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'responsible', title: 'Ответственный за функцию', stereotype: '«ответственный»', appearance: { lineStyle: 'dotted', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'consults', title: 'Консультирует функцию', stereotype: '«консультирует»', appearance: { lineStyle: 'dotted', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'informs', title: 'Информирует о функции', stereotype: '«информирует»', appearance: { lineStyle: 'dotted', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'supports', title: 'Поддерживает функцию', stereotype: '«поддерживает»', appearance: { lineStyle: 'dotted', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'measured-by', title: 'Измеряется показателем', stereotype: '«измеряется»', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
  { id: 'contributes-to', title: 'Способствует достижению цели', stereotype: '«способствует»', appearance: { lineStyle: 'dashed', arrowEnd: true, arrowStyle: 'open' } },
] as const;

/** Кандидаты сопоставления с CORP SILA 2026, не экспорт в формат SILA.
 * В таблице пресета у большинства правил исходный символ не указан: пары
 * конечных точек и визуальные стили требуют проверки в самом SILA. Поток,
 * риск и контроль не имеют однозначного сопоставления по одному типу связи. */
export function epcSilaConnectionCandidate(from: string, to: string, edge: string): string | undefined {
  if (!canConnectEpc(from, to, edge)) return undefined;
  if (edge === 'input') return 'c_sila_is_input';
  if (edge === 'output') return 'c_sila_is_output';
  if (edge === 'resource') return from === 'application' ? 'c_sila_supports' : from === 'screen' ? undefined : 'c_sila_exec';
  return undefined;
}

const flowNodes = new Set(['function', 'event', 'process-interface', 'and', 'or', 'xor']);
const information = new Set(['document', 'data', 'digital-document', 'file', 'email', 'technical-term', 'product']);
const people = new Set(['role', 'position', 'organization', 'group', 'internal-employee', 'external-employee']);
const systems = new Set(['application', 'screen']);
const resources = new Set([...people, ...systems]);

/** Проверяются только типы и направление связи; правила чередования и кратности здесь не предполагаются. */
export function canConnectEpc(from: string, to: string, edge: string): boolean {
  switch (edge) {
    case 'flow': return flowNodes.has(from) && flowNodes.has(to);
    case 'input': return information.has(from) && to === 'function';
    case 'output': return from === 'function' && information.has(to);
    case 'resource': return resources.has(from) && to === 'function';
    case 'responsible': case 'consults': case 'informs': return people.has(from) && to === 'function';
    case 'supports': return systems.has(from) && to === 'function';
    case 'measured-by': return from === 'function' && to === 'kpi';
    case 'contributes-to': return from === 'function' && to === 'goal';
    case 'risk': return from === 'risk' && to === 'function';
    case 'control': return from === 'control' && (to === 'risk' || to === 'function');
    default: return false;
  }
}

export function defaultEpcConnection(from: string, to: string): string | undefined {
  return epcConnectionTypes.find(edge => canConnectEpc(from, to, edge.id))?.id;
}

const epcGraphNotation = createGraphNotation({
  id: 'epc',
  title: 'EPC (частичный каталог)',
  fileExtension: 'epc',
  symbols: epcSymbols,
  defaultLabel: symbol => ['and', 'or', 'xor'].includes(symbol.type) ? '' : symbol.title,
  connectionTypes: epcConnectionTypes.map(edge => ({ ...edge, appearance: { ...edge.appearance } })),
  canConnect: canConnectEpc,
  defaultConnection: defaultEpcConnection,
});
export const epcNotation = {
  ...epcGraphNotation,
  read: (source: string) => {
    const result = epcGraphNotation.read(source);
    return { ...result, diagram: projectEpcEventEndpoints(result.diagram) };
  },
  validateDiagram: validateEpcDiagram,
  renderSymbolDetail: renderEpcSymbolDetail,
};
