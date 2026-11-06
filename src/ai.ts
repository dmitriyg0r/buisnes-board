import { HttpError } from './api';
import { nodeRef, parseProcess } from './bpmn';
import type { Model } from './data';
import { reconcileSections, sectionTitles } from './markdown';
import { INFO_SECTION, key } from './schema';
import type { AiModel } from './settings';

/** Ответ сервера: проверенный процесс и документ. */
export interface GenNode {
  id: string;
  type: 'start' | 'task' | 'gateway' | 'end';
  name: string;
}
export interface GenFlow {
  from: string;
  to: string;
  label?: string;
}
export interface GenResult {
  /** ответ в чат: есть всегда */
  reply: string;
  /** только если модель построила процесс */
  process?: { title: string; nodes: GenNode[]; flows: GenFlow[] };
  document?: { title: string; sections: { title: string; markdown: string; steps: string[] }[] };
}

/** Реплика диалога, которую уносим модели, чтобы она понимала уточнения. */
export interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

/** Ошибка генерации с текстом для пользователя. */
export class GenError extends Error {}

export type StreamEvent = { type: 'start' } | { type: 'delta'; text: string };

/**
 * Запрашивает генерацию и читает ответ потоком: onEvent получает кусочки текста модели, пока она пишет.
 * Возвращает проверенный сервером результат. Отмена через signal закрывает соединение, и сервер
 * перестаёт читать ответ модели.
 */
export async function streamGenerate(prompt: string, model: AiModel, context: string, history: Turn[], onEvent: (e: StreamEvent) => void, signal: AbortSignal): Promise<GenResult> {
  const res = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, model, context, history }),
    signal,
  });
  if (!res.ok || !res.body) {
    let detail: string | undefined;
    try {
      detail = ((await res.json()) as { error?: string }).error;
    } catch {
      /* тела нет */
    }
    if (res.status === 401) window.dispatchEvent(new Event('bb:unauthorized'));
    throw new HttpError(res.status, detail);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let result: GenResult | null = null;
  let failure: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev: { type: string; text?: string; data?: GenResult; message?: string };
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === 'result' && ev.data) result = ev.data;
      else if (ev.type === 'error') failure = ev.message ?? 'Ошибка генерации';
      else if (ev.type === 'delta' && typeof ev.text === 'string') onEvent({ type: 'delta', text: ev.text });
      else if (ev.type === 'start') onEvent({ type: 'start' });
    }
  }
  if (failure) throw new GenError(failure);
  if (!result) throw new GenError('Соединение оборвалось до конца генерации. Попробуйте ещё раз.');
  return result;
}

/* ---------- разбор недописанного ответа: черновик на доске ---------- */

export interface Plan {
  /** реплика, которую модель пишет прямо сейчас (может быть недописана) */
  reply: string;
  /** модель перешла к схеме */
  hasProcess: boolean;
  processTitle: string;
  nodes: GenNode[];
  flows: GenFlow[];
  docTitle: string;
  sections: { title: string; markdown: string; steps: string[] }[];
  /** модель уже перешла к документу */
  inDoc: boolean;
}

/** Полностью написанные объекты массива с ключом key; последний недописанный объект пропускается. */
function completeObjects(text: string, key: string, from = 0): unknown[] {
  const k = text.indexOf(`"${key}"`, from);
  if (k < 0) return [];
  const open = text.indexOf('[', k);
  if (open < 0) return [];
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* пропускаем */
        }
        start = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  return out;
}

function stringAfter(text: string, from: number, key: string): string {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text.slice(from));
  if (!m) return '';
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1];
  }
}

