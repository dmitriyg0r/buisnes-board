import type { ConnectionAppearance } from './types';

export function connectionStroke(appearance: ConnectionAppearance, scope: string) {
  const url = (id: string) => `url(#${scope}-${id})`;
  const start = appearance.startMarker ?? (appearance.arrowStart ? 'open' : undefined);
  const end = (appearance.arrowEnd ?? (appearance.lineStyle !== 'dotted'))
    ? (appearance.arrowStyle ?? (appearance.lineStyle === 'dotted' ? 'open' : 'filled')) : undefined;
  return {
    strokeDasharray: appearance.lineStyle === 'dotted' ? '2 5' : appearance.lineStyle === 'dashed' ? '6 4' : undefined,
    strokeLinecap: appearance.lineStyle === 'dotted' ? 'round' as const : undefined,
    markerStart: start ? url(start) : undefined,
    markerEnd: end ? url(end) : undefined,
  };
}

/** Общие маркеры для полотна редактора, меню и предпросмотра на доске. */
export function ConnectionMarkers({ scope, color = '#424858' }: { scope: string; color?: string }) {
  return <defs>
    <marker id={`${scope}-circle`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><circle cx="5" cy="5" r="4" fill="white" stroke={color} strokeWidth="1.3" /></marker>
    <marker id={`${scope}-circle-filled`} viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto"><circle cx="5" cy="5" r="3.5" fill={color} /></marker>
    <marker id={`${scope}-open`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke={color} strokeWidth="1.3" /></marker>
    <marker id={`${scope}-half-open`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1 L9 5" fill="none" stroke={color} strokeWidth="1.3" /></marker>
    <marker id={`${scope}-filled`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill={color} /></marker>
    <marker id={`${scope}-triangle`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" orient="auto"><path d="M1 1 L9 5 L1 9 Z" fill="white" stroke={color} strokeWidth="1" /></marker>
    <marker id={`${scope}-diamond`} viewBox="0 0 12 10" refX="1" refY="5" markerWidth="12" markerHeight="10" orient="auto"><path d="M1 5 L6 1 L11 5 L6 9 Z" fill="white" stroke={color} strokeWidth="1" /></marker>
    <marker id={`${scope}-diamond-filled`} viewBox="0 0 12 10" refX="1" refY="5" markerWidth="12" markerHeight="10" orient="auto"><path d="M1 5 L6 1 L11 5 L6 9 Z" fill={color} stroke={color} strokeWidth="1" /></marker>
  </defs>;
}
