import type { SVGProps } from 'react';
import type { EventSymbol } from './bpmnEvents';

/** Только внутренний маркер; окружности события рисует вызывающая сторона. */
export interface BpmnEventGlyphProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> {
  symbol: Pick<EventSymbol, 'marker' | 'filled'>;
  /** Цвет деталей на залитом маркере; должен совпадать с фоном события. */
  backgroundColor?: string;
}

/** Координаты и размеры задаются в системе координат родительского SVG. */
export function BpmnEventGlyph({ symbol, backgroundColor = 'white', color = 'currentColor', ...props }: BpmnEventGlyphProps) {
  const { marker, filled } = symbol;
  const fill = filled ? color : 'none';
  const line = { stroke: color, strokeWidth: 1.5, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

  let glyph;
  switch (marker) {
    case 'none':
      return null;
    case 'message':
      glyph = <><rect x="3" y="6" width="18" height="12" fill={fill} {...line} /><path d="M3.5 6.5 12 13l8.5-6.5" fill="none" {...line} stroke={filled ? backgroundColor : color} /></>;
      break;
    case 'timer':
      glyph = <><circle cx="12" cy="12" r="8.5" fill="none" {...line} /><path d="M12 5v1.5M19 12h-1.5M12 19v-1.5M5 12h1.5M12 7.5V12l3.5 2" fill="none" {...line} /></>;
      break;
    case 'signal':
      glyph = <path d="M12 3 21 20H3Z" fill={fill} {...line} />;
      break;
    case 'error':
      glyph = <path d="M14 2 5 13h6l-1 9 9-12h-6Z" fill={fill} {...line} />;
      break;
    case 'escalation':
      glyph = <path d="M12 3 21 20 12 15 3 20Z" fill={fill} {...line} />;
      break;
    case 'conditional':
      glyph = <><path d="M5 3h14v18H5Z" fill="none" {...line} /><path d="M8 7h8M8 10h8M8 13h8M8 16h6" fill="none" {...line} /></>;
      break;
    case 'link':
      glyph = <path d="M3 8h10V4l8 8-8 8v-4H3Z" fill={fill} {...line} />;
      break;
    case 'cancel':
      glyph = <path d="m5 3 7 6 7-6 2 2-6 7 6 7-2 2-7-6-7 6-2-2 6-7-6-7Z" fill={fill} {...line} />;
      break;
    case 'compensate':
      glyph = <><path d="M12 4 3 12l9 8Z" fill={fill} {...line} /><path d="m21 4-9 8 9 8Z" fill={fill} {...line} /></>;
      break;
    case 'terminate':
      glyph = <circle cx="12" cy="12" r="8" fill={color} />;
      break;
    case 'multiple':
      glyph = <path d="m12 3 8.6 6.3-3.3 10.1H6.7L3.4 9.3Z" fill={fill} {...line} />;
      break;
  }

  return <svg x="0" y="0" width="24" height="24" {...props} viewBox="0 0 24 24" color={color} overflow="visible">{glyph}</svg>;
}
