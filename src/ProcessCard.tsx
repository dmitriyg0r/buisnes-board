import { useEffect, useRef, useState } from 'react';
import { drawDataElements, fitWithData } from './bpmnOverlay';
import { Icon } from './Icon';

/** Нужная нам часть bpmn-visualization: библиотека подгружается отдельным куском при первой отрисовке. */
interface Viz {
  graph: { view: Parameters<typeof drawDataElements>[0] };
  load: (xml: string, options?: { fit?: { type?: unknown; margin?: number } }) => void;
  dispose: () => void;
  bpmnElementsRegistry: {
    getElementsByIds: (ids: string | string[]) => unknown[];
    addCssClasses: (ids: string | string[], classes: string | string[]) => void;
    removeCssClasses: (ids: string | string[], classes: string | string[]) => void;
  };
}

interface Props {
  title: string;
  xml: string;
  /** шаг выбранного замечания */
  activeNodeId?: string;
  /** шаги, к которым привязаны замечания */
  issueNodeIds: string[];
  hasSteps: boolean;
  onNode: (id: string) => void;
  onNodeContext: (id: string, ev: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }) => void;
  onEdit: () => void;
  /** диаграмма отрисована: можно искать элементы в DOM */
  onRendered: () => void;
}

const elementId = (target: EventTarget | null) => (target as Element | null)?.closest?.('[data-bpmn-id]')?.getAttribute('data-bpmn-id') ?? null;

/**
 * Карточка модели на доске. Диаграмма только показывается (bpmn-visualization, Apache-2.0, без водяного знака),
 * а редактирование открывается карандашом в отдельном редакторе.
 */
export function ProcessCard({ title, xml, activeNodeId, issueNodeIds, hasSteps, onNode, onNodeContext, onEdit, onRendered }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const viz = useRef<Viz | null>(null);
  const fitType = useRef<unknown>(undefined);
  const applied = useRef<{ id: string; cls: string }[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [renderTick, setRenderTick] = useState(0);
  /** размер карточки изменили: диаграмму нужно заново вписать в рамку */
  const [sizeTick, setSizeTick] = useState(0);
  const cb = useRef({ onNode, onNodeContext, onRendered });
  cb.current = { onNode, onNodeContext, onRendered };

  /* ----- создание просмотрщика ----- */
  useEffect(() => {
    let dead = false;
    const el = box.current;
    void (async () => {
      const lib = await import('bpmn-visualization');
      if (dead || !el) return;
      fitType.current = lib.FitType.Center;
      viz.current = new lib.BpmnVisualization({ container: el, navigation: { enabled: false } }) as unknown as Viz;
      setReady(true);
    })();

    const click = (e: MouseEvent) => {
      const id = elementId(e.target);
      if (id) cb.current.onNode(id);
    };
    const menu = (e: MouseEvent) => {
      const id = elementId(e.target);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      cb.current.onNodeContext(id, e);
    };
    el?.addEventListener('click', click);
    el?.addEventListener('contextmenu', menu);
    return () => {
      dead = true;
      el?.removeEventListener('click', click);
      el?.removeEventListener('contextmenu', menu);
      viz.current?.dispose();
      viz.current = null;
    };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let first = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      clearTimeout(t);
      t = setTimeout(() => setSizeTick((n) => n + 1), 150);
    });
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, []);

  /* ----- отрисовка XML ----- */
  useEffect(() => {
    const v = viz.current;
    if (!ready || !v) return;
    try {
      v.load(xml, { fit: { type: fitType.current, margin: 28 } });
      try {
        if (box.current) fitWithData(v.graph.view, xml, box.current.clientWidth, box.current.clientHeight);
        drawDataElements(v.graph.view, xml);
      } catch {
        /* без элементов данных диаграмма всё равно читаема */
      }
      applied.current = [];
      setError(false);
      setRenderTick((t) => t + 1);
      cb.current.onRendered();
    } catch {
      setError(true);
    }
  }, [xml, ready, sizeTick]);

  /* ----- подсветка замечаний ----- */
  useEffect(() => {
    const v = viz.current;
    if (!ready || !v || renderTick === 0) return;
    const reg = v.bpmnElementsRegistry;
    for (const a of applied.current) if (reg.getElementsByIds(a.id).length) reg.removeCssClasses(a.id, a.cls);
    applied.current = [];
    const mark = (id: string, cls: string) => {
      if (!reg.getElementsByIds(id).length) return;
      reg.addCssClasses(id, cls);
      applied.current.push({ id, cls });
    };
    for (const id of issueNodeIds) mark(id, 'has-issue');
    if (activeNodeId) mark(activeNodeId, 'issue-active');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, renderTick, activeNodeId, issueNodeIds.join('|')]);

  return (
    <>
      <div className="model-head">
        <Icon name="model" size={18} />
        <b>{title}</b>
        <span className="tag">BPMN 2.0</span>
        <div className="grow" />
        <button type="button" className="icon-btn edit-btn" aria-label="Редактировать BPMN-модель" title="Редактировать модель" onClick={onEdit}>
          <Icon name="pencil" size={17} />
        </button>
      </div>
      <div className="process-view" ref={box} />
      {error && <div className="process-hint">Не удалось отобразить диаграмму. Откройте редактор и проверьте файл.</div>}
      {!error && ready && !hasSteps && <div className="process-hint">Диаграмма пока пустая. Нажмите на карандаш, чтобы нарисовать процесс.</div>}
    </>
  );
}
