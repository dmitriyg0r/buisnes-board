/** Число точек связи на стороне зависит от её длины. */
export function connectionPortCount(length: number, single = false): number {
  return single ? 1 : Math.max(1, Math.min(12, Math.floor(length / 100)));
}