/** Значение строкового поля, даже если оно ещё не закрыто кавычкой: реплика печатается на глазах. */
function partialString(text: string, key: string): string {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(text);
  if (!m) return '';
  let raw = m[1];
  // оборванный на середине escape-код не разбираем
  raw = raw.replace(/\\(u[0-9a-fA-F]{0,3})?$/, '').replace(/\\$/, '');
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const KINDS = ['start', 'task', 'gateway', 'end'];

/** Что модель успела написать к этому моменту. Безопасно для недописанного JSON. */
export function partialPlan(text: string): Plan {
  const docAt = text.indexOf('"document"');
  const head = docAt >= 0 ? text.slice(0, docAt) : text;
  const seen = new Set<string>();
  const nodes = completeObjects(head, 'nodes').flatMap((o) => {
    const n = o as Record<string, unknown>;
    const id = str(n.id);
    if (!id || seen.has(id) || !KINDS.includes(str(n.type))) return [];
    seen.add(id);
    return [{ id, type: str(n.type) as GenNode['type'], name: str(n.name) }];
  });
  const flows = completeObjects(head, 'flows').flatMap((o) => {
    const f = o as Record<string, unknown>;
    return seen.has(str(f.from)) && seen.has(str(f.to)) && f.from !== f.to ? [{ from: str(f.from), to: str(f.to), label: str(f.label) || undefined }] : [];
  });
  const sections =
    docAt >= 0
      ? completeObjects(text, 'sections', docAt).flatMap((o) => {
          const x = o as Record<string, unknown>;
          return str(x.title) ? [{ title: str(x.title), markdown: str(x.markdown), steps: Array.isArray(x.steps) ? x.steps.filter((t): t is string => typeof t === 'string') : [] }] : [];
        })
      : [];
  return {
    reply: partialString(text, 'reply'),
    hasProcess: text.includes('"process"'),
    processTitle: stringAfter(text, 0, 'title'),
    nodes,
    flows,
    docTitle: docAt >= 0 ? stringAfter(text, docAt, 'title') : '',
    sections,
    inDoc: docAt >= 0,
  };
}

/* ---------- что модель видит на доске ---------- */

const DOC_CHARS = 4000;
const CONTEXT_CHARS = 50_000;

/** Сжатое описание доски для запроса: процессы, документы и источники (у источников известны только имена). */
export function buildContext(m: Model): string {
  const parts: string[] = [];
  for (const p of m.processes) {
    const { nodes, flows } = parseProcess(p.xml);
    const name = (id: string) => nodes.find((n) => n.id === id)?.name || id;
    const steps = nodes.filter((n) => n.name).map((n) => `${n.kind === 'gateway' ? 'развилка' : 'шаг'}: ${n.name}`);
    const trans = flows.map((f) => `${name(f.from)} → ${name(f.to)}${f.name ? ` (${f.name})` : ''}`);
    parts.push(`Процесс «${p.title}»\n${steps.slice(0, 60).join('\n')}${trans.length ? `\nПереходы:\n${trans.slice(0, 100).join('\n')}` : ''}`);
  }
  for (const d of m.docs) {
    const text = d.markdown.length > DOC_CHARS ? d.markdown.slice(0, DOC_CHARS) + '\n…' : d.markdown;
    parts.push(`Документ «${d.title}»\n${text}`);
  }
  if (m.sources.length) parts.push('Источники (только названия):\n' + m.sources.map((s) => `${s.name}.${s.ext.toLowerCase()}, ${s.pages} стр.`).join('\n'));
  return parts.join('\n\n').slice(0, CONTEXT_CHARS);
}

/* ---------- сборка BPMN с раскладкой ---------- */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TAG: Record<GenNode['type'], { tag: string; prefix: string; w: number; h: number }> = {
  start: { tag: 'startEvent', prefix: 'StartEvent', w: 36, h: 36 },
  task: { tag: 'task', prefix: 'Activity', w: 100, h: 80 },
  gateway: { tag: 'exclusiveGateway', prefix: 'Gateway', w: 50, h: 50 },
  end: { tag: 'endEvent', prefix: 'EndEvent', w: 36, h: 36 },
};

const COL = 150;
const ROW = 110;
const X0 = 100;
const Y0 = 200;

/** Слой каждого узла: самый длинный путь от начала, обратные переходы (циклы) не учитываются. */
function layers(nodes: GenNode[], flows: GenFlow[]): { layer: Map<string, number>; back: Set<number> } {
  const out = new Map<string, number[]>();
  flows.forEach((f, i) => out.set(f.from, [...(out.get(f.from) ?? []), i]));
  const start = nodes.find((n) => n.type === 'start')?.id ?? nodes[0].id;

  // обход в глубину: переход к узлу, который сейчас в стеке, считается обратным
  const back = new Set<number>();
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const i of out.get(id) ?? []) {
      const to = flows[i].to;
      if (state.get(to) === 1) back.add(i);
      else if (!state.has(to)) visit(to);
    }
    state.set(id, 2);
  };
  visit(start);
  nodes.forEach((n) => !state.has(n.id) && visit(n.id));

  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  flows.forEach((f, i) => !back.has(i) && indeg.set(f.to, (indeg.get(f.to) ?? 0) + 1));
  const queue = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const i of out.get(id) ?? []) {
      if (back.has(i)) continue;
      const to = flows[i].to;
      layer.set(to, Math.max(layer.get(to) ?? 0, (layer.get(id) ?? 0) + 1));
      indeg.set(to, (indeg.get(to) ?? 1) - 1);
      if (indeg.get(to) === 0) queue.push(to);
    }
  }
  return { layer, back };
}

export interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface Layout {
  place: Map<string, Placed>;
  back: Set<number>;
  /** линия, по которой идут возвраты назад под схемой */
  bottom: number;
}

/** Раскладка слева направо: слой по самому длинному пути, по вертикали ближе к среднему положению предшественников. */
export function layout(nodes: GenNode[], flows: GenFlow[]): Layout {
  const { layer, back } = layers(nodes, flows);
  const cy = new Map<string, number>();
  const maxLayer = Math.max(0, ...layer.values());
  for (let l = 0; l <= maxLayer; l++) {
    const inLayer = nodes.filter((n) => layer.get(n.id) === l);
    const want = (id: string) => {
      const preds = flows.filter((f, i) => f.to === id && !back.has(i) && cy.has(f.from)).map((f) => cy.get(f.from)!);
      return preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : Y0;
    };
    const sorted = inLayer.map((n) => ({ n, y: want(n.id) })).sort((a, b) => a.y - b.y);
    let prev = -Infinity;
    for (const { n, y } of sorted) {
      const at = Math.max(y, prev + ROW);
      cy.set(n.id, at);
      prev = at;
    }
  }
  const place = new Map<string, Placed>();
  for (const n of nodes) {
    const { w, h } = TAG[n.type];
    const cx = X0 + (layer.get(n.id) ?? 0) * COL;
    const y = cy.get(n.id) ?? Y0;
    place.set(n.id, { x: cx - w / 2, y: y - h / 2, w, h, cx, cy: y });
  }
  const bottom = Math.max(...[...place.values()].map((p) => p.y + p.h)) + 60;
  return { place, back, bottom };
}

/** Ломаная линия перехода: вперёд по прямой или с изломом, назад под схемой. */
export function edgePoints(a: Placed, z: Placed, isBack: boolean, bottom: number): [number, number][] {
  if (isBack || z.cx <= a.cx) return [[a.cx, a.y + a.h], [a.cx, bottom], [z.cx, bottom], [z.cx, z.y + z.h]];
  if (a.cy === z.cy) return [[a.x + a.w, a.cy], [z.x, z.cy]];
  const xm = (a.x + a.w + z.x) / 2;
  return [[a.x + a.w, a.cy], [xm, a.cy], [xm, z.cy], [z.x, z.cy]];
}

export interface BuiltProcess {
  xml: string;
  /** id шага из ответа модели → id элемента в BPMN */
  elementId: Record<string, string>;
}

