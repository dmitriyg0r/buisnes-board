/** Разбор BPMN 2.0 XML: из диаграммы нужны шаги, переходы и дорожки, остальное хранит сам XML. */

export type NodeKind = 'start' | 'end' | 'task' | 'gateway' | 'event';

export interface ProcessNode {
  id: string;
  kind: NodeKind;
  /** имя элемента в BPMN, например userTask */
  type: string;
  name: string;
  lane?: string;
}

export interface ProcessFlow {
  id: string;
  from: string;
  to: string;
  name: string;
}

export interface ParsedProcess {
  nodes: ProcessNode[];
  flows: ProcessFlow[];
}

const NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

const KIND: Record<string, NodeKind> = {
  startEvent: 'start',
  endEvent: 'end',
  intermediateCatchEvent: 'event',
  intermediateThrowEvent: 'event',
  boundaryEvent: 'event',
  task: 'task',
  userTask: 'task',
  serviceTask: 'task',
  sendTask: 'task',
  receiveTask: 'task',
  manualTask: 'task',
  businessRuleTask: 'task',
  scriptTask: 'task',
  callActivity: 'task',
  subProcess: 'task',
  transaction: 'task',
  adHocSubProcess: 'task',
  exclusiveGateway: 'gateway',
  parallelGateway: 'gateway',
  inclusiveGateway: 'gateway',
  eventBasedGateway: 'gateway',
  complexGateway: 'gateway',
};

export const typeLabel: Record<string, string> = {
  startEvent: 'Начальное событие',
  endEvent: 'Конечное событие',
  intermediateCatchEvent: 'Промежуточное событие',
  intermediateThrowEvent: 'Промежуточное событие',
  boundaryEvent: 'Граничное событие',
  task: 'Задача',
  userTask: 'Задача пользователя',
  serviceTask: 'Сервисная задача',
  sendTask: 'Задача отправки',
  receiveTask: 'Задача получения',
  manualTask: 'Ручная задача',
  businessRuleTask: 'Задача бизнес-правила',
  scriptTask: 'Задача-скрипт',
  callActivity: 'Вызов процесса',
  subProcess: 'Подпроцесс',
  transaction: 'Транзакция',
  adHocSubProcess: 'Произвольный подпроцесс',
  exclusiveGateway: 'Исключающий шлюз',
  parallelGateway: 'Параллельный шлюз',
  inclusiveGateway: 'Включающий шлюз',
  eventBasedGateway: 'Шлюз по событиям',
  complexGateway: 'Сложный шлюз',
};

const cache = new Map<string, ParsedProcess>();

export function parseProcess(xml: string | null | undefined): ParsedProcess {
  const empty: ParsedProcess = { nodes: [], flows: [] };
  if (!xml) return empty;
  const hit = cache.get(xml);
  if (hit) return hit;

  let result = empty;
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (!doc.querySelector('parsererror')) {
      // дорожка для каждого узла: lane → flowNodeRef
      const laneOf = new Map<string, string>();
      for (const lane of Array.from(doc.getElementsByTagNameNS(NS, 'lane'))) {
        const name = lane.getAttribute('name') ?? '';
        for (const ref of Array.from(lane.getElementsByTagNameNS(NS, 'flowNodeRef'))) {
          if (ref.textContent) laneOf.set(ref.textContent.trim(), name);
        }
      }
      const nodes: ProcessNode[] = [];
      const flows: ProcessFlow[] = [];
      for (const el of Array.from(doc.getElementsByTagNameNS(NS, '*'))) {
        const type = el.localName;
        const id = el.getAttribute('id');
        if (!id) continue;
        if (type === 'sequenceFlow') {
          flows.push({ id, from: el.getAttribute('sourceRef') ?? '', to: el.getAttribute('targetRef') ?? '', name: el.getAttribute('name') ?? '' });
        } else if (KIND[type]) {
          nodes.push({ id, kind: KIND[type], type, name: el.getAttribute('name') ?? '', lane: laneOf.get(id) || undefined });
        }
      }
      result = { nodes, flows };
    }
  } catch {
    /* оставляем пустой результат */
  }
  if (cache.size > 50) cache.clear();
  cache.set(xml, result);
  return result;
}

/** Шаги, которые связываются с пунктами регламента: задачи и шлюзы. */
export const isLinkable = (n: ProcessNode) => n.kind === 'task' || n.kind === 'gateway';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** Чистая диаграмма с одним начальным событием: с неё начинается новая модель. */
export function blankXml(name: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" name="${esc(name)}" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="182" y="162" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

/* ----- несколько моделей в одном проекте: идентификатор шага составной ----- */

export interface ProjectNode extends ProcessNode {
  /** модель, которой принадлежит шаг */
  pid: string;
  procTitle: string;
  /** идентификатор элемента внутри диаграммы */
  elId: string;
}

export const nodeRef = (pid: string, elId: string) => `${pid}:${elId}`;

export function splitRef(ref: string): { pid: string; elId: string } {
  const i = ref.indexOf(':');
  return i < 0 ? { pid: '', elId: ref } : { pid: ref.slice(0, i), elId: ref.slice(i + 1) };
}

/** Все шаги всех моделей проекта; id шага составной (см. nodeRef). */
export function projectNodes(processes: { id: string; title: string; xml: string }[]): ProjectNode[] {
  return processes.flatMap((p) =>
    parseProcess(p.xml).nodes.map((n) => ({ ...n, id: nodeRef(p.id, n.id), pid: p.id, procTitle: p.title, elId: n.id })),
  );
}

export function projectFlows(processes: { id: string; xml: string }[]): ProcessFlow[] {
  return processes.flatMap((p) =>
    parseProcess(p.xml).flows.map((f) => ({ ...f, id: nodeRef(p.id, f.id), from: nodeRef(p.id, f.from), to: nodeRef(p.id, f.to) })),
  );
}
