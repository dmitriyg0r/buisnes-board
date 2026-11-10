import type { Diagram, DiagramNotation } from './types';

export interface ModelDragChange { id: string; kind: 'node' | 'region' | 'resize' | 'label'; x: number; y: number; width?: number; height?: number }
export interface ModelDragFrame { model: string; gesture: string; phase: 'move' | 'end' | 'cancel'; changes: ModelDragChange[] }
export interface ModelDragEvent extends ModelDragFrame { user: string; session: string; seq: number }
export const MODEL_DRAG_TTL = 12_000;

/** Просроченный или пришедший не по порядку HTTP-кадр не должен возвращать объект назад. */
export function acceptModelDrag(versions: Map<string, number>, frame: ModelDragEvent): boolean {
  const key = `${frame.user}:${frame.session}`;
  if (frame.seq <= (versions.get(key) ?? 0)) return false;
  versions.set(key, frame.seq);
  if (versions.size > 256) versions.delete(versions.keys().next().value!);
  return true;
}

/** Только предпросмотр: исходник и история редактора не меняются, работают обычные адаптеры. */
export function previewModelDrag(notation: DiagramNotation, source: string, changes: readonly ModelDragChange[]): string {
  let next = source;
  for (const change of changes) {
    if (change.kind === 'region') {
      if (!notation.moveRegion) throw new Error('Перемещение области не поддерживается.');
      next = notation.moveRegion(next, change.id, change);
    } else if (change.kind === 'label') {
      if (!notation.setLabelBounds || change.width === undefined || change.height === undefined) throw new Error('Размер подписи не поддерживается.');
      next = notation.setLabelBounds(next, change.id, { ...change, width: change.width, height: change.height });
    } else {
      if (change.kind === 'resize') {
        if (!notation.resizeNode || change.width === undefined || change.height === undefined) throw new Error('Размер элемента не поддерживается.');
        next = notation.resizeNode(next, change.id, change.width, change.height);
      }
      next = notation.moveNode(next, change.id, change);
    }
  }
  const parsed = notation.read(next);
  if (parsed.readOnlyReason) throw new Error(parsed.readOnlyReason);
  return next;
}

export function modelDragMatches(diagram: Diagram, changes: readonly ModelDragChange[]): boolean {
  return changes.every(change => {
    const node = diagram.nodes.find(node => node.id === change.id);
    const bounds = change.kind === 'region' ? diagram.regions?.find(region => region.id === change.id) : change.kind === 'label' ? node?.labelBounds : node;
    return bounds && Math.abs(bounds.x - change.x) < .01 && Math.abs(bounds.y - change.y) < .01 &&
      (change.width === undefined || Math.abs(bounds.width - change.width) < .01) && (change.height === undefined || Math.abs(bounds.height - change.height) < .01);
  });
}
