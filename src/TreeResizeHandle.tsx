import { useEffect, useRef, useState } from 'react';

const DEFAULT_WIDTH = 232;
const MIN_WIDTH = 192;
const MAX_WIDTH = 560;
const STORAGE_KEY = 'bb.tree.width.v1';
const clampWidth = (width: number, max = MAX_WIDTH) => Math.round(Math.max(MIN_WIDTH, Math.min(max, width)));

export function useTreeWidth(storageKey = STORAGE_KEY) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) return clampWidth(saved);
    } catch { /* Хранилище может быть недоступно. */ }
    return DEFAULT_WIDTH;
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, String(width)); } catch { /* Хранилище может быть недоступно. */ }
  }, [width, storageKey]);
  return [width, setWidth] as const;
}

export function TreeResizeHandle({ width, onWidthChange }: { width: number; onWidthChange: (width: number) => void }) {
  const drag = useRef<{ pointer: number; x: number; width: number; max: number; savedWidth: number } | null>(null);
  const bounds = (element: HTMLElement) => {
    const pane = element.parentElement!;
    const actualWidth = pane.getBoundingClientRect().width;
    const canvasWidth = pane.nextElementSibling?.getBoundingClientRect().width ?? 320;
    return { width: actualWidth, max: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, actualWidth + canvasWidth - 320)) };
  };
  return <div className="tree-resizer" role="separator" aria-label="Ширина навигатора" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width} tabIndex={0} title="Потяните, чтобы изменить ширину навигатора. Двойной щелчок — сбросить."
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const box = bounds(event.currentTarget);
      drag.current = { pointer: event.pointerId, x: event.clientX, width: box.width, max: box.max, savedWidth: width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (!start || start.pointer !== event.pointerId) return;
      onWidthChange(clampWidth(start.width + event.clientX - start.x, start.max));
    }}
    onPointerUp={event => {
      if (drag.current?.pointer !== event.pointerId) return;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => {
      if (drag.current) onWidthChange(drag.current.savedWidth);
      drag.current = null;
    }}
    onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => onWidthChange(DEFAULT_WIDTH)}
    onKeyDown={event => {
      const box = bounds(event.currentTarget);
      const step = event.shiftKey ? 32 : 16;
      const next = event.key === 'ArrowLeft' ? box.width - step : event.key === 'ArrowRight' ? box.width + step : event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? box.max : null;
      if (next === null) return;
      event.preventDefault(); event.stopPropagation();
      onWidthChange(clampWidth(next, box.max));
    }} />;
}
