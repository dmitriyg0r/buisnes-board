import { useMemo, useSyncExternalStore } from 'react';
import { edgePoints, layout, partialPlan, type GenNode, type Plan } from './ai';
import { DOC_SIZE, MODEL_SIZE } from './data';

/* ---------- хранилище черновика ----------
 * Черновик обновляется десятки раз в секунду, пока модель пишет. Он живёт отдельно от Canvas,
 * чтобы перерисовывалась только эта часть доски, а не вся.
 */

export interface Draft {
  label: string;
  plan: Plan;
  hasText: boolean;
}

let state: Draft | null = null;
const subs = new Set<() => void>();
const publish = (d: Draft | null) => {
  state = d;
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
/** Идёт ли построение процесса. Меняется редко, поэтому Canvas не перерисовывается на каждый токен. */
export const useDraftBuilding = () => useSyncExternalStore(subscribe, () => !!state && state.plan.hasProcess);
export const useDraft = () => useSyncExternalStore(subscribe, () => state);

const EMPTY: Plan = { reply: '', hasProcess: false, processTitle: '', nodes: [], flows: [], docTitle: '', sections: [], inDoc: false };

/**
 * Начинает черновик. push принимает кусочки текста модели, end убирает черновик с доски.
 * onProcess вызывается один раз, когда модель начала строить процесс: до этого она может просто отвечать в чат.
 */
export function beginDraft(label: string, onProcess?: () => void) {
  let text = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let announced = false;
  const flush = () => {
    timer = null;
    const plan = partialPlan(text);
    if (plan.hasProcess && !announced) {
      announced = true;
      onProcess?.();
    }
    publish({ label, plan, hasText: text.length > 0 });
  };
  publish({ label, plan: EMPTY, hasText: false });
  return {
    push(chunk: string) {
      text += chunk;
      // не чаще 8 раз в секунду: разбор и отрисовка схемы не должны мешать самому потоку
      if (timer === null) timer = setTimeout(flush, 120);
    },
    end() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      publish(null);
    },
  };
}

/* ---------- схема, растущая на глазах ---------- */

const wrap = (s: string, width: number, lines: number) => {
  const words = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > width) {
      out.push(cur);
      cur = w;
    } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    out.length = lines;
    out[lines - 1] = out[lines - 1].replace(/.{0,2}$/, '…');
  }
  return out;
};

function Shape({ n, p }: { n: GenNode; p: { x: number; y: number; w: number; h: number; cx: number; cy: number } }) {
  const lines = wrap(n.name, n.type === 'task' ? 15 : 18, n.type === 'task' ? 4 : 2);
  const text =
    n.type === 'task' ? (
      <text className="ai-t" x={p.cx} y={p.cy - ((lines.length - 1) * 6.5)} textAnchor="middle" dominantBaseline="middle">
        {lines.map((l, i) => (
          <tspan key={i} x={p.cx} dy={i === 0 ? 0 : 13}>{l}</tspan>
        ))}
      </text>
    ) : (
      <text className="ai-t" x={p.cx} y={p.y + p.h + 15} textAnchor="middle">
        {lines.map((l, i) => (
          <tspan key={i} x={p.cx} dy={i === 0 ? 0 : 12}>{l}</tspan>
        ))}
      </text>
    );
  return (
    <g className="ai-in">
      {n.type === 'task' && <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={9} className="ai-shape" />}
      {n.type === 'gateway' && (
        <>
          <polygon points={`${p.cx},${p.y} ${p.x + p.w},${p.cy} ${p.cx},${p.y + p.h} ${p.x},${p.cy}`} className="ai-shape" />
          <path d={`M${p.cx - 9} ${p.cy - 9}L${p.cx + 9} ${p.cy + 9}M${p.cx + 9} ${p.cy - 9}L${p.cx - 9} ${p.cy + 9}`} className="ai-x" />
        </>
      )}
      {n.type === 'start' && <circle cx={p.cx} cy={p.cy} r={p.w / 2} className="ai-shape" />}
      {n.type === 'end' && <circle cx={p.cx} cy={p.cy} r={p.w / 2} className="ai-shape ai-end" />}
      {text}
    </g>
  );
}

