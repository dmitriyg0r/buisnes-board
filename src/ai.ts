import { http } from './api';
import { nodeRef, parseProcess } from './bpmn';
import type { Model } from './data';
import { reconcileSections, sectionTitles } from './markdown';
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
  process: { title: string; nodes: GenNode[]; flows: GenFlow[] };
  document: { title: string; sections: { title: string; markdown: string; steps: string[] }[] };
}

export const generateProcess = (prompt: string, model: AiModel, context: string) =>
  http<GenResult>('POST', '/ai/generate', { prompt, model, context });

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

const COL = 190;
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

export interface BuiltProcess {
  xml: string;
  /** id шага из ответа модели → id элемента в BPMN */
  elementId: Record<string, string>;
}

/** Строит BPMN 2.0 XML с координатами: слева направо, ветки выстраиваются по слоям. */
export function buildBpmnXml(title: string, nodes: GenNode[], flows: GenFlow[]): BuiltProcess {
  const { layer, back } = layers(nodes, flows);
  const elementId: Record<string, string> = {};
  nodes.forEach((n) => (elementId[n.id] = `${TAG[n.type].prefix}_${n.id}`));

  // вертикальное положение: ближе к среднему положению предшественников, без наложений в слое
  const cy = new Map<string, number>();
  const maxLayer = Math.max(...layer.values());
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
  const bounds = (n: GenNode) => {
    const { w, h } = TAG[n.type];
    const cx = X0 + (layer.get(n.id) ?? 0) * COL;
    const y = cy.get(n.id) ?? Y0;
    return { x: cx - w / 2, y: y - h / 2, w, h, cx, cy: y };
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const bottom = Math.max(...nodes.map((n) => bounds(n).y + bounds(n).h)) + 60;

  const shapes: string[] = [];
  const elements: string[] = [];
  for (const n of nodes) {
    const el = elementId[n.id];
    const b = bounds(n);
    elements.push(`    <bpmn:${TAG[n.type].tag} id="${el}"${n.name ? ` name="${esc(n.name)}"` : ''} />`);
    shapes.push(
      `      <bpmndi:BPMNShape id="${el}_di" bpmnElement="${el}"${n.type === 'gateway' ? ' isMarkerVisible="true"' : ''}>\n        <dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />\n      </bpmndi:BPMNShape>`,
    );
  }
  const edges: string[] = [];
  flows.forEach((f, i) => {
    const id = `Flow_${i + 1}`;
    const a = bounds(byId.get(f.from)!);
    const z = bounds(byId.get(f.to)!);
    elements.push(`    <bpmn:sequenceFlow id="${id}"${f.label ? ` name="${esc(f.label)}"` : ''} sourceRef="${elementId[f.from]}" targetRef="${elementId[f.to]}" />`);
    let pts: [number, number][];
    if (back.has(i) || z.cx <= a.cx) {
      // назад: снизу под всеми узлами и вверх к цели
      pts = [[a.cx, a.y + a.h], [a.cx, bottom], [z.cx, bottom], [z.cx, z.y + z.h]];
    } else if (a.cy === z.cy) {
      pts = [[a.x + a.w, a.cy], [z.x, z.cy]];
    } else {
      const xm = (a.x + a.w + z.x) / 2;
      pts = [[a.x + a.w, a.cy], [xm, a.cy], [xm, z.cy], [z.x, z.cy]];
    }
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

/** Добавляет в модель новый процесс, документ и связи «шаг ↔ пункт». */
export function applyGenerated(m: Model, r: GenResult): Model {
  const pid = rid('p');
  const did = rid('d');
  const built = buildBpmnXml(oneLine(r.process.title), r.process.nodes, r.process.flows);

  const dtitle = oneLine(r.document.title);
  const markdown = `# ${dtitle}\n\n` + r.document.sections.map((s) => `## ${oneLine(s.title)}\n\n${demote(s.markdown)}\n`).join('\n');
  const titles = sectionTitles(markdown);
  const sections = reconcileSections([], titles);

  // связи ставим, только если пункты разобрались один к одному; иначе документ всё равно добавится
  const links =
    sections.length === r.document.sections.length
      ? r.document.sections.flatMap((s, i) =>
          s.steps.filter((st) => built.elementId[st]).map((st) => ({ id: rid('l'), nodeId: nodeRef(pid, built.elementId[st]), sectionId: sections[i].id })),
        )
      : [];

  return {
    ...m,
    processes: [...m.processes, { id: pid, title: oneLine(r.process.title), xml: built.xml }],
    docs: [...m.docs, { id: did, title: dtitle, markdown, sections }],
    links: [...m.links, ...links],
  };
}
