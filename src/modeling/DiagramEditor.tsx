import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../Icon';
import { WorkspaceActionDialog } from '../WorkspaceActionDialog';
import { WorkspaceContextMenu } from '../WorkspaceContextMenu';
import { connectionPortCount } from '../connectionPorts';
import { hasSelfIntersections, simplifyRoute } from './orthogonalRouting';
import { endpointsFaceOutward, routeBetweenNodes } from './diagramRouting';
import { moveSelectedNodes, nodesInSelection, selectionBounds } from './diagramSelection';
import type { Diagram, DiagramEdge, DiagramNode, DiagramNotation, DiagramPoint, DiagramSymbol } from './types';

interface Props {
  notation: DiagramNotation & { addPool?: (source: string, at: DiagramPoint) => string };
  title: string;
  source: string;
  onSave: (title: string, source: string, imported: boolean) => void;
  onClose: () => void;
}
type View = { x: number; y: number; width: number; height: number };
type ConnectionAppearance = { lineStyle?: 'solid' | 'dotted' | 'dashed'; startMarker?: 'circle'; arrowStart?: boolean; arrowEnd?: boolean; arrowStyle?: 'open' | 'filled' };
type ConnectionOption = { id: string; title: string; appearance?: ConnectionAppearance };
type EdgeDrag = { edge: DiagramEdge; pointer: number; start: DiagramPoint; kind: 'point' | 'segment'; index: number; element: SVGElement; points: DiagramPoint[]; from: string; to: string; valid: boolean; moved: boolean };
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type Drag = { kind?: 'region' | 'resize' | 'label-resize'; width?: number; height?: number; corner?: ResizeCorner; square?: boolean; ids?: string[]; id: string; pointer: number; start: DiagramPoint; original: DiagramPoint; current: DiagramPoint; element: SVGGElement; moved: boolean };
type Marquee = { pointer: number; start: DiagramPoint; current: DiagramPoint; client: DiagramPoint; moved: boolean; additive: boolean; previous: string[] };

function resized(item: Drag) {
  const left = item.corner === 'nw' || item.corner === 'sw';
  const top = item.corner === 'nw' || item.corner === 'ne';
  const dx = (item.current.x - item.original.x) * (left ? -1 : 1);
  const dy = (item.current.y - item.original.y) * (top ? -1 : 1);
  let width = Math.max(item.kind === 'label-resize' ? 30 : 40, item.width! + dx);
  let height = Math.max(item.kind === 'label-resize' ? 18 : 30, item.height! + dy);
  if (item.square) { const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy; width = height = Math.max(40, item.width! + delta); }
  return { x: left ? item.original.x + item.width! - width : item.original.x, y: top ? item.original.y + item.height! - height : item.original.y, width, height };
}

function nodeLabelBounds(node: DiagramNode, symbol?: DiagramSymbol) {
  if (node.labelBounds) return node.labelBounds;
  if (symbol?.shape === 'annotation') return { x: node.x + 12, y: node.y + 6, width: Math.max(30, node.width - 18), height: Math.max(18, node.height - 12) };
  if (symbol?.shape !== 'rounded-rectangle') return { x: node.x + node.width / 2 - Math.max(100, node.width) / 2, y: node.y + node.height + 6, width: Math.max(100, node.width), height: 42 };
  return { x: node.x + 8, y: node.y + 24, width: Math.max(30, node.width - 16), height: Math.max(18, node.height - 30) };
}

function ConnectionExample({ appearance, automatic }: { appearance?: ConnectionAppearance; automatic?: boolean }) {
  const dotted = appearance?.lineStyle === 'dotted';
  const arrowEnd = appearance?.arrowEnd ?? true;
  const arrowStart = appearance?.arrowStart ?? false;
  const dashed = appearance?.lineStyle === 'dashed';
  const open = appearance?.arrowStyle === 'open' || dotted;
  return <svg className="diagram-connection-example" viewBox="0 0 110 36" aria-hidden="true">
    <path d="M13 18 H96" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap={dotted ? 'round' : 'butt'} strokeDasharray={dotted ? '2 5' : dashed ? '6 4' : undefined} />
    {appearance?.startMarker === 'circle' && <circle cx="13" cy="18" r="4" fill="white" stroke="currentColor" strokeWidth="2" />}
    {arrowEnd && (open ? <path d="M88 12 L96 18 L88 24" fill="none" stroke="currentColor" strokeWidth="2" /> : <path d="M87 12 L97 18 L87 24 Z" fill="currentColor" />)}
    {arrowStart && <path d="M21 12 L13 18 L21 24" fill="none" stroke="currentColor" strokeWidth="2" />}
    {automatic && <text x="12" y="11" fontSize="10" fill="currentColor">А</text>}
  </svg>;
}