function GhostDiagram({ plan, label }: { plan: Plan; label: string }) {
  // раскладка пересчитывается только при появлении нового шага или перехода
  const key = plan.nodes.length + ':' + plan.flows.length;
  const lay = useMemo(() => {
    if (!plan.nodes.length) return null;
    // переходы приходят после шагов: пока их нет, выстраиваем шаги слева направо в порядке появления,
    // иначе все шаги стояли бы столбиком, а потом разом перескакивали
    const flows = plan.flows.length ? plan.flows : plan.nodes.slice(1).map((n, i) => ({ from: plan.nodes[i].id, to: n.id }));
    return layout(plan.nodes, flows);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lay) {
    return (
      <div className="ai-skel" aria-hidden>
        <span /><span /><span />
      </div>
    );
  }
  const places = [...lay.place.values()];
  const minX = Math.min(...places.map((p) => p.x)) - 40;
  const maxX = Math.max(...places.map((p) => p.x + p.w)) + 40;
  const minY = Math.min(...places.map((p) => p.y)) - 40;
  const maxY = Math.max(lay.bottom, ...places.map((p) => p.y + p.h)) + 40;
  const last = plan.nodes[plan.nodes.length - 1];
  const lp = lay.place.get(last.id)!;

  return (
    <svg className="ai-svg" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs>
        <marker id="aiArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#6b7080" />
        </marker>
      </defs>
      {plan.flows.map((f, i) => {
        const a = lay.place.get(f.from);
        const z = lay.place.get(f.to);
        if (!a || !z) return null;
        const pts = edgePoints(a, z, lay.back.has(i), lay.bottom);
        const mid = pts[Math.floor((pts.length - 1) / 2)];
        const nxt = pts[Math.floor((pts.length - 1) / 2) + 1];
        return (
          <g key={`${f.from}>${f.to}>${i}`} className="ai-in">
            <polyline points={pts.map((q) => q.join(',')).join(' ')} className="ai-edge" markerEnd="url(#aiArrow)" />
            {f.label && (
              <text className="ai-t ai-lbl" x={(mid[0] + nxt[0]) / 2} y={(mid[1] + nxt[1]) / 2 - 5} textAnchor="middle">{f.label}</text>
            )}
          </g>
        );
      })}
      {plan.nodes.map((n) => (
        <Shape key={n.id} n={n} p={lay.place.get(n.id)!} />
      ))}
      <g className="ai-cursor" style={{ transform: `translate(${lp.x + lp.w - 4}px, ${lp.y + lp.h - 4}px)` }}>
        <path d="M0 0L0 15L4.5 11.5L7.5 18L10 17L7 10.5L13 10z" className="ai-ptr" />
        <rect x={12} y={14} width={Math.max(60, label.length * 7 + 26)} height={20} rx={10} className="ai-tag" />
        <text x={22} y={28} className="ai-tagt">ИИ · {label}</text>
      </g>
    </svg>
  );
}

/* ---------- карточки-призраки на доске ---------- */

type Pt = { x: number; y: number };

export function AiDraftLayer({ procPos, docPos }: { procPos: Pt; docPos: Pt }) {
  const d = useDraft();
  // пока модель только отвечает в чат, на доске ничего не рисуем
  if (!d || !d.plan.hasProcess) return null;
  const { plan } = d;
  return (
    <>
      <div className="ai-ghost" style={{ left: procPos.x, top: procPos.y, width: MODEL_SIZE.w, height: MODEL_SIZE.h }} aria-hidden>
        <div className="ai-ghost-head">
          <span className="ai-dot" />
          <b>{plan.processTitle || 'Новый процесс'}</b>
          <em>строится…</em>
        </div>
        <GhostDiagram plan={plan} label={d.label} />
      </div>
      <div className="ai-ghost ai-ghost-doc" style={{ left: docPos.x, top: docPos.y, width: DOC_SIZE.w, height: DOC_SIZE.h }} aria-hidden>
        <div className="ai-ghost-head">
          <span className="ai-dot" />
          <b>{plan.docTitle || 'Регламент'}</b>
          <em>{plan.inDoc ? 'пишется…' : 'ждёт схему'}</em>
        </div>
        {plan.sections.length === 0 ? (
          <div className="ai-skel" aria-hidden>
            <span /><span /><span />
          </div>
        ) : (
          <div className="ai-doc">
            {plan.sections.map((s) => (
              <div key={s.title} className="ai-in">
                <b>{s.title}</b>
                <p>{s.markdown.replace(/[#*_`>]/g, '').slice(0, 130)}{s.markdown.length > 130 ? '…' : ''}</p>
              </div>
            ))}
            <div className="ai-skel ai-skel-tail" aria-hidden>
              <span />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- этапы над полем ввода ---------- */

export function AiProgress({ onCancel }: { onCancel: () => void }) {
  const d = useDraft();
  if (!d) return null;
  const { plan } = d;
  // этапы зависят от того, что делает модель: строит процесс или просто отвечает в чат
  const steps = plan.hasProcess
    ? [
        { name: 'Читаю доску', note: '' },
        { name: 'Строю схему', note: plan.nodes.length ? `${plan.nodes.length} шаг.` : '' },
        { name: 'Пишу регламент', note: plan.sections.length ? `${plan.sections.length} пункт.` : '' },
      ]
    : [
        { name: 'Читаю доску', note: '' },
        { name: 'Отвечаю', note: '' },
      ];
  const stage = !d.hasText ? 0 : plan.hasProcess ? (plan.inDoc ? 2 : 1) : 1;
  return (
    <div className="ai-steps" role="status" aria-live="polite">
      <ol>
        {steps.map((s, i) => (
          <li key={s.name} className={i < stage ? 'done' : i === stage ? 'now' : ''}>
            <span className="ai-mark" aria-hidden>{i < stage ? '✓' : ''}</span>
            {s.name}
            {i <= stage && s.note ? <small> · {s.note}</small> : null}
          </li>
        ))}
      </ol>
      <button type="button" className="ai-cancel" onClick={onCancel}>Отмена</button>
    </div>
  );
}

/** Положение и размер призраков, чтобы Canvas мог показать их на экране. */
export const ghostRect = (procPos: Pt, docPos: Pt) => ({
  left: Math.min(procPos.x, docPos.x),
  top: Math.min(procPos.y, docPos.y),
  right: Math.max(procPos.x + MODEL_SIZE.w, docPos.x + DOC_SIZE.w),
  bottom: Math.max(procPos.y + MODEL_SIZE.h, docPos.y + DOC_SIZE.h),
});
