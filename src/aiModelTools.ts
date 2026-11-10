import type { DiagramNotation, DiagramEdge } from './modeling/types';

/** Возможности берём у того же адаптера, который использует редактор. */
export function modelOperations(n: DiagramNotation): string[] {
  return ['add_node', 'rename', 'move_node', 'remove', ...(n.timeline ? ['add_message', 'move_message', ...(n.timeline.editMessage ? ['edit_message'] : [])] : ['connect', 'edit_edge', 'reset_edge']),
    ...(n.resizeNode ? ['resize_node'] : []), ...(n.setLabelBounds ? ['set_label_bounds'] : []),
    ...(n.setNodeCompartments ? ['set_compartments'] : []), ...(n.setEdgeEnds ? ['set_edge_ends'] : [])];
}

export function readModelSource(n: DiagramNotation, source: string) {
  const result = n.read(source);
  return { ...result, ...(n.timeline ? { timeline: n.timeline.project(source) } : {}), validation: n.validateDiagram?.(result.diagram) ?? [] };
}

export function applyModelOperation(n: DiagramNotation, source: string, op: Record<string, unknown>, local: (id: string) => string): string {
  const text = (key: string) => { if (typeof op[key] !== 'string') throw new Error(`Не указано строковое поле ${key}`); return op[key] as string; };
  const num = (key: string) => { if (typeof op[key] !== 'number' || !Number.isFinite(op[key])) throw new Error(`Не указано число ${key}`); return op[key] as number; };
  const id = () => local(text('id')), at = () => ({ x: num('x'), y: num('y') });
  const operation = text('op');
  if (!modelOperations(n).includes(operation)) throw new Error(`Нотация ${n.id} не поддерживает ${operation}`);
  const before = n.read(source); if (before.readOnlyReason) throw new Error(before.readOnlyReason);
  switch (operation) {
    case 'add_node': return n.addNode(source, text('type'), at());
    case 'rename': return n.rename(source, id(), text('name'));
    case 'move_node': return n.moveNode(source, id(), at());
    case 'resize_node': return n.resizeNode!(source, id(), num('width'), num('height'));
    case 'connect': return n.connect(source, local(text('from')), local(text('to')), op.type === undefined ? undefined : text('type'));
    case 'edit_edge': {
      if (!Array.isArray(op.points)) throw new Error('Не указан маршрут points');
      return n.editEdge(source, id(), local(text('from')), local(text('to')), op.points as { x: number; y: number }[]);
    }
    case 'reset_edge': return n.resetEdge(source, id());
    case 'remove': return n.remove(source, id());
    case 'set_label_bounds': return n.setLabelBounds!(source, id(), { ...at(), width: num('width'), height: num('height') });
    case 'set_compartments': {
      if (!Array.isArray(op.attributes) || !Array.isArray(op.operations)) throw new Error('Нужны attributes и operations');
      return n.setNodeCompartments!(source, id(), { attributes: op.attributes as string[], operations: op.operations as string[] });
    }
    case 'set_edge_ends': {
      if (!op.ends) throw new Error('Не заданы роли и кратности ends');
      return n.setEdgeEnds!(source, id(), op.ends as NonNullable<DiagramEdge['ends']>);
    }
    case 'add_message': return n.timeline!.addMessage(source, local(text('from')), local(text('to')), num('y'), op.type === undefined ? undefined : text('type'));
    case 'move_message': return n.timeline!.moveMessage(source, id(), num('sendY'), num('receiveY'));
    case 'edit_message': {
      if (op.type === undefined && op.from === undefined && op.to === undefined) throw new Error('Не заданы изменения сообщения');
      return n.timeline!.editMessage!(source, id(), { ...(op.type !== undefined ? { kind: text('type') } : {}), ...(op.from !== undefined ? { from: local(text('from')) } : {}), ...(op.to !== undefined ? { to: local(text('to')) } : {}) });
    }
    default: throw new Error(`Неизвестная операция ${operation}`);
  }
}
