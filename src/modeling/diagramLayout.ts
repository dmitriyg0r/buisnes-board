import type { Diagram, DiagramNode, DiagramRegion } from './types';

/** Ранги графа без обратных дуг DFS: циклы сохраняются, но не растягивают сетку. */
export function graphRanks(nodes: readonly DiagramNode[], edges: Diagram['edges']): Map<string, number> {
  const outgoing = new Map(nodes.map(n => [n.id, edges.filter(e => e.from === n.id && nodes.some(n => n.id === e.to))]));
  const visited = new Set<string>(), active = new Set<string>(), back = new Set<string>(), order: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id); active.add(id);
    for (const edge of outgoing.get(id) ?? []) { if (active.has(edge.to)) back.add(edge.id); else visit(edge.to); }
    active.delete(id); order.unshift(id);
  };
  const targets = new Set(edges.map(e => e.to));
  for (const n of [...nodes.filter(n => !targets.has(n.id)), ...nodes]) visit(n.id);
  const ranks = new Map(nodes.map(n => [n.id, 0]));
  for (const id of order) for (const edge of outgoing.get(id) ?? []) if (!back.has(edge.id)) ranks.set(edge.to, Math.max(ranks.get(edge.to)!, ranks.get(id)! + 1));
  return ranks;
}

/** Атомарная геометрия: дорожки идут вплотную, каждый ранг имеет собственный коридор. */
export function layoutDiagram(diagram: Diagram, options: { vertical?: boolean; lanes?: DiagramRegion[]; laneOf?: Map<string, string>; flowTypes?: string[] } = {}): Diagram {
  const nodes = diagram.nodes.map(n => ({ ...n, ...(n.labelBounds ? { labelBounds: { ...n.labelBounds } } : {}) }));
  if (!nodes.length) return { ...diagram, nodes };
  const ranks = graphRanks(nodes, options.flowTypes ? diagram.edges.filter(e => options.flowTypes!.includes(e.type)) : diagram.edges);
  const maxRank = Math.max(...ranks.values());
  const lanes = options.lanes?.map(r => ({ ...r })).sort((a, b) => a.y - b.y) ?? [];
  const vertical = options.vertical && !lanes.length;
  const breadth = Math.max(vertical ? 64 : 160, ...nodes.map(n => vertical ? n.height : n.width));
  const depth = Math.max(100, ...nodes.map(n => vertical ? n.width : n.height));
  const column = breadth + (vertical ? 80 : 120), row = depth + 85;
  const laneOf = options.laneOf ?? new Map<string, string>();
  if (lanes.length) for (const node of nodes) if (!laneOf.has(node.id)) {
    const nearest = [...lanes].sort((a, b) => Math.abs(a.y + a.height / 2 - node.y - node.height / 2) - Math.abs(b.y + b.height / 2 - node.y - node.height / 2))[0];
    laneOf.set(node.id, nearest.id);
  }
  const groups = lanes.length ? lanes.map(l => l.id) : [''];
  let top = 60;
  for (const group of groups) {
    const members = nodes.filter(n => !lanes.length || laneOf.get(n.id) === group);
    const buckets = Array.from({ length: maxRank + 1 }, (_, rank) => members.filter(n => ranks.get(n.id) === rank).sort((a, b) => (vertical ? a.x - b.x : a.y - b.y)));
    const tracks = Math.max(1, ...buckets.map(b => b.length));
    const lane = lanes.find(l => l.id === group);
    if (lane) Object.assign(lane, { x: 40, y: top, width: (maxRank + 1) * column + 120, height: tracks * row + 60 });
    for (let rank = 0; rank < buckets.length; rank++) for (let track = 0; track < buckets[rank].length; track++) {
      const n = buckets[rank][track], old = { x: n.x, y: n.y };
      n.x = vertical ? 100 + track * row + (depth - n.width) / 2 : 120 + rank * column + (breadth - n.width) / 2;
      n.y = vertical ? 80 + rank * column + (breadth - n.height) / 2 : top + 40 + track * row + (depth - n.height) / 2;
      if (n.labelBounds) { n.labelBounds.x += n.x - old.x; n.labelBounds.y += n.y - old.y; }
    }
    top += tracks * row + 60;
  }
  return { nodes, edges: diagram.edges.map(e => ({ ...e })), ...(lanes.length ? { regions: lanes } : {}) };
}
