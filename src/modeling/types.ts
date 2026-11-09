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
}
export interface DiagramEdge {
  id: string;
  type: string;
  label: string;
  from: string;
  to: string;
  points: DiagramPoint[];
  labelBounds?: DiagramBounds;
  lineStyle?: 'solid' | 'dotted' | 'dashed';
  startMarker?: 'circle';
  arrowStyle?: 'open' | 'filled';
  arrowStart?: boolean;
  arrowEnd?: boolean;
  labelEditable?: boolean;
  routeEditable?: boolean;
}
/** Область фоновой разметки; семантика и редактирование принадлежат нотации. */
export interface DiagramRegion { kind?: 'lane' | 'pool'; id: string; label: string; x: number; y: number; width: number; height: number; rowCount?: number }
export interface Diagram { nodes: DiagramNode[]; edges: DiagramEdge[]; regions?: DiagramRegion[] }
export type DiagramShape = 'circle' | 'double-circle' | 'rounded-rectangle' | 'diamond' | 'document' | 'annotation' | 'data-store';
export interface DiagramSymbol {
  type: string;
  title: string;
  shape: DiagramShape;
  glyph?: 'person' | 'service' | 'cross' | 'plus' | 'manual' | 'send' | 'receive' | 'business-rule' | 'script' | 'inclusive' | 'complex' | 'event-based-exclusive' | 'collapsed-subprocess';
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
  /** Рисует маркер в координатах 0..24; движок масштабирует его одинаково в палитре и узле. */
  renderSymbolDetail?: (symbol: DiagramSymbol) => ReactNode;
  connectionTypes?: { id: string; title: string; appearance?: { lineStyle?: 'solid' | 'dotted' | 'dashed'; startMarker?: 'circle'; arrowStart?: boolean; arrowEnd?: boolean; arrowStyle?: 'open' | 'filled' } }[];
  read: (source: string) => { diagram: Diagram; readOnlyReason?: string };
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
  moveNode: (source: string, id: string, at: DiagramPoint) => string;
  rename: (source: string, id: string, name: string) => string;
  connect: (source: string, from: string, to: string, type?: string) => string;
  editEdge: (source: string, id: string, from: string, to: string, points: DiagramPoint[]) => string;
  resetEdge: (source: string, id: string) => string;
  remove: (source: string, id: string) => string;
}
