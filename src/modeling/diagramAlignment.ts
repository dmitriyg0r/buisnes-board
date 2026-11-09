import type { DiagramPoint } from './types';

export type AlignmentBox = { x: number; y: number; width: number; height: number };
export type AlignmentGuide = { axis: 'x' | 'y'; position: number; from: number; to: number; kind: 'alignment' | 'spacing'; gap?: number };

type Candidate = { delta: number; guides: AlignmentGuide[]; priority: number };

/** Направляющие не меняют модель: возвращают только поправку к жесту и подсказки. */
export function alignDiagramBox(box: AlignmentBox, others: AlignmentBox[], tolerance: number): { offset: DiagramPoint; guides: AlignmentGuide[]; snappedX: boolean; snappedY: boolean } {
  const results: { candidate?: Candidate }[] = [{}, {}];
  for (const [index, axis] of (['x', 'y'] as const).entries()) {
    const pos = (b: AlignmentBox) => axis === 'x' ? b.x : b.y;
    const size = (b: AlignmentBox) => axis === 'x' ? b.width : b.height;
    const cross = (b: AlignmentBox) => axis === 'x' ? b.y : b.x;
    const crossSize = (b: AlignmentBox) => axis === 'x' ? b.height : b.width;
    const add = (candidate: Candidate) => {
      if (Math.abs(candidate.delta) > tolerance) return;
      const old = results[index].candidate;
      if (!old || Math.abs(candidate.delta) < Math.abs(old.delta) - .001 || (Math.abs(Math.abs(candidate.delta) - Math.abs(old.delta)) < .001 && candidate.priority < old.priority)) results[index].candidate = candidate;
    };
    for (const other of others) {
      const values = [pos(box), pos(box) + size(box) / 2, pos(box) + size(box)];
      const targets = [pos(other), pos(other) + size(other) / 2, pos(other) + size(other)];
      for (const value of values) for (const target of targets) add({ delta: target - value, priority: 0, guides: [{ axis, position: target, from: Math.min(cross(box), cross(other)), to: Math.max(cross(box) + crossSize(box), cross(other) + crossSize(other)), kind: 'alignment' }] });
    }
    // Равные интервалы ищем среди соседей в том же ряду или столбце.
    const row = others.filter(other => cross(other) < cross(box) + crossSize(box) && cross(other) + crossSize(other) > cross(box)).sort((a, b) => pos(a) - pos(b));
    for (let i = 0; i + 1 < row.length; i++) {
      const left = row[i], right = row.slice(i + 1).find(other => pos(other) >= pos(left) + size(left));
      if (!right) continue;
      const gap = pos(right) - (pos(left) + size(left));
      const line = cross(box) + crossSize(box) / 2;
      const spacing = (start: number, a: number, b: number, c: number, d: number) => add({ delta: start - pos(box), priority: 1, guides: [
        { axis: axis === 'x' ? 'y' : 'x', position: line, from: a, to: b, kind: 'spacing', gap },
        { axis: axis === 'x' ? 'y' : 'x', position: line, from: c, to: d, kind: 'spacing', gap },
      ] });
      const after = pos(right) + size(right) + gap;
      spacing(after, pos(left) + size(left), pos(right), pos(right) + size(right), after);
      const before = pos(left) - gap - size(box);
      spacing(before, before + size(box), pos(left), pos(left) + size(left), pos(right));
      const middleGap = (pos(right) - (pos(left) + size(left)) - size(box)) / 2;
      if (middleGap >= 0) {
        const middle = pos(left) + size(left) + middleGap;
        const guides: AlignmentGuide[] = [
          { axis: axis === 'x' ? 'y' : 'x', position: line, from: pos(left) + size(left), to: middle, kind: 'spacing', gap: middleGap },
          { axis: axis === 'x' ? 'y' : 'x', position: line, from: middle + size(box), to: pos(right), kind: 'spacing', gap: middleGap },
        ];
        add({ delta: middle - pos(box), priority: 1, guides });
      }
    }
  }
  const x = results[0].candidate, y = results[1].candidate;
  return { offset: { x: x?.delta ?? 0, y: y?.delta ?? 0 }, guides: [...(x?.guides ?? []), ...(y?.guides ?? [])], snappedX: Boolean(x), snappedY: Boolean(y) };
}