/** Строит BPMN 2.0 XML с координатами по общей раскладке. */
export function buildBpmnXml(title: string, nodes: GenNode[], flows: GenFlow[]): BuiltProcess {
  const { place, back, bottom } = layout(nodes, flows);
  const elementId: Record<string, string> = {};
  nodes.forEach((n) => (elementId[n.id] = `${TAG[n.type].prefix}_${n.id}`));

  const shapes: string[] = [];
  const elements: string[] = [];
  for (const n of nodes) {
    const el = elementId[n.id];
    const b = place.get(n.id)!;
    elements.push(`    <bpmn:${TAG[n.type].tag} id="${el}"${n.name ? ` name="${esc(n.name)}"` : ''} />`);
    // у событий и развилок подпись снаружи: задаём ей место явно (событие: под фигурой, развилка: над ней),
    // иначе подпись длинного названия налезает на сам круг
    let label = '';
    if (n.type !== 'task' && n.name) {
      const lh = Math.min(4, Math.ceil(n.name.length / 13)) * 14;
      const ly = n.type === 'gateway' ? b.y - 6 - lh : b.y + b.h + 4;
      label = `\n        <bpmndi:BPMNLabel>\n          <dc:Bounds x="${b.cx - 45}" y="${ly}" width="90" height="${lh}" />\n        </bpmndi:BPMNLabel>`;
    }
    shapes.push(
      `      <bpmndi:BPMNShape id="${el}_di" bpmnElement="${el}"${n.type === 'gateway' ? ' isMarkerVisible="true"' : ''}>\n        <dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />${label}\n      </bpmndi:BPMNShape>`,
    );
  }
  const edges: string[] = [];
  flows.forEach((f, i) => {
    const id = `Flow_${i + 1}`;
    elements.push(`    <bpmn:sequenceFlow id="${id}"${f.label ? ` name="${esc(f.label)}"` : ''} sourceRef="${elementId[f.from]}" targetRef="${elementId[f.to]}" />`);
    const pts = edgePoints(place.get(f.from)!, place.get(f.to)!, back.has(i), bottom);
    edges.push(
      `      <bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">\n${pts.map(([x, y]) => `        <di:waypoint x="${x}" y="${y}" />`).join('\n')}\n      </bpmndi:BPMNEdge>`,
    );
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" name="${esc(title)}" isExecutable="false">
${elements.join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
${shapes.join('\n')}
${edges.join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
  return { xml, elementId };
}

/* ---------- применение результата к доске ---------- */

const rid = (p: string) => p + Math.random().toString(36).slice(2, 8);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Заголовки внутри текста пункта понижаем до четвёртого уровня: иначе они разобьют пункт на несколько. */
const demote = (md: string) => {
  let fence = false;
  return md
    .split('\n')
    .map((ln) => {
      if (/^ {0,3}(```|~~~)/.test(ln)) fence = !fence;
      return !fence && /^#{1,3}[ \t]/.test(ln) ? ln.replace(/^#{1,3}/, '####') : ln;
    })
    .join('\n');
};

export interface Applied {
  model: Model;
  procId?: string;
  docId?: string;
}

/** Добавляет в модель то, что построила модель: процесс, документ и связи «шаг ↔ пункт». Если процесса нет, модель не меняется. */
export function applyGenerated(m: Model, r: GenResult): Applied {
  if (!r.process) return { model: m };
  const pid = rid('p');
  const built = buildBpmnXml(oneLine(r.process.title), r.process.nodes, r.process.flows);
  let next: Model = { ...m, processes: [...m.processes, { id: pid, title: oneLine(r.process.title), xml: built.xml }] };
  if (!r.document) return { model: next, procId: pid };

  const did = rid('d');
  const dtitle = oneLine(r.document.title);
  const markdown = `# ${dtitle}\n\n` + r.document.sections.map((s) => `## ${oneLine(s.title)}\n\n${demote(s.markdown)}\n`).join('\n');
  const titles = sectionTitles(markdown);
  const sections = reconcileSections([], titles);

  // связи ставим, только если пункты разобрались один к одному; иначе документ всё равно добавится
  const ok = sections.length === r.document.sections.length;
  const links = ok
    ? r.document.sections.flatMap((s, i) =>
        s.steps.filter((st) => built.elementId[st]).map((st) => ({ id: rid('l'), nodeId: nodeRef(pid, built.elementId[st]), sectionId: sections[i].id })),
      )
    : [];

  // пункты без шагов (цель, участники, определения) помечаем справочными, чтобы проверка покрытия не считала их замечаниями
  const info = ok ? r.document.sections.flatMap((s, i) => (s.steps.some((st) => built.elementId[st]) ? [] : [sections[i].id])) : [];
  const meta = { ...m.meta };
  for (const id of info) meta[key.section(id)] = { ...meta[key.section(id)], coverage: INFO_SECTION };

  next = { ...next, docs: [...m.docs, { id: did, title: dtitle, markdown, sections }], links: [...m.links, ...links], meta };
  return { model: next, procId: pid, docId: did };
}
