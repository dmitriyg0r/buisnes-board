import type { ReactNode } from 'react';

/** Независимое от нотации представление диаграммы для редактора. */
export interface DiagramPoint { x: number; y: number }
export interface DiagramBounds extends DiagramPoint { width: number; height: number }
export interface DiagramNode {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  labelBounds?: DiagramBounds;
  compartments?: { attributes: string[]; operations: string[] };
}
export interface DiagramEdge {
  id: string;
  type: string;
  label: string;
  ends?: { from: { role: string; multiplicity: string }; to: { role: string; multiplicity: string } };
  stereotype?: string;
  from: string;
  to: string;
  points: DiagramPoint[];
  labelBounds?: DiagramBounds;
  lineStyle?: 'solid' | 'dotted' | 'dashed';
  startMarker?: 'circle' | 'diamond' | 'diamond-filled';
  arrowStyle?: 'open' | 'filled' | 'triangle';
  arrowStart?: boolean;
  arrowEnd?: boolean;
  labelEditable?: boolean;
  routeEditable?: boolean;
}
/** Область фоновой разметки; семантика и редактирование принадлежат нотации. */
export interface DiagramRegion { kind?: 'lane' | 'pool'; id: string; label: string; x: number; y: number; width: number; height: number; rowCount?: number }
export interface Diagram { nodes: DiagramNode[]; edges: DiagramEdge[]; regions?: DiagramRegion[] }
/** Дополнительный режим связей, привязанных к позициям на временных линиях. */
export interface DiagramTimeline {
  project: (source: string) => {
    lifelines: { id: string; lineStart: DiagramPoint; lineEnd: DiagramPoint }[];
    messages: { id: string; label: string; kind: string; points: DiagramPoint[]; send: { lifelineId: string; y: number }; receive: { lifelineId: string; y: number }; lineStyle: 'solid' | 'dashed'; arrowStyle: 'open' | 'filled' }[];
  };
  addMessage: (source: string, from: string, to: string, y: number, type?: string) => string;
  moveMessage: (source: string, id: string, sendY: number, receiveY: number) => string;
  editMessage?: (source: string, id: string, changes: { kind?: string; from?: string; to?: string }) => string;
}
export type DiagramShape = 'circle' | 'double-circle' | 'rounded-rectangle' | 'diamond' | 'document' | 'annotation' | 'data-store' | 'rectangle' | 'ellipse' | 'actor' | 'bar' | 'hexagon' | 'lifeline' | 'circle-cross' | 'class-box' | 'pointed-right';
export interface DiagramSymbol {
  type: string;
  title: string;
  shape: DiagramShape;
  stereotype?: string;
  /** Цвет и расположение подписи задаются нотацией, не данными модели. */
  appearance?: { fill: string; stroke: string; labelInside?: boolean; emptyLabel?: string; textColor?: string; icon?: string };
  glyph?: 'person' | 'service' | 'cross' | 'plus' | 'manual' | 'send' | 'receive' | 'business-rule' | 'script' | 'inclusive' | 'complex' | 'event-based-exclusive' | 'collapsed-subprocess' | 'xor' | 'or' | 'filled';
  /** Данные маркера нотации для её собственного рендерера. */
  detail?: { marker: string; filled: boolean };
  outline?: 'single' | 'double' | 'thick';
  group?: string;
  width: number;
  height: number;
  /** Для фигур с ограниченным числом точек на каждой стороне. */
  singleConnectionPortPerSide?: boolean;
}
/** Нотация отвечает за формат и правила, движок — за взаимодействие и отрисовку. */
export interface DiagramNotation {
  id: string;
  title: string;
  fileExtension: string;
  fileAccept: string;
  mimeType: string;
  symbols: DiagramSymbol[];
  timeline?: DiagramTimeline;
  /** Рисует маркер в координатах 0..24; движок масштабирует его одинаково в палитре и узле. */
  renderSymbolDetail?: (symbol: DiagramSymbol) => ReactNode;
  connectionTypes?: { id: string; title: string; stereotype?: string; appearance?: { lineStyle?: 'solid' | 'dotted' | 'dashed'; startMarker?: 'circle' | 'diamond' | 'diamond-filled'; arrowStart?: boolean; arrowEnd?: boolean; arrowStyle?: 'open' | 'filled' | 'triangle' } }[];
  read: (source: string) => { diagram: Diagram; readOnlyReason?: string };
  validateDiagram?: (diagram: Diagram) => { id: string; message: string }[];
  addNode: (source: string, type: string, at: DiagramPoint) => string;
  regionTitle?: string;
  regionPlacementSize?: { width: number; height: number };
  poolPlacementSize?: { width: number; height: number };
  addRegion?: (source: string, at: DiagramPoint) => string;
  addPool?: (source: string, at: DiagramPoint) => string;
  resizeRegion?: (source: string, id: string, width: number, height: number) => string;
  moveRegion?: (source: string, id: string, at: DiagramPoint) => string;
  setRegionRows?: (source: string, id: string, count: number) => string;
  resizeNode?: (source: string, id: string, width: number, height: number) => string;
  setLabelBounds?: (source: string, id: string, bounds: DiagramBounds) => string;
  setNodeCompartments?: (source: string, id: string, sections: { attributes: string[]; operations: string[] }) => string;
  setEdgeEnds?: (source: string, id: string, ends: NonNullable<DiagramEdge['ends']>) => string;
  edgeEndProperties?: (edge: DiagramEdge) => boolean;
  moveNode: (source: string, id: string, at: DiagramPoint) => string;
  rename: (source: string, id: string, name: string) => string;
  connect: (source: string, from: string, to: string, type?: string) => string;
  editEdge: (source: string, id: string, from: string, to: string, points: DiagramPoint[]) => string;
  resetEdge: (source: string, id: string) => string;
  remove: (source: string, id: string) => string;
}
