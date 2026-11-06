import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

type Point = { x: number; y: number };
export type GridItem = { key: string; label: string; visual: ReactNode; target?: { workspaceId: string; folderId: string | null } };
interface Props {
  items: GridItem[];
  selected: string | null;
  storageKey: string;
  toolbar: ReactNode;
  toolbarEnd: ReactNode;
  notice?: ReactNode;
  onSelect: (key: string) => void;
  onOpen: (key: string) => void;
  onContextMenu: (key: string, x: number, y: number) => void;
  onMove: (key: string, workspaceId: string, folderId: string | null) => void;
}

type Layout = { mode: 'grid' | 'free'; positions: Record<string, Point> };
const STEP_X = 132;
const STEP_Y = 142;

function loadLayout(key: string): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}') as Partial<Layout>;
    const positions: Record<string, Point> = {};
    if (saved.positions && typeof saved.positions === 'object') {
      for (const [id, point] of Object.entries(saved.positions)) {
        if (point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.y >= 0) positions[id] = point;
      }
    }
    return { mode: saved.mode === 'free' ? 'free' : 'grid', positions };
  } catch { return { mode: 'grid', positions: {} }; }
}

/** Положение значков сохраняется отдельно для каждой папки и пользователя в этом браузере. */
export function WorkspaceGrid({ items, selected, storageKey, toolbar, toolbarEnd, notice, onSelect, onOpen, onContextMenu, onMove }: Props) {
  const [layout, setLayout] = useState<Layout>(() => loadLayout(storageKey));
  const [width, setWidth] = useState(600);
  const canvas = useRef<HTMLUListElement>(null);
  const drag = useRef<{ key: string; pointer: number; x: number; y: number; origin: Point; moved: boolean; element: HTMLButtonElement; item: GridItem } | null>(null);
  const dropTarget = useRef<HTMLElement | null>(null);
  const [preview, setPreview] = useState<{ key: string; dx: number; dy: number } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return;
      const active = drag.current;
      drag.current = null;
      dropTarget.current?.classList.remove('ws-drop-target');
      dropTarget.current = null;
      setPreview(null);
      if (active.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer);
      suppressClick.current = active.moved;
      event.preventDefault();
    };
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('keydown', cancel);
      dropTarget.current?.classList.remove('ws-drop-target');
      const active = drag.current;
      drag.current = null;
      if (active?.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer);
    };
  }, []);

  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch { /* Хранилище браузера может быть недоступно. */ } }, [storageKey, layout]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [items.length === 0]);

  const columns = Math.max(1, Math.floor(width / STEP_X));
  const occupied = items.flatMap((item) => {
    const point = layout.positions[item.key];
    return point ? [{ x: Math.min(point.x, Math.max(0, width - 116)), y: point.y }] : [];
  });
  const automatic = new Map<string, Point>();
  for (const item of items) {
    if (layout.positions[item.key]) continue;
    let index = 0;
    let candidate: Point;
    do {
      candidate = { x: (index % columns) * STEP_X, y: Math.floor(index / columns) * STEP_Y };
      index += 1;
    } while (occupied.some((point) => Math.abs(point.x - candidate.x) < 116 && Math.abs(point.y - candidate.y) < STEP_Y));
    automatic.set(item.key, candidate);
    occupied.push(candidate);
  }
  const position = (item: GridItem, index: number): Point => {
    const point = layout.positions[item.key] ?? automatic.get(item.key) ?? { x: (index % columns) * STEP_X, y: Math.floor(index / columns) * STEP_Y };
    return { x: Math.min(point.x, Math.max(0, width - 116)), y: point.y };
  };
  const height = Math.max(280, ...items.map((item, index) => position(item, index).y + STEP_Y));
  const targetAt = (active: NonNullable<typeof drag.current>, x: number, y: number) => {
    const source = active.element.closest('li');
    const previous = source?.style.pointerEvents;
    if (source) source.style.pointerEvents = 'none';
    const hit = document.elementFromPoint(x, y);
    if (source) source.style.pointerEvents = previous ?? '';
    const target = hit?.closest<HTMLElement>('[data-workspace-drop][data-workspace-id][data-folder-id]') ?? null;
    // Запрещаем перенос папки в саму себя, в том числе через дерево или крошки.
    const self = active.item.target && target && target.dataset.workspaceId === active.item.target.workspaceId
      && target.dataset.folderId === (active.item.target.folderId ?? '');
    return { hit, target: self ? null : target, self: Boolean(self) };
  };
  const clearDrag = () => {
    dropTarget.current?.classList.remove('ws-drop-target');
    dropTarget.current = null;
    drag.current = null;
    setPreview(null);
  };
  const startDrag = (event: PointerEvent<HTMLButtonElement>, item: GridItem, index: number) => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    suppressClick.current = false;
    drag.current = { key: item.key, pointer: event.pointerId, x: event.clientX, y: event.clientY, origin: position(item, index), moved: false, element: event.currentTarget, item };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (!active.moved && Math.hypot(dx, dy) < 5) return;
    active.moved = true;
    const { target } = targetAt(active, event.clientX, event.clientY);
    if (target !== dropTarget.current) {
      dropTarget.current?.classList.remove('ws-drop-target');
      dropTarget.current = target;
      target?.classList.add('ws-drop-target');
    }
    setPreview({ key: active.key, dx, dy });
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    const { hit, target, self } = targetAt(active, event.clientX, event.clientY);
    suppressClick.current = active.moved;
    clearDrag();
    if (cancelled || !active.moved) return;
    if (target) {
      onMove(active.key, target.dataset.workspaceId!, target.dataset.folderId || null);
    } else if (!self && layout.mode === 'free' && hit === canvas.current) {
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      setLayout((previous) => ({ ...previous, positions: { ...previous.positions, [active.key]: { x: Math.max(0, Math.min(width - 116, active.origin.x + dx)), y: Math.max(0, active.origin.y + dy) } } }));
    }
  };

  return <>
    <div className="ws-toolbar">
      {toolbar}
      <div className="ws-toolbar-end">
        <div className="ws-view-switch" role="group" aria-label="Расположение значков">
          <button type="button" title="По сетке" aria-label="По сетке" aria-pressed={layout.mode === 'grid'} onClick={() => setLayout((old) => ({ ...old, mode: 'grid' }))}><Icon name="gridLayout" size={16}/></button>
          <button type="button" title="Свободно" aria-label="Свободно" aria-pressed={layout.mode === 'free'} onClick={() => setLayout((old) => ({ ...old, mode: 'free' }))}><Icon name="freeLayout" size={16}/></button>
        </div>
        {toolbarEnd}
      </div>
    </div>
    {notice}
    {items.length === 0 ? <div className="ws-empty"><b>Здесь пока пусто</b><span>Создайте папку или проект, либо загрузите файл.</span></div> : <ul ref={canvas} className={`ws-icons ${layout.mode === 'free' ? 'ws-icons-free' : ''}`} aria-label="Элементы папки" style={layout.mode === 'free' ? { height } : undefined}>
      {items.map((item, index) => <li key={item.key} style={{ ...(layout.mode === 'free' ? { left: position(item, index).x, top: position(item, index).y } : {}), ...(preview?.key === item.key ? { transform: `translate(${preview.dx}px, ${preview.dy}px)`, zIndex: 10 } : {}) }}>
        <button type="button" className={`ws-icon-item ${selected === item.key ? 'selected' : ''}`} aria-label={item.label} aria-pressed={selected === item.key} title={item.label} style={{ touchAction: 'none' }}
          {...(item.target ? { 'data-workspace-drop': '', 'data-workspace-id': item.target.workspaceId, 'data-folder-id': item.target.folderId ?? '' } : {})}
          onContextMenu={(event) => { event.preventDefault(); onSelect(item.key); onContextMenu(item.key, event.clientX, event.clientY); }}
          onDragStart={(event) => event.preventDefault()}
          onPointerDown={(event) => startDrag(event, item, index)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={(event) => endDrag(event, true)} onLostPointerCapture={(event) => endDrag(event, true)}
          onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(item.key); }}
          onDoubleClick={() => onOpen(item.key)} onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onSelect(item.key); onContextMenu(item.key, rect.left, rect.bottom); return; }
            if (event.key === 'Enter') { event.preventDefault(); onOpen(item.key); return; }
            if (layout.mode !== 'free' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const point = position(item, index);
            const dx = event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0;
            const dy = event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0;
            setLayout((old) => ({ ...old, positions: { ...old.positions, [item.key]: { x: Math.max(0, Math.min(width - 116, point.x + dx)), y: Math.max(0, point.y + dy) } } }));
          }}>
          <span className="ws-icon-visual">{item.visual}</span><span className="ws-icon-label">{item.label}</span>
        </button>
      </li>)}
    </ul>}
  </>;
}
