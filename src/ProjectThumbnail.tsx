import { useEffect, useMemo, useState } from 'react';
import { DOC_SIZE, GATEWAY_SIZE, HTML_SIZE, MODEL_SIZE, SOURCE_SIZE, type Model } from './data';
import { normalizeModel } from './normalize';
import { loadView } from './viewState';

type Card = { id: string; title: string; kind: 'src' | 'proc' | 'doc' | 'html' | 'gw'; x: number; y: number; w: number; h: number; details: string[]; xml?: string };
type Result = { projectId: string; model?: Model; error?: boolean };

/** Миниатюра доски проекта. Размер задаётся родительским контейнером. */
export function ProjectThumbnail({ projectId, className }: { projectId: string; className?: string }) {
  const [result, setResult] = useState<Result>();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/projects/${encodeURIComponent(projectId)}/model`, { signal: controller.signal, credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 401) window.dispatchEvent(new Event('bb:unauthorized'));
          throw new Error('Не удалось загрузить проект');
        }
        const dto = await response.json() as { data?: Partial<Model> };
        if (!dto.data || typeof dto.data !== 'object') throw new Error('Некорректная модель');
        return normalizeModel(dto.data);
      })
      .then((model) => { if (!controller.signal.aborted) setResult({ projectId, model }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ projectId, error: true }); });
    return () => controller.abort();
  }, [projectId]);

  const model = result?.projectId === projectId ? result.model : undefined;
  const cards = useMemo(() => {
    if (!model) return [];
    const view = loadView(projectId);
    const out: Card[] = [];
    const add = (id: string, title: string, kind: Card['kind'], index: number, details: string[], xml?: string) => {
      if (out.length >= 80) return;
      const size = kind === 'proc' ? MODEL_SIZE : kind === 'doc' ? DOC_SIZE : kind === 'html' ? HTML_SIZE : kind === 'gw' ? GATEWAY_SIZE : SOURCE_SIZE;
      const fallback = kind === 'proc' ? { x: 232, y: 60 + index * (MODEL_SIZE.h + 48) }
        : kind === 'doc' ? { x: 232 + MODEL_SIZE.w + 48, y: 120 + index * (DOC_SIZE.h + 48) }
        : kind === 'html' ? { x: 232, y: 120 + model.processes.length * (MODEL_SIZE.h + 48) + Math.ceil(model.docs.length / 3) * (DOC_SIZE.h + 48) + index * (HTML_SIZE.h + 48) }
        : kind === 'gw' ? { x: 232 + (index % 4) * (GATEWAY_SIZE.w + 24), y: 20 }
        : { x: 16 + (index % 2) * 12, y: 120 + index * (SOURCE_SIZE.h + 74) };
      const saved = view?.pos[id];
      const savedSize = view?.sizes?.[id];
      const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000000;
      out.push({ id, title: String(title || '').slice(0, 80), kind,
        x: valid(saved?.x) ? saved.x : fallback.x, y: valid(saved?.y) ? saved.y : fallback.y,
        w: valid(savedSize?.w) && savedSize.w > 0 && savedSize.w <= 2400 ? savedSize.w : size.w,
        h: valid(savedSize?.h) && savedSize.h > 0 && savedSize.h <= 2400 ? savedSize.h : size.h,
        details, xml });
    };
    model.sources.slice(0, 80).forEach((s, i) => add(`src:${s.id}`, s.name, 'src', i, [s.ext]));
    model.processes.slice(0, 80).forEach((p, i) => add(`proc:${p.id}`, p.title, 'proc', i, [], p.xml));
    model.docs.slice(0, 80).forEach((d, i) => add(`doc:${d.id}`, d.title, 'doc', i, d.sections.slice(0, 5).map((s) => String(s.title || '').slice(0, 50))));
    model.htmlObjects.slice(0, 80).forEach((h, i) => add(`html:${h.id}`, h.title, 'html', i, ['HTML · CSS · JavaScript']));
    model.gateways.slice(0, 80).forEach((g, i) => add(`gw:${g.id}`, g.label, 'gw', i, []));
    return out;
  }, [model, projectId]);

  const status = result?.projectId !== projectId ? 'Загрузка проекта…' : result.error ? 'Не удалось загрузить проект' : !cards.length ? 'Проект пока пуст' : '';
  if (status) return <div className={className} role="img" aria-label={status} style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', background: '#f4f6f8', color: '#86909c', fontSize: 11, textAlign: 'center' }}>{status}</div>;
  const minX = Math.min(...cards.map((c) => c.x)) - 32;
  const minY = Math.min(...cards.map((c) => c.y)) - 32;
  const maxX = Math.max(...cards.map((c) => c.x + c.w)) + 32;
  const maxY = Math.max(...cards.map((c) => c.y + c.h)) + 32;
  const byId = new Map(cards.map((c) => [c.id, c]));
  return <svg className={className} role="img" aria-label="Миниатюра проекта" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', width: '100%', height: '100%', background: '#f4f6f8' }}>
    {model?.cardLinks.slice(0, 160).map((link, i) => {
      const a = byId.get(link.from), b = byId.get(link.to);
      return a && b ? <line key={i} x1={a.x + a.w / 2} y1={a.y + a.h / 2} x2={b.x + b.w / 2} y2={b.y + b.h / 2} stroke="#a6b2c0" strokeWidth="3" /> : null;
    })}
    {cards.map((c) => <g key={c.id} transform={`translate(${c.x} ${c.y})`}>
      {c.kind === 'gw' ? <polygon points={`${c.w / 2},0 ${c.w},${c.h / 2} ${c.w / 2},${c.h} 0,${c.h / 2}`} fill="#fff" stroke="#9dacc0" strokeWidth="3" /> : <rect width={c.w} height={c.h} rx="9" fill="#fff" stroke="#d4dce5" strokeWidth="3" />}
      {c.kind !== 'gw' && <rect x="1" y="1" width={c.w - 2} height="36" rx="8" fill={c.kind === 'proc' ? '#e9f1ff' : c.kind === 'doc' ? '#edf6f1' : '#f5f0e6'} />}
      {c.kind !== 'gw' && <text x="14" y="24" fontSize="16" fontWeight="600" fill="#34445a">{c.title.slice(0, Math.max(8, Math.floor(c.w / 10)))}</text>}
      {c.kind === 'doc' && c.details.map((line, i) => <text key={i} x="16" y={70 + i * 30} fontSize="13" fill="#79889a">{line.slice(0, Math.max(8, Math.floor(c.w / 9)))}</text>)}
      {(c.kind === 'src' || c.kind === 'html') && <text x="14" y="70" fontSize="15" fill="#9a845d">{c.details[0]}</text>}
      {c.kind === 'proc' && c.xml && <BpmnPreview xml={c.xml} width={c.w} height={c.h} />}
    </g>)}
  </svg>;
}

function BpmnPreview({ xml, width, height }: { xml: string; width: number; height: number }) {
  const shapes = useMemo(() => {
    if (xml.length > 1000000) return [];
    try {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      return Array.from(doc.getElementsByTagNameNS('*', 'BPMNShape')).slice(0, 80).flatMap((shape) => {
        const bounds = shape.getElementsByTagNameNS('*', 'Bounds')[0];
        if (!bounds) return [];
        const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(bounds.getAttribute(k)));
        return [x, y, w, h].every((n) => Number.isFinite(n) && Math.abs(n) < 100000) && w > 0 && h > 0 ? [{ x, y, w, h }] : [];
      });
    } catch { return []; }
  }, [xml]);
  if (!shapes.length) return null;
  const minX = Math.min(...shapes.map((s) => s.x)), minY = Math.min(...shapes.map((s) => s.y));
  const maxX = Math.max(...shapes.map((s) => s.x + s.w)), maxY = Math.max(...shapes.map((s) => s.y + s.h));
  return <svg x="16" y="48" width={Math.max(1, width - 32)} height={Math.max(1, height - 64)} viewBox={`${minX - 10} ${minY - 10} ${maxX - minX + 20} ${maxY - minY + 20}`} preserveAspectRatio="xMidYMin meet">
    {shapes.map((s, i) => <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx="5" fill="#f4f8ff" stroke="#8ba5c5" strokeWidth="2" />)}
  </svg>;
}
