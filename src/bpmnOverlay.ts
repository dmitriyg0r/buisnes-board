/**
 * bpmn-visualization не рисует элементы данных (объект данных, хранилище, ассоциации данных),
 * хотя в редакторе они есть. Эти элементы дорисовываются поверх диаграммы по координатам из BPMN DI.
 */

const BPMN = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMNDI = 'http://www.omg.org/spec/BPMN/20100524/DI';
const DC = 'http://www.omg.org/spec/DD/20100524/DC';
const DI = 'http://www.omg.org/spec/DD/20100524/DI';
const SVG = 'http://www.w3.org/2000/svg';

const SHAPES = new Set(['dataStoreReference', 'dataObjectReference']);
const EDGES = new Set(['dataInputAssociation', 'dataOutputAssociation']);
const CLASS = 'bb-data-overlay';

interface View {
  scale: number;
  translate: { x: number; y: number };
  getOverlayPane: () => Element;
}

const el = (name: string, attrs: Record<string, string | number>) => {
  const n = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

export function drawDataElements(view: View, xml: string): void {
  const pane = view.getOverlayPane();
  pane.querySelectorAll(`.${CLASS}`).forEach((n) => n.remove());

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return;

  const kind = new Map<string, string>();
  const name = new Map<string, string>();
  for (const e of Array.from(doc.getElementsByTagNameNS(BPMN, '*'))) {
    const id = e.getAttribute('id');
    if (!id) continue;
    kind.set(id, e.localName);
    name.set(id, e.getAttribute('name') ?? '');
  }

  const s = view.scale;
  const px = (x: number) => (x + view.translate.x) * s;
  const py = (y: number) => (y + view.translate.y) * s;
  const stroke = { stroke: '#000', 'stroke-width': 1.5, fill: 'none' };
  const layer = el('g', { class: CLASS, 'pointer-events': 'none' });

  for (const sh of Array.from(doc.getElementsByTagNameNS(BPMNDI, 'BPMNShape'))) {
    const ref = sh.getAttribute('bpmnElement') ?? '';
    const type = kind.get(ref);
    const b = sh.getElementsByTagNameNS(DC, 'Bounds')[0];
    if (!type || !SHAPES.has(type) || !b) continue;
    const x = px(Number(b.getAttribute('x')));
    const y = py(Number(b.getAttribute('y')));
    const w = Number(b.getAttribute('width')) * s;
    const h = Number(b.getAttribute('height')) * s;
    const g = el('g', { transform: `translate(${x} ${y})` });

    if (type === 'dataStoreReference') {
      const ry = h * 0.13;
      g.append(
        el('path', { d: `M0 ${ry} V${h - ry} A${w / 2} ${ry} 0 0 0 ${w} ${h - ry} V${ry}`, ...stroke, fill: '#fff' }),
        el('ellipse', { cx: w / 2, cy: ry, rx: w / 2, ry, ...stroke, fill: '#fff' }),
        el('path', { d: `M0 ${ry * 2.4} A${w / 2} ${ry} 0 0 0 ${w} ${ry * 2.4}`, ...stroke }),
        el('path', { d: `M0 ${ry * 3.8} A${w / 2} ${ry} 0 0 0 ${w} ${ry * 3.8}`, ...stroke }),
      );
    } else {
      const f = Math.min(w, h) * 0.22;
      g.append(
        el('path', { d: `M0 0 H${w - f} L${w} ${f} V${h} H0 Z`, ...stroke, fill: '#fff' }),
        el('path', { d: `M${w - f} 0 V${f} H${w}`, ...stroke }),
      );
    }

    const label = name.get(ref);
    if (label) {
      const t = el('text', { x: w / 2, y: h + 13 * s + 2, 'text-anchor': 'middle', 'font-size': 11 * s, 'font-family': 'Arial, sans-serif', fill: '#000' });
      t.textContent = label;
      g.append(t);
    }
    layer.append(g);
  }

  for (const ed of Array.from(doc.getElementsByTagNameNS(BPMNDI, 'BPMNEdge'))) {
    const type = kind.get(ed.getAttribute('bpmnElement') ?? '');
    if (!type || !EDGES.has(type)) continue;
    const pts = Array.from(ed.getElementsByTagNameNS(DI, 'waypoint')).map((w) => [px(Number(w.getAttribute('x'))), py(Number(w.getAttribute('y')))]);
    if (pts.length < 2) continue;
    layer.append(el('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' '), ...stroke, 'stroke-width': 1.2, 'stroke-dasharray': '2 3' }));
    // открытая стрелка в конце ассоциации
    const [x1, y1] = pts[pts.length - 2];
    const [x2, y2] = pts[pts.length - 1];
    const a = Math.atan2(y2 - y1, x2 - x1);
    const len = 8 * s;
    const head = (d: number) => `${x2 - len * Math.cos(a + d)} ${y2 - len * Math.sin(a + d)}`;
    layer.append(el('path', { d: `M${head(0.45)} L${x2} ${y2} L${head(-0.45)}`, ...stroke, 'stroke-width': 1.2 }));
  }

  pane.append(layer);
}