function labelLines(text: string, width: number, maxLines = 3): string[] {
  const limit = Math.max(4, Math.floor(width / 7));
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.trim().split(/\s+/).flatMap((word) => word.match(new RegExp(`.{1,${limit}}`, 'gu')) ?? []);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      if (line && line.length + word.length + 1 <= limit) line += ` ${word}`;
      else { if (line) lines.push(line); line = word; }
    }
    lines.push(line);
  }
  if (lines.length > maxLines) return [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1].slice(0, limit - 1)}…`];
  return lines;
}

function initialView(diagram: Diagram): View {
  const items = [...diagram.nodes, ...(diagram.regions ?? [])];
  if (!items.length) return { x: 0, y: 0, width: 1000, height: 650 };
  const x = Math.min(...items.map((n) => n.x)) - 120;
  const y = Math.min(...items.map((n) => n.y)) - 120;
  const right = Math.max(...items.map((n) => n.x + n.width)) + 120;
  const bottom = Math.max(...items.map((n) => n.y + n.height)) + 120;
  return { x, y, width: Math.max(800, right - x), height: Math.max(560, bottom - y) };
}

function anchor(node: { x: number; y: number; width: number; height: number }, at: DiagramPoint, shape?: DiagramSymbol['shape']): DiagramPoint {
  const cx = node.x + node.width / 2; const cy = node.y + node.height / 2;
  const dx = at.x - cx; const dy = at.y - cy;
  if (!dx && !dy) return { x: cx + node.width / 2, y: cy };
  const rx = node.width / 2; const ry = node.height / 2;
  const factor = shape === 'circle' || shape === 'double-circle' ? 1 / Math.hypot(dx / rx, dy / ry)
    : shape === 'diamond' ? 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry)
    : 1 / Math.max(Math.abs(dx) / rx, Math.abs(dy) / ry);
  return { x: cx + dx * factor, y: cy + dy * factor };
}

function orthogonal(points: DiagramPoint[]): boolean {
  return points.length >= 2 && points.slice(1).every((p, i) => p.x === points[i].x || p.y === points[i].y);
}

function moveRoutePoint(points: DiagramPoint[], index: number, at: DiagramPoint): DiagramPoint[] {
  const next = points.map((p) => ({ ...p }));
  const old = next[index];
  const before = next[index - 1]; const after = next[index + 1];
  if (before && after) {
    const replacement: DiagramPoint[] = [];
    if (index === 1) {
      const mid = { x: (before.x + old.x) / 2, y: (before.y + old.y) / 2 };
      replacement.push(mid, before.y === old.y ? { x: mid.x, y: at.y } : { x: at.x, y: mid.y });
    } else if (before.y === old.y) before.y = at.y; else before.x = at.x;
    replacement.push(at);
    if (index === next.length - 2) {
      const mid = { x: (after.x + old.x) / 2, y: (after.y + old.y) / 2 };
      replacement.push(after.y === old.y ? { x: mid.x, y: at.y } : { x: at.x, y: mid.y }, mid);
    } else if (after.y === old.y) after.y = at.y; else after.x = at.x;
    next.splice(index, 1, ...replacement);
    return simplifyRoute(next);
  }
  const replacement: DiagramPoint[] = [];
  if (before) replacement.push(before.y === old.y ? { x: at.x, y: before.y } : { x: before.x, y: at.y });
  replacement.push(at);
  if (after) replacement.push(after.y === old.y ? { x: at.x, y: after.y } : { x: after.x, y: at.y });
  next.splice(index, 1, ...replacement);
  return next.filter((p, i) => i === 0 || p.x !== next[i - 1].x || p.y !== next[i - 1].y);
}

function moveRouteSegment(points: DiagramPoint[], index: number, dx: number, dy: number): DiagramPoint[] {
  const next = points.map((p) => ({ ...p })); const a = next[index]; const b = next[index + 1];
  const shift = (p: DiagramPoint) => a.y === b.y ? { x: p.x, y: p.y + dy } : { x: p.x + dx, y: p.y };
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length) return points;
  const fraction = Math.min(16 / length, 1 / 3);
  const startStub = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
  const endStub = { x: b.x + (a.x - b.x) * fraction, y: b.y + (a.y - b.y) * fraction };
  next.splice(index, 2, ...(index === 0 ? [a, startStub, shift(startStub)] : [shift(a)]), ...(index + 1 === points.length - 1 ? [shift(endStub), endStub, b] : [shift(b)]));
  return simplifyRoute(next);
}

function validRoute(points: DiagramPoint[], nodes: DiagramNode[], from: string, to: string): boolean {
  const route = simplifyRoute(points);
  if (route.length < 2 || route.length > 10 || hasSelfIntersections(route)) return false;
  const source = nodes.find(node => node.id === from), target = nodes.find(node => node.id === to);
  if (!source || !target || !endpointsFaceOutward(route, source, target)) return false;
  return route.slice(1).every((end, index) => nodes.every((node) => {
    if ((index === 0 && node.id === from) || (index === route.length - 2 && node.id === to)) return true;
    const start = route[index];
    if (start.y === end.y) return !(start.y > node.y && start.y < node.y + node.height && Math.max(start.x, end.x) > node.x && Math.min(start.x, end.x) < node.x + node.width);
    return !(start.x > node.x && start.x < node.x + node.width && Math.max(start.y, end.y) > node.y && Math.min(start.y, end.y) < node.y + node.height);
  }));
}

function pathMiddle(points: DiagramPoint[]): DiagramPoint {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let index = 0; index < lengths.length; index++) {
    if (remaining <= lengths[index]) {
      const part = lengths[index] ? remaining / lengths[index] : 0;
      return { x: points[index].x + (points[index + 1].x - points[index].x) * part, y: points[index].y + (points[index + 1].y - points[index].y) * part };
    }
    remaining -= lengths[index];
  }
  return points[0];
}

function NodeShape({ node, symbol, selected, detail }: { node: DiagramNode; symbol?: DiagramSymbol; selected: boolean; detail?: ReactNode }) {
  const { width: w, height: h } = node;
  const shape = symbol?.shape ?? 'rounded-rectangle';
  const className = `diagram-shape${selected ? ' selected' : ''}`;
  if (shape === 'data-store') return <><path className={className} d={`M0 8 C0 -2 ${w} -2 ${w} 8 V${h - 8} C${w} ${h + 2} 0 ${h + 2} 0 ${h - 8} Z`} /><path className="diagram-kind" d={`M0 8 C0 18 ${w} 18 ${w} 8 M0 14 C0 24 ${w} 24 ${w} 14`} /></>;
  if (shape === 'circle' || shape === 'double-circle') return <><ellipse className={`${className}${symbol?.outline === 'thick' ? ' double-circle' : ''}`} cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} />{symbol?.outline === 'double' && <ellipse className="diagram-inner-outline" cx={w / 2} cy={h / 2} rx={w / 2 - 4} ry={h / 2 - 4} />}{detail && <svg x={w * .22} y={h * .22} width={w * .56} height={h * .56} viewBox="0 0 24 24" aria-hidden="true" pointerEvents="none">{detail}</svg>}</>;
  if (shape === 'document') return <><path className={className} d={`M0 0 H${w - 12} L${w} 12 V${h} H0 Z`} /><path className="diagram-kind" d={`M${w - 12} 0 V12 H${w}`} /></>;
  if (shape === 'annotation') return <><rect width={w} height={h} fill="transparent" /><path className={className + ' diagram-annotation'} d={`M12 0 H0 V${h} H12`} /></>;
  if (shape === 'diamond') return <>
    <polygon className={className} points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`} />
    {symbol?.glyph === 'plus' && <path className="diagram-glyph" d={`M${w / 2} ${h * 0.3} V${h * 0.7} M${w * 0.3} ${h / 2} H${w * 0.7}`} />}
    {symbol?.glyph === 'cross' && <path className="diagram-glyph" d={`M${w * 0.34} ${h * 0.34} L${w * 0.66} ${h * 0.66} M${w * 0.66} ${h * 0.34} L${w * 0.34} ${h * 0.66}`} />}
    {symbol?.glyph === 'inclusive' && <circle className="diagram-inner-outline" cx={w / 2} cy={h / 2} r={w * 0.16} />}
    {symbol?.glyph === 'complex' && <path className="diagram-glyph" d={`M${w / 2} ${h * .27} V${h * .73} M${w * .27} ${h / 2} H${w * .73} M${w * .34} ${h * .34} L${w * .66} ${h * .66} M${w * .66} ${h * .34} L${w * .34} ${h * .66}`} />}
    {symbol?.glyph === 'event-based-exclusive' && <><circle className="diagram-inner-outline" cx={w / 2} cy={h / 2} r={w * .22} /><circle className="diagram-inner-outline" cx={w / 2} cy={h / 2} r={w * .18} /><path className="diagram-glyph" d={`M${w * .5} ${h * .37} L${w * .62} ${h * .46} L${w * .57} ${h * .6} L${w * .43} ${h * .6} L${w * .38} ${h * .46} Z`} /></>}
  </>;
  return <><rect className={className} width={w} height={h} rx={10} />{symbol?.glyph === 'person' && <path className="diagram-kind" d="M12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM7 23c0-4 2-6 5-6s5 2 5 6" />}{symbol?.glyph === 'service' && <path className="diagram-kind" d="M12 9v14M5 16h14M7 11l10 10M17 11 7 21M12 12a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />}
    {symbol?.glyph === 'manual' && <path className="diagram-kind" d="M7 18v-6a1.5 1.5 0 0 1 3 0v4-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v7c0 3-2 5-5 5h-2c-2 0-3-1-4-2l-3-4a2 2 0 0 1 2-2z" />}
    {(symbol?.glyph === 'send' || symbol?.glyph === 'receive') && <><rect x="6" y="10" width="16" height="11" className={symbol.glyph === 'send' ? 'diagram-envelope-filled' : 'diagram-kind'} /><path d="M6 10l8 6 8-6" className={symbol.glyph === 'send' ? 'diagram-envelope-line' : 'diagram-kind'} /></>}
    {symbol?.glyph === 'business-rule' && <path className="diagram-kind" d="M6 9h16v14H6zM6 14h16M12 14v9M17 14v9M6 19h16" />}
    {symbol?.glyph === 'script' && <path className="diagram-kind" d="M8 9h11v12c0 2-1 3-3 3H7c1 0 2-1 2-3V11c0-1-1-2-2-2zm2 4h6m-6 4h6m-6 4h5" />}
    {symbol?.glyph === 'collapsed-subprocess' && <><rect className="diagram-kind" x={w / 2 - 7} y={h - 19} width="14" height="14" /><path className="diagram-kind" d={`M${w / 2 - 4} ${h - 12}h8 M${w / 2} ${h - 16}v8`} /></>}
  </>;
}

