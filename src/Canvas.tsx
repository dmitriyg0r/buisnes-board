import { NodeShape, nodeLabelBounds, labelLines } from './modeling/DiagramEditor';
import { createContext, lazy, Suspense, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isLinkable, projectNodes, splitRef } from './bpmn';
import { DOC_SIZE, GATEWAY_SIZE, HTML_SIZE, MODEL_SIZE, SOURCE_SIZE, type CardLink, type CardSide, type Doc, type Issue, type Source, type Model } from './data';
import { splitMarkdown } from './markdown';
import type { AiModel, Settings } from './settings';
import { AiChat } from './AiChat';
import { routeOrthogonal, type Direction } from './modeling/orthogonalRouting';
import { routeBetweenNodes } from './modeling/diagramRouting';
import { AiDraftLayer, ghostRect, useDraftBuilding } from './AiDraft';
import { Icon } from './Icon';
import { ProcessCard } from './ProcessCard';
import { HtmlPreview } from './HtmlPreview';
import { getModelNotation } from './modeling/registry';
import type { IndependentModel } from './data';
import { exportCanvasObject } from './aiCanvasTools';
import { testHtml, type HtmlTestStep } from './htmlTest';
import type { AiEffect, AiToolHost, AiToolResult } from './aiToolContract';

const MarkdownView = lazy(() => import('./MarkdownView'));
import { ContextMenu, type ContextOpener, type MenuItem, type MenuTarget } from './ContextMenu';
import { PropertiesDialog, type PropTarget } from './PropertiesDialog';
import type { ModelApi } from './useModel';
import { MAX_ZOOM, MIN_ZOOM, ZoomCtx } from './zoom';
import { loadView, saveView, type CardSizes } from './viewState';
import type { Presence } from './presence';

/** карточки, которые коллега тащит прямо сейчас: их движение сглаживается */
const LiveCtx = createContext<Set<string>>(new Set());

/* Положение и размер карточек лежат в общей модели (meta), чтобы коллеги видели перемещения. */
const POS_KEY = 'layout:pos';
const SIZE_KEY = 'layout:size';
const fmtPos = (p?: { x: number; y: number }) => (p ? `${Math.round(p.x)},${Math.round(p.y)}` : '');
const fmtSize = (z?: { w: number; h: number }) => (z ? `${Math.round(z.w)},${Math.round(z.h)}` : '');
const nums = (v: string): [number, number] | null => {
  const [a, b] = v.split(',').map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
};

interface Pos {
  x: number;
  y: number;
}

type CardAnchor = { side: CardSide; offset: number };

interface Props {
  issues: Issue[];
  issue: Issue;
  onSelect: (id: string) => void;
  api: ModelApi;
  settings: Settings;
  onModel: (m: AiModel) => void;
  projectId: string;
  /** выделенные карточки (proc:…, doc:…, src:…, gw:…): состояние живёт выше, его показывает и дерево слева */
  selCards: string[];
  onSelCards: React.Dispatch<React.SetStateAction<string[]>>;
  onAddMaterial: () => void;
  /** открыть редактор BPMN-модели */
  onEditProcess: (id: string) => void;
  /** открыть редактор документа */
  onEditDoc: (id: string) => void;
  onEditHtml: (id: string) => void;
  onEditModel: (id: string) => void;
  /** редактор или другой диалог открыт: горячие клавиши полотна не работают */
  paused: boolean;
  /** курсоры коллег и отправка своего */
  presence?: Presence;
  aiPanels: { tree: boolean; panel: boolean };
  onAiWorkspaceEffect: (effect: AiEffect) => Promise<AiToolResult>;
}

