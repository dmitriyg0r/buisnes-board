import { useEffect, useState } from 'react';
import { isLinkable, projectFlows, projectNodes, typeLabel as bpmnTypeLabel, type ProjectNode } from './bpmn';
import { sectionRef, type Issue, type Source } from './data';
import { Icon } from './Icon';
import { defaults, docFields, fileFields, key, modelFields, nodeFields, sectionFields, type FieldDef } from './schema';
import type { ModelApi } from './useModel';

export type PropTarget = { type: 'node' | 'section' | 'card'; id: string };

interface Props {
  target: PropTarget;
  api: ModelApi;
  issues: Issue[];
  onClose: () => void;
  onSelectIssue: (id: string) => void;
}

const stepName = (n: ProjectNode) => n.name || bpmnTypeLabel[n.type] || 'Элемент';
type Tab = 'general' | 'attrs' | 'links';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="prow">
      <span className="plabel">{label}</span>
      {children}
    </label>
  );
}

function Static({ label, value }: { label: string; value: string }) {
  return (
    <div className="prow">
      <span className="plabel">{label}</span>
      <span className="pstatic">{value}</span>
    </div>
  );
}

export function PropertiesDialog({ target, api, issues, onClose, onSelectIssue }: Props) {
  const { model } = api;
  const [tab, setTab] = useState<Tab>('general');

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const nodes = projectNodes(model.processes);
  const flows = projectFlows(model.processes);
  const allSections = model.docs.flatMap((d) => d.sections.map((s) => ({ ...s, doc: d })));

  const node = target.type === 'node' ? nodes.find((n) => n.id === target.id) : undefined;
  const section = target.type === 'section' ? allSections.find((s) => s.id === target.id) : undefined;
  const cardKind = target.type === 'card' ? target.id.split(':')[0] : '';
  const cardId = target.type === 'card' ? target.id.slice(target.id.indexOf(':') + 1) : '';
  const proc = cardKind === 'proc' ? model.processes.find((p) => p.id === cardId) : undefined;
  const doc = cardKind === 'doc' ? model.docs.find((d) => d.id === cardId) : undefined;
  const htmlObject = cardKind === 'html' ? model.htmlObjects.find((h) => h.id === cardId) : undefined;
  const source: Source | undefined = cardKind === 'src' ? model.sources.find((s) => s.id === cardId) : undefined;
  const exists = node || section || proc || doc || htmlObject || source;

  useEffect(() => {
    if (!exists) onClose();
  }, [exists, onClose]);
  if (!exists) return null;

  const mkey = target.type === 'node' ? key.node(target.id) : target.type === 'section' ? key.section(target.id) : key.card(target.id);

  const get = (f: string, fallback = '') => model.meta[mkey]?.[f] ?? defaults[mkey]?.[f] ?? fallback;
  const set = (f: string, v: string) => api.applyLive((m) => ({ ...m, meta: { ...m.meta, [mkey]: { ...m.meta[mkey], [f]: v } } }));
  const setSource = (p: Partial<Source>) =>
    api.applyLive((m) => ({ ...m, sources: m.sources.map((s) => (source && s.id === source.id ? { ...s, ...p } : s)) }));

  /* ----- заголовок и тип ----- */
  let title = '';
  let typeLabel = '';
  let fields: FieldDef[] = [];
  let fallbacks: Record<string, string> = {};
  if (node) {
    title = stepName(node);
    typeLabel = bpmnTypeLabel[node.type] ?? 'Элемент';
    fields = nodeFields[node.kind];
    fallbacks = { executor: node.lane ?? '' };
  } else if (section) {
    title = section.title;
    typeLabel = `Пункт документа «${section.doc.title}»`;
    fields = sectionFields;
  } else if (proc) {
    title = proc.title;
    typeLabel = 'BPMN-модель';
    fields = modelFields;
  } else if (doc) {
    title = doc.title;
    typeLabel = 'Документ · Markdown';
    fields = docFields;
  } else if (htmlObject) {
    title = htmlObject.title;
    typeLabel = 'Интерактивный HTML';
    fields = docFields;
  } else {
    title = source!.name;
    typeLabel = `Источник · ${source!.ext}`;
    fields = fileFields;
  }

  /* ----- связанные замечания ----- */
  const related = issues.filter((i) => {
    if (node) return i.model?.nodeId === node.id;
    if (section) return i.doc?.sectionId === section.id;
    if (source) return i.basis?.sourceId === source.id;
    if (proc) return !!i.model && i.model.nodeId.startsWith(`${proc.id}:`);
    if (doc) return !!i.doc && doc.sections.some((s) => s.id === i.doc!.sectionId);
    return false;
  });

  const toggleLink = (nodeId: string, sectionId: string, on: boolean) =>
    api.apply((m) => ({
      ...m,
      links: on
        ? [...m.links, { id: 'l' + Math.random().toString(36).slice(2, 7), nodeId, sectionId }]
        : m.links.filter((l) => !(l.nodeId === nodeId && l.sectionId === sectionId)),
    }));
  const hasLink = (nodeId: string, sectionId: string) => model.links.some((l) => l.nodeId === nodeId && l.sectionId === sectionId);
  const nameOf = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n ? stepName(n) : '—';
  };

  const fieldControl = (f: FieldDef) => {
    const value = get(f.key, fallbacks[f.key] ?? '');
    const common = {
      value,
      onFocus: () => api.checkpoint(),
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(f.key, e.target.value),
    };
    if (f.kind === 'textarea') return <textarea className="pinput" rows={3} placeholder={f.placeholder} {...common} />;
    if (f.kind === 'select')
      return (
        <select className="pinput" {...common}>
          {f.options!.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    return <input className="pinput" type="text" placeholder={f.placeholder} {...common} />;
  };

  /* ----- вкладки ----- */
  const general = (
    <>
      {node && <Static label="Название" value={stepName(node)} />}
      {node && <Static label="Модель" value={node.procTitle} />}
      {proc && (
        <Row label="Название модели">
          <input
            className="pinput"
            value={proc.title}
            onFocus={() => api.checkpoint()}
            onChange={(e) => api.applyLive((m) => ({ ...m, processes: m.processes.map((p) => (p.id === proc.id ? { ...p, title: e.target.value } : p)) }))}
          />
        </Row>
      )}
      {doc && (
        <Row label="Название документа">
          <input
            className="pinput"
            value={doc.title}
            onFocus={() => api.checkpoint()}
            onChange={(e) => api.applyLive((m) => ({ ...m, docs: m.docs.map((d) => (d.id === doc.id ? { ...d, title: e.target.value } : d)) }))}
          />
        </Row>
      )}
      {htmlObject && <Row label="Название HTML-объекта">
        <input className="pinput" value={htmlObject.title} onFocus={() => api.checkpoint()} onChange={(event) => api.applyLive((m) => ({ ...m, htmlObjects: m.htmlObjects.map((h) => h.id === htmlObject.id ? { ...h, title: event.target.value } : h) }))} />
      </Row>}
      {source && (
        <>
          <Row label="Название файла">
            <input className="pinput" value={source.name} onFocus={() => api.checkpoint()} onChange={(e) => setSource({ name: e.target.value })} />
          </Row>
          <Row label="Страниц">
            <input
              className="pinput"
              type="number"
              min={1}
              value={source.pages}
              onFocus={() => api.checkpoint()}
              onChange={(e) => setSource({ pages: Math.max(1, Math.round(Number(e.target.value)) || 1) })}
            />
          </Row>
        </>
      )}
      {section && <Static label="Заголовок" value={section.title} />}
      <Static label="Тип" value={typeLabel} />
      {node && node.lane && <Static label="Дорожка" value={node.lane} />}
      {section && <Static label="Номер" value={sectionRef(section.title)} />}
      {node && <p className="pnote">Название и положение шага меняются в редакторе BPMN: карандаш на карточке модели.</p>}
      {section && <p className="pnote">Заголовок и текст пункта меняются в редакторе документа: карандаш на карточке документа.</p>}
      <Static label="Идентификатор" value={target.id} />
    </>
  );

  const attrs = (
    <>
      {fields.map((f) => (
        <Row key={f.key} label={f.label}>
          {fieldControl(f)}
        </Row>
      ))}
    </>
  );

  const issuesBlock = (
    <div className="pgroup">
      <div className="plabel">Замечания · {related.length}</div>
      {related.length === 0 && <div className="pempty">Замечаний нет</div>}
      {related.map((i) => (
        <button
          key={i.id}
          type="button"
          className="pissue"
          onClick={() => {
            onSelectIssue(i.id);
            onClose();
          }}
        >
          <span className="dot-amber" />
          <span>{i.title}</span>
        </button>
      ))}
    </div>
  );

  let links: React.ReactNode = null;
  if (node) {
    const inc = flows.filter((e) => e.to === node.id);
    const out = flows.filter((e) => e.from === node.id);
    links = (
      <>
        <div className="pgroup">
          <div className="plabel">Входящие переходы · {inc.length}</div>
          {inc.length === 0 && <div className="pempty">Нет</div>}
          {inc.map((e) => (
            <div key={e.id} className="pline">← {nameOf(e.from)}{e.name ? ` · ${e.name}` : ''}</div>
          ))}
        </div>
        <div className="pgroup">
          <div className="plabel">Исходящие переходы · {out.length}</div>
          {out.length === 0 && <div className="pempty">Нет</div>}
          {out.map((e) => (
            <div key={e.id} className="pline">→ {nameOf(e.to)}{e.name ? ` · ${e.name}` : ''}</div>
          ))}
        </div>
        {isLinkable(node) && (
          <div className="pgroup">
            <div className="plabel">Описывается пунктами документов</div>
            {allSections.length === 0 && <div className="pempty">В проекте нет документов с пунктами</div>}
            {allSections.map((s) => (
              <label key={s.id} className="pcheck">
                <input type="checkbox" checked={hasLink(node.id, s.id)} onChange={(e) => toggleLink(node.id, s.id, e.target.checked)} />
                <span>
                  {s.title}
                  {model.docs.length > 1 && <small className="pcheck-sub"> · {s.doc.title}</small>}
                </span>
              </label>
            ))}
          </div>
        )}
        {issuesBlock}
      </>
    );
  } else if (section) {
    const steps = nodes.filter(isLinkable);
    links = (
      <>
        <div className="pgroup">
          <div className="plabel">Описывает шаги моделей</div>
          {steps.length === 0 && <div className="pempty">В проекте нет шагов</div>}
          {steps.map((n) => (
            <label key={n.id} className="pcheck">
              <input type="checkbox" checked={hasLink(n.id, section.id)} onChange={(e) => toggleLink(n.id, section.id, e.target.checked)} />
              <span>
                {stepName(n)}
                {model.processes.length > 1 && <small className="pcheck-sub"> · {n.procTitle}</small>}
              </span>
            </label>
          ))}
        </div>
        {issuesBlock}
      </>
    );
  } else {
    const steps = proc ? nodes.filter((n) => n.pid === proc.id && isLinkable(n)) : [];
    const covered = steps.filter((n) => model.links.some((l) => l.nodeId === n.id)).length;
    links = (
      <>
        {proc && (
          <div className="pgroup">
            <Static label="Элементов" value={String(nodes.filter((n) => n.pid === proc.id).length)} />
            <Static label="Переходов" value={String(flows.filter((f) => f.from.startsWith(`${proc.id}:`)).length)} />
            <Static label="Шагов с пунктом документа" value={`${covered} из ${steps.length}`} />
          </div>
        )}
        {doc && (
          <div className="pgroup">
            <Static label="Пунктов" value={String(doc.sections.length)} />
            <Static label="Пунктов с шагом" value={`${doc.sections.filter((s) => model.links.some((l) => l.sectionId === s.id)).length} из ${doc.sections.length}`} />
          </div>
        )}
        {issuesBlock}
      </>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'Общие' },
    { id: 'attrs', label: 'Атрибуты' },
    { id: 'links', label: 'Связи' },
  ];

  return (
    <div className="dlg-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onContextMenu={(e) => e.preventDefault()}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label={`Свойства: ${title}`}>
        <div className="dlg-head">
          <span className="dlg-icon"><Icon name="sliders" size={18} /></span>
          <div className="dlg-title">
            <b>{title || 'Без названия'}</b>
            <small>Свойства · {typeLabel}</small>
          </div>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="dlg-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`dlg-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'links' && related.length > 0 && <em>{related.length}</em>}
            </button>
          ))}
        </div>
        <div className="dlg-body">{tab === 'general' ? general : tab === 'attrs' ? attrs : links}</div>
        <div className="dlg-foot">
          <span>Изменения применяются сразу и попадают в историю отмены</span>
          <button type="button" className="btn btn-dark" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}
