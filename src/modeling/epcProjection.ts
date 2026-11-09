import type { Diagram, DiagramNode, DiagramPoint } from './types';

/** Только отображение старых маршрутов: исходный JSON не изменяется. */
function projectHexagonEnd(node: DiagramNode, point: DiagramPoint, next: DiagramPoint): DiagramPoint {
  const cx = node.x + node.width / 2, cy = node.y + node.height / 2;
  const rx = node.width / 2, ry = node.height / 2;
  const dx = point.x - cx, dy = point.y - cy, epsilon = 1e-6;
  if (Math.abs(dx) > rx + epsilon || Math.abs(dy) > ry + epsilon) return point;
  if (Math.abs(point.y - next.y) < epsilon && Math.abs(dx) >= Math.abs(dy / ry * rx) && (next.x - point.x) * dx > 0) {
    const target = cx + Math.sign(dx) * rx * (1 - .4 * Math.abs(dy) / ry);
    if ((next.x - target) * dx > 0) return { x: target, y: point.y };
  }
  if (Math.abs(point.x - next.x) < epsilon && Math.abs(dy / ry) >= Math.abs(dx / rx) && (next.y - point.y) * dy > 0) {
    const yLimit = Math.min(ry, Math.max(0, (1 - Math.abs(dx) / rx) * ry / .4));
    const target = cy + Math.sign(dy) * yLimit;
    if ((next.y - target) * dy > 0) return { x: point.x, y: target };
  }
  return point;
}

export function projectEpcEventEndpoints(diagram: Diagram): Diagram {
  const nodes = new Map(diagram.nodes.map(node => [node.id, node]));
  return { ...diagram, edges: diagram.edges.map(edge => {
    if (edge.points.length < 2) return edge;
    const points = edge.points.map(point => ({ ...point }));
    const from = nodes.get(edge.from), to = nodes.get(edge.to), last = points.length - 1;
    if (from?.type === 'event') points[0] = projectHexagonEnd(from, points[0], points[1]);
    if (to?.type === 'event') points[last] = projectHexagonEnd(to, points[last], points[last - 1]);
    return { ...edge, points };
  }) };
}
