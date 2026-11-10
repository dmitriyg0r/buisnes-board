import type { CardSide } from './data';
import { simplifyRoute } from './modeling/orthogonalRouting';

type Point = { x: number; y: number };
type Box = Point & { w: number; h: number };

/**
 * При наложении карточек свободного выхода из выбранного порта может не быть.
 * Показываем связь через внешний контур, сохраняя оба порта. Участки выхода при
 * этом могут пересекать наложенные карточки — скрывать саму связь нельзя.
 */
export function overlappingCardRoute(start: Point, fromSide: CardSide, end: Point, toSide: CardSide, boxes: Box[]): Point[] {
  const gap = 28;
  // Далёкие карточки не должны раздувать петлю вокруг наложенных объектов.
  const involved = boxes.filter((box, i) => i < 2 || boxes.slice(0, 2).some(endpoint =>
    box.x < endpoint.x + endpoint.w + gap && box.x + box.w > endpoint.x - gap &&
    box.y < endpoint.y + endpoint.h + gap && box.y + box.h > endpoint.y - gap));
  const left = Math.min(start.x, end.x, ...involved.map(b => b.x)) - gap;
  const right = Math.max(start.x, end.x, ...involved.map(b => b.x + b.w)) + gap;
  const top = Math.min(start.y, end.y, ...involved.map(b => b.y)) - gap;
  const bottom = Math.max(start.y, end.y, ...involved.map(b => b.y + b.h)) + gap;
  const width = right - left, height = bottom - top, perimeter = 2 * (width + height);
  const exit = (p: Point, side: CardSide) => side === 'top' ? { x: p.x, y: top } : side === 'right' ? { x: right, y: p.y } : side === 'bottom' ? { x: p.x, y: bottom } : { x: left, y: p.y };
  const offset = (p: Point, side: CardSide) => side === 'top' ? p.x - left : side === 'right' ? width + p.y - top : side === 'bottom' ? width + height + right - p.x : 2 * width + height + bottom - p.y;
  const a = exit(start, fromSide), b = exit(end, toSide);
  const sa = offset(a, fromSide), sb = offset(b, toSide);
  const corners = [
    { at: 0, point: { x: left, y: top } },
    { at: width, point: { x: right, y: top } },
    { at: width + height, point: { x: right, y: bottom } },
    { at: 2 * width + height, point: { x: left, y: bottom } },
  ];
  const clockwise = (sb - sa + perimeter) % perimeter;
  // Совпавшие порты показываем петлёй, а не отрезком нулевой длины.
  const forward = clockwise <= perimeter / 2;
  const distance = clockwise === 0 ? perimeter : forward ? clockwise : perimeter - clockwise;
  const turns = corners.map(c => ({ ...c, distance: ((forward ? c.at - sa : sa - c.at) + perimeter) % perimeter }))
    .filter(c => c.distance > 0 && c.distance < distance).sort((a, b) => a.distance - b.distance);
  return simplifyRoute([start, a, ...turns.map(c => c.point), b, end]);
}
