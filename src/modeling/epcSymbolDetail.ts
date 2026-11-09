import { createElement } from 'react';
import type { DiagramSymbol } from './types';

/** Самостоятельные пиктограммы EPC: не являются ресурсами пресета SILA. */
const paths: Record<string, string> = {
  function: 'M4 5l7 7-7 7z M12 5l7 7-7 7z', event: 'M6 20V4 M6 5h11l-2 4 2 4H6',
  'process-interface': 'M4 5h11l5 7-5 7H4z M9 8h5 M9 12h5 M9 16h3',
  role: 'M12 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M5 20c0-5 3-8 7-8s7 3 7 8 M3 21h18',
  position: 'M6 5h12v6H6z M9 11v8l3-2 3 2v-8 M9 8h6',
  organization: 'M4 20h16 M6 20V9h12v11 M9 9V5h6v4 M9 13h2 M14 13h2 M9 17h2 M14 17h2',
  application: 'M3 5h18v14H3z M3 9h18 M6 7h1 M8 7h1 M7 13h10 M7 16h7',
  document: 'M6 3h9l4 4v14H6z M15 3v5h4 M9 12h7 M9 15h7 M9 18h5',
  data: 'M4 6c0-3 16-3 16 0v12c0 3-16 3-16 0z M4 6c0 3 16 3 16 0 M4 12c0 3 16 3 16 0',
  group: 'M9 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M16 7a2.5 2.5 0 1 1 0 5 M3 20c0-4 2-7 6-7s6 3 6 7 M15 14c4 0 6 2 6 6',
  'internal-employee': 'M12 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M5 20c0-5 3-8 7-8s7 3 7 8 M10 13l2 3 2-3 M12 16v4',
  'external-employee': 'M10 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M3 20c0-5 3-8 7-8s6 3 6 8 M17 10h5 M20 7l3 3-3 3',
  screen: 'M3 4h18v13H3z M8 21h8 M12 17v4 M6 8h12 M6 11h8',
  'digital-document': 'M5 3h10l4 4v14H5z M15 3v5h4 M8 12l2-2 2 2-2 2z M14 11h2 M14 15h2 M8 18h8',
  file: 'M5 3h10l4 4v14H5z M15 3v5h4', email: 'M3 6h18v12H3z M3 7l9 7 9-7 M3 18l6-6 M21 18l-6-6',
  'technical-term': 'M3 8h11l6 4-6 4H3z M7 11h3 M7 14h5', product: 'M12 3l8 4v10l-8 4-8-4V7z M4 7l8 4 8-4 M12 11v10',
  goal: 'M5 21V3 M5 4h13l-3 4 3 4H5 M3 21h7', kpi: 'M4 20h17 M6 17v-4h3v4 M11 17V9h3v8 M16 17V5h3v12',
  risk: 'M12 3l10 18H2z M12 9v5 M12 17v1', control: 'M4 7h16 M4 12h16 M4 17h16 M8 5v4 M16 10v4 M10 15v4',
};

export function renderEpcSymbolDetail(symbol: DiagramSymbol) {
  const path = paths[symbol.appearance?.icon ?? ''];
  return path ? createElement('path', { d: path, fill: 'none', stroke: symbol.appearance?.textColor, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }) : null;
}