export function DiagramEditor({ notation, title, source: original, onSave, onClose }: Props) {
  const [name, setName] = useState(title);
  const [source, setSource] = useState(original);
  const [failure, setFailure] = useState<string | null>(null);
  const [selected, setSelectedState] = useState<string | null>(null);
  const [groupSelected, setGroupSelected] = useState<string[]>([]);
  const setSelected = (id: string | null) => { setSelectedState(id); setGroupSelected([]); };
  const setSelection = (ids: string[]) => { const unique = [...new Set(ids)]; setSelectedState(unique.length === 1 ? unique[0] : null); setGroupSelected(unique.length > 1 ? unique : []); };

  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const marqueeRef = useRef<Marquee | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [tool, setTool] = useState('select');
  const [paletteQuery, setPaletteQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [sourceAnchor, setSourceAnchor] = useState<DiagramPoint | null>(null);
  useEffect(() => { if (!connectFrom) { setSourceAnchor(null); connectionClient.current = null; } }, [connectFrom]);
  const [cursor, setCursor] = useState<DiagramPoint | null>(null);
  const connectionClient = useRef<DiagramPoint | null>(null);
  const [placementCursor, setPlacementCursor] = useState<DiagramPoint | null>(null);
  const placementClient = useRef<DiagramPoint | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [imported, setImported] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [connectionMenu, setConnectionMenu] = useState<{ x: number; y: number } | null>(null);
  const [connectionType, setConnectionType] = useState<string | undefined>();
  const [properties, setProperties] = useState(false);
  const [editing, setEditing] = useState<{ id: string; value: string; x: number; y: number; width: number; height: number; multiline: boolean } | null>(null);
  const editingRef = useRef(editing); editingRef.current = editing;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [edgeDrag, setEdgeDrag] = useState<EdgeDrag | null>(null);
  const edgeDragRef = useRef<EdgeDrag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const portDragRef = useRef<{ id: string; pointer: number; start: DiagramPoint; moved: boolean; element: SVGGElement } | null>(null);
  const panRef = useRef<{ pointer: number; x: number; y: number; scale: number; view: View } | null>(null);
  const history = useRef<{ past: { source: string; imported: boolean }[]; future: { source: string; imported: boolean }[] }>({ past: [], future: [] });
  const svg = useRef<SVGSVGElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const parsed = useMemo<{ diagram: Diagram; readOnlyReason?: string; error?: string }>(() => {
    try { return notation.read(source); } catch (error) { return { diagram: { nodes: [], edges: [] } as Diagram, error: error instanceof Error ? error.message : 'Не удалось открыть модель.' }; }
  }, [source, notation]);
  const selectedIds = groupSelected.length ? groupSelected : selected && parsed.diagram.nodes.some(node => node.id === selected) ? [selected] : [];
  const [view, setView] = useState<View>(() => { try { return initialView(notation.read(original).diagram); } catch { return initialView({ nodes: [], edges: [] }); } });
  const locked = Boolean(parsed.error || parsed.readOnlyReason);
  const dirty = source !== original || name !== title;
  const selectedNode = parsed.diagram.nodes.find((node) => node.id === selected);
  const selectedSymbol = notation.symbols.find((symbol) => symbol.type === selectedNode?.type);
  const selectedLabelBounds = selectedNode ? nodeLabelBounds(selectedNode, selectedSymbol) : undefined;
  const selectedEdge = parsed.diagram.edges.find((edge) => edge.id === selected);
  const selectedRegion = parsed.diagram.regions?.find((region) => region.id === selected);
  const paletteGroups = Array.from(new Set(notation.symbols.map((symbol) => symbol.group ?? 'Другие')));
  const searchPalette = paletteQuery.trim().toLocaleLowerCase('ru');
  const placementSymbol = notation.symbols.find((symbol) => symbol.type === tool);
  const placementSize = tool === 'pool' ? notation.poolPlacementSize : tool === 'region' ? notation.regionPlacementSize : undefined;
  const placingObject = !locked && Boolean(placementSymbol || (tool === 'pool' && notation.addPool) || (tool === 'region' && notation.addRegion));

  const apply = (operation: (current: string) => string) => {
    if (locked) return false;
    try {
      const next = operation(source);
      if (next === source) return false;
      const checked = notation.read(next);
      if (checked.readOnlyReason) throw new Error(checked.readOnlyReason);
      history.current.past.push({ source, imported }); history.current.future = []; setSource(next); setFailure(null);
      return true;
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Не удалось изменить диаграмму.'); return false; }
  };
  const cancelGesture = () => {
    const box = marqueeRef.current; marqueeRef.current = null; setMarquee(null);
    if (box && svg.current?.hasPointerCapture(box.pointer)) svg.current.releasePointerCapture(box.pointer);
    const port = portDragRef.current; portDragRef.current = null;
    if (port?.element.hasPointerCapture(port.pointer)) port.element.releasePointerCapture(port.pointer);
    const activeEdge = edgeDragRef.current; edgeDragRef.current = null; setEdgeDrag(null);
    if (activeEdge?.element.hasPointerCapture(activeEdge.pointer)) activeEdge.element.releasePointerCapture(activeEdge.pointer);
    const active = dragRef.current;
    const pan = panRef.current;
    dragRef.current = null; setDrag(null); panRef.current = null;
    if (active?.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer);
    if (pan && svg.current?.hasPointerCapture(pan.pointer)) svg.current.releasePointerCapture(pan.pointer);
  };
  const undo = () => { cancelGesture(); const prev = history.current.past.pop(); if (prev !== undefined) { history.current.future.push({ source, imported }); setSource(prev.source); setImported(prev.imported); setSelected(null); setConnectFrom(null); } };
  const redo = () => { cancelGesture(); const next = history.current.future.pop(); if (next !== undefined) { history.current.past.push({ source, imported }); setSource(next.source); setImported(next.imported); setSelected(null); setConnectFrom(null); } };
  const point = (clientX: number, clientY: number): DiagramPoint => {
    const element = svg.current; const matrix = element?.getScreenCTM();
    if (!element || !matrix) return { x: 0, y: 0 };
    const p = element.createSVGPoint(); p.x = clientX; p.y = clientY; const out = p.matrixTransform(matrix.inverse());
    return { x: out.x, y: out.y };
  };
  const connectionTarget = (at: DiagramPoint, from: string) => {
    const scale = Math.abs(svg.current?.getScreenCTM()?.a || 1);
    const nodes = parsed.diagram.nodes.filter((node) => node.id !== from).map((node) => {
      const symbol = notation.symbols.find((item) => item.type === node.type);
      const ports = (['top', 'right', 'bottom', 'left'] as const).flatMap((side) => {
        const horizontal = side === 'top' || side === 'bottom';
        const count = connectionPortCount(horizontal ? node.width : node.height, symbol?.singleConnectionPortPerSide);
        return Array.from({ length: count }, (_, i) => {
          const offset = (i + 1) / (count + 1);
          const local = { x: horizontal ? node.width * offset : side === 'left' ? 0 : node.width, y: horizontal ? side === 'top' ? 0 : node.height : node.height * offset };
          const edge = anchor({ x: 0, y: 0, width: node.width, height: node.height }, local, symbol?.shape);
          const endpoint = { x: node.x + edge.x, y: node.y + edge.y };
          const center = { x: endpoint.x + (side === 'left' ? -14 : side === 'right' ? 14 : 0), y: endpoint.y + (side === 'top' ? -14 : side === 'bottom' ? 14 : 0) };
          return { endpoint, distance: Math.hypot(center.x - at.x, center.y - at.y) * scale };
        });
      });
      const port = ports.sort((a, b) => a.distance - b.distance)[0];
      const distance = Math.hypot(Math.max(node.x - at.x, 0, at.x - node.x - node.width), Math.max(node.y - at.y, 0, at.y - node.y - node.height)) * scale;
      return { id: node.id, distance: Math.min(distance, Math.max(0, port.distance - 7 * scale)), endpoint: port.distance <= 7 * scale + 2 ? port.endpoint : anchor(node, at, symbol?.shape) };
    });
    const pools = (parsed.diagram.regions ?? []).filter((region) => region.kind === 'pool' && region.id !== from).map((region) => ({ id: region.id, distance: Math.hypot(Math.max(region.x - at.x, 0, at.x - region.x - region.width), Math.max(region.y - at.y, 0, at.y - region.y - region.height)) * scale, endpoint: null }));
    return [...nodes, ...pools].filter((candidate) => candidate.distance <= 18).sort((a, b) => a.distance - b.distance)[0];
  };
  const makeConnection = (value: string, from: string, to: string, start: DiagramPoint | null, end: DiagramPoint | null) => {
    const before = notation.read(value).diagram;
    let next = notation.connect(value, from, to, connectionType);
    if (!start && !end) return next;
    const edge = notation.read(next).diagram.edges.find((item) => item.from === from && item.to === to && !before.edges.some((old) => old.id === item.id));
    if (!edge || edge.routeEditable === false || !orthogonal(edge.points)) throw new Error('Нельзя сохранить выбранные точки этой связи.');
    const a = before.nodes.find((node) => node.id === from), b = before.nodes.find((node) => node.id === to);
    if (!a || !b) throw new Error('Нельзя сохранить выбранные точки этой связи.');
    const points = routeBetweenNodes(before.nodes, a, b, start ?? undefined, end ?? undefined, n => notation.symbols.find(symbol => symbol.type === n.type)?.shape);
    if (!points) throw new Error('Не удалось построить маршрут от выбранных точек без пересечений.');
    next = notation.editEdge(next, edge.id, from, to, points);
    return next;
  };
  useLayoutEffect(() => {
    if (placementClient.current && placingObject) setPlacementCursor(point(placementClient.current.x, placementClient.current.y));
    if (connectionClient.current && connectFrom) setCursor(point(connectionClient.current.x, connectionClient.current.y));
  }, [view, tool, placingObject]);
  const zoom = (factor: number) => setView((v) => {
    const actual = Math.max(160 / v.width, Math.min(10000 / v.width, factor));
    return { x: v.x + v.width * (1 - actual) / 2, y: v.y + v.height * (1 - actual) / 2, width: v.width * actual, height: v.height * actual };
  });
  const remove = () => {
    const ids = groupSelected.length ? groupSelected : selected ? [selected] : [];
    if (ids.length && apply((value) => ids.reduce((xml, id) => notation.remove(xml, id), value))) { setSelected(null); setConnectFrom(null); }
  };
  const close = () => { if (dirty && !confirmClose) setConfirmClose(true); else onClose(); };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === 'Escape' && (edgeDragRef.current || dragRef.current || panRef.current || portDragRef.current || marqueeRef.current)) { event.preventDefault(); cancelGesture(); setTool('select'); setConnectFrom(null); return; }
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role=menu], [role=dialog].diagram-properties')) return;
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyZ') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if ((event.metaKey || event.ctrlKey) && event.code === 'KeyA' && target instanceof Node && svg.current?.contains(target)) { event.preventDefault(); setSelection(parsed.diagram.nodes.map(node => node.id)); }
      else if (!locked && (event.key === 'Delete' || event.key === 'Backspace') && (selected || groupSelected.length)) { event.preventDefault(); remove(); }
      else if (event.key === 'Escape') { cancelGesture(); setTool('select'); setConnectFrom(null); setSelected(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const surface = svg.current;
    if (!surface) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const matrix = surface.getScreenCTM();
      if (!matrix) return;
      const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? surface.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        const cursor = surface.createSVGPoint(); cursor.x = event.clientX; cursor.y = event.clientY;
        const at = cursor.matrixTransform(matrix.inverse());
        setView((current) => {
          const factor = Math.max(160 / current.width, Math.min(10000 / current.width, Math.exp(event.deltaY * unit * .01)));
          return { x: at.x - (at.x - current.x) * factor, y: at.y - (at.y - current.y) * factor, width: current.width * factor, height: current.height * factor };
        });
      } else {
        const scale = Math.abs(matrix.a) || 1;
        const dx = event.shiftKey ? event.deltaY || event.deltaX : event.deltaX;
        const dy = event.shiftKey ? 0 : event.deltaY;
        setView((current) => ({ ...current, x: current.x + dx * unit / scale, y: current.y + dy * unit / scale }));
      }
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, []);

  const connectNode = (node: { id: string }, endpoint: DiagramPoint | null = null) => {
    if (!connectFrom) { setSourceAnchor(endpoint); setConnectFrom(node.id); setSelected(node.id); setCursor(null); }
    else { apply((value) => makeConnection(value, connectFrom, node.id, sourceAnchor, endpoint)); setConnectFrom(null); setCursor(null); setTool('select'); }
  };
  const beginPort = (event: React.PointerEvent<SVGGElement>, node: DiagramNode, endpoint: DiagramPoint) => {
    event.stopPropagation(); if (locked || event.button !== 0) return;
    if (tool === 'connect' && connectFrom) { connectNode(node, endpoint); return; }
    const start = point(event.clientX, event.clientY);
    setSelected(node.id); setTool('connect'); setConnectFrom(node.id); setSourceAnchor(endpoint); setCursor(start);
    portDragRef.current = { id: node.id, pointer: event.pointerId, start, moved: false, element: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePort = (event: React.PointerEvent<SVGGElement>) => {
    const item = portDragRef.current; if (!item || item.pointer !== event.pointerId) return;
    const at = point(event.clientX, event.clientY);
    item.moved ||= Math.hypot(at.x - item.start.x, at.y - item.start.y) > 3;
    setCursor(at);
  };
  const finishPort = (event: React.PointerEvent<SVGGElement>, cancel = false) => {
    const item = portDragRef.current; if (!item || item.pointer !== event.pointerId) return;
    portDragRef.current = null;
    if (item.element.hasPointerCapture(item.pointer)) item.element.releasePointerCapture(item.pointer);
    if (cancel) { setTool('select'); setConnectFrom(null); setCursor(null); return; }
    if (!item.moved) return;
    const target = connectionTarget(point(event.clientX, event.clientY), item.id);
    if (target) { apply((value) => makeConnection(value, item.id, target.id, sourceAnchor, target.endpoint)); setTool('select'); setConnectFrom(null); setCursor(null); }
    else { setTool('select'); setConnectFrom(null); setCursor(null); }
  };
  const pickNode = (node: DiagramNode, event: React.PointerEvent<SVGGElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (tool === 'connect' && !locked) { const target = connectFrom ? connectionTarget(point(event.clientX, event.clientY), connectFrom) : undefined; connectNode(target ?? node, target?.endpoint ?? null); return; }
    if (tool !== 'select') return;
    if (event.shiftKey || event.metaKey || event.ctrlKey) { setSelection(selectedIds.includes(node.id) ? selectedIds.filter(id => id !== node.id) : [...selectedIds, node.id]); return; }
    const ids = groupSelected.includes(node.id) ? groupSelected : undefined;
    if (!ids) setSelected(node.id);
    if (locked) return;
    const item: Drag = { id: node.id, ids, pointer: event.pointerId, start: point(event.clientX, event.clientY), original: { x: node.x, y: node.y }, current: { x: node.x, y: node.y }, element: event.currentTarget, moved: false };
    dragRef.current = item; setDrag(item); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveGroupWithKeyboard = (event: React.KeyboardEvent<SVGGElement>, id: string) => {
    if (locked || tool !== 'select' || !groupSelected.includes(id)) return false;
    const direction: Record<string, DiagramPoint> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const delta = direction[event.key]; if (!delta) return false;
    event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 10 : 1;
    apply(value => moveSelectedNodes(notation, value, groupSelected, { x: delta.x * step, y: delta.y * step })); return true;
  };
  const moveNode = (event: React.PointerEvent<SVGElement>) => {
    const item = dragRef.current; if (!item || item.pointer !== event.pointerId) return;
    const p = point(event.clientX, event.clientY); const dx = p.x - item.start.x; const dy = p.y - item.start.y;
    const next = { ...item, moved: item.moved || Math.hypot(dx, dy) > 3, current: { x: item.original.x + dx, y: item.original.y + dy } };
    dragRef.current = next; setDrag(next);
  };
  const finishNode = (event: React.PointerEvent<SVGElement>, cancel = false) => {
    const item = dragRef.current; if (!item || item.pointer !== event.pointerId) return;
    dragRef.current = null; setDrag(null);
    if (item.element.hasPointerCapture(item.pointer)) item.element.releasePointerCapture(item.pointer);
    if (!cancel && item.moved) {
      if (item.kind === 'region' && notation.moveRegion) apply((value) => notation.moveRegion!(value, item.id, item.current));
      else if (item.kind === 'resize' && notation.resizeNode) { const size = resized(item); apply((value) => { const next = notation.resizeNode!(value, item.id, size.width, size.height); return size.x === item.original.x && size.y === item.original.y ? next : notation.moveNode(next, item.id, { x: size.x, y: size.y }); }); }
      else if (item.kind === 'label-resize' && notation.setLabelBounds) { const size = resized(item); apply((value) => notation.setLabelBounds!(value, item.id, size)); }
      else if (!item.kind) apply((value) => item.ids ? moveSelectedNodes(notation, value, item.ids, { x: item.current.x - item.original.x, y: item.current.y - item.original.y }) : notation.moveNode(value, item.id, item.current));
    }
  };
  const beginEdgeDrag = (event: React.PointerEvent<SVGElement>, edge: DiagramEdge, kind: EdgeDrag['kind'], index: number) => {
    event.stopPropagation(); if (locked || event.button !== 0) return;
    setSelected(edge.id); const item: EdgeDrag = { edge, pointer: event.pointerId, start: point(event.clientX, event.clientY), kind, index, element: event.currentTarget, points: edge.points.map((p) => ({ ...p })), from: edge.from, to: edge.to, valid: true, moved: false };
    edgeDragRef.current = item; setEdgeDrag(item); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const updateEdgeDrag = (event: React.PointerEvent<SVGElement>) => {
    const item = edgeDragRef.current; if (!item || item.pointer !== event.pointerId) return;
    const at = point(event.clientX, event.clientY); const dx = at.x - item.start.x; const dy = at.y - item.start.y;
    let points = item.edge.points.map((p) => ({ ...p })); let from = item.edge.from; let to = item.edge.to; let valid = true;
    if (item.kind === 'point' && (item.index === 0 || item.index === points.length - 1)) {
      const scale = svg.current?.getScreenCTM()?.a || 1; const tolerance = 18 / Math.abs(scale);
      const candidates = parsed.diagram.nodes.map((node) => ({ node, distance: Math.hypot(Math.max(node.x - at.x, 0, at.x - node.x - node.width), Math.max(node.y - at.y, 0, at.y - node.y - node.height)) })).filter((candidate) => candidate.distance <= tolerance).sort((a, b) => a.distance - b.distance);
      const node = candidates[0]?.node;
      if (node) {
        points = moveRoutePoint(points, item.index, anchor(node, at, notation.symbols.find((symbol) => symbol.type === node.type)?.shape));
        if (item.index === 0) from = node.id; else to = node.id;
        try { notation.editEdge(source, item.edge.id, from, to, points); } catch { valid = false; }
      } else { points = moveRoutePoint(points, item.index, at); valid = false; }
    } else if (item.kind === 'point') points = moveRoutePoint(points, item.index, { x: item.edge.points[item.index].x + dx, y: item.edge.points[item.index].y + dy });
    else points = moveRouteSegment(points, item.index, dx, dy);
    if (!validRoute(points, parsed.diagram.nodes, from, to)) valid = false;
    const next = { ...item, points, from, to, valid, moved: item.moved || Math.hypot(dx, dy) > 3 }; edgeDragRef.current = next; setEdgeDrag(next);
  };
  const finishEdgeDrag = (event: React.PointerEvent<SVGElement>, cancel = false) => {
    const item = edgeDragRef.current; if (!item || item.pointer !== event.pointerId) return;
    edgeDragRef.current = null; setEdgeDrag(null);
    if (item.element.hasPointerCapture(item.pointer)) item.element.releasePointerCapture(item.pointer);
    if (!cancel && item.moved && item.valid) apply((value) => notation.editEdge(value, item.edge.id, item.from, item.to, item.points));
  };
  const reconnectByKeyboard = (edge: DiagramEdge, end: 'from' | 'to', nodeId: string) => {
    const node = parsed.diagram.nodes.find((item) => item.id === nodeId); if (!node) return;
    const index = end === 'from' ? 0 : edge.points.length - 1;
    const neighbor = edge.points[end === 'from' ? 1 : edge.points.length - 2];
    const points = moveRoutePoint(edge.points, index, anchor(node, neighbor, notation.symbols.find((symbol) => symbol.type === node.type)?.shape));
    if (!validRoute(points, parsed.diagram.nodes, end === 'from' ? nodeId : edge.from, end === 'to' ? nodeId : edge.to)) return;
    apply((value) => notation.editEdge(value, edge.id, end === 'from' ? nodeId : edge.from, end === 'to' ? nodeId : edge.to, points));
  };
  const importFile = async (input: File | undefined) => {
    if (!input) return;
    try {
      const next = await input.text(); const result = notation.read(next);
      history.current.past.push({ source, imported }); history.current.future = []; setSource(next); setImported(true); setSelected(null); setConnectFrom(null); setTool('select'); setView(initialView(result.diagram)); setFailure(null);
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Не удалось загрузить файл.'); }
  };
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([source], { type: notation.mimeType }));
    const a = document.createElement('a'); a.href = url; a.download = `${name.trim() || 'model'}.${notation.fileExtension}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  let previewDiagram = parsed.diagram;
  let previewResize = false;
  if (drag?.moved && (!drag.kind || drag.kind === 'region')) {
    try { previewDiagram = notation.read(drag.kind === 'region' && notation.moveRegion ? notation.moveRegion(source, drag.id, drag.current) : drag.ids ? moveSelectedNodes(notation, source, drag.ids, { x: drag.current.x - drag.original.x, y: drag.current.y - drag.original.y }) : notation.moveNode(source, drag.id, drag.current)).diagram; } catch { /* Недопустимое положение не применяется. */ }
  }
  if (drag?.moved && drag.kind === 'resize' && notation.resizeNode) {
    try {
      const size = resized(drag);
      let xml = notation.resizeNode(source, drag.id, size.width, size.height);
      if (size.x !== drag.original.x || size.y !== drag.original.y) xml = notation.moveNode(xml, drag.id, { x: size.x, y: size.y });
      previewDiagram = notation.read(xml).diagram; previewResize = true;
    } catch { /* Недопустимое положение не применяется. */ }
  }
  const displayNode = (node: DiagramNode) => {
    if (drag?.id !== node.id || !drag.moved) return node;
    if (drag.kind === 'label-resize') return { ...node, labelBounds: resized(drag) };
    if (drag.kind !== 'resize') return node;
    if (previewResize || notation.resizeNode) return node;
    const size = resized(drag), label = node.labelBounds;
    return { ...node, ...size, ...(label ? { labelBounds: { x: size.x + (label.x - node.x) * size.width / node.width, y: size.y + (label.y - node.y) * size.height / node.height, width: label.width * size.width / node.width, height: label.height * size.height / node.height } } : {}) };
  };
  const openMenu = (id: string, x: number, y: number) => { cancelGesture(); setSelected(id); setMenu({ id, x, y }); };
  const menuKey = (event: React.KeyboardEvent<SVGElement>, id: string) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return false;
    event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); openMenu(id, rect.left, rect.bottom); return true;
  };
  const startEdit = (id: string, value: string, x: number, y: number, width: number, height = 36, multiline = false) => {
    if (locked || tool !== 'select') return; cancelGesture(); setSelected(id); setEditing({ id, value, x, y, width, height, multiline });
  };
  const finishEdit = (commit: boolean, restoreFocus = true) => {
    const draft = editingRef.current; if (!draft) return;
    editingRef.current = null; setEditing(null);
    if (commit) apply((value) => notation.rename(value, draft.id, draft.value));
    if (restoreFocus) requestAnimationFrame(() => svg.current?.focus({ preventScroll: true }));
  };
  const startSpecialDrag = (event: React.PointerEvent<SVGGElement>, id: string, x: number, y: number, kind: 'region' | 'resize' | 'label-resize', width?: number, height?: number, corner?: ResizeCorner, square?: boolean) => {
    event.stopPropagation(); if (locked || event.button !== 0 || tool !== 'select') return;
    setSelected(id); const item: Drag = { id, kind, width, height, corner, square, pointer: event.pointerId, start: point(event.clientX, event.clientY), original: { x, y }, current: { x, y }, element: event.currentTarget, moved: false };
    dragRef.current = item; setDrag(item); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resizeHandles = (node: DiagramNode, bounds: { x: number; y: number; width: number; height: number }, kind: 'resize' | 'label-resize', square = false) => {
    const x = bounds.x - node.x, y = bounds.y - node.y;
    const label = kind === 'resize' ? 'элемента' : 'блока текста';
    const handles: { corner: ResizeCorner; x: number; y: number; title: string }[] = [
      { corner: 'nw', x, y, title: 'верхний левый угол' },
      { corner: 'ne', x: x + bounds.width, y, title: 'верхний правый угол' },
      { corner: 'sw', x, y: y + bounds.height, title: 'нижний левый угол' },
      { corner: 'se', x: x + bounds.width, y: y + bounds.height, title: 'нижний правый угол' },
    ];
    return handles.map((handle) => <g key={`${kind}-${handle.corner}`} onPointerDown={(event) => startSpecialDrag(event, node.id, bounds.x, bounds.y, kind, bounds.width, bounds.height, handle.corner, square)} onPointerMove={moveNode} onPointerUp={(event) => finishNode(event)} onPointerCancel={(event) => finishNode(event, true)} onLostPointerCapture={(event) => finishNode(event, true)}>
      <rect className={`diagram-resize-handle ${kind === 'label-resize' ? 'label-handle' : ''} corner-${handle.corner}`} data-resize-corner={handle.corner} x={handle.x - 4} y={handle.y - 4} width="8" height="8" rx="1" role="button" tabIndex={0} aria-label={`Изменить размер ${label}: ${handle.title}`} onKeyDown={(event) => {
        const dx = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const dy = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (!dx && !dy) return;
        event.preventDefault(); event.stopPropagation();
        const step = event.shiftKey ? 10 : 1;
        const item: Drag = { id: node.id, kind, corner: handle.corner, square, width: bounds.width, height: bounds.height, original: { x: bounds.x, y: bounds.y }, current: { x: bounds.x + dx * step, y: bounds.y + dy * step }, start: bounds, element: event.currentTarget.parentElement as unknown as SVGGElement, pointer: 0, moved: true };
        const size = resized(item);
        if (kind === 'resize' && notation.resizeNode) apply((value) => { const next = notation.resizeNode!(value, node.id, size.width, size.height); return size.x === bounds.x && size.y === bounds.y ? next : notation.moveNode(next, node.id, { x: size.x, y: size.y }); });
        else if (kind === 'label-resize' && notation.setLabelBounds) apply((value) => notation.setLabelBounds!(value, node.id, size));
      }} />
    </g>);
  };

  return <div className="bpmn-editor diagram-editor" role="dialog" aria-modal="true" aria-label={`Редактор модели: ${notation.title}`}>
    <header className="bpmn-head">
      <span className="dlg-icon"><Icon name="model" size={18} /></span>
      <input className="bpmn-title" value={name} aria-label="Название модели" disabled={locked} onChange={(event) => setName(event.target.value)} />
      <span className="diagram-notation">{notation.title}</span><span className="diagram-experimental" title="Редактор находится в разработке">Ранняя версия</span><div className="grow" />
      <input ref={file} type="file" accept={notation.fileAccept} hidden onChange={(event) => { setPendingImport(event.target.files?.[0] ?? null); event.target.value = ''; }} />
      <button type="button" className="btn" onClick={() => file.current?.click()}>Импорт</button>
      <button type="button" className="btn" onClick={exportFile}>Экспорт</button>
      {confirmClose ? <><span className="bpmn-warn">Есть несохранённые изменения</span><button type="button" className="btn btn-danger" onClick={onClose}>Закрыть без сохранения</button><button type="button" className="btn" onClick={() => setConfirmClose(false)}>Продолжить правку</button></> : <><button type="button" className="btn" onClick={close}>Закрыть</button><button type="button" className="btn btn-dark" disabled={locked || !dirty} onClick={() => onSave(name.trim() || 'Модель', source, imported)}>Сохранить</button></>}
    </header>
    {(failure || parsed.error || parsed.readOnlyReason) && <div className="diagram-alert" role="alert">{failure || parsed.error || parsed.readOnlyReason}</div>}
    <div className="diagram-workspace">
      <aside className="diagram-sidebar" aria-label="Инструменты диаграммы">
        <div className="diagram-sidebar-title">Элементы · {notation.title}</div>
        <input className="pinput diagram-palette-search" aria-label="Поиск элементов" placeholder="Поиск элементов" value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} />
        {notation.addPool && (!searchPalette || 'пул'.includes(searchPalette)) && <button type="button" className={`diagram-tool${tool === 'pool' ? ' on' : ''}`} aria-pressed={tool === 'pool'} disabled={locked} onClick={() => { setTool('pool'); setConnectFrom(null); }}><svg className="diagram-palette-svg" viewBox="0 0 50 20" aria-hidden="true"><rect x="1" y="1" width="48" height="18" className="diagram-shape" /><path d="M10 1v18" className="diagram-kind" /></svg>Пул</button>}
        {notation.addRegion && (!searchPalette || (notation.regionTitle ?? 'Область').toLocaleLowerCase('ru').includes(searchPalette)) && <button type="button" className={`diagram-tool${tool === 'region' ? ' on' : ''}`} aria-pressed={tool === 'region'} disabled={locked} onClick={() => { setTool('region'); setConnectFrom(null); }}><svg className="diagram-palette-svg" viewBox="0 0 50 20" aria-hidden="true"><rect x="1" y="1" width="48" height="18" className="diagram-shape" /><path d="M10 1v18" className="diagram-kind" /></svg>{notation.regionTitle ?? 'Область'}</button>}
        {paletteGroups.map((group) => {
          const items = notation.symbols.filter((symbol) => (symbol.group ?? 'Другие') === group && (!searchPalette || symbol.title.toLocaleLowerCase('ru').includes(searchPalette)));
          if (!items.length) return null;
          const open = Boolean(searchPalette) || !collapsedGroups.includes(group);
          return <Fragment key={group}><button type="button" className="diagram-palette-group" aria-expanded={open} onClick={() => setCollapsedGroups((current) => current.includes(group) ? current.filter((item) => item !== group) : [...current, group])}><Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />{group}</button>{open && items.map((symbol) => <button key={symbol.type} type="button" className={`diagram-tool${tool === symbol.type ? ' on' : ''}`} aria-pressed={tool === symbol.type} disabled={locked} onClick={() => { setTool(symbol.type); setConnectFrom(null); }}><svg className="diagram-palette-svg" viewBox={`-3 -3 ${symbol.width + 6} ${symbol.height + 6}`} aria-hidden="true"><NodeShape node={{ id: '', type: symbol.type, label: '', x: 0, y: 0, width: symbol.width, height: symbol.height }} symbol={symbol} selected={false} detail={notation.renderSymbolDetail?.(symbol)} /></svg><span>{symbol.title}</span></button>)}</Fragment>;
        })}
        {searchPalette && !notation.symbols.some((symbol) => symbol.title.toLocaleLowerCase('ru').includes(searchPalette)) && !(notation.addRegion && (notation.regionTitle ?? 'Область').toLocaleLowerCase('ru').includes(searchPalette)) && !(notation.addPool && 'пул'.includes(searchPalette)) && <p className="diagram-palette-empty">Элементы не найдены</p>}
      </aside>
      <main className="diagram-stage">
        <div className="tools diagram-toolbar" role="toolbar" aria-label="Инструменты редактора">
          <button type="button" className={`tool-btn${tool === 'select' ? ' on' : ''}`} aria-label="Выбор" aria-pressed={tool === 'select'} title="Выбор" onClick={() => { setTool('select'); setConnectFrom(null); }}><Icon name="cursor" size={17} stroke={1.9} /></button>
          <div className="diagram-connection-tool">
            <button type="button" className={`tool-btn${tool === 'connect' ? ' on' : ''}`} aria-label="Связь" aria-pressed={tool === 'connect'} title={`Связь: ${notation.connectionTypes?.find((item) => item.id === connectionType)?.title ?? 'автоматически'}`} disabled={locked} onClick={() => { setTool('connect'); setConnectFrom(null); }}><Icon name="connect" size={17} stroke={1.9} /></button>
            <button type="button" className="tool-btn diagram-connection-dropdown" aria-label="Выбрать тип связи" aria-haspopup="menu" aria-expanded={Boolean(connectionMenu)} disabled={locked} title="Выбрать тип связи" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setConnectionMenu({ x: rect.left, y: rect.bottom + 4 }); }}><Icon name="chevronDown" size={14} /></button>
          </div>
          <span className="tools-sep" />
          <button type="button" className="tool-btn" aria-label="Шаг назад" title="Шаг назад (Ctrl+Z)" disabled={!history.current.past.length} onClick={undo}><Icon name="undo" size={17} stroke={1.9} /></button>
          <button type="button" className="tool-btn" aria-label="Шаг вперёд" title="Шаг вперёд (Ctrl+Shift+Z)" disabled={!history.current.future.length} onClick={redo}><Icon name="redo" size={17} stroke={1.9} /></button>
        </div>
        {tool === 'connect' && <div className="diagram-connect-hint" aria-live="polite"><b>{notation.connectionTypes?.find((item) => item.id === connectionType)?.title ?? 'Автоматическая связь'}</b><span>{connectFrom ? 'Выберите конечный элемент' : 'Выберите начальный элемент'}</span></div>}
        <svg ref={svg} className={`diagram-surface${tool !== 'select' ? ' placing' : ''}${placingObject ? ' placing-object' : ''}`} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} role="application" tabIndex={0} aria-label="Полотно диаграммы"
          onPointerMove={(event) => {
            const pan = panRef.current;
            if (pan?.pointer === event.pointerId) setView({ ...pan.view, x: pan.view.x - (event.clientX - pan.x) / pan.scale, y: pan.view.y - (event.clientY - pan.y) / pan.scale });
            else if (event.target === event.currentTarget && dragRef.current?.pointer === event.pointerId) moveNode(event);
            else if (marqueeRef.current?.pointer === event.pointerId) {
              const box = marqueeRef.current;
              const next = { ...box, current: point(event.clientX, event.clientY), moved: box.moved || Math.hypot(event.clientX - box.client.x, event.clientY - box.client.y) > 4 };
              marqueeRef.current = next; setMarquee(next);
            }
            else if (tool === 'connect' && connectFrom) { connectionClient.current = { x: event.clientX, y: event.clientY }; setCursor(point(event.clientX, event.clientY)); }
            else if (placingObject) { placementClient.current = { x: event.clientX, y: event.clientY }; setPlacementCursor(point(event.clientX, event.clientY)); }
            else if (tool === 'select' && !dragRef.current && !locked) {
              const at = point(event.clientX, event.clientY), scale = Math.abs(event.currentTarget.getScreenCTM()?.a || 1);
              const hovered = [...parsed.diagram.nodes].reverse().map((node) => ({ node, distance: Math.hypot(Math.max(node.x - at.x, 0, at.x - node.x - node.width), Math.max(node.y - at.y, 0, at.y - node.y - node.height)) })).filter((entry) => entry.distance <= 14 + 9 / scale).sort((a, b) => a.distance - b.distance)[0]?.node;
              setHoveredNode(hovered?.id ?? null);
            }
          }}
          onPointerLeave={() => { placementClient.current = null; setPlacementCursor(null); setHoveredNode(null); }}
          onPointerDownCapture={(event) => {
            if (event.button === 1 && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))) {
              if (dragRef.current || edgeDragRef.current || portDragRef.current || marqueeRef.current || panRef.current) return;
              const scale = event.currentTarget.getScreenCTM()?.a;
              if (scale) { event.preventDefault(); event.stopPropagation(); panRef.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, scale, view }; event.currentTarget.setPointerCapture(event.pointerId); }
              return;
            }
            if (!placingObject || event.button !== 0) return;
            event.preventDefault(); event.stopPropagation();
            const at = point(event.clientX, event.clientY);
            if (tool === 'pool' && notation.addPool) apply((value) => notation.addPool!(value, at));
            else if (tool === 'region' && notation.addRegion) apply((value) => notation.addRegion!(value, at));
            else if (placementSymbol) apply((value) => notation.addNode(value, placementSymbol.type, { x: at.x - placementSymbol.width / 2, y: at.y - placementSymbol.height / 2 }));
            placementClient.current = null; setPlacementCursor(null); setTool('select');
          }}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget || event.button !== 0) return;
            if (tool === 'connect' && connectFrom) { const target = connectionTarget(point(event.clientX, event.clientY), connectFrom); if (target) connectNode(target, target.endpoint); return; }
            if (tool === 'select') {
              const start = point(event.clientX, event.clientY);
              const box: Marquee = { pointer: event.pointerId, start, current: start, client: { x: event.clientX, y: event.clientY }, moved: false, additive: event.shiftKey || event.metaKey || event.ctrlKey, previous: selectedIds };
              marqueeRef.current = box; setMarquee(box); event.currentTarget.setPointerCapture(event.pointerId);
              return;
            }
          }}
          onPointerUp={(event) => {
            if (panRef.current?.pointer === event.pointerId) panRef.current = null;
            if (event.target === event.currentTarget && dragRef.current?.pointer === event.pointerId) finishNode(event);
            const box = marqueeRef.current;
            if (box?.pointer === event.pointerId) {
              marqueeRef.current = null; setMarquee(null);
              const ids = box.moved ? nodesInSelection(parsed.diagram.nodes, selectionBounds(box.start, box.current)) : [];
              setSelection(box.additive ? [...box.previous, ...ids] : ids);
            }
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={(event) => { if (panRef.current?.pointer === event.pointerId) panRef.current = null; if (marqueeRef.current?.pointer === event.pointerId) { marqueeRef.current = null; setMarquee(null); } }}
          onLostPointerCapture={(event) => { if (panRef.current?.pointer === event.pointerId) panRef.current = null; if (marqueeRef.current?.pointer === event.pointerId) { marqueeRef.current = null; setMarquee(null); } }}
          onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || event.key !== 'Enter' || locked) return;
            if (tool === 'pool' && notation.addPool) { event.preventDefault(); apply((value) => notation.addPool!(value, { x: view.x + 30, y: view.y + 30 })); setTool('select'); return; }
            if (tool === 'region' && notation.addRegion) { event.preventDefault(); apply((value) => notation.addRegion!(value, { x: view.x + 30, y: view.y + 30 })); setTool('select'); return; }
            const symbol = notation.symbols.find((item) => item.type === tool);
            if (symbol) { event.preventDefault(); apply((value) => notation.addNode(value, symbol.type, { x: view.x + (view.width - symbol.width) / 2, y: view.y + (view.height - symbol.height) / 2 })); setTool('select'); }
          }}>
          <defs><marker id="diagram-message-circle" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><circle cx="5" cy="5" r="4" fill="white" stroke="#424858" strokeWidth="1.3" /></marker><marker id="diagram-association-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke="#424858" strokeWidth="1.3" /></marker><marker id="diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="#424858" /></marker></defs>
          {previewDiagram.regions?.map((region) => { return <g key={region.id} className="diagram-region" data-diagram-region={region.id} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openMenu(region.id, event.clientX, event.clientY); }} aria-label={`${region.kind === 'pool' ? 'Пул' : notation.regionTitle ?? 'Область'}: ${region.label || region.id}`}>
            <rect x={region.x} y={region.y} width={region.width} height={region.height} />
            <g onDoubleClick={(event) => { event.stopPropagation(); startEdit(region.id, region.label, region.x, region.y + region.height / 2, 140); }} onPointerDown={(event) => { if (event.button === 0 && tool === 'connect' && region.kind === 'pool' && !locked) { event.stopPropagation(); connectNode(region); } else if (notation.moveRegion) startSpecialDrag(event, region.id, region.x, region.y, 'region'); }} onPointerMove={moveNode} onPointerUp={(event) => finishNode(event)} onPointerCancel={(event) => finishNode(event, true)} onLostPointerCapture={(event) => finishNode(event, true)}><rect className={`diagram-region-header${selected === region.id || connectFrom === region.id ? ' selected' : ''}`} x={region.x} y={region.y} width={Math.min(30, region.width)} height={region.height} role="button" tabIndex={0} aria-label={`${region.kind === 'pool' ? 'Пул' : notation.regionTitle ?? 'Область'}: ${region.label || region.id}`} onPointerDown={(event) => { if (event.button === 0 && tool === 'select') setSelected(region.id); }} onKeyDown={(event) => { if (menuKey(event, region.id)) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (tool === 'connect' && region.kind === 'pool' && !locked) connectNode(region); else setSelected(region.id); } }} />
            <path d={`M${region.x + Math.min(30, region.width)} ${region.y}v${region.height}`} />
            {region.label && <text x={region.x + Math.min(15, region.width / 2)} y={region.y + region.height / 2} textAnchor="middle" transform={`rotate(-90 ${region.x + Math.min(15, region.width / 2)} ${region.y + region.height / 2})`}>{region.label}</text>}</g>
          </g>; })}
          {previewDiagram.edges.map((edge) => {
            let points = edgeDrag?.edge.id === edge.id ? edgeDrag.points : edge.points;

            const coords = points.map((p) => `${p.x},${p.y}`).join(' '); const middle = pathMiddle(points);
            return <g key={edge.id} data-diagram-edge={edge.id} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openMenu(edge.id, event.clientX, event.clientY); }} onDoubleClick={() => { if (edge.labelEditable !== false) startEdit(edge.id, edge.label, middle.x - 70, middle.y - 22, 140); }} onPointerMove={updateEdgeDrag} onPointerUp={(event) => finishEdgeDrag(event)} onPointerCancel={(event) => finishEdgeDrag(event, true)} onLostPointerCapture={(event) => finishEdgeDrag(event, true)}><polyline points={coords} className={`diagram-edge${selected === edge.id ? ' selected' : ''}${edgeDrag?.edge.id === edge.id && !edgeDrag.valid ? ' invalid' : ''}`} strokeDasharray={edge.lineStyle === 'dashed' ? '6 4' : edge.lineStyle === 'dotted' ? '2 5' : undefined} strokeLinecap={edge.lineStyle === 'dotted' ? 'round' : undefined} markerStart={edge.startMarker === 'circle' ? 'url(#diagram-message-circle)' : edge.arrowStart ? 'url(#diagram-association-arrow)' : undefined} markerEnd={(edge.arrowEnd ?? (edge.lineStyle !== 'dotted')) ? (edge.arrowStyle === 'open' || edge.lineStyle === 'dotted' ? 'url(#diagram-association-arrow)' : 'url(#diagram-arrow)') : undefined} /><polyline points={coords} className="diagram-edge-hit" tabIndex={0} role="button" aria-label={`Связь${edge.label ? `: ${edge.label}` : ''}`} onPointerDown={(event) => { event.stopPropagation(); setSelected(edge.id); }} onKeyDown={(event) => { if (menuKey(event, edge.id)) return; if (event.key === 'Enter') setSelected(edge.id); }} />{edge.label && <text x={middle.x} y={middle.y - 8} className="diagram-edge-label">{edge.label}</text>}
              {selected === edge.id && !locked && edge.routeEditable !== false && orthogonal(edge.points) && edge.points.map((p, i) => <g key={`point-${i}`}><circle cx={p.x} cy={p.y} r="6" className="diagram-edge-handle" tabIndex={0} role="button" aria-label={i === 0 ? 'Начало связи; перетащите на элемент' : i === edge.points.length - 1 ? 'Конец связи; перетащите на элемент' : `Точка маршрута ${i}; используйте стрелки`} onPointerDown={(event) => beginEdgeDrag(event, edge, 'point', i)} onKeyDown={(event) => {
                if (i === 0 || i === edge.points.length - 1) return;
                const delta: Record<string, DiagramPoint> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }; const d = delta[event.key]; if (!d) return; event.preventDefault(); event.stopPropagation();
                const next = moveRoutePoint(edge.points, i, { x: p.x + d.x * (event.shiftKey ? 10 : 1), y: p.y + d.y * (event.shiftKey ? 10 : 1) }); if (validRoute(next, parsed.diagram.nodes, edge.from, edge.to)) apply((value) => notation.editEdge(value, edge.id, edge.from, edge.to, next));
              }} />{i < edge.points.length - 1 && <circle cx={(p.x + edge.points[i + 1].x) / 2} cy={(p.y + edge.points[i + 1].y) / 2} r="5" className="diagram-segment-handle" tabIndex={0} role="button" aria-label={`Сегмент ${i + 1}; используйте стрелки`} onPointerDown={(event) => beginEdgeDrag(event, edge, 'segment', i)} onKeyDown={(event) => {
                  const horizontal = edge.points[i + 1].y === p.y;
                  const direction = horizontal ? (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0) : (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0);
                  if (!direction) return; event.preventDefault(); event.stopPropagation(); const amount = direction * (event.shiftKey ? 10 : 1);
                  const next = moveRouteSegment(edge.points, i, horizontal ? 0 : amount, horizontal ? amount : 0);
                  if (validRoute(next, parsed.diagram.nodes, edge.from, edge.to)) apply((value) => notation.editEdge(value, edge.id, edge.from, edge.to, next));
                }} />}</g>)}
            </g>;
          })}
          {connectFrom && cursor && (() => {
            const node = parsed.diagram.nodes.find((item) => item.id === connectFrom);
            const region = parsed.diagram.regions?.find((item) => item.id === connectFrom && item.kind === 'pool');
            const origin = node ?? region; if (!origin) return null;
            const target = connectionTarget(cursor, connectFrom);
            let points: DiagramPoint[] | undefined; let preview: DiagramEdge | undefined;
            if (target) {
              try { const candidate = notation.read(makeConnection(source, connectFrom, target.id, sourceAnchor, target.endpoint)).diagram; preview = candidate.edges.find((edge) => edge.from === connectFrom && edge.to === target.id && !parsed.diagram.edges.some((old) => old.id === edge.id)); points = preview?.points; } catch { /* Недопустимую цель не сохраняем. */ }
            }
            if (!points) { const start = sourceAnchor ?? anchor(origin, cursor, node ? notation.symbols.find((item) => item.type === node.type)?.shape : undefined); const middle = (start.x + cursor.x) / 2; points = [start, { x: middle, y: start.y }, { x: middle, y: cursor.y }, cursor]; }
            const selectedAppearance = (notation.connectionTypes as ConnectionOption[] | undefined)?.find((item) => item.id === connectionType)?.appearance;
            const lineStyle = preview?.lineStyle ?? selectedAppearance?.lineStyle;
            const endArrow = preview ? (preview.arrowEnd ?? true) : (selectedAppearance?.arrowEnd ?? true);
            const startCircle = (preview?.startMarker ?? selectedAppearance?.startMarker) === 'circle';
            const startArrow = preview?.arrowStart ?? selectedAppearance?.arrowStart ?? false;
            const openArrow = (preview?.arrowStyle ?? selectedAppearance?.arrowStyle) === 'open' || lineStyle === 'dotted';
            return <polyline data-connection-preview="true" pointerEvents="none" points={points.map((p) => `${p.x},${p.y}`).join(' ')} className="diagram-edge" strokeDasharray={lineStyle === 'dotted' ? '2 5' : lineStyle === 'dashed' ? '6 4' : undefined} strokeLinecap={lineStyle === 'dotted' ? 'round' : undefined} markerStart={startCircle ? 'url(#diagram-message-circle)' : startArrow ? 'url(#diagram-association-arrow)' : undefined} markerEnd={endArrow ? (openArrow ? 'url(#diagram-association-arrow)' : 'url(#diagram-arrow)') : undefined} />;
          })()}
          {previewDiagram.nodes.map((originalNode) => {
            const node = displayNode(originalNode); const symbol = notation.symbols.find((item) => item.type === node.type);
            const labelBounds = nodeLabelBounds(node, symbol);
            const lines = labelLines(node.label, labelBounds.width, Math.max(1, Math.floor(labelBounds.height / 14)));
            const labelX = labelBounds.x - node.x, labelY = labelBounds.y - node.y;
            return <g key={node.id} data-diagram-node={node.id} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openMenu(node.id, event.clientX, event.clientY); }} onDoubleClick={(event) => { event.stopPropagation(); startEdit(node.id, node.label, labelBounds.x, labelBounds.y, labelBounds.width, labelBounds.height, true); }} transform={`translate(${node.x} ${node.y})`} className="diagram-node" role="button" tabIndex={0} aria-label={`${symbol?.title ?? 'Элемент'}${node.label ? `: ${node.label}` : ''}`} aria-pressed={selected === node.id || groupSelected.includes(node.id)} onPointerDown={(event) => pickNode(originalNode, event)} onPointerMove={moveNode} onPointerUp={(event) => finishNode(event)} onPointerCancel={(event) => finishNode(event, true)} onLostPointerCapture={(event) => finishNode(event, true)} onKeyDown={(event) => { if (menuKey(event, node.id) || moveGroupWithKeyboard(event, node.id)) return; if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); startEdit(node.id, node.label, labelBounds.x, labelBounds.y, labelBounds.width, labelBounds.height, true); return; } if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (tool === 'connect' && !locked) connectNode(originalNode); else if (event.shiftKey) setSelection(selectedIds.includes(node.id) ? selectedIds.filter(id => id !== node.id) : [...selectedIds, node.id]); else setSelected(node.id); } }}>
              <NodeShape node={node} symbol={symbol} selected={selected === node.id || groupSelected.includes(node.id) || connectFrom === node.id} detail={symbol && notation.renderSymbolDetail?.(symbol)} />
              {node.label && editing?.id !== node.id && <text x={labelX + labelBounds.width / 2} y={labelY + Math.max(12, (labelBounds.height - lines.length * 14) / 2 + 11)} className="diagram-node-label" textAnchor="middle">{lines.map((line, i) => <tspan key={i} x={labelX + labelBounds.width / 2} dy={i ? 14 : 0}>{line}</tspan>)}</text>}
              {selected === node.id && !locked && tool === 'select' && <>
                {notation.resizeNode && resizeHandles(node, node, 'resize', symbol?.shape === 'circle' || symbol?.shape === 'double-circle' || symbol?.shape === 'diamond')}
                {notation.setLabelBounds && <><rect className="diagram-label-bounds" x={labelX} y={labelY} width={labelBounds.width} height={labelBounds.height} />{resizeHandles(node, labelBounds, 'label-resize')}</>}
              </>}
              {!locked && (selected === node.id || hoveredNode === node.id || tool === 'connect') && (tool === 'select' || tool === 'connect') && ([['top', 'сверху'], ['right', 'справа'], ['bottom', 'снизу'], ['left', 'слева']] as const).flatMap(([side, label]) => {
                const horizontal = side === 'top' || side === 'bottom';
                const count = connectionPortCount(horizontal ? node.width : node.height, symbol?.singleConnectionPortPerSide);
                return Array.from({ length: count }, (_, i) => {
                  const offset = (i + 1) / (count + 1);
                  const local = { x: horizontal ? node.width * offset : side === 'left' ? 0 : node.width, y: horizontal ? side === 'top' ? 0 : node.height : node.height * offset };
                  const edge = anchor({ x: 0, y: 0, width: node.width, height: node.height }, local, symbol?.shape);
                  const x = edge.x + (side === 'left' ? -14 : side === 'right' ? 14 : 0), y = edge.y + (side === 'top' ? -14 : side === 'bottom' ? 14 : 0);
                  return <g key={`${side}-${i}`} className="diagram-connection-port" data-connection-port={label} data-port-side={side} data-port-offset={offset} transform={`translate(${x} ${y})`} role="button" tabIndex={selected === node.id || tool === 'connect' ? 0 : -1} aria-label={`Создать связь ${label}: точка ${i + 1} из ${count}`} onPointerDown={(event) => beginPort(event, originalNode, { x: node.x + edge.x, y: node.y + edge.y })} onPointerMove={movePort} onPointerUp={(event) => finishPort(event)} onPointerCancel={(event) => finishPort(event, true)} onLostPointerCapture={(event) => finishPort(event, true)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (tool === 'connect' && connectFrom) connectNode(originalNode, { x: node.x + edge.x, y: node.y + edge.y }); else { setTool('connect'); connectNode(originalNode, { x: node.x + edge.x, y: node.y + edge.y }); } } }}><circle r="7" /><path d="M-3 0H3M0 -3V3" /></g>;
                });
              })}
            </g>;
          })}
          {marquee?.moved && <rect {...selectionBounds(marquee.start, marquee.current)} data-selection-marquee="true" className="diagram-selection-marquee" pointerEvents="none" />}
          {placingObject && placementCursor && (placementSymbol ? (() => {
            const node: DiagramNode = { id: '', type: placementSymbol.type, label: '', x: Math.round(placementCursor.x - placementSymbol.width / 2), y: Math.round(placementCursor.y - placementSymbol.height / 2), width: placementSymbol.width, height: placementSymbol.height };
            return <g className="diagram-placement-preview" data-placement-preview={placementSymbol.type} aria-hidden="true" pointerEvents="none" transform={`translate(${node.x} ${node.y})`}><NodeShape node={node} symbol={placementSymbol} selected={false} detail={notation.renderSymbolDetail?.(placementSymbol)} /></g>;
          })() : placementSize && <g className="diagram-placement-preview" data-placement-preview={tool} aria-hidden="true" pointerEvents="none" transform={`translate(${Math.round(placementCursor.x)} ${Math.round(placementCursor.y)})`}><rect className="diagram-shape" width={placementSize.width} height={placementSize.height} /><path className="diagram-kind" d={`M30 0 V${placementSize.height}`} /></g>)}
          {editing && <foreignObject x={editing.x} y={editing.y} width={editing.width} height={editing.height}>{editing.multiline ? <textarea className="diagram-inline-textarea" aria-label="Редактировать текст" title="Enter — сохранить, Shift+Enter — перенос строки, Escape — отменить" autoFocus value={editing.value} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => setEditing({ ...editing, value: event.target.value })} onBlur={() => finishEdit(true, false)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); finishEdit(true); } else if (event.key === 'Escape') { event.preventDefault(); finishEdit(false); } }} /> : <input className="pinput diagram-inline-input" aria-label="Редактировать название" autoFocus value={editing.value} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => setEditing({ ...editing, value: event.target.value })} onBlur={() => finishEdit(true, false)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); finishEdit(true); } else if (event.key === 'Escape') { event.preventDefault(); finishEdit(false); } }} />}</foreignObject>}
        </svg>
        <span className="diagram-selection-status" aria-live="polite">{groupSelected.length ? `Выбрано объектов: ${groupSelected.length}` : ''}</span>
        <div className="zoom-ui diagram-zoom" role="group" aria-label="Масштаб"><button type="button" className="tool-btn" aria-label="Уменьшить" title="Уменьшить" onClick={() => zoom(1.25)}><Icon name="minus" size={15} /></button><button type="button" className="tool-text" onClick={() => setView(initialView(parsed.diagram))}>Вписать</button><button type="button" className="tool-btn" aria-label="Увеличить" title="Увеличить" onClick={() => zoom(0.8)}><Icon name="plus" size={15} /></button></div>

      </main>
      {properties && <aside className="diagram-properties" role="dialog" aria-label="Свойства элемента" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setProperties(false); } }}>
        <button type="button" className="btn" autoFocus onClick={() => setProperties(false)}>Закрыть</button>
        <div className="diagram-sidebar-title">Свойства</div>
        {selectedNode || selectedEdge || selectedRegion ? <>
          <b>{selectedNode ? notation.symbols.find((item) => item.type === selectedNode.type)?.title : selectedRegion ? selectedRegion.kind === 'pool' ? 'Пул' : notation.regionTitle ?? 'Область' : 'Связь'}</b>
          <label className="create-object-field"><span>{selectedNode && notation.symbols.find((item) => item.type === selectedNode.type)?.shape === 'annotation' ? 'Текст' : 'Название'}</span><input className="pinput" disabled={locked || selectedEdge?.labelEditable === false} value={(selectedNode ?? selectedEdge ?? selectedRegion)?.label ?? ''} onChange={(event) => apply((value) => notation.rename(value, selected!, event.target.value))} /></label>
          {selectedNode && notation.resizeNode && (['width', 'height'] as const).map((dimension) => <label key={`node-${selectedNode.id}-${dimension}-${selectedNode[dimension]}`} className="create-object-field"><span>{dimension === 'width' ? 'Ширина элемента' : 'Высота элемента'}</span><input className="pinput" type="number" min={dimension === 'width' ? 40 : 30} disabled={locked} defaultValue={selectedNode[dimension]} onBlur={(event) => { const size = Number(event.target.value); if (size !== selectedNode[dimension]) { const square = selectedSymbol?.shape === 'circle' || selectedSymbol?.shape === 'double-circle' || selectedSymbol?.shape === 'diamond'; apply((value) => notation.resizeNode!(value, selectedNode.id, square || dimension === 'width' ? size : selectedNode.width, square || dimension === 'height' ? size : selectedNode.height)); } }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>)}
          {selectedNode && selectedLabelBounds && notation.setLabelBounds && (['width', 'height'] as const).map((dimension) => <label key={`label-${selectedNode.id}-${dimension}-${selectedLabelBounds[dimension]}`} className="create-object-field"><span>{dimension === 'width' ? 'Ширина блока текста' : 'Высота блока текста'}</span><input className="pinput" type="number" min={dimension === 'width' ? 30 : 18} disabled={locked} defaultValue={selectedLabelBounds[dimension]} onBlur={(event) => { const size = Number(event.target.value); if (size !== selectedLabelBounds[dimension]) apply((value) => notation.setLabelBounds!(value, selectedNode.id, { ...selectedLabelBounds, [dimension]: size })); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>)}
          {selectedRegion && selectedRegion.kind !== 'pool' && notation.resizeRegion && <><p className="diagram-edge-help">Каждая строка — отдельная роль. Элементы относятся к строке по положению их центра.</p>{notation.setRegionRows && <label key={`${selectedRegion.id}-rows-${selectedRegion.rowCount}`} className="create-object-field"><span>Количество строк</span><input className="pinput" type="number" min={1} max={100} disabled={locked} defaultValue={selectedRegion.rowCount ?? 1} onBlur={(event) => { const count = Number(event.target.value); if (count !== (selectedRegion.rowCount ?? 1)) apply((value) => notation.setRegionRows!(value, selectedRegion.id, count)); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>}{(['width', 'height'] as const).map((dimension) => <label key={`${selectedRegion.id}-${dimension}-${selectedRegion[dimension]}`} className="create-object-field"><span>{dimension === 'width' ? 'Ширина' : 'Высота'}</span><input className="pinput" type="number" min={dimension === 'width' ? 160 : 80} disabled={locked} defaultValue={selectedRegion[dimension]} onBlur={(event) => { const size = Number(event.target.value); if (size !== selectedRegion[dimension]) apply((value) => notation.resizeRegion!(value, selectedRegion.id, dimension === 'width' ? size : selectedRegion.width, dimension === 'height' ? size : selectedRegion.height)); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>)}</>}
          {selectedEdge && selectedEdge.routeEditable !== false && !locked && <><p className="diagram-edge-help">{orthogonal(selectedEdge.points) ? 'Перетащите точки или сегменты. Используйте стрелки; Shift — на 10 единиц. Escape отменяет перетаскивание.' : 'Импортированный неортогональный маршрут сохранён без изменений. Для редактирования сначала сбросьте маршрут.'}</p>
            <label className="create-object-field"><span>Начало связи</span><select className="pinput" disabled={!orthogonal(selectedEdge.points)} value={selectedEdge.from} onChange={(event) => reconnectByKeyboard(selectedEdge, 'from', event.target.value)}>{parsed.diagram.nodes.map((node) => <option key={node.id} value={node.id}>{node.label || node.id}</option>)}</select></label>
            <label className="create-object-field"><span>Конец связи</span><select className="pinput" disabled={!orthogonal(selectedEdge.points)} value={selectedEdge.to} onChange={(event) => reconnectByKeyboard(selectedEdge, 'to', event.target.value)}>{parsed.diagram.nodes.map((node) => <option key={node.id} value={node.id}>{node.label || node.id}</option>)}</select></label>
            <button type="button" className="btn" onClick={() => apply((value) => notation.resetEdge(value, selectedEdge.id))}>Сбросить маршрут</button></>}
          <small className="diagram-property-id">ID: {selected}</small>
          <button type="button" className="btn diagram-delete" disabled={locked} onClick={remove}><Icon name="trash" size={15} />Удалить</button>
        </> : <p>Выберите элемент или связь на диаграмме.</p>}
      </aside>}
    </div>
    {menu && <WorkspaceContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} actions={[{ label: 'Свойства', run: () => { setSelected(menu.id); setProperties(true); } }]} />}
    {connectionMenu && <WorkspaceContextMenu variant="connections" x={connectionMenu.x} y={connectionMenu.y} onClose={() => setConnectionMenu(null)} actions={[{ label: 'Автоматически', selected: !connectionType, preview: <ConnectionExample automatic />, run: () => { setConnectionType(undefined); setTool('connect'); setConnectFrom(null); } }, ...((notation.connectionTypes ?? []) as ConnectionOption[]).map((item) => ({ label: item.title, selected: item.id === connectionType, preview: <ConnectionExample appearance={item.appearance} />, run: () => { setConnectionType(item.id); setTool('connect'); setConnectFrom(null); } }))]} />}
    {pendingImport && <WorkspaceActionDialog title="Заменить открытую диаграмму?" description="Импорт заменит содержимое редактора. При последующем сохранении исходная модель будет заменена, а её привязки к документам потребуется удалить: совпадение ID не доказывает, что элементы совпадают. При необходимости сначала экспортируйте исходную модель." confirmLabel="Импортировать" danger busy={false} error={null} onClose={() => setPendingImport(null)} onConfirm={async () => { await importFile(pendingImport); return true; }} />}
  </div>;
}