/** Только чтение: адаптер не изменяет исходные данные карточки. */
export function IndependentModelPreview({ model }: { model: IndependentModel }) {
  try {
    const notation = getModelNotation(model.notation);
    if (!notation) return <p className="pnote" style={{ padding: 20 }}>Неизвестная нотация: предпросмотр недоступен.</p>;
    const result = notation.read(model.source);
    if (result.readOnlyReason) return <p className="pnote" style={{ padding: 20 }}>Предпросмотр недоступен: {result.readOnlyReason}</p>;
    const { nodes, edges, regions = [] } = result.diagram;
    const timeline = notation.timeline?.project(model.source);
    const finite = (n: number) => Number.isFinite(n);
    if (!Array.isArray(nodes) || !Array.isArray(edges) || !Array.isArray(regions) ||
      nodes.some(n => ![n.x, n.y, n.width, n.height].every(finite) || n.width <= 0 || n.height <= 0) ||
      regions.some(r => ![r.x, r.y, r.width, r.height].every(finite) || r.width <= 0 || r.height <= 0) ||
      edges.some(e => !Array.isArray(e.points) || e.points.some(p => !finite(p.x) || !finite(p.y)))) throw new Error('Некорректная геометрия');
    const xs = [...nodes.flatMap(n => [n.x, n.x + n.width]), ...regions.flatMap(r => [r.x, r.x + r.width]), ...edges.flatMap(e => e.points.map(p => p.x)), ...(timeline?.lifelines.flatMap(line => [line.lineStart.x, line.lineEnd.x]) ?? []), ...(timeline?.messages.flatMap(message => message.points.map(p => p.x)) ?? [])];
    const ys = [...nodes.flatMap(n => [n.y, n.y + n.height]), ...regions.flatMap(r => [r.y, r.y + r.height]), ...edges.flatMap(e => e.points.map(p => p.y)), ...(timeline?.lifelines.flatMap(line => [line.lineStart.y, line.lineEnd.y]) ?? []), ...(timeline?.messages.flatMap(message => message.points.map(p => p.y)) ?? [])];
    if (!xs.length || !ys.length) return <p className="pnote" style={{ padding: 20 }}>Диаграмма пуста.</p>;
    const minX = Math.min(...xs) - 20, minY = Math.min(...ys) - 20;
    const width = Math.max(40, Math.max(...xs) - minX + 20), height = Math.max(40, Math.max(...ys) - minY + 20);
    return <svg role="img" aria-label={`Предпросмотр модели: ${model.title}`} viewBox={`${minX} ${minY} ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', top: 54, left: 4, width: 'calc(100% - 8px)', height: 'calc(100% - 58px)', pointerEvents: 'none' }}>
      {regions.map(r => <g key={r.id}><rect x={r.x} y={r.y} width={r.width} height={r.height} fill="#f8fafc" stroke="#94a3b8" /><text x={r.x + 8} y={r.y + 18} fontSize="13" fill="#334155">{r.label}</text></g>)}
      {timeline?.lifelines.map(line => <line key={line.id} x1={line.lineStart.x} y1={line.lineStart.y} x2={line.lineEnd.x} y2={line.lineEnd.y} stroke="#475569" strokeDasharray="6 4" />)}
      {timeline?.messages.map(message => <polyline key={message.id} points={message.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#475569" strokeWidth="2" strokeDasharray={message.lineStyle === 'dashed' ? '8 5' : undefined} />)}
      {edges.map(e => <polyline key={e.id} points={e.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#475569" strokeWidth="2" strokeDasharray={e.lineStyle === 'dashed' ? '8 5' : e.lineStyle === 'dotted' ? '2 4' : undefined} />)}
      {nodes.map(n => {
        const symbol = notation.symbols.find(s => s.type === n.type);
        const bounds = nodeLabelBounds(n, symbol);
        const lines = labelLines(n.label || symbol?.appearance?.emptyLabel || '', bounds.width, Math.max(1, Math.floor(bounds.height / 14)));
        return <g key={n.id} transform={`translate(${n.x} ${n.y})`}><NodeShape node={n} symbol={symbol} selected={false} detail={symbol && notation.renderSymbolDetail?.(symbol)} /><text x={bounds.x - n.x + bounds.width / 2} y={bounds.y - n.y + Math.max(12, (bounds.height - lines.length * 14) / 2 + 11)} textAnchor="middle" fontSize="12" fill={symbol?.appearance?.textColor ?? "#0f172a"}>{lines.map((line, i) => <tspan key={i} x={bounds.x - n.x + bounds.width / 2} dy={i ? 14 : 0}>{line}</tspan>)}</text></g>;
      })}
    </svg>;
  } catch {
    return <p className="pnote" style={{ padding: 20 }}>Не удалось прочитать диаграмму. Исходные данные не изменены.</p>;
  }
}

/* ---------- перетаскиваемая карточка ---------- */

function DragCard({
  id,
  pos,
  onMove,
  onGrab,
  onContext,
  selected,
  linking,
  onLinkPick,
  onPortDown,
  onPortMove,
  onPortUp,
  onPortCancel,
  draggingLink,
  linkTarget,
  snapPort,
  linkLabel,
  linkSource,
  className,
  style,
  onEdit,
  onResizeStart,
  children,
}: {
  id: string;
  pos: Pos;
  onMove: (id: string, p: Pos) => void;
  onGrab: (id: string, shift: boolean) => void;
  onContext: ContextOpener;
  selected: boolean;
  /** режим «Связь»: клик по карточке выбирает её как начало или конец связи */
  linking: boolean;
  onLinkPick: (id: string, anchor?: CardAnchor, point?: Pos) => void;
  onPortDown: (id: string, anchor: CardAnchor, e: React.PointerEvent<HTMLButtonElement>) => void;
  onPortMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPortUp: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPortCancel: (e: React.PointerEvent<HTMLButtonElement>) => void;
  draggingLink: boolean;
  linkTarget: boolean;
  /** точка этой карточки, к которой сейчас «присасывается» конец связи */
  snapPort?: CardAnchor | null;
  linkLabel: string;
  linkSource: boolean;
  className: string;
  style?: React.CSSProperties;
  onEdit?: () => void;
  /** есть — в углу карточки появляется ручка изменения размера */
  onResizeStart?: (id: string, e: React.PointerEvent<HTMLElement>) => void;
  children: React.ReactNode;
}) {
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const moved = useRef(false);
  const k = useContext(ZoomCtx);
  const live = useContext(LiveCtx).has(id);

  return (
    <div
      data-card={id}
      tabIndex={0}
      role="group"
      aria-label={linkLabel}
      className={`card ${className}${selected ? ' sel' : ''}${linkSource ? ' link-src' : ''}${linkTarget && draggingLink ? ' link-target' : ''}`}
      style={{ left: pos.x, top: pos.y, ...(live ? { transition: 'left .08s linear, top .08s linear' } : null), ...style }}
      onContextMenu={(e) => onContext({ type: 'card', id }, e)}
      onFocus={(e) => { if (e.target === e.currentTarget) onGrab(id, false); }}
      onKeyDown={(e) => { if (e.target === e.currentTarget && e.key === 'Enter' && !linking && onEdit) { e.preventDefault(); e.stopPropagation(); onEdit(); } }}
      onDoubleClick={(e) => {
        if (linking || (e.target as HTMLElement).closest('button, input, textarea, a, [data-nodrag]')) return;
        if (onEdit) { e.preventDefault(); e.stopPropagation(); onEdit(); }
        else if (id.startsWith('gw:')) { e.preventDefault(); e.currentTarget.querySelector<HTMLInputElement>('.gw-label')?.focus(); }
      }}
      onPointerDown={(e) => {
        if (linking || e.button !== 0 || (e.target as HTMLElement).closest('button,input,[data-nodrag]')) return;
        drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
        moved.current = false;
        onGrab(id, e.shiftKey);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = (e.clientX - d.sx) / k;
        const dy = (e.clientY - d.sy) / k;
        if (!moved.current && Math.abs(dx) + Math.abs(dy) > 3 / k) {
          moved.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        if (moved.current) onMove(id, { x: d.ox + dx, y: d.oy + dy });
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        drag.current = null;
      }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('[data-link-port]')) return;
        if (moved.current) {
          e.stopPropagation();
          moved.current = false;
        } else if (linking) {
          e.stopPropagation();
          onLinkPick(id, undefined, { x: e.clientX, y: e.clientY });
        }
      }}
    >
      <span className="pin" />
      {children}
      {([['top', 'сверху'], ['right', 'справа'], ['bottom', 'снизу'], ['left', 'слева']] as const).flatMap(([side, label]) => {
        // Как в EPC: у прямоугольных карточек три точки, у шлюза одна.
        const count = id.startsWith('gw:') ? 1 : 3;
        return Array.from({ length: count }, (_, i) => {
          const offset = (i + 1) / (count + 1);
          const anchor = { side, offset };
          const style = side === 'top' || side === 'bottom' ? { left: `${offset * 100}%` } : { top: `${offset * 100}%` };
          return <button
            key={`${side}-${i}`} type="button" className={`card-port card-port-${side}${snapPort && snapPort.side === side && Math.abs(snapPort.offset - offset) < 1e-6 ? ' snap' : ''}`} style={style} data-link-port={side} data-link-offset={offset} data-nodrag
            tabIndex={selected || linkTarget ? 0 : -1}
            aria-label={`Связь от «${linkLabel}», точка ${label} ${i + 1} из ${count}`} title={`Создать связь ${label}`}
            onPointerDown={(e) => onPortDown(id, anchor, e)} onPointerMove={onPortMove} onPointerUp={onPortUp} onPointerCancel={onPortCancel} onLostPointerCapture={onPortCancel}
            onClick={(e) => { e.stopPropagation(); if (e.detail === 0) onLinkPick(id, anchor); }}
          />;
        });
      })}
      {onResizeStart && <span className="resize-grip" data-nodrag title="Потяните, чтобы изменить размер" onPointerDown={(e) => onResizeStart(id, e)} />}
    </div>
  );
}

/* ---------- карточка файла ---------- */

function FileCard({ source: s, active }: { source: Source; active: boolean }) {
  const isPdf = s.ext === 'PDF';
  return (
    <div className="file-inner">
      <div className="thumb">
        <div className={`page${isPdf ? '' : ' wide'}`}>
          <i className="ln dark w44" />
          <i className="ln" />
          <i className={`ln${active ? ' hit' : ''}`} />
          <i className="ln w52" />
          <i className="ln gap" />
          <i className="ln" />
          <i className="ln w40" />
        </div>
      </div>
      <div className="file-name">{s.name}</div>
      <div className="file-meta">
        <span className={`ext ${isPdf ? 'ext-pdf' : 'ext-docx'}`}>{s.ext}</span>
        <span>{s.pages} стр.</span>
      </div>
    </div>
  );
}

/* ---------- карточка документа ---------- */

function DocCard({
  doc,
  issue,
  issues,
  onSelect,
  onContext,
  onEdit,
  meta,
}: {
  doc: Doc;
  issue: Issue;
  issues: Issue[];
  onSelect: (id: string) => void;
  onContext: ContextOpener;
  onEdit: () => void;
  meta: Record<string, Record<string, string>>;
}) {
  const m = meta[`card:doc:${doc.id}`];
  const chunks = splitMarkdown(doc.markdown);
  // n-й раздел текста соответствует n-му пункту из doc.sections
  let n = -1;
  return (
    <>
      <div className="doc-head">
        <Icon name="file" size={17} />
        <b>{doc.title}</b>
        <span className="tag">Markdown</span>
        <div className="grow" />
        <button type="button" className="icon-btn edit-btn" aria-label="Редактировать документ" title="Редактировать документ" onClick={onEdit}>
          <Icon name="pencil" size={17} />
        </button>
      </div>
      <div className="doc-meta">
        <span className="chip chip-neutral"><Icon name="pencil" size={12} stroke={2.4} />{m?.status ?? 'Черновик'}</span>
        {m?.version && <span>версия {m.version}</span>}
      </div>
      <div className="doc-well">
        <div className="doc-page">
          {!doc.markdown.trim() && <p className="doc-empty">Документ пуст. Нажмите на карандаш, чтобы написать текст.</p>}
          <Suspense fallback={<p className="doc-empty">Загрузка…</p>}>
            {chunks.map((ch, i) => {
              if (ch.kind !== 'section') return <MarkdownView key={i} markdown={ch.text} />;
              n += 1;
              const sec = doc.sections[n];
              const owner = sec && issues.find((x) => x.doc?.sectionId === sec.id);
              const on = !!sec && sec.id === issue.doc?.sectionId;
              return (
                <div
                  key={i}
                  data-anchor={sec ? `section:${sec.id}` : undefined}
                  className={`sec${on ? ' on' : ''}${owner ? ' has-issue' : ''}`}
                  onClick={() => owner && onSelect(owner.id)}
                  onContextMenu={(e) => sec && onContext({ type: 'section', id: sec.id }, e)}
                >
                  <MarkdownView markdown={ch.text} />
                  {on && <span className="sec-pin">!</span>}
                </div>
              );
            })}
          </Suspense>
        </div>
      </div>
    </>
  );
}

/* ---------- масштаб и миникарта ---------- */

function ZoomControls({ k, onIn, onOut, onReset, onFit }: { k: number; onIn: () => void; onOut: () => void; onReset: () => void; onFit: () => void }) {
  return (
    <div className="zoom-ui" role="group" aria-label="Масштаб">
      <button type="button" className="tool-btn" aria-label="Уменьшить" title="Уменьшить (−)" onClick={onOut}>
        <Icon name="minus" size={15} stroke={2.2} />
      </button>
      <button type="button" className="zoom-val" title="Масштаб 100% (1)" onClick={onReset}>
        {Math.round(k * 100)}%
      </button>
      <button type="button" className="tool-btn" aria-label="Увеличить" title="Увеличить (+)" onClick={onIn}>
        <Icon name="plus" size={15} stroke={2.2} />
      </button>
      <span className="tools-sep" />
      <button type="button" className="tool-text" title="Показать всё (0)" onClick={onFit}>Вписать</button>
    </div>
  );
}

function Minimap({
  pos,
  sizes,
  cam,
  size,
  onJump,
}: {
  pos: Record<string, Pos>;
  sizes: Record<string, { w: number; h: number }>;
  cam: { x: number; y: number; k: number };
  size: { w: number; h: number };
  onJump: (x: number, y: number) => void;
}) {
  const W = 132;
  const H = 84;
  const view = { x: -cam.x / cam.k, y: -cam.y / cam.k, w: size.w / cam.k, h: size.h / cam.k };
  const ids = Object.keys(pos);
  const minx = Math.min(view.x, ...ids.map((i) => pos[i].x)) - 40;
  const miny = Math.min(view.y, ...ids.map((i) => pos[i].y)) - 40;
  const maxx = Math.max(view.x + view.w, ...ids.map((i) => pos[i].x + sizes[i].w)) + 40;
  const maxy = Math.max(view.y + view.h, ...ids.map((i) => pos[i].y + sizes[i].h)) + 40;
  const s = Math.min(W / (maxx - minx), H / (maxy - miny));
  const ox = (W - (maxx - minx) * s) / 2;
  const oy = (H - (maxy - miny) * s) / 2;
  const box = (x: number, y: number, w: number, h: number): React.CSSProperties => ({
    left: ox + (x - minx) * s,
    top: oy + (y - miny) * s,
    width: w * s,
    height: h * s,
  });
  const jump = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onJump(minx + (e.clientX - r.left - ox) / s, miny + (e.clientY - r.top - oy) / s);
  };

  return (
    <div
      className="minimap"
      aria-label="Миникарта"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        jump(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && jump(e)}
    >
      {ids.map((i) => (
        <i key={i} className={`mm-card${i.startsWith('proc:') ? ' model' : ''}`} style={box(pos[i].x, pos[i].y, sizes[i].w, sizes[i].h)} />
      ))}
      <i className="mm-view" style={box(view.x, view.y, view.w, view.h)} />
    </div>
  );
}

/* ---------- связи между карточками ---------- */

type Box = Pos & { w: number; h: number };

const cardIdsOf = (m: Model) => [
  ...m.models.map((m) => `model:${m.id}`),
  ...m.processes.map((p) => `proc:${p.id}`),
  ...m.docs.map((d) => `doc:${d.id}`),
  ...m.htmlObjects.map((h) => `html:${h.id}`),
  ...m.sources.map((s) => `src:${s.id}`),
  ...m.gateways.map((g) => `gw:${g.id}`),
];

/** Автоматический выбор сторон тем же маршрутизатором, что и в EPC. */
function routeCards(a: Box, b: Box, avoid: Box[] = []): Pos[] {
  const node = (box: Box, id: string) => ({ ...box, id, type: 'card', label: '', width: box.w, height: box.h });
  const from = node(a, 'from'), to = node(b, 'to');
  return routeBetweenNodes([from, to, ...avoid.map((box, i) => node(box, `obstacle-${i}`))], from, to) ?? [];
}

const validSide = (side: unknown): side is CardSide => side === 'top' || side === 'right' || side === 'bottom' || side === 'left';
const sideVector: Record<CardSide, Pos> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

/** Опорная точка с учётом поворота карточек источников. */
function sidePoint(box: Box, side: CardSide, degrees = 0, offset = 0.5): Pos {
  const vector = sideVector[side];
  const along = Math.max(0, Math.min(1, Number.isFinite(offset) ? offset : 0.5)) - 0.5;
  const x = vector.x ? vector.x * box.w / 2 : along * box.w;
  const y = vector.y ? vector.y * box.h / 2 : along * box.h;
  const angle = degrees * Math.PI / 180;
  return { x: box.x + box.w / 2 + x * Math.cos(angle) - y * Math.sin(angle), y: box.y + box.h / 2 + x * Math.sin(angle) + y * Math.cos(angle) };
}

/** Общий с EPC ортогональный обход с выбранными точками привязки. */
function routeAnchored(a: Box, aSide: CardSide, aAngle: number, b: Box, bSide: CardSide, bAngle: number, aOffset = 0.5, bOffset = 0.5, avoid: Box[] = []): Pos[] {
  const normals: Record<CardSide, Direction> = { top: 'up', right: 'right', bottom: 'down', left: 'left' };
  const endpoint = (box: Box, side: CardSide, angle: number, offset: number) => {
    const point = sidePoint(box, side, angle, offset);
    // Источники слегка повёрнуты: сохраняем точную привязку и внешнее направление.
    const width = Math.max(0.001, box.w), height = Math.max(0.001, box.h);
    const bounds = { x: box.x, y: box.y, width, height };
    if (side === 'left') bounds.x = point.x;
    if (side === 'right') bounds.x = point.x - width;
    if (side === 'top') bounds.y = point.y;
    if (side === 'bottom') bounds.y = point.y - height;
    if (side === 'right') point.x = bounds.x + width;
    if (side === 'bottom') point.y = bounds.y + height;
    return { point, normal: normals[side], bounds };
  };
  try {
    return routeOrthogonal({
      start: endpoint(a, aSide, aAngle, aOffset), end: endpoint(b, bSide, bAngle, bOffset),
      obstacles: avoid.map(box => ({ x: box.x, y: box.y, width: box.w, height: box.h })),
    }) ?? [];
  } catch (error) {
    if (error instanceof RangeError) return [];
    throw error;
  }
}

/** Убирает повторяющиеся и лишние точки, сохраняя развороты маршрута. */
function simplifyRoute(points: Pos[]): Pos[] {
  const result: Pos[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.01) continue;
    while (result.length > 1) {
      const a = result[result.length - 2], b = result[result.length - 1];
      const ax = b.x - a.x, ay = b.y - a.y, bx = point.x - b.x, by = point.y - b.y;
      if (Math.abs(ax * by - ay * bx) > 0.01 || ax * bx + ay * by < 0) break;
      result.pop();
    }
    result.push(point);
  }
  return result;
}

/** Ручной маршрут сохраняет точки при перемещении карточек, дополняя прямые углы. */
function routeVia(start: Pos, end: Pos, points: Pos[]): Pos[] {
  const result: Pos[] = [start];
  for (const point of [...points, end]) {
    const prev = result[result.length - 1];
    if (Math.abs(prev.x - point.x) > 0.01 && Math.abs(prev.y - point.y) > 0.01) result.push({ x: point.x, y: prev.y });
    if (Math.abs(prev.x - point.x) > 0.01 || Math.abs(prev.y - point.y) > 0.01) result.push(point);
  }
  const simplified = simplifyRoute(result);
  return simplified.length > 1 ? simplified : [start, end];
}

/** Сдвиг отрезка не перемещает закреплённые на карточках концы. */
function moveRouteSegment(points: Pos[], index: number, delta: number): Pos[] {
  const a = points[index];
  const b = points[index + 1];
  const horizontal = Math.abs(a.y - b.y) < Math.abs(a.x - b.x);
  const shift = (p: Pos) => horizontal ? { x: p.x, y: p.y + delta } : { x: p.x + delta, y: p.y };
  const sign = Math.sign(horizontal ? b.x - a.x : b.y - a.y) || 1;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const stub = Math.min(24, length / 3) * sign;
  const first = horizontal ? { x: a.x + stub, y: a.y } : { x: a.x, y: a.y + stub };
  const last = horizontal ? { x: b.x - stub, y: b.y } : { x: b.x, y: b.y - stub };
  return [
    ...points.slice(0, index),
    ...(index === 0 ? [a, first, shift(first)] : [shift(a)]),
    ...(index + 1 === points.length - 1 ? [shift(last), last, b] : [shift(b)]),
    ...points.slice(index + 2),
  ];
}

/** Номер ближайшего отрезка для перетаскивания линии целиком. */
function nearestRouteSegment(points: Pos[], point: Pos): number {
  let best = 0, distance = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    if (!length) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
    const d = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
    if (d < distance) { distance = d; best = i; }
  }
  return best;
}

/** Место для подписи: середина самого длинного отрезка. */
function labelSpot(pts: Pos[]): Pos {
  let best = 0;
  let at: Pos = pts[0];
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    if (len > best) {
      best = len;
      at = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    }
  }
  return at;
}

/* ---------- полотно ---------- */

export function Canvas({ issues, issue, onSelect, api, settings, onModel, projectId, selCards, onSelCards: setSelCards, onAddMaterial, onEditProcess, onEditDoc, onEditHtml, onEditModel, paused, presence, aiPanels, onAiWorkspaceEffect }: Props) {
  const saved = useRef(loadView(projectId)).current;
  const { sources, docs, processes, gateways, htmlObjects, models } = api.model;
  const pnodes = projectNodes(processes);

  /** документы раскладываются сеткой в три столбца справа от моделей: их может быть много */
  const docCell = (i: number): Pos => ({ x: 232 + MODEL_SIZE.w + 48 + (i % 3) * (DOC_SIZE.w + 24), y: 120 + Math.floor(i / 3) * (DOC_SIZE.h + 48) });
  /** положение по умолчанию: источники столбцом слева, модели в центре, документы справа */
  const defaultPos = (id: string): Pos => {
    const [kind, ...rest] = id.split(':');
    const key = rest.join(':');
    if (kind === 'proc') {
      const i = Math.max(0, processes.findIndex((p) => p.id === key));
      return { x: 232, y: 60 + i * (MODEL_SIZE.h + 48) };
    }
    if (kind === 'model') { const i = Math.max(0, models.findIndex((m) => m.id === key)); return { x: 232, y: 60 + (processes.length + i) * (MODEL_SIZE.h + 48) }; }
    if (kind === 'doc') {
      const i = Math.max(0, docs.findIndex((d) => d.id === key));
      return docCell(i);
    }
    if (kind === 'gw') {
      const i = Math.max(0, gateways.findIndex((g) => g.id === key));
      return { x: 232 + (i % 4) * (GATEWAY_SIZE.w + 24), y: 20 };
    }
    if (kind === 'html') {
      const i = Math.max(0, htmlObjects.findIndex((h) => h.id === key));
      return { x: 232 + (i % 3) * (HTML_SIZE.w + 24), y: 120 + processes.length * (MODEL_SIZE.h + 48) + Math.ceil(docs.length / 3) * (DOC_SIZE.h + 48) + Math.floor(i / 3) * (HTML_SIZE.h + 48) };
    }
    const i = Math.max(0, sources.findIndex((s) => s.id === key));
    return { x: 16 + (i % 2) * 12, y: 120 + i * (SOURCE_SIZE.h + 74) };
  };
  const [pos, setPos] = useState<Record<string, Pos>>(() => {
    const shared: Record<string, Pos> = {};
    for (const [id, v] of Object.entries(api.model.meta[POS_KEY] ?? {})) { const n = nums(v); if (n) shared[id] = { x: n[0], y: n[1] }; }
    return { ...(saved?.pos ?? {}), ...shared };
  });
  const posOf = (id: string): Pos => pos[id] ?? defaultPos(id);
  const cardIds = cardIdsOf(api.model);
  const [sizes, setSizes] = useState<CardSizes>(() => {
    const shared: CardSizes = {};
    for (const [id, v] of Object.entries(api.model.meta[SIZE_KEY] ?? {})) { const n = nums(v); if (n) shared[id] = { w: n[0], h: n[1] }; }
    return { ...(saved?.sizes ?? {}), ...shared };
  });
  const cardSize = (id: string) => sizes[id] ?? (id.startsWith('proc:') || id.startsWith('model:') ? MODEL_SIZE : id.startsWith('doc:') ? DOC_SIZE : id.startsWith('html:') ? HTML_SIZE : id.startsWith('gw:') ? GATEWAY_SIZE : SOURCE_SIZE);
  const MIN_CARD = (id: string) => (id.startsWith('proc:') ? { w: 320, h: 240 } : id.startsWith('gw:') ? { w: 96, h: 96 } : { w: 240, h: 200 });
  const MAX_CARD = 2400;
  // положение и размеры карточек входят в общую историю «назад / вперёд» вместе с моделью
  const layoutRef = useRef({ pos, sizes });
  layoutRef.current = { pos, sizes };
  // перетаскивание в реальном времени: свои позиции уходят сразу, чужие применяются без ожидания записи в модель
  const sentDrag = useRef<Record<string, string>>({});
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set());
  const liveTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!presence || !gestureCk.current) return;
    const items = Object.entries(pos).filter(([id, p]) => fmtPos(p) !== sentDrag.current[id]).map(([id, p]) => ({ id, x: Math.round(p.x), y: Math.round(p.y) }));
    if (!items.length) return;
    for (const i of items) sentDrag.current[i.id] = `${i.x},${i.y}`;
    presence.sendDrag(items);
  }, [pos]);
  useEffect(() => presence?.onDrag((items) => {
    if (gestureCk.current) return; // свою карточку не дёргаем
    for (const i of items) sentDrag.current[i.id] = `${Math.round(i.x)},${Math.round(i.y)}`;
    setPos((s) => { const n = { ...s }; for (const i of items) n[i.id] = { x: i.x, y: i.y }; return n; });
    setLiveIds(new Set(items.map((i) => i.id)));
    clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => setLiveIds(new Set()), 250);
  }), [presence?.onDrag]);
  // чужие перемещения и размеры: применяем только записи, которые изменились в модели (свои незаписанные правки не трогаем)
  const prevMeta = useRef(api.model.meta);
  useEffect(() => {
    const prev = prevMeta.current;
    prevMeta.current = api.model.meta;
    const np = api.model.meta[POS_KEY] ?? {}, op = prev[POS_KEY] ?? {};
    const ns = api.model.meta[SIZE_KEY] ?? {}, os = prev[SIZE_KEY] ?? {};
    const dp: Record<string, Pos> = {}, ds: CardSizes = {};
    for (const [id, v] of Object.entries(np)) { const n = v !== op[id] && v !== fmtPos(layoutRef.current.pos[id]) ? nums(v) : null; if (n) dp[id] = { x: n[0], y: n[1] }; }
    for (const [id, v] of Object.entries(ns)) { const n = v !== os[id] && v !== fmtSize(layoutRef.current.sizes[id]) ? nums(v) : null; if (n) ds[id] = { w: n[0], h: n[1] }; }
    if (Object.keys(dp).length) setPos((s) => ({ ...s, ...dp }));
    if (Object.keys(ds).length) setSizes((s) => ({ ...s, ...ds }));
  }, [api.model.meta]);
  // свои перемещения и размеры уходят в модель после паузы, когда карточку отпустили
  const metaNow = useRef(api.model.meta);
  metaNow.current = api.model.meta;
  useEffect(() => {
    const t = setTimeout(() => {
      const curP = metaNow.current[POS_KEY] ?? {}, curS = metaNow.current[SIZE_KEY] ?? {};
      const wantP: Record<string, string> = {}, wantS: Record<string, string> = {};
      for (const id of cardIds) {
        if (pos[id] && fmtPos(pos[id]) !== curP[id]) wantP[id] = fmtPos(pos[id]);
        if (sizes[id] && fmtSize(sizes[id]) !== curS[id]) wantS[id] = fmtSize(sizes[id]);
      }
      if (!Object.keys(wantP).length && !Object.keys(wantS).length) return;
      api.applyLive((m) => ({ ...m, meta: { ...m.meta, ...(Object.keys(wantP).length ? { [POS_KEY]: { ...m.meta[POS_KEY], ...wantP } } : {}), ...(Object.keys(wantS).length ? { [SIZE_KEY]: { ...m.meta[SIZE_KEY], ...wantS } } : {}) } }));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, sizes, api.model.meta]);
  api.bindExtra(
    () => layoutRef.current,
    (v) => {
      const l = v as { pos: Record<string, Pos>; sizes: CardSizes };
      setPos(l.pos);
      setSizes(l.sizes);
    },
  );
  /** точка отмены ставится один раз на жест: перетаскивание или растягивание */
  const gestureCk = useRef(false);
  const checkpointOnce = () => {
    if (gestureCk.current) return;
    gestureCk.current = true;
    api.checkpoint();
  };
  const boxOf = (s: Record<string, Pos>, i: string): Box => ({ ...(s[i] ?? defaultPos(i)), ...cardSize(i) });

  type Guide = { v: boolean; at: number; from: number; to: number };
  const SNAP_PX = 6;
  const guideRef = useRef<Guide[]>([]);
  const [, bump] = useState(0);
  useEffect(() => {
    // карточку отпустили — направляющие исчезают
    const up = () => {
      gestureCk.current = false;
      if (guideRef.current.length) {
        guideRef.current = [];
        bump((n) => n + 1);
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const move = (id: string, p: Pos) => {
    checkpointOnce();
    setPos((s) => {
      const cur = (i: string) => s[i] ?? defaultPos(i);
      const dx = p.x - cur(id).x;
      const dy = p.y - cur(id).y;
      const ids = selCards.includes(id) ? selCards : [id];
      const others = cardIds.filter((i) => !ids.includes(i));
      let mx = dx;
      let my = dy;
      // прилипание к краям и центрам соседних карточек, как направляющие в Figma
      const lines: Guide[] = [];
      const gb = ids.map((i) => boxOf(s, i));
      const g0 = { x: Math.min(...gb.map((b) => b.x)) + mx, y: Math.min(...gb.map((b) => b.y)) + my };
      const g1 = { x: Math.max(...gb.map((b) => b.x + b.w)) + mx, y: Math.max(...gb.map((b) => b.y + b.h)) + my };
      const ob = others.map((o) => boxOf(s, o));
      const T = SNAP_PX / camRef.current.k;
      const snapAxis = (axisX: boolean) => {
        const mine = axisX ? [g0.x, (g0.x + g1.x) / 2, g1.x] : [g0.y, (g0.y + g1.y) / 2, g1.y];
        let best: number | null = null;
        for (const o of ob) {
          const theirs = axisX ? [o.x, o.x + o.w / 2, o.x + o.w] : [o.y, o.y + o.h / 2, o.y + o.h];
          for (const a of mine) for (const b of theirs) if (Math.abs(b - a) <= T && (best === null || Math.abs(b - a) < Math.abs(best))) best = b - a;
        }
        if (best !== null && best !== 0) {
          const nx = axisX ? mx + best : mx;
          const ny = axisX ? my : my + best;
          if (axisX) {
            mx = nx;
            g0.x += best;
            g1.x += best;
          } else {
            my = ny;
            g0.y += best;
            g1.y += best;
          }
        }
      };
      snapAxis(true);
      snapAxis(false);
      const eq = (a: number, b: number) => Math.abs(a - b) < 0.5;
      const mineX = [g0.x, (g0.x + g1.x) / 2, g1.x];
      const mineY = [g0.y, (g0.y + g1.y) / 2, g1.y];
      for (const a of mineX) {
        const hit = ob.filter((o) => [o.x, o.x + o.w / 2, o.x + o.w].some((b) => eq(a, b)));
        if (hit.length) lines.push({ v: true, at: a, from: Math.min(g0.y, ...hit.map((o) => o.y)), to: Math.max(g1.y, ...hit.map((o) => o.y + o.h)) });
      }
      for (const a of mineY) {
        const hit = ob.filter((o) => [o.y, o.y + o.h / 2, o.y + o.h].some((b) => eq(a, b)));
        if (hit.length) lines.push({ v: false, at: a, from: Math.min(g0.x, ...hit.map((o) => o.x)), to: Math.max(g1.x, ...hit.map((o) => o.x + o.w)) });
      }
      guideRef.current = lines;
      const next = { ...s };
      for (const i of ids) next[i] = { x: cur(i).x + mx, y: cur(i).y + my };
      return next;
    });
  };

  /** Растягивание с направляющими и минимальным размером, включая наложение на соседей. */
  const startResize = (id: string, e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const start = { ...cardSize(id) };
    const at = { x: e.clientX, y: e.clientY };
    const min = MIN_CARD(id);
    const p = posOf(id);
    const others = cardIds.filter((i) => i !== id).map((i) => boxOf(pos, i));
    const k = camRef.current.k;
    const onMoveEv = (ev: PointerEvent) => {
      checkpointOnce();
      let w = Math.min(MAX_CARD, Math.max(min.w, start.w + (ev.clientX - at.x) / k));
      let h = Math.min(MAX_CARD, Math.max(min.h, start.h + (ev.clientY - at.y) / k));
      // прилипание правого и нижнего края к краям и центрам соседей
      const T = SNAP_PX / k;
      const snap = (edge: number, lines: number[]) => lines.reduce<number | null>((best, l) => (Math.abs(l - edge) <= T && (best === null || Math.abs(l - edge) < Math.abs(best - edge)) ? l : best), null);
      const sx = snap(p.x + w, others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w]));
      const sy = snap(p.y + h, others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h]));
      if (sx !== null && sx - p.x >= min.w) w = sx - p.x;
      if (sy !== null && sy - p.y >= min.h) h = sy - p.y;
      // направляющие там, где край совпал с краем или центром соседа
      const lines: Guide[] = [];
      const eq = (a: number, b: number) => Math.abs(a - b) < 0.5;
      const right = p.x + w;
      const bottom = p.y + h;
      const hx = others.filter((o) => [o.x, o.x + o.w / 2, o.x + o.w].some((l) => eq(l, right)));
      if (hx.length) lines.push({ v: true, at: right, from: Math.min(p.y, ...hx.map((o) => o.y)), to: Math.max(bottom, ...hx.map((o) => o.y + o.h)) });
      const hy = others.filter((o) => [o.y, o.y + o.h / 2, o.y + o.h].some((l) => eq(l, bottom)));
      if (hy.length) lines.push({ v: false, at: bottom, from: Math.min(p.x, ...hy.map((o) => o.x)), to: Math.max(right, ...hy.map((o) => o.x + o.w)) });
      guideRef.current = lines;
      setSizes((s) => ({ ...s, [id]: { w: Math.round(w), h: Math.round(h) } }));
    };
    const onUpEv = () => {
      grip.removeEventListener('pointermove', onMoveEv);
      grip.removeEventListener('pointerup', onUpEv);
      grip.removeEventListener('pointercancel', onUpEv);
    };
    grip.addEventListener('pointermove', onMoveEv);
    grip.addEventListener('pointerup', onUpEv);
    grip.addEventListener('pointercancel', onUpEv);
  };

  const grab = (id: string, shift: boolean) =>
    setSelCards((c) => (shift ? (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]) : c.includes(id) ? c : [id]));

  const root = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const [sourceSizes, setSourceSizes] = useState<CardSizes>({});
  const [cam, setCam] = useState(() => saved?.cam ?? { x: 0, y: 0, k: 1 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const wheelZoomRef = useRef(settings.wheelZoom);
  wheelZoomRef.current = settings.wheelZoom;

  useEffect(() => {
    const t = setTimeout(() => saveView(projectId, { cam, pos, sizes }), 250);
    return () => clearTimeout(t);
  }, [cam, pos, sizes]);
  const [size, setSize] = useState({ w: 1000, h: 800 });
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [space, setSpace] = useState(false);
  /** счётчик перерисовок: после отрисовки диаграммы нужно заново найти шаги в DOM */
  const [anchors, setAnchors] = useState(0);

  /* ----- связи между карточками ----- */
  const [mode, setMode] = useState<'select' | 'link' | 'gateway'>('select');
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [linkFromAnchor, setLinkFromAnchor] = useState<CardAnchor | null>(null);
  const [linkPointer, setLinkPointer] = useState<{ point: Pos; target: string | null; toAnchor: CardAnchor | null } | null>(null);
  const [selLink, setSelLink] = useState<string | null>(null);
  const [editLink, setEditLink] = useState<string | null>(null);
  const [showReconnect, setShowReconnect] = useState(false);
  const [linkFailure, setLinkFailure] = useState<string | null>(null);
  type LinkGesture = { kind: 'segment' | 'from' | 'to'; link: CardLink; pointer: number; element: SVGElement; start: Pos; startClient: Pos; points: Pos[]; index: number; delta: number; draft: Pos[]; target: string | null; candidate: CardLink | null; moved: boolean };
  const [linkGesture, setLinkGesture] = useState<LinkGesture | null>(null);
  const linkGestureRef = useRef<LinkGesture | null>(null);
  useEffect(() => setShowReconnect(false), [selLink]);
  type PortDrag = { from: string; fromAnchor: CardAnchor; pointer: number; startX: number; startY: number; start: Pos; point: Pos; target: string | null; toAnchor: CardAnchor | null; moved: boolean; element: HTMLButtonElement };
  const [portDrag, setPortDrag] = useState<PortDrag | null>(null);
  const portDragRef = useRef<PortDrag | null>(null);
  const cardLinks = api.model.cardLinks.filter((l) => cardIdsOf(api.model).includes(l.from) && cardIdsOf(api.model).includes(l.to));

  const boxForLink = (id: string): Box => ({ ...posOf(id), ...(id.startsWith('src:') ? sourceSizes[id] ?? cardSize(id) : cardSize(id)) });
  const angleForLink = (id: string) => { const i = sources.findIndex((s) => `src:${s.id}` === id); return i < 0 ? 0 : i % 2 ? 1.2 : -1.4; };
  /** Остальные карточки: связь старается не заходить и на них. */
  const obstaclesFor = (a: string, b: string | null) => cardIds.filter((id) => id !== a && id !== b).map(boxForLink);
  const pointsForLink = (link: CardLink) => {
    const base = validSide(link.fromSide) && validSide(link.toSide)
      ? routeAnchored(boxForLink(link.from), link.fromSide, angleForLink(link.from), boxForLink(link.to), link.toSide, angleForLink(link.to), link.fromOffset, link.toOffset, obstaclesFor(link.from, link.to))
      : routeCards(boxForLink(link.from), boxForLink(link.to), obstaclesFor(link.from, link.to));
    const points = Array.isArray(link.routePoints) ? link.routePoints.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
    if (points.length && validSide(link.fromSide) && validSide(link.toSide)) return routeVia(
      sidePoint(boxForLink(link.from), link.fromSide, angleForLink(link.from), link.fromOffset),
      sidePoint(boxForLink(link.to), link.toSide, angleForLink(link.to), link.toOffset), points,
    );
    if (base.length < 2) return [];
    const automatic = simplifyRoute(base);
    return points.length ? routeVia(base[0], base[base.length - 1], points) : automatic.length > 1 ? automatic : base;
  };
  const pointOnCanvas = (x: number, y: number): Pos => { const r = root.current!.getBoundingClientRect(); const c = camRef.current; return { x: (x - r.left - c.x) / c.k, y: (y - r.top - c.y) / c.k }; };
  const anchorAt = (id: string, point: Pos): CardAnchor => {
    const box = boxForLink(id);
    const angle = -angleForLink(id) * Math.PI / 180;
    const dx = point.x - box.x - box.w / 2;
    const dy = point.y - box.y - box.h / 2;
    const x = dx * Math.cos(angle) - dy * Math.sin(angle) + box.w / 2;
    const y = dx * Math.sin(angle) + dy * Math.cos(angle) + box.h / 2;
    const distances = [Math.abs(y), Math.abs(x - box.w), Math.abs(y - box.h), Math.abs(x)];
    const side = (['top', 'right', 'bottom', 'left'] as const)[distances.indexOf(Math.min(...distances))];
    return { side, offset: id.startsWith('gw:') ? 0.5 : Math.max(0, Math.min(1, side === 'top' || side === 'bottom' ? x / box.w : y / box.h)) };
  };
  /** true, если связь создана */
  const addCardLink = (from: string, to: string, a: CardAnchor, b: CardAnchor): boolean => {
    if (from === to || !cardIds.includes(from) || !cardIds.includes(to) || api.model.cardLinks.some((l) => l.from === from && l.to === to)) return false;
    if (!routeAnchored(boxForLink(from), a.side, angleForLink(from), boxForLink(to), b.side, angleForLink(to), a.offset, b.offset, obstaclesFor(from, to)).length) {
      setLinkFailure('Не удалось проложить связь. Передвиньте объекты или выберите другие точки.');
      return false;
    }
    setLinkFailure(null);
    const lid = 'c' + Math.random().toString(36).slice(2, 7);
    api.apply((m) => ({ ...m, cardLinks: [...m.cardLinks, { id: lid, from, to, label: '', fromSide: a.side, fromOffset: a.offset, toSide: b.side, toOffset: b.offset }] }));
    setSelLink(lid);
    return true;
  };
  const pickForLink = (id: string, anchor?: CardAnchor, point?: Pos) => {
    // клик по телу карточки: конец связи липнет к ближайшей точке карточки
    const cardEl = point ? Array.from(world.current?.querySelectorAll<HTMLElement>('[data-card]') ?? []).find((c) => c.dataset.card === id) : undefined;
    const snapped = !anchor && point && cardEl ? nearestAnchor(cardEl, point.x, point.y) : null;
    const chosen = anchor ?? snapped ?? (point ? anchorAt(id, pointOnCanvas(point.x, point.y)) : { side: 'right', offset: 0.5 } as CardAnchor);
    if (!linkFrom) {
      setLinkFrom(id);
      setLinkFromAnchor(chosen);
      setLinkPointer({ point: sidePoint(boxForLink(id), chosen.side, angleForLink(id), chosen.offset), target: null, toAnchor: null });
      setMode('link');
      return;
    }
    if (linkFrom === id) {
      setLinkFrom(null);
      setLinkFromAnchor(null);
      setLinkPointer(null);
      return;
    }
    // связь проведена: режим связи выключается, дальше снова выбор и перетаскивание
    if (linkFromAnchor && addCardLink(linkFrom, id, linkFromAnchor, chosen)) setMode('select');
    setLinkFrom(null);
    setLinkFromAnchor(null);
    setLinkPointer(null);
  };
  const removeCardLink = (id: string) => {
    api.apply((m) => ({ ...m, cardLinks: m.cardLinks.filter((l) => l.id !== id) }));
    setSelLink(null);
    setEditLink(null);
  };
  const setLinkLabel = (id: string, label: string) =>
    api.apply((m) => ({ ...m, cardLinks: m.cardLinks.map((l) => (l.id === id ? { ...l, label } : l)) }));
  /** Ближайшая к точке экрана точка связи карточки: концы связей «присасываются» к точкам, а не встают где попало. */
  const nearestAnchor = (card: HTMLElement, x: number, y: number): CardAnchor | null => {
    const ports = Array.from(card.querySelectorAll<HTMLElement>('[data-link-port]'));
    const nearest = ports.map((port) => { const r = port.getBoundingClientRect(); return { port, distance: Math.hypot(x - r.left - r.width / 2, y - r.top - r.height / 2) }; }).sort((a, b) => a.distance - b.distance)[0]?.port;
    const side = nearest?.dataset.linkPort;
    return validSide(side) ? { side, offset: Number(nearest?.dataset.linkOffset) } : null;
  };
  const portTargetAt = (x: number, y: number, from: string) => {
    const cards = Array.from(world.current?.querySelectorAll<HTMLElement>('[data-card]') ?? []).filter((card) => card.dataset.card !== from && cardIds.includes(card.dataset.card ?? ''));
    const candidates = cards.map((card) => {
      const r = card.getBoundingClientRect();
      const distance = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      const portDistance = Math.min(...Array.from(card.querySelectorAll<HTMLElement>('[data-link-port]')).map(port => {
        const p = port.getBoundingClientRect();
        return Math.hypot(x - p.left - p.width / 2, y - p.top - p.height / 2);
      }));
      return { card, distance: Math.min(distance, Math.max(0, portDistance - 7 * camRef.current.k)) };
    }).filter((item) => item.distance <= 18).sort((a, b) => a.distance - b.distance);
    const card = candidates[0]?.card;
    if (!card?.dataset.card) return { target: null, toAnchor: null };
    return { target: card.dataset.card, toAnchor: nearestAnchor(card, x, y) };
  };
  const reconnectLink = (link: CardLink, end: 'from' | 'to', id: string, anchor: CardAnchor): CardLink | null => {
    const from = end === 'from' ? id : link.from;
    const to = end === 'to' ? id : link.to;
    if (from === to || !cardIds.includes(id) || api.model.cardLinks.some((item) => item.id !== link.id && item.from === from && item.to === to)) return null;
    const old = pointsForLink(link);
    const fixedFrom = validSide(link.fromSide) ? { side: link.fromSide, offset: link.fromOffset ?? 0.5 } : anchorAt(link.from, old[0] ?? posOf(link.from));
    const fixedTo = validSide(link.toSide) ? { side: link.toSide, offset: link.toOffset ?? 0.5 } : anchorAt(link.to, old[old.length - 1] ?? posOf(link.to));
    const a = end === 'from' ? anchor : fixedFrom;
    const b = end === 'to' ? anchor : fixedTo;
    return { ...link, from, to, fromSide: a.side, fromOffset: a.offset, toSide: b.side, toOffset: b.offset };
  };
  const commitLink = (next: CardLink) => api.apply((m) => ({ ...m, cardLinks: m.cardLinks.map((item) => item.id === next.id ? next : item) }));
  const beginLinkGesture = (link: CardLink, kind: LinkGesture['kind'], index: number, e: React.PointerEvent<SVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const points = pointsForLink(link);
    if (points.length < 2) return;
    const gesture: LinkGesture = { kind, link, pointer: e.pointerId, element: e.currentTarget, start: pointOnCanvas(e.clientX, e.clientY), startClient: { x: e.clientX, y: e.clientY }, points, index, delta: 0, draft: points, target: null, candidate: null, moved: false };
    linkGestureRef.current = gesture; setLinkGesture(gesture);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveLinkGesture = (e: React.PointerEvent<SVGElement>) => {
    const gesture = linkGestureRef.current;
    if (!gesture || gesture.pointer !== e.pointerId) return;
    e.stopPropagation();
    const point = pointOnCanvas(e.clientX, e.clientY);
    const moved = gesture.moved || Math.hypot(e.clientX - gesture.startClient.x, e.clientY - gesture.startClient.y) > 4;
    let draft = gesture.points;
    let delta = 0;
    let target: string | null = null;
    let candidate: CardLink | null = null;
    if (moved && gesture.kind === 'segment') {
      const a = gesture.points[gesture.index], b = gesture.points[gesture.index + 1];
      const horizontal = Math.abs(a.y - b.y) < Math.abs(a.x - b.x);
      delta = horizontal ? point.y - gesture.start.y : point.x - gesture.start.x;
      draft = moveRouteSegment(gesture.points, gesture.index, delta);
    } else if (moved && gesture.kind !== 'segment') {
      const hit = portTargetAt(e.clientX, e.clientY, gesture.kind === 'from' ? gesture.link.to : gesture.link.from);
      if (hit.target && hit.toAnchor) candidate = reconnectLink(gesture.link, gesture.kind, hit.target, hit.toAnchor);
      target = candidate ? hit.target : null;
      draft = candidate ? pointsForLink(candidate) : routeVia(gesture.kind === 'from' ? point : gesture.points[0], gesture.kind === 'to' ? point : gesture.points[gesture.points.length - 1], gesture.link.routePoints ?? []);
    }
    const next = { ...gesture, moved, delta, draft, target, candidate };
    linkGestureRef.current = next; setLinkGesture(next);
  };
  const endLinkGesture = (e: React.PointerEvent<SVGElement>, cancelled = false) => {
    const gesture = linkGestureRef.current;
    if (!gesture || gesture.pointer !== e.pointerId) return;
    e.stopPropagation();
    linkGestureRef.current = null; setLinkGesture(null);
    if (gesture.element.hasPointerCapture(gesture.pointer)) gesture.element.releasePointerCapture(gesture.pointer);
    if (cancelled || !gesture.moved) return;
    if (gesture.kind === 'segment') commitLink({ ...gesture.link, routePoints: simplifyRoute(gesture.draft).slice(1, -1) });
    else if (gesture.candidate) commitLink(gesture.candidate);
  };
  const startPortDrag = (from: string, fromAnchor: CardAnchor, e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || portDragRef.current) return;
    e.preventDefault(); e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const start = pointOnCanvas(r.left + r.width / 2, r.top + r.height / 2);
    const drag: PortDrag = { from, fromAnchor, pointer: e.pointerId, startX: e.clientX, startY: e.clientY, start, point: start, target: null, toAnchor: null, moved: false, element: e.currentTarget };
    portDragRef.current = drag; setPortDrag(drag); setSelCards([from]); setSelLink(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const movePortDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = portDragRef.current;
    if (!drag || drag.pointer !== e.pointerId) return;
    e.stopPropagation();
    const moved = drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4;
    const target = moved ? portTargetAt(e.clientX, e.clientY, drag.from) : { target: null, toAnchor: null };
    const next = { ...drag, moved, point: pointOnCanvas(e.clientX, e.clientY), ...target };
    portDragRef.current = next; setPortDrag(next);
  };
  const finishPortDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = portDragRef.current;
    if (!drag || drag.pointer !== e.pointerId) return;
    e.preventDefault(); e.stopPropagation();
    const moved = drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4;
    const target = moved ? portTargetAt(e.clientX, e.clientY, drag.from) : null;
    portDragRef.current = null; setPortDrag(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!moved) pickForLink(drag.from, drag.fromAnchor);
    else { if (target?.target && target.toAnchor) addCardLink(drag.from, target.target, drag.fromAnchor, target.toAnchor); setMode('select'); setLinkFrom(null); setLinkFromAnchor(null); setLinkPointer(null); }
  };
  const cancelPortDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (portDragRef.current?.pointer !== e.pointerId) return;
    portDragRef.current = null; setPortDrag(null);
  };
  const linkProps = (id: string, linkLabel: string) => ({ linking: mode === 'link', onLinkPick: pickForLink, linkSource: linkFrom === id, onPortDown: startPortDrag, onPortMove: movePortDrag, onPortUp: finishPortDrag, onPortCancel: cancelPortDrag, draggingLink: Boolean(portDrag?.moved || linkPointer || linkGesture?.moved), linkTarget: (portDrag?.target ?? linkPointer?.target ?? linkGesture?.target) === id, snapPort: (portDrag?.target ?? linkPointer?.target) === id ? (portDrag?.toAnchor ?? linkPointer?.toAnchor ?? null) : null, linkLabel });
  const switchMode = (m: 'select' | 'link' | 'gateway') => {
    setMode(m);
    setLinkFailure(null);
    setLinkFrom(null);
    setLinkFromAnchor(null);
    setLinkPointer(null);
  };

  const clampK = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
  const zoomAt = (factor: number, px: number, py: number) => {
    const c = camRef.current;
    const k = clampK(c.k * factor);
    const next = { k, x: px - ((px - c.x) * k) / c.k, y: py - ((py - c.y) * k) / c.k };
    // камера обновляется сразу: несколько тиков колёсика за один кадр не должны терять шаги
    camRef.current = next;
    setCam(next);
  };
  const zoomCenter = (factor: number) => zoomAt(factor, size.w / 2, size.h / 2);
  const setZoom = (k: number) => zoomAt(k / camRef.current.k, size.w / 2, size.h / 2);

  // Плавающий чат не входит в рабочую область, куда вписываются карточки.
  const availableArea = () => {
    const el = root.current;
    if (!el) return { x: 40, y: 56, w: Math.max(1, size.w - 80), h: Math.max(1, size.h - 160) };
    const bounds = el.getBoundingClientRect();
    const chat = el.querySelector<HTMLElement>('.ai-bar')?.getBoundingClientRect();
    const bottom = chat ? Math.min(el.clientHeight - 24, chat.top - bounds.top - 16) : el.clientHeight - 40;
    return { x: 40, y: 56, w: Math.max(1, el.clientWidth - 80), h: Math.max(1, bottom - 56) };
  };

  const [chatCollapseRequest, setChatCollapseRequest] = useState(0);
  const fit = async (collapseChat = true) => {
    if (collapseChat && root.current?.querySelector('.ai-bar.open')) {
      setChatCollapseRequest((count) => count + 1);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    const el = root.current;
    if (!el) return;
    const area = availableArea();
    const ids = cardIds;
    if (!ids.length) return;
    const minx = Math.min(...ids.map((i) => posOf(i).x));
    const miny = Math.min(...ids.map((i) => posOf(i).y));
    const maxx = Math.max(...ids.map((i) => posOf(i).x + cardSize(i).w));
    const maxy = Math.max(...ids.map((i) => posOf(i).y + cardSize(i).h));
    const k = clampK(Math.min(area.w / (maxx - minx), area.h / (maxy - miny), 1));
    setCam({
      k,
      x: area.x + (area.w - (maxx - minx) * k) / 2 - minx * k,
      y: area.y + (area.h - (maxy - miny) * k) / 2 - miny * k,
    });
  };

  const cardsKey = cardIds.join('|');
  useLayoutEffect(() => {
    const nodes = Array.from(world.current?.querySelectorAll<HTMLElement>('.file-card[data-card]') ?? []);
    const measure = () => setSourceSizes((old) => {
      const next: CardSizes = {};
      for (const node of nodes) if (node.dataset.card) next[node.dataset.card] = { w: node.offsetWidth, h: node.offsetHeight };
      return JSON.stringify(old) === JSON.stringify(next) ? old : next;
    });
    const observer = new ResizeObserver(measure);
    nodes.forEach((node) => observer.observe(node));
    measure();
    return () => observer.disconnect();
  }, [cardsKey]);
  /** куда класть новую карточку: точка правого клика по полотну; без неё — центр видимой области */
  const spawnAt = useRef<Pos | null>(null);
  const prevIds = useRef(cardIds);
  useEffect(() => {
    const added = cardIds.filter((i) => !prevIds.current.includes(i) && !pos[i] && !api.model.meta[POS_KEY]?.[i]);
    prevIds.current = cardIds;
    // пачка карточек разом — это загрузка проекта, а не действие пользователя: их места не трогаем
    const fresh = added.length === 1 ? added : [];
    const el = root.current;
    const c = camRef.current;
    const at = spawnAt.current ?? (el ? { x: (el.clientWidth / 2 - c.x) / c.k, y: (el.clientHeight / 2 - c.y) / c.k } : { x: 0, y: 0 });
    const left = el ? -c.x / c.k + 16 : 0;
    const top = el ? -c.y / c.k + 16 : 0;
    spawnAt.current = null;
    setPos((s) => {
      let n = s;
      if (fresh.length) {
        n = { ...s };
        for (const i of fresh) {
          const { w, h } = cardSize(i);
          n[i] = { x: Math.max(left, at.x - w / 2), y: Math.max(top, at.y - h / 2) };
        }
      }
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsKey]);
  // диалог закрыт без добавления — точка правого клика больше не нужна
  useEffect(() => {
    if (!paused) spawnAt.current = null;
  }, [paused]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (!saved) fit();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = root.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.zoom-ui,.minimap')) return;
      e.preventDefault();
      const lines = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const zoomKey = e.ctrlKey || e.metaKey;
      // Ctrl или ⌘ + колёсико и щипок на тачпаде (он приходит с Ctrl) меняют масштаб вокруг курсора;
      // обычное колёсико делает то же только по настройке «Колёсико мыши масштабирует доску»
      if (zoomKey || (wheelZoomRef.current && !e.shiftKey)) {
        const r = el.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * lines * (zoomKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
        return;
      }
      // иначе доска прокручивается: колёсико и два пальца на тачпаде, Shift — по горизонтали
      const c = camRef.current;
      setCam({
        ...c,
        x: c.x - (e.shiftKey ? e.deltaY || e.deltaX : e.deltaX) * lines,
        y: c.y - (e.shiftKey ? 0 : e.deltaY) * lines,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  type Gesture =
    | { type: 'pan'; sx: number; sy: number; x: number; y: number; moved: boolean }
    | { type: 'marquee'; wx: number; wy: number; sx: number; sy: number; moved: boolean; base: string[] };
  const gest = useRef<Gesture | null>(null);

  const worldPt = (e: React.PointerEvent) => {
    const r = root.current!.getBoundingClientRect();
    const c = camRef.current;
    return { x: (e.clientX - r.left - c.x) / c.k, y: (e.clientY - r.top - c.y) / c.k };
  };
  // пока тянем рамку или полотно, браузер не должен выделять текст на странице
  const lockSelection = () => document.body.classList.add('gesturing');
  const startPan = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    lockSelection();
    gest.current = { type: 'pan', sx: e.clientX, sy: e.clientY, x: camRef.current.x, y: camRef.current.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const startMarquee = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    lockSelection();
    window.getSelection()?.removeAllRanges();
    const w = worldPt(e);
    gest.current = { type: 'marquee', wx: w.x, wy: w.y, sx: e.clientX, sy: e.clientY, moved: false, base: e.shiftKey ? selCards : [] };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  // пробел или средняя кнопка двигают полотно, даже если курсор над карточкой
  const rootDownCapture = (e: React.PointerEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (t !== root.current && !t.closest('.world')) return;
    if (e.button === 1 || (e.button === 0 && space)) {
      e.stopPropagation();
      startPan(e);
    }
  };
  const rootDown = (e: React.PointerEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (e.button !== 0 || (t !== root.current && t !== world.current)) return;
    if (mode === 'gateway') {
      // инструмент «Шлюз»: клик по пустому месту ставит шлюз, затем возвращается выбор
      addGateway(worldPt(e));
      switchMode('select');
      return;
    }
    startMarquee(e);
  };

  const rootMove = (e: React.PointerEvent<HTMLElement>) => {
    if (presence && root.current) { const w = pointOnCanvas(e.clientX, e.clientY); presence.send(w.x, w.y); }
    if (mode === 'link' && linkFrom && !portDragRef.current) {
      const target = portTargetAt(e.clientX, e.clientY, linkFrom);
      const point = pointOnCanvas(e.clientX, e.clientY);
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const card = hit?.closest<HTMLElement>('[data-card]');
      // курсор над карточкой: предпросмотр липнет к её ближайшей точке (как и итоговая связь)
      const toAnchor = card?.dataset.card === target.target ? target.toAnchor : null;
      setLinkPointer({ point, target: target.target, toAnchor });
    }
    const g = gest.current;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved && Math.abs(dx) + Math.abs(dy) > 3) {
      g.moved = true;
      if (g.type === 'pan') setPanning(true);
    }
    if (!g.moved) return;
    if (g.type === 'pan') {
      setCam({ ...camRef.current, x: g.x + dx, y: g.y + dy });
      return;
    }
    const p = worldPt(e);
    const r = { x: Math.min(g.wx, p.x), y: Math.min(g.wy, p.y), w: Math.abs(p.x - g.wx), h: Math.abs(p.y - g.wy) };
    setMarquee(r);
    const hit = (x: number, y: number, w: number, h: number) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y;
    const hits = cardIds.filter((i) => hit(posOf(i).x, posOf(i).y, cardSize(i).w, cardSize(i).h));
    setSelCards([...new Set([...g.base, ...hits])]);
  };
  const rootUp = (e: React.PointerEvent<HTMLElement>) => {
    const g = gest.current;
    if (!g) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (g.type === 'marquee' && !g.moved && !e.shiftKey) {
      setSelCards([]);
      setSelLink(null);
    }
    gest.current = null;
    document.body.classList.remove('gesturing');
    setPanning(false);
    setMarquee(null);
  };

  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const [props, setProps] = useState<PropTarget | null>(null);
  const propsOpen = useRef(false);
  propsOpen.current = props !== null;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  /** где появятся новые карточки: как и положение по умолчанию, по порядку в своём столбце */
  const procPos = { x: 232, y: 60 + processes.length * (MODEL_SIZE.h + 48) };
  const docPos = docCell(docs.length);
  /** если будущие карточки за краем экрана, сдвигаем доску к ним */
  const revealDraft = () => {
    const r = ghostRect(procPos, docPos);
    const c = camRef.current;
    const vis = { l: -c.x / c.k, t: -c.y / c.k, r: (size.w - c.x) / c.k, b: (size.h - c.y) / c.k };
    if (r.left >= vis.l && r.right <= vis.r && r.top >= vis.t && r.bottom <= vis.b) return;
    const k = Math.min(c.k, (size.w - 120) / (r.right - r.left), (size.h - 220) / (r.bottom - r.top));
    setCam({ k, x: size.w / 2 - ((r.left + r.right) / 2) * k, y: (size.h - 120) / 2 - ((r.top + r.bottom) / 2) * k });
  };
  /** подвести камеру к карточке из чата */
  const draftBuilding = useDraftBuilding();
  const focusCard = (id: string) => {
    if (!cardIds.includes(id)) return;
    const p = posOf(id);
    const sz = cardSize(id);
    const c = camRef.current;
    const area = availableArea();
    const k = clampK(Math.min(c.k, area.w / sz.w, area.h / sz.h));
    setCam({ k, x: area.x + area.w / 2 - (p.x + sz.w / 2) * k, y: area.y + area.h / 2 - (p.y + sz.h / 2) * k });
  };


  const menuAt = useRef<Pos>({ x: 0, y: 0 });
  const openMenu: ContextOpener = (target, ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const r = root.current!.getBoundingClientRect();
    setMenu({ x: Math.min(ev.clientX - r.left, r.width - 210), y: Math.min(ev.clientY - r.top, r.height - 150), target });
    if (target.type === 'card') setSelCards([target.id]);
  };

  /** Новый шлюз: в точке клика или в центре видимой области (положение выбирает эффект новых карточек) */
  const addGateway = (at?: Pos) => {
    spawnAt.current = at ?? null;
    const id = 'g' + Math.random().toString(36).slice(2, 8);
    api.apply((m) => ({ ...m, gateways: [...m.gateways, { id, label: '' }] }));
    setSelCards([`gw:${id}`]);
  };

  /**
   * Модели, документы, шлюзы и источники убираются с доски; связи с ними удаляются вместе с ними.
   * Несколько карточек удаляются одним изменением: Ctrl+Z возвращает их все сразу.
   */
  const removeCards = (ids: string[]) => {
    if (!ids.length) return;
    const gone = new Set(ids);
    api.apply((m) => {
      let next = m;
      for (const id of ids) {
        const [kind, ...rest] = id.split(':');
        const key = rest.join(':');
        if (kind === 'proc') next = { ...next, processes: next.processes.filter((p) => p.id !== key), links: next.links.filter((l) => !l.nodeId.startsWith(`${key}:`)) };
        else if (kind === 'doc') {
          const secs = new Set(next.docs.find((d) => d.id === key)?.sections.map((s) => s.id));
          next = { ...next, docs: next.docs.filter((d) => d.id !== key), links: next.links.filter((l) => !secs.has(l.sectionId)) };
        } else if (kind === 'gw') next = { ...next, gateways: next.gateways.filter((g) => g.id !== key) };
        else if (kind === 'model') next = { ...next, models: next.models.filter((m) => m.id !== key) };
        else if (kind === 'html') next = { ...next, htmlObjects: next.htmlObjects.filter((h) => h.id !== key) };
        else next = { ...next, sources: next.sources.filter((s) => s.id !== key) };
      }
      return { ...next, cardLinks: next.cardLinks.filter((l) => !gone.has(l.from) && !gone.has(l.to)) };
    });
    setSelCards([]);
  };
  const removeCard = (id: string) => removeCards([id]);

  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    const t = menu.target;
    if (t.type === 'canvas')
      return [
        { label: 'Добавить шлюз', icon: 'plus', onClick: () => addGateway(menuAt.current) },
        {
          label: 'Добавить объект…',
          icon: 'plus',
          onClick: () => {
            spawnAt.current = menuAt.current;
            onAddMaterial();
          },
        },
      ];
    if (t.type === 'card' && t.id.startsWith('gw:')) return [{ label: 'Удалить с полотна', icon: 'trash', danger: true, onClick: () => removeCard(t.id) }];
    const items: MenuItem[] = t.type === 'card' && t.id.startsWith('model:') ? [] : [{ label: 'Свойства…', icon: 'sliders', onClick: () => setProps({ type: t.type as PropTarget['type'], id: t.id }) }];
    if (t.type === 'card' && t.id.startsWith('model:')) items.push({ label: 'Редактировать модель', icon: 'pencil', onClick: () => onEditModel(t.id.slice(6)) });
    if (t.type === 'card' && t.id.startsWith('proc:')) items.push({ label: 'Редактировать модель', icon: 'pencil', onClick: () => onEditProcess(t.id.slice(5)) });
    if (t.type === 'card' && t.id.startsWith('doc:')) items.push({ label: 'Редактировать документ', icon: 'pencil', onClick: () => onEditDoc(t.id.slice(4)) });
    if (t.type === 'card' && t.id.startsWith('html:')) items.push({ label: 'Редактировать HTML', icon: 'pencil', onClick: () => onEditHtml(t.id.slice(5)) });
    if (t.type === 'card') items.push({ sep: true }, { label: 'Удалить с полотна', icon: 'trash', danger: true, onClick: () => removeCard(t.id) });
    return items;
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement;
      if (pausedRef.current || propsOpen.current || el.closest('input,textarea,select,.dlg-backdrop,.bpmn-editor')) return;
      if (ev.code === 'Space' && !el.closest('button')) {
        ev.preventDefault();
        setSpace(true);
        return;
      }
      if ((ev.metaKey || ev.ctrlKey) && (ev.code === 'KeyZ' || ev.code === 'KeyY')) {
        ev.preventDefault();
        const active = linkGestureRef.current;
        linkGestureRef.current = null; setLinkGesture(null);
        if (active?.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer);
        if (ev.code === 'KeyY' || ev.shiftKey) api.redo();
        else api.undo();
        return;
      }
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.code === 'Equal' || ev.code === 'NumpadAdd') return zoomCenter(1.25);
      if (ev.code === 'Minus' || ev.code === 'NumpadSubtract') return zoomCenter(0.8);
      if (ev.code === 'Digit0') return fit();
      if (ev.code === 'Digit1') return setZoom(1);
      if (ev.key === 'Escape') {
        const active = linkGestureRef.current;
        linkGestureRef.current = null; setLinkGesture(null);
        if (active?.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer);
        setShowReconnect(false);
        const drag = portDragRef.current;
        portDragRef.current = null;
        setPortDrag(null);
        if (drag?.element.hasPointerCapture(drag.pointer)) drag.element.releasePointerCapture(drag.pointer);
        setSelCards([]);
        setSelLink(null);
        switchMode('select');
      } else if (ev.code === 'KeyL') switchMode('link');
      else if (ev.code === 'KeyG') switchMode('gateway');
      else if (ev.code === 'KeyV') switchMode('select');
      else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        // выделенная связь удаляется первой, иначе все выделенные карточки; поля ввода и окна отсеяны выше
        const cards = selCards.filter((id) => cardIds.includes(id));
        if (selLink) {
          ev.preventDefault();
          removeCardLink(selLink);
        } else if (cards.length) {
          ev.preventDefault();
          removeCards(cards);
        }
      }
    };
    const onUp = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') setSpace(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  });

  type Layer = { d: string; p1: Pos; p2: Pos; mid: Pos } | null;
  const [layer, setLayer] = useState<Layer>(null);
  const lastKey = useRef('');

  useLayoutEffect(() => {
    const el = world.current;
    if (!el) return;
    const wr = el.getBoundingClientRect();
    const k = camRef.current.k;
    const q = (v: number) => Math.round(v * 10) / 10;
    const rectOf = (node: Element) => {
      const r = node.getBoundingClientRect();
      return { left: q((r.left - wr.left) / k), right: q((r.right - wr.left) / k), top: q((r.top - wr.top) / k), height: q(r.height / k) };
    };
    let next: Layer = null;
    if (issue.model && issue.doc) {
      const { pid, elId } = splitRef(issue.model.nodeId);
      const nodeEl = el.querySelector(`[data-card="proc:${CSS.escape(pid)}"] [data-bpmn-id="${CSS.escape(elId)}"]`);
      const secEl = el.querySelector(`[data-anchor="section:${CSS.escape(issue.doc.sectionId)}"]`);
      const mc = nodeEl?.closest('[data-card]') ? rectOf(nodeEl.closest('[data-card]')!) : undefined;
      const dc = secEl?.closest('[data-card]') ? rectOf(secEl.closest('[data-card]')!) : undefined;
      const a = nodeEl ? rectOf(nodeEl) : undefined;
      const b = secEl ? rectOf(secEl) : undefined;
      if (a && b && mc && dc) {
        const p1 = { x: a.right, y: q(a.top + a.height / 2) };
        const p2 = { x: b.left, y: q(b.top + b.height / 2) };
        const gap = (mc.right + dc.left) / 2;
        const xm = gap > p1.x && gap < p2.x ? gap : (p1.x + p2.x) / 2;
        next = { d: `M${p1.x} ${p1.y} H${xm} V${p2.y} H${p2.x}`, p1, p2, mid: { x: p1.x + 10, y: p1.y - 30 } };
      }
    }
    const key = JSON.stringify(next);
    if (key !== lastKey.current) {
      lastKey.current = key;
      setLayer(next);
    }
  });

  const number = issues.findIndex((i) => i.id === issue.id) + 1;
  const issueNodeIds = issues.flatMap((i) => (i.model ? [i.model.nodeId] : []));
  const selectedLink = cardLinks.find((item) => item.id === selLink);
  const cardLabel = (id: string) => {
    if (id.startsWith('model:')) return models.find((item) => `model:${item.id}` === id)?.title ?? id;
    if (id.startsWith('proc:')) return processes.find((item) => `proc:${item.id}` === id)?.title ?? id;
    if (id.startsWith('doc:')) return docs.find((item) => `doc:${item.id}` === id)?.title ?? id;
    if (id.startsWith('html:')) return htmlObjects.find((item) => `html:${item.id}` === id)?.title ?? id;
    if (id.startsWith('src:')) return sources.find((item) => `src:${item.id}` === id)?.name ?? id;
    return gateways.find((item) => `gw:${item.id}` === id)?.label || 'Шлюз';
  };
  const preview = portDrag?.moved
    ? { from: portDrag.from, anchor: portDrag.fromAnchor, point: portDrag.point, target: portDrag.target, toAnchor: portDrag.toAnchor }
    : !portDrag && linkFrom && linkFromAnchor && linkPointer
      ? { from: linkFrom, anchor: linkFromAnchor, ...linkPointer }
      : null;
  const previewPoints = preview && (() => {
    const opposite: Record<CardSide, CardSide> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
    const attached = preview.target && preview.toAnchor;
    return routeAnchored(
      boxForLink(preview.from), preview.anchor.side, angleForLink(preview.from),
      attached ? boxForLink(preview.target!) : { ...preview.point, w: 0, h: 0 },
      attached ? preview.toAnchor!.side : opposite[preview.anchor.side], attached ? angleForLink(preview.target!) : 0,
      preview.anchor.offset, attached ? preview.toAnchor!.offset : 0.5,
      obstaclesFor(preview.from, attached ? preview.target : null),
    );
  })();

  const aiTools: AiToolHost = {
    snapshot: () => ({
      issues, settings: { grid: settings.grid, snap: settings.snap, minimap: settings.minimap, wheelZoom: settings.wheelZoom, aiModel: settings.aiModel },
      view: { x: camRef.current.x, y: camRef.current.y, zoom: camRef.current.k, width: size.w, height: size.h, safeArea: availableArea(), selectedIds: selCards, selectedLinkId: selLink ?? undefined, ...aiPanels, mode },
      canUndo: api.canUndo, canRedo: api.canRedo,
    }),
    execute: async (effect) => {
      const args = effect.arguments;
      switch (effect.tool) {
        case 'read_html_test': return testHtml(String(args.id), String(args.html), args.steps as HtmlTestStep[]);
        case 'set_view': {
          const result = await onAiWorkspaceEffect(effect);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          if (args.x !== undefined || args.y !== undefined || args.zoom !== undefined) setCam({ x: Number(args.x ?? camRef.current.x), y: Number(args.y ?? camRef.current.y), k: Number(args.zoom ?? camRef.current.k) });
          if (args.fit) await fit(args.chat !== true);
          if (typeof args.focusId === 'string') focusCard(args.focusId);
          if (Array.isArray(args.selectedIds)) { setSelCards(args.selectedIds as string[]); setSelLink(null); }
          if (args.mode) switchMode(args.mode as 'select' | 'link' | 'gateway');
          if (args.aiModel === '6.1-sol' || args.aiModel === '6.1-terra') onModel(args.aiModel);
          return result;
        }
        case 'open_editor': {
          const id = String(args.id), key = id.slice(id.indexOf(':') + 1);
          if (id.startsWith('model:')) onEditModel(key); else if (id.startsWith('proc:')) onEditProcess(key); else if (id.startsWith('doc:')) onEditDoc(key); else onEditHtml(key);
          return { ok: true, summary: 'Редактор объекта открыт', data: { id } };
        }
        case 'show_properties': setProps({ type: args.targetType as PropTarget['type'], id: String(args.id) }); return { ok: true, summary: 'Свойства открыты' };
        case 'select_issue': onSelect(String(args.id)); return { ok: true, summary: 'Замечание показано' };
        case 'history': {
          const restored = args.direction === 'undo' ? api.undo() : api.redo();
          if (!restored) return { ok: false, summary: 'Нет изменения для отмены или повтора', error: 'История содержит только пустые точки фокуса; данные не изменились' };
          return { ok: true, summary: args.direction === 'undo' ? 'Изменение отменено' : 'Изменение возвращено' };
        }
        case 'export_object': {
          const exported = exportCanvasObject(api.getModel(), String(args.id));
          const url = URL.createObjectURL(new Blob([exported.content], { type: `${exported.mime};charset=utf-8` }));
          const link = document.createElement('a'); link.href = url; link.download = exported.filename; link.click(); URL.revokeObjectURL(url);
          return { ok: true, summary: `Скачан файл «${exported.filename}»` };
        }
        default: return onAiWorkspaceEffect(effect);
      }
    },
  };

  return (
    <main
      className={`canvas${size.w < 1160 ? ' compact-controls' : ''}${panning ? ' panning' : ''}${space ? ' hand' : ''}${mode === 'link' ? ' linking' : ''}${mode === 'gateway' ? ' placing' : ''}`}
      ref={root}
      style={{
        backgroundSize: `${(cam.k < 0.5 ? 44 : 22) * cam.k}px ${(cam.k < 0.5 ? 44 : 22) * cam.k}px`,
        backgroundPosition: `${cam.x}px ${cam.y}px`,
        backgroundImage: settings.grid ? undefined : 'none',
      }}
      onPointerDownCapture={rootDownCapture}
      onPointerDown={rootDown}
      onPointerMove={rootMove}
      onPointerLeave={() => presence?.send(null, null)}
      onPointerUp={rootUp}
      onContextMenu={(e) => {
        if (e.target !== root.current && e.target !== world.current) return e.preventDefault();
        const w = worldPt(e as unknown as React.PointerEvent);
        openMenu({ type: 'canvas', id: '' }, e);
        menuAt.current = w;
      }}
    >
      <AiChat projectId={projectId} presence={presence} api={api} aiModel={settings.aiModel} onModel={onModel} onReveal={revealDraft} onFocusCard={focusCard} tools={aiTools} collapseRequest={chatCollapseRequest} />
      {cardIds.length === 0 && !draftBuilding && (
        <div className="canvas-empty">
          <b>Проект пуст</b>
          <span>Добавьте модель процесса, документ, HTML-объект или источник — они появятся на доске.</span>
          <button type="button" className="btn btn-dark" onClick={onAddMaterial}>Добавить объект</button>
        </div>
      )}
      <ZoomCtx.Provider value={cam.k}><LiveCtx.Provider value={liveIds}>
        <div ref={world} className="world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})` }}>
          <AiDraftLayer procPos={procPos} docPos={docPos} />
          {presence?.peers.filter((p) => p.x !== null && p.y !== null).map((p) => (
            <div key={p.id} className="peer-cursor" style={{ left: p.x!, top: p.y!, transform: `scale(${1 / cam.k})`, color: p.color }} aria-hidden="true">
              <svg width="18" height="20" viewBox="0 0 18 20"><path d="M1 1l6.5 17 2.4-7 7-2.4z" fill="currentColor" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/></svg>
              <span style={{ background: p.color }}>{p.name}</span>
            </div>
          ))}
          {sources.map((s, i) => (
            <DragCard
              key={s.id}
              id={`src:${s.id}`}
              pos={posOf(`src:${s.id}`)}
              onMove={move}
              onGrab={grab}
              onContext={openMenu}
              selected={selCards.includes(`src:${s.id}`)} {...linkProps(`src:${s.id}`, s.name)}
              className="file-card"
              style={{ transform: `rotate(${i % 2 ? 1.2 : -1.4}deg)` }}
              onEdit={() => setProps({ type: 'card', id: `src:${s.id}` })}
            >
              <FileCard source={s} active={issue.basis?.sourceId === s.id} />
            </DragCard>
          ))}

          {processes.map((p) => {
            const id = `proc:${p.id}`;
            const own = (ref: string) => (ref.startsWith(`${p.id}:`) ? ref.slice(p.id.length + 1) : undefined);
            return (
              <DragCard
                key={p.id}
                id={id}
                pos={posOf(id)}
                onMove={move}
                onGrab={grab}
                onContext={openMenu}
                selected={selCards.includes(id)}
                {...linkProps(id, p.title)}
                className="model-card"
                style={{ width: cardSize(id).w, height: cardSize(id).h }}
                onEdit={() => onEditProcess(p.id)}
                onResizeStart={startResize}
              >
                <ProcessCard
                  title={p.title}
                  xml={p.xml}
                  activeNodeId={issue.model ? own(issue.model.nodeId) : undefined}
                  issueNodeIds={issueNodeIds.flatMap((r) => own(r) ?? [])}
                  hasSteps={pnodes.some((n) => n.pid === p.id && isLinkable(n))}
                  onNode={(elId) => {
                    const owner = issues.find((i) => i.model?.nodeId === `${p.id}:${elId}`);
                    if (owner) onSelect(owner.id);
                  }}
                  onNodeContext={(elId, ev) => {
                    if (pnodes.some((n) => n.id === `${p.id}:${elId}`)) openMenu({ type: 'node', id: `${p.id}:${elId}` }, ev);
                  }}
                  onEdit={() => onEditProcess(p.id)}
                  onRendered={() => setAnchors((n) => n + 1)}
                />
              </DragCard>
            );
          })}

          {models.map((m) => {
            const id = `model:${m.id}`;
            return <DragCard key={id} id={id} pos={posOf(id)} onMove={move} onGrab={grab} onContext={openMenu} selected={selCards.includes(id)} {...linkProps(id, m.title)} className="model-card" style={{ width: cardSize(id).w, height: cardSize(id).h }} onEdit={() => onEditModel(m.id)} onResizeStart={startResize}>
              <div className="model-head"><Icon name="model" size={18} /><b>{m.title}</b><span className="tag">{m.notation}</span><div className="grow" /><button type="button" className="icon-btn edit-btn" aria-label={`Редактировать модель: ${m.title}`} onClick={() => onEditModel(m.id)}><Icon name="pencil" size={17} /></button></div>
              <IndependentModelPreview model={m} />
            </DragCard>;
          })}
          {docs.map((d) => {
            const id = `doc:${d.id}`;
            return (
              <DragCard
                key={d.id}
                id={id}
                pos={posOf(id)}
                onMove={move}
                onGrab={grab}
                onContext={openMenu}
                selected={selCards.includes(id)}
                {...linkProps(id, d.title)}
                className="doc-card"
                style={{ width: cardSize(id).w, height: cardSize(id).h }}
                onEdit={() => onEditDoc(d.id)}
                onResizeStart={startResize}
              >
                <DocCard doc={d} issue={issue} issues={issues} onSelect={onSelect} onContext={openMenu} onEdit={() => onEditDoc(d.id)} meta={api.model.meta} />
              </DragCard>
            );
          })}

          {htmlObjects.map((h) => {
            const id = `html:${h.id}`;
            return <DragCard key={h.id} id={id} pos={posOf(id)} onMove={move} onGrab={grab} onContext={openMenu} selected={selCards.includes(id)} {...linkProps(id, h.title)} className="html-card" style={{ width: cardSize(id).w, height: cardSize(id).h }} onEdit={() => onEditHtml(h.id)} onResizeStart={startResize}>
              <div className="model-head">
                <Icon name="code" size={18} /><b>{h.title}</b><span className="tag">HTML</span><div className="grow" />
                <button type="button" className="icon-btn edit-btn" title="Редактировать HTML" aria-label={`Редактировать HTML: ${h.title}`} onClick={() => onEditHtml(h.id)}><Icon name="pencil" size={17} /></button>
              </div>
              <HtmlPreview html={h.html} title={h.title} />
            </DragCard>;
          })}

          {gateways.map((g) => {
            const id = `gw:${g.id}`;
            return (
              <DragCard
                key={g.id}
                id={id}
                pos={posOf(id)}
                onMove={move}
                onGrab={grab}
                onContext={openMenu}
                selected={selCards.includes(id)}
                {...linkProps(id, g.label || 'Шлюз')}
                className="gateway-card"
                style={{ width: cardSize(id).w, height: cardSize(id).h }}
                onResizeStart={startResize}
              >
                <svg className="gw-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <polygon points="50,2 98,50 50,98 2,50" vectorEffect="non-scaling-stroke" />
                </svg>
                <input
                  className="gw-label"
                  data-nodrag
                  value={g.label}
                  placeholder="Шлюз"
                  aria-label="Название шлюза"
                  onFocus={() => api.checkpoint()}
                  onChange={(e) => api.applyLive((m) => ({ ...m, gateways: m.gateways.map((x) => (x.id === g.id ? { ...x, label: e.target.value } : x)) }))}
                />
              </DragCard>
            );
          })}

          {previewPoints && <svg className="card-link-preview" aria-hidden="true">
            <defs><marker id="cl-preview-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#2563eb" /></marker></defs>
            <path d={previewPoints.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')} className="clink on" markerEnd="url(#cl-preview-arrow)" />
          </svg>}
          {guideRef.current.map((g, i) => (
            <i
              key={i}
              className="snap-guide"
              style={g.v ? { left: g.at, top: g.from, width: 1 / cam.k, height: g.to - g.from } : { left: g.from, top: g.at, height: 1 / cam.k, width: g.to - g.from }}
            />
          ))}

          {cardLinks.length > 0 && (
            <svg className="card-link-layer">
              <defs>
                {[['cl-grey', '#7b8090'], ['cl-blue', '#2563eb']].map(([id, color]) => (
                  <marker key={id} id={id} viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
                    <path d="M0 0 L8 4 L0 8z" fill={color} />
                  </marker>
                ))}
              </defs>
              {cardLinks.map((l) => {
                const pts = pointsForLink(l);
                if (pts.length < 2) return null;
                const visible = linkGesture?.link.id === l.id && linkGesture.moved ? linkGesture.draft : pts;
                const d = visible.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
                const on = selLink === l.id;
                const handleEvents = (kind: LinkGesture['kind'], index: number) => ({
                  onPointerDown: (e: React.PointerEvent<SVGCircleElement>) => beginLinkGesture(l, kind, index, e),
                  onPointerMove: moveLinkGesture,
                  onPointerUp: (e: React.PointerEvent<SVGCircleElement>) => endLinkGesture(e),
                  onPointerCancel: (e: React.PointerEvent<SVGCircleElement>) => endLinkGesture(e, true),
                  onLostPointerCapture: (e: React.PointerEvent<SVGCircleElement>) => endLinkGesture(e, true),
                });
                return (
                  <g key={l.id}>
                    <path d={d} className={`clink${on ? ' on' : ''}`} markerEnd={`url(#${on ? 'cl-blue' : 'cl-grey'})`} />
                    <path
                      d={d}
                      className="clink-hit"
                      role="button" tabIndex={0} aria-label={`Выбрать связь${l.label ? `: ${l.label}` : ''}`}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        setSelLink(l.id);
                        setSelCards([]);
                        beginLinkGesture(l, 'segment', nearestRouteSegment(pts, pointOnCanvas(e.clientX, e.clientY)), e);
                      }}
                      onPointerMove={moveLinkGesture}
                      onPointerUp={(e) => endLinkGesture(e)}
                      onPointerCancel={(e) => endLinkGesture(e, true)}
                      onLostPointerCapture={(e) => endLinkGesture(e, true)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setSelLink(l.id); setSelCards([]); } }}
                      onDoubleClick={() => setEditLink(l.id)}
                    />
                    {on && pts.map((a, i) => {
                      const b = pts[i + 1];
                      if (!b || Math.hypot(b.x - a.x, b.y - a.y) < 28 / cam.k) return null;
                      const horizontal = Math.abs(a.y - b.y) < Math.abs(a.x - b.x);
                      const active = linkGesture?.link.id === l.id && linkGesture.kind === 'segment' && linkGesture.index === i && linkGesture.moved;
                      const dx = active && !horizontal ? linkGesture.delta : 0;
                      const dy = active && horizontal ? linkGesture.delta : 0;
                      return <circle key={`segment-${i}`} className={`clink-handle segment ${horizontal ? 'horizontal' : 'vertical'}`} cx={(a.x + b.x) / 2 + dx} cy={(a.y + b.y) / 2 + dy} r={5 / cam.k}
                        role="button" tabIndex={0} aria-label={`Переместить участок связи ${i + 1}`} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight" {...handleEvents('segment', i)}
                        onKeyDown={(e) => {
                          const amount = e.shiftKey ? 20 : 5;
                          const delta = horizontal ? (e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0) : (e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0);
                          if (!delta) return;
                          e.preventDefault(); e.stopPropagation();
                          commitLink({ ...l, routePoints: simplifyRoute(moveRouteSegment(pts, i, delta)).slice(1, -1) });
                        }}><title>Перетащите участок связи</title></circle>;
                    })}
                    {on && (['from', 'to'] as const).map((end) => {
                      const active = linkGesture?.link.id === l.id && linkGesture.kind === end && linkGesture.moved;
                      const path = active ? linkGesture.draft : pts;
                      const point = end === 'from' ? path[0] : path[path.length - 1];
                      if (!point) return null;
                      return <circle key={end} className="clink-handle endpoint" cx={point.x} cy={point.y} r={7 / cam.k} role="button" tabIndex={0}
                        aria-label={end === 'from' ? 'Переподключить начало связи' : 'Переподключить конец связи'}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setShowReconnect(true); } }} {...handleEvents(end, 0)}><title>Перетащите для переподключения</title></circle>;
                    })}
                  </g>
                );
              })}
            </svg>
          )}
          {cardLinks.map((l) => {
            const pts = pointsForLink(l);
            if (pts.length < 2) return null;
            const m = labelSpot(pts);
            if (editLink === l.id)
              return (
                <input
                  key={l.id}
                  autoFocus
                  className="clink-input"
                  style={{ left: m.x - 70, top: m.y - 16 }}
                  defaultValue={l.label}
                  aria-label="Подпись связи"
                  placeholder="Подпись"
                  onPointerDown={(e) => e.stopPropagation()}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    setLinkLabel(l.id, e.currentTarget.value.trim());
                    setEditLink(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setEditLink(null);
                  }}
                />
              );
            return l.label ? (
              <span key={l.id} className={`clink-label${selLink === l.id ? ' on' : ''}`} style={{ left: m.x, top: m.y }} onDoubleClick={() => setEditLink(l.id)}>
                {l.label}
              </span>
            ) : null;
          })}

          {layer && (
            <svg className="link-layer" aria-hidden="true">
              <path d={layer.d} className="link" />
              <circle cx={layer.p1.x} cy={layer.p1.y} r="5" className="link-dot" />
              <circle cx={layer.p2.x} cy={layer.p2.y} r="6" className="link-dot" />
            </svg>
          )}
          {layer && (
            <div className="link-pill" style={{ left: layer.mid.x, top: layer.mid.y }}>
              Замечание № {number}
            </div>
          )}

          {marquee && (
            <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: 1 / cam.k }} />
          )}
        </div>
      </LiveCtx.Provider></ZoomCtx.Provider>

      {settings.minimap && (
        <Minimap
          pos={Object.fromEntries(cardIds.map((i) => [i, posOf(i)]))}
          sizes={Object.fromEntries(cardIds.map((i) => [i, cardSize(i)]))}
          cam={cam}
          size={size}
          onJump={(x, y) => setCam({ ...cam, x: size.w / 2 - x * cam.k, y: size.h / 2 - y * cam.k })}
        />
      )}
      <ZoomControls k={cam.k} onIn={() => zoomCenter(1.25)} onOut={() => zoomCenter(0.8)} onReset={() => setZoom(1)} onFit={() => { void fit(); }} />

      {(
        <div className="tools" role="toolbar" aria-label="Режим доски">
          {cardIds.length > 1 && (
            <>
          <button type="button" className={`tool-btn${mode === 'select' ? ' on' : ''}`} aria-label="Выбор" aria-pressed={mode === 'select'} title="Выбор (V)" onClick={() => switchMode('select')}>
            <Icon name="cursor" size={17} stroke={1.9} />
          </button>
          <button type="button" className={`tool-btn${mode === 'link' ? ' on' : ''}`} aria-label="Связь между карточками" aria-pressed={mode === 'link'} title="Связь между карточками (L)" onClick={() => switchMode('link')}>
            <Icon name="connect" size={17} stroke={1.9} />
          </button>
            </>
          )}
          {cardIds.length > 1 && <span className="tools-sep" />}
          <button type="button" className={`tool-btn${mode === 'gateway' ? ' on' : ''}`} aria-label="Шлюз" aria-pressed={mode === 'gateway'} title="Шлюз (G): нажмите, затем кликните по полотну" onClick={() => switchMode(mode === 'gateway' ? 'select' : 'gateway')}>
            <Icon name="gateway" size={17} stroke={1.9} />
          </button>
          <button type="button" className="tool-btn" aria-label="Шаг назад" title="Шаг назад (Ctrl+Z)" disabled={!api.canUndo} onClick={api.undo}>
            <Icon name="undo" size={17} stroke={1.9} />
          </button>
          <button type="button" className="tool-btn" aria-label="Шаг вперёд" title="Шаг вперёд (Ctrl+Shift+Z)" disabled={!api.canRedo} onClick={api.redo}>
            <Icon name="redo" size={17} stroke={1.9} />
          </button>
          {linkFailure && <span className="tools-hint" role="status">{linkFailure}</span>}
          {selectedLink && pointsForLink(selectedLink).length < 2 && <span className="tools-hint" role="status">Для связи нет свободного маршрута. Передвиньте объекты.</span>}
          {mode === 'gateway' && <span className="tools-hint">Кликните по полотну, куда поставить шлюз</span>}
          {mode === 'link' && (
            <span className="tools-hint">{linkFrom ? 'Выберите карточку, куда ведёт связь' : 'Выберите карточку, откуда идёт связь'}</span>
          )}
          {selLink && mode === 'select' && (
            <>
              <span className="tools-sep" />
              <button type="button" className="tool-text" onClick={() => setEditLink(selLink)}>Подпись</button>
              <button type="button" className="tool-text" aria-expanded={showReconnect} onClick={() => setShowReconnect((open) => !open)}>Переподключить</button>
              {selectedLink?.routePoints?.length ? <button type="button" className="tool-text" onClick={() => commitLink({ ...selectedLink, routePoints: undefined })}>Сбросить маршрут</button> : null}
              <button type="button" className="tool-btn" aria-label="Удалить связь" title="Удалить (Del)" onClick={() => removeCardLink(selLink)}>
                <Icon name="trash" size={17} stroke={1.9} />
              </button>
              {showReconnect && selectedLink && <div className="clink-reconnect" role="group" aria-label="Переподключение связи">
                {(['from', 'to'] as const).map((end) => <label key={end}>{end === 'from' ? 'Начало' : 'Конец'}
                  <select className="pinput" value={selectedLink[end]} onChange={(e) => {
                    const points = pointsForLink(selectedLink);
                    const oldPoint = end === 'from' ? points[0] : points[points.length - 1];
                    const next = reconnectLink(selectedLink, end, e.target.value, anchorAt(e.target.value, oldPoint ?? posOf(e.target.value)));
                    if (next) commitLink(next);
                  }}>
                    {cardIds.map((id) => {
                      const from = end === 'from' ? id : selectedLink.from;
                      const to = end === 'to' ? id : selectedLink.to;
                      const unavailable = from === to || cardLinks.some((link) => link.id !== selectedLink.id && link.from === from && link.to === to);
                      return <option key={id} value={id} disabled={unavailable}>{cardLabel(id)}</option>;
                    })}
                  </select>
                </label>)}
              </div>}
            </>
          )}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}
      {props && <PropertiesDialog target={props} api={api} issues={issues} onClose={() => setProps(null)} onSelectIssue={onSelect} />}
      <span hidden data-anchors={anchors} />
    </main>
  );
}
