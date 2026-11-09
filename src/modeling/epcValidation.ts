import type { Diagram, DiagramNode } from './types';

/**
 * Рекомендации для традиционной строгой EPC, а не запреты редактора.
 * Scheer PAS: https://doc.scheer-pas.com/business-modeler/latest/validation-rules
 * WU Wien: https://www.wu.ac.at/erp/webtrainer/epc-webtrainer/theory
 * В разных продуктах и конвенциях ARIS правила могут быть свободнее;
 * эти рекомендации не являются универсальным стандартом или запретом.
 * Достижимость здесь только структурная, без проверки исполнимости и парности операторов.
 */
export function validateEpcDiagram(diagram: Diagram): { id: string; message: string }[] {
  const warnings: { id: string; message: string }[] = [];
  const operators = new Set(['and', 'or', 'xor']);
  const flowTypes = new Set(['event', 'function', 'process-interface', ...operators]);
  const nodes = new Map(diagram.nodes.filter(node => flowTypes.has(node.type)).map(node => [node.id, node]));
  const incoming = new Map<string, string[]>(), outgoing = new Map<string, string[]>();
  for (const id of nodes.keys()) { incoming.set(id, []); outgoing.set(id, []); }
  let uncertainFlow = false;
  for (const edge of diagram.edges) {
    if (edge.type !== 'flow') continue;
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) { uncertainFlow = true; continue; }
    outgoing.get(edge.from)!.push(edge.to);
    incoming.get(edge.to)!.push(edge.from);
  }
  const name = (node: DiagramNode) => node.label || 'без названия';
  const add = (id: string, message: string) => warnings.push({ id, message });
  // Обход только через операторы; интерфейс останавливает проверку чередования.
  const throughOperators = (initial: string[], adjacency: Map<string, string[]>): DiagramNode[] => {
    const pending = [...initial], visited = new Set<string>(), result: DiagramNode[] = [];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const node = nodes.get(id);
      if (!node) continue;
      if (operators.has(node.type)) pending.push(...adjacency.get(id)!);
      else result.push(node);
    }
    return result;
  };
  for (const node of nodes.values()) {
    const before = incoming.get(node.id)!, after = outgoing.get(node.id)!;
    if (operators.has(node.type)) {
      if (!(before.length === 1 && after.length >= 2) && !(before.length >= 2 && after.length === 1)) {
        add(node.id, `Оператор «${name(node)}»: для ветвления или слияния рекомендуется одна связь с одной стороны и несколько с другой (сейчас: ${before.length} и ${after.length}).`);
      }
      if ((node.type === 'xor' || node.type === 'or') && after.length >= 2) {
        for (const previous of throughOperators(before, incoming)) {
          if (previous.type === 'event') add(node.id, `Оператор «${name(node)}»: после события «${name(previous)}» проверьте выбор ветви XOR/OR — событие само не принимает решение.`);
        }
      }
    }
    if (node.type === 'function' && (before.length !== 1 || after.length !== 1)) {
      add(node.id, `Функция «${name(node)}»: рекомендуется один вход и один выход управляющего потока (сейчас: ${before.length} и ${after.length}).`);
    }
    if (node.type === 'event' && (before.length > 1 || after.length > 1)) {
      add(node.id, `Событие «${name(node)}»: рекомендуется не более одного входа и одного выхода управляющего потока (сейчас: ${before.length} и ${after.length}).`);
    }
    if (node.type === 'event' || node.type === 'function') {
      for (const next of throughOperators(after, outgoing)) {
        if (next.type === node.type) add(node.id, `После ${node.type === 'event' ? 'события' : 'функции'} «${name(node)}» следует ${node.type === 'event' ? 'событие' : 'функция'} «${name(next)}»: проверьте чередование событий и функций.`);
      }
    }
  }

  // Не считаем одиночный элемент готовым процессом и не делаем выводов при
  // неизвестных концах потока, встречающихся в старых/частичных моделях.
  const connected = [...nodes.values()].filter(node => incoming.get(node.id)!.length + outgoing.get(node.id)!.length > 0);
  if (connected.length && !uncertainFlow) {
    const boundary = (node: DiagramNode) => node.type === 'event' || node.type === 'process-interface';
    const starts = connected.filter(node => boundary(node) && incoming.get(node.id)!.length === 0);
    const ends = connected.filter(node => boundary(node) && outgoing.get(node.id)!.length === 0);
    if (!starts.length) add(connected[0].id, 'Не найдено начальное событие или начальный интерфейс процесса; проверьте вход процесса.');
    if (!ends.length) add(connected[0].id, 'Не найдено конечное событие или конечный интерфейс процесса; проверьте выход процесса.');
    const reachable = (seeds: DiagramNode[], adjacency: Map<string, string[]>) => {
      const seen = new Set<string>(), pending = seeds.map(node => node.id);
      while (pending.length) {
        const id = pending.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        pending.push(...adjacency.get(id)!);
      }
      return seen;
    };
    const fromStart = reachable(starts, outgoing), toEnd = reachable(ends, incoming);
    for (const node of connected) {
      if (starts.length && !fromStart.has(node.id)) add(node.id, `«${name(node)}»: нет пути от начального события или интерфейса; проверьте вход потока.`);
      if (ends.length && !toEnd.has(node.id)) add(node.id, `«${name(node)}»: нет пути к конечному событию или интерфейсу; проверьте выход потока.`);
    }
  }
  return warnings;
}
