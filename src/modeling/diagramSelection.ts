import type { DiagramBounds, DiagramNode, DiagramNotation, DiagramPoint } from './types';

/** Прямоугольник выделения не зависит от направления жеста. */
export function selectionBounds(start: DiagramPoint, end: DiagramPoint): DiagramBounds {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) };
}

/** Попадание хотя бы части фигуры в рамку включает её в выделение. */
export function nodesInSelection(nodes: readonly DiagramNode[], bounds: DiagramBounds): string[] {
  return nodes.filter(node => node.x <= bounds.x + bounds.width && node.x + node.width >= bounds.x && node.y <= bounds.y + bounds.height && node.y + node.height >= bounds.y).map(node => node.id);
}

/** Перемещает выделение одной операцией в истории редактора. */
export function moveSelectedNodes(notation: DiagramNotation, source: string, ids: readonly string[], delta: DiagramPoint): string {
  const wanted = new Set(ids);
  const nodes = notation.read(source).diagram.nodes.filter(node => wanted.has(node.id));
  if (nodes.length !== wanted.size) throw new Error('Один из выделенных элементов больше не существует.');
  return nodes.reduce((xml, node) => notation.moveNode(xml, node.id, { x: node.x + delta.x, y: node.y + delta.y }), source);
}
